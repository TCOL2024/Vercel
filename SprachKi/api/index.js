const { Buffer } = require("node:buffer");

let openaiClient;
let blobModule;

async function deps() {
  if (!openaiClient) {
    const mod = await import("openai");
    openaiClient = new mod.default({
      apiKey: process.env.ASK || process.env.OPENAI_API_KEY
    });
  }
  if (!blobModule) blobModule = await import("@vercel/blob");
  return { openai: openaiClient, blob: blobModule };
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function route(req) {
  const pathname = new URL(req.url, `https://${req.headers.host || "localhost"}`).pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/ask")) return "ask";
  if (pathname.endsWith("/rewrite")) return "rewrite";
  if (pathname.endsWith("/context-upload-token")) return "context-upload-token";
  if (pathname.endsWith("/context-upload")) return "context-upload";
  if (pathname.endsWith("/context-status")) return "context-status";
  if (pathname.endsWith("/context-search")) return "context-search";
  return "";
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
}

function outputText(response) {
  if (!response) return "";
  if (typeof response.output_text === "string") return response.output_text;
  if (Array.isArray(response.output)) {
    return response.output
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .map(item => item.text || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function ask(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const { openai } = await deps();
  const body = await readJson(req);
  const question = String(body.question || "").trim();
  if (!question) return send(res, 400, { error: "question fehlt" });

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    input: question
  });
  const text = outputText(response);
  return send(res, 200, { result: text, output_text: text });
}

async function rewrite(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const { openai } = await deps();
  const body = await readJson(req);
  const text = String(body.text || "").trim();
  const style = String(body.style || "neutral");
  if (!text) return send(res, 400, { error: "text fehlt" });

  const instruction = style === "freundlich"
    ? "freundlich und zugewandt"
    : style === "formell"
      ? "formell und professionell"
      : style === "kurz"
        ? "kürzer und prägnanter"
        : "klar, professionell und natürlich";

  const prompt = `Formuliere den folgenden Text ${instruction}.
Keine Markdown-Steuerzeichen, kein JSON, keine Vorbemerkung.
Text:
${text}`;

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    input: prompt
  });
  const result = outputText(response);
  return send(res, 200, { result, output: result, text: result });
}

async function contextUploadToken(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return send(res, 500, { error: "BLOB_READ_WRITE_TOKEN fehlt" });
  }

  const { blob } = await deps();
  const body = await readJson(req);

  try {
    const result = await blob.handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let payload = {};
        try {
          payload = clientPayload ? JSON.parse(clientPayload) : {};
        } catch (_) {}

        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
            "text/markdown",
            "text/csv"
          ],
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            context_id: String(payload.context_id || ""),
            metadata: payload.metadata || {}
          })
        };
      },
      onUploadCompleted: async ({ blob: completedBlob, tokenPayload }) => {
        console.log("SprachKi Blob upload completed", completedBlob.pathname, tokenPayload);
      }
    });
    return send(res, 200, result);
  } catch (error) {
    console.error("context-upload-token", error);
    return send(res, 400, {
      error: error.message || "Blob-Upload konnte nicht vorbereitet werden."
    });
  }
}

async function contextUpload(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return send(res, 500, { error: "BLOB_READ_WRITE_TOKEN fehlt" });
  }
  if (!process.env.OPENAI_VECTOR_STORE_ID) {
    return send(res, 500, { error: "OPENAI_VECTOR_STORE_ID fehlt" });
  }

  const { openai, blob } = await deps();
  const body = await readJson(req);
  const contextId = String(body.context_id || "").trim();
  const blobUrl = String(body.blob_url || "").trim();
  const name = String(body.name || body.pathname || "Quelle").trim();
  const type = String(body.type || "application/octet-stream").trim();

  if (!contextId) return send(res, 400, { error: "context_id fehlt" });
  if (!blobUrl) return send(res, 400, { error: "blob_url fehlt" });

  try {
    const url = new URL(blobUrl);
    const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const stored = await blob.get(pathname, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    if (!stored || stored.statusCode !== 200 || !stored.stream) {
      return send(res, 404, { error: "Blob-Datei konnte serverseitig nicht gelesen werden." });
    }

    const chunks = [];
    for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);

    const uploaded = await openai.files.create({
      file: new File([buffer], name, { type }),
      purpose: "assistants"
    });

    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const attributes = {
      context_id: contextId,
      source_name: name.slice(0, 512),
      source_type: type.slice(0, 512),
      source_role: String(metadata.source_role || "").slice(0, 512)
    };

    const vectorFile = await openai.vectorStores.files.create(
      process.env.OPENAI_VECTOR_STORE_ID,
      { file_id: uploaded.id, attributes }
    );

    return send(res, 200, {
      file_id: uploaded.id,
      name,
      type,
      indexed: vectorFile.status === "completed",
      status: vectorFile.status || "in_progress",
      vector_store_file_id: vectorFile.id
    });
  } catch (error) {
    console.error("context-upload", error);
    return send(res, 500, {
      error: error.message || "Datei konnte nicht in den OpenAI Vector Store übernommen werden."
    });
  }
}

async function contextStatus(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!process.env.OPENAI_VECTOR_STORE_ID) {
    return send(res, 500, { error: "OPENAI_VECTOR_STORE_ID fehlt" });
  }

  const { openai } = await deps();
  const body = await readJson(req);
  const vectorStoreFileId = String(body.vector_store_file_id || "").trim();
  if (!vectorStoreFileId) return send(res, 400, { error: "vector_store_file_id fehlt" });

  try {
    const vectorFile = await openai.vectorStores.files.retrieve(
      process.env.OPENAI_VECTOR_STORE_ID,
      vectorStoreFileId
    );
    return send(res, 200, {
      status: vectorFile.status,
      indexed: vectorFile.status === "completed",
      file_id: vectorFile.file_id || body.file_id || "",
      vector_store_file_id: vectorFile.id,
      last_error: vectorFile.last_error || null
    });
  } catch (error) {
    console.error("context-status", error);
    return send(res, 500, {
      error: error.message || "Status konnte nicht abgefragt werden."
    });
  }
}

async function contextSearch(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!process.env.OPENAI_VECTOR_STORE_ID) {
    return send(res, 500, { error: "OPENAI_VECTOR_STORE_ID fehlt" });
  }

  const { openai } = await deps();
  const body = await readJson(req);
  const contextId = String(body.context_id || "").trim();
  const query = String(body.query || "").trim();
  if (!contextId) return send(res, 400, { error: "context_id fehlt" });
  if (!query) return send(res, 400, { error: "query fehlt" });

  try {
    const result = await openai.vectorStores.search(
      process.env.OPENAI_VECTOR_STORE_ID,
      {
        query,
        max_num_results: 8,
        rewrite_query: true,
        attribute_filter: {
          type: "eq",
          key: "context_id",
          value: contextId
        }
      }
    );

    const chunks = [];
    const sourceCounts = new Map();

    for (const item of (result.data || [])) {
      const text = (item.content || [])
        .map(part => part.text || "")
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) continue;

      const filename = item.filename || item.file_name || "Quelle";
      chunks.push({
        file_id: item.file_id,
        filename,
        score: item.score,
        text
      });
      sourceCounts.set(filename, (sourceCounts.get(filename) || 0) + 1);
    }

    return send(res, 200, {
      relevant_context: chunks.map((chunk, index) =>
        `[Quelle ${index + 1}: ${chunk.filename}]\n${chunk.text}`
      ).join("\n\n"),
      chunks,
      sources: [...sourceCounts.entries()].map(([name, hits]) => ({ name, hits }))
    });
  } catch (error) {
    console.error("context-search", error);
    return send(res, 500, { error: error.message || "Retrieval fehlgeschlagen." });
  }
}

module.exports = async function handler(req, res) {
  try {
    switch (route(req)) {
      case "ask": return ask(req, res);
      case "rewrite": return rewrite(req, res);
      case "context-upload-token": return contextUploadToken(req, res);
      case "context-upload": return contextUpload(req, res);
      case "context-status": return contextStatus(req, res);
      case "context-search": return contextSearch(req, res);
      default: return send(res, 404, { error: "Unbekannter API-Endpunkt" });
    }
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error.message || "Interner Serverfehler" });
  }
};
