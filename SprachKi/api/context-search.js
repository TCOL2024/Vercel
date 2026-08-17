const OPENAI_BASE = 'https://api.openai.com/v1';

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function apiKey() {
  return String(process.env.ASK || process.env.OPENAI_API_KEY || '').trim();
}

async function openai(pathname, options = {}) {
  const key = apiKey();
  if (!key) throw new Error('ASK bzw. OPENAI_API_KEY fehlt in den Vercel Environment Variables.');
  const response = await fetch(`${OPENAI_BASE}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || text || `OpenAI HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Nur POST erlaubt.' });
  }

  const storeId = String(process.env.OPENAI_VECTOR_STORE_ID || '').trim();
  if (!storeId) return json(res, 500, { error: 'OPENAI_VECTOR_STORE_ID fehlt in den Vercel Environment Variables.' });

  let body = req.body;
  try { if (!body || typeof body === 'string') body = JSON.parse(body || '{}'); } catch (_) { body = {}; }

  const contextId = String(body.context_id || '').trim();
  const query = String(body.query || '').trim();
  if (!contextId || !query) return json(res, 400, { error: 'context_id und query sind erforderlich.' });

  try {
    const data = await openai(`/vector_stores/${encodeURIComponent(storeId)}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        max_num_results: 12,
        rewrite_query: true,
        filters: {
          type: 'eq',
          key: 'context_id',
          value: contextId
        }
      })
    });

    const rows = Array.isArray(data.data) ? data.data : [];
    const chunks = rows.map((row) => ({
      file_id: row.file_id,
      filename: row.filename,
      score: row.score,
      attributes: row.attributes || {},
      text: Array.isArray(row.content) ? row.content.filter((part) => part && part.type === 'text').map((part) => part.text || '').join('\n') : ''
    })).filter((row) => row.text.trim());

    const relevantContext = chunks.map((row, index) => `Quelle ${index + 1}: ${row.filename || row.file_id || 'Dokument'}\n${row.text}`).join('\n\n').slice(0, 16000);
    const sourceMap = new Map();
    chunks.forEach((row) => {
      const key = row.file_id || row.filename || 'unknown';
      sourceMap.set(key, (sourceMap.get(key) || 0) + 1);
    });

    return json(res, 200, {
      available: chunks.length > 0,
      relevant_context: relevantContext,
      chunks,
      sources: [...sourceMap.entries()].map(([key, hits]) => ({ file_id: key, hits })),
      hit_count: chunks.length,
      has_more: Boolean(data.has_more),
      next_page: data.next_page || null
    });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Retrieval fehlgeschlagen.' });
  }
};
