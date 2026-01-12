// /api/linda-proxy.js  (Vercel: req,res) — hardened

const MAX_TEXT_LEN = 8000;
const MAX_HISTORY_MESSAGES = 6; // 3 Turns
const BLOCK_MESSAGE =
  "Dabei kann ich nicht helfen. Ich beantworte ausschließlich fachliche Fragen (z. B. Ausbildung/AEVO, Prüfungen, Personalmanagement).";

/* =========================
   ORIGIN WHITELIST (CORS)
   - set your allowed origins here
========================= */
const ALLOWED_ORIGINS = new Set([
  "https://ntc-bot1.netlify.app",
  "https://main--ntc-bot1.netlify.app",
  // TODO: ergänze deine echte Vercel-Domain(s)
  // "https://dein-projekt.vercel.app",
  // "https://deine-custom-domain.de"
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";

  // If no Origin header (e.g. curl/server-to-server), don't set CORS headers.
  if (!origin) return;

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  // If not allowed: set no CORS headers => browser blocks.
}

/* =========================
   CANONICALIZE (anti obfuscation)
========================= */
function canonicalize(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\uFEFF]/g, "") // zero-width
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
   AEVO / AUSBILDUNG TAGGING
========================= */
const AEVO_PATTERNS = [
  /\baevo\b/i,
  /\bbbig\b/i,
  /\bausbild\w*/i,
  /\bazubi\w*/i,
  /\bauszubild\w*/i,
  /\bberufsausbild\w*/i,
  /\bunterweis\w*/i,
  /\brahmenplan\w*/i,
  /\bausbildungsnachweis\w*/i,
  /\babschlussprüfung\b/i,
  /\bihk\b/i
];

function detectTags(question) {
  const q = String(question || "");
  let score = 0;
  for (const rx of AEVO_PATTERNS) {
    if (rx.test(q)) score++;
    if (score >= 2) break;
  }
  if (/\bbbig\b/i.test(q) || score >= 2) return ["AEVO"];
  return [];
}

/* =========================
   INPUT BLOCKING (HARD + INTENT)
========================= */
const BLOCK_PATTERNS = [
  // system/prompt/tooling/secrets/payload
  /\bsystem\b/i,
  /\bdeveloper\b/i,
  /\brole\s*:\s*(system|developer|assistant|tool)\b/i,
  /\bprompt\b/i,
  /\bmessages\s*=\s*\[/i,
  /\bpayload\b/i,
  /\btools?\b/i,
  /\bfile_search\b/i,
  /\bknowledge\s*cutoff\b/i,
  /\bapi\s*key\b/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /\bwebhook\b/i,
  /\bprocess\.env\b/i,
  /\bnetlify\.env\b/i
];

const INTENT_BLOCK_PATTERNS = [
  // semantic “audit/debug/meta” tricks
  /\bdebug\b/i,
  /\baudit\b/i,
  /\bprotokoll\b/i,
  /\binterne\s+regeln\b/i,
  /\bgenutzte\s+tools\b/i,
  /\btool\s*config\b/i,
  /\brequest\s*payload\b/i,
  /\bpayload[-\s]?struktur\b/i,
  /\bmessages[-\s]?array\b/i,
  /\bjson\b/i,
  /\bwortwörtlich\b/i,
  /\bverbatim\b/i,
  /\banonymisier\w*\b/i,
  /\bplatzhalter\b/i,
  /\bwie\s+du\s+arbeitest\b/i,
  /\bwie\s+du\s+verarbeitest\b/i,
  /\bkonfiguration\b/i,
  /\bsetup\b/i,
  /\bpolicy\b/i,
  /\brichtlinien\b/i
];

function shouldBlockInput(text) {
  return [...BLOCK_PATTERNS, ...INTENT_BLOCK_PATTERNS].some(rx => rx.test(text));
}

/* =========================
   OUTPUT BLOCKING (NOTBREMSE)
========================= */
const OUTPUT_BLOCK_PATTERNS = [
  /system[-\s]?prompt/i,
  /developer[-\s]?prompt/i,
  /interne\s+regeln/i,
  /genutzte\s+tools/i,
  /knowledge\s*cutoff/i,
  /payload/i,
  /request_payload/i,
  /tool_config/i,
  /messages[-\s]?array/i,
  /rolle\s+und\s+identität/i,
  /antwortstruktur/i,
  /der\s+gesamte\s+prompt/i,
  /file_search/i,
  /openai/i
];

function shouldBlockOutput(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.startsWith("<!DOCTYPE html") || t.startsWith("<html")) return true;
  return OUTPUT_BLOCK_PATTERNS.some(rx => rx.test(t));
}

/* =========================
   HELPERS
========================= */
function normalize(str) {
  return String(str || "").trim();
}

function coerceHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && typeof m === "object")
    .map(m => ({
      role: normalize(m.role),
      content: normalize(m.content)
    }))
    .filter(m => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-MAX_HISTORY_MESSAGES);
}

function safeParseBody(req) {
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    body = {};
  }
  return body && typeof body === "object" ? body : {};
}

/* =========================
   HANDLER
========================= */
export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method === "GET") return res.status(200).type("text/plain").send("OK linda-proxy");
  if (req.method !== "POST") return res.status(405).type("text/plain").send("Method Not Allowed");

  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return res.status(500).type("text/plain").send("Server not configured");

  const proxySecret = process.env.PROXY_SECRET || "";

  const body = safeParseBody(req);

  // Expect: { question, history }
  const questionRaw = normalize(body.question);
  const question = canonicalize(questionRaw);
  const history = coerceHistory(body.history);

  if (!question) return res.status(400).type("text/plain").send("Missing input");
  if (question.length > MAX_TEXT_LEN) return res.status(413).type("text/plain").send("Input too long");

  // Block BEFORE Make
  if (shouldBlockInput(question)) {
    return res.status(200).type("text/plain").send(BLOCK_MESSAGE);
  }

  const tags = detectTags(question);

  const payload = {
    ...body,
    question,
    history,
    tags
  };

  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (proxySecret) headers["X-Proxy-Secret"] = proxySecret;

  try {
    const up = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const txt = await up.text();

    // Block AFTER Make
    if (shouldBlockOutput(txt)) {
      return res.status(502).type("text/plain").send(
        "⚠️ Die Anfrage konnte aus Sicherheitsgründen nicht verarbeitet werden."
      );
    }

    return res.status(up.status).type("text/plain").send(txt);
  } catch {
    // Do not leak internals
    return res.status(502).type("text/plain").send("Relay error");
  }
}
