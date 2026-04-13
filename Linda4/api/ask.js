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

  const moderationPayload = {
    model: "omni-moderation-latest",
    input: question
  };

  try {
    const modRes = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(moderationPayload)
    });

    const modData = await modRes.json().catch(() => ({}));
    const flagged =
      !!modData?.results?.[0]?.flagged ||
      !!modData?.results?.[0]?.categories?.hate ||
      !!modData?.results?.[0]?.categories?.["hate/threatening"] ||
      !!modData?.results?.[0]?.categories?.harassment ||
      !!modData?.results?.[0]?.categories?.["harassment/threatening"] ||
      !!modData?.results?.[0]?.categories?.sexual ||
      !!modData?.results?.[0]?.categories?.["sexual/minors"] ||
      !!modData?.results?.[0]?.categories?.violence ||
      !!modData?.results?.[0]?.categories?.["violence/graphic"];

    if (!modRes.ok) {
      res.statusCode = modRes.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: modData.error?.message || "Moderation error" }));
      return;
    }

    if (flagged) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        error: "Diese Anfrage kann nicht verarbeitet werden. Bitte formuliere die Frage ohne strafbare, sexuelle, rassistische oder diskriminierende Inhalte."
      }));
      return;
    }

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
              "Antworte im klaren, strukturierten Stil wie bei ChatGPT: kurze Einleitung, dann übersichtliche Punkte/Absätze, " +
              "konkrete Antworten und wenn sinnvoll eine knappe Zusammenfassung. " +
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

    if (result) {
      const outModRes = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model: "omni-moderation-latest", input: result })
      });

      const outModData = await outModRes.json().catch(() => ({}));
      const outFlagged =
        !!outModData?.results?.[0]?.flagged ||
        !!outModData?.results?.[0]?.categories?.hate ||
        !!outModData?.results?.[0]?.categories?.["hate/threatening"] ||
        !!outModData?.results?.[0]?.categories?.harassment ||
        !!outModData?.results?.[0]?.categories?.["harassment/threatening"] ||
        !!outModData?.results?.[0]?.categories?.sexual ||
        !!outModData?.results?.[0]?.categories?.["sexual/minors"] ||
        !!outModData?.results?.[0]?.categories?.violence ||
        !!outModData?.results?.[0]?.categories?.["violence/graphic"];

      if (!outModRes.ok) {
        res.statusCode = outModRes.status || 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: outModData.error?.message || "Moderation error" }));
        return;
      }

      if (outFlagged) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          error: "Die Antwort wurde blockiert, da sie gegen Inhaltsrichtlinien verstößt."
        }));
        return;
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
