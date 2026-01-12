// /api/linda-proxy.js  (Vercel: req,res)

const MAX_TEXT_LEN = 8000;
const MAX_HISTORY_MESSAGES = 6; // 3 Turns
const BLOCK_MESSAGE =
  "Dabei kann ich nicht helfen. Ich beantworte ausschließlich fachliche Fragen (z. B. Ausbildung/AEVO, Prüfungen, Personalmanagement).";

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
  /\brole\s*:\s*(system|developer|assistant|tool)/i,
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
  /\benv\b/i,
  /\bprocess\.env\b/i
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
  /\bjson\b/i,
  /\bwortwörtlich\b/i,
  /\bverbatim\b/i,
  /\banonymisier\w*\b/i,
  /\bplatzhalter\b/i,
  /\bwie\s+du\s+arbeitest\b/i,
  /\bwie\s+du\s+verarbeitest\b/i,
  /\bkonfiguration\b/i,
  /\bsetup\b/i
];

function shouldBlockInput(text) {
  const t = String(text || "");
  return [...BLOCK_PATTERNS, ...INTENT_BLOCK_PATTERNS].some(rx => rx.test(t));
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

export default async function handler(req, res) {
  // CORS (optional härten: statt "*" nur deine Domain)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method === "GET") return res.status(200).send("OK linda-proxy");
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // ✅ NUR ENV, keine hardcoded Make URL
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return res.status(500).send("Server not configured");

  const body = safeParseBody(req);

  const question = normalize(body.question);
  const history = coerceHistory(body.history);

  if (!question) return res.status(400).send("Missing input");
  if (question.length > MAX_TEXT_LEN) return res.status(413).send("Input too long");

  // ✅ Block BEFORE Make
  if (shouldBlockInput(question)) {
    return res.status(200).type("text/plain").send(BLOCK_MESSAGE);
  }

  // ✅ Tags (AEVO)
  const tags = detectTags(question);

  const payload = {
    ...body,
    question,
    history,
    tags
  };

  try {
    const up = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const txt = await up.text();

    // ✅ Block AFTER Make
    if (shouldBlockOutput(txt)) {
      return res.status(502).type("text/plain").send(
        "⚠️ Die Anfrage konnte aus Sicherheitsgründen nicht verarbeitet werden."
      );
    }

    // Immer als Text zurückgeben (UI rendert Markdown/HTML ggf. selbst)
    return res.status(up.status).type("text/plain").send(txt);
  } catch (e) {
    return res.status(502).json({ error: "Relay error", detail: String(e) });
  }
}
