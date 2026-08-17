# SprachKi – Context Engine / Vercel

Eine Backend-Datei: `api/index.js`.

Endpunkte:
- `/api/ask`
- `/api/rewrite`
- `/api/context-upload-token`
- `/api/context-upload`
- `/api/context-status`
- `/api/context-search`

Upload: Browser -> Vercel Blob (direkt, Multipart) -> `/api/context-upload` -> OpenAI Files -> Vector Store.
Retrieval: `/api/context-search` filtert nach `context_id`.

Environment Variables:
- `ASK` – OpenAI API-Key
- `OPENAI_VECTOR_STORE_ID` – OpenAI Vector Store ID
- `BLOB_READ_WRITE_TOKEN` – Vercel Blob Read/Write Token
- `OPENAI_MODEL` – optional, Standard `gpt-5-mini`

Node.js: `24.x`

Für sensible Unterrichtsunterlagen einen privaten Vercel Blob Store verwenden.
