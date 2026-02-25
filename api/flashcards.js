function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Nur POST erlaubt' });
  }

  const endpoint = String(process.env.LernkartenAPI || '').trim();
  if (!endpoint) return sendJson(res, 500, { error: 'LernkartenAPI fehlt in Environment' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      return sendJson(res, upstream.status, {
        error: 'Lernkarten API Fehler',
        detail: raw.slice(0, 1500)
      });
    }

    try {
      const parsed = JSON.parse(raw);
      return sendJson(res, 200, parsed);
    } catch (_) {
      return sendJson(res, 200, { cards: [], raw });
    }
  } catch (e) {
    return sendJson(res, 500, { error: 'Lernkarten request failed', detail: String(e?.message || '') });
  }
}

