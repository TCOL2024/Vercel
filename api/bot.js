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
    c.includes("⏳") ||
    c.includes("einen moment") ||
    c.includes("bitte warten") ||
    c.includes("lade") ||
    c.includes("thinking")
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
    return `Ja. Bitte knüpfe an die letzte Frage/Handlungsaufforderung an und führe den nächsten Schritt aus.`;
  }
  if (isShortNegation(q)) {
    return `Nein. Bitte knüpfe an die letzte Frage/Handlungsaufforderung an und schlage eine Alternative vor.`;
  }
  return q;
}

// ---------- Leak/Injection (nur aktuelle Frage prüfen) ----------
function isLeakAttempt(text) {
  const t = (text || "").toLowerCase();
  const needles = [
    "system prompt", "systemprompt", "system_prompt", "developer", "[system]", "[developer]",
    "hidden instruction", "versteckte anweisung", "interne anweisung", "interne anweisungen",
    "zeige den prompt", "zeige deinen prompt", "prompt ausgeben",
    "api key", "apikey", "access token",
    "thread id", "thread_id", "vector store", "vectorstore", "file_search", "tools", "logs", "payload",
    "\"system_prompt\":", "\"secrets\":", "secrets"
  ];
  if (needles.some(n => t.includes(n))) return true;
  if (t.includes("json") && (t.includes("system_prompt") || t.includes("secrets") || t.includes("developer"))) return true;
  return false;
}

// ---------- Antwort: NICHT nach Quellen abschneiden ----------
function sanitizeReply(text) {
  let out = String(text || "").trim();

  // Wenn Make JSON liefert: robust parse und "answer" nehmen (ohne Trunkierung)
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
      // keep out as-is
    }
  }

  // Entferne nur Tool-Zitiermarker (keine Quellenzeilen/URLs löschen!)
  out = out.replace(/【[^】]{1,200}】/g, "");

  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

// ---------- FM normalize ----------
function normalizeFm(value) {
  const v = (value == null) ? "" : String(value).trim();
  if (!v) return "";
  const u = v.toUpperCase();
  if (["AEVO", "VWL", "PERSONAL"].includes(u)) return u;
  return ""; // alles andere: wie "kein Modus"
}

// ---------- Vector decision (NUR User-Inhalte; KEINE Assistant-Texte) ----------
function getUserTextForVectorDecision(question, history) {
  const parts = [];
  const q = (question || "").trim();
  if (q) parts.push(q);

  // Nur USER-Messages aus History berücksichtigen (keine Assistant-Self-Triggers)
  if (Array.isArray(history)) {
    for (const m of history) {
      if (m && m.role === "user" && typeof m.content === "string" && m.content.trim()) {
        parts.push(m.content.trim());
      }
    }
  }
  return parts.join(" \n");
}

// Deine Trigger + abgeleitete Begriffe (wie vereinbart)
function detectVectorYes(question, history) {
  const hay = getUserTextForVectorDecision(question, history).toLowerCase();

  const triggers = [
    // von dir
    "mehr details",
    "urteil", "urteile",
    "kündigung",
    "arbeitszeit",
    "berufsschule",
    "verstehe ich nicht",
    "erkläre genau",
    "europäische zentralbank",
    "ezb",
    "inflation",
    "rechenweg",
    "erkläre genauer",
    "erkläre besser",
    "abmahnung",
    "ermahnung",
    "schwierigkeit",
    "probleme",
    "prüfung",
    "prüfungsfrage",
    "beschwerde",
    "ich fühle mich unsicher",

    // abgeleitet/ähnlich
    "ausführlicher",
    "detaillierter",
    "genauer",
    "vertiefung",
    "vertiefen",
    "schritt für schritt",
    "nochmal erklären",
    "bitte erklären",
    "erläutere",
    "erläuterung",
    "unklar",
    "verwirrend",
    "wie meinst du das",
    "was heißt das",
    "begründung",
    "belege",
    "quelle",
    "quellen",
    "rechtsgrundlage",
    "gesetzlich",

    // Recht/Norm/Urteil
    "§",
    "art.",
    "abs.",
    "satz",
    "nr.",
    "aktenzeichen",
    "az.",
    "beschluss",
    "rechtsprechung",
    "bag",
    "bgh",
    "bverfg",
    "lag",
    "olg",
    "ovg",

    // Ausbildungskonflikte
    "probezeit",
    "fristlos",
    "außerordentlich",
    "ordentlich",
    "freistellung",
    "blockunterricht",
    "fehlzeit",
    "abmahnen",
    "verwarnung",
    "pflichtverletzung",

    // VWL
    "geldpolitik",
    "leitzins",
    "verbraucherpreisindex",
    "vpi",
    "kaufkraft",
    "deflation",
    "preisniveau",
    "formel",
    "beispielrechnung",
    "berechnung",
    "herleitung",
    "prozentrechnung"
  ];

  // Spezial: Normmuster
  if (/(^|\s)(§|art\.)\s*\d+/i.test(hay)) return true;

  for (const t of triggers) {
    if (t === "§") {
      if (hay.includes("§")) return true;
      continue;
    }
    if (hay.includes(t)) return true;
  }
  return false;
}

function detectNeed(vectorYes, question) {
  if (vectorYes) return "VECTOR";
  const q = (question || "").trim().toLowerCase();
  const isDef = q.length <= 220 && (
    q.startsWith("was ist") ||
    q.includes("was bedeutet") ||
    q.includes("definition") ||
    q.includes("kurz erklär")
  );
  if (isDef) return "FAST";
  return "DEFAULT";
}

// -------------------- Handler --------------------
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

  const questionRaw = typeof body.question === "string" ? body.question : "";
  let question = stripLeadingFillers(questionRaw);

  let history = normalizeHistory(body.history, 4);
  question = expandShortReply(question, history);

  if (!question) return sendJson(res, 400, { error: "question fehlt" });
  if (question.length > 2000) return sendJson(res, 413, { error: "question zu lang (max 2000 Zeichen)" });

  // Leak/Injection: NUR aktuelle Frage prüfen
  if (isLeakAttempt(question)) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(
      "Ich kann keine internen Anweisungen, Prompts, technischen IDs, Logs oder Tool-Strukturen ausgeben. " +
      "Stelle mir bitte deine fachliche Frage, dann helfe ich dir gern weiter."
    );
  }

  // FM (neu) oder fachmodus (alt)
  const fm_user = normalizeFm(body.fm_user || body.fachmodus || "");

  // optional pass-through
  const token = (body.token == null) ? "" : String(body.token).slice(0, 200);
  const context = (body.context == null) ? "" : String(body.context).slice(0, 5000);

  // Vector decision: nur User-Inhalte
  const vector_yes = detectVectorYes(question, history);
  const need = detectNeed(vector_yes, question);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

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
          fm_user,       // AEVO | VWL | PERSONAL | ""
          vector_yes,    // true/false
          need,          // VECTOR | FAST | DEFAULT
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
