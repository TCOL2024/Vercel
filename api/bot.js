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

/**
 * Same-Origin only:
 * Erlaubt nur Requests von der gleichen Origin wie die Vercel-Host-Domain
 * -> stabil für GitHub->Vercel Deployments, inkl. Preview und Custom Domains,
 *    solange Frontend + /api im selben Deployment liegen.
 */
function allowSameOrigin(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const host = req.headers.host || ""; // z.B. meinprojekt.vercel.app oder custom-domain.de

  // Vercel nutzt https in der Regel; wenn du bewusst http nutzt, müssen wir anpassen.
  const expected = host ? `https://${host}` : "";

  if (origin && origin === expected) return true;
  // Fallback: manche Requests (selten) liefern kein Origin, dann Referer prüfen
  if (!origin && referer && expected && referer.startsWith(expected)) return true;

  return false;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  // Max 12 Einträge, jeweils begrenzte Felder
  return history.slice(0, 12).map((h) => {
    const role = (h && typeof h.role === "string") ? h.role.slice(0, 20) : "user";
    const content = (h && typeof h.content === "string") ? h.content.slice(0, 2000) : "";
    return { role, content };
  });
}

export default async function handler(req, res) {
  // Nur POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Nur POST erlaubt" });
  }

  // Same-Origin Schutz
  if (!allowSameOrigin(req)) {
    return sendJson(res, 403, { error: "Origin/Referer nicht erlaubt (Same-Origin only)" });
  }

  // Content-Type prüfen (soft, aber sinnvoll)
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return sendJson(res, 415, { error: "Content-Type muss application/json sein" });
  }

  // Environment Variable
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    return sendJson(res, 500, { error: "MAKE_WEBHOOK_URL fehlt in Vercel Environment" });
  }

  // Body lesen (max 32KB)
  let raw = "";
  try {
    raw = await readRawBody(req, 32 * 1024);
  } catch (e) {
    if (e && e.code === "PAYLOAD_TOO_LARGE") {
      return sendJson(res, 413, { error: "Payload zu groß (max 32KB)" });
    }
    return sendJson(res, 400, { error: "Body konnte nicht gelesen werden", detail: e?.message });
  }

  // JSON parse
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return sendJson(res, 400, { error: "Ungültiges JSON" });
  }

  // Validierung + Limits
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const history = normalizeHistory(body.history);

  if (!question) return sendJson(res, 400, { error: "question fehlt" });
  if (question.length > 2000) return sendJson(res, 413, { error: "question zu lang (max 2000 Zeichen)" });

  // Timeout zu Make (15s)
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
        // optional: zum Debuggen in Make
        "X-Linda-Client-IP": ip,
        "X-Linda-Source": origin || referer || ""
      },
      body: JSON.stringify({ question, history }),
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

    // Antwort zurück
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(text);
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e?.name === "AbortError") ? "Timeout zu Make (15s)" : (e?.message || "Unbekannter Fehler");
    return sendJson(res, 500, { error: "Fehler beim Senden an Make", detail: msg });
  }
}
