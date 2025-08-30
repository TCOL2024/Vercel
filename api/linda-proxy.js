// /api/linda-proxy.js  (ESM default export)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST")    return res.status(405).send("Method Not Allowed");

  // Zum Test: harte URL (ENV erst später wieder zuschalten)
  const url = "https://hook.us2.make.com/sfpbejl2im7hx86dlstw8hsfu88xe9po";

  // Body robust parsen (je nach Vercel-Parser)
  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { body = {}; }

  try {
    const up = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const ct = up.headers.get("content-type") || "text/plain";
    const txt = await up.text();
    res.setHeader("Content-Type", ct);
    return res.status(up.status).send(txt);
  } catch (e) {
    return res.status(502).json({ error: "Relay error", detail: String(e) });
  }
}
