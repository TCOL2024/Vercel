// api/linda-proxy.js
// Vercel Serverless Function: Relay zu Make-Webhooks
export default async function handler(req, res) {
  // CORS (einfach gehalten)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Webhook-Secret");

  if (req.method === "OPTIONS") return res.status(204).send("");

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Ziel-Webhook in ENV (Vercel → Project → Settings → Environment Variables)
  const url = process.env.MAKE_WEBHOOK_URL
    || "https://hook.us2.make.com/5e92q8frgmrood9tkbjp69zcr4itow8h"; // fallback

  // Optional: Basic-Auth für Make (falls in Make aktiviert)
  const user = process.env.MAKE_WEBHOOK_USER || "";
  const pass = process.env.MAKE_WEBHOOK_PASS || "";
  const headers = { "Content-Type": "application/json" };

  if (user || pass) {
    const token = Buffer.from(`${user}:${pass}`).toString("base64");
    headers["Authorization"] = `Basic ${token}`;
  }

  // Optional: Shared Secret Header (falls du in Make per Filter prüfst)
  if (process.env.MAKE_WEBHOOK_SECRET) {
    headers["X-Webhook-Secret"] = process.env.MAKE_WEBHOOK_SECRET;
  }

  try {
    // Body 1:1 weiterreichen
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body || {})
    });

    const ct = upstream.headers.get("content-type") || "text/plain";
    const text = await upstream.text();
    res.setHeader("Content-Type", ct);
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(502).send(`Relay error: ${e?.message || String(e)}`);
  }
}
