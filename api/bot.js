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

/**
 * Entfernt nur am Anfang einfache Gruß-/Füllformulierungen,
 * damit der Prompt kleiner wird, ohne Inhalt zu zerstören.
 */
function stripLeadingFillers(text) {
  if (!text) return "";

  let t = text.trim();

  // Mehrfach-Grüße / Anreden am Anfang entfernen
  // Beispiele: "Hallo", "Hi", "Moin", "Guten Morgen", "Hey Linda", "Hi Jens" etc.
  t = t.replace(
    /^(?:(?:hallo|hi|hey|moin|guten\s+morgen|guten\s+tag|guten\s+abend)\b[\s,!.-]*)(?:linda\b[\s,!.-]*)?/i,
    ""
  ).trim();

  // "ich möchte", "ich will", "kannst du" am Anfang etwas straffen
  // (nur wenn es direkt am Anfang steht)
  t = t.replace(/^(ich\s+m(?:ö|oe)chte|ich\s+will)\s+(bitte\s+)?/i, "").trim();
  t = t.replace(/^(kannst\s+du|könntest\s+du)\s+(bitte\s+)?/i, "").trim();

  // Doppelte Leerzeichen
  t = t.replace(/\s{2,}/g, " ").trim();

  return t;
}

function normalizeHistory(history, maxItems = 4) {
  if (!Array.isArray(history)) return [];

  // Nur die letzten maxItems übernehmen (entscheidend für Promptgröße)
  const last = history.slice(-maxItems);

  return last.map((h) => {
    const role = (h && typeof h.role === "string") ? h.role.slice(0, 20) : "user";
    const contentRaw = (h && typeof h.content === "string") ? h.content : "";
    const content = stripLeadingFillers(contentRaw).slice(0, 1200); // kürzer als vorher
    return { role, content };
  });
}

function parseGenderFlag(value) {
  // akzeptiert: true/false, "true"/"false", "ja"/"nein", "1"/"0"
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "ja", "yes", "on"].includes(v)) return true;
    if (["false", "0", "nein", "no", "off"].includes(v)) return false;
  }
  return false;
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
  const question = stripLeadingFillers(questionRaw);

  // harte Limits
  if (!question) return sendJson(res, 400, { error: "question fehlt" });
  if (question.length > 1600) return sendJson(res, 413, { error: "question zu lang (max 1600 Zeichen)" });

  // History: IMMER nur 4 – egal was der Client schickt
  const history = normalizeHistory(body.history, 4);

  // Gender-Flag: kommt vom Frontend (z.B. Toggle)
  const gender = parseGenderFlag(body.gender);

  // Optional: ultra-kurze Steuerinfo nur als separates Feld (kein Prompt-Prefix!)
  // -> In Make nutzt du dieses Feld, um die System-/Developer-Regel zu setzen.
  const style = { gender };

  // Timeout zu Make
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

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
        style
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const text = await makeResp.text();

    if (!makeResp.ok) {
      return sendJson(res, 502, {
        error: "Make antwortet mit Fehler",
        status: makeResp.status,
        detail: text.slice(0, 5000)
      });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(text);
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e?.name === "AbortError") ? "Timeout zu Make (15s)" : (e?.message || "Unbekannter Fehler");
    return sendJson(res, 500, { error: "Fehler beim Senden an Make", detail: msg });
  }
}
