const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.VWL_KREATIV_MODEL || process.env.OPENROUTER_VWL_MODEL || "amazon/nova-lite-v1";
const API_KEY_ENV_NAMES = ["VWLBOT", "OPENROUTER_API_KEY", "VWL_OPENROUTER_API_KEY"];
const HISTORY_LIMIT = 4;
const HISTORY_ITEM_LIMIT = 900;
const QUESTION_LIMIT = 4000;

function readFirstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 600_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeCreativeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => String(entry.role || "").toLowerCase() === "user")
    .map((entry) => {
      const content = compactText(entry.content || "").slice(0, HISTORY_ITEM_LIMIT);
      return content ? { role: "user", content } : null;
    })
    .filter(Boolean)
    .slice(-HISTORY_LIMIT);
}

function buildMessages(question, history) {
  return [
    {
      role: "system",
      content: [
        "Du bist der Kreativmodus von VWL-Linda 4.",
        "Wichtig: Du hast keinen Zugriff auf den VWL-Vectorstore, keine Kursunterlagen und keine Quellenanzeige.",
        "Nutze nur allgemeines Wissen und den Text, den der Nutzer direkt in dieser Kreativ-Anfrage schreibt.",
        "Behaupte keine Dokumentquelle und zitiere keine Unterlagen.",
        "Wenn der Nutzer Inhalte aus den Unterlagen verlangt, sage knapp: 'Dafuer bitte den Fragen-Modus mit Quellen nutzen.'",
        "Antworte extrem schlank: maximal 90 Woerter, maximal 5 kurze Bulletpoints oder 1 kurzer Absatz.",
        "Keine langen Einleitungen, keine Meta-Erklaerungen, keine Wiederholung der Frage.",
        "Sei hilfreich fuer Brainstorming, Formulierungen, Beispiele, Lernideen, Eselsbruecken und Unterrichtsimpulse.",
      ].join("\n"),
    },
    ...history,
    { role: "user", content: question },
  ];
}

function parseJsonSafe(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return { raw };
  }
}

function extractAnswer(data) {
  return compactText(data?.choices?.[0]?.message?.content || data?.output_text || "");
}

async function callOpenRouter({ apiKey, question, history }) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://linda-4.vercel.app/VWL/index.html",
      "X-Title": "VWL-Linda 4 Kreativmodus",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: buildMessages(question, history),
      temperature: 0.65,
      top_p: 0.9,
      max_tokens: 220,
      stream: false,
    }),
  });

  const raw = await response.text();
  const data = parseJsonSafe(raw);

  if (!response.ok) {
    const error = new Error(data.error?.message || data.error || raw || "OpenRouter API Fehler.");
    error.statusCode = response.status;
    error.details = data.error || data;
    throw error;
  }

  return {
    answer: extractAnswer(data),
    usage: data.usage || null,
    routedModel: data.model || MODEL,
  };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET") {
    json(res, 200, {
      ok: true,
      service: "VWL-Linda 4 Kreativ API",
      provider: "openrouter",
      model: MODEL,
      noVectorStore: true,
      configured: {
        openRouterKey: Boolean(readFirstEnv(API_KEY_ENV_NAMES)),
      },
      expectedEnv: {
        openRouterKey: API_KEY_ENV_NAMES,
        optional: ["VWL_KREATIV_MODEL", "OPENROUTER_VWL_MODEL"],
      },
    });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = readFirstEnv(API_KEY_ENV_NAMES);
  if (!apiKey) {
    json(res, 500, {
      error: "Kreativ-API ist noch nicht konfiguriert.",
      missing: { openRouterKey: true },
      expectedEnv: API_KEY_ENV_NAMES,
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    json(res, 400, { error: "Ungueltiges JSON im Request." });
    return;
  }

  const question = compactText(body.question || body.prompt || body.input || "").slice(0, QUESTION_LIMIT);
  const history = sanitizeCreativeHistory(body.history || body.creativeHistory || []);

  if (!question) {
    json(res, 400, { error: "Bitte eine Kreativ-Anfrage eingeben." });
    return;
  }

  try {
    const result = await callOpenRouter({ apiKey, question, history });
    json(res, 200, {
      answer: result.answer || "Ich habe keine Kreativ-Antwort erhalten.",
      sources: [],
      mode: "kreativ",
      provider: "openrouter",
      model: result.routedModel || MODEL,
      configuredModel: MODEL,
      noVectorStore: true,
      context: {
        used: history.length > 0,
        messages: history.length,
        creativeOnly: true,
      },
      meta: {
        usage: result.usage,
      },
    });
  } catch (error) {
    json(res, error.statusCode || 500, {
      error: "Die Kreativ-API konnte die Anfrage nicht verarbeiten.",
      details: error.message,
    });
  }
};
