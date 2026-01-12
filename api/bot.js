// /api/bot.js — Rollback / Minimal-Stabil

module.exports = async function handler(req, res) {
  try {
    // Healthcheck (Browser-Aufruf)
    if (req.method === "GET") {
      return res.status(200).type("text/plain").send("OK bot");
    }

    // CORS Preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Nur POST erlaubt" });
    }

    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!webhookUrl) {
      return res.status(500).json({ error: "MAKE_WEBHOOK_URL fehlt (Production?)" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const question = body?.question ?? "";
    const history = body?.history ?? [];

    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history })
    });

    const txt = await r.text();
    return res.status(r.status).type("text/plain").send(txt);
  } catch {
    return res.status(500).type("text/plain").send("Server error");
  }
};
