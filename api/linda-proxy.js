module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST")    return res.status(405).send("Method Not Allowed");

  const url = "https://hook.us2.make.com/5e92q8frgmrood9tkbjp69zcr4itow8h";
  // später: const url = process.env.MAKE_WEBHOOK_URL_LINDA;

  let bodyObj = {};
  try {
    bodyObj = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch (_) { bodyObj = {}; }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj)
    });
    const ct   = upstream.headers.get("content-type") || "text/plain";
    const text = await upstream.text();
    res.setHeader("Content-Type", ct);
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(502).json({ error: "Relay error", detail: String(e) });
  }
};
