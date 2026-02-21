// /api/translate.js  (Vercel Serverless Function)

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function isFreeKey(key) {
  return typeof key === "string" && key.endsWith(":fx");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed. Use POST." });
  }

  const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
  if (!DEEPL_API_KEY) {
    return json(res, 500, { error: "Server not configured: missing DEEPL_API_KEY" });
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  const text = (body.text ?? "").toString();
  const target_lang = (body.target_lang ?? "DE").toString().toUpperCase();
  const source_lang = body.source_lang ? body.source_lang.toString().toUpperCase() : "";
  const formality = body.formality ? body.formality.toString() : "";

  if (!text.trim()) return json(res, 400, { error: "Missing text" });
  if (text.length > 1000) return json(res, 400, { error: "Text too long (max 1000 characters)" });

  const base = isFreeKey(DEEPL_API_KEY) ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const url = `${base}/v2/translate`;

  // DeepL erwartet hier Form-Encoded
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("target_lang", target_lang);
  if (source_lang) params.append("source_lang", source_lang);
  if (formality) params.append("formality", formality);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      // DeepL liefert oft message/error - wir geben beides zurück
      return json(res, r.status, { error: data?.message || data?.error || `DeepL error (HTTP ${r.status})` });
    }

    const translated = data?.translations?.[0]?.text || "";
    return json(res, 200, { result: translated });

  } catch (e) {
    return json(res, 500, { error: e?.message || "Server error" });
  }
};
