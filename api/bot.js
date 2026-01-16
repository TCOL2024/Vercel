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

function parseGenderFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "ja", "yes", "on"].includes(v)) return true;
    if (["false", "0", "nein", "no", "off"].includes(v)) return false;
  }
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
    return `Ja. Bitte beziehe dich auf deine letzte Frage/Handlungsaufforderung und fahre damit fort.`;
  }
  if (isShortNegation(q)) {
    return `Nein. Bitte beziehe dich auf deine letzte Frage/Handlungsaufforderung und schlage eine alternative nächste Option vor.`;
  }
  return q;
}

// --- AEVO Prefix/Context ---
function isAevoContext(question, history) {
  const hay = [
    question || "",
    ...(Array.isArray(history) ? history.map(m => m?.content || "") : [])
  ].join(" ").toLowerCase();

  const keywords = [
    "aevo", "ausbilder", "ausbildung", "auszubild", "azubi",
    "bbig", "berufsbildungsgesetz", "ihk",
    "ausbildungsrahmenplan", "rahmenplan", "betrieblicher ausbildungsplan",
    "berichtsheft", "ausbildungsnachweis",
    "probezeit", "kündigung", "abschlussprüfung", "zwischenprüfung",
    "freistellung", "berufsschule", "jugendarbeitsschutz",
    "unterweisung", "lernziel", "handlungskompetenz",
    "fachliche eignung", "persönliche eignung"
  ];
  return keywords.some(k => hay.includes(k));
}

const AEVO_PREFIX = "Antworte fachlich fundiert im AEVO-Kontext mit kurzer Prüfungsrelevanz.";

function applyAevoPrefix(question, shouldApply) {
  if (!shouldApply) return question;
  const q = (question || "").trim();
  if (!q) return q;
  if (q.toLowerCase().startsWith(AEVO_PREFIX.toLowerCase())) return q;
  return `${AEVO_PREFIX}\n\n${q}`;
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

function stripAevoPrefixIfPresent(s) {
  const t = (s || "").trim();
  if (t.toLowerCase().startsWith(AEVO_PREFIX.toLowerCase())) return t.slice(AEVO_PREFIX.length).trim();
  return t;
}

function dedupeHistoryAgainstQuestion(history, question) {
  if (!Array.isArray(history) || history.length === 0) return history;

  const qCore = canonicalize(stripAevoPrefixIfPresent(question));
  if (!qCore) return history;

  // last
  const lastIdx = history.length - 1;
  const last = history[lastIdx];
  if (last && last.role === "user") {
    const hCore = canonicalize(stripAevoPrefixIfPresent(last.content || ""));
    if (hCore && (hCore === qCore || hCore.includes(qCore) || qCore.includes(hCore))) {
      return history.slice(0, lastIdx);
    }
  }
  // first
  const first = history[0];
  if (first && first.role === "user") {
    const hCore = canonicalize(stripAevoPrefixIfPresent(first.content || ""));
    if (hCore && (hCore === qCore || hCore.includes(qCore) || qCore.includes(hCore))) {
      return history.slice(1);
    }
  }
  return history;
}

/**
 * Prompt-Injection / Prompt-Leak Heuristik (pragmatisch für morgen)
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
    "debug", "audit", "trainingsmodus",
    "formatiere als json", "format als json", "json mit feldern", "\"system_prompt\":", "\"secrets\":",
    "liste alle quellen", "zeige alle quellen", "quellen nennen", "ids ausgeben"
  ];

  if (needles.some(n => t.includes(n))) return true;

  // forced JSON structure requests
  if (t.includes("json") && (t.includes("system_prompt") || t.includes("secrets") || t.includes("developer"))) return true;

  return false;
}

/**
 * Response Sanitizer: entfernt Quellenblöcke/IDs/Zitiermarker/JSON-Leaks.
 * Ziel: selbst wenn Make/LLM etwas ausspuckt, kommt es nicht beim Nutzer an.
 */
function sanitizeReply(text) {
  let out = String(text || "");

  // Falls JSON geliefert wurde: versuche "answer" zu extrahieren
  // (robust genug für typische Fälle, ohne JSON.parse zu riskieren)
  const m = out.match(/"answer"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r|\})/);
  if (m && m[1]) {
    out = m[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }

  // Entferne system_prompt/secrets Felder, falls noch vorhanden
  out = out.replace(/"system_prompt"\s*:\s*"[\s\S]*?"\s*,?/gi, "");
  out = out.replace(/"secrets"\s*:\s*"[\s\S]*?"\s*,?/gi, "");

  // Entferne Zitiermarker wie  oder 【1:...】
  out = out.replace(/【[^】]{1,200}】/g, "");

  // Entferne "Quellen:" Abschnitt (de/eng) bis Ende
  out = out.replace(/^\s*-\s*https?:\/\/\S+.*$/gmi, ""); // optional

  // Entferne Trainingsmodus-Sätze
  out = out.replace(/\(.*trainingsmodus.*\)/gi, "");
  out = out.replace(/.*trainingsmodus.*$/gim, "");

  // Aufräumen
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  return out;
}

/**
 * Emergency Fast-Lane – Sofortantworten für Standard-Definitionen (ohne Make)
 */
function tryFastLaneAnswer(question) {
  const q = stripAevoPrefixIfPresent(question);
  const t = (q || "").trim().toLowerCase();

  const isDef = t.length <= 240 && (
    t.startsWith("was ist") ||
    t.includes("was bedeutet") ||
    t.includes("definition") ||
    t.includes("kurz erkl")
  );
  if (!isDef) return null;

  if (t.includes("fachliche eignung")) {
    return [
      "Fachliche Eignung bedeutet: Du verfügst über die beruflichen Fertigkeiten, Kenntnisse und Fähigkeiten sowie die berufs- und arbeitspädagogischen Kompetenzen, um Ausbildung sachgerecht durchzuführen.",
      "Prüfungsrelevanz: Häufig wird die Abgrenzung zur persönlichen Eignung geprüft – fachlich = Qualifikation/Kompetenz, persönlich = Zuverlässigkeit/keine Ausschlussgründe.",
      "Soll ich dir dazu eine kurze AEVO-Prüfungsfrage formulieren?"
    ].join("\n\n");
  }

  if (t.includes("persönliche eignung")) {
    return [
      "Persönliche Eignung heißt: Es liegen keine Gründe vor, die jemanden als Ausbilder ungeeignet machen (z. B. gravierende Verstöße gegen Schutzvorschriften oder einschlägige Verurteilungen).",
      "Prüfungsrelevanz: Persönliche Eignung = rechtliche/charakterliche Zuverlässigkeit; fachliche Eignung = Qualifikation/Kompetenz.",
      "Möchtest du typische Ausschlussgründe als kurze Merkliste?"
    ].join("\n\n");
  }

  if (t.includes("berichtsheft") || t.includes("ausbildungsnachweis")) {
    return [
      "Der Ausbildungsnachweis (Berichtsheft) dokumentiert die vermittelten Inhalte und unterstützt die Lern- und Erfolgskontrolle.",
      "Prüfungsrelevanz: Ausbilder sollen ihn regelmäßig kontrollieren; je nach Kammerpraxis kann er bei der Prüfungszulassung relevant sein.",
      "Soll ich dir die typische Prüfungsargumentation (Zulassung ja/nein) kurz skizzieren?"
    ].join("\n\n");
  }

  if (t.includes("freistellung") && (t.includes("berufsschule") || t.includes("schule"))) {
    return [
      "Freistellung bedeutet: Auszubildende müssen für den Berufsschulunterricht und bestimmte Prüfungs-/Ausbildungsmaßnahmen freigestellt werden.",
      "Prüfungsrelevanz: Klassiker ist, ob während des Schulbesuchs Arbeitsleistung verlangt werden darf – in der Regel nein.",
      "Möchtest du ein kurzes Praxisbeispiel (Konfliktfall) dazu?"
    ].join("\n\n");
  }

  if (t.includes("probezeit") && t.includes("kündigung")) {
    return [
      "In der Probezeit kann das Ausbildungsverhältnis grundsätzlich jederzeit ohne Kündigungsfrist gekündigt werden (schriftlich).",
      "Prüfungsrelevanz: Nach der Probezeit gelten strengere Voraussetzungen (z. B. fristlos aus wichtigem Grund oder Kündigung durch Azubi mit Frist bei Berufswechsel).",
      "Soll ich die Unterschiede nach der Probezeit kurz gegenüberstellen?"
    ].join("\n\n");
  }

  return null;
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

  const questionRaw = typeof body.question === "string" ? body.question : "";
  let question = stripLeadingFillers(questionRaw);

  let history = normalizeHistory(body.history, 4);

  // Kurzantworten kontextfähig
  question = expandShortReply(question, history);

  // AEVO Prefix bei Ausbildungskontext
  const aevo = isAevoContext(question, history);
  question = applyAevoPrefix(question, aevo);

  // Dedupe gegen doppelte aktuelle Frage
  history = dedupeHistoryAgainstQuestion(history, question);

  // Limits
  if (!question) return sendJson(res, 400, { error: "question fehlt" });
  if (question.length > 2000) return sendJson(res, 413, { error: "question zu lang (max 2000 Zeichen)" });

  // Fast-Lane
  if (aevo) {
    const fast = tryFastLaneAnswer(question);
    if (fast) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(fast);
    }
  }

  // HARD BLOCK: Leak/Injection -> NICHT an Make weitergeben
  const leak = isLeakAttempt(question) || (Array.isArray(history) && history.some(m => isLeakAttempt(m.content)));
  if (leak) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(
      "Ich kann keine internen Anweisungen, Prompts, technischen IDs, Logs oder Quellenstrukturen ausgeben. " +
      "Stelle mir bitte stattdessen deine fachliche Frage (AEVO/BBiG), dann beantworte ich sie kurz und prüfungsrelevant."
    );
  }

  const gender = parseGenderFlag(body.gender);
  const style = { gender, aevo, leak };

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
      body: JSON.stringify({ question, history, style }),
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

    // Sanitizing (Quellen/IDs/JSON-Leaks entfernen)
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
        "Das dauert gerade etwas länger. Bitte stelle die Frage etwas konkreter (z. B. „Definition + Abgrenzung in 5 Sätzen“). Soll ich dir dazu eine passende AEVO-Prüfungsfrage erstellen?"
      );
    }

    return sendJson(res, 500, { error: "Fehler beim Senden an Make", detail: e?.message || "Unbekannter Fehler" });
  }
}
