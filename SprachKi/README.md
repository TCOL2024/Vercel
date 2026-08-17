# SprachKi – Vercel Blob + OpenAI Vector Store

## Struktur
- `index.html`
- `api/index.js` – einzige API-Datei
- `vercel.json`
- `package.json`

## Endpunkte
- `/api/ask`
- `/api/rewrite`
- `/api/context-upload-token`
- `/api/context-upload`
- `/api/context-search`

## Warum Blob?
Die Originaldatei wird direkt vom Browser zu Vercel Blob hochgeladen. Dadurch muss die Datei nicht durch den Vercel-Function-Request und die Function-Payload-Grenze wird nicht zum Upload-Flaschenhals.

## Vercel Environment Variables
- `ASK` – OpenAI API-Key
- `OPENAI_VECTOR_STORE_ID` – OpenAI Vector Store
- `BLOB_READ_WRITE_TOKEN` – Token des Vercel Blob Stores
- optional `OPENAI_MODEL` – Standard `gpt-5-mini`

Node.js: `24.x`

## Blob Store
In Vercel Storage einen Blob Store anlegen und für die passende Umgebung verfügbar machen. Das `BLOB_READ_WRITE_TOKEN` bleibt ausschließlich serverseitig.

## Upload-Ablauf
1. Browser ruft `/api/context-upload-token` auf.
2. Server erzeugt einen Vercel-Blob-Client-Token.
3. Browser lädt die Datei direkt zu Blob.
4. Browser sendet nur Blob-URL + Kontextdaten an `/api/context-upload`.
5. Backend lädt den Blob serverseitig herunter.
6. Backend legt die Datei in OpenAI Files und im konfigurierten Vector Store ab.
7. `/api/context-search` sucht später semantisch und filtert nach `context_id`.

Status `in_progress` bedeutet, dass OpenAI die Datei noch verarbeitet. Erst `completed` ist für Retrieval belastbar.
