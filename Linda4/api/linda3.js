const fs = require('fs');
const path = require('path');

const LEGACY_ORIGIN = process.env.LINDA3_LEGACY_API_ORIGIN || 'https://vercel-kappa-seven-33.vercel.app';
const SOCIALRECHT_CONFIG_PATH = path.join(process.cwd(), 'docs', 'sozialrecht_runtime.json');

const DEFAULT_SOCIALRECHT_CONFIG = {
  version: '1.0',
  domain: 'SOZIALRECHT',
  routing: {
    default_model: 'gpt-4.1',
    fast_model: 'gpt-4.1-mini',
    temperature: 0.1,
    max_output_tokens: 1200
  },
  accuracy_policy: {
    high_accuracy_required: true,
    prefer_clarification_over_guessing: true,
    strict_unknown_on_missing_basis: true,
    require_legal_basis_references: true
  },
  clarification_policy: {
    enabled: true,
    min_question_chars: 18,
    max_tokens_without_context: 5,
    ambiguous_patterns: ['ist das richtig', 'stimmt das', 'wie ist das', 'geht das', 'was meinst du'],
    default_followups: [
      'Auf welches SGB-Buch (I bis XII) bezieht sich deine Frage?',
      'Geht es um einen konkreten Personalfall oder um Pruefungstheorie?',
      'Soll ich die Antwort als Kurzschema, Praxisfall oder Lernkarte aufbauen?'
    ]
  },
  storage: {
    vector_store_env_key: 'OPENAI_VECTOR_STORE_ID_SOZIALRECHT',
    enabled_when_env_present: true
  }
};

function clamp01(value, fallback = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function parseJsonSafe(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readRequestBodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return parseJsonSafe(req.body.toString('utf8'), {});
  if (typeof req.body === 'string') return parseJsonSafe(req.body, {});
  return {};
}

function readRequestBodyRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

function getAction(req) {
  if (req?.query?.action) return String(req.query.action).toLowerCase();
  try {
    const u = new URL(req.url || '', 'http://localhost');
    return String(u.searchParams.get('action') || 'bot').toLowerCase();
  } catch (_) {
    return 'bot';
  }
}

function loadSozialrechtConfig() {
  try {
    const raw = fs.readFileSync(SOCIALRECHT_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SOCIALRECHT_CONFIG };
    return {
      ...DEFAULT_SOCIALRECHT_CONFIG,
      ...parsed,
      routing: {
        ...DEFAULT_SOCIALRECHT_CONFIG.routing,
        ...(parsed.routing || {})
      },
      accuracy_policy: {
        ...DEFAULT_SOCIALRECHT_CONFIG.accuracy_policy,
        ...(parsed.accuracy_policy || {})
      },
      clarification_policy: {
        ...DEFAULT_SOCIALRECHT_CONFIG.clarification_policy,
        ...(parsed.clarification_policy || {})
      },
      storage: {
        ...DEFAULT_SOCIALRECHT_CONFIG.storage,
        ...(parsed.storage || {})
      }
    };
  } catch (_) {
    return { ...DEFAULT_SOCIALRECHT_CONFIG };
  }
}

function sanitizeHistory(history, limit = 6) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const roleRaw = String(entry.role || '').toLowerCase();
      const role = roleRaw === 'assistant' ? 'assistant' : 'user';
      const content = normalizeText(entry.content || '');
      if (!content) return null;
      return { role, content: content.slice(0, 1400) };
    })
    .filter(Boolean)
    .slice(-limit);
}

function hasMeaningfulContext(history) {
  return sanitizeHistory(history, 2).length > 0;
}

function shouldClarifyQuestion(question, history, cfg) {
  const policy = cfg?.clarification_policy || {};
  if (!policy.enabled) return false;
  const text = normalizeText(question);
  if (!text) return true;
  if (text.length < Number(policy.min_question_chars || 18)) return true;

  const tokens = text.split(/\s+/).filter(Boolean);
  const maxTokens = Number(policy.max_tokens_without_context || 5);
  if (tokens.length <= maxTokens && !hasMeaningfulContext(history)) return true;

  const low = text.toLowerCase();
  const patterns = Array.isArray(policy.ambiguous_patterns) ? policy.ambiguous_patterns : [];
  return patterns.some((p) => {
    const needle = normalizeText(p).toLowerCase();
    return needle && low.includes(needle);
  });
}

function buildClarificationPayload(cfg) {
  const followups = Array.isArray(cfg?.clarification_policy?.default_followups)
    ? cfg.clarification_policy.default_followups.map((item) => normalizeText(item)).filter(Boolean).slice(0, 4)
    : [];
  return {
    answer:
      'Damit ich im Fachmodus Sozialrecht praezise antworte, brauche ich noch etwas Kontext. ' +
      'Bitte konkretisiere kurz, damit ich sauber eingrenzen kann.',
    followups,
    sources: [],
    confidence: 0.2,
    evidence_note: 'Rueckfrage gestellt, um Fehlinterpretationen zu vermeiden.',
    meta: {
      clarification_requested: true,
      domain: 'SOZIALRECHT'
    }
  };
}

function normalizeSources(rawSources) {
  return (Array.isArray(rawSources) ? rawSources : [])
    .map((item) => {
      if (typeof item === 'string') {
        const title = normalizeText(item);
        if (!title) return null;
        return { title, url: '', excerpt: '', section: '', page: '', note: '', confidence: null };
      }
      if (!item || typeof item !== 'object') return null;
      const title = normalizeText(item.title || item.name || item.label || item.url || 'Quelle');
      const url = normalizeText(item.url || item.link || '');
      const excerpt = normalizeText(item.excerpt || item.quote || item.snippet || item.chunk || '');
      const section = normalizeText(item.section || item.heading || item.chapter || '');
      const page = normalizeText(item.page || item.pageNumber || item.seite || '');
      const note = normalizeText(item.note || item.reason || item.description || '');
      const confidence = clamp01(item.confidence, null);
      if (!title && !url && !excerpt) return null;
      return { title: title || url || 'Quelle', url, excerpt, section, page, note, confidence };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeModelPayload(rawText, cfg) {
  const fallbackFollowups = Array.isArray(cfg?.clarification_policy?.default_followups)
    ? cfg.clarification_policy.default_followups.slice(0, 3)
    : [];
  const parsed = parseJsonSafe(rawText, null);
  if (!parsed || typeof parsed !== 'object') {
    return {
      answer: normalizeText(rawText) || 'Ich weiss es nicht sicher.',
      followups: fallbackFollowups,
      sources: [],
      confidence: null,
      evidence_note: ''
    };
  }
  const followups = (Array.isArray(parsed.followups) ? parsed.followups : [])
    .map((q) => normalizeText(q))
    .filter(Boolean)
    .slice(0, 4);
  return {
    answer: normalizeText(parsed.answer || parsed.response || parsed.text || '') || 'Ich weiss es nicht sicher.',
    followups: followups.length ? followups : fallbackFollowups,
    sources: normalizeSources(parsed.sources || parsed.quellen || parsed.references || []),
    confidence: clamp01(parsed.confidence, null),
    evidence_note: normalizeText(parsed.evidence_note || parsed.reasoning_note || '')
  };
}

function buildSozialrechtSystemPrompt(cfg, hasStorage) {
  const policy = cfg?.accuracy_policy || {};
  return [
    'Du bist LINDA im Fachmodus Sozialrecht fuer angehende Personalfachkaufleute (IHK).',
    'Arbeite strikt fachlich, knapp, nachvollziehbar und ohne Spekulation.',
    policy.high_accuracy_required ? 'Hohe Genauigkeit ist Pflicht.' : '',
    policy.prefer_clarification_over_guessing ? 'Wenn Informationen fehlen oder unklar sind: erst Rueckfrage, keine Vermutung.' : '',
    policy.strict_unknown_on_missing_basis ? 'Wenn keine belastbare Grundlage vorhanden ist: sage klar "Ich weiss es nicht sicher".' : '',
    policy.require_legal_basis_references ? 'Nenne, wenn moeglich, SGB-Buch und Rechtsbezug als Quelle.' : '',
    hasStorage ? 'Wenn Storage-Treffer vorhanden sind, priorisiere diese Evidenz.' : '',
    'Gib ausschliesslich JSON zurueck, ohne Markdown, exakt im Format:',
    '{"answer":"...","followups":["..."],"sources":[{"title":"...","excerpt":"...","section":"...","page":"","note":"","confidence":0.0}],"confidence":0.0,"evidence_note":"..."}'
  ].filter(Boolean).join('\n');
}

function toOpenAIMessages(systemPrompt, history, question) {
  const out = [{ role: 'system', content: systemPrompt }];
  sanitizeHistory(history).forEach((msg) => out.push(msg));
  out.push({ role: 'user', content: normalizeText(question) });
  return out;
}

async function callOpenAIChatCompletions({ apiKey, model, messages, temperature, maxOutputTokens }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxOutputTokens,
      response_format: { type: 'json_object' }
    })
  });
  const raw = await res.text();
  if (!res.ok) {
    const parsed = parseJsonSafe(raw, {});
    const detail = normalizeText(parsed?.error?.message || parsed?.error || raw);
    throw new Error(`OpenAI chat/completions Fehler (${res.status}): ${detail || 'unbekannt'}`);
  }
  const data = parseJsonSafe(raw, {});
  const content = data?.choices?.[0]?.message?.content;
  return normalizeText(content || '');
}

function extractResponsesText(parsed) {
  if (typeof parsed?.output_text === 'string' && parsed.output_text.trim()) return parsed.output_text.trim();
  const output = Array.isArray(parsed?.output) ? parsed.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text.trim();
      if (part?.text && typeof part.text?.value === 'string' && part.text.value.trim()) return part.text.value.trim();
    }
  }
  return '';
}

async function callOpenAIResponsesWithStorage({ apiKey, model, messages, temperature, maxOutputTokens, vectorStoreId }) {
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: 'input_text', text: m.content }]
  }));
  const body = {
    model,
    input,
    temperature,
    max_output_tokens: maxOutputTokens,
    tools: [{ type: 'file_search', vector_store_ids: [vectorStoreId] }]
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    const parsed = parseJsonSafe(raw, {});
    const detail = normalizeText(parsed?.error?.message || parsed?.error || raw);
    throw new Error(`OpenAI responses Fehler (${res.status}): ${detail || 'unbekannt'}`);
  }
  const parsed = parseJsonSafe(raw, {});
  return extractResponsesText(parsed);
}

async function proxyToLegacy(req, res) {
  const reqUrl = new URL(req.url || '/api/linda3', 'http://localhost');
  const upstream = new URL('/api/linda3', LEGACY_ORIGIN);
  reqUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  const headers = {};
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const method = String(req.method || 'GET').toUpperCase();
  const rawBody = readRequestBodyRaw(req);
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && rawBody) init.body = rawBody;

  const upstreamRes = await fetch(upstream.toString(), init);
  const text = await upstreamRes.text();
  res.status(upstreamRes.status);
  res.setHeader('content-type', upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8');
  res.send(text);
}

async function handleHealth(req, res) {
  const cfg = loadSozialrechtConfig();
  const storageEnvKey = String(cfg?.storage?.vector_store_env_key || 'OPENAI_VECTOR_STORE_ID_SOZIALRECHT');
  const checks = {
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    Sozialrecht2026: Boolean(process.env.Sozialrecht2026 || process.env.SOZIALRECHT2026),
    [storageEnvKey]: Boolean(process.env[storageEnvKey]),
    LEGACY_API_ORIGIN: Boolean(LEGACY_ORIGIN)
  };
  res.status(200).json({
    ok: Boolean(checks.Sozialrecht2026 && checks.LEGACY_API_ORIGIN),
    checks,
    baseUrl: '/api/linda3',
    ts: new Date().toISOString(),
    mode: 'sozialrecht-targeted-openai'
  });
}

async function handleSozialrechtChat(req, res, action) {
  const payload = readRequestBodyObject(req);
  const cfg = loadSozialrechtConfig();
  const question = normalizeText(payload.question || payload.prompt || payload.input || payload.text || '');
  if (!question) {
    res.status(400).json({ error: 'question ist erforderlich' });
    return;
  }

  const history = sanitizeHistory(payload.history || []);
  const forceFast = action === 'deepseek';
  const fastMode = forceFast || Boolean(payload.schnellmodus) || String(payload?.routing?.preferred_model || '').toLowerCase() === 'deepseek';
  const model = fastMode
    ? String(cfg?.routing?.fast_model || DEFAULT_SOCIALRECHT_CONFIG.routing.fast_model)
    : String(cfg?.routing?.default_model || DEFAULT_SOCIALRECHT_CONFIG.routing.default_model);

  const socialKey = process.env.Sozialrecht2026 || process.env.SOZIALRECHT2026;
  if (!socialKey) {
    res.status(500).json({
      error: 'Sozialrecht API-Key fehlt. Bitte Vercel-Variable "Sozialrecht2026" (oder SOZIALRECHT2026) setzen.'
    });
    return;
  }

  if (shouldClarifyQuestion(question, history, cfg)) {
    res.status(200).json(buildClarificationPayload(cfg));
    return;
  }

  const storageEnvKey = String(cfg?.storage?.vector_store_env_key || 'OPENAI_VECTOR_STORE_ID_SOZIALRECHT');
  const vectorStoreId = normalizeText(process.env[storageEnvKey] || '');
  const useStorage = Boolean(vectorStoreId && cfg?.storage?.enabled_when_env_present !== false);
  const temperature = Number.isFinite(Number(cfg?.routing?.temperature))
    ? Number(cfg.routing.temperature)
    : DEFAULT_SOCIALRECHT_CONFIG.routing.temperature;
  const maxOutputTokens = Number.isFinite(Number(cfg?.routing?.max_output_tokens))
    ? Number(cfg.routing.max_output_tokens)
    : DEFAULT_SOCIALRECHT_CONFIG.routing.max_output_tokens;

  const systemPrompt = buildSozialrechtSystemPrompt(cfg, useStorage);
  const messages = toOpenAIMessages(systemPrompt, history, question);

  try {
    const modelRaw = useStorage
      ? await callOpenAIResponsesWithStorage({
          apiKey: socialKey,
          model,
          messages,
          temperature,
          maxOutputTokens,
          vectorStoreId
        })
      : await callOpenAIChatCompletions({
          apiKey: socialKey,
          model,
          messages,
          temperature,
          maxOutputTokens
        });

    const normalized = normalizeModelPayload(modelRaw, cfg);
    res.status(200).json({
      answer: normalized.answer,
      followups: normalized.followups,
      sources: normalized.sources,
      confidence: normalized.confidence,
      evidence_note: normalized.evidence_note,
      meta: {
        domain: 'SOZIALRECHT',
        model,
        fast_mode: fastMode,
        storage_used: useStorage
      }
    });
  } catch (err) {
    res.status(500).json({
      error: 'Sozialrecht-Antwort fehlgeschlagen',
      detail: normalizeText(err?.message || 'unbekannt')
    });
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const action = getAction(req);
  if (action === 'health') {
    await handleHealth(req, res);
    return;
  }

  const payload = readRequestBodyObject(req);
  const domain = String(payload?.fachmodus || '').trim().toUpperCase();
  const sozialrecht = domain === 'SOZIALRECHT';

  if (sozialrecht && (action === 'bot' || action === 'deepseek')) {
    await handleSozialrechtChat(req, res, action);
    return;
  }

  await proxyToLegacy(req, res);
};
