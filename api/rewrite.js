// /api/rewrite.js (Vercel Serverless Function)
// ENV nötig: ReWrite

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed. Use POST." });
  }

  const ReWrite = process.env.ReWrite;
  if (!ReWrite) {
    return json(res, 500, { error: "Server not configured: missing ReWrite" });
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  const text = (body.text ?? "").toString();
  const style = (body.style ?? "neutral").toString();

  if (!text.trim()) return json(res, 400, { error: "Missing text" });
  if (text.length > 1000) return json(res, 400, { error: "Text too long (max 1000 characters)" });

  const styleHint = ({
    neutral: "Formuliere klar, neutral und gut lesbar um.",
    freundlich: "Formuliere freundlich, zugewandt und klar um.",
    formell: "Formuliere formell, sachlich und professionell um.",
    kurz: "Kürze den Text deutlich, ohne wichtige Inhalte zu verlieren.",
    besser: "Verbessere Stil, Struktur und Verständlichkeit, ohne Inhalt zu verändern."
  })[style] || "Formuliere klar und neutral um.";

  try {
    // OpenAI Responses API (serverseitig)
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ReWrite}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        input: [
          {
            role: "system",
            content: "Du bist ein präziser Schreibassistent. Du gibst nur den umformulierten Text zurück – ohne Erklärungen."
          },
          {
            role: "user",
            content: `${styleHint}\n\nText:\n${text}`
          }
        ],
        max_output_tokens: 600
      })
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(res, r.status, { error: data?.error?.message || "OpenAI error" });
    }

    // Text aus der Response extrahieren
    const out =
      data?.output_text ||
      (Array.isArray(data?.output) ? data.output.map(x => x?.content?.map(c => c?.text).join("")).join("") : "");

    return json(res, 200, { result: (out || "").trim() });
  } catch (e) {
    return json(res, 500, { error: e?.message || "Server error" });
  }
}
