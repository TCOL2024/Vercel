// /api/linda-proxy.js (Vercel Node Function) — hardened v2

const MAX_TEXT_LEN = 8000;
const MAX_HISTORY_MESSAGES = 6; // 3 Turns
const BLOCK_MESSAGE =
  "Dabei kann ich nicht helfen. Ich beantworte ausschließlich fachliche Fragen (z. B. Ausbildung/AEVO, Prüfungen, Personalmanagement).";

const ALLOWED_ORIGINS = new Set([
  "https://ntc-bot1.netlify.app",
  "https://main--ntc-bot1.netlify.app",
  // "https://dein-projekt.vercel.app",
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (!origin) return; // server-to-server

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Client-Secret");
  }
}

function isBrowserOriginAllowed(req) {
  const origin = req.headers.origin || "";
  if (!origin) return true; // no origin => allow (server-to-server)
  return ALLOWED_ORIGINS.has(origin);
}

function canonicalize(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

// Vorsichtig: lieber schlanker blocken (nur klare Meta/Secrets)
const BLOCK_PATTERNS = [
  /\bprocess\.env\b/i,
  /\bapi[_\-\s]?key\b/i,
  /\bsecret\b/i,
  /\bwebhook\b/i,
  /\btoken\b/i,
  /\brole\s*:\s*(system|developer|assistant|tool)\b/i,
  /\bmessages\s*=\s*\[/i
];

// optional (bei dir bewusst aktiv): “Audit/Debug/JSON”-Tricks
const INTENT_BLOCK_PATTERNS = [
  /\btool[_\-\s]?config\b/i,
  /\brequest[_\-\s]?payload\b/i,
  /\bsystem[_\-\s]?prompt\b/i,
  /\bdeveloper[_\-\s]?prompt\b/i
];

function shouldBlockInput(text) {
  const t = String(text || "");
  return [...BLOCK_PATTERNS, ...INTENT_BLOCK_PATTERNS].some(rx => rx.test(t));
}

// Regex für Output inkl. "_" (dein Bug)
const OUTPUT_BLOCK_PATTERNS = [
  /system[_\-\s]?prompt/i,
  /developer[_\-\s]?prompt/i,
  /tool[_\-\s]?config/i,
  /request[_\-\s]?payload/i,
  /messages[_\-\s]?array/i,
  /file[_\-\s]?search/i
];

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Rekursiv nach verbotenen Keys suchen (robuster als nur Regex im Text)
const FORBIDDEN_KEYS = new Set([
  "system_prompt",
  "developer_prompt",
  "tool_config",
  "request_payload",
  "messages",
  "tools"
]);

function containsForbiddenKeys(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some(containsForbiddenKeys);

  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(String(k))) return true;
    if (containsForbiddenKeys(v)) return true;
  }
  return false;
}

function shouldBlockOutput(text) {
  const t = String(text || "").trim();
  if (!t) return false;

  // HTML nie erlauben
  if (t.startsWith("<!DOCTYPE html") || t.startsWith("<html") || /<script/i.test(t)) return true;

  // Wenn es wie JSON aussieht: strukturell prüfen
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    const parsed = safeJsonParse(t);
    if (parsed && containsForbiddenKeys(parsed)) return true;
  }

  // Zusätzlich grobe Text-Pattern
  return OUTPUT_BLOCK_PATTERNS.some(rx => rx.test(t));
}

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

function timingSafeEq(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export default async function handler(req, res) {
  setCors(req, res);

  // Browser-Origin hart ablehnen (nicht nur “kein CORS Header”)
  if (!isBrowserOriginAllowed(req)) {
    return res.status(403).type("text/plain").send("Forbidden origin");
  }

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method === "GET") return res.status(200).type("text/plain").send("OK linda-proxy");
  if (req.method !== "POST") return res.status(405).type("text/plain").send("Method Not Allowed");

  // Content-Type minimal erzwingen (hilft gegen Form-Posts)
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (ct && !ct.includes("application/json")) {
    return res.status(415).type("text/plain").send("Unsupported Media Type");
  }

  // Eingehende Auth (wichtig!)
  const clientSecret = process.env.CLIENT_SECRET || "";
  if (clientSecret) {
    const provided = req.headers["x-client-secret"] || "";
    if (!timingSafeEq(provided, clientSecret)) {
      return res.status(401).type("text/plain").send("Unauthorized");
    }
  }

  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return res.status(500).type("text/plain").send("Server not configured");

  const proxySecret = process.env.PROXY_SECRET || "";
  const body = safeParseBody(req);

  // Allowlist statt ...body
  const questionRaw = normalize(body.question);
  const question = canonicalize(questionRaw);
  const history = coerceHistory(body.history);

  if (!question) return res.status(400).type("text/plain").send("Missing input");
  if (question.length > MAX_TEXT_LEN) return res.status(413).type("text/plain").send("Input too long");

  if (shouldBlockInput(question)) {
    return res.status(200).type("text/plain").send(BLOCK_MESSAGE);
  }

  const tags = detectTags(question);

  // Nur diese Felder gehen zu Make
  const payload = {
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
      body: JSON.stringify(payload),
      redirect: "error"
    });

    const txt = await up.text();

    if (shouldBlockOutput(txt)) {
      return res
        .status(502)
        .type("text/plain")
        .send("⚠️ Die Antwort wurde aus Sicherheitsgründen blockiert.");
    }

    // Nur “text/plain” zurück (kein HTML)
    return res.status(up.status).type("text/plain").send(txt);
  } catch {
    return res.status(502).type("text/plain").send("Relay error");
  }
}
