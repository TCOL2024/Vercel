function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function isSet(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function getAction(req, body) {
  const fromBody = String(body?.action || '').trim().toLowerCase();
  if (fromBody) return fromBody;
  const q = req.query || {};
  return String(q.action || '').trim().toLowerCase();
}

function getDeepSeekConfig() {
  const v = String(process.env.Linda3Schnellmodus || '').trim();
  let apiKey = '';
  let model = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  if (v.startsWith('sk-')) apiKey = v;
  else if (v) model = v;
  if (!apiKey) apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  return { apiKey, model };
}

async function handleHealth(res) {
  const checks = {
    MAKE_WEBHOOK_URL: isSet('MAKE_WEBHOOK_URL'),
    Linda3Schnellmodus: isSet('Linda3Schnellmodus'),
    DEEPL_API_KEY: isSet('DEEPL_API_KEY'),
    ReWrite: isSet('ReWrite'),
    LernkartenAPI: isSet('LernkartenAPI')
  };
  return sendJson(res, 200, {
    ok: Object.values(checks).every(Boolean),
    checks,
    ts: new Date().toISOString()
  });
}

async function handleBot(res, body) {
  const webhookUrl = String(process.env.MAKE_WEBHOOK_URL || '').trim();
  if (!webhookUrl) return sendJson(res, 500, { error: 'MAKE_WEBHOOK_URL fehlt in Vercel Environment' });

  const question = String(body?.question || body?.prompt || body?.input || body?.text || '').trim();
  if (!question) return sendJson(res, 400, { error: 'question fehlt' });

  const upstream = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, question })
  });
  const raw = await upstream.text();
  if (!upstream.ok) {
    return sendJson(res, 502, { error: 'Make antwortet mit Fehler', status: upstream.status, detail: raw.slice(0, 2000) });
  }
  try {
    return sendJson(res, 200, JSON.parse(raw));
  } catch (_) {
    return sendJson(res, 200, { answer: raw, sources: [] });
  }
}

async function handleDeepseek(res, body) {
  const question = String(body?.question || '').trim();
  if (!question) return sendJson(res, 400, { error: 'question fehlt' });
  const history = Array.isArray(body?.history) ? body.history : [];
  const fachmodus = String(body?.fachmodus || '').trim();

  const { apiKey, model } = getDeepSeekConfig();
  if (!apiKey) return sendJson(res, 500, { error: 'Linda3Schnellmodus fehlt (oder DEEPSEEK_API_KEY)' });

  const messages = [
    { role: 'system', content: 'Du bist Linda Schnellmodus. Antworte klar, strukturiert und fachlich korrekt auf Deutsch.' },
    ...(fachmodus ? [{ role: 'system', content: `Fachmodus: ${fachmodus}` }] : []),
    ...history.slice(-8).filter((m) => m && typeof m.content === 'string' && m.content.trim()),
    { role: 'user', content: question }
  ];

  const ds = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, temperature: 0.2, messages })
  });

  const raw = await ds.text();
  if (!ds.ok) return sendJson(res, ds.status, { error: `DeepSeek HTTP ${ds.status}`, detail: raw.slice(0, 1200) });
  try {
    const parsed = JSON.parse(raw);
    const answer = parsed?.choices?.[0]?.message?.content || parsed?.answer || parsed?.response || raw;
    return sendJson(res, 200, { answer: String(answer || '').trim(), sources: [] });
  } catch (_) {
    return sendJson(res, 200, { answer: raw, sources: [] });
  }
}

async function callDeepL(apiKey, text, targetLang) {
  return fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      auth_key: apiKey,
      text,
      target_lang: targetLang
    }).toString()
  });
}

async function handleTranslate(res, body) {
  const apiKey = String(process.env.DEEPL_API_KEY || '').trim();
  if (!apiKey) return sendJson(res, 500, { error: 'DEEPL_API_KEY fehlt' });
  const text = String(body?.text || '').trim();
  const targetLang = String(body?.target_lang || 'EN').trim().toUpperCase();
  if (!text) return sendJson(res, 400, { error: 'text fehlt' });

  let upstream = await callDeepL(apiKey, text, targetLang);
  if (!upstream.ok && upstream.status !== 456) {
    upstream = await fetch('https://api.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_key: apiKey, text, target_lang: targetLang }).toString()
    });
  }
  const raw = await upstream.text();
  if (!upstream.ok) return sendJson(res, upstream.status, { error: 'DeepL Fehler', detail: raw.slice(0, 1000) });
  const parsed = JSON.parse(raw);
  return sendJson(res, 200, { result: String(parsed?.translations?.[0]?.text || '').trim() });
}

async function handleRewrite(res, body) {
  const rewriteCfg = String(process.env.ReWrite || '').trim();
  if (!rewriteCfg) return sendJson(res, 500, { error: 'ReWrite fehlt in Environment' });
  const text = String(body?.text || '').trim();
  const style = String(body?.style || 'neutral').trim();
  if (!text) return sendJson(res, 400, { error: 'text fehlt' });

  if (/^https?:\/\//i.test(rewriteCfg)) {
    const upstream = await fetch(rewriteCfg, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style })
    });
    const raw = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: 'ReWrite Webhook Fehler', detail: raw.slice(0, 1200) });
    try {
      const parsed = JSON.parse(raw);
      return sendJson(res, 200, { result: String(parsed?.result || parsed?.text || parsed?.answer || raw).trim() });
    } catch (_) {
      return sendJson(res, 200, { result: raw });
    }
  }

  return sendJson(res, 500, { error: 'ReWrite ist nicht als URL konfiguriert' });
}

async function handleFlashcards(res, body) {
  const endpoint = String(process.env.LernkartenAPI || '').trim();
  if (!endpoint) return sendJson(res, 500, { error: 'LernkartenAPI fehlt in Environment' });
  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const raw = await upstream.text();
  if (!upstream.ok) return sendJson(res, upstream.status, { error: 'Lernkarten API Fehler', detail: raw.slice(0, 1500) });
  try {
    return sendJson(res, 200, JSON.parse(raw));
  } catch (_) {
    return sendJson(res, 200, { cards: [], raw });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Nur GET/POST erlaubt' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = getAction(req, body);
  try {
    if (action === 'health' || (req.method === 'GET' && !action)) return handleHealth(res);
    if (action === 'bot') return handleBot(res, body);
    if (action === 'deepseek') return handleDeepseek(res, body);
    if (action === 'translate') return handleTranslate(res, body);
    if (action === 'rewrite') return handleRewrite(res, body);
    if (action === 'flashcards') return handleFlashcards(res, body);
    return sendJson(res, 400, { error: 'Unbekannte action', action });
  } catch (e) {
    return sendJson(res, 500, { error: 'Linda3 API Fehler', detail: String(e?.message || '') });
  }
}

