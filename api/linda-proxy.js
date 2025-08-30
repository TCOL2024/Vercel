export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // 👉 NEUE ENV-VAR
  const url = process.env.lindaversgpt5;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
