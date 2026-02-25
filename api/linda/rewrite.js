function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function mapStyle(style) {
  const s = String(style || '').toLowerCase();
  if (s === 'kurz') return 'Formuliere sehr kurz, klar und auf den Punkt.';
  if (s === 'besser') return 'Formuliere klarer, strukturierter und verständlicher.';
  return 'Formuliere in einfacher, leicht verständlicher Sprache.';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Nur POST erlaubt' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = String(body.text || '').trim();
  const style = String(body.style || 'neutral').trim();
  if (!text) return sendJson(res, 400, { error: 'text fehlt' });

  const rewriteCfg = String(process.env.ReWrite || '').trim();
  if (!rewriteCfg) return sendJson(res, 500, { error: 'ReWrite fehlt in Environment' });

  try {
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
        const result = String(parsed?.result || parsed?.text || parsed?.answer || '').trim();
        return sendJson(res, 200, { result: result || raw });
      } catch (_) {
        return sendJson(res, 200, { result: raw });
      }
    }

    // Fallback: ReWrite as OpenAI API key
    const prompt =
      `${mapStyle(style)}\n\n` +
      `Text:\n${text}`;

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
          { role: 'system', content: 'Du formulierst Texte in gutem, klarem Deutsch um.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const raw = await upstream.text();
    if (!upstream.ok) return sendJson(res, upstream.status, { error: 'ReWrite API Fehler', detail: raw.slice(0, 1200) });
    const parsed = JSON.parse(raw);
    const result = String(parsed?.choices?.[0]?.message?.content || '').trim();
    return sendJson(res, 200, { result });
  } catch (e) {
    return sendJson(res, 500, { error: 'Neuformulierung fehlgeschlagen', detail: String(e?.message || '') });
  }
}

