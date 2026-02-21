/**
 * LINDA3 Flashcards API
 * Endpoint: POST /api/flashcards
 * Env: LernkartenAPI (OpenAI API key)
 */
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      endpoint: '/api/flashcards',
      keyConfigured: Boolean(process.env.LernkartenAPI),
      model: String(process.env.FLASHCARDS_MODEL || 'gpt-4o-mini').trim()
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.LernkartenAPI;
  if (!apiKey) {
    return res.status(500).json({ error: 'LernkartenAPI is missing' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const title = String(body.title || 'Neues Deck').trim().slice(0, 120);
  const source = String(body.source || '').trim().slice(0, 200);
  const context = String(body.context || '').trim().slice(0, 14000);
  const countRaw = Number(body.count || 12);
  const count = Math.max(4, Math.min(50, Number.isFinite(countRaw) ? Math.round(countRaw) : 12));

  const model = String(process.env.FLASHCARDS_MODEL || 'gpt-4o-mini').trim();

  const systemPrompt =
    'Du erzeugst hochwertige Lernkarten auf Deutsch. ' +
    'Antworte nur als valides JSON ohne Markdown. ' +
    'Format: {"cards":[{"front":"...","back":"...","source":"..."}]}';

  const userPrompt = [
    `Deck-Titel: ${title}`,
    `Quelle/Thema: ${source || 'nicht angegeben'}`,
    `Anzahl Karten: ${count}`,
    'Regeln:',
    '- front: kurze, präzise Frage',
    '- back: fachlich korrekte, kompakte Antwort',
    '- source: kurze Quellenangabe/Topic',
    '- keine doppelten Karten',
    '- keine Einleitung, kein Fließtext außerhalb von JSON',
    context ? `Kontext:\n${context}` : 'Kontext: nicht bereitgestellt'
  ].join('\n');

  const payload = {
    model,
    temperature: 0.3,
    max_tokens: 2200,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'flashcards_payload',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cards: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  front: { type: 'string' },
                  back: { type: 'string' },
                  source: { type: 'string' }
                },
                required: ['front', 'back', 'source']
              }
            }
          },
          required: ['cards']
        }
      }
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
        error: `OpenAI API error (${response.status})`,
        detail: raw.slice(0, 600)
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return res.status(502).json({ error: 'Invalid OpenAI response', detail: raw.slice(0, 600) });
    }

    const content =
      String(parsed?.choices?.[0]?.message?.content || parsed?.choices?.[0]?.text || '').trim();
    if (!content) {
      return res.status(502).json({ error: 'OpenAI returned empty content' });
    }

    const extractJson = (txt) => {
      const fenced = txt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenced && fenced[1]) return fenced[1].trim();
      const first = txt.indexOf('{');
      const last = txt.lastIndexOf('}');
      if (first >= 0 && last > first) return txt.slice(first, last + 1);
      return txt;
    };

    let cardsObj;
    try {
      cardsObj = JSON.parse(extractJson(content));
    } catch (_) {
      return res.status(502).json({ error: 'Could not parse cards JSON', detail: content.slice(0, 600) });
    }

    const cards = (Array.isArray(cardsObj?.cards) ? cardsObj.cards : [])
      .map((c) => ({
        id: String(c?.id || '').trim() || undefined,
        front: String(c?.front || c?.question || '').trim(),
        back: String(c?.back || c?.answer || '').trim(),
        source: String(c?.source || source || title).trim().slice(0, 200),
        fsrs: {
          dueAt: 0,
          stability: 0.2,
          difficulty: 0.5,
          reps: 0,
          lapses: 0,
          lastRating: null
        }
      }))
      .filter((c) => c.front && c.back)
      .slice(0, count);

    if (!cards.length) {
      return res.status(502).json({ error: 'No valid cards generated' });
    }

    return res.status(200).json({ cards });
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    return res.status(isAbort ? 504 : 500).json({
      error: isAbort ? 'Flashcards generation timeout' : 'Flashcards generation failed',
      detail: String(err?.message || 'unknown')
    });
  } finally {
    clearTimeout(timeout);
  }
};
