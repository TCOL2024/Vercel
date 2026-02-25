function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Nur POST erlaubt' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const question = String(body.question || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];
  const fachmodus = String(body.fachmodus || '').trim();
  if (!question) return sendJson(res, 400, { error: 'question fehlt' });

  const { apiKey, model } = getDeepSeekConfig();
  if (!apiKey) {
    return sendJson(res, 500, { error: 'Linda3Schnellmodus fehlt (oder DEEPSEEK_API_KEY)' });
  }

  const messages = [
    {
      role: 'system',
      content: 'Du bist Linda Schnellmodus. Antworte klar, strukturiert und fachlich korrekt auf Deutsch.'
    },
    ...(fachmodus ? [{ role: 'system', content: `Fachmodus: ${fachmodus}` }] : []),
    ...history.slice(-8).filter((m) => m && typeof m.content === 'string' && m.content.trim()),
    { role: 'user', content: question }
  ];

  try {
    const ds = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages
      })
    });

    const raw = await ds.text();
    if (!ds.ok) {
      return sendJson(res, ds.status, { error: `DeepSeek HTTP ${ds.status}`, detail: raw.slice(0, 1200) });
    }

    let answer = raw;
    try {
      const parsed = JSON.parse(raw);
      answer =
        parsed?.choices?.[0]?.message?.content ||
        parsed?.answer ||
        parsed?.response ||
        raw;
    } catch (_) {}

    return sendJson(res, 200, { answer: String(answer || '').trim(), sources: [] });
  } catch (e) {
    return sendJson(res, 500, { error: 'DeepSeek request failed', detail: String(e?.message || '') });
  }
}

