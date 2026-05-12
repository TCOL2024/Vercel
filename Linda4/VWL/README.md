# VWL-Linda 4 Prototyp

Erster eigenstaendiger Prototyp fuer den VWL-Bot.

## Dateien

- `index.html` enthaelt die Chat-Oberflaeche mit vier Modi.
- `api/vwl.js` enthaelt die serverseitige OpenAI-Anbindung.

## Vercel Variablen

Die API erwartet diese Variablen serverseitig:

```text
VWL2026LINDA4
VWL-Vectorstore
```

Optional kann der OpenAI-Key auch ueber `OPENAI_API_KEY` kommen. Vorrang hat `VWL2026LINDA4`.

## Bot-Modi

- `Fragen`: kompakte VWL-Antworten mit Quellen.
- `Lernkarten`: Karteikarten mit Vorderseite und Rueckseite.
- `Uebungen`: Aufgaben mit Loesung und Erklaerung.
- `Uebersetzen`: fachlich saubere Uebersetzung oder Vereinfachung.

## Grundverhalten

- Modell: `gpt-5.4`
- Dokumentwissen aus dem VWL-Vectorstore hat Vorrang.
- Allgemeines VWL-Wissen darf ergaenzen.
- Quellen sollen sichtbar ausgegeben werden.
- Bei unklaren Fragen soll der Bot kurz nachfragen.

## Lokaler Start

Im Idealfall aus dem Projektordner:

```bash
npx vercel dev VWL
```

Dann die angezeigte lokale URL im Browser oeffnen.
