/**
 * Rewrite API
 * POST /api/rewrite
 * body: { text: string, mode: "easy"|"detailed"|"crisp" }
 * Env: Linda3Schnellmodus or DEEPSEEK_API_KEY
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
    return res.status(500).json({ error: 'Linda3Schnellmodus is missing' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = String(body.text || '').trim();
  const mode = String(body.mode || 'easy').trim().toLowerCase();

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'text must be <= 500 chars' });
  }
  if (!['easy', 'detailed', 'crisp'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be easy, detailed or crisp' });
  }

  const instructionMap = {
    easy: 'Schreibe den Text in einfacher, leicht verständlicher Sprache um. Inhaltstreue beibehalten.',
    detailed: 'Schreibe den Text ausführlicher und präziser um, mit mehr Kontext und klaren Details.',
    crisp: 'Fasse den Text kurz und knackig zusammen. Maximal 3 Sätze.'
  };

  const payload = {
    model: 'deepseek-chat',
    temperature: 0.2,
    max_tokens: 700,
    messages: [
      {
        role: 'system',
        content: 'Du bist ein präziser deutschsprachiger Redakteur. Gib nur den optimierten Text zurück, ohne Einleitung.'
      },
      {
        role: 'user',
        content: `${instructionMap[mode]}\n\nText:\n${text}`
      }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

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
        detail: raw.slice(0, 500)
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return res.status(502).json({ error: 'Invalid DeepSeek response', detail: raw.slice(0, 500) });
    }

    const rewritten = String(
      parsed?.choices?.[0]?.message?.content ||
      parsed?.choices?.[0]?.text ||
      ''
    ).trim();

    if (!rewritten) {
      return res.status(502).json({ error: 'No rewritten text returned' });
    }

    return res.status(200).json({ text: rewritten, mode });
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    return res.status(isAbort ? 504 : 500).json({
      error: isAbort ? 'Rewrite timeout' : 'Rewrite request failed',
      detail: String(err?.message || 'unknown')
    });
  } finally {
    clearTimeout(timeout);
  }
};
