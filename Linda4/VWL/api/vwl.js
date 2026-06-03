const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";

const OPENAI_MODEL = readFirstEnv(["VWL_OPENAI_MODEL"]) || "gpt-5.4";
const CLAUDE_MODEL = readFirstEnv(["VWL_INTELLIGENT_MODEL", "VWL_CLAUDE_MODEL"]) || "anthropic/claude-3.5-haiku";
const DEEPSEEK_MODEL = readFirstEnv(["VWL_DEEPSEEK_MODEL", "VWL_FAST_MODEL", "DEEPSEEK_MODEL"]) || "deepseek-reasoner";

const MODE_CONFIG = {
  fragen: {
    label: "Fragen",
    instruction: "Beantworte VWL-Fragen kompakt und aussagefähig. Wenn die Frage unklar oder zu breit ist, stelle eine kurze Rückfrage.",
  },
  lernkarten: {
    label: "Lernkarten",
    instruction: "Erstelle prägnante Lernkarten im Format Vorderseite und Rückseite. Halte die Karten prüfungsnah und vermeide Nebensächliches.",
  },
  uebungen: {
    label: "Übungsaufgaben",
    instruction: "Erstelle VWL-Übungsaufgaben mit Lösung und kurzer Erklärung. Bevorzuge IHK-nahe, praxisnahe Aufgaben.",
  },
  uebersetzen: {
    label: "Übersetzen",
    instruction: "Übersetze oder vereinfache den Text fachlich sauber. Erhalte wichtige VWL-Fachbegriffe.",
  },
};

const PROFILE_CONFIG = {
  schnell: {
    provider: "deepseek",
    model: DEEPSEEK_MODEL,
    usesDocuments: false,
    dataLabel: "Ohne Unterlagen",
  },
  intelligent: {
    provider: "openrouter",
    model: CLAUDE_MODEL,
    usesDocuments: false,
    dataLabel: "Ohne Unterlagen",
  },
  fortgeschritten: {
    provider: "openai-vectorstore",
    model: OPENAI_MODEL,
    usesDocuments: true,
    dataLabel: "Mit Unterlagen",
  },
};

const API_KEY_ENV_NAMES = ["VWL2026LINDA4", "OPENAI_API_KEY"];
const OPENROUTER_KEY_ENV_NAMES = ["VWLBOT", "OPENROUTER_API_KEY", "VWL_OPENROUTER_API_KEY"];
const DEEPSEEK_KEY_ENV_NAMES = ["VWL_DEEPSEEK_API_KEY", "Linda3Schnellmodus", "DEEPSEEK_API_KEY"];
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
    if (typeof value === "string" && value.trim()) return value.trim();
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

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && ["user", "assistant"].includes(entry.role) && compactText(entry.content))
    .slice(-8)
    .map((entry) => ({
      role: entry.role,
      content: compactText(entry.content).slice(0, 1600),
    }));
}

function buildSystemPrompt(mode, profile) {
  const modeInstruction = MODE_CONFIG[mode]?.instruction || MODE_CONFIG.fragen.instruction;
  const profileConfig = PROFILE_CONFIG[profile] || PROFILE_CONFIG.fortgeschritten;
  const documentRule = profileConfig.usesDocuments
    ? [
        "Nutze die Lehrgangsunterlagen vorrangig.",
        "Allgemeines VWL-Wissen darf ergänzen, aber Dokumentinhalte nicht überschreiben.",
        "Nenne Quellen, sobald du Dokumentinhalte nutzt.",
        "Erfinde keine Dokumenttitel, Seitenzahlen oder Zitate.",
      ]
    : [
        "Nutze keine Lehrgangsunterlagen und behaupte nicht, dass du in Dokumenten nachgesehen hast.",
        "Wenn Quellen oder Unterlagen gefragt sind, sage kurz, dass dieses Profil ohne Unterlagen arbeitet.",
      ];

  return [
    "Du bist VWL-Linda 4, ein kompakter Lernassistent für Volkswirtschaftslehre.",
    "Du unterstützt Teilnehmende in IHK-nahen VWL-Kursen.",
    "",
    "Grundregeln:",
    "- Antworte kurz, klar und fachlich sauber.",
    "- Gliedere die Antwort sichtbar mit Absätzen und kurzen Zwischenüberschriften.",
    "- Vermeide reine Fließtext-Blöcke.",
    "- Schreibe jede Überschrift auf eine eigene Zeile.",
    "- Schreibe Aufzählungspunkte jeweils auf eigene Zeilen.",
    "- Verwende keine LaTeX-Delimiter wie \\[ \\] oder \\( \\); Formeln bitte als gut lesbaren Klartext schreiben.",
    "- Wenn die Frage zu unklar ist, stelle lieber eine kurze Rückfrage.",
    "- Berücksichtige den bisherigen Chatverlauf, wenn die neue Frage darauf Bezug nimmt.",
    ...documentRule.map((rule) => `- ${rule}`),
    "",
    `Modus: ${MODE_CONFIG[mode]?.label || MODE_CONFIG.fragen.label}`,
    modeInstruction,
    "",
    "Gewünschtes Ausgabeformat, wenn passend:",
    "Kurzantwort:",
    "1-3 kurze Sätze.",
    "",
    "Einordnung:",
    "2-4 kurze Sätze oder Bulletpoints.",
    "",
    "Beispiel:",
    "kurzes Beispiel.",
    "",
    "Merksatz:",
    "ein Satz.",
  ].join("\n");
}

function buildInputMessages(question, history, mode, profile) {
  return [
    {
      role: "system",
      content: buildSystemPrompt(mode, profile),
    },
    ...cleanHistory(history),
    {
      role: "user",
      content: question,
    },
  ];
}

function extractTextFromResponse(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function extractOpenRouterText(data) {
  return compactText(data?.choices?.[0]?.message?.content || "");
}

function limitSnippet(value) {
  const text = compactText(value);
  if (text.length <= SOURCE_SNIPPET_LIMIT) return text;
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
    source?.filename || source?.file_name || source?.title || source?.name || source?.document || source?.file_id || "Quelle"
  );
  const fileId = compactText(source?.file_id || source?.fileId || "");
  const page = compactText(source?.page || source?.page_number || source?.attributes?.page || "");
  const scoreRaw = source?.score ?? source?.ranking_score ?? source?.similarity;
  const score = typeof scoreRaw === "number" ? scoreRaw.toFixed(2) : compactText(scoreRaw);
  const snippet = limitSnippet(source?.snippet || source?.quote || source?.text || textFromSearchResult(source));
  if (!title && !fileId && !snippet) return null;
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
  const scored = uniqueSources(sources)
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
    if (item.type !== "file_search_call") continue;
    for (const result of item.search_results || item.results || []) sources.push(normalizeSource(result));
  }
  return uniqueSources(sources);
}

function extractAnnotationSources(data) {
  const sources = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type !== "output_text" || !Array.isArray(content.annotations)) continue;
      for (const annotation of content.annotations) {
        const fileName = annotation.filename || annotation.title || annotation.file_name;
        const fileId = annotation.file_id;
        const quote = annotation.quote || annotation.text || annotation.snippet;
        if (!fileName && !fileId && !quote) continue;
        sources.push(normalizeSource({ title: fileName, file_id: fileId, snippet: quote }));
      }
    }
  }
  return uniqueSources(sources);
}

function extractSources(data) {
  return rankSources([...extractSearchResultSources(data), ...extractAnnotationSources(data)]);
}

async function callOpenRouter({ openRouterKey, profileConfig, question, history, mode, profile }) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://linda-4.vercel.app",
      "X-Title": "VWL-Linda 4",
    },
    body: JSON.stringify({
      model: profileConfig.model,
      messages: buildInputMessages(question, history, mode, profile),
      temperature: profile === "schnell" ? 0.2 : 0.35,
      max_tokens: 900,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.message || "OpenRouter API Fehler.";
    const error = new Error(message);
    error.status = response.status;
    error.details = data?.error || data;
    throw error;
  }
  return {
    answer: extractOpenRouterText(data) || "Ich habe keine Antwort erhalten.",
    sources: [],
    provider: "openrouter",
    model: data?.model || profileConfig.model,
  };
}

async function callDeepSeekDirect({ deepSeekKey, profileConfig, question, history, mode, profile }) {
  const response = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deepSeekKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: profileConfig.model,
      messages: buildInputMessages(question, history, mode, profile),
      max_tokens: 1400,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.message || "DeepSeek API Fehler.";
    const error = new Error(message);
    error.status = response.status;
    error.details = data?.error || data;
    throw error;
  }
  return {
    answer: extractOpenRouterText(data) || "Ich habe keine Antwort erhalten.",
    sources: [],
    provider: "deepseek",
    model: data?.model || profileConfig.model,
  };
}

async function callOpenAiVectorStore({ apiKey, vectorStoreId, profileConfig, question, history, mode, profile }) {
  const input = [
    ...cleanHistory(history).map((entry) => ({
      role: entry.role,
      content: entry.content,
    })),
    {
      role: "user",
      content: question,
    },
  ];

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: profileConfig.model,
      instructions: buildSystemPrompt(mode, profile),
      input,
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
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "OpenAI API Fehler.";
    const error = new Error(message);
    error.status = response.status;
    error.details = data?.error || data;
    throw error;
  }
  const answer = extractTextFromResponse(data) || "Ich habe keine Antwort erhalten.";
  return {
    answer,
    sources: extractSources(data),
    provider: "openai-vectorstore",
    model: profileConfig.model,
  };
}

async function callOpenAiNoDocumentsFallback({ apiKey, question, history, mode, profile }) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: buildSystemPrompt(mode, profile),
      input: cleanHistory(history).concat([{ role: "user", content: question }]),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "OpenAI API Fehler.";
    const error = new Error(message);
    error.status = response.status;
    error.details = data?.error || data;
    throw error;
  }
  return {
    answer: extractTextFromResponse(data) || "Ich habe keine Antwort erhalten.",
    sources: [],
    provider: "openai-no-docs-fallback",
    model: OPENAI_MODEL,
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
      service: "VWL-Linda 4 API",
      profiles: PROFILE_CONFIG,
      configured: {
        openAiKey: Boolean(readFirstEnv(API_KEY_ENV_NAMES)),
        openRouterKey: Boolean(readFirstEnv(OPENROUTER_KEY_ENV_NAMES)),
        deepSeekKey: Boolean(readFirstEnv(DEEPSEEK_KEY_ENV_NAMES)),
        vectorStore: Boolean(readFirstEnv(VECTOR_STORE_ENV_NAMES)),
      },
      expectedEnv: {
        openAiKey: API_KEY_ENV_NAMES,
        openRouterKey: OPENROUTER_KEY_ENV_NAMES,
        deepSeekKey: DEEPSEEK_KEY_ENV_NAMES,
        vectorStore: VECTOR_STORE_ENV_NAMES,
        optional: ["VWL_OPENAI_MODEL", "VWL_INTELLIGENT_MODEL", "VWL_CLAUDE_MODEL", "VWL_DEEPSEEK_MODEL", "VWL_FAST_MODEL", "DEEPSEEK_MODEL"],
      },
    });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    json(res, 400, { error: "Ungültiges JSON im Request." });
    return;
  }

  const question = String(body.question || "").trim();
  const mode = MODE_CONFIG[body.mode] ? body.mode : "fragen";
  const profile = PROFILE_CONFIG[body.responseProfile] ? body.responseProfile : PROFILE_CONFIG[body.profile] ? body.profile : "fortgeschritten";
  const profileConfig = PROFILE_CONFIG[profile];
  const history = cleanHistory(body.history);

  if (!question) {
    json(res, 400, { error: "Bitte eine Frage oder einen Text eingeben." });
    return;
  }

  const apiKey = readFirstEnv(API_KEY_ENV_NAMES);
  const openRouterKey = readFirstEnv(OPENROUTER_KEY_ENV_NAMES);
  const deepSeekKey = readFirstEnv(DEEPSEEK_KEY_ENV_NAMES);
  const vectorStoreId = readFirstEnv(VECTOR_STORE_ENV_NAMES);

  try {
    let result;
    let fallback = false;

    if (profileConfig.provider === "deepseek") {
      if (!deepSeekKey) {
        json(res, 500, {
          error: "DeepSeek API Key fehlt für Schnell.",
          missing: {
            deepSeekKey: true,
          },
          expectedEnv: DEEPSEEK_KEY_ENV_NAMES,
        });
        return;
      }
      result = await callDeepSeekDirect({ deepSeekKey, profileConfig, question, history, mode, profile });
    } else if (profileConfig.provider === "openrouter") {
      if (!openRouterKey) {
        if (!apiKey) throw Object.assign(new Error("OpenRouter API Key fehlt."), { status: 500 });
        result = await callOpenAiNoDocumentsFallback({ apiKey, question, history, mode, profile });
        fallback = true;
      } else {
        result = await callOpenRouter({ openRouterKey, profileConfig, question, history, mode, profile });
      }
    } else {
      if (!apiKey || !vectorStoreId) {
        json(res, 500, {
          error: "VWL API ist für Fortgeschritten noch nicht vollständig konfiguriert.",
          missing: {
            apiKey: !apiKey,
            vectorStore: !vectorStoreId,
          },
        });
        return;
      }
      result = await callOpenAiVectorStore({ apiKey, vectorStoreId, profileConfig, question, history, mode, profile });
    }

    json(res, 200, {
      answer: result.answer,
      sources: profileConfig.usesDocuments ? result.sources : [],
      mode,
      responseProfile: profile,
      provider: result.provider,
      model: result.model,
      dataUse: {
        usesDocuments: profileConfig.usesDocuments,
        label: fallback ? `${profileConfig.dataLabel} (Fallback)` : profileConfig.dataLabel,
      },
      context: {
        used: history.length > 0,
        messages: history.length,
      },
      meta: {
        fallback,
      },
    });
  } catch (error) {
    json(res, error.status || 500, {
      error: "Die VWL API konnte die Anfrage nicht verarbeiten.",
      details: error.details || error.message,
    });
  }
};
