// /api/bot.js — universal handler (Node req/res ODER Web Request)

function textResponse(resOrNull, status, text, headers = {}) {
  // Node (req,res)
  if (resOrNull && typeof resOrNull.status === "function") {
    for (const [k, v] of Object.entries(headers)) resOrNull.setHeader(k, v);
    return resOrNull.status(status).type("text/plain").send(text);
  }
  // Web Response (Edge-style)
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

async function readJsonBody(req) {
  // Node req/res (Vercel Node Function)
  if (req && typeof req.body !== "undefined") {
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return (req.body && typeof req.body === "object") ? req.body : {};
  }

  // Web Request (Edge)
  if (req && typeof req.json === "function") {
    try { return await req.json(); } catch { return {}; }
  }
  return {};
}

async function doHandle(req, res) {
  try {
    const method = (req?.method || "GET").toUpperCase();

    // Healthcheck
    if (method === "GET") return textResponse(res, 200, "OK bot");
    if (method === "OPTIONS") return textResponse(res, 204, "", {
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "access-control-allow-origin": "*"
    });

    if (method !== "POST") return textResponse(res, 405, "Nur POST erlaubt");

    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!webhookUrl) return textResponse(res, 500, "Server not configured (MAKE_WEBHOOK_URL)");

    const body = await readJsonBody(req);
    const question = String(body?.question || "").trim();
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!question) return textResponse(res, 400, "Missing input");

    const up = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ question, history })
    });

    const txt = await up.text();
    return textResponse(res, up.status, txt);
  } catch (e) {
    // kein Leaken von Details
    return textResponse(res, 500, "Function crashed");
  }
}

// Export für Node-Functions (req,res)
module.exports = async function handler(req, res) {
  return doHandle(req, res);
};

// Zusätzlich: falls Vercel es als Web Handler interpretiert (Edge-style)
module.exports.default = async function handlerWeb(req) {
  return doHandle(req, null);
};
