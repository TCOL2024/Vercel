// /api/bot.js  (Vercel Serverless Function, ohne Next.js)

function readRawBody(req, limitBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        const err = new Error("Payload too large");
        err.code = "PAYLOAD_TOO_LARGE";
        reject(err);
        req.destroy();
        return;
      }
      data += chunk.toString("utf8");
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function allowSameOrigin(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const host = req.headers.host || "";
  const expected = host ? `https://${host}` : "";

  if (origin && origin === expected) return true;
  if (!origin && referer && expected && referer.startsWith(expected)) return true;
  return false;
}

function stripLeadingFillers(text) {
  if (!text) return "";
  let t = String(text).trim();

  t = t.replace(
    /^(?:(?:hallo|hi|hey|moin|guten\s+morgen|guten\s+tag|guten\s+abend)\b[\s,!.-]*)(?:linda\b[\s,!.-]*)?/i,
    ""
  ).trim();

  t = t.replace(/^(ich\s+m(?:ö|oe)chte|ich\s+will)\s+(bitte\s+)?/i, "").trim();
  t = t.replace(/^(kannst\s+du|könntest\s+du)\s+(bitte\s+)?/i, "").trim();

  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function isPlaceholderAssistantMessage(content) {
  if (!content) return false;
  const c = content.trim().toLowerCase();
  return (
    c === "einen moment bitte" ||
    c.startsWith("einen moment bitte") ||
    c.includes("bitte warten") ||
    c.includes("lade") ||
    c.includes("thinking") ||
    c.includes("⏳")
  );
}

function clipContent(role, text, maxLen = 1400) {
  const t = (text || "").trim();
  if (t.length <= maxLen) return t;
  if (role === "assistant") return "… " + t.slice(-maxLen);
  return t.slice(0, maxLen) + " …";
}

function normalizeHistory(history, maxItems = 4) {
  if (!Array.isArray(history)) return [];
  const last = history.slice(-maxItems);
  const cleaned = [];

  for (const h of last) {
    const role = (h && typeof h.role === "string") ? h.role.slice(0, 20) : "user";
    let raw = (h && typeof h.content === "string") ? h.content : "";
    raw = stripLeadingFillers(raw);
    if (!raw) continue;
    if (role === "assistant" && isPlaceholderAssistantMessage(raw)) continue;
    cleaned.push({ role, content: clipContent(role, raw, 1400) });
  }
  return cleaned;
}

function isShortAffirmation(text) {
  const t = (text || "").trim().toLowerCase();
  return ["ja", "j", "ok", "okay", "passt", "gerne", "mach", "bitte", "weiter"].includes(t);
}
function isShortNegation(text) {
  const t = (text || "").trim().toLowerCase();
  return ["nein", "n", "no", "nicht", "lieber nicht"].includes(t);
}

function expandShortReply(question, history) {
  const q = (question || "").trim();
  if (!q) return q;

  const lastAssistant = Array.isArray(history)
    ? [...history].reverse().find((m) => m.role === "assistant" && m.content)
    : null;

  if (!lastAssistant) return q;

  if (isShortAffirmation(q)) {
    return `Ja. Bitte knüpfe an deine letzte Frage/Handlungsaufforderung an und führe den nächsten Schritt aus.`;
  }
  if (isShortNegation(q)) {
    return `Nein. Bitte knüpfe an deine letzte Frage/Handlungsaufforderung an und schlage eine Alternative vor.`;
  }
  return q;
}

// --- Dedupe ---
function canonicalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”„"']/g, "")
    .replace(/[^\p{L}\p{N}\s?.!,:-]/gu, "")
    .trim();
}

function dedupeHistoryAgainstQuestion(history, question) {
  if (!Array.isArray(history) || history.length === 0) return history;
  const qCore = canonicalize(question);
  if (!qCore) return history;

  // last
  const lastIdx = history.length - 1;
  const last = history[lastIdx];
  if (last && last.role === "user") {
    const hCore = canonicalize(last.content || "");
    if (hCore && (hCore === qCore || hCore.includes(qCore) || qCore.includes(hCore))) {
      return history.slice(0, lastIdx);
    }
  }
  // first
  const first = history[0];
  if (first && first.role === "user") {
    const hCore = canonicalize(first.content || "");
    if (hCore && (hCore === qCore || hCore.includes(qCore) || qCore.includes(hCore))) {
      return history.slice(1);
    }
  }
  return history;
}

/**
 * Prompt-Injection / Prompt-Leak Heuristik
 * -> wenn true: wir schicken NICHTS an Make, sondern antworten serverseitig.
 */
function isLeakAttempt(text) {
  const t = (text || "").toLowerCase();

  const needles = [
    "system prompt", "systemprompt", "system_prompt", "developer", "[system]", "[developer]",
    "hidden instruction", "versteckte anweisung", "interne anweisung", "interne anweisungen",
    "prompt ausgeben", "zeige den prompt", "zeige deinen prompt",
    "secrets", "\"secrets\"", "api key", "apikey", "token", "access token",
    "thread id", "thread_id", "vector store", "vectorstore", "file_search", "tools", "log", "logs", "payload",
    "debug", "audit",
    "\"system_prompt\":", "\"secrets\":"
  ];

  if (needles.some(n => t.includes(n))) return true;

  // forced JSON structure requests about internals
  if (t.includes("json") && (t.includes("system_prompt") || t.includes("secrets") || t.includes("developer"))) return true;

  return false;
}

/**
 * Response Sanitizer: entfernt Quellenblöcke/IDs/Zitiermarker/JSON-Leaks.
 */
function sanitizeReply(text) {
  let out = String(text || "").trim();

  const looksJson =
    (out.startsWith("{") && out.endsWith("}")) ||
    (out.startsWith("[") && out.endsWith("]"));

  if (looksJson) {
    try {
      const obj = JSON.parse(out);
      const answer =
        (obj && typeof obj.answer === "string" && obj.answer) ||
        (obj && obj.data && typeof obj.data.answer === "string" && obj.data.answer) ||
        (obj && obj.result && typeof obj.result === "string" && obj.result) ||
        "";
      if (answer) out = String(answer);
    } catch {
      // fallback: keep as text and sanitize below
    }
  }

  // remove potential leaked fields
  out = out.replace(/"system_prompt"\s*:\s*"[\s\S]*?"\s*,?/gi, "");
  out = out.replace(/"secrets"\s*:\s*"[\s\S]*?"\s*,?/gi, "");

  // remove citation markers
  out = out.replace(/【[^】]{1,200}】/g, "");

  // remove pure URL source lines
  out = out.replace(/^\s*-\s*https?:\/\/\S+.*$/gmi, "");

  // cleanup
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * Optional Fast-Lane – nur wenn fm_user=FASTLANE (nicht automatisch AEVO)
 */
function tryFastLaneAnswer(question) {
  const t = (question || "").trim().toLowerCase();
  const isDef = t.length <= 240 && (
    t.startsWith("was ist") ||
    t.includes("was bedeutet") ||
    t.includes("definition") ||
    t.includes("kurz erkl")
  );
  if (!isDef) return null;

  if (t.includes("fachliche eignung")) {
    return [
      "Fachliche Eignung bedeutet: Du verfügst über die beruflichen Fertigkeiten, Kenntnisse und Fähigkeiten, um eine Aufgabe sachgerecht auszuführen.",
      "Im Ausbildungskontext wird häufig zusätzlich die Abgrenzung zur persönlichen Eignung geprüft.",
      "Möchtest du eine kurze Merkliste (Unterschied fachlich vs. persönlich)?"
    ].join("\n\n");
  }

  return null;
}

function normalizeFm(value) {
  const v = (value == null) ? "" : String(value).trim();
  if (!v) return "";
  const u = v.toUpperCase();

  // erlaubte Kürzel
  if (["AEVO", "VWL", "FASTLANE", "URTEILE", "PERSONAL"].includes(u)) return u;

  // tolerante Eingaben
  if (u === "URTEIL" || u === "URTEILE ") return "URTEILE";
  if (u === "HR") return "PERSONAL";

  return u; // not blocking unknown, but keep uppercased
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Nur POST erlaubt" });
  }

  if (!allowSameOrigin(req)) {
    return sendJson(res, 403, { error: "Origin/Referer nicht erlaubt (Same-Origin only)" });
  }

  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return sendJson(res, 415, { error: "Content-Type muss application/json sein" });
  }

  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    return sendJson(res, 500, { error: "MAKE_WEBHOOK_URL fehlt in Vercel Environment" });
  }

  let raw = "";
  try {
    raw = await readRawBody(req, 32 * 1024);
  } catch (e) {
    if (e && e.code === "PAYLOAD_TOO_LARGE") {
      return sendJson(res, 413, { error: "Payload zu groß (max 32KB)" });
    }
    return sendJson(res, 400, { error: "Body konnte nicht gelesen werden", detail: e?.message });
  }

  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return sendJson(res, 400, { error: "Ungültiges JSON" });
  }

  // --- incoming fields (new HTML) ---
  const questionRaw = typeof body.question === "string" ? body.question : "";
  let question = stripLeadingFillers(questionRaw);

  // history from HTML (already last 3) but we sanitize anyway
  let history = normalizeHistory(body.history, 4);

  // short replies become actionable
  question = expandShortReply(question, history);

  // dedupe
  history = dedupeHistoryAgainstQuestion(history, question);

  // fm (new: fm_user), keep backward compatibility: fachmodus
  const fm_user = normalizeFm(body.fm_user || body.fachmodus || "");

  // token/context pass-through (optional)
  const token = (body.token == null) ? "" : String(body.token).slice(0, 200);
  const context = (body.context == null) ? "" : String(body.context).slice(0, 4000);

  // Limits
  if (!question) return sendJson(res, 400, { error: "question fehlt" });
  if (question.length > 2000) return sendJson(res, 413, { error: "question zu lang (max 2000 Zeichen)" });

  // HARD BLOCK: Leak/Injection -> NICHT an Make weitergeben
  const leak = isLeakAttempt(question) || (Array.isArray(history) && history.some(m => isLeakAttempt(m.content)));
  if (leak) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(
      "Ich kann keine internen Anweisungen, Prompts, technischen IDs, Logs oder Tool-Strukturen ausgeben. " +
      "Stelle mir bitte deine fachliche Frage, dann helfe ich dir gern weiter."
    );
  }

  // Optional Fastlane ONLY when user selected FASTLANE
  if (fm_user === "FASTLANE") {
    const fast = tryFastLaneAnswer(question);
    if (fast) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(fast);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  const ip = getClientIp(req);
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";

  try {
    const makeResp = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Linda-Client-IP": ip,
        "X-Linda-Source": origin || referer || ""
      },
      body: JSON.stringify({
        question,
        history,
        meta: {
          fm_user,      // <- wichtig: eigenes Feld
          token,
          context
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    let text = await makeResp.text();

    if (!makeResp.ok) {
      return sendJson(res, 502, {
        error: "Make antwortet mit Fehler",
        status: makeResp.status,
        detail: text.slice(0, 5000)
      });
    }

    text = sanitizeReply(text);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(text);
  } catch (e) {
    clearTimeout(timeout);

    if (e?.name === "AbortError") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(
        "Das dauert gerade etwas länger. Bitte stelle die Frage etwas konkreter (z. B. „Definition + Abgrenzung in 5 Sätzen“)."
      );
    }

    return sendJson(res, 500, { error: "Fehler beim Senden an Make", detail: e?.message || "Unbekannter Fehler" });
  }
}
