// /api/bot.js
// Vercel Serverless Function, ohne Next.js

function readRawBody(req, limitBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > limitBytes) {
        const err = new Error("Payload too large");
        err.code = "PAYLOAD_TOO_LARGE";
        reject(err);
        req.destroy();
        return;
      }

      data += chunk.toString("utf8");
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.end(
    JSON.stringify(obj)
  );
}

function getClientIp(req) {
  const xf =
    req.headers["x-forwarded-for"];

  if (
    typeof xf === "string" &&
    xf.length
  ) {
    return xf
      .split(",")[0]
      .trim();
  }

  return (
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function allowSameOrigin(req) {
  const origin =
    req.headers.origin || "";

  const referer =
    req.headers.referer || "";

  const host =
    req.headers.host || "";

  const proto =
    req.headers["x-forwarded-proto"] || "";

  if (!origin && !referer) {
    return true;
  }

  if (!host) {
    return false;
  }

  const allowed = new Set([
    `https://${host}`,
    `http://${host}`
  ]);

  if (proto) {
    allowed.add(
      `${proto}://${host}`
    );
  }

  const parseOrigin = (value) => {
    try {
      return new URL(value).origin;
    } catch {
      return "";
    }
  };

  const reqOrigin =
    origin
      ? parseOrigin(origin)
      : "";

  const refOrigin =
    referer
      ? parseOrigin(referer)
      : "";

  if (
    reqOrigin &&
    allowed.has(reqOrigin)
  ) {
    return true;
  }

  if (
    !reqOrigin &&
    refOrigin &&
    allowed.has(refOrigin)
  ) {
    return true;
  }

  return false;
}

// ==========================================================
// TEXT NORMALIZATION
// ==========================================================

function stripLeadingFillers(text) {
  if (!text) {
    return "";
  }

  let t =
    String(text).trim();

  t =
    t.replace(
      /^(?:(?:hallo|hi|hey|moin|guten\s+morgen|guten\s+tag|guten\s+abend)\b[\s,!.-]*)(?:linda\b[\s,!.-]*)?/i,
      ""
    )
    .trim();

  t =
    t.replace(
      /^(ich\s+m(?:ö|oe)chte|ich\s+will)\s+(bitte\s+)?/i,
      ""
    )
    .trim();

  t =
    t.replace(
      /^(kannst\s+du|könntest\s+du)\s+(bitte\s+)?/i,
      ""
    )
    .trim();

  t =
    t.replace(
      /\s{2,}/g,
      " "
    )
    .trim();

  return t;
}

function isPlaceholderAssistantMessage(
  content
) {
  if (!content) {
    return false;
  }

  const c =
    content
      .trim()
      .toLowerCase();

  return (
    c.includes("⏳") ||
    c.includes("einen moment") ||
    c.includes("bitte warten") ||
    c.includes("lade") ||
    c.includes("thinking")
  );
}

function clipContent(
  role,
  text,
  maxLen = 1400
) {
  const t =
    (text || "").trim();

  if (
    t.length <= maxLen
  ) {
    return t;
  }

  if (
    role === "assistant"
  ) {
    return (
      "… " +
      t.slice(-maxLen)
    );
  }

  return (
    t.slice(0, maxLen) +
    " …"
  );
}

function normalizeHistory(
  history,
  maxItems = 4
) {
  if (
    !Array.isArray(history)
  ) {
    return [];
  }

  const last =
    history.slice(-maxItems);

  const cleaned = [];

  for (
    const h of last
  ) {
    const role =
      (
        h &&
        typeof h.role === "string"
      )
        ? h.role.slice(0, 20)
        : "user";

    let raw =
      (
        h &&
        typeof h.content === "string"
      )
        ? h.content
        : "";

    raw =
      stripLeadingFillers(raw);

    if (!raw) {
      continue;
    }

    if (
      role === "assistant" &&
      isPlaceholderAssistantMessage(
        raw
      )
    ) {
      continue;
    }

    cleaned.push({
      role,
      content:
        clipContent(
          role,
          raw,
          1400
        )
    });
  }

  return cleaned;
}

// ==========================================================
// SHORT REPLIES
// ==========================================================

function isShortAffirmation(text) {
  const t =
    (text || "")
      .trim()
      .toLowerCase();

  return [
    "ja",
    "j",
    "ok",
    "okay",
    "passt",
    "gerne",
    "mach",
    "bitte",
    "weiter"
  ].includes(t);
}

function isShortNegation(text) {
  const t =
    (text || "")
      .trim()
      .toLowerCase();

  return [
    "nein",
    "n",
    "no",
    "nicht",
    "lieber nicht"
  ].includes(t);
}

function expandShortReply(
  question,
  history
) {
  const q =
    (question || "").trim();

  if (!q) {
    return q;
  }

  const lastAssistant =
    Array.isArray(history)
      ? [...history]
          .reverse()
          .find(
            (m) =>
              m.role ===
                "assistant" &&
              m.content
          )
      : null;

  if (!lastAssistant) {
    return q;
  }

  if (
    isShortAffirmation(q)
  ) {
    return (
      "Ja. Bitte knüpfe an die letzte " +
      "Frage/Handlungsaufforderung an und " +
      "führe den nächsten Schritt aus."
    );
  }

  if (
    isShortNegation(q)
  ) {
    return (
      "Nein. Bitte knüpfe an die letzte " +
      "Frage/Handlungsaufforderung an und " +
      "schlage eine Alternative vor."
    );
  }

  return q;
}

// ==========================================================
// ROUTER META GUARD
// ==========================================================

function looksLikeRouterMeta(
  text = ""
) {
  const t =
    String(text).trim();

  const ROUTER_PIPELINE_RE =
    /\b(CONTEXT|INTENT|TOPIC|OPEN|RISK|FM|VECTOR)\s*=\s*[^|]+(\s*\|\s*(CONTEXT|INTENT|TOPIC|OPEN|RISK|FM|VECTOR)\s*=\s*[^|]+)+/i;

  const ROUTER_LINE_RE =
    /^\s*(FM|CONTEXT|INTENT|TOPIC|OPEN|RISK|VECTOR)\s*=\s*.+$/i;

  const looksLikeMetaExplanation =
    /erkl[aä]rung und bedeutung/i.test(t) ||
    (
      /\bcontext\s*:/i.test(t) &&
      /\bintent\s*:/i.test(t)
    ) ||
    (
      /\btopic\s*:/i.test(t) &&
      /\brisk\s*:/i.test(t)
    );

  return (
    ROUTER_PIPELINE_RE.test(t) ||
    ROUTER_LINE_RE.test(t) ||
    looksLikeMetaExplanation
  );
}

// ==========================================================
// LEAK / INJECTION
// ==========================================================

function isLeakAttempt(text) {
  const t =
    (text || "").toLowerCase();

  /*
   * WICHTIG:
   *
   * "Vector Store", "file_search", "tools",
   * "payload" usw. sind keine automatischen
   * Leak-Versuche.
   *
   * Ein Nutzer darf ausdrücklich sagen:
   * "Nutze den Vector Store."
   */

  const needles = [
    "system prompt",
    "systemprompt",
    "system_prompt",

    "[system]",
    "[developer]",

    "hidden instruction",
    "versteckte anweisung",
    "interne anweisung",
    "interne anweisungen",

    "zeige den prompt",
    "zeige deinen prompt",
    "prompt ausgeben",
    "zeige mir den systemprompt",
    "gib mir deine systemanweisung",

    "api key",
    "apikey",
    "api schlüssel",

    "access token",
    "secret key",

    "geheime anweisung",
    "interne instruktion",

    "\"system_prompt\":",
    "\"secrets\":"
  ];

  if (
    needles.some(
      n => t.includes(n)
    )
  ) {
    return true;
  }

  if (
    t.includes("json") &&
    (
      t.includes(
        "system_prompt"
      ) ||
      t.includes("secrets") ||
      t.includes("developer")
    )
  ) {
    return true;
  }

  return false;
}

function looksLikeSecurityHallucination(
  text
) {
  const v =
    String(text || "")
      .toLowerCase();

  const markers = [
    "entdeckte prompt injection",
    "offizielles sicherheitsprotokoll",
    "systemsteuerungsprotokolle",
    "forens",
    "n-dex",
    "automatischer forens"
  ];

  return (
    markers.filter(
      m => v.includes(m)
    ).length >= 2
  );
}

// ==========================================================
// REPLY SANITIZATION
// ==========================================================

function sanitizeReply(text) {
  let out =
    String(text || "").trim();

  const looksJson =
    (
      out.startsWith("{") &&
      out.endsWith("}")
    ) ||
    (
      out.startsWith("[") &&
      out.endsWith("]")
    );

  if (looksJson) {
    try {
      const obj =
        JSON.parse(out);

      const answer =
        (
          obj &&
          typeof obj.answer ===
            "string" &&
          obj.answer
        ) ||
        (
          obj &&
          obj.data &&
          typeof obj.data.answer ===
            "string" &&
          obj.data.answer
        ) ||
        (
          obj &&
          obj.result &&
          typeof obj.result ===
            "string" &&
          obj.result
        ) ||
        (
          obj &&
          obj.choices &&
          obj.choices[0] &&
          obj.choices[0].message &&
          obj.choices[0].message.content
        ) ||
        "";

      if (answer) {
        out =
          String(answer);
      }
    } catch {
      // unverändert lassen
    }
  }

  out =
    out.replace(
      /【[^】]{1,200}】/g,
      ""
    );

  const ROUTER_LINE_RE =
    /^\s*(FM|CONTEXT|INTENT|TOPIC|OPEN|RISK|VECTOR)\s*=\s*.+$/i;

  const ROUTER_PIPELINE_RE =
    /\b(CONTEXT|INTENT|TOPIC|OPEN|RISK|FM|VECTOR)\s*=\s*[^|]+(\s*\|\s*(CONTEXT|INTENT|TOPIC|OPEN|RISK|FM|VECTOR)\s*=\s*[^|]+)+/i;

  let lines =
    out.split(/\r?\n/);

  lines =
    lines.filter(
      ln =>
        !ROUTER_PIPELINE_RE.test(
          ln
        )
    );

  lines =
    lines.filter(
      ln =>
        !ROUTER_LINE_RE.test(
          ln
        )
    );

  out =
    lines.join("\n").trim();

  const looksLikeMetaExplanation =
    /erkl[aä]rung und bedeutung/i.test(out) ||
    (
      /\bcontext\s*:/i.test(out) &&
      /\bintent\s*:/i.test(out)
    ) ||
    (
      /\btopic\s*:/i.test(out) &&
      /\brisk\s*:/i.test(out)
    );

  if (
    looksLikeMetaExplanation
  ) {
    return (
      "Ich habe interne Steuer-/Routing-Informationen " +
      "ausgeblendet. Stelle bitte deine fachliche " +
      "Frage noch einmal, dann beantworte ich sie direkt."
    );
  }

  if (
    looksLikeSecurityHallucination(
      out
    )
  ) {
    return (
      "Ich kann dir helfen. Formuliere bitte deine " +
      "fachliche Frage normal, dann antworte ich " +
      "direkt mit einer klaren Erklärung."
    );
  }

  out =
    out.replace(
      /\n{3,}/g,
      "\n\n"
    ).trim();

  return out;
}

// ==========================================================
// FACHMODUS
// ==========================================================

function normalizeFm(value) {
  const v =
    value == null
      ? ""
      : String(value).trim();

  if (!v) {
    return "";
  }

  const u =
    v.toUpperCase();

  if (
    [
      "AEVO",
      "VWL",
      "PERSONAL"
    ].includes(u)
  ) {
    return u;
  }

  return "";
}

// ==========================================================
// VECTOR DECISION
// ==========================================================

function getUserTextForVectorDecision(
  question,
  history
) {
  const parts = [];

  const q =
    (question || "").trim();

  if (q) {
    parts.push(q);
  }

  if (
    Array.isArray(history)
  ) {
    for (
      const m of history
    ) {
      if (
        m &&
        m.role === "user" &&
        typeof m.content ===
          "string" &&
        m.content.trim()
      ) {
        parts.push(
          m.content.trim()
        );
      }
    }
  }

  return parts.join(" \n");
}

function detectVectorYes(
  question,
  history
) {
  const hay =
    getUserTextForVectorDecision(
      question,
      history
    ).toLowerCase();

  const triggers = [
    "mehr details",
    "urteil",
    "urteile",
    "kündigung",
    "arbeitszeit",
    "berufsschule",
    "verstehe ich nicht",
    "erkläre genau",
    "europäische zentralbank",
    "ezb",
    "inflation",
    "rechenweg",
    "erkläre genauer",
    "erkläre besser",
    "abmahnung",
    "ermahnung",
    "schwierigkeit",
    "probleme",
    "prüfung",
    "prüfungsfrage",
    "beschwerde",
    "ich fühle mich unsicher",
    "ausführlicher",
    "detaillierter",
    "genauer",
    "vertiefung",
    "vertiefen",
    "schritt für schritt",
    "nochmal erklären",
    "bitte erklären",
    "erläutere",
    "erläuterung",
    "unklar",
    "verwirrend",
    "wie meinst du das",
    "was heißt das",
    "begründung",
    "belege",
    "quelle",
    "quellen",
    "rechtsgrundlage",
    "gesetzlich",
    "§",
    "art.",
    "abs.",
    "satz",
    "nr.",
    "aktenzeichen",
    "az.",
    "beschluss",
    "rechtsprechung",
    "bag",
    "bgh",
    "bverfg",
    "lag",
    "olg",
    "ovg",
    "probezeit",
    "fristlos",
    "außerordentlich",
    "ordentlich",
    "freistellung",
    "blockunterricht",
    "fehlzeit",
    "abmahnen",
    "verwarnung",
    "pflichtverletzung",
    "geldpolitik",
    "leitzins",
    "verbraucherpreisindex",
    "vpi",
    "kaufkraft",
    "deflation",
    "preisniveau",
    "formel",
    "beispielrechnung",
    "berechnung",
    "herleitung",
    "prozentrechnung"
  ];

  if (
    /(^|\s)(§|art\.)\s*\d+/i.test(
      hay
    )
  ) {
    return true;
  }

  for (
    const t of triggers
  ) {
    if (t === "§") {
      if (
        hay.includes("§")
      ) {
        return true;
      }

      continue;
    }

    if (
      hay.includes(t)
    ) {
      return true;
    }
  }

  return false;
}

function detectNeed(
  vectorYes,
  question
) {
  if (vectorYes) {
    return "VECTOR";
  }

  const q =
    (question || "")
      .trim()
      .toLowerCase();

  const isDef =
    q.length <= 220 &&
    (
      q.startsWith("was ist") ||
      q.includes("was bedeutet") ||
      q.includes("definition") ||
      q.includes("kurz erklär")
    );

  if (isDef) {
    return "FAST";
  }

  return "DEFAULT";
}

// ==========================================================
// SCHNELLMODUS - DEEPSEEK
// ==========================================================

function wantsFastMode(body) {
  return (
    body?.schnellmodus === true ||
    body?.routing?.preferred_model ===
      "Linda3Schnellmodus"
  );
}

function getDeepSeekConfig() {
  const v =
    String(
      process.env.Linda3Schnellmodus ||
      ""
    ).trim();

  let apiKey =
    String(
      process.env.DEEPSEEK_API_KEY ||
      ""
    ).trim();

  let model =
    String(
      process.env.DEEPSEEK_MODEL ||
      "deepseek-chat"
    ).trim();

  if (v) {
    if (
      v.startsWith("sk-")
    ) {
      apiKey = v;
    } else {
      model = v;
    }
  }

  return {
    apiKey,
    model
  };
}

async function callDeepSeek({
  question,
  history,
  fm_user,
  signal
}) {
  const {
    apiKey,
    model
  } =
    getDeepSeekConfig();

  if (!apiKey) {
    throw new Error(
      "DeepSeek API Key fehlt " +
      "(Linda3Schnellmodus oder DEEPSEEK_API_KEY)"
    );
  }

  const messages = [
    {
      role: "system",
      content:
        "Du bist Linda. Antworte klar, fachlich korrekt und auf Deutsch."
    },

    ...(fm_user
      ? [
          {
            role: "system",
            content:
              `Fachmodus: ${fm_user}`
          }
        ]
      : []),

    ...(Array.isArray(history)
      ? history.slice(-8)
      : []),

    {
      role: "user",
      content: question
    }
  ];

  const r =
    await fetch(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${apiKey}`
        },

        body:
          JSON.stringify({
            model,
            temperature: 0.2,
            messages
          }),

        signal
      }
    );

  const txt =
    await r.text();

  if (!r.ok) {
    throw new Error(
      `DeepSeek HTTP ${r.status}: ${txt.slice(0, 600)}`
    );
  }

  try {
    const j =
      JSON.parse(txt);

    return (
      j?.choices?.[0]?.message?.content ||
      j?.answer ||
      j?.response ||
      txt
    );
  } catch {
    return txt;
  }
}

// ==========================================================
// OPENAI RESPONSES API
// ==========================================================

const OPENAI_VECTOR_STORE_ID =
  "vs_6916eafa6a3481918ccf6ef526fa9aa3";

const OPENAI_MODEL =
  "gpt-5.6-luna";

const LINDA_SYSTEM_PROMPT = `
Du bist Linda, eine fachlich anspruchsvolle deutschsprachige Assistenz für Berufsbildung, BBiG, AEVO, Ausbildungsrecht, Prüfungswesen, Prüferrecht und Personalthemen.

ZIEL:
Erstelle fachlich belastbare, klare und präzise Antworten. Bei Prüfungs-, Prüfer- und Rechtsfragen hat fachliche Genauigkeit Vorrang vor Geschwindigkeit und sprachlicher Gefälligkeit.

ARBEITSWEISE:
1. Verstehe zuerst exakt die Frage und den konkreten Sachverhalt.
2. Wenn eine für die Bewertung entscheidende Information fehlt oder mehrere Sachverhaltsvarianten zu unterschiedlichen Ergebnissen führen, stelle gezielte Rückfragen. Erfinde keine fehlenden Tatsachen.
3. Bei komplexen Fällen identifiziere intern die entscheidungserheblichen Teilfragen und prüfe sie nacheinander. Gib keine interne Gedankenkette aus, sondern nur das Ergebnis und eine nachvollziehbare Begründung.
4. Unterscheide strikt zwischen:
   - ausdrücklich geregelt
   - aus einer Regel vertretbar ableitbar
   - fachlich naheliegend
   - nicht geregelt
   - unsicher
5. Erfinde keine Rechtsnormen, Paragraphen, Gerichtsentscheidungen, Fundstellen oder Quellen.

RECHT UND AKTUALITÄT:
Bei BBiG, Ausbildungsrecht, Prüfungsrecht und Prüferrecht ist das aktuell geltende Recht maßgeblich.

Verwende die bereitgestellten Referenzdokumente aktiv.

Wenn die verfügbaren Quellen eine aktuelle Rechtslage nicht sicher belegen, sage das ausdrücklich.

Behaupte keine veraltete Regel als aktuelle Rechtslage.

QUELLENHIERARCHIE IM PRÜFUNGSKONTEXT:
1. einschlägige Prüfungsordnung bzw. konkrete Rechtsvorschrift
2. einschlägige Ausbildungs-, Umschulungs- oder Fortbildungsordnung
3. bereitgestellte IHK-Prüferhandreichungen und Qualifizierungsunterlagen
4. sonstige bereitgestellte Referenzdokumente
5. allgemeines Modellwissen nur ergänzend

Eine niedrigere Quelle darf eine höherrangige Regel nicht überdehnen oder ersetzen.

PRÜFERROLLE:
Die Rolle des Prüfers ist strikt von persönlichen oder beruflichen Eigeninteressen zu trennen.

Eine Einmischung, insbesondere persönliche oder berufliche Kontaktanbahnung im Prüfungszusammenhang, ist aus prüfungspraktischer Sicht nicht duldbar.

Unterscheide sauber zwischen:
- nicht duldbar / unprofessionell
- prüfungspraktisch problematisch
- Befangenheit
- konkreter formaler Rechtsverstoß
- Verfahrensfehler

Diese Kategorien dürfen nicht automatisch gleichgesetzt werden.

Bei Befangenheit ist zu prüfen, ob der konkrete Sachverhalt geeignet ist, Misstrauen gegen eine unparteiische Ausübung des Prüfungsamtes zu rechtfertigen.

BEWERTUNG VON PRÜFUNGSFÄLLEN:
Bewerte genau den vorgegebenen Sachverhalt.

Keine pauschalen Verbote allein aus Fairness- oder Ethiküberlegungen ableiten.

Wenn eine Handlung nicht ausdrücklich geregelt ist, darf aus dem Schweigen einer Vorschrift nicht automatisch ein Verbot konstruiert werden.

Allgemeine Prüfungsgrundsätze dürfen nur so weit herangezogen werden, wie sie den konkreten Sachverhalt tatsächlich tragen.

RÜCKFRAGEN:
Wenn entscheidende Informationen fehlen, stelle lieber eine gezielte Rückfrage als eine scheinbar sichere Antwort zu geben.

Bei komplexen Sachverhalten darfst du maximal zwei wesentliche Rückfragen stellen.

Wenn eine Frage trotz kleiner Unklarheiten sinnvoll beantwortbar ist, beantworte sie und kennzeichne die notwendige Annahme kurz.

VECTOR STORE / FILE SEARCH:
Der bereitgestellte Vector Store enthält insbesondere Unterlagen aus Prüferseminaren sowie der Qualifizierung Erstausbildung/Ausbilder.

Bei Fragen mit Bezug zu:
- BBiG
- Ausbildungsrecht
- Prüfungsrecht
- Prüferrecht
- IHK-Prüfungen
- Prüfungsordnung
- Prüferseminar
- Ausbilderqualifizierung

ist File Search aktiv zu verwenden.

Die Antwort muss an den gefundenen Quellen gespiegelt werden.

QUELLEN:
Nenne am Ende jeder Antwort, bei der Referenzdokumente verwendet wurden:

### Quellen geprüft

Nenne ausschließlich tatsächlich verwendete bzw. durch File Search gefundene Dokumente.

Erfinde keine Seitenzahlen, Paragraphen oder Fundstellen.

Trenne Quellenbeleg und eigene Schlussfolgerung sprachlich sauber.

ANTWORTSTIL:
Direkt, fachlich, strukturiert und verständlich.

Bei Prüfungsfällen:
1. Ergebnis
2. Begründung
3. rechtliche/praktische Einordnung
4. gegebenenfalls Abgrenzung
5. Quellen geprüft

Keine unnötigen Disclaimer.

Lieber eine begrenzte belastbare Aussage als eine umfangreiche spekulative Antwort.
`;

function isExamOrLegalQuestion(
  question = ""
) {
  const t =
    String(question)
      .toLowerCase();

  const triggers = [
    "bbig",
    "berufsbildungsgesetz",
    "prüfungsordnung",
    "prüfer",
    "prüferrecht",
    "prüferin",
    "prüfungsausschuss",
    "prüfling",
    "prüfungsteilnehmer",
    "befangenheit",
    "unpartei",
    "chancengleichheit",
    "prüfung",
    "prüfungsfrage",
    "prüfungsfall",
    "ihk",
    "ausbilder",
    "ausbildung",
    "ausbildungsordnung",
    "fortbildungsprüfung",
    "umschulungsprüfung",
    "rechtsgrundlage",
    "paragraph",
    "§",
    "rechtlich",
    "zulässig",
    "unzulässig",
    "verboten",
    "darf",
    "pflicht",
    "verfahrensfehler",
    "bewertung",
    "bewerten",
    "bewertungsfehler"
  ];

  return triggers.some(
    x => t.includes(x)
  );
}

function mapReasoningEffort(
  value,
  question
) {
  const v =
    String(value || "")
      .toLowerCase();

  if (
    v === "hoch" ||
    v === "high" ||
    v === "xhigh" ||
    v === "max"
  ) {
    return "high";
  }

  if (
    v === "niedrig" ||
    v === "low"
  ) {
    return isExamOrLegalQuestion(
      question
    )
      ? "medium"
      : "low";
  }

  return "medium";
}

// ==========================================================
// OPENAI TEXT EXTRACTION
// ==========================================================

function extractOpenAIText(
  resp
) {
  if (
    typeof resp?.output_text ===
      "string" &&
    resp.output_text.trim()
  ) {
    return resp.output_text.trim();
  }

  const parts = [];

  for (
    const item of
      (resp?.output || [])
  ) {
    if (
      item?.type === "message" &&
      Array.isArray(item.content)
    ) {
      for (
        const c of item.content
      ) {
        if (
          c?.type ===
            "output_text" &&
          typeof c.text ===
            "string"
        ) {
          parts.push(c.text);
        }
      }
    }
  }

  return parts
    .join("\n")
    .trim();
}

// ==========================================================
// FILE SEARCH CITATIONS
// ==========================================================

function extractFileCitations(
  resp
) {
  const seen =
    new Set();

  const files = [];

  for (
    const item of
      (resp?.output || [])
  ) {

    if (
      item?.type ===
        "file_search_call"
    ) {
      const results =
        Array.isArray(
          item.results
        )
          ? item.results
          : [];

      for (
        const r of results
      ) {
        const name =
          r?.filename ||
          r?.file?.filename ||
          r?.file_name;

        if (
          name &&
          !seen.has(name)
        ) {
          seen.add(name);
          files.push(name);
        }
      }
    }

    if (
      item?.type === "message" &&
      Array.isArray(item.content)
    ) {
      for (
        const c of item.content
      ) {
        for (
          const a of
            (c?.annotations || [])
        ) {
          if (
            (
              a?.type ===
                "file_citation" ||
              a?.type ===
                "file_path"
            ) &&
            (
              a?.filename ||
              a?.file_name
            )
          ) {
            const name =
              a?.filename ||
              a?.file_name;

            if (
              !seen.has(name)
            ) {
              seen.add(name);
              files.push(name);
            }
          }
        }
      }
    }
  }

  return files;
}

function appendSourceBlock(
  text,
  filenames
) {
  if (
    !filenames.length
  ) {
    return text;
  }

  if (
    /###\s*Quellen geprüft/i.test(
      text
    )
  ) {
    return text;
  }

  const lines =
    filenames.map(
      f => `- ${f}`
    );

  return (
    `${text.trim()}\n\n` +
    `### Quellen geprüft\n` +
    `${lines.join("\n")}`
  );
}

// ==========================================================
// OPENAI CALL
// ==========================================================

async function callOpenAI({
  question,
  history,
  fm_user,
  context,
  reasoning_effort,
  signal
}) {
  const apiKey =
    String(
      process.env.OPENAI_API_KEY ||
      ""
    ).trim();

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY fehlt in Vercel Environment"
    );
  }

  const exam =
    isExamOrLegalQuestion(
      question
    );

  const effort =
    mapReasoningEffort(
      reasoning_effort,
      question
    );

  const safeHistory =
    Array.isArray(history)
      ? history.slice(-6)
      : [];

  const contextBlock =
    context
      ? (
          "\nZusätzlicher Kontext aus Linda:\n" +
          String(context).slice(
            0,
            5000
          )
        )
      : "";

  const fmBlock =
    fm_user
      ? `\nFachmodus: ${fm_user}`
      : "";

  const examBlock =
    exam
      ? (
          "\nPRÜFUNGS-/RECHTSMODUS AKTIV: " +
          "Prüfe den Sachverhalt besonders streng " +
          "anhand der bereitgestellten Referenzen. " +
          "Bei fehlenden entscheidungserheblichen " +
          "Angaben darfst du zuerst Rückfragen stellen."
        )
      : "";

  const input = [
    ...safeHistory
      .filter(
        m =>
          m &&
          (
            m.role === "user" ||
            m.role === "assistant"
          )
      )
      .map(
        m => ({
          role:
            m.role,
          content:
            String(
              m.content || ""
            )
        })
      ),

    {
      role: "user",
      content:
        `${question}${fmBlock}${contextBlock}${examBlock}`
    }
  ];

  // ========================================================
  // VECTOR STORE
  // ========================================================

  const tools = [
    {
      type: "file_search",

      vector_store_ids: [
        OPENAI_VECTOR_STORE_ID
      ],

      max_num_results: 12
    }
  ];

  // ========================================================
  // OPENAI PAYLOAD
  // ========================================================

  const payload = {
    model:
      OPENAI_MODEL,

    instructions:
      LINDA_SYSTEM_PROMPT,

    input,

    tools,

    include: [
      "file_search_call.results"
    ],

    reasoning: {
      effort
    },

    max_output_tokens:
      5000,

    store:
      false
  };

  /*
   * KEIN tool_choice = "required".
   *
   * File Search steht dem Modell zur Verfügung.
   * Der System-Prompt fordert die Nutzung bei
   * Prüfungs-/Rechtsfragen ausdrücklich an.
   */

  let r;

  try {
    r =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${apiKey}`
          },

          body:
            JSON.stringify(
              payload
            ),

          signal
        }
      );
  } catch (networkError) {
    throw new Error(
      "Netzwerkfehler beim Aufruf der OpenAI Responses API: " +
      (
        networkError?.message ||
        "Unbekannter Netzwerkfehler"
      )
    );
  }

  const txt =
    await r.text();

  if (!r.ok) {
    let detail =
      txt;

    try {
      const parsed =
        JSON.parse(txt);

      if (
        parsed?.error
      ) {
        detail =
          JSON.stringify(
            parsed.error
          );
      }
    } catch {
      // Rohtext verwenden
    }

    throw new Error(
      `OpenAI HTTP ${r.status}: ${detail.slice(0, 3000)}`
    );
  }

  let resp;

  try {
    resp =
      JSON.parse(txt);
  } catch {
    throw new Error(
      "OpenAI lieferte kein gültiges JSON: " +
      txt.slice(0, 1000)
    );
  }

  const answer =
    extractOpenAIText(
      resp
    );

  if (!answer) {
    throw new Error(
      "OpenAI lieferte keine Textantwort. " +
      `Response-ID: ${resp?.id || "unbekannt"}; ` +
      `Modell: ${resp?.model || OPENAI_MODEL}`
    );
  }

  const filenames =
    extractFileCitations(
      resp
    );

  /*
   * ENTSCHEIDEND:
   *
   * Wir geben das tatsächlich von OpenAI
   * zurückgemeldete Modell zurück.
   */

  return {
    text:
      appendSourceBlock(
        answer,
        filenames
      ),

    model:
      resp?.model ||
      OPENAI_MODEL,

    response_id:
      resp?.id ||
      "",

    sources:
      filenames
  };
}

// ==========================================================
// HANDLER
// ==========================================================

export default async function handler(
  req,
  res
) {
  // ========================================================
  // METHOD
  // ========================================================

  if (
    req.method !== "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );

    return sendJson(
      res,
      405,
      {
        error:
          "Nur POST erlaubt"
      }
    );
  }

  // ========================================================
  // SAME ORIGIN
  // ========================================================

  if (
    !allowSameOrigin(req)
  ) {
    return sendJson(
      res,
      403,
      {
        error:
          "Origin/Referer nicht erlaubt (Same-Origin only)"
      }
    );
  }

  // ========================================================
  // CONTENT TYPE
  // ========================================================

  const ct =
    (
      req.headers[
        "content-type"
      ] || ""
    ).toLowerCase();

  if (
    !ct.includes(
      "application/json"
    )
  ) {
    return sendJson(
      res,
      415,
      {
        error:
          "Content-Type muss application/json sein"
      }
    );
  }

  // ========================================================
  // BODY
  // ========================================================

  let raw = "";

  try {
    raw =
      await readRawBody(
        req,
        32 * 1024
      );
  } catch (e) {

    if (
      e &&
      e.code ===
        "PAYLOAD_TOO_LARGE"
    ) {
      return sendJson(
        res,
        413,
        {
          error:
            "Payload zu groß (max 32KB)"
        }
      );
    }

    return sendJson(
      res,
      400,
      {
        error:
          "Body konnte nicht gelesen werden",

        detail:
          e?.message
      }
    );
  }

  let body = {};

  try {
    body =
      raw
        ? JSON.parse(raw)
        : {};
  } catch {
    return sendJson(
      res,
      400,
      {
        error:
          "Ungültiges JSON"
      }
    );
  }

  // ========================================================
  // QUESTION
  // ========================================================

  const questionRaw =
    typeof body.question ===
      "string"
      ? body.question
      : "";

  let question =
    stripLeadingFillers(
      questionRaw
    );

  // ========================================================
  // ROUTER META
  // ========================================================

  if (
    looksLikeRouterMeta(
      question
    )
  ) {
    res.statusCode =
      200;

    res.setHeader(
      "Content-Type",
      "text/plain; charset=utf-8"
    );

    return res.end(
      "Ich habe interne Steuer-/Routing-Informationen erkannt und ausgeblendet. " +
      "Bitte stelle deine fachliche Frage in einem normalen Satz, dann beantworte ich sie direkt."
    );
  }

  // ========================================================
  // HISTORY
  // ========================================================

  let history =
    normalizeHistory(
      body.history,
      4
    );

  question =
    expandShortReply(
      question,
      history
    );

  if (!question) {
    return sendJson(
      res,
      400,
      {
        error:
          "question fehlt"
      }
    );
  }

  if (
    question.length >
    2000
  ) {
    return sendJson(
      res,
      413,
      {
        error:
          "question zu lang (max 2000 Zeichen)"
      }
    );
  }

  // ========================================================
  // LEAK PROTECTION
  // ========================================================

  if (
    isLeakAttempt(
      question
    )
  ) {
    res.statusCode =
      200;

    res.setHeader(
      "Content-Type",
      "text/plain; charset=utf-8"
    );

    return res.end(
      "Ich kann keine internen Anweisungen, Prompts, technischen IDs, Logs oder Tool-Strukturen ausgeben. " +
      "Stelle mir bitte deine fachliche Frage, dann helfe ich dir gern weiter."
    );
  }

  // ========================================================
  // META
  // ========================================================

  const fm_user =
    normalizeFm(
      body.fm_user ||
      body.fachmodus ||
      ""
    );

  const context =
    (
      body.context == null
    )
      ? ""
      : String(
          body.context
        ).slice(
          0,
          5000
        );

  const vector_yes =
    detectVectorYes(
      question,
      history
    );

  const need =
    detectNeed(
      vector_yes,
      question
    );

  const fastRequested =
    wantsFastMode(
      body
    );

  // ========================================================
  // TIMEOUT
  // ========================================================

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      90000
    );

  try {

    // ======================================================
    // SCHNELLMODUS
    // ======================================================

    if (
      fastRequested
    ) {
      try {

        const dsText =
          await callDeepSeek({
            question,
            history,
            fm_user,
            signal:
              controller.signal
          });

        clearTimeout(
          timeout
        );

        const cleaned =
          sanitizeReply(
            dsText
          );

        res.statusCode =
          200;

        res.setHeader(
          "Content-Type",
          "text/plain; charset=utf-8"
        );

        /*
         * Schnellmodus bleibt vollständig
         * getrennt von OpenAI.
         */

        res.setHeader(
          "X-Linda-Model",
          "DeepSeek"
        );

        return res.end(
          cleaned
        );

      } catch (e) {

        console.error(
          "DeepSeek Schnellmodus-Fehler:",
          e?.message || e
        );

        clearTimeout(
          timeout
        );

        return sendJson(
          res,
          502,
          {
            error:
              "Schnellmodus konnte nicht verarbeitet werden",

            detail:
              e?.message ||
              "Unbekannter DeepSeek-Fehler"
          }
        );
      }
    }

    // ======================================================
    // NORMALMODUS
    // OPENAI RESPONSES API
    // ======================================================

    const result =
      await callOpenAI({
        question,
        history,
        fm_user,
        context,

        reasoning_effort:
          body?.routing
            ?.reasoning_effort ||
          body?.reasoning_effort ||
          "medium",

        signal:
          controller.signal
      });

    clearTimeout(
      timeout
    );

    const cleaned =
      sanitizeReply(
        result.text
      );

    res.statusCode =
      200;

    res.setHeader(
      "Content-Type",
      "text/plain; charset=utf-8"
    );

    // ======================================================
    // DEBUG: TATSÄCHLICHES MODELL
    // ======================================================

    /*
     * Diese beiden Informationen werden TEMPORÄR
     * direkt an die Antwort angehängt.
     *
     * Damit sehen wir ohne Browser-Netzwerktools,
     * welches Modell OpenAI tatsächlich zurückmeldet.
     */

    const modelInfo =
      "\n\n" +
      `[LINDA-DEBUG-MODELL: ${
        result.model ||
        OPENAI_MODEL
      }]` +
      "\n" +
      `[LINDA-DEBUG-RESPONSE: ${
        result.response_id ||
        "unbekannt"
      }]`;

    return res.end(
      cleaned +
      modelInfo
    );

  } catch (e) {

    clearTimeout(
      timeout
    );

    console.error(
      "LINDA OPENAI API FEHLER:",
      {
        name:
          e?.name,

        message:
          e?.message,

        stack:
          e?.stack
      }
    );

    if (
      e?.name ===
      "AbortError"
    ) {
      return sendJson(
        res,
        504,
        {
          error:
            "OpenAI-Anfrage wegen Zeitüberschreitung abgebrochen",

          model:
            OPENAI_MODEL,

          vector_store:
            OPENAI_VECTOR_STORE_ID
        }
      );
    }

    return sendJson(
      res,
      500,
      {
        error:
          "Fehler bei OpenAI",

        detail:
          e?.message ||
          "Unbekannter Fehler",

        model:
          OPENAI_MODEL,

        vector_store:
          OPENAI_VECTOR_STORE_ID,

        timestamp:
          new Date().toISOString()
      }
    );
  }
}
