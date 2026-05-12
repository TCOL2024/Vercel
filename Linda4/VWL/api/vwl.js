const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.4";

const MODE_CONFIG = {
  fragen: {
    label: "Fragen",
    instruction:
      "Beantworte VWL-Fragen kompakt und aussagefaehig. Nutze Dokumentwissen vorrangig. Wenn die Frage unklar oder zu breit ist, stelle eine kurze Rueckfrage.",
  },
  lernkarten: {
    label: "Lernkarten",
    instruction:
      "Erstelle praegnante Lernkarten. Nutze das Format 'Vorderseite' und 'Rueckseite'. Halte die Karten pruefungsnah und vermeide Nebensaechliches.",
  },
  uebungen: {
    label: "Uebungsaufgaben",
    instruction:
      "Erstelle VWL-Uebungsaufgaben mit Loesung und kurzer Erklaerung. Bevorzuge Aufgaben, die fuer IHK-Teilnehmende praxisnah und pruefungsnah sind.",
  },
  uebersetzen: {
    label: "Uebersetzen",
    instruction:
      "Uebersetze oder vereinfache den Text fachlich sauber. Veraendere den Inhalt nicht unnoetig und erhalte wichtige VWL-Fachbegriffe.",
  },
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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
      if (body.length > 1_000_000) {
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

function buildSystemPrompt(mode) {
  const modeInstruction = MODE_CONFIG[mode]?.instruction || MODE_CONFIG.fragen.instruction;

  return [
    "Du bist VWL-Linda 4, ein kompakter Lernassistent fuer Volkswirtschaftslehre.",
    "Du unterstuetzt Teilnehmende in IHK-nahen VWL-Kursen.",
    "",
    "Grundregeln:",
    "- Antworte kurz, klar und fachlich sauber.",
    "- Dokumentwissen aus dem VWL-Vectorstore hat Vorrang vor allgemeinem Modellwissen.",
    "- Allgemeines VWL-Wissen darf ergaenzen, aber Dokumentinhalte nicht ueberschreiben.",
    "- Wenn die Dokumente keine belastbare Antwort liefern, kennzeichne allgemeines Wissen als Ergaenzung.",
    "- Wenn die Frage zu unklar ist, stelle lieber eine kurze Rueckfrage.",
    "- Nenne Quellen, sobald du Dokumentinhalte nutzt.",
    "- Gib zu jeder Quelle, wenn moeglich, einen kurzen Ausschnitt oder eine sinngemaesse Fundstelle an.",
    "- Erfinde keine Dokumenttitel, Seitenzahlen oder Zitate.",
    "",
    `Modus: ${MODE_CONFIG[mode]?.label || MODE_CONFIG.fragen.label}`,
    modeInstruction,
    "",
    "Gewuenschtes Ausgabeformat:",
    "Kurzantwort:",
    "...",
    "",
    "Aus den Unterlagen:",
    "...",
    "",
    "Quellen:",
    "- Dokument/Fundstelle: kurzer Ausschnitt oder Hinweis",
    "",
    "Ergaenzung:",
    "...",
  ].join("\n");
}

function extractTextFromResponse(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function extractSources(data) {
  const sources = [];

  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type !== "output_text" || !Array.isArray(content.annotations)) {
        continue;
      }

      for (const annotation of content.annotations) {
        const fileName = annotation.filename || annotation.title || annotation.file_name;
        const fileId = annotation.file_id;
        const quote = annotation.quote || annotation.text || annotation.snippet;

        if (!fileName && !fileId && !quote) {
          continue;
        }

        sources.push({
          title: fileName || fileId || "Quelle",
          fileId: fileId || null,
          snippet: quote || null,
        });
      }
    }
  }

  return sources.filter((source, index, list) => {
    const key = `${source.title}:${source.fileId || ""}:${source.snippet || ""}`;
    return list.findIndex((candidate) => `${candidate.title}:${candidate.fileId || ""}:${candidate.snippet || ""}` === key) === index;
  });
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
      service: "VWL-Linda 4 API",
      model: MODEL,
      configured: {
        apiKey: Boolean(process.env.VWL2026LINDA4 || process.env.OPENAI_API_KEY),
        vectorStore: Boolean(
          process.env["VWL-Vectorstore"] ||
            process.env.VWL_VECTOR_STORE_ID ||
            process.env.VWL_VECTORSTORE
        ),
      },
    });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.VWL2026LINDA4 || process.env.OPENAI_API_KEY;
  const vectorStoreId =
    process.env["VWL-Vectorstore"] ||
    process.env.VWL_VECTOR_STORE_ID ||
    process.env.VWL_VECTORSTORE;

  if (!apiKey || !vectorStoreId) {
    json(res, 500, {
      error: "VWL API ist noch nicht vollstaendig konfiguriert.",
      missing: {
        apiKey: !apiKey,
        vectorStore: !vectorStoreId,
      },
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

  const question = String(body.question || "").trim();
  const mode = MODE_CONFIG[body.mode] ? body.mode : "fragen";

  if (!question) {
    json(res, 400, { error: "Bitte eine Frage oder einen Text eingeben." });
    return;
  }

  try {
    const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: buildSystemPrompt(mode),
        input: [
          {
            role: "user",
            content: question,
          },
        ],
        tools: [
          {
            type: "file_search",
            vector_store_ids: [vectorStoreId],
          },
        ],
      }),
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      json(res, openAiResponse.status, {
        error: data.error?.message || "OpenAI API Fehler.",
        details: data.error || data,
      });
      return;
    }

    json(res, 200, {
      answer: extractTextFromResponse(data),
      sources: extractSources(data),
      mode,
      model: MODEL,
    });
  } catch (error) {
    json(res, 500, {
      error: "Die VWL API konnte die Anfrage nicht verarbeiten.",
      details: error.message,
    });
  }
};
