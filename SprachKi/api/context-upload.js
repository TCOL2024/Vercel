const formidable = require('formidable');
const fs = require('fs/promises');
const path = require('path');

const OPENAI_BASE = 'https://api.openai.com/v1';
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function apiKey() {
  return String(process.env.ASK || process.env.OPENAI_API_KEY || '').trim();
}

function vectorStoreId() {
  return String(process.env.OPENAI_VECTOR_STORE_ID || '').trim();
}

async function openai(pathname, options = {}) {
  const key = apiKey();
  if (!key) throw new Error('ASK bzw. OPENAI_API_KEY fehlt in den Vercel Environment Variables.');
  const response = await fetch(`${OPENAI_BASE}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || `OpenAI HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_FILE_BYTES,
    keepExtensions: true,
    uploadDir: '/tmp'
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const fileValue = files.file;
      const file = Array.isArray(fileValue) ? fileValue[0] : fileValue;
      const get = (key) => {
        const value = fields[key];
        return Array.isArray(value) ? value[0] : value;
      };
      resolve({ file, contextId: get('context_id'), metadata: get('metadata') });
    });
  });
}

async function createFile(file) {
  const buffer = await fs.readFile(file.filepath);
  const form = new FormData();
  const mime = file.mimetype || 'application/octet-stream';
  form.append('file', new Blob([buffer], { type: mime }), file.originalFilename || 'upload');
  form.append('purpose', 'assistants');
  return openai('/files', { method: 'POST', body: form });
}

async function attachToVectorStore(storeId, fileId, attributes) {
  return openai(`/vector_stores/${encodeURIComponent(storeId)}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: fileId,
      attributes
    })
  });
}

async function retrieveVectorFile(storeId, fileId) {
  return openai(`/vector_stores/${encodeURIComponent(storeId)}/files/${encodeURIComponent(fileId)}`);
}

async function waitForCompletion(storeId, fileId) {
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    last = await retrieveVectorFile(storeId, fileId);
    if (last.status === 'completed' || last.status === 'failed' || last.status === 'cancelled') return last;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return last || {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Nur POST erlaubt.' });
  }

  const storeId = vectorStoreId();
  if (!storeId) {
    return json(res, 500, {
      error: 'OPENAI_VECTOR_STORE_ID fehlt. Lege einmal einen OpenAI Vector Store an und hinterlege seine ID als Vercel Environment Variable.'
    });
  }

  let parsed;
  try {
    parsed = await parseMultipart(req);
  } catch (error) {
    return json(res, 400, { error: `Upload konnte nicht gelesen werden: ${error.message}` });
  }

  if (!parsed.file) return json(res, 400, { error: 'FormData-Feld "file" fehlt.' });
  if (Number(parsed.file.size || 0) > MAX_FILE_BYTES) {
    return json(res, 413, { error: 'Datei zu groß. Die Vercel-Funktion ist für Uploads bis ca. 4 MB ausgelegt.' });
  }

  let metadata = {};
  try { metadata = parsed.metadata ? JSON.parse(parsed.metadata) : {}; } catch (_) {}
  const contextId = String(parsed.contextId || metadata.context_id || '').trim();
  if (!contextId) return json(res, 400, { error: 'context_id fehlt.' });

  const originalName = parsed.file.originalFilename || 'upload';
  const mimeType = parsed.file.mimetype || 'application/octet-stream';
  const attributes = {
    context_id: contextId,
    client_file_id: String(metadata.client_file_id || ''),
    source_role: String(metadata.source_role || ''),
    context_name: String(metadata.context_name || '')
  };

  try {
    const uploaded = await createFile(parsed.file);
    const fileId = uploaded.id;
    if (!fileId) throw new Error('OpenAI hat keine file_id zurückgegeben.');

    const attached = await attachToVectorStore(storeId, fileId, attributes);
    const finalStatus = await waitForCompletion(storeId, fileId);

    if (finalStatus.status === 'failed' || finalStatus.status === 'cancelled') {
      return json(res, 502, {
        error: finalStatus.last_error?.message || `Vector-Store-Verarbeitung ${finalStatus.status}.`,
        file_id: fileId,
        name: originalName,
        type: mimeType,
        indexed: false,
        status: finalStatus.status
      });
    }

    return json(res, 200, {
      file_id: fileId,
      name: originalName,
      type: mimeType,
      indexed: finalStatus.status === 'completed',
      status: finalStatus.status || attached.status || 'in_progress',
      vector_store_id: storeId,
      chunks: 0
    });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Upload/Indexierung fehlgeschlagen.' });
  } finally {
    try { await fs.unlink(parsed.file.filepath); } catch (_) {}
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
    responseLimit: '5mb'
  }
};
