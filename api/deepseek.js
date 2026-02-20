/**
 * Serverless API route for LINDA compare mode.
 * Expects POST JSON:
 * {
 *   question: string,
 *   history?: [{ role: "user"|"assistant"|"system", content: string }],
 *   routing?: { preferred_model?: string }
 * }
 *
 * Returns JSON:
 * { answer: string, sources: [] }
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

  const apiKey = process.env.Linda3Schnellmodus || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Linda3Schnellmodus is missing'
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const question = String(body.question || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];
  const fachmodus = String(body.fachmodus || '').trim();
  const preferred = String(body?.routing?.preferred_model || '').toLowerCase();
  const model = preferred.includes('reason') ? 'deepseek-reasoner' : 'deepseek-chat';

  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  const mappedHistory = history
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      role: ['system', 'assistant', 'user'].includes(m.role) ? m.role : 'user',
      content: String(m.content || '').slice(0, 4000)
    }))
    .filter((m) => m.content);

  const payload = {
    model,
    temperature: 0.2,
    max_tokens: 1400,
    messages: [
      {
        role: 'system',
        content:
          'Du bist LINDA Schnellmodus. Prüfe die Anfrage sehr genau, beantworte nur auf Basis der Anfrage und des Kontexts, und markiere Unsicherheiten klar. Antworte auf Deutsch, klar, strukturiert und fachlich korrekt.'
      },
      ...(fachmodus ? [{ role: 'system', content: `Fachmodus: ${fachmodus}` }] : []),
      ...mappedHistory.slice(-8),
      { role: 'user', content: question }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        error: `DeepSeek API error (${response.status})`,
        detail: raw.slice(0, 600)
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return res.status(502).json({ error: 'Invalid DeepSeek response', detail: raw.slice(0, 600) });
    }

    const answer =
      parsed?.choices?.[0]?.message?.content ||
      parsed?.choices?.[0]?.text ||
      '';

    return res.status(200).json({
      answer: String(answer || '').trim() || 'Keine Antwort von DeepSeek erhalten.',
      sources: []
    });
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    return res.status(isAbort ? 504 : 500).json({
      error: isAbort ? 'DeepSeek timeout' : 'DeepSeek request failed',
      detail: String(err?.message || 'unknown')
    });
  } finally {
    clearTimeout(timeout);
  }
};
