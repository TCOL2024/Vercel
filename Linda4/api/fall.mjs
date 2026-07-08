// build: v20260708-gpt51-default
// Fixes: PFLEGE_RE inkl. MB/PPV, Vector Store auch bei Nachfragen,
// Zitier-Guardrail, Rückfrage-Dialog repariert, JSON-Code in Antworten verhindert,
// GPT-5.1 Flex als Standard (günstigeres Modell).

import { Redis } from '@upstash/redis';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const BASE_URL     = process.env.PORTAL_BASE_URL || 'https://pfk2026.oldenburg-knowledge.de';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN || 'SozR2026Expert';
const EXPERT_EMAIL = process.env.EXPERT_EMAIL || 'noormann@gmx.com';
const RESEND_FROM  = 'Sozialrecht Fachberatung <anfrage@resend.dev>';

// ── MODELLSTEUERUNG ──────────────────────────────────────────────────────────
// Standard: GPT-5.1 im Auto-Modus.
// Flex (service_tier: "flex") ist zwar günstiger, war zuletzt aber durchgehend
// überlastet (429 "insufficient resources") und sorgte dadurch nur für einen
// zusätzlichen fehlschlagenden Versuch vor jedem Request (doppelte Latenz,
// kein Kostenvorteil, da ohnehin auf "auto" zurückgefallen wurde).
const KI_MODEL = process.env.VORANALYSE_MODEL || process.env.OPENAI_MODEL || 'gpt-5.1';
const OPENAI_SERVICE_TIER = process.env.OPENAI_SERVICE_TIER || 'auto';

// Falls Flex wegen Ressourcenmangel oder Modellverfügbarkeit scheitert,
// wird automatisch derselbe Request mit service_tier: "auto" versucht.
const OPENAI_FLEX_FALLBACK_TO_AUTO = process.env.OPENAI_FLEX_FALLBACK_TO_AUTO !== 'false';

const MODEL_FALLBACKS = [...new Set([
  KI_MODEL,
  'gpt-5.1',
  'gpt-4o',
  'gpt-4o-mini',
])];

const CLASSIFIER_MODEL = process.env.CLASSIFIER_MODEL || KI_MODEL;

// ── ZITIER-GUARDRAIL ─────────────────────────────────────────────────────────
const ZITAT_GUARDRAIL = `

WICHTIG – Quellenbindung:
- Wurden über die Dateisuche passende Quellendokumente gefunden, MUSST du eine inhaltliche Einschätzung in eigenen Worten geben, die sich auf diese Quellen stützt. Verweigere die Einschätzung in diesem Fall NICHT.
- Wörtliche Zitate von Gesetzes- oder Bedingungstexten (SGB, MB/PPV, Tarif PV) NUR, wenn der exakte Wortlaut in den gefundenen Quelldokumenten enthalten ist. Ist kein wörtliches Zitat möglich, aber Inhalt vorhanden, fasse den Inhalt sinngemäß zusammen statt zu zitieren.
- Der Satz "Dazu liegt mir kein Quelldokument vor." ist ausschließlich zu verwenden, wenn die Dateisuche NICHTS thematisch Passendes liefert – NICHT, wenn lediglich kein exaktes Zitat möglich ist.
- Konstruiere NIEMALS einen Wortlaut oder eine Fundstelle, die nicht in den Quelldokumenten steht.
- Rechtsstand: die ab 1.7.2025 geltende Fassung (u.a. § 42a SGB XI Gemeinsamer Jahresbetrag; hälftige Pflegegeld-Fortzahlung bis zu 8 Wochen); Beträge und Rechengrößen mit Stand 2026.
- Nenne bei jeder normbezogenen Aussage die Fundstelle (§, Abs., Gesetz bzw. MB/PPV, ggf. Nr. Tarif PV).`;

// ── MODELLPARAMETER ──────────────────────────────────────────────────────────
function modelParams(model, { maxTokens, temperature, jsonMode }) {
  const nextGen = /^(gpt-5|o[0-9])/i.test(model);

  const p = nextGen
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens, temperature };

  if (jsonMode) {
    p.response_format = { type: 'json_object' };
  }

  return p;
}

// ── TEXT-/JSON-HELPER ────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[c]));
}

function cleanModelText(s) {
  return String(s ?? '')
    .trim()
    .replace(/^```(?:json|javascript|js|html|text)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function tryParseJsonPayload(raw) {
  const cleaned = cleanModelText(raw);

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstObj = cleaned.indexOf('{');
  const lastObj = cleaned.lastIndexOf('}');

  if (firstObj >= 0 && lastObj > firstObj) {
    try {
      return JSON.parse(cleaned.slice(firstObj, lastObj + 1));
    } catch {}
  }

  return null;
}

function unwrapModelAnswer(raw) {
  const cleaned = cleanModelText(raw);
  const parsed = tryParseJsonPayload(cleaned);

  if (!parsed || typeof parsed !== 'object') return cleaned;

  if (typeof parsed.einschaetzung === 'string' && parsed.einschaetzung.trim()) {
    return parsed.einschaetzung.trim();
  }

  if (typeof parsed.antwort === 'string' && parsed.antwort.trim()) {
    return parsed.antwort.trim();
  }

  if (Array.isArray(parsed.rueckfragen) && parsed.rueckfragen.length) {
    return parsed.rueckfragen.filter(Boolean).join('\n\n');
  }

  return cleaned;
}

function serviceTiersForRequest() {
  if (OPENAI_SERVICE_TIER === 'flex' && OPENAI_FLEX_FALLBACK_TO_AUTO) {
    return ['flex', 'auto'];
  }
  return [OPENAI_SERVICE_TIER];
}

function isFlexUnavailable(status, errorText, serviceTier) {
  if (serviceTier !== 'flex') return false;

  if (status === 429) return true;

  if (status === 400) {
    return /flex|service_tier|service tier|not available|unsupported|unavailable/i.test(String(errorText || ''));
  }

  return false;
}

// ── OPENAI CHAT COMPLETIONS MIT FALLBACK ─────────────────────────────────────
async function chatCompletion({
  apiKey,
  messages,
  maxTokens,
  temperature = 0.2,
  jsonMode = false,
  modelList = MODEL_FALLBACKS,
}) {
  let lastStatus = 0;
  let lastError = '';

  const tiers = serviceTiersForRequest();

  for (const model of modelList) {
    for (const serviceTier of tiers) {
      let response;

      try {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            service_tier: serviceTier,
            ...modelParams(model, { maxTokens, temperature, jsonMode }),
          }),
        });
      } catch (e) {
        lastStatus = 0;
        lastError = e.message;
        console.error(`OpenAI Netzwerkfehler (${model}, tier=${serviceTier}):`, e.message);
        continue;
      }

      if (response.ok) {
        const data = await response.json();
        const content = cleanModelText(data.choices?.[0]?.message?.content || '');

        return {
          ok: true,
          content,
          model,
          serviceTier,
        };
      }

      lastStatus = response.status;
      lastError = await response.text();

      console.error(
        `OpenAI-Fehler (${model}, tier=${serviceTier}):`,
        lastStatus,
        String(lastError).slice(0, 300)
      );

      if (lastStatus === 401) {
        return { ok: false, status: lastStatus, error: lastError };
      }

      if (isFlexUnavailable(lastStatus, lastError, serviceTier) && OPENAI_FLEX_FALLBACK_TO_AUTO) {
        continue;
      }

      if (lastStatus === 403 || lastStatus === 404) {
        break;
      }

      if (lastStatus === 429) {
        return { ok: false, status: lastStatus, error: lastError };
      }

      if (lastStatus === 400) {
        break;
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error: lastError,
  };
}

// ── RESEND-MAILVERSAND ───────────────────────────────────────────────────────
async function sendMail({ to, subject, html, replyTo, attachments }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('mail-not-configured');

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html,
      reply_to: replyTo,
      ...(attachments ? { attachments } : {}),
    }),
  });
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = req.query.action || (req.method === 'GET' ? 'portal' : 'anfrage');

  if (action === 'voranalyse')       return handleVoranalyse(req, res);
  if (action === 'portal')           return handlePortal(req, res);
  if (action === 'antwort')          return handleAntwort(req, res);
  if (action === 'nachfrage')        return handleNachfrage(req, res);
  if (action === 'nachfrageantwort') return handleNachfrageAntwort(req, res);
  if (action === 'uebersicht')       return handleUebersicht(req, res);
  if (action === 'bewertung')        return handleBewertung(req, res);
  if (action === 'loeschen')         return handleLoeschen(req, res);
  if (action === 'voice')            return handleVoice(req, res);

  return handleAnfrage(req, res);
}

// ── 0. ÜBERSICHT ─────────────────────────────────────────────────────────────
async function handleUebersicht(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');

  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Nicht autorisiert' });
  }

  try {
    let keys = [];

    try {
      keys = await kv.keys('fall:*');
    } catch (e) {
      console.error('KV keys:', e.message);
    }

    const raws = keys.length
      ? await Promise.all(keys.map(k => kv.get(k).catch(() => null)))
      : [];

    const faelle = [];

    for (const raw of raws) {
      if (!raw) continue;

      const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!f || !f.id) continue;

      const nf = Array.isArray(f.nachfragen) ? f.nachfragen : [];

      faelle.push({
        id: f.id,
        created: f.created || null,
        vorname: f.vorname || '',
        nachname: f.nachname || '',
        thema: f.thema || '',
        fachbereich: f.fachbereich || '',
        status: f.status || 'offen',
        antwortDatum: f.antwortDatum || null,
        bewertung: Number.isFinite(+f.bewertung) && +f.bewertung > 0 ? +f.bewertung : null,
        bewertungDatum: f.bewertungDatum || null,
        offeneNachfragen: nf.filter(n => n && !n.antwort).length,
        nachfragenGesamt: nf.length,
        snippet: String(f.beschreibung || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        beschreibung: String(f.beschreibung || ''),
        antwort: String(f.antwort || ''),
        nachfragen: nf,
      });
    }

    faelle.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

    const offen       = faelle.filter(f => f.status !== 'beantwortet').length;
    const beantwortet = faelle.filter(f => f.status === 'beantwortet').length;
    const offeneRueck = faelle.reduce((s, f) => s + f.offeneNachfragen, 0);

    return res.status(200).json({
      ok: true,
      count: faelle.length,
      offen,
      beantwortet,
      offeneRueck,
      faelle,
    });
  } catch (e) {
    console.error('Uebersicht Fehler:', e.message);
    return res.status(500).json({ error: 'Fehler beim Laden' });
  }
}

// ── BEWERTUNG ────────────────────────────────────────────────────────────────
async function handleBewertung(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'no-store');

  const { id, rating } = req.body || {};
  const stars = Math.round(Number(rating));

  if (!id || !Number.isFinite(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Ungültige Bewertung' });
  }

  let fall;

  try {
    const raw = await kv.get(`fall:${id}`);
    if (!raw) return res.status(404).json({ error: 'Fall nicht gefunden' });
    fall = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    console.error('KV Fehler (Bewertung):', e.message);
    return res.status(500).json({ error: 'Datenbankfehler' });
  }

  if (!fall.antwort) {
    return res.status(409).json({ error: 'Noch keine Antwort vorhanden' });
  }

  fall.bewertung = stars;
  fall.bewertungDatum = new Date().toISOString();

  try {
    await kv.set(`fall:${id}`, JSON.stringify(fall), { ex: 60 * 60 * 24 * 180 });
  } catch (e) {
    console.error('KV Update Fehler (Bewertung):', e.message);
    return res.status(500).json({ error: 'Speichern fehlgeschlagen' });
  }

  return res.status(200).json({ ok: true, bewertung: stars });
}

// ── LÖSCHEN ──────────────────────────────────────────────────────────────────
async function handleLoeschen(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'no-store');

  const { id, token, grund } = req.body || {};

  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Nicht autorisiert' });
  if (!id) return res.status(400).json({ error: 'Fehlende ID' });

  try {
    await kv.del(`fall:${id}`);
    console.log(`Fall ${id} gelöscht. Grund: ${grund || '–'}`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('KV Del Fehler:', e.message);
    return res.status(500).json({ error: 'Löschen fehlgeschlagen' });
  }
}

// ── VECTOR STORE — PFLEGE-SUCHE ──────────────────────────────────────────────
const VECTOR_STORE_ID = 'vs_69de0362cf84819199202158e8444e16';

const PFLEGE_RE = /pflege(?:grad|kasse|bed[uü]rf|vers|heim|geld|antrag|zeit)?|sgb\s*xi\b|mb\s*\/?\s*ppv|\bppv\b|musterbedingungen|tarif\s*pv\b|pfleges(?:tufe|atz)|medizinischer?\s*dienst\b|mdk\b|medicproof|spitex|tagespflege|kurzzeitpflege|verhinderungspflege|ersatzpflege|entlastungsbetrag|pflegeperson/i;

async function llmMitQuellen(apiKey, systemPrompt, messages) {
  const inputMessages = messages.filter(m => m.role !== 'system');

  let lastStatus = 0;
  let lastError = '';

  const tiers = serviceTiersForRequest();

  for (const model of MODEL_FALLBACKS) {
    for (const serviceTier of tiers) {
      const body = {
        model,
        instructions: systemPrompt,
        input: inputMessages,
        service_tier: serviceTier,
        tools: [{ type: 'file_search', vector_store_ids: [VECTOR_STORE_ID] }],
        include: ['file_search_call.results'],
      };

      let r;

      try {
        r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        lastStatus = 0;
        lastError = e.message;
        console.error(`Responses API Netzwerkfehler (${model}, tier=${serviceTier}):`, e.message);
        continue;
      }

      if (!r.ok) {
        lastStatus = r.status;
        lastError = await r.text();

        console.error(
          `Responses API Fehler (${model}, tier=${serviceTier}):`,
          lastStatus,
          String(lastError).slice(0, 300)
        );

        if (lastStatus === 401) {
          throw new Error(`LLM-Responses nicht autorisiert (${lastStatus})`);
        }

        if (isFlexUnavailable(lastStatus, lastError, serviceTier) && OPENAI_FLEX_FALLBACK_TO_AUTO) {
          continue;
        }

        if (lastStatus === 403 || lastStatus === 404) {
          break;
        }

        if (lastStatus === 429) {
          throw new Error(`LLM-Responses Rate Limit (${lastStatus})`);
        }

        if (lastStatus === 400) {
          break;
        }

        continue;
      }

      const data = await r.json();

      const outputTypes = (data.output || []).map(o => o.type);
      console.log('Responses API output types:', JSON.stringify(outputTypes), '| model:', model, '| tier:', serviceTier);

      const searchCall = (data.output || []).find(o =>
        o.type === 'file_search_call' || o.type === 'tool_call'
      );

      if (searchCall) {
        console.log('searchCall keys:', JSON.stringify(Object.keys(searchCall)));
        console.log('searchCall.status:', searchCall.status);
        console.log(
          'searchCall.results type:',
          typeof searchCall.results,
          Array.isArray(searchCall.results) ? 'len=' + searchCall.results.length : ''
        );
      } else {
        console.log('searchCall: nicht gefunden in output');
      }

      const rawResults = Array.isArray(searchCall?.results) ? searchCall.results : [];

      const quellen = rawResults
        .filter(q => (q.score || 0) >= 0.1)
        .slice(0, 3)
        .map(q => ({
          datei: q.filename || q.file_name || q.title || 'Dokument',
          auszug: (q.text || q.content || q.snippet || '').trim().slice(0, 300),
        }))
        .filter(q => q.datei || q.auszug);

      const msgOut = (data.output || []).find(o => o.type === 'message');
      const contentItem = msgOut?.content?.[0];

      let text = (
        contentItem?.text ||
        contentItem?.output_text ||
        (typeof contentItem === 'string' ? contentItem : '') ||
        data.output_text ||
        ''
      );

      text = cleanModelText(text)
        .replace(/【\d+†[^】]*】/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      console.log(
        'llmMitQuellen result:',
        'model=', model,
        '| tier=', serviceTier,
        '| text length=', text.length,
        '| quellen=', quellen.length
      );

      return {
        text,
        quellen,
        model,
        serviceTier,
      };
    }
  }

  throw new Error(`LLM-Responses fehlgeschlagen (${lastStatus}): ${String(lastError).slice(0, 300)}`);
}

// ── VOICE ────────────────────────────────────────────────────────────────────
async function handleVoice(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.Sozialrecht2026 || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'KI nicht konfiguriert' });

  const { step, text, verlauf } = req.body || {};

  async function tts(input) {
    const azureKey    = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION || 'germanywestcentral';
    const azureVoice  = process.env.AZURE_SPEECH_VOICE  || 'de-DE-SeraphinaMultilingualNeural';

    if (azureKey) {
      const ssml = `<speak version='1.0' xml:lang='de-DE'><voice name='${azureVoice}'>${input.replace(/[<>&"]/g, c => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
      }[c]))}</voice></speak>`;

      const r = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'Linda4-SocialLaw',
        },
        body: ssml,
      });

      if (r.ok) return Buffer.from(await r.arrayBuffer()).toString('base64');

      console.warn('Azure TTS fehlgeschlagen (' + r.status + '), Fallback auf OpenAI');
    }

    const ttsModels = ['gpt-4o-mini-tts', 'tts-1-hd'];

    for (const ttsModel of ttsModels) {
      const r2 = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ttsModel,
          voice: 'coral',
          input,
          response_format: 'mp3',
        }),
      });

      if (r2.ok) {
        return Buffer.from(await r2.arrayBuffer()).toString('base64');
      }

      console.warn(`TTS ${ttsModel} fehlgeschlagen (${r2.status}), nächster Versuch…`);
    }

    throw new Error('Alle TTS-Modelle fehlgeschlagen');
  }

  async function llm(messages) {
    const result = await chatCompletion({
      apiKey,
      messages,
      maxTokens: 400,
      temperature: 0.2,
    });

    if (!result.ok) throw new Error('LLM ' + result.status);

    return {
      text: unwrapModelAnswer(result.content),
      quellen: [],
      model: result.model,
      serviceTier: result.serviceTier,
    };
  }

  if (step === 'greeting') {
    const gruss = 'Hallo, ich bin Linda und helfe Dir gerne bei sozialversicherungsrechtlichen Fragen. Formuliere mir kurz und kompakt um was es geht.';

    try {
      const audio = await tts(gruss);
      return res.status(200).json({ ok: true, text: gruss, audio });
    } catch (e) {
      console.error('Voice greeting error:', e.message);
      return res.status(500).json({ error: 'Sprachausgabe nicht verfügbar' });
    }
  }

  if (step === 'analyse' || step === 'followup') {
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Kein Text' });
    }

    const userText   = String(text).trim().slice(0, 1000);
    const isFollowup = step === 'followup';

    const istPflege = PFLEGE_RE.test(userText) ||
      (Array.isArray(verlauf) && verlauf.some(v =>
        PFLEGE_RE.test(v.user || '') || PFLEGE_RE.test(v.linda || '')
      ));

    const systemPrompt = `Du bist Linda, eine freundliche KI-Assistentin für deutsches Sozialrecht. Antworte kurz und klar auf Deutsch (max. 4 Sätze). Nenne das relevante SGB falls passend. Keine Rechtsberatung.${istPflege ? ' Nutze die bereitgestellten Quelldokumente zum SGB XI und zu den MB/PPV.' : ''}${isFollowup ? ' Das ist die letzte Antwort im Beta-Modus – schließe mit dem Hinweis, die Anfrage schriftlich einzureichen.' : ''}${ZITAT_GUARDRAIL}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(Array.isArray(verlauf)
        ? verlauf.flatMap(v => [
          { role: 'user', content: v.user },
          { role: 'assistant', content: v.linda },
        ])
        : []),
      { role: 'user', content: userText },
    ];

    let responseText;
    let quellen = [];

    try {
      if (istPflege) {
        const result = await llmMitQuellen(apiKey, systemPrompt, messages);
        responseText = unwrapModelAnswer(result.text);
        quellen = result.quellen;

        console.log(`Voice Pflege: ${quellen.length} Quelle(n) gefunden | model=${result.model} | tier=${result.serviceTier}`);
      } else {
        const result = await llm(messages);
        responseText = result.text;

        console.log(`Voice Standard: model=${result.model} | tier=${result.serviceTier}`);
      }
    } catch (e) {
      console.error('Voice LLM error:', e.message);
      return res.status(502).json({ error: 'Analyse fehlgeschlagen' });
    }

    try {
      const audio = await tts(responseText);
      return res.status(200).json({
        ok: true,
        text: responseText,
        audio,
        quellen,
        final: isFollowup,
      });
    } catch (e) {
      console.error('Voice TTS error:', e.message);
      return res.status(200).json({
        ok: true,
        text: responseText,
        audio: null,
        quellen,
        final: isFollowup,
      });
    }
  }

  return res.status(400).json({ error: 'Unbekannter Step' });
}

// ── INTENT-KLASSIFIKATION ────────────────────────────────────────────────────
async function classifyIntent(apiKey, thema, beschreibung) {
  try {
    const result = await chatCompletion({
      apiKey,
      modelList: [...new Set([CLASSIFIER_MODEL, ...MODEL_FALLBACKS])],
      messages: [{
        role: 'user',
        content:
          `Klassifiziere diese Anfrage im deutschen Sozialrecht kurz.\n` +
          `Thema: ${thema}\n` +
          `Beschreibung: ${String(beschreibung).slice(0, 400)}\n` +
          `Antworte als JSON: {"sgb":"SGB V","bereich":"Krankenversicherung","typ":"Leistungsantrag|Widerspruch|Erstantrag|Sonstiges","komplexitaet":"niedrig|mittel|hoch"}`,
      }],
      maxTokens: 120,
      temperature: 0.1,
      jsonMode: true,
    });

    if (!result.ok) return null;

    const k = tryParseJsonPayload(result.content);
    return k && k.sgb ? k : null;
  } catch {
    return null;
  }
}

// ── 1. VORANALYSE ────────────────────────────────────────────────────────────
async function handleVoranalyse(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    thema,
    beschreibung,
    attachment,
    attachmentName,
    attachmentType,
    antworten,
  } = req.body;

  if (!thema || !beschreibung) {
    return res.status(400).json({ error: 'Fehlende Felder' });
  }

  const apiKey = process.env.Sozialrecht2026 || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'KI nicht konfiguriert' });

  const hatAntworten        = antworten && Object.keys(antworten).length > 0;
  const forceEinschaetzung  = req.body.forceEinschaetzung === true;
  const userFrage           = (req.body.userFrage || '').toString().trim().slice(0, 600);
  const istNachfrage        = userFrage.length > 0;
  const direktEinschaetzung = hatAntworten || forceEinschaetzung || istNachfrage;

  const antwortLaenge = req.body.antwortLaenge === 'ausfuehrlich'
    ? 'ausfuehrlich'
    : 'kompakt';

  const laengeInstruktion = antwortLaenge === 'ausfuehrlich'
    ? `Gib eine AUSFÜHRLICHE Einschätzung in 3-4 kurzen Absätzen: ordne den Sachverhalt rechtlich ein, nenne die einschlägigen Normen (konkretes SGB / §), erläutere mögliche Ansprüche samt Voraussetzungen und beschreibe sinnvolle nächste Schritte. Klar strukturiert, verständlich, ohne Juristenjargon.`
    : `Gib eine KOMPAKTE Einschätzung in 3-4 Sätzen: nur das Wesentliche, das relevante SGB falls passend, ohne Ausschweifungen.`;

  const systemPrompt = istNachfrage
    ? `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Der User hat zu deiner bisherigen Einschätzung eine ergänzende Frage. Beantworte AUSSCHLIESSLICH diese Frage – konkret, unverbindlich und bezogen auf den geschilderten Fall.
${laengeInstruktion}
Antworte auf Deutsch, ohne Juristenjargon. Beginne direkt mit der Antwort. Keine Rechtsberatung.${ZITAT_GUARDRAIL}`
    : direktEinschaetzung
      ? `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
${hatAntworten ? 'Der User hat bereits Rückfragen beantwortet – beziehe diese Antworten explizit ein.' : ''}
Gib eine fundierte, UNVERBINDLICHE Einschätzung.
${laengeInstruktion}
Antworte IMMER als gültiges JSON:
{"einschaetzung":"...","paragrafen":["§ XX SGB XX"]}
Regeln: paragrafen = bis zu 4 relevante §§ aus dem deutschen Sozialgesetzbuch, z. B. "§ 37 SGB V", "§ 14 SGB XI". Falls kein konkreter § passt: leeres Array []. Keine Rechtsberatung. Antworte auf Deutsch.${ZITAT_GUARDRAIL}`
      : `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Analysiere die Fallbeschreibung und entscheide:

A) Ist die Beschreibung ausreichend klar und detailliert?
   → Gib eine erste UNVERBINDLICHE Einschätzung. ${laengeInstruktion} Nenne das relevante SGB wenn passend.

B) Ist die Beschreibung zu kurz, unklar oder fehlen wichtige Infos?
   → Stelle 1-2 gezielte Rückfragen um den Fall besser einschätzen zu können.

Antworte IMMER als gültiges JSON:
{"modus":"einschaetzung"|"rueckfragen","einschaetzung":"..."|null,"rueckfragen":["Frage 1?"]|null,"paragrafen":["§ XX SGB XX"]|[]}

Regeln: Bei unter 80 Zeichen IMMER rueckfragen. Fragen spezifisch für ${thema}. Antworte auf Deutsch.${ZITAT_GUARDRAIL}`;

  const isImage = attachmentType?.startsWith('image/');
  const isPdf   = attachmentType === 'application/pdf' || attachmentName?.toLowerCase().endsWith('.pdf');
  const isDocx  = attachmentType?.includes('word') || attachmentName?.toLowerCase().match(/\.docx?$/);

  let docText = '';

  if (attachment && (isPdf || isDocx)) {
    try {
      const buffer = Buffer.from(attachment, 'base64');

      if (isPdf) {
        const pdfParse = require('pdf-parse');
        docText = (await pdfParse(buffer)).text?.slice(0, 3000) || '';
      } else {
        const mammoth = require('mammoth');
        docText = (await mammoth.extractRawText({ buffer })).value?.slice(0, 3000) || '';
      }
    } catch (e) {
      console.error('Dok-Extraktion:', e.message);
    }
  }

  const antwortBlock = hatAntworten
    ? '\n\nAntworten auf Rückfragen:\n' +
      Object.entries(antworten)
        .map(([f, a]) => `- ${f}\n  → ${a}`)
        .join('\n')
    : '';

  const einschaetzungContext = istNachfrage && req.body.bisherigeEinschaetzung
    ? `\n\nBisherige Einschätzung von Linda4:\n${req.body.bisherigeEinschaetzung}`
    : '';

  const verlaufContext = istNachfrage && Array.isArray(req.body.verlauf) && req.body.verlauf.length
    ? '\n\nBisherige ergänzende Fragen:\n' +
      req.body.verlauf
        .map(v => `- Frage: ${v.frage}\n  Antwort: ${v.antwort}`)
        .join('\n')
    : '';

  const frageBlock = istNachfrage
    ? `\n\nErgänzende Frage des Users:\n${userFrage}`
    : '';

  const baseText =
    `Themenbereich: ${thema}\n\n` +
    `Fallbeschreibung:\n${beschreibung}` +
    `${antwortBlock}` +
    `${einschaetzungContext}` +
    `${verlaufContext}` +
    `${frageBlock}` +
    `${docText ? `\n\n--- Dokument (${attachmentName}) ---\n${docText}` : ''}`;

  const userContent = attachment && isImage
    ? [
      { type: 'text', text: baseText },
      {
        type: 'image_url',
        image_url: {
          url: `data:${attachmentType};base64,${attachment}`,
          detail: 'high',
        },
      },
    ]
    : baseText;

  const istPflegeThema = PFLEGE_RE.test(
    thema + ' ' + String(beschreibung || '').slice(0, 500) + ' ' + userFrage
  );

  try {
    const klassifikationPromise = !istNachfrage
      ? classifyIntent(apiKey, thema, String(beschreibung || ''))
      : Promise.resolve(null);

    let raw;
    let quellen = [];

    if (istPflegeThema) {
      console.log('Voranalyse: Pflege-Thema erkannt, nutze Vector Store' + (istNachfrage ? ' (Nachfrage)' : ''));

      const [klassifikation, pflegeResult] = await Promise.all([
        klassifikationPromise,
        llmMitQuellen(apiKey, systemPrompt, [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: typeof userContent === 'string'
              ? userContent
              : JSON.stringify(userContent),
          },
        ]),
      ]);

      raw = pflegeResult.text;
      quellen = pflegeResult.quellen;

      console.log(
        'Voranalyse Pflege: quellen=' + quellen.length +
        ' | model=' + pflegeResult.model +
        ' | tier=' + pflegeResult.serviceTier
      );

      if (istNachfrage) {
        return res.status(200).json({
          modus: 'nachfrage',
          antwort: unwrapModelAnswer(raw),
          quellen,
          antwortLaenge,
          model: pflegeResult.model,
          serviceTier: pflegeResult.serviceTier,
        });
      }

      const parsed = tryParseJsonPayload(raw);

      if (parsed && parsed.modus === 'rueckfragen' && Array.isArray(parsed.rueckfragen)) {
        return res.status(200).json({
          modus: 'rueckfragen',
          einschaetzung: null,
          rueckfragen: parsed.rueckfragen.filter(Boolean).slice(0, 2),
          paragrafen: Array.isArray(parsed.paragrafen)
            ? parsed.paragrafen.filter(p => p && typeof p === 'string').slice(0, 4)
            : [],
          quellen,
          klassifikation,
          antwortLaenge,
          model: pflegeResult.model,
          serviceTier: pflegeResult.serviceTier,
        });
      }

      const paragrafen = parsed && Array.isArray(parsed.paragrafen)
        ? parsed.paragrafen.filter(p => p && typeof p === 'string').slice(0, 4)
        : [];

      return res.status(200).json({
        modus: 'einschaetzung',
        einschaetzung: unwrapModelAnswer(parsed?.einschaetzung || raw),
        paragrafen,
        quellen,
        klassifikation,
        rueckfragen: null,
        antwortLaenge,
        model: pflegeResult.model,
        serviceTier: pflegeResult.serviceTier,
      });
    }

    const [klassifikation, result] = await Promise.all([
      klassifikationPromise,
      chatCompletion({
        apiKey,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        maxTokens: antwortLaenge === 'ausfuehrlich' ? 900 : 500,
        temperature: 0.15,
        jsonMode: !istNachfrage,
      }),
    ]);

    if (!result.ok) {
      console.error('OpenAI Voranalyse-Fehler:', result.status, String(result.error).slice(0, 300));
      return res.status(502).json({ error: 'KI-Analyse fehlgeschlagen' });
    }

    raw = result.content;

    if (istNachfrage) {
      return res.status(200).json({
        modus: 'nachfrage',
        antwort: unwrapModelAnswer(raw),
        antwortLaenge,
        model: result.model,
        serviceTier: result.serviceTier,
      });
    }

    let parsed = tryParseJsonPayload(raw);

    if (!parsed) {
      parsed = {
        modus: 'einschaetzung',
        einschaetzung: unwrapModelAnswer(raw),
        rueckfragen: null,
        paragrafen: [],
      };
    }

    const paragrafen = Array.isArray(parsed.paragrafen)
      ? parsed.paragrafen.filter(p => p && typeof p === 'string').slice(0, 4)
      : [];

    if (direktEinschaetzung) {
      return res.status(200).json({
        modus: 'einschaetzung',
        einschaetzung: unwrapModelAnswer(parsed.einschaetzung || raw),
        paragrafen,
        quellen: [],
        klassifikation,
        rueckfragen: null,
        antwortLaenge,
        model: result.model,
        serviceTier: result.serviceTier,
      });
    }

    const docHinweis = attachment
      ? isImage
        ? ' (Bild analysiert)'
        : isPdf
          ? ' (PDF ausgewertet)'
          : isDocx
            ? ' (Dokument ausgewertet)'
            : ''
      : '';

    if (parsed.modus === 'rueckfragen' && Array.isArray(parsed.rueckfragen)) {
      return res.status(200).json({
        modus: 'rueckfragen',
        einschaetzung: null,
        rueckfragen: parsed.rueckfragen.filter(Boolean).slice(0, 2),
        paragrafen,
        quellen: [],
        klassifikation,
        docHinweis,
        antwortLaenge,
        model: result.model,
        serviceTier: result.serviceTier,
      });
    }

    return res.status(200).json({
      modus: 'einschaetzung',
      einschaetzung: unwrapModelAnswer(parsed.einschaetzung || raw),
      rueckfragen: null,
      paragrafen,
      quellen: [],
      klassifikation,
      docHinweis,
      antwortLaenge,
      model: result.model,
