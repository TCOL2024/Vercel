/**
 * Translate API
 * POST /api/translate
 * body: { text: string, targetLang: "EN"|"ES"|"FR"|"TR" }
 * Env: DEEPL_API_KEY (preferred) or DEEPL_KEY
 */
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPL_API_KEY || process.env.DEEPL_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'DEEPL_API_KEY is missing' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = String(body.text || '').trim();
  const targetLang = String(body.targetLang || 'EN').trim().toUpperCase();
  const allowed = new Set(['EN', 'ES', 'FR', 'TR']);

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 250) {
    return res.status(400).json({ error: 'text must be <= 250 chars' });
  }
  if (!allowed.has(targetLang)) {
    return res.status(400).json({ error: 'targetLang must be one of EN, ES, FR, TR' });
  }

  const params = new URLSearchParams();
  params.set('text', text);
  params.set('target_lang', targetLang);

  const endpoint = String(process.env.DEEPL_API_ENDPOINT || 'https://api-free.deepl.com/v2/translate').trim();
  const fallbackEndpoint = endpoint.includes('api-free.deepl.com')
    ? 'https://api.deepl.com/v2/translate'
    : 'https://api-free.deepl.com/v2/translate';

  const doRequest = async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const raw = await response.text();
    return { response, raw };
  };

  try {
    let { response, raw } = await doRequest(endpoint);
    if (!response.ok && response.status === 403) {
      const second = await doRequest(fallbackEndpoint);
      response = second.response;
      raw = second.raw;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: `DeepL API error (${response.status})`,
        detail: raw.slice(0, 500)
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return res.status(502).json({ error: 'Invalid DeepL response', detail: raw.slice(0, 500) });
    }

    const tr = Array.isArray(parsed?.translations) ? parsed.translations[0] : null;
    const translatedText = String(tr?.text || '').trim();
    if (!translatedText) {
      return res.status(502).json({ error: 'DeepL returned empty translation' });
    }

    return res.status(200).json({
      text: translatedText,
      targetLang,
      detectedSourceLang: String(tr?.detected_source_language || '').trim() || undefined
    });
  } catch (err) {
    return res.status(500).json({
      error: 'DeepL request failed',
      detail: String(err?.message || 'unknown')
    });
  }
};
