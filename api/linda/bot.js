function readRawBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        const err = new Error('Payload too large');
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = await readRawBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Nur POST erlaubt' });
  }

  const webhookUrl = String(process.env.MAKE_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return sendJson(res, 500, { error: 'MAKE_WEBHOOK_URL fehlt in Vercel Environment' });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: 'Ungültiges JSON', detail: String(e?.message || '') });
  }

  const question = String(
    body?.question || body?.prompt || body?.input || body?.text || ''
  ).trim();
  if (!question) return sendJson(res, 400, { error: 'question fehlt' });

  const payload = { ...body, question };

  try {
    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      return sendJson(res, 502, {
        error: 'Make antwortet mit Fehler',
        status: upstream.status,
        detail: raw.slice(0, 2000)
      });
    }

    try {
      const parsed = JSON.parse(raw);
      return sendJson(res, 200, parsed);
    } catch (_) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(raw);
    }
  } catch (e) {
    return sendJson(res, 500, { error: 'Fehler beim Senden an Make', detail: String(e?.message || '') });
  }
}

