# SprachKi – Context Engine für Vercel

Eigenständiges Vercel-Projekt für die SprachKi. Root Directory des Vercel-Projekts soll auf diesen Ordner `SprachKi` zeigen.

## Struktur

- `index.html` – SprachKi-Oberfläche mit persistentem Kontext
- `api/ask.js` – bestehende KI-Abfrage, auf denselben OpenAI-Key wie bisher ausgelegt
- `api/rewrite.js` – Neuformulierung
- `api/context-upload.js` – PDF/PPTX/DOCX/TXT/MD/CSV Upload → OpenAI Files → Vector Store
- `api/context-search.js` – semantische Suche im Vector Store, gefiltert nach `context_id`
- `package.json` – einzig zusätzliche Laufzeitabhängigkeit: formidable
- `vercel.json` – Vercel Function Limits

## Vercel Environment Variables

Pflicht:

- `ASK` – dein bestehender OpenAI API-Key. Alternativ kann `OPENAI_API_KEY` verwendet werden.
- `OPENAI_VECTOR_STORE_ID` – ID eines OpenAI Vector Stores, z. B. `vs_...`

Optional:

- `ASK_MODEL` – Standard `gpt-4.1`
- `ReWrite` – eigener Rewrite-Key oder Webhook ist in dieser Version nicht erforderlich; wenn nicht gesetzt, wird `ASK` verwendet.
- `REWRITE_MODEL` – Standard `gpt-4.1`

## Einmalig: Vector Store anlegen

Im OpenAI-Projekt einen Vector Store anlegen und seine ID als `OPENAI_VECTOR_STORE_ID` hinterlegen. Der Upload-Endpunkt hängt jede Datei mit dem Attribut `context_id` an diesen Store. Die Retrieval-Funktion filtert exakt nach diesem Attribut. Dadurch können mehrere Arbeitskontexte denselben Vector Store sicher gemeinsam verwenden.

## Vercel

Das GitHub-Unterverzeichnis `SprachKi` als eigenes Vercel-Projekt importieren bzw. im bestehenden Vercel-Projekt als Root Directory `SprachKi` konfigurieren. Wichtig: In diesem Projekt muss `/api` direkt unter dem Root liegen.

Die HTML erwartet:

- `POST /api/ask`
- `POST /api/rewrite`
- `POST /api/context-upload`
- `POST /api/context-search`

## Upload

Der Browser sendet `multipart/form-data` mit:

- `file`
- `context_id`
- `metadata`

Die Upload-Funktion legt die Datei bei OpenAI ab, hängt sie an den Vector Store und versieht sie mit `context_id`, `client_file_id`, `source_role` und `context_name`.

## Wichtiger Vercel-Hinweis

Serverless Functions haben ein begrenztes Request-Payload. Diese Implementierung setzt deshalb bewusst eine Upload-Grenze von ca. 4 MB. Für größere PPTX/PDF-Dateien sollte später ein direkter Upload über einen externen Storage-/Upload-Mechanismus ergänzt werden, statt die Vercel Function als Datei-Proxy zu verwenden.

## Vector Store bequem anlegen

Nach `npm install` lokal:

```bash
ASK="sk-..." node scripts/create-vector-store.mjs
```

Die ausgegebene `OPENAI_VECTOR_STORE_ID=vs_...` in Vercel als Environment Variable für Production/Preview hinterlegen.
