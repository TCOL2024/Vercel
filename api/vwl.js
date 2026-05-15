const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = process.env.VWL_OPENAI_MODEL || "gpt-5.4";
const FAST_MODEL = process.env.VWL_FAST_MODEL || process.env.VWL_FAST_RETRIEVAL_MODEL || "gpt-4.1-mini";

const MODE_CONFIG = {
  fragen: {
    label: "Fragen",
    instruction:
      "Beantworte VWL-Fragen kompakt und aussagefähig. Nutze Dokumentwissen vorrangig. Wenn die Frage unklar oder zu breit ist, stelle eine kurze Rückfrage.",
  },
  lernkarten: {
    label: "Lernkarten",
    instruction:
      "Erstelle prägnante Lernkarten. Nutze das Format 'Vorderseite' und 'Rückseite'. Halte die Karten prüfungsnah und vermeide Nebensächliches.",
  },
  uebungen: {
    label: "Übungsaufgaben",
    instruction:
      "Erstelle VWL-Übungsaufgaben mit Lösung und kurzer Erklärung. Bevorzuge Aufgaben, die für IHK-Teilnehmende praxisnah und prüfungsnah sind.",
  },
  uebersetzen: {
    label: "Übersetzen",
    instruction:
      "Übersetze oder vereinfache den Text fachlich sauber. Verändere den Inhalt nicht unnötig und erhalte wichtige VWL-Fachbegriffe.",
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
const SOURCE_SNIPPET_LIMIT = 1100;
const HISTORY_LIMIT = 8;
const HISTORY_ITEM_LIMIT = 1600;

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

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeIntentText(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/\u00e4/g, "ae")
    .replace(/\u00f6/g, "oe")
    .replace(/\u00fc/g, "ue")
    .replace(/\u00df/g, "ss");
}

function limitSnippet(value) {
  const text = compactText(value);
  if (text.length <= SOURCE_SNIPPET_LIMIT) {
    return text;
  }
  return `${text.slice(0, SOURCE_SNIPPET_LIMIT - 3).trim()}...`;
}

function sanitizeHistory(history, limit = HISTORY_LIMIT) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const roleRaw = String(entry.role || "").toLowerCase();
      const role = roleRaw === "assistant" ? "assistant" : "user";
      const content = compactText(entry.content || "").slice(0, HISTORY_ITEM_LIMIT);
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean)
    .slice(-limit);
}

function needsContextClarification(question, history) {
  if (history.length) return false;
  const text = normalizeIntentText(question).replace(/[!?.,;:]+$/g, "");
  if (!text) return false;
  const exact = new Set([
    "das",
    "dazu",
    "damit",
    "weiter",
    "mach weiter",
    "erklaere das",
    "erklaer das",
    "was bedeutet das",
    "nochmal",
    "genauer",
  ]);
  if (exact.has(text)) return true;
  return text.length < 22 && /\b(das|dazu|damit|weiter|dies|diese|dieser|dieses)\b/.test(text);
}

function buildSystemPrompt(mode, fastMode = false) {
  const modeInstruction = MODE_CONFIG[mode]?.instruction || MODE_CONFIG.fragen.instruction;

  return [
    "Du bist VWL-Linda 4, ein kompakter Lernassistent für Volkswirtschaftslehre.",
    "Du unterstützt Teilnehmende in IHK-nahen VWL-Kursen.",
    "",
    "Grundregeln:",
    "- Antworte kurz, klar und fachlich sauber.",
    "- Dokumentwissen aus dem VWL-Vectorstore hat Vorrang vor allgemeinem Modellwissen.",
    "- Allgemeines VWL-Wissen darf ergänzen, aber Dokumentinhalte nicht überschreiben.",
    "- Wenn die Dokumente keine belastbare Antwort liefern, kennzeichne allgemeines Wissen als Ergänzung.",
    "- Wenn die Frage zu unklar ist, stelle lieber eine kurze Rückfrage.",
    "- Nenne Quellen, sobald du Dokumentinhalte nutzt.",
    "- Gib zu jeder Quelle, wenn möglich, einen kurzen Ausschnitt oder eine sinngemäße Fundstelle an.",
    "- Erfinde keine Dokumenttitel, Seitenzahlen oder Zitate.",
    "",
    "Kontextregeln:",
    "- Nutze den bisherigen Verlauf, um Anschlussfragen wie 'das', 'dazu' oder 'weiter' korrekt zu verstehen.",
    "- Wiederhole den Verlauf nicht unnötig; greife ihn nur auf, wenn er für die Antwort hilft.",
    "- Wenn ein Bezug trotz Verlauf unklar bleibt, frage kurz nach dem gemeinten Thema.",
    "",
    fastMode ? "Fastmodus: Antworte besonders knapp und schnell, aber weiterhin quellenbasiert." : "",
    `Modus: ${MODE_CONFIG[mode]?.label || MODE_CONFIG.fragen.label}`,
    modeInstruction,
    "",
    "Gewünschtes Ausgabeformat:",
    "Kurzantwort:",
    "...",
    "",
    "Aus den Unterlagen:",
    "...",
    "",
    "Quellen:",
    "- Dokument/Fundstelle: kurzer Ausschnitt oder Hinweis",
    "",
    "Ergänzung:",
    "...",
  ].filter(Boolean).join("\n");
}

function buildInputMessages(question, history) {
  return [
    ...history.map((entry) => ({ role: entry.role, content: entry.content })),
    { role: "user", content: question },
  ];
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
    const key = `${source.title}:${source.fileId || ""}:${source.page || ""}:${source.snippet || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  return uniqueSources([
    ...extractSearchResultSources(data),
    ...extractAnnotationSources(data),
  ]).slice(0, 6);
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
    return uniqueSources(answerSources).slice(0, 6);
  }

  return uniqueSources([...technicalSources, ...answerSources]).slice(0, 6);
}

function parseJsonSafe(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return { raw };
  }
}

async function callOpenAIWithFileSearch({ apiKey, vectorStoreId, model, mode, question, history, fastMode = false, maxOutputTokens }) {
  const requestBody = {
    model,
    instructions: buildSystemPrompt(mode, fastMode),
    input: buildInputMessages(question, history),
    tools: [
      {
        type: "file_search",
        vector_store_ids: [vectorStoreId],
        max_num_results: 6,
      },
    ],
    include: ["file_search_call.results"],
  };

  if (maxOutputTokens) {
    requestBody.max_output_tokens = maxOutputTokens;
  }

  const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const raw = await openAiResponse.text();
  const data = parseJsonSafe(raw);

  if (!openAiResponse.ok) {
    const error = new Error(data.error?.message || data.error || raw || "OpenAI API Fehler.");
    error.statusCode = openAiResponse.status;
    error.details = data.error || data;
    throw error;
  }

  const answer = extractTextFromResponse(data);
  const sources = enrichSourcesFromAnswer(answer, extractSources(data));

  return {
    answer,
    sources,
    model,
  };
}

async function callFastOpenAIWithFallback(options) {
  try {
    return await callOpenAIWithFileSearch({
      ...options,
      model: FAST_MODEL,
      fastMode: true,
      maxOutputTokens: 900,
    });
  } catch (error) {
    if (FAST_MODEL === MODEL) {
      throw error;
    }
    const fallback = await callOpenAIWithFileSearch({
      ...options,
      model: MODEL,
      fastMode: true,
      maxOutputTokens: 900,
    });
    return {
      ...fallback,
      fastFallbackError: error.message,
    };
  }
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
      fastModel: FAST_MODEL,
      configured: {
        apiKey: Boolean(readFirstEnv(API_KEY_ENV_NAMES)),
        vectorStore: Boolean(readFirstEnv(VECTOR_STORE_ENV_NAMES)),
      },
      expectedEnv: {
        apiKey: API_KEY_ENV_NAMES,
        vectorStore: VECTOR_STORE_ENV_NAMES,
        optional: ["VWL_OPENAI_MODEL", "VWL_FAST_MODEL", "VWL_FAST_RETRIEVAL_MODEL"],
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
      error: "VWL API ist noch nicht vollständig konfiguriert.",
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
    json(res, 400, { error: "Ungültiges JSON im Request." });
    return;
  }

  const question = String(body.question || body.prompt || body.input || "").trim();
  const mode = MODE_CONFIG[body.mode] ? body.mode : "fragen";
  const history = sanitizeHistory(body.history || body.messages || []);
  const preferredModel = String(body.routing?.preferred_model || "").toLowerCase();
  const fastMode = Boolean(body.fastMode || body.schnellmodus || preferredModel === "fast");

  if (!question) {
    json(res, 400, { error: "Bitte eine Frage oder einen Text eingeben." });
    return;
  }

  if (needsContextClarification(question, history)) {
    json(res, 200, {
      answer: "Worauf soll ich mich beziehen? Bitte nenne kurz das VWL-Thema oder stelle die Anschlussfrage zusammen mit dem Bezug.",
      sources: [],
      mode,
      model: fastMode ? FAST_MODEL : MODEL,
      context: {
        used: false,
        needsClarification: true,
      },
    });
    return;
  }

  try {
    const result = fastMode
      ? await callFastOpenAIWithFallback({ apiKey, vectorStoreId, mode, question, history })
      : await callOpenAIWithFileSearch({ apiKey, vectorStoreId, model: MODEL, mode, question, history });

    json(res, 200, {
      answer: result.answer,
      sources: result.sources,
      mode,
      model: result.model,
      fastMode,
      fastProvider: fastMode ? "openai-fast-vectorstore" : null,
      context: {
        used: history.length > 0,
        messages: history.length,
      },
      meta: {
        fastFallbackError: result.fastFallbackError || "",
      },
    });
  } catch (error) {
    json(res, error.statusCode || 500, {
      error: "Die VWL API konnte die Anfrage nicht verarbeiten.",
      details: error.message,
    });
  }
};
