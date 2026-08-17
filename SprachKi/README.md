# SprachKi – eine API-Datei für Vercel

## Struktur
SprachKi/
- index.html
- api/index.js
- vercel.json
- package.json

`api/index.js` bedient:
- /api/ask
- /api/rewrite
- /api/context-upload
- /api/context-search

## Vercel
Root Directory dieses Vercel-Projekts: `SprachKi`

Environment Variables:
- `ASK` = OpenAI API-Key
- `OPENAI_VECTOR_STORE_ID` = OpenAI Vector Store ID
- optional `OPENAI_MODEL` = gpt-5-mini

Der Upload erwartet multipart/form-data mit `file`, `context_id` und `metadata`.
Der Retrieval-Endpunkt sucht semantisch im Vector Store und filtert nach `context_id`.

## Node.js
Set Vercel Project Settings → Node.js Version to `24.x`. The package.json pins `24.x` as well.
