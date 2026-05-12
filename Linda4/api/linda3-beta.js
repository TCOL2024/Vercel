const SOZIALRECHT_VECTOR_STORE = {
  name: 'Sozialrecht2026',
  id: 'vs_69de0362cf84819199202158e8444e16',
  files: {
    sozialrechtQaMarkdown: 'file-SFyyy5nhuvp2UiUieweCwi',
    verhinderungspflege: 'file-2GV2ffyiPT5sN2fXL63SxB',
    angehoerigePflege: 'file-DCji3R9WhwnKEvawfUHwvG',
    krankenPflegeversicherungRentner: 'file-3qYmeg5U4otWjPAzMrP88U'
  }
};

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function cleanText(value = '', max = 6000) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function norm(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[ä]/g, 'ae')
    .replace(/[ö]/g, 'oe')
    .replace(/[ü]/g, 'ue')
    .replace(/[ß]/g, 'ss');
}

function detectPinnedFiles(question = '', context = '') {
  const q = norm(`${question}\n${context}`);
  const files = [SOZIALRECHT_VECTOR_STORE.files.sozialrechtQaMarkdown];
  const add = (id) => { if (id && !files.includes(id)) files.push(id); };
  if (/\b(verhinderungspflege|ersatzpflege|pflegevertretung|39 sgb xi|sgb xi 39)\b/.test(q)) add(SOZIALRECHT_VECTOR_STORE.files.verhinderungspflege);
  if (/\b(angehoerige pflege|angehoerigenpflege|pflegende angehoerige|pflegeperson|pflegepersonen|nicht erwerbsmaessige pflege|soziale sicherung der pflegeperson|rentenversicherung.*pflege)\b/.test(q)) add(SOZIALRECHT_VECTOR_STORE.files.angehoerigePflege);
  if (/\b(kvdr|pvdr|krankenversicherung der rentner|pflegeversicherung der rentner|rentner krankenversicherung|rentenantrag krankenversicherung)\b/.test(q)) add(SOZIALRECHT_VECTOR_STORE.files.krankenPflegeversicherungRentner);
  return files;
}

function stripJson(raw = '') {
  const clean = String(raw || '').replace(/```json/gi, '```').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch (_) {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  return null;
}

function extractResponseText(parsed) {
  if (typeof parsed?.output_text === 'string' && parsed.output_text.trim()) return parsed.output_text.trim();
  const parts = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node.text === 'string' && (node.type === 'output_text' || node.type === 'text')) parts.push(node.text);
    if (typeof node.content === 'string') parts.push(node.content);
    Object.values(node).forEach(walk);
  };
  walk(parsed?.output || parsed);
  return parts.join('\n').trim();
}

function normalizeCardList(items = [], count = 4) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      question: String(item?.question || item?.front || '').replace(/\s+/g, ' ').trim(),
      answer: String(item?.answer || item?.back || '').replace(/\s+/g, ' ').trim()
    }))
    .filter((item) => item.question.length >= 14 && item.answer.length >= 20)
    .filter((item) => {
      if (/^(welche kernaussage|was ist die wichtigste aussage|welcher aspekt)/i.test(item.question)) return false;
      const key = `${item.question}|${item.answer}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
}

function normalizePracticeSet(parsed = {}, count = 6) {
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map((q, idx) => {
      const type = String(q?.type || 'open').toLowerCase() === 'mc' ? 'mc' : 'open';
      const options = (Array.isArray(q?.options) ? q.options : []).map((o) => String(o || '').trim()).filter(Boolean).slice(0, 5);
      const correctIndices = (Array.isArray(q?.correctIndices) ? q.correctIndices : [])
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v < options.length)
        .slice(0, 2);
      if (type === 'mc' && options.length < 3) return null;
      return {
        id: String(q?.id || `beta_p_${idx + 1}`),
        type,
        question: String(q?.question || '').trim(),
        options: type === 'mc' ? options : [],
        correctIndices: type === 'mc' ? correctIndices : [],
        hint: String(q?.hint || '').trim(),
        solution: String(q?.solution || q?.answer || '').trim(),
        points: Math.max(1, Math.min(5, Number(q?.points || 2)))
      };
    })
    .filter((q) => q && q.question.length >= 16 && q.solution.length >= 20)
    .slice(0, count);
  return {
    title: String(parsed.title || 'Sozialrecht Uebungsaufgaben').trim(),
    questions
  };
}

function buildInstructions(kind, body) {
  const count = Math.max(2, Math.min(10, Number(body.count || (kind === 'practice' ? 6 : 4))));
  const difficulty = String(body.difficulty || 'mittel').trim();
  const focus = cleanText(body.focus || body.hint || body.user_hint || '', 700);
  const base = [
    'Du bist Linda, Fachmodus Sozialrecht. Erzeuge Lernmaterial auf pruefungsnaher IHK-/Dozenten-Qualitaet.',
    'Nutze den OpenAI Vector Store Sozialrecht2026 per file_search als fachliche Grundlage.',
    'Wichtig: Erzeuge neue, verstaendliche Lernkarten/Aufgaben aus der Nutzerfrage und dem fachlichen Kontext. Reproduziere keine rohen Textfragmente.',
    'Keine BBiG-/AEVO-/IHK-Ausbildungsrecht-Inhalte, ausser die Nutzerfrage verlangt sie ausdruecklich. Hier ist Sozialrecht fix.',
    focus ? `Zusaetzlicher Nutzerhinweis/Fokus: ${focus}` : '',
    `Niveau: ${difficulty}. Anzahl: ${count}.`
  ].filter(Boolean).join('\n');

  if (kind === 'flashcards') {
    return `${base}\n\nGib ausschliesslich JSON zurueck im Schema: {"deckTitle":"...","cards":[{"question":"konkrete Pruefungsfrage","answer":"praezise Musterantwort mit Norm/Prueffalle wenn passend"}]}. Jede Karte muss ohne Markierungstext verstaendlich sein. Keine generischen Fragen wie 'Was ist die Kernaussage?'.`;
  }

  return `${base}\n\nGib ausschliesslich JSON zurueck im Schema: {"title":"...","questions":[{"type":"open|mc","question":"...","options":["..."],"correctIndices":[0],"hint":"...","solution":"Musterloesung mit Norm/Subsumtion","points":2}]}. Mindestens die Haelfte offene Transfer-/Pruefungsfragen. MC nur, wenn die Antwortoptionen wirklich trennscharf sind.`;
}

function buildInput(kind, body) {
  const question = cleanText(body.origin_question || body.question_text || body.question || '', 900);
  const selected = cleanText(body.selected_text || body.focus_text || '', 1200);
  const context = cleanText(body.context || body.full_text || body.source_text || '', 4500);
  const hint = cleanText(body.hint || body.user_hint || body.focus || '', 700);
  return [
    `Auftrag: ${kind === 'practice' ? 'Erstelle Uebungsaufgaben' : 'Erstelle Lernkarten'}.`,
    question ? `Ausgangsfrage des Users: ${question}` : '',
    selected ? `Markierter Fokusabschnitt (nur als Fokus, nicht roh reproduzieren):\n${selected}` : '',
    context ? `Kontext der bisherigen Antwort/Quelle:\n${context}` : '',
    hint ? `Nutzerhinweis:\n${hint}` : ''
  ].filter(Boolean).join('\n\n');
}

async function callOpenAi(kind, body) {
  const apiKey = String(process.env.Sozialrecht2026 || '').trim();
  if (!apiKey) return { error: 'Sozialrecht2026 fehlt in Vercel Environment' };
  const model = String(process.env.SOZIALRECHT_MODEL || process.env.OPENAI_MODEL_SOZIALRECHT || 'gpt-5.1').trim();
  const input = buildInput(kind, body);
  const pinned = detectPinnedFiles(body.origin_question || body.question_text || body.question || '', input);
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions: buildInstructions(kind, body),
      input,
      tools: [{ type: 'file_search', vector_store_ids: [SOZIALRECHT_VECTOR_STORE.id], max_num_results: 5 }],
      include: ['file_search_call.results'],
      metadata: {
        source: 'linda4-beta-learning-api',
        kind,
        fachmodus: 'SOZIALRECHT',
        vector_store_id: SOZIALRECHT_VECTOR_STORE.id,
        pinned_file_ids: pinned.join(',')
      }
    })
  });
  const raw = await upstream.text();
  if (!upstream.ok) return { error: `OpenAI HTTP ${upstream.status}`, detail: raw.slice(0, 1200) };
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const assistantText = extractResponseText(parsed) || raw;
  const candidate = stripJson(assistantText) || stripJson(raw);
  if (!candidate) return { error: 'OpenAI lieferte kein gueltiges JSON', detail: assistantText.slice(0, 1200) };
  return { parsed: candidate, model, pinned };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Nur POST erlaubt' });
  let body = {};
  try {
    body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
  } catch (_) {
    return sendJson(res, 400, { error: 'Ungueltiger JSON-Body' });
  }

  const action = String(req.query?.action || body.action || '').trim().toLowerCase();
  const kindRaw = String(body.kind || body.mode || action || '').trim().toLowerCase();
  const kind = /practice|exercise|uebung|übung/.test(kindRaw) ? 'practice' : 'flashcards';
  if (!/learning|flashcards|practice|exercise|uebung|übung/.test(`${action} ${kindRaw}`)) {
    return sendJson(res, 400, { error: 'Beta-Learning-API nur fuer strukturierte Lernkarten/Uebungsaufgaben.' });
  }

  const result = await callOpenAi(kind, body);
  if (result.error) return sendJson(res, 502, result);

  if (kind === 'practice') {
    const count = Math.max(3, Math.min(10, Number(body.count || 6)));
    const normalized = normalizePracticeSet(result.parsed, count);
    if (!normalized.questions.length) return sendJson(res, 502, { error: 'Keine brauchbaren Uebungsaufgaben erzeugt' });
    return sendJson(res, 200, {
      ...normalized,
      generatedAt: new Date().toISOString(),
      sourceType: 'beta-learning-api',
      meta: { model: result.model, vector_store_id: SOZIALRECHT_VECTOR_STORE.id, pinned_file_ids: result.pinned }
    });
  }

  const count = Math.max(2, Math.min(4, Number(body.count || 4)));
  const cards = normalizeCardList(result.parsed.cards || result.parsed.items || [], count);
  if (!cards.length) return sendJson(res, 502, { error: 'Keine brauchbaren Lernkarten erzeugt' });
  return sendJson(res, 200, {
    deckTitle: String(result.parsed.deckTitle || result.parsed.title || 'Sozialrecht Lernkarten').trim(),
    cards,
    generatedAt: new Date().toISOString(),
    sourceType: 'beta-learning-api',
    meta: { model: result.model, vector_store_id: SOZIALRECHT_VECTOR_STORE.id, pinned_file_ids: result.pinned }
  });
}
