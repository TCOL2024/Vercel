module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const apiKey = process.env.ASK;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing ASK environment variable" }));
    return;
  }

  let body = req.body;
  try {
    if (!body || typeof body === "string") {
      body = JSON.parse(body || "{}");
    }
  } catch {
    body = {};
  }

  const question = (body && body.question ? String(body.question) : "").trim();
  if (!question) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Question is required" }));
    return;
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.2,
        input: [
          {
            role: "system",
            content:
              "Beantworte die Frage des Users sehr genau, analysiere sie und gebe eine sehr gute Rückmeldung. " +
              "Gib am Ende den Hinweis, dass keine Rückfrage gestellt werden kann und die Frage neu eingegeben werden muss, falls etwas unklar ist. " +
              "Gib am Ende außerdem einen Disclaimer gemäß Artikel 50 AI Act, dass diese Antwort KI-generiert ist."
          },
          {
            role: "user",
            content: question
          }
        ]
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      res.statusCode = upstream.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: data.error?.message || "Upstream error" }));
      return;
    }

    let result = "";
    if (typeof data.output_text === "string") {
      result = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item && item.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part && part.type === "output_text" && typeof part.text === "string") {
              result += part.text;
            }
          }
        }
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ result: result.trim() }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err.message || "Server error" }));
  }
};
