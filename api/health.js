function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function isSet(name) {
  return Boolean(String(process.env[name] || '').trim());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Nur GET erlaubt' });
  }

  const checks = {
    MAKE_WEBHOOK_URL: isSet('MAKE_WEBHOOK_URL'),
    Linda3Schnellmodus: isSet('Linda3Schnellmodus'),
    DEEPL_API_KEY: isSet('DEEPL_API_KEY'),
    ReWrite: isSet('ReWrite'),
    LernkartenAPI: isSet('LernkartenAPI')
  };

  const allReady = Object.values(checks).every(Boolean);
  return sendJson(res, 200, {
    ok: allReady,
    checks,
    ts: new Date().toISOString()
  });
}

