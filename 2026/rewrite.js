// /api/rewrite.js (Vercel Serverless Function)
// ENV: OPENAI_API_KEY  (Fallback: ReWrite)
// Optional: OPENAI_VECTOR_STORE_ID

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function safeString(x) {
  return (x ?? "").toString();
}

function clampText(s, max = 1000) {
  const t = safeString(s);
  return t.length > max ? t.slice(0, max) : t;
}

// Heuristik: Rückfragen nur bei dünnem / zweifelhaftem Input (für Vorbereitungsaufgabe)
function needsClarificationForPrepTask(text) {
  const t = (text || "").trim();
  if (t.length < 220) return true; // zu kurz

  const lowSignalCues = [
    "unternehmen", "betrieb", "kunde", "projekt", "prozess", "fall", "situation",
    "ausbildung", "prüfung", "ihk", "dqr", "rolle", "abteilung", "team",
    "recht", "bwl", "vwl", "personal", "führung", "kommunikation", "organisation",
    "versicherung", "finanzen", "controlling", "marketing", "logistik"
  ];
  const cueHits = lowSignalCues.filter(k => t.toLowerCase().includes(k)).length;

  const genericLead = /^(mach|erstelle|schreib|formuliere|bitte|hilf)\b/i.test(t) && t.length < 380;
  const placeholderish = /(\?\?\?|xxx|tbd|lorem|platzhalter)/i.test(t);

  const verbish = /(ist|sind|war|wird|soll|muss|kann|könnte|habe|haben|hat|prüfe|bewerte|analysiere|entwickle|plane|entscheide)/i.test(t);
  const keywordSoup = (t.split(",").length >= 6 && !verbish);

  // Zweifelhaft, wenn zu generisch oder Platzhalter oder reine Stichworte
  if (placeholderish || keywordSoup) return true;

  // Wenn wenig Kontext-Signale + generisch → Rückfragen
  if (cueHits <= 1 && genericLead) return true;

  // Noch eine weiche Regel: kaum Kontext + sehr kurz
  if (cueHits === 0 && t.length < 320) return true;

  return false;
}

function buildClarificationQuestions(text) {
  // 3–5 gezielte Rückfragen, damit die Aufgabe wirklich DQR-6/IHK-nah wird
  const base = [
    "Für welche Zielgruppe soll die Vorbereitungsaufgabe passen (z. B. Fachwirt, Bilanzbuchhalter, Bachelor Professional)?",
    "Welcher Schwerpunkt ist gewünscht (z. B. Recht, BWL/VWL, Personal, Organisation/Projekt, Kommunikation/Führung)?",
    "Welche Branche bzw. welcher Kontext passt (z. B. Versicherung/Finanzen, Handel, Industrie, Dienstleistung)?",
    "Wie soll die Aufgabenform sein: eher Analyse/Beurteilung oder eher Konzept/Entwicklung (oder beides)?"
  ];

  // Wenn im Text schon Hinweise stecken, reduzieren wir unnötige Fragen
  const questions = [];

  if (!/(fachwirt|bilanz|bachelor|dqr|prüfung|ihk)/i.test(text)) {
    questions.push(base[0]);
  }
  if (!/(recht|bwl|vwl|personal|organisation|projekt|kommunikation|führung)/i.test(text)) {
    questions.push(base[1]);
  }
  if (!/(versicherung|finanz|handel|industrie|dienstleistung|verwaltung|gesundheit)/i.test(text)) {
    questions.push(base[2]);
  }
  questions.push(base[3]);

  // max 4 Fragen
  return questions.slice(0, 4);
}

function styleConfig(style) {
  switch (style) {
    case "vorbereitungsaufgabe":
      return {
        name: "Vorbereitungsaufgabe",
        maxOut: 950,
        system:
          "Du erstellst eine prüfungsnahe Vorbereitungsaufgabe auf DQR-Stufe 6 im Stil einer IHK-Prüfung. " +
          "Du gibst strukturierte Aufgabenstellungen aus. Keine Meta-Erklärungen.",
        instruction:
          "Erstelle aus dem Input eine IHK-ähnliche Vorbereitungsaufgabe auf DQR-Stufe 6. " +
          "Baue den Input in eine realistische berufliche Fallsituation ein. " +
          "Forme daraus 3–5 Teilaufgaben mit anspruchsvollen Operatoren (analysieren, beurteilen, ableiten, priorisieren, entwickeln, begründen). " +
          "Stelle sicher, dass die Aufgabe in 'nahezu ähnliche Prüfungsfächer' übertragbar ist, je nach Inhalt (z. B. Recht, BWL/VWL, Personal, Organisation/Projekt, Kommunikation/Führung). " +
          "Gib aus:\n" +
          "1) Ausgangssituation\n" +
          "2) Arbeitsauftrag (Teilaufgaben)\n" +
          "3) Erwartungshorizont/Bewertungsraster (stichpunktartig je Teilaufgabe)\n" +
          "4) Zeitvorschlag (60–90 Minuten) und ggf. Hilfsmittel\n" +
          "Keine Musterlösung, keine zusätzlichen Rückfragen."
      };

    case "besser":
      return {
        name: "Besser formuliert",
        maxOut: 750,
        system:
          "Du bist ein sehr präziser, fachlich starker Schreibassistent. " +
          "Du gibst ausschließlich den finalen Text zurück – ohne Einleitung, ohne Kommentar, ohne Liste der Änderungen.",
        instruction:
          "Formuliere den Text deutlich besser: klar, professionell, logisch strukturiert und fachlich präzise. " +
          "Verwende passende Fachbegriffe. " +
          "WICHTIG: Erkläre jeden Fachbegriff bei der ersten Verwendung kurz in Klammern (max. 8–12 Wörter). " +
          "Danach den Fachbegriff ohne Klammer weiterverwenden. " +
          "Inhalt nicht verfälschen, keine neuen Fakten erfinden."
      };

    case "neutral":
      return {
        name: "Neutral / klar",
        maxOut: 650,
        system: "Du bist ein präziser Schreibassistent. Gib nur den umformulierten Text zurück – ohne Erklärungen.",
        instruction: "Formuliere klar, neutral und gut lesbar um. Inhalt beibehalten, keine neuen Fakten hinzufügen."
      };

    case "freundlich":
      return {
        name: "Freundlich",
        maxOut: 650,
        system: "Du bist ein präziser Schreibassistent. Gib nur den umformulierten Text zurück – ohne Erklärungen.",
        instruction: "Formuliere freundlich, zugewandt und klar um. Inhalt beibehalten."
      };

    case "formell":
      return {
        name: "Formell",
        maxOut: 700,
        system: "Du bist ein präziser Schreibassistent. Gib nur den umformulierten Text zurück – ohne Erklärungen.",
        instruction: "Formuliere formell, sachlich und professionell um. Inhalt beibehalten."
      };

    case "kurz":
      return {
        name: "Kürzer",
        maxOut: 600,
        system: "Du bist ein präziser Schreibassistent. Gib nur den finalen Text zurück – ohne Erklärungen.",
        instruction: "Kürze den Text deutlich, ohne wesentliche Inhalte zu verlieren."
      };

    default:
      return {
        name: "Neutral / klar",
        maxOut: 650,
        system: "Du bist ein präziser Schreibassistent. Gib nur den umformulierten Text zurück – ohne Erklärungen.",
        instruction: "Formuliere klar, neutral und gut lesbar um. Inhalt beibehalten."
      };
  }
}

function extractOutputText(data) {
  const out =
    data?.output_text ||
    (Array.isArray(data?.output)
      ? data.output.map(x => (x?.content || []).map(c => c?.text || "").join("")).join("")
      : "");
  return (out || "").trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed. Use POST." });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.ReWrite;
  if (!OPENAI_API_KEY) {
    return json(res, 500, { error: "Server not configured: missing OPENAI_API_KEY" });
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  const style = safeString(body.style || "neutral").trim();
  const cfg = styleConfig(style);

  const text = clampText(body.text, 1000);
  if (!text.trim()) return json(res, 400, { error: "Missing text" });

  // Rückfragen-Phase nur für Vorbereitungsaufgabe
  if (style === "vorbereitungsaufgabe" && needsClarificationForPrepTask(text)) {
    const questions = buildClarificationQuestions(text);
    return json(res, 200, {
      type: "clarification",
      questions,
      hint: "Bitte kurz beantworten. Danach erneut senden."
    });
  }

  // Optional: Wissensdatenbank (Vector Store)
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

  try {
    const payload = {
      model: "gpt-4.1",
      input: [
        { role: "system", content: cfg.system },
        {
          role: "user",
          content:
            cfg.instruction +
            "\n\n---\nINPUT:\n" +
            text
        }
      ],
      tools: vectorStoreId ? [{ type: "file_search", vector_store_ids: [vectorStoreId] }] : [],
      max_output_tokens: cfg.maxOut
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(res, r.status, { error: data?.error?.message || "OpenAI error" });
    }

    const result = extractOutputText(data);

    return json(res, 200, {
      type: "result",
      result
    });
  } catch (e) {
    return json(res, 500, { error: e?.message || "Server error" });
  }
};
