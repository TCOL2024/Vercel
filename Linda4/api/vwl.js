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

const API_KEY_ENV_NAMES = ["VWL2026LINDA4", "OPENAI_API_KEY"];
const VECTOR_STORE_ENV_NAMES = [
  "VWL-Vectorstore",
  "VWL_VECTOR_STORE_ID",
  "VWL_VECTORSTORE",
  "VWL_VECTORSTORE_ID",
  "VWL_VECTOR_STORE",
  "VWL_Vectorstore",
  "VWL_VECTOR",
];
const SOURCE_SNIPPET_LIMIT = 900;

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

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function limitSnippet(value) {
  const text = compactText(value);
  if (text.length <= SOURCE_SNIPPET_LIMIT) {
    return text;
  }
  return `${text.slice(0, SOURCE_SNIPPET_LIMIT - 1).trim()}…`;
}

function textFromSearchResult(result) {
  if (typeof result?.text === "string") return result.text;
  if (typeof result?.content === "string") return result.content;
  if (Array.isArray(result?.content)) {
    return result.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return result?.snippet || result?.quote || "";
}

function normalizeSource(source) {
  const title = compactText(
    source?.filename ||
      source?.file_name ||
      source?.title ||
      source?.name ||
      source?.document ||
      source?.file_id ||
      "Quelle"
  );
  const fileId = compactText(source?.file_id || source?.fileId || "");
  const page = compactText(source?.page || source?.page_number || source?.attributes?.page || "");
  const scoreRaw = source?.score ?? source?.ranking_score ?? source?.similarity;
  const score = typeof scoreRaw === "number" ? scoreRaw.toFixed(2) : compactText(scoreRaw);
  const snippet = limitSnippet(source?.snippet || source?.quote || source?.text || textFromSearchResult(source));

  if (!title && !fileId && !snippet) {
    return null;
  }

  return {
    title: title || fileId || "Quelle",
    fileId: fileId || null,
    page: page || null,
    score: score || null,
    snippet: snippet || null,
  };
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (!source) return false;
    const key = `${source.title}:${source.page || ""}:${source.snippet || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceScore(source) {
  const score = Number(source?.score);
  return Number.isFinite(score) ? score : null;
}

function rankSources(sources) {
  const unique = uniqueSources(sources);
  const scored = unique
    .map((source, index) => ({ source, index, score: sourceScore(source) }))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.index - b.index;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });

  const bestScore = scored.find((entry) => entry.score !== null)?.score;
  const threshold = bestScore === undefined ? null : Math.max(0.45, bestScore - 0.14);

  return scored
    .filter((entry) => threshold === null || entry.score === null || entry.score >= threshold)
    .map((entry) => entry.source)
    .slice(0, 4);
}

function extractSearchResultSources(data) {
  const sources = [];

  for (const item of data.output || []) {
    if (item.type !== "file_search_call") {
      continue;
    }

    const results = item.search_results || item.results || [];
    for (const result of results) {
      sources.push(normalizeSource(result));
    }
  }

  return uniqueSources(sources);
}

function extractAnnotationSources(data) {
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

        sources.push(normalizeSource({
          title: fileName,
          file_id: fileId,
          snippet: quote,
        }));
      }
    }
  }

  return uniqueSources(sources);
}

function extractSources(data) {
  return rankSources([
    ...extractSearchResultSources(data),
    ...extractAnnotationSources(data),
  ]);
}

function extractAnswerSourceLines(answerText) {
  const lines = String(answerText || "").split(/\r?\n/);
  const sources = [];
  let inSources = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^quellen\s*:/i.test(line)) {
      inSources = true;
      continue;
    }

    if (inSources && /^(ergaenzung|ergänzung|kurzantwort|aus den unterlagen|lernkarten|uebungsaufgaben|übungsaufgaben)\s*:/i.test(line)) {
      break;
    }

    if (!inSources || !/^[-*]\s+/.test(line)) {
      continue;
    }

    const cleaned = line.replace(/^[-*]\s+/, "").trim();
    const [rawTitle, ...rest] = cleaned.split(":");
    const title = compactText(rest.length ? rawTitle : "Quelle aus der Antwort");
    const snippet = limitSnippet(rest.length ? rest.join(":") : cleaned);

    sources.push(normalizeSource({
      title,
      snippet,
    }));
  }

  return uniqueSources(sources);
}

function enrichSourcesFromAnswer(answerText, technicalSources) {
  const answerSources = extractAnswerSourceLines(answerText);
  if (!answerSources.length) {
    return technicalSources;
  }

  const technicalHasSnippets = technicalSources.some((source) => source?.snippet);
  if (!technicalSources.length || !technicalHasSnippets) {
    return rankSources(answerSources);
  }

  return rankSources([...technicalSources, ...answerSources]);
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
        apiKey: Boolean(readFirstEnv(API_KEY_ENV_NAMES)),
        vectorStore: Boolean(readFirstEnv(VECTOR_STORE_ENV_NAMES)),
      },
      expectedEnv: {
        apiKey: API_KEY_ENV_NAMES,
        vectorStore: VECTOR_STORE_ENV_NAMES,
      },
    });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = readFirstEnv(API_KEY_ENV_NAMES);
  const vectorStoreId = readFirstEnv(VECTOR_STORE_ENV_NAMES);

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
            max_num_results: 6,
          },
        ],
        include: ["file_search_call.results"],
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

    const answer = extractTextFromResponse(data);
    const sources = enrichSourcesFromAnswer(answer, extractSources(data));

    json(res, 200, {
      answer,
      sources,
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
