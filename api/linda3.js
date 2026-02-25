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

async function callDeepL(endpoint, apiKey, text, targetLang) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `DeepL-Auth-Key ${apiKey}`
    },
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

  const freeEndpoint = 'https://api-free.deepl.com/v2/translate';
  const proEndpoint = 'https://api.deepl.com/v2/translate';
  const prefersFree = apiKey.includes(':fx');
  const primary = prefersFree ? freeEndpoint : proEndpoint;
  const secondary = prefersFree ? proEndpoint : freeEndpoint;

  let upstream = await callDeepL(primary, apiKey, text, targetLang);
  let raw = await upstream.text();

  if (!upstream.ok && upstream.status !== 456) {
    const retry = await callDeepL(secondary, apiKey, text, targetLang);
    const retryRaw = await retry.text();
    if (retry.ok) {
      upstream = retry;
      raw = retryRaw;
    } else {
      upstream = retry;
      raw = retryRaw || raw;
    }
  }

  if (!upstream.ok) {
    let detailText = raw;
    try {
      const parsedErr = JSON.parse(raw);
      detailText = String(parsedErr?.message || parsedErr?.detail || raw);
    } catch (_) {}
    return sendJson(res, upstream.status, {
      error: `DeepL Fehler (${upstream.status}): ${detailText.slice(0, 300)}`
    });
  }

  const parsed = JSON.parse(raw);
  return sendJson(res, 200, { result: String(parsed?.translations?.[0]?.text || '').trim() });
}

async function handleRewrite(res, body) {
  const rewriteCfg = String(process.env.ReWrite || '').trim();
  if (!rewriteCfg) return sendJson(res, 500, { error: 'ReWrite fehlt in Environment' });
  const text = String(body?.text || '').trim();
  const style = String(body?.style || 'neutral').trim();
  if (!text) return sendJson(res, 400, { error: 'text fehlt' });

  const stylePrompt = (() => {
    const s = style.toLowerCase();
    if (s === 'kurz') return 'Formuliere den Text kuerzer und praeziser.';
    if (s === 'besser') return 'Formuliere den Text sprachlich besser und strukturierter.';
    return 'Formuliere den Text in einfacher, gut verstaendlicher Sprache.';
  })();

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

  // ReWrite as OpenAI API key
  if (/^sk-/i.test(rewriteCfg)) {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rewriteCfg}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Du formulierst Texte in klarem, natuerlichem Deutsch um.' },
          { role: 'user', content: `${stylePrompt}\n\nText:\n${text}` }
        ]
      })
    });
    const raw = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: 'ReWrite API Fehler', detail: raw.slice(0, 1200) });
    try {
      const parsed = JSON.parse(raw);
      const result = String(parsed?.choices?.[0]?.message?.content || '').trim();
      return sendJson(res, 200, { result });
    } catch (_) {
      return sendJson(res, 200, { result: raw });
    }
  }

  // ReWrite as DeepSeek model name (key from Linda3Schnellmodus / DEEPSEEK_API_KEY)
  const ds = getDeepSeekConfig();
  if (!ds.apiKey) {
    return sendJson(res, 500, {
      error: 'ReWrite ist weder URL noch API-Key; fuer Modellmodus wird Linda3Schnellmodus (oder DEEPSEEK_API_KEY) benoetigt'
    });
  }

  const dsModel = rewriteCfg || ds.model || 'deepseek-chat';
  const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ds.apiKey}`
    },
    body: JSON.stringify({
      model: dsModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Du formulierst Texte in klarem, natuerlichem Deutsch um.' },
        { role: 'user', content: `${stylePrompt}\n\nText:\n${text}` }
      ]
    })
  });
  const raw = await upstream.text();
  if (!upstream.ok) return sendJson(res, upstream.status, { error: 'ReWrite DeepSeek Fehler', detail: raw.slice(0, 1200) });
  try {
    const parsed = JSON.parse(raw);
    const result = String(parsed?.choices?.[0]?.message?.content || parsed?.answer || parsed?.response || '').trim();
    return sendJson(res, 200, { result: result || raw });
  } catch (_) {
    return sendJson(res, 200, { result: raw });
  }
}

async function handleFlashcards(res, body) {
  const buildFallbackCards = (text, count = 8) => {
    const clean = String(text || '')
      .replace(/\r/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return [];

    const sentences = clean
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25)
      .slice(0, 24);

    const cards = [];
    const used = new Set();
    for (const s of sentences) {
      const q = 'Erklaere den folgenden Zusammenhang:';
      const a = s;
      const key = `${q}|${a}`.toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      cards.push({ question: q, answer: a });
      if (cards.length >= count) break;
    }
    return cards;
  };

  const contextText = String(body?.context || body?.text || '').trim();
  const wanted = Math.max(4, Math.min(20, Number(body?.count || 8)));
  const endpoint = String(process.env.LernkartenAPI || '').trim();
  if (!endpoint) {
    const fallback = buildFallbackCards(contextText, wanted);
    if (fallback.length) return sendJson(res, 200, { cards: fallback, sourceType: 'local-fallback-no-env' });
    return sendJson(res, 500, { error: 'LernkartenAPI fehlt in Environment' });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const raw = await upstream.text();

    if (!upstream.ok) {
      const fallback = buildFallbackCards(contextText, wanted);
      if (fallback.length) return sendJson(res, 200, { cards: fallback, sourceType: 'local-fallback-upstream-error' });
      return sendJson(res, upstream.status, { error: 'Lernkarten API Fehler', detail: raw.slice(0, 1500) });
    }

    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed?.cards) ? parsed.cards : [];
      if (arr.length) return sendJson(res, 200, parsed);
      const fallback = buildFallbackCards(contextText, wanted);
      if (fallback.length) return sendJson(res, 200, { cards: fallback, sourceType: 'local-fallback-empty' });
      return sendJson(res, 200, { cards: [], raw });
    } catch (_) {
      const fallback = buildFallbackCards(contextText, wanted);
      if (fallback.length) return sendJson(res, 200, { cards: fallback, sourceType: 'local-fallback-invalid-json' });
      return sendJson(res, 200, { cards: [], raw });
    }
  } catch (e) {
    const fallback = buildFallbackCards(contextText, wanted);
    if (fallback.length) return sendJson(res, 200, { cards: fallback, sourceType: 'local-fallback-exception' });
    return sendJson(res, 500, { error: 'Lernkarten request failed', detail: String(e?.message || '') });
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
