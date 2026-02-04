// /api/translate.js  (Vercel Serverless Function)
// Node 18+ (fetch ist global verfügbar)

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function isDeepLFreeKey(key) {
  return typeof key === "string" && key.endsWith(":fx"); // DeepL API Free keys end with :fx :contentReference[oaicite:1]{index=1}
}

export default async function handler(req, res) {
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

  const text = (body.text || "").toString();
  const mode = (body.mode || "translate").toString(); // "translate" | "improve"
  const target_lang = (body.target_lang || "DE").toString();
  const formality = (body.formality || "").toString(); // "", "more", "less"

  if (!text.trim()) return json(res, 400, { error: "Missing text" });
  if (text.length > 1000) return json(res, 400, { error: "Text too long (max 1000 characters)" });

  // DeepL API Free: translate ok, Write/Improve nur in API Pro :contentReference[oaicite:2]{index=2}
  const freeKey = isDeepLFreeKey(DEEPL_API_KEY);
  if (mode === "improve" && freeKey) {
    return json(res, 402, {
      error: "DeepL Write (Text verbessern) ist nicht in DeepL API Free enthalten. Nutze 'translate' oder wechsle zu API Pro."
    });
  }

  try {
    if (mode === "improve") {
      // DeepL Write API endpoint: /v2/write/rephrase :contentReference[oaicite:3]{index=3}
      // Hinweis: Write übersetzt nicht, es verbessert/rephrasiert nur. :contentReference[oaicite:4]{index=4}
      const url = "https://api.deepl.com/v2/write/rephrase";

      const payload = {
        text,
        // target_lang optional (z.B. EN-GB vs EN-US) – Write ist keine Übersetzung :contentReference[oaicite:5]{index=5}
        target_lang,
        ...(formality ? { formality } : {})
      };

      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return json(res, r.status, { error: data?.message || data?.error || `DeepL error (HTTP ${r.status})` });
      }

      // Ergebnisformat: improvements[] (je nach API-Version); wir nehmen den ersten Text
      const improved =
        data?.improvements?.[0]?.text ||
        data?.results?.[0]?.text ||
        data?.text ||
        "";

      return json(res, 200, { result: improved });
    }

    // Default: translate
    // Free plan uses api-free.deepl.com instead of api.deepl.com :contentReference[oaicite:6]{index=6}
    const base = freeKey ? "https://api-free.deepl.com" : "https://api.deepl.com";
    const url = `${base}/v2/translate`;

    const payload = {
      text,
      target_lang,
      ...(formality ? { formality } : {})
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(res, r.status, { error: data?.message || data?.error || `DeepL error (HTTP ${r.status})` });
    }

    const translated = data?.translations?.[0]?.text || "";
    return json(res, 200, { result: translated });
  } catch (e) {
    return json(res, 500, { error: e?.message || "Server error" });
  }
}
