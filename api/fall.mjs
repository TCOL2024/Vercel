// build: v2026-06-02-fallback (Cache-Bust: erzwingt Neukompilierung der Funktion)
import { Redis } from '@upstash/redis';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const BASE_URL     = process.env.PORTAL_BASE_URL || 'https://pfk2026.oldenburg-knowledge.de';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN || 'SozR2026Expert';
const EXPERT_EMAIL = process.env.EXPERT_EMAIL || 'noormann@gmx.com';
const RESEND_FROM  = 'Sozialrecht Fachberatung <anfrage@resend.dev>';

// Für die KI-Voranalyse wird vorrangig GPT-5.1 verwendet.
// (Per Env-Variable überschreibbar, falls OpenAI eine andere Modell-ID erwartet.)
const KI_MODEL = process.env.VORANALYSE_MODEL || 'gpt-5.1';
// Reihenfolge der Modelle, die nacheinander probiert werden.
// Falls die bevorzugte Modell-ID vom Account nicht unterstützt wird,
// fällt der Aufruf automatisch auf ein garantiert verfügbares Modell zurück.
const MODEL_FALLBACKS = [...new Set([KI_MODEL, 'gpt-4o', 'gpt-4o-mini'])];

// Baut die richtigen Parameter je nach Modell-Generation.
// GPT-5- und o-Modelle: max_completion_tokens + nur Default-Temperatur.
// Ältere Modelle (gpt-4o etc.): max_tokens + frei wählbare Temperatur.
function modelParams(model, { maxTokens, temperature, jsonMode }) {
  const nextGen = /^(gpt-5|o[0-9])/i.test(model);
  const p = nextGen ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens, temperature };
  if (jsonMode) p.response_format = { type: 'json_object' };
  return p;
}

// Ruft die OpenAI Chat-Completions-API auf und probiert bei Modell-/Parameter-
// Fehlern automatisch die nächste Modell-ID. Gibt { ok, content, model, status,
// error } zurück, damit der Aufrufer im Fehlerfall die echte Ursache kennt.
async function chatCompletion({ apiKey, messages, maxTokens, temperature, jsonMode }) {
  let lastStatus = 0, lastError = '';
  for (const model of MODEL_FALLBACKS) {
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, ...modelParams(model, { maxTokens, temperature, jsonMode }) }),
      });
    } catch (e) {
      lastStatus = 0; lastError = e.message; continue;
    }
    if (response.ok) {
      const content = (await response.json()).choices?.[0]?.message?.content?.trim() || '';
      return { ok: true, content, model };
    }
    lastStatus = response.status;
    lastError = await response.text();
    console.error(`OpenAI-Fehler (${model}):`, lastStatus, lastError.slice(0, 300));
    // Bei Auth-/Rate-Fehlern bringt ein anderes Modell nichts → abbrechen.
    if (lastStatus === 401 || lastStatus === 403 || lastStatus === 429) break;
  }
  return { ok: false, status: lastStatus, error: lastError };
}

// HTML-Escaping für nutzergenerierte Texte in E-Mails
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Einheitlicher Resend-Mailversand
async function sendMail({ to, subject, html, replyTo, attachments }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('mail-not-configured');
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM, to: [to], subject, html, reply_to: replyTo,
      ...(attachments ? { attachments } : {}),
    }),
  });
}

export default async function handler(req, res) {
  const action = req.query.action || (req.method === 'GET' ? 'portal' : 'anfrage');

  if (action === 'voranalyse')       return handleVoranalyse(req, res);
  if (action === 'portal')           return handlePortal(req, res);
  if (action === 'antwort')          return handleAntwort(req, res);
  if (action === 'nachfrage')        return handleNachfrage(req, res);
  if (action === 'nachfrageantwort') return handleNachfrageAntwort(req, res);
  if (action === 'uebersicht')       return handleUebersicht(req, res);
  return handleAnfrage(req, res);
}

// ── 0. ÜBERSICHT (alle Fälle – nur mit Admin-Token) ──────────────────────────
async function handleUebersicht(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Niemals von Suchmaschinen indexieren
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Nicht autorisiert' });

  try {
    let keys = [];
    try { keys = await kv.keys('fall:*'); } catch (e) { console.error('KV keys:', e.message); }
    const raws = keys.length ? await Promise.all(keys.map(k => kv.get(k).catch(() => null))) : [];

    const faelle = [];
    for (const raw of raws) {
      if (!raw) continue;
      const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!f || !f.id) continue;
      const nf = Array.isArray(f.nachfragen) ? f.nachfragen : [];
      faelle.push({
        id: f.id, created: f.created || null,
        vorname: f.vorname || '', nachname: f.nachname || '',
        thema: f.thema || '', fachbereich: f.fachbereich || '',
        status: f.status || 'offen', antwortDatum: f.antwortDatum || null,
        offeneNachfragen: nf.filter(n => n && !n.antwort).length,
        nachfragenGesamt: nf.length,
        snippet: String(f.beschreibung || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      });
    }
    faelle.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

    const offen        = faelle.filter(f => f.status !== 'beantwortet').length;
    const beantwortet  = faelle.filter(f => f.status === 'beantwortet').length;
    const offeneRueck  = faelle.reduce((s, f) => s + f.offeneNachfragen, 0);

    return res.status(200).json({ ok: true, count: faelle.length, offen, beantwortet, offeneRueck, faelle });
  } catch (e) {
    console.error('Uebersicht Fehler:', e.message);
    return res.status(500).json({ error: 'Fehler beim Laden' });
  }
}

// ── 1. VORANALYSE ────────────────────────────────────────────────────────────
async function handleVoranalyse(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { thema, beschreibung, attachment, attachmentName, attachmentType, antworten } = req.body;
  if (!thema || !beschreibung) return res.status(400).json({ error: 'Fehlende Felder' });

  const apiKey = process.env.Sozialrecht2026 || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'KI nicht konfiguriert' });

  const hatAntworten       = antworten && Object.keys(antworten).length > 0;
  const forceEinschaetzung = req.body.forceEinschaetzung === true;
  const userFrage          = (req.body.userFrage || '').toString().trim().slice(0, 600);
  const istNachfrage       = userFrage.length > 0;
  const direktEinschaetzung = hatAntworten || forceEinschaetzung || istNachfrage;

  // Der User kann zwischen einer kompakten und einer ausführlichen Antwort wählen.
  const antwortLaenge = req.body.antwortLaenge === 'ausfuehrlich' ? 'ausfuehrlich' : 'kompakt';
  const laengeInstruktion = antwortLaenge === 'ausfuehrlich'
    ? `Gib eine AUSFÜHRLICHE Einschätzung in 3-4 kurzen Absätzen: ordne den Sachverhalt rechtlich ein, nenne die einschlägigen Normen (konkretes SGB / §), erläutere mögliche Ansprüche samt Voraussetzungen und beschreibe sinnvolle nächste Schritte. Klar strukturiert, verständlich, ohne Juristenjargon.`
    : `Gib eine KOMPAKTE Einschätzung in 3-4 Sätzen: nur das Wesentliche, das relevante SGB falls passend, ohne Ausschweifungen.`;

  const systemPrompt = istNachfrage
    ? `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Der User hat zu deiner bisherigen Einschätzung eine ergänzende Frage. Beantworte AUSSCHLIESSLICH diese Frage – konkret, unverbindlich und bezogen auf den geschilderten Fall.
${laengeInstruktion}
Antworte auf Deutsch, ohne Juristenjargon. Beginne direkt mit der Antwort. Keine Rechtsberatung.`
    : direktEinschaetzung
    ? `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
${hatAntworten ? 'Der User hat bereits Rückfragen beantwortet – beziehe diese Antworten explizit ein.' : ''}
Gib eine fundierte, UNVERBINDLICHE Einschätzung.
${laengeInstruktion}
Antworte auf Deutsch. Beginne direkt mit der inhaltlichen Einschätzung. Keine Rechtsberatung.`
    : `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Analysiere die Fallbeschreibung und entscheide:

A) Ist die Beschreibung ausreichend klar und detailliert?
   → Gib eine erste UNVERBINDLICHE Einschätzung. ${laengeInstruktion} Nenne das relevante SGB wenn passend.

B) Ist die Beschreibung zu kurz, unklar oder fehlen wichtige Infos?
   → Stelle 1-2 gezielte Rückfragen um den Fall besser einschätzen zu können.

Antworte IMMER als gültiges JSON:
{"modus":"einschaetzung"|"rueckfragen","einschaetzung":"..."|null,"rueckfragen":["Frage 1?"]|null}

Regeln: Bei unter 80 Zeichen IMMER rueckfragen. Fragen spezifisch für ${thema}. Antworte auf Deutsch.`;

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
    } catch (e) { console.error('Dok-Extraktion:', e.message); }
  }

  const antwortBlock = hatAntworten
    ? '\n\nAntworten auf Rückfragen:\n' + Object.entries(antworten).map(([f, a]) => `- ${f}\n  → ${a}`).join('\n')
    : '';
  const einschaetzungContext = (istNachfrage && req.body.bisherigeEinschaetzung)
    ? `\n\nBisherige Einschätzung von Linda4:\n${req.body.bisherigeEinschaetzung}`
    : '';
  const verlaufContext = (istNachfrage && Array.isArray(req.body.verlauf) && req.body.verlauf.length)
    ? '\n\nBisherige ergänzende Fragen:\n' + req.body.verlauf.map(v => `- Frage: ${v.frage}\n  Antwort: ${v.antwort}`).join('\n')
    : '';
  const frageBlock = istNachfrage ? `\n\nErgänzende Frage des Users:\n${userFrage}` : '';
  const baseText = `Themenbereich: ${thema}\n\nFallbeschreibung:\n${beschreibung}${antwortBlock}${einschaetzungContext}${verlaufContext}${frageBlock}${docText ? `\n\n--- Dokument (${attachmentName}) ---\n${docText}` : ''}`;
  const userContent = (attachment && isImage)
    ? [{ type: 'text', text: baseText }, { type: 'image_url', image_url: { url: `data:${attachmentType};base64,${attachment}`, detail: 'high' } }]
    : baseText;

  try {
    const result = await chatCompletion({
      apiKey,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      maxTokens: antwortLaenge === 'ausfuehrlich' ? 900 : 450,
      temperature: 0.15,
      jsonMode: !direktEinschaetzung,
    });
    if (!result.ok) {
      console.error('OpenAI Voranalyse-Fehler:', result.status, String(result.error).slice(0, 300));
      return res.status(502).json({ error: 'KI-Analyse fehlgeschlagen' });
    }

    const raw = result.content;
    if (istNachfrage)        return res.status(200).json({ modus: 'nachfrage', antwort: raw, antwortLaenge });
    if (direktEinschaetzung) return res.status(200).json({ modus: 'einschaetzung', einschaetzung: raw, rueckfragen: null, antwortLaenge });

    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { modus: 'einschaetzung', einschaetzung: raw, rueckfragen: null }; }
    const docHinweis = attachment ? (isImage ? ' (Bild analysiert)' : isPdf ? ' (PDF ausgewertet)' : isDocx ? ' (Dokument ausgewertet)' : '') : '';
    return res.status(200).json({ ...parsed, docHinweis, antwortLaenge });
  } catch (err) {
    console.error('Voranalyse error:', err);
    return res.status(500).json({ error: 'Interner Fehler' });
  }
}

// ── 2. ANFRAGE (Fall einreichen) ─────────────────────────────────────────────
async function handleAnfrage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { vorname, nachname, email, fachbereich, thema, beschreibung,
          attachment, attachmentName, attachmentType, einschaetzung } = req.body;

  if (!vorname || !nachname || !email || !fachbereich || !thema || !beschreibung)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'E-Mail-Dienst nicht konfiguriert' });

  const apiKey = process.env.Sozialrecht2026 || process.env.OPENAI_API_KEY;
  const ts     = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const id     = crypto.randomUUID();

  const fallDaten = {
    id, created: new Date().toISOString(),
    vorname, nachname, email, fachbereich, thema, beschreibung,
    einschaetzung: einschaetzung || '', linda4Entwurf: '',
    status: 'offen', antwort: null, antwortDatum: null, nachfragen: [],
  };

  try {
    await kv.set(`fall:${id}`, JSON.stringify(fallDaten), { ex: 60 * 60 * 24 * 180 });
  } catch (e) { console.error('KV Fehler:', e.message); }

  // Linda4 Entwurf generieren
  let entwurf = '';
  if (apiKey) {
    try {
      const r = await chatCompletion({
        apiKey,
        messages: [
          { role: 'system', content: `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Erstelle einen professionellen Antwort-ENTWURF für einen Sozialrechts-Experten.
Format: Persönliche Anrede (Du-Form), 3-5 Absätze, freundlicher professioneller Ton.
Ende mit [Expertenunterschrift]. Antworte auf Deutsch.` },
          { role: 'user', content: `Thema: ${thema}\nBeschreibung:\n${beschreibung}\nEinschätzung:\n${einschaetzung || 'keine'}` },
        ],
        maxTokens: 600, temperature: 0.2,
      });
      entwurf = r.ok ? r.content : '';
    } catch (e) { console.error('Entwurf fehlgeschlagen:', e.message); }
  }

  if (entwurf) {
    try {
      fallDaten.linda4Entwurf = entwurf;
      await kv.set(`fall:${id}`, JSON.stringify(fallDaten), { ex: 60 * 60 * 24 * 180 });
    } catch (e) { console.warn('KV Entwurf-Update fehlgeschlagen:', e.message); }
  }

  const portalLink = `${BASE_URL}/portal.html?id=${id}`;
  const adminLink  = `${BASE_URL}/admin.html?id=${id}&token=${ADMIN_TOKEN}`;

  const expertHtml = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:28px 36px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Neue Anfrage – Sozialrecht</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts} · Fall-ID: ${id.slice(0,8)}</p>
    </div>
    <div style="background:#fff;padding:28px 36px;border:1px solid #e2e8f0;border-top:none;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:14px;">
        <tr><td style="color:#64748b;width:130px;padding:5px 0;">Name:</td><td style="font-weight:600;">${vorname} ${nachname}</td></tr>
        <tr><td style="color:#64748b;padding:5px 0;">E-Mail:</td><td><a href="mailto:${email}" style="color:#2563eb;">${email}</a></td></tr>
        <tr><td style="color:#64748b;padding:5px 0;">Thema:</td><td><span style="background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;padding:2px 10px;">${thema}</span></td></tr>
      </table>
      <h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Fallbeschreibung</h3>
      <div style="background:#f8fafc;border-left:3px solid #2563eb;padding:14px 18px;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;margin-bottom:22px;">${beschreibung}</div>
      ${einschaetzung ? `<h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Linda4 Einschätzung</h3>
      <div style="background:#eff6ff;border-left:3px solid #0ea5e9;padding:14px 18px;font-size:14px;color:#1e3a8a;line-height:1.7;margin-bottom:22px;">${einschaetzung}</div>` : ''}
      ${entwurf ? `<h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Linda4 Entwurf</h3>
      <div style="background:#fefce8;border-left:3px solid #eab308;padding:14px 18px;font-size:14px;color:#713f12;line-height:1.7;white-space:pre-wrap;margin-bottom:22px;">${entwurf}</div>` : ''}
      <div style="background:#002A5C;padding:16px 20px;text-align:center;margin-top:8px;">
        <a href="${adminLink}" style="color:#fff;font-weight:700;font-size:14px;text-decoration:none;">→ Antwort bearbeiten &amp; absenden</a>
      </div>
    </div>
  </div>`;

  const userHtml = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:28px 36px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Deine Anfrage ist eingegangen ✓</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts}</p>
    </div>
    <div style="background:#fff;padding:28px 36px;border:1px solid #e2e8f0;border-top:none;">
      <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Hallo ${vorname},</p>
      <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 22px;">deine Anfrage zum Thema <strong>${thema}</strong> wurde erfolgreich übermittelt.</p>
      <div style="background:#002A5C;padding:16px 20px;text-align:center;margin-bottom:22px;">
        <p style="color:#bfdbfe;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em;">Dein persönliches Fall-Portal</p>
        <a href="${portalLink}" style="color:#fff;font-weight:700;font-size:15px;text-decoration:none;">→ Zum Portal</a>
      </div>
    </div>
  </div>`;

  const sendMail = (to, subject, html, replyTo) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Sozialrecht Fachberatung <anfrage@resend.dev>',
        to: [to], subject, html, reply_to: replyTo,
        ...(to === 'noormann@gmx.com' && attachment
          ? { attachments: [{ filename: attachmentName, content: attachment, type: attachmentType }] }
          : {}),
      }),
    });

  const [r1, r2] = await Promise.all([
    sendMail('noormann@gmx.com', `[${thema}] ${vorname} ${nachname} – Neue Anfrage`, expertHtml, email),
    sendMail(email, `Deine Anfrage ist eingegangen – ${thema}`, userHtml, 'noormann@gmx.com'),
  ]);

  if (!r1.ok) {
    console.error('Resend expert error:', await r1.text());
    return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
  }
  if (!r2.ok) console.warn('User-Bestätigung fehlgeschlagen:', await r2.text());

  return res.status(200).json({ ok: true, portalLink });
}

// ── 3. PORTAL (Fall abrufen) ─────────────────────────────────────────────────
async function handlePortal(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, token } = req.query;
  if (!id) return res.status(400).json({ error: 'Keine ID angegeben' });

  try {
    const raw = await kv.get(`fall:${id}`);
    if (!raw) return res.status(404).json({ error: 'Fall nicht gefunden' });
    const fall = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const isAdmin = token && token === ADMIN_TOKEN;

    return res.status(200).json({
      id: fall.id, created: fall.created,
      vorname: fall.vorname, nachname: fall.nachname,
      thema: fall.thema, fachbereich: fall.fachbereich,
      beschreibung: fall.beschreibung, einschaetzung: fall.einschaetzung,
      status: fall.status, antwort: fall.antwort, antwortDatum: fall.antwortDatum,
      nachfragen: Array.isArray(fall.nachfragen) ? fall.nachfragen : [],
      ...(isAdmin ? { email: fall.email, linda4Entwurf: fall.linda4Entwurf } : {}),
    });
  } catch (e) {
    console.error('KV Fehler:', e.message);
    return res.status(500).json({ error: 'Fehler beim Laden' });
  }
}

// ── 4. ANTWORT (Experte antwortet) ───────────────────────────────────────────
async function handleAntwort(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, token, antwort } = req.body;
  if (!id || !antwort) return res.status(400).json({ error: 'Fehlende Felder' });
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Nicht autorisiert' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'E-Mail-Dienst nicht konfiguriert' });

  let fall;
  try {
    const raw = await kv.get(`fall:${id}`);
    if (!raw) return res.status(404).json({ error: 'Fall nicht gefunden' });
    fall = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(500).json({ error: 'Datenbankfehler' });
  }

  fall.antwort = antwort;
  fall.antwortDatum = new Date().toISOString();
  fall.status = 'beantwortet';

  try {
    await kv.set(`fall:${id}`, JSON.stringify(fall), { ex: 60 * 60 * 24 * 180 });
  } catch (e) { console.error('KV Update Fehler:', e.message); }

  const portalLink = `${BASE_URL}/portal.html?id=${id}`;
  const ts = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  const userHtml = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:28px 36px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Du hast eine Antwort erhalten ✓</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts}</p>
    </div>
    <div style="background:#fff;padding:28px 36px;border:1px solid #e2e8f0;border-top:none;">
      <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Hallo ${fall.vorname},</p>
      <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 22px;">Deine Anfrage zum Thema <strong>${fall.thema}</strong> wurde beantwortet.</p>
      <h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Expertenantwort</h3>
      <div style="background:#f8fafc;border-left:3px solid #002A5C;padding:16px 20px;font-size:14px;color:#1e293b;line-height:1.8;margin-bottom:22px;">${antwort}</div>
      <div style="background:#002A5C;padding:16px 20px;text-align:center;">
        <a href="${portalLink}" style="color:#fff;font-weight:700;font-size:15px;text-decoration:none;">→ Zum Fall-Portal</a>
      </div>
    </div>
  </div>`;

  const mailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Sozialrecht Fachberatung <anfrage@resend.dev>',
      to: [fall.email],
      subject: `Antwort auf deine Anfrage – ${fall.thema}`,
      html: userHtml, reply_to: 'noormann@gmx.com',
    }),
  });

  if (!mailRes.ok) console.warn('User-Antwort-Mail fehlgeschlagen:', await mailRes.text());
  return res.status(200).json({ ok: true });
}

// ── 5. NACHFRAGE (User stellt Rückfrage zur Antwort) ─────────────────────────
async function handleNachfrage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, frage } = req.body || {};
  if (!id || !frage || !String(frage).trim()) return res.status(400).json({ error: 'Fehlende Felder' });
  const frageText = String(frage).trim().slice(0, 2000);

  let fall;
  try {
    const raw = await kv.get(`fall:${id}`);
    if (!raw) return res.status(404).json({ error: 'Fall nicht gefunden' });
    fall = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(500).json({ error: 'Datenbankfehler' });
  }

  // Rückfragen sind erst möglich, wenn bereits eine Antwort vorliegt
  if (!fall.antwort) return res.status(409).json({ error: 'Rückfragen sind erst möglich, sobald eine Antwort vorliegt.' });

  if (!Array.isArray(fall.nachfragen)) fall.nachfragen = [];
  if (fall.nachfragen.filter(n => !n.antwort).length >= 5)
    return res.status(429).json({ error: 'Es sind bereits offene Rückfragen vorhanden. Bitte warte auf die Antwort.' });

  fall.nachfragen.push({ frage: frageText, gestelltAm: new Date().toISOString(), antwort: null, beantwortetAm: null });

  try {
    await kv.set(`fall:${id}`, JSON.stringify(fall), { ex: 60 * 60 * 24 * 180 });
  } catch (e) { console.error('KV Update Fehler:', e.message); }

  const adminLink = `${BASE_URL}/admin.html?id=${id}&token=${ADMIN_TOKEN}`;
  const ts = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:19px;">Neue Rückfrage – ${esc(fall.thema)}</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts} · ${esc(fall.vorname)} ${esc(fall.nachname)}</p>
    </div>
    <div style="background:#fff;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;">
      <p style="font-size:14px;color:#374151;margin:0 0 14px;">${esc(fall.vorname)} hat eine Rückfrage zur bereits gesendeten Antwort gestellt:</p>
      <div style="background:#f8fafc;border-left:3px solid #2563eb;padding:14px 18px;font-size:14px;color:#1e293b;line-height:1.7;white-space:pre-wrap;margin-bottom:20px;">${esc(frageText)}</div>
      <div style="background:#002A5C;padding:14px 18px;text-align:center;">
        <a href="${adminLink}" style="color:#fff;font-weight:700;font-size:14px;text-decoration:none;">→ Rückfrage beantworten</a>
      </div>
    </div>
  </div>`;

  try {
    const r = await sendMail({ to: EXPERT_EMAIL, subject: `[Rückfrage] ${fall.thema} – ${fall.vorname} ${fall.nachname}`, html, replyTo: fall.email });
    if (!r.ok) console.warn('Experten-Benachrichtigung fehlgeschlagen:', await r.text());
  } catch (e) { console.warn('Mailversand übersprungen:', e.message); }

  return res.status(200).json({ ok: true, nachfragen: fall.nachfragen });
}

// ── 6. NACHFRAGE-ANTWORT (Experte beantwortet eine Rückfrage) ────────────────
async function handleNachfrageAntwort(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, token, index, antwort } = req.body || {};
  if (!id || antwort == null || index == null) return res.status(400).json({ error: 'Fehlende Felder' });
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Nicht autorisiert' });
  const antwortText = String(antwort).trim();
  if (!antwortText) return res.status(400).json({ error: 'Antwort ist leer' });

  let fall;
  try {
    const raw = await kv.get(`fall:${id}`);
    if (!raw) return res.status(404).json({ error: 'Fall nicht gefunden' });
    fall = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(500).json({ error: 'Datenbankfehler' });
  }

  const i = Number(index);
  if (!Array.isArray(fall.nachfragen) || !fall.nachfragen[i])
    return res.status(404).json({ error: 'Rückfrage nicht gefunden' });

  fall.nachfragen[i].antwort = antwortText;
  fall.nachfragen[i].beantwortetAm = new Date().toISOString();

  try {
    await kv.set(`fall:${id}`, JSON.stringify(fall), { ex: 60 * 60 * 24 * 180 });
  } catch (e) { console.error('KV Update Fehler:', e.message); }

  const portalLink = `${BASE_URL}/portal.html?id=${id}`;
  const ts = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:19px;">Antwort auf deine Rückfrage ✓</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts}</p>
    </div>
    <div style="background:#fff;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;">
      <p style="font-size:15px;color:#1e293b;margin:0 0 14px;">Hallo ${esc(fall.vorname)},</p>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.7;">deine Rückfrage zum Thema <strong>${esc(fall.thema)}</strong> wurde beantwortet:</p>
      <div style="background:#eff6ff;border-left:3px solid #2563eb;padding:12px 16px;font-size:13px;color:#1e3a8a;line-height:1.6;margin-bottom:10px;"><strong>Deine Frage:</strong><br/>${esc(fall.nachfragen[i].frage)}</div>
      <div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:14px 18px;font-size:14px;color:#14532d;line-height:1.8;white-space:pre-wrap;margin-bottom:20px;">${esc(antwortText)}</div>
      <div style="background:#002A5C;padding:14px 18px;text-align:center;">
        <a href="${portalLink}" style="color:#fff;font-weight:700;font-size:14px;text-decoration:none;">→ Zum Fall-Portal</a>
      </div>
    </div>
  </div>`;

  try {
    const r = await sendMail({ to: fall.email, subject: `Antwort auf deine Rückfrage – ${fall.thema}`, html, replyTo: EXPERT_EMAIL });
    if (!r.ok) console.warn('User-Nachfrage-Mail fehlgeschlagen:', await r.text());
  } catch (e) { console.warn('Mailversand übersprungen:', e.message); }

  return res.status(200).json({ ok: true, nachfragen: fall.nachfragen });
}
