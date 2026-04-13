function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

async function callDeepL(endpoint, apiKey, text, targetLang) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      auth_key: apiKey,
      text,
      target_lang: targetLang
    }).toString()
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Nur POST erlaubt' });
  }

  const apiKey = String(process.env.DEEPL_API_KEY || '').trim();
  if (!apiKey) return sendJson(res, 500, { error: 'DEEPL_API_KEY fehlt' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = String(body.text || '').trim();
  const targetLang = String(body.target_lang || 'EN').trim().toUpperCase();
  if (!text) return sendJson(res, 400, { error: 'text fehlt' });

  try {
    let upstream = await callDeepL('https://api-free.deepl.com/v2/translate', apiKey, text, targetLang);
    if (!upstream.ok && upstream.status !== 456) {
      // fallback for Pro accounts hosted on api.deepl.com
      upstream = await callDeepL('https://api.deepl.com/v2/translate', apiKey, text, targetLang);
    }

    const raw = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: 'DeepL Fehler', detail: raw.slice(0, 1000) });

    const parsed = JSON.parse(raw);
    const translated = parsed?.translations?.[0]?.text || '';
    return sendJson(res, 200, { result: String(translated).trim() });
  } catch (e) {
    return sendJson(res, 500, { error: 'Übersetzung fehlgeschlagen', detail: String(e?.message || '') });
  }
}

