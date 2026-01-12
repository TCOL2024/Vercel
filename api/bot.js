// /api/bot.js  — Ursprungs-Relay (Vercel Node Function, req/res)

module.exports = async function handler(req, res) {
  // nur POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Nur POST erlaubt" });
  }

  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: "MAKE_WEBHOOK_URL fehlt" });
  }

  try {
    // Body lesen
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { question, history } = body;

    // an Make weiterleiten
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history })
    });

    const txt = await r.text();
    return res.status(r.status).send(txt);
  } catch {
    return res.status(500).json({ error: "Fehler beim Senden an Make" });
  }
};
