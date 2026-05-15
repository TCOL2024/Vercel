const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

const OPENAI_MODEL = process.env.VWL_OPENAI_MODEL || "gpt-5.4";
const CLAUDE_MODEL = process.env.VWL_INTELLIGENT_MODEL || process.env.VWL_CLAUDE_MODEL || "anthropic/claude-3.5-haiku";
const DEEPSEEK_MODEL = process.env.VWL_DEEPSEEK_MODEL || process.env.VWL_FAST_MODEL || "deepseek/deepseek-chat";

const MODE_CONFIG = {
  fragen: {
    label: "Fragen",
    instruction: "Beantworte VWL-Fragen kompakt und aussagefähig. Wenn die Frage unklar oder zu breit ist, stelle eine kurze Rückfrage.",
  },
  lernkarten: {
    label: "Lernkarten",
    instruction: "Erstelle prägnante Lernkarten im Format 'Vorderseite' und 'Rückseite'. Halte die Karten prüfungsnah und vermeide Nebensächliches.",
  },
  uebungen: {
    label: "Übungsaufgaben",
    instruction: "Erstelle VWL-Übungsaufgaben mit Lösung und kurzer Erklärung. Bevorzuge Aufgaben, die für IHK-Teilnehmende praxisnah und prüfungsnah sind.",
  },
  uebersetzen: {
    label: "Übersetzen",
    instruction: "Übersetze oder vereinfache den Text fachlich sauber. Verändere den Inhalt nicht unnötig und erhalte wichtige VWL-Fachbegriffe.",
  },
};

const PROFILE_CONFIG = {
  schnell: {
    provider: "openrouter",
    model: DEEPSEEK_MODEL,
    usesDocuments: false,
    label: "Schnell",
    dataLabel: "Ohne Unterlagen",
    maxTokens: 750,
  },
  intelligent: {
    provider: "openrouter",
    model: CLAUDE_MODEL,
    usesDocuments: false,
    label: "Intelligent",
    dataLabel: "Ohne Unterlagen",
    maxTokens: 950,
  },
  fortgeschritten: {
    provider: "openai-vectorstore",
    model: OPENAI_MODEL,
    usesDocuments: true,
    label: "Fortgeschritten",
    dataLabel: "Mit Unterlagen",
    maxTokens: 1400,
  },
};

const OPENAI_API_KEY_ENV_NAMES = ["VWL2026LINDA4", "OPENAI_API_KEY"];
const OPENROUTER_API_KEY_ENV_NAMES = ["VWLBOT", "OPENROUTER_API_KEY", "VWL_OPENROUTER_API_KEY"];
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
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeHistory(history, limit = HISTORY_LIMIT) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const roleRaw = String(entry.role || "").toLowerCase();
      const role = roleRaw === "assistant" ? "assistant" : "user";
      const content = compactText(entry.content || "").slice(0, HISTORY_ITEM_LIMIT);
      return content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-limit);
}

function normalizeIntentText(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/\u00e4/g, "ae")
    .replace(/\u00f6/g, "oe")
    .replace(/\u00fc/g, "ue")
    .replace(/\u00df/g, "ss");
}

function needsContextClarification(question, history) {
  if (history.length) return false;
  const text = normalizeIntentText(question).replace(/[!?.,;:]+$/g, "");
  if (!text) return false;
  const exact = new Set(["das", "dazu", "damit", "weiter", "mach weiter", "erklaere das", "erklaer das", "was bedeutet das", "nochmal", "genauer"]);
  if (exact.has(text)) return true;
  return text.length < 22 && /\b(das|dazu|damit|weiter|dies|diese|dieser|dieses)\b/.test(text);
}

function buildSystemPrompt(mode, profile) {
  const modeInstruction = MODE_CONFIG[mode]?.instruction || MODE_CONFIG.fragen.instruction;
  const profileConfig = PROFILE_CONFIG[profile] || PROFILE_CONFIG.intelligent;
  const documentRules = profileConfig.usesDocuments
    ? [
        "- Nutze die Lehrgangsunterlagen aus dem Vector Store vorrangig.",
        "- Allgemeines VWL-Wissen darf ergänzen, aber Dokumentinhalte nicht überschreiben.",
        "- Nenne Quellen, sobald du Dokumentinhalte nutzt.",
        "- Erfinde keine Dokumenttitel, Seitenzahlen oder Zitate.",
      ]
    : [
        "- Du nutzt keine Lehrgangsunterlagen und keinen Vector Store.",
        "- Antworte aus allgemeinem VWL-Wissen und aus dem direkten Nutzertext.",
        "- Nenne keine Dokumentquellen und behaupte keinen Zugriff auf Unterlagen.",
      ];

  return [
    "Du bist VWL-Linda 4, ein kompakter Lernassistent für Volkswirtschaftslehre.",
    "Du unterstützt Teilnehmende in IHK-nahen VWL-Kursen.",
    "",
    "Grundregeln:",
    "- Antworte kurz, klar und fachlich sauber.",
    "- Wenn die Frage zu unklar ist, stelle lieber eine kurze Rückfrage.",
    ...documentRules,
    "- Wiederhole den Verlauf nicht unnötig; nutze ihn nur, wenn er hilft.",
    "",
    `Modus: ${MODE_CONFIG[mode]?.label || MODE_CONFIG.fragen.label}`,
    `Antwortprofil: ${profileConfig.label}`,
    modeInstruction,
    "",
    "Gewünschtes Ausgabeformat:",
    "Kurzantwort:",
    "...",
    "",
    profileConfig.usesDocuments ? "Aus den Unterlagen:" : "Einordnung:",
    "...",
    "",
    profileConfig.usesDocuments ? "Quellen:" : "Hinweis:",
    profileConfig.usesDocuments ? "- Dokument/Fundstelle: kurzer Ausschnitt oder Hinweis" : "- Ohne Lehrgangsunterlagen beantwortet.",
    "",
    "Ergänzung:",
    "...",
  ].join("\n");
}

function buildInputMessages(question, history) {
  return [...history.map((entry) => ({ role: entry.role, content: entry.content })), { role: "user", content: question }];
}

function parseJsonSafe(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch (error) { return { raw }; }
}

function extractOpenAIText(data) {
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
  return compactText(data?.choices?.[0]?.message?.content || data?.output_text || "");
}

function limitSnippet(value) {
  const text = compactText(value);
  if (text.length <= SOURCE_SNIPPET_LIMIT) return text;
  return `${text.slice(0, SOURCE_SNIPPET_LIMIT - 3).trim()}...`;
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
  const title = compactText(source?.filename || source?.file_name || source?.title || source?.name || source?.document || source?.file_id || "Quelle");
  const fileId = compactText(source?.file_id || source?.fileId || "");
  const page = compactText(source?.page || source?.page_number || source?.attributes?.page || "");
  const scoreRaw = source?.score ?? source?.ranking_score ?? source?.similarity;
  const score = typeof scoreRaw === "number" ? scoreRaw.toFixed(2) : compactText(scoreRaw);
  const snippet = limitSnippet(source?.snippet || source?.quote || source?.text || textFromSearchResult(source));
  if (!title && !fileId && !snippet) return null;
  return { title: title || fileId || "Quelle", fileId: fileId || null, page: page || null, score: score || null, snippet: snippet || null };
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
  return uniqueSources([...extractSearchResultSources(data), ...extractAnnotationSources(data)]).slice(0, 6);
}

async function callOpenRouter({ apiKey, model, mode, profile, question, history, maxTokens }) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://linda-4.vercel.app/VWL/index.html",
      "X-Title": "VWL-Linda 4",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(mode, profile) },
        ...history,
        { role: "user", content: question },
      ],
      temperature: profile === "schnell" ? 0.25 : 0.45,
      top_p: 0.9,
      max_tokens: maxTokens,
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
  return { answer: extractOpenRouterText(data), sources: [], model: data.model || model, provider: "openrouter" };
}

async function callOpenAI({ apiKey, model, mode, profile, question, history, vectorStoreId, maxTokens }) {
  const requestBody = {
    model,
    instructions: buildSystemPrompt(mode, profile),
    input: buildInputMessages(question, history),
    max_output_tokens: maxTokens,
  };
  if (vectorStoreId) {
    requestBody.tools = [{ type: "file_search", vector_store_ids: [vectorStoreId], max_num_results: 6 }];
    requestBody.include = ["file_search_call.results"];
  }
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const raw = await response.text();
  const data = parseJsonSafe(raw);
  if (!response.ok) {
    const error = new Error(data.error?.message || data.error || raw || "OpenAI API Fehler.");
    error.statusCode = response.status;
    error.details = data.error || data;
    throw error;
  }
  return { answer: extractOpenAIText(data), sources: vectorStoreId ? extractSources(data) : [], model, provider: vectorStoreId ? "openai-vectorstore" : "openai" };
}

function dataUseFor(profile, fallback = false) {
  const config = PROFILE_CONFIG[profile] || PROFILE_CONFIG.intelligent;
  return {
    usesDocuments: config.usesDocuments,
    label: fallback ? `${config.dataLabel} (Fallback)` : config.dataLabel,
  };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const openAiKey = readFirstEnv(OPENAI_API_KEY_ENV_NAMES);
  const openRouterKey = readFirstEnv(OPENROUTER_API_KEY_ENV_NAMES);
  const vectorStoreId = readFirstEnv(VECTOR_STORE_ENV_NAMES);

  if (req.method === "GET") {
    json(res, 200, {
      ok: true,
      service: "VWL-Linda 4 API",
      profiles: {
        schnell: { provider: "openrouter", model: DEEPSEEK_MODEL, usesDocuments: false },
        intelligent: { provider: "openrouter", model: CLAUDE_MODEL, usesDocuments: false },
        fortgeschritten: { provider: "openai-vectorstore", model: OPENAI_MODEL, usesDocuments: true },
      },
      configured: {
        openAiKey: Boolean(openAiKey),
        openRouterKey: Boolean(openRouterKey),
        vectorStore: Boolean(vectorStoreId),
      },
      expectedEnv: {
        openAiKey: OPENAI_API_KEY_ENV_NAMES,
        openRouterKey: OPENROUTER_API_KEY_ENV_NAMES,
        vectorStore: VECTOR_STORE_ENV_NAMES,
        optional: ["VWL_OPENAI_MODEL", "VWL_INTELLIGENT_MODEL", "VWL_CLAUDE_MODEL", "VWL_DEEPSEEK_MODEL", "VWL_FAST_MODEL"],
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

  const question = String(body.question || body.prompt || body.input || "").trim();
  const mode = MODE_CONFIG[body.mode] ? body.mode : "fragen";
  const history = sanitizeHistory(body.history || body.messages || []);
  const requestedProfile = String(body.responseProfile || body.profile || "intelligent").toLowerCase();
  const responseProfile = PROFILE_CONFIG[requestedProfile] ? requestedProfile : "intelligent";
  const profileConfig = PROFILE_CONFIG[responseProfile];

  if (!question) {
    json(res, 400, { error: "Bitte eine Frage oder einen Text eingeben." });
    return;
  }

  if (needsContextClarification(question, history)) {
    json(res, 200, {
      answer: "Worauf soll ich mich beziehen? Bitte nenne kurz das VWL-Thema oder stelle die Anschlussfrage zusammen mit dem Bezug.",
      sources: [],
      mode,
      responseProfile,
      dataUse: dataUseFor(responseProfile),
      context: { used: false, needsClarification: true },
    });
    return;
  }

  try {
    let result;
    let fallback = false;

    if (profileConfig.provider === "openai-vectorstore") {
      if (!openAiKey || !vectorStoreId) {
        json(res, 500, { error: "Fortgeschritten ist noch nicht vollständig konfiguriert.", missing: { openAiKey: !openAiKey, vectorStore: !vectorStoreId } });
        return;
      }
      result = await callOpenAI({ apiKey: openAiKey, model: OPENAI_MODEL, mode, profile: responseProfile, question, history, vectorStoreId, maxTokens: profileConfig.maxTokens });
    } else {
      if (!openRouterKey) {
        json(res, 500, { error: "OpenRouter ist noch nicht konfiguriert.", missing: { openRouterKey: true } });
        return;
      }
      try {
        result = await callOpenRouter({ apiKey: openRouterKey, model: profileConfig.model, mode, profile: responseProfile, question, history, maxTokens: profileConfig.maxTokens });
      } catch (error) {
        if (!openAiKey) throw error;
        fallback = true;
        result = await callOpenAI({ apiKey: openAiKey, model: OPENAI_MODEL, mode, profile: responseProfile, question, history, vectorStoreId: "", maxTokens: profileConfig.maxTokens });
      }
    }

    json(res, 200, {
      answer: result.answer || "Ich habe keine Antwort erhalten.",
      sources: result.sources || [],
      mode,
      responseProfile,
      provider: result.provider,
      model: result.model,
      dataUse: dataUseFor(responseProfile, fallback),
      context: { used: history.length > 0, messages: history.length },
      meta: { fallback },
    });
  } catch (error) {
    json(res, error.statusCode || 500, {
      error: "Die VWL API konnte die Anfrage nicht verarbeiten.",
      details: error.message,
      dataUse: dataUseFor(responseProfile),
    });
  }
};
