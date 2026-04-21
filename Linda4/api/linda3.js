const fs = require('fs');
const path = require('path');

const DEFAULT_LEGACY_ORIGIN = 'https://vercel-kappa-seven-33.vercel.app';
const LEGACY_ORIGIN = process.env.LINDA3_LEGACY_API_ORIGIN || DEFAULT_LEGACY_ORIGIN;
const SOCIALRECHT_CONFIG_PATH = path.join(process.cwd(), 'docs', 'sozialrecht_runtime.json');

const DEFAULT_SOCIALRECHT_CONFIG = {
  version: '1.0',
  domain: 'SOZIALRECHT',
  routing: {
    default_model: 'gpt-5.1',
    fast_model: 'deepseek-reasoner',
    overview_model: 'gpt-4.1',
    judgment_model: 'gpt-5.1',
    judgment_max_output_tokens: 520,
    overview_max_output_tokens: 900,
    temperature: 0.1,
    max_output_tokens: 1200
  },
  accuracy_policy: {
    high_accuracy_required: true,
    prefer_clarification_over_guessing: true,
    strict_unknown_on_missing_basis: true,
    require_legal_basis_references: true
  },
  clarification_policy: {
    enabled: true,
    min_question_chars: 18,
    max_tokens_without_context: 5,
    ambiguous_patterns: ['ist das richtig', 'stimmt das', 'wie ist das', 'geht das', 'was meinst du'],
    default_followups: [
      'Worum geht es genau (Leistung, Anspruch oder Verfahren)?',
      'Fuer wen soll ich den Fall pruefen (Arbeitnehmer, Arbeitgeber, Azubi, Krankenkasse)?',
      'Geht es um akuten Notfall, geplante Behandlung oder allgemeine Leistungsklaerung?'
    ]
  },
  storage: {
    vector_store_env_key: 'OPENAI_VECTOR_STORE_ID_SOZIALRECHT',
    enabled_when_env_present: true
  }
};

function resolveSozialrechtApiKey() {
  const dedicated = normalizeText(process.env.Sozialrecht2026 || process.env.SOZIALRECHT2026 || '');
  if (dedicated) {
    return {
      key: dedicated,
      source: 'Sozialrecht2026'
    };
  }
  const globalKey = normalizeText(process.env.OPENAI_API_KEY || '');
  if (globalKey) {
    return {
      key: globalKey,
      source: 'OPENAI_API_KEY'
    };
  }
  return {
    key: '',
    source: ''
  };
}

function resolveSozialrechtSchnellKey() {
  return normalizeText(process.env.SozialrechtSchnell || process.env.SOZIALRECHT_SCHNELL || '');
}

function clamp01(value, fallback = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function parseJsonSafe(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value) {
  const raw = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw) return '';
  return raw
    .split('\n')
    .map((line) => line.replace(/\t+/g, ' ').replace(/ {2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readRequestBodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return parseJsonSafe(req.body.toString('utf8'), {});
  if (typeof req.body === 'string') return parseJsonSafe(req.body, {});
  return {};
}

function readRequestBodyRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

function getAction(req) {
  if (req?.query?.action) return String(req.query.action).toLowerCase();
  try {
    const u = new URL(req.url || '', 'http://localhost');
    return String(u.searchParams.get('action') || 'bot').toLowerCase();
  } catch (_) {
    return 'bot';
  }
}

function parseOriginSafe(value, fallback = '') {
  const raw = normalizeText(value);
  if (!raw) return fallback;
  try {
    return new URL(raw).origin;
  } catch (_) {
    return fallback;
  }
}

function requestOrigin(req) {
  const host = normalizeText(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '');
  const protoRaw = String(req?.headers?.['x-forwarded-proto'] || 'https');
  const proto = normalizeText(protoRaw.split(',')[0] || 'https').replace(/[^a-z]/gi, '') || 'https';
  if (!host) return '';
  return `${proto}://${host}`;
}

function resolveLegacyOriginForRequest(req) {
  const configured = parseOriginSafe(LEGACY_ORIGIN, DEFAULT_LEGACY_ORIGIN);
  const reqOrigin = parseOriginSafe(requestOrigin(req), '');
  if (!configured) return DEFAULT_LEGACY_ORIGIN;
  if (reqOrigin && configured === reqOrigin) return DEFAULT_LEGACY_ORIGIN;
  return configured;
}

function loadSozialrechtConfig() {
  try {
    const raw = fs.readFileSync(SOCIALRECHT_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SOCIALRECHT_CONFIG };
    return {
      ...DEFAULT_SOCIALRECHT_CONFIG,
      ...parsed,
      routing: {
        ...DEFAULT_SOCIALRECHT_CONFIG.routing,
        ...(parsed.routing || {})
      },
      accuracy_policy: {
        ...DEFAULT_SOCIALRECHT_CONFIG.accuracy_policy,
        ...(parsed.accuracy_policy || {})
      },
      clarification_policy: {
        ...DEFAULT_SOCIALRECHT_CONFIG.clarification_policy,
        ...(parsed.clarification_policy || {})
      },
      storage: {
        ...DEFAULT_SOCIALRECHT_CONFIG.storage,
        ...(parsed.storage || {})
      }
    };
  } catch (_) {
    return { ...DEFAULT_SOCIALRECHT_CONFIG };
  }
}

function sanitizeHistory(history, limit = 6) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const roleRaw = String(entry.role || '').toLowerCase();
      const role = roleRaw === 'assistant' ? 'assistant' : 'user';
      const content = normalizeText(entry.content || '');
      if (!content) return null;
      return { role, content: content.slice(0, 1400) };
    })
    .filter(Boolean)
    .slice(-limit);
}

function hasMeaningfulContext(history) {
  return sanitizeHistory(history, 2).length > 0;
}

function topicFromQuestion(question) {
  const text = normalizeText(question);
  if (!text) return 'dein Thema';
  return text.split(/\s+/).slice(0, 9).join(' ');
}

function isJudgmentQuestion(question) {
  const low = normalizeText(question).toLowerCase();
  if (!low) return false;
  return (
    /\b(urteil|urteile|beschluss|beschluesse|beschlüsse|aktenzeichen|az\.?|az:|bsg|bag|bverfg|eu-?gh|egmr|rechtsprechung)\b/i.test(low) ||
    /\b(?:[a-z]{1,4}\s*\d+\s*\/\s*\d+)\b/i.test(low)
  );
}

const SGB_BOOK_OVERVIEW = {
  i: {
    code: 'SGB I',
    title: 'Allgemeiner Teil',
    topics: ['allgemeine Grundsaetze', 'Sozialleistungsansprueche', 'Mitwirkung und Beratung']
  },
  ii: {
    code: 'SGB II',
    title: 'Buergergeld, Grundsicherung fuer Arbeitsuchende',
    topics: ['Leistungsanspruch', 'Bedarfsgemeinschaft', 'Einkommen und Vermittlung']
  },
  iii: {
    code: 'SGB III',
    title: 'Arbeitsfoerderung',
    topics: ['Arbeitslosengeld', 'Foerderung der Beschaeftigung', 'Berufsberatung']
  },
  iv: {
    code: 'SGB IV',
    title: 'Gemeinsame Vorschriften fuer die Sozialversicherung',
    topics: ['Beitragsrecht', 'Meldewesen', 'versicherungsrechtliche Grundbegriffe']
  },
  v: {
    code: 'SGB V',
    title: 'Gesetzliche Krankenversicherung',
    topics: ['Versicherungspflicht', 'Leistungen der Krankenkassen', 'Krankengeld und Beitraege']
  },
  vi: {
    code: 'SGB VI',
    title: 'Gesetzliche Rentenversicherung',
    topics: ['Altersrente', 'Erwerbsminderungsrente', 'Hinterbliebenenrente']
  },
  vii: {
    code: 'SGB VII',
    title: 'Gesetzliche Unfallversicherung',
    topics: ['Arbeitsunfall', 'Berufskrankheit', 'Leistungen der Berufsgenossenschaften']
  },
  viii: {
    code: 'SGB VIII',
    title: 'Kinder- und Jugendhilfe',
    topics: ['Jugendhilfeleistungen', 'Schutzauftrag', 'Hilfen zur Erziehung']
  },
  ix: {
    code: 'SGB IX',
    title: 'Rehabilitation und Teilhabe von Menschen mit Behinderungen',
    topics: ['Rehabilitation', 'Teilhabe', 'Schwerbehindertenrecht']
  },
  x: {
    code: 'SGB X',
    title: 'Sozialverwaltungsverfahren und Sozialdatenschutz',
    topics: ['Verwaltungsverfahren', 'Aufhebung von Bescheiden', 'Sozialdatenschutz']
  },
  xi: {
    code: 'SGB XI',
    title: 'Soziale Pflegeversicherung',
    topics: ['Pflegebeduerftigkeit', 'Pflegegrade', 'Leistungen der Pflegeversicherung']
  },
  xii: {
    code: 'SGB XII',
    title: 'Sozialhilfe',
    topics: ['Hilfe zum Lebensunterhalt', 'Grundsicherung', 'Hilfen in besonderen Lebenslagen']
  }
};

function normalizeSgbBookKey(rawValue) {
  const value = normalizeText(rawValue).toLowerCase().replace(/\./g, '');
  if (!value) return '';
  const arabicMap = {
    '1': 'i',
    '2': 'ii',
    '3': 'iii',
    '4': 'iv',
    '5': 'v',
    '6': 'vi',
    '7': 'vii',
    '8': 'viii',
    '9': 'ix',
    '10': 'x',
    '11': 'xi',
    '12': 'xii'
  };
  return arabicMap[value] || value;
}

function extractRequestedSgbBook(question) {
  const match = normalizeText(question).match(/\bsgb\s*([ivx]+|\d{1,2})\b/i);
  if (!match || !match[1]) return '';
  return normalizeSgbBookKey(match[1]);
}

function isSimpleSgbOverviewQuestion(question) {
  const low = normalizeText(question).toLowerCase();
  if (!low) return false;
  if (!/\bsgb\s*(?:[ivx]+|\d{1,2})\b/i.test(low)) return false;
  if (low.split(/\s+/).length > 10) return false;
  return (
    /^(was ist|was ist das|wofuer steht|wofür steht|was regelt|kurz|erklaer|erklär)/i.test(low) ||
    /^\bsgb\s*(?:[ivx]+|\d{1,2})\b/i.test(low)
  );
}

function buildSimpleSgbOverviewFallback(question) {
  if (!isSimpleSgbOverviewQuestion(question)) return null;
  const key = extractRequestedSgbBook(question);
  const book = SGB_BOOK_OVERVIEW[key];
  if (!book) return null;
  return {
    answer: [
      '### Kurzantwort',
      `${book.code} ist das Buch "${book.title}" im Sozialgesetzbuch.`,
      '',
      '### Wichtige Einordnung',
      `Es regelt vor allem ${book.topics.join(', ')}.`,
      '',
      '### Quellenhinweis',
      `Gesetzesbezeichnung: ${book.code} - ${book.title}.`,
      '',
      '### Naechste sinnvolle Frage',
      `Wenn du magst, ordne ich dir als Nächstes die wichtigsten Inhalte von ${book.code} fuer die IHK-Praxis ein.`
    ].join('\n'),
    followups: [
      `Welche zentralen Inhalte aus ${book.code} sind fuer Personalfachkaufleute wichtig?`,
      `Soll ich dir ${book.code} in 3 bis 5 pruefungsrelevanten Punkten zusammenfassen?`
    ],
    confidence: 0.64,
    evidence_note: `Stabile Grundbezeichnung von ${book.code} verwendet; kein direkter Quellen-Chunk erforderlich.`,
    meta: {
      canonical_sgb_overview: true,
      sgb_book: book.code
    }
  };
}

function isClarificationStyleAnswer(answerText) {
  const low = normalizeText(answerText).toLowerCase();
  if (!low) return false;
  return (
    /\b(brauche ich|bitte konkretisieren|bitte präzisieren|bitte prazisieren|welcher zusammenhang|in welchem zusammenhang|welches thema|was genau meinst du|meinst du)\b/i.test(low) ||
    /\b(entgeltfortzahlung|sgb)\b/i.test(low) && /\b(meinst du|brauch(e|st)|bitte)\b/i.test(low)
  );
}

function buildStandardSocialrechtTopicFallback(question) {
  const low = normalizeText(question).toLowerCase();
  if (!low) return null;

  if (/entgeltfortzahlung\b/i.test(low)) {
    return {
      answer: [
        '### Kurzantwort',
        'Mit "Entgeltfortzahlung" ist im Regelfall die Lohnfortzahlung im Krankheitsfall durch den Arbeitgeber gemeint.',
        'Der Arbeitgeber zahlt dem arbeitsunfaehig erkrankten Arbeitnehmer das vereinbarte Arbeitsentgelt bis zu 6 Wochen (42 Kalendertage) weiter, wenn die gesetzlichen Voraussetzungen erfuellt sind.',
        'Danach greift in der Regel das Krankengeld der Krankenkasse.',
        '',
        '### Rechtsgrundlage (SGB / Nebengesetze)',
        '- Entgeltfortzahlungsgesetz (EFZG) - zentrale Grundlage fuer die Entgeltfortzahlung',
        '- SGB V - Krankengeld als Anschlussleistung nach Ende der Entgeltfortzahlung',
        '',
        '### Naechste sinnvolle Frage',
        'Moechtest du das als Pruefschema, als IHK-Merksatz oder als Abgrenzung zum Krankengeld?'
      ].join('\n'),
      followups: [
        'Soll ich dir dazu ein kurzes Pruefschema erstellen?',
        'Moechtest du die Abgrenzung zwischen Entgeltfortzahlung und Krankengeld?'
      ],
      confidence: 0.74,
      evidence_note: 'Stabile Grundeinordnung zu Entgeltfortzahlung verwendet; kein direkter Quellen-Chunk erforderlich.',
      meta: {
        canonical_topic: 'entgeltfortzahlung'
      }
    };
  }

  return null;
}

function buildAiReviewDisclaimer({ fastMode = false } = {}) {
  return fastMode
    ? 'Hinweis: KI-Antworten bitte immer mit Originalquelle oder Fachunterlagen gegenpruefen. Antwort im Schnellmodus generiert.'
    : 'Hinweis: KI-Antworten bitte immer mit Originalquelle oder Fachunterlagen gegenpruefen.';
}

function buildSozialrechtSignalProfile(question, history, cfg) {
  const text = normalizeText(question);
  const low = text.toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  const policy = cfg?.clarification_policy || {};
  const minChars = Number(policy.min_question_chars || 18);
  const maxTokens = Number(policy.max_tokens_without_context || 5);

  const hasContext = hasMeaningfulContext(history);
  const hasTopicAnchor = (
    /\bsgb\s*(?:i{1,3}|iv|v|vi{0,3}|ix|x|xi|xii|\d{1,2})\b/i.test(low) ||
    /§+\s*\d+[a-z]?(?:\s*abs\.?\s*\d+)?/i.test(low) ||
    /\b(krankengeld|entgeltfortzahlung|arbeitsunfaehig|arbeitslosengeld|buergergeld|pflegegeld|elterngeld|mutterschaftsgeld|sozialhilfe|grundsicherung|rehabilitation|pflegeversicherung|beitrag|leistung)\b/i.test(low)
  );
  const hasActorContext = /\b(arbeitnehmer|arbeitgeber|azubi|auszubild|personalfachkauf|krankenkasse|jobcenter|versicherte|versicherungspflicht|leistungsberechtigt|kind|eltern|pflegeperson|rentner)\b/i.test(low);
  const hasCaseFacts = (
    /\b\d{1,4}(?:[.,]\d+)?\s*(?:euro|eur|%|tage|tag|wochen|woche|monate|monat|jahre|jahr)\b/i.test(low) ||
    /\b(seit|ab|von|bis|frist|datum|zeitraum|beginn|ende|beispiel|fall)\b/i.test(low)
  );
  const hasTravelSignal = /\b(ausland|reise|urlaub|ehic|eu\/ewr|schweiz|drittland|oesterreich|österreich|grossbritannien|uk)\b/i.test(low);
  const hasCountry =
    /\b(oesterreich|österreich|austria|deutschland|germany|schweiz|switzerland|frankreich|france|italien|italy|spanien|spain|niederlande|holland|belgien|belgium|portugal|griechenland|greece|grossbritannien|großbritannien|uk|vereinigtes koenigreich|united kingdom|usa|vereinigte staaten|united states|tuerkei|türkei|turkey)\b/i.test(low);
  const ambiguousPronouns = /\b(das|dies|diese|dieses|dazu|damit|hierzu|so|stimmt das|ist das richtig|wie ist das|geht das)\b/i.test(low);

  const missingDimensions = [];
  if (!hasTopicAnchor) missingDimensions.push('topic_scope');
  if (!hasActorContext) missingDimensions.push('actor_context');
  if (!hasCaseFacts) missingDimensions.push('case_facts');
  if (hasTravelSignal && !hasCountry) missingDimensions.push('travel_country');

  const shortQuestion = (text.length < minChars || tokens.length <= maxTokens) && !hasTopicAnchor;
  const lowSignal = tokens.length <= (maxTokens + 1) && !hasTopicAnchor && !hasCaseFacts;
  const coreMissingCount = missingDimensions.length;
  const shouldClarifyBase =
    shortQuestion ||
    (!hasContext && coreMissingCount >= 2) ||
    (ambiguousPronouns && coreMissingCount >= 1 && tokens.length <= 12) ||
    (hasTravelSignal && !hasCountry) ||
    lowSignal;
  const shouldClarify = shouldClarifyBase;

  const reasons = [];
  if (shortQuestion) reasons.push('Frage ist noch zu knapp fuer eine rechtssichere Einordnung.');
  if (!hasTopicAnchor) reasons.push('Das konkrete Thema oder der Leistungsbezug ist noch nicht klar.');
  if (!hasActorContext) reasons.push('Rollenkontext (z. B. Arbeitnehmer/Arbeitgeber) fehlt.');
  if (!hasCaseFacts) reasons.push('Fallkontext (Zeitraum, Werte oder Ausgangssituation) fehlt.');
  if (hasTravelSignal && !hasCountry) reasons.push('Zielland bzw. Aufenthaltsland ist noch offen.');

  return {
    text,
    tokens,
    hasContext,
    hasTopicAnchor,
    hasActorContext,
    hasCaseFacts,
    hasTravelSignal,
    hasCountry,
    ambiguousPronouns,
    missingDimensions,
    shortQuestion,
    lowSignal,
    shouldClarify,
    reasons
  };
}

function buildClarificationFollowups(profile, cfg) {
  const map = {
    topic_scope: 'Worum geht es konkret (Leistung, Anspruch oder Verfahren)?',
    actor_context: 'Fuer wen soll ich den Fall beantworten (Arbeitnehmer, Arbeitgeber, Azubi, Krankenkasse)?',
    case_facts: 'Geht es um akuten Notfall, geplante Behandlung oder allgemeine Leistungsklaerung?',
    travel_country: 'In welches Land geht die Reise bzw. wo findet der Aufenthalt statt?'
  };
  const out = [];
  profile.missingDimensions.forEach((key) => {
    const q = map[key];
    if (q) out.push(q);
  });
  const defaults = Array.isArray(cfg?.clarification_policy?.default_followups)
    ? cfg.clarification_policy.default_followups.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  defaults
    .filter((q) => !/\bauf welches sgb|sgb-buch|i bis xii\b/i.test(q))
    .filter((q) => !/\bkurzschema|praxisfall|lernkarte|wie soll ich antworten\b/i.test(q))
    .forEach((q) => out.push(q));
  const unique = [];
  const seen = new Set();
  out.forEach((q) => {
    const key = q.toLowerCase();
    if (!q || seen.has(key)) return;
    seen.add(key);
    unique.push(q);
  });
  return unique.slice(0, 4);
}

function shouldClarifyQuestion(question, history, cfg) {
  const policy = cfg?.clarification_policy || {};
  const profile = buildSozialrechtSignalProfile(question, history, cfg);
  if (!policy.enabled) {
    return {
      shouldClarify: false,
      followups: [],
      reasons: [],
      profile
    };
  }

  if (!profile.hasTravelSignal) {
    return {
      shouldClarify: false,
      followups: [],
      reasons: [],
      profile
    };
  }

  const low = profile.text.toLowerCase();
  const patterns = Array.isArray(policy.ambiguous_patterns) ? policy.ambiguous_patterns : [];
  const patternHit = patterns.some((p) => {
    const needle = normalizeText(p).toLowerCase();
    return needle && low.includes(needle);
  });

  const shouldClarify = Boolean(profile.shouldClarify || patternHit);
  const followups = shouldClarify ? buildClarificationFollowups(profile, cfg) : [];
  return {
    shouldClarify,
    followups,
    reasons: profile.reasons.slice(0, 4),
    profile
  };
}

function buildClarificationPayload(cfg, decision = {}, question = '') {
  const followups = Array.isArray(decision?.followups) && decision.followups.length
    ? decision.followups
    : (Array.isArray(cfg?.clarification_policy?.default_followups)
        ? cfg.clarification_policy.default_followups
            .map((item) => normalizeText(item))
            .filter(Boolean)
            .filter((q) => !/\bauf welches sgb|sgb-buch|i bis xii\b/i.test(q))
            .filter((q) => !/\bkurzschema|praxisfall|lernkarte|wie soll ich antworten\b/i.test(q))
            .slice(0, 4)
        : []);
  const reasons = Array.isArray(decision?.reasons) ? decision.reasons.filter(Boolean).slice(0, 3) : [];
  const topic = topicFromQuestion(question);
  const reasonLine = reasons.length ? `\n\nGrund: ${reasons.join(' ')}` : '';
  return {
    answer: [
      '### Rueckfrage benoetigt',
      `Damit ich zu "${topic}" fachlich praezise und pruefungstauglich antworte, brauche ich noch kurze Eckdaten.${reasonLine}`,
      'Bitte beantworte kurz die folgenden Rueckfragen, dann liefere ich dir direkt die strukturierte Endantwort.'
    ].join('\n\n'),
    followups,
    sources: [],
    confidence: 0.2,
    evidence_note: 'Rueckfrage gestellt, um Fehlinterpretationen zu vermeiden.',
    meta: {
      clarification_requested: true,
      domain: 'SOZIALRECHT',
      clarification_reasons: reasons,
      clarification_profile: decision?.profile || {}
    }
  };
}

function buildSozialrechtTechnicalFallback({
  cfg,
  question,
  detail = '',
  answerText = '',
  sources = [],
  storageUsed = false,
  storageFallback = false,
  storageError = '',
  apiKeySource = ''
}) {
  const fallbackFollowups = buildClarificationFollowups(
    buildSozialrechtSignalProfile(question, [], cfg),
    cfg
  );
  const normalizedAnswer = normalizeMultilineText(answerText || '');
  const sourceList = normalizeSources(sources || []);
  const finalSources = normalizeSources(sourceList || []);
  const answer = normalizedAnswer || [
    'Ich weiss es nicht sicher.',
    'Die Verarbeitung ist gerade instabil, deshalb liefere ich vorsichtshalber keine spekulative Antwort.',
    'Bitte frage enger oder versuche es noch einmal.'
  ].join(' ');
  const evidenceBits = [];
  if (detail) evidenceBits.push(`Technischer Hinweis: ${detail}`);
  if (storageUsed && finalSources.length) {
    evidenceBits.push('Vector-Store-Treffer wurden in die Fallback-Antwort übernommen.');
  }
  if (storageFallback) {
    evidenceBits.push('Storage-Abfrage war nicht stabil; es wurde ohne Storage weitergearbeitet.');
  }
  if (storageError) {
    evidenceBits.push(`Storage-Fehler: ${storageError}`);
  }
  if (!finalSources.length && normalizedAnswer) {
    evidenceBits.push('Fallback-Antwort ohne direkt zitierbare Quellen-Chunks.');
  }
  return {
    answer,
    followups: fallbackFollowups,
    sources: finalSources,
    confidence: finalSources.length ? 0.25 : 0.08,
    evidence_note: evidenceBits.join(' ').trim(),
    meta: {
      domain: 'SOZIALRECHT',
      api_key_source: apiKeySource || '',
      runtime_error: true,
      runtime_detail: detail || 'unbekannt'
    }
  };
}

function normalizeSources(rawSources) {
  return (Array.isArray(rawSources) ? rawSources : [])
    .map((item) => {
      if (typeof item === 'string') {
        const title = normalizeText(item);
        if (!title) return null;
        return { title, url: '', excerpt: '', section: '', page: '', note: '', confidence: null };
      }
      if (!item || typeof item !== 'object') return null;
      const title = normalizeText(item.title || item.name || item.label || item.url || 'Quelle');
      const url = normalizeText(item.url || item.link || '');
      const excerpt = normalizeText(item.excerpt || item.quote || item.snippet || item.chunk || '');
      const section = normalizeText(item.section || item.heading || item.chapter || '');
      const page = normalizeText(item.page || item.pageNumber || item.seite || '');
      const note = normalizeText(item.note || item.reason || item.description || '');
      const confidence = clamp01(item.confidence, null);
      if (!title && !url && !excerpt) return null;
      return { title: title || url || 'Quelle', url, excerpt, section, page, note, confidence };
    })
    .filter(Boolean)
    .slice(0, 10);
}

const MAX_JSON_UNWRAP_DEPTH = 2;
const MAX_JSON_LIKE_SCAN_CHARS = 16000;

function canDeepScanJsonLikeText(value) {
  return normalizeMultilineText(value || '').length <= MAX_JSON_LIKE_SCAN_CHARS;
}

function decodeEscapedJsonString(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function extractTruncatedAnswerFragment(text) {
  const raw = normalizeMultilineText(text || '');
  if (!raw) return '';
  if (/\}\s*$/.test(raw)) return '';
  const match = raw.match(/^\s*\{\s*"answer"\s*:\s*"([\s\S]*)$/i);
  if (!match || !match[1]) return '';
  return decodeEscapedJsonString(match[1]);
}

function extractAnswerFromJsonLikeText(rawText) {
  const raw = normalizeMultilineText(rawText || '');
  if (!raw) return '';

  const unwrap = (value, depth = 0) => {
    const text = normalizeMultilineText(value || '');
    if (!text || depth > MAX_JSON_UNWRAP_DEPTH) return text;
    const allowDeepScan = canDeepScanJsonLikeText(text);

    const direct = parseJsonSafe(text, null);
    if (typeof direct === 'string') {
      const nestedString = normalizeMultilineText(direct);
      if (allowDeepScan && nestedString && nestedString !== text) {
        const unwrappedString = unwrap(nestedString, depth + 1);
        if (unwrappedString) return unwrappedString;
      }
      if (nestedString) return nestedString;
    }

    if (direct && typeof direct === 'object') {
      const nestedObjectText = normalizeMultilineText(
        direct.answer ||
        direct.response ||
        direct.text ||
        direct.output ||
        direct.content ||
        direct.excerpt ||
        ''
      );
      if (nestedObjectText) {
        if (allowDeepScan) {
          const unwrappedObjectText = unwrap(nestedObjectText, depth + 1);
          if (unwrappedObjectText) return unwrappedObjectText;
        }
        return nestedObjectText;
      }
    }

    const quotedMatch = text.match(/^[\s\r\n]*"([\s\S]*)"[\s\r\n]*$/);
    if (quotedMatch && quotedMatch[1]) {
      const decodedQuoted = decodeEscapedJsonString(quotedMatch[1]);
      if (allowDeepScan && decodedQuoted && decodedQuoted !== text) {
        const unwrappedQuoted = unwrap(decodedQuoted, depth + 1);
        if (unwrappedQuoted) return unwrappedQuoted;
      }
      if (decodedQuoted) return decodedQuoted;
    }

    const rx = /"answer"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"(?:followups|sources|confidence|meta|evidence_note|reasoning_note|recommended_questions|next_questions|suggestions)\b|[\s\r\n]*})/i;
    const m = text.match(rx);
    if (m && m[1]) {
      const decoded = decodeEscapedJsonString(m[1]);
      if (decoded) {
        if (allowDeepScan) {
          const unwrappedDecoded = unwrap(decoded, depth + 1);
          if (unwrappedDecoded) return unwrappedDecoded;
        }
        return decoded;
      }
    }

    if (allowDeepScan) {
      const truncatedDecoded = extractTruncatedAnswerFragment(text);
      if (truncatedDecoded) {
        const unwrappedTruncated = unwrap(truncatedDecoded, depth + 1);
        if (unwrappedTruncated) return unwrappedTruncated;
        return truncatedDecoded;
      }

      const open = text.indexOf('{');
      const close = text.lastIndexOf('}');
      if (open >= 0 && close > open) {
        const inner = parseJsonSafe(text.slice(open, close + 1), null);
        if (inner && typeof inner === 'object') {
          const innerText = normalizeMultilineText(inner.answer || inner.response || inner.text || inner.output || '');
          if (innerText) {
            const unwrappedInner = unwrap(innerText, depth + 1);
            if (unwrappedInner) return unwrappedInner;
            return innerText;
          }
        }
      }
    }

    return '';
  };

  return unwrap(raw);
}

function extractStructuredPayloadFromJsonLikeText(rawText) {
  const unwrapObject = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > MAX_JSON_UNWRAP_DEPTH) return null;

    const nestedFromAnswer = unwrap(obj.answer || obj.response || obj.text || obj.output || obj.content || '', depth + 1);
    if (nestedFromAnswer && nestedFromAnswer.answer) return nestedFromAnswer;

    const answer = normalizeMultilineText(obj.answer || obj.response || obj.text || obj.output || obj.content || '');
    const followups = (Array.isArray(obj.followups) ? obj.followups : [])
      .map((q) => normalizeText(q))
      .filter(Boolean)
      .slice(0, 4);
    const sources = normalizeSources(obj.sources || obj.quellen || obj.references || obj.citations || []);
    const confidence = clamp01(obj.confidence, null);
    const evidence_note = normalizeText(obj.evidence_note || obj.reasoning_note || '');

    if (!answer && !followups.length && !sources.length && !Number.isFinite(confidence) && !evidence_note) {
      return null;
    }

    return { answer, followups, sources, confidence, evidence_note };
  };

  const unwrap = (value, depth = 0) => {
    const text = normalizeMultilineText(value || '');
    if (!text || depth > MAX_JSON_UNWRAP_DEPTH) return null;
    const allowDeepScan = canDeepScanJsonLikeText(text);

    const direct = parseJsonSafe(text, null);
    if (typeof direct === 'string') {
      const nestedString = normalizeMultilineText(direct);
      if (allowDeepScan && nestedString && nestedString !== text) {
        const nestedParsed = unwrap(nestedString, depth + 1);
        if (nestedParsed) return nestedParsed;
      }
    }

    if (direct && typeof direct === 'object') {
      const parsedObject = unwrapObject(direct, depth + 1);
      if (parsedObject) return parsedObject;
    }

    const quotedMatch = text.match(/^[\s\r\n]*"([\s\S]*)"[\s\r\n]*$/);
    if (quotedMatch && quotedMatch[1]) {
      const decodedQuoted = decodeEscapedJsonString(quotedMatch[1]);
      if (allowDeepScan && decodedQuoted && decodedQuoted !== text) {
        const nestedQuoted = unwrap(decodedQuoted, depth + 1);
        if (nestedQuoted) return nestedQuoted;
      }
    }

    if (allowDeepScan) {
      const open = text.indexOf('{');
      const close = text.lastIndexOf('}');
      if (open >= 0 && close > open) {
        const inner = parseJsonSafe(text.slice(open, close + 1), null);
        if (inner && typeof inner === 'object') {
          const parsedInner = unwrapObject(inner, depth + 1);
          if (parsedInner) return parsedInner;
        }
      }
    }

    const truncatedAnswer = allowDeepScan ? extractTruncatedAnswerFragment(text) : '';
    if (truncatedAnswer) {
      return {
        answer: truncatedAnswer,
        followups: [],
        sources: [],
        confidence: null,
        evidence_note: ''
      };
    }

    return null;
  };

  return unwrap(rawText, 0);
}

function isLegacyDeepseekRuntimeFailure(rawResult, normalizedResult) {
  const runtimeError = Boolean(rawResult?.meta?.runtime_error || rawResult?.runtime_error);
  const rawDetail = normalizeText(rawResult?.meta?.runtime_detail || rawResult?.runtime_detail || '');
  const answerText = normalizeText(normalizedResult?.answer || rawResult?.answer || rawResult?.response || '');
  const low = `${answerText} ${rawDetail}`.toLowerCase();
  if (runtimeError) return true;
  return (
    low.includes('nicht vollstaendig konfiguriert') ||
    low.includes('api-key') ||
    low.includes('technisches verarbeitungsproblem') ||
    low.includes('verbindungsfehler')
  );
}

function normalizeModelPayload(rawText, cfg) {
  const fallbackFollowups = Array.isArray(cfg?.clarification_policy?.default_followups)
    ? cfg.clarification_policy.default_followups
        .map((q) => normalizeText(q))
        .filter(Boolean)
        .filter((q) => !/\bauf welches sgb|sgb-buch|i bis xii\b/i.test(q))
        .filter((q) => !/\bkurzschema|praxisfall|lernkarte|wie soll ich antworten\b/i.test(q))
        .slice(0, 3)
    : [];
  const structured = extractStructuredPayloadFromJsonLikeText(rawText);
  if (structured) {
    return {
      answer: structured.answer || 'Ich weiss es nicht sicher.',
      followups: structured.followups && structured.followups.length ? structured.followups : fallbackFollowups,
      sources: normalizeSources(structured.sources || []),
      confidence: structured.confidence,
      evidence_note: normalizeText(structured.evidence_note || '')
    };
  }
  const parsed = parseJsonSafe(rawText, null);
  if (!parsed || typeof parsed !== 'object') {
    const salvaged = extractAnswerFromJsonLikeText(rawText);
    return {
      answer: salvaged || normalizeMultilineText(rawText) || 'Ich weiss es nicht sicher.',
      followups: fallbackFollowups,
      sources: [],
      confidence: null,
      evidence_note: ''
    };
  }
  const followups = (Array.isArray(parsed.followups) ? parsed.followups : [])
    .map((q) => normalizeText(q))
    .filter(Boolean)
    .slice(0, 4);
  const nestedStructured = extractStructuredPayloadFromJsonLikeText(parsed.answer || parsed.response || parsed.text || parsed.output || '');
  const parsedAnswerRaw = parsed.answer || parsed.response || parsed.text || parsed.output || '';
  const parsedAnswerText = nestedStructured?.answer || extractAnswerFromJsonLikeText(parsedAnswerRaw) || normalizeMultilineText(parsedAnswerRaw) || 'Ich weiss es nicht sicher.';
  return {
    answer: parsedAnswerText,
    followups: (nestedStructured?.followups && nestedStructured.followups.length)
      ? nestedStructured.followups
      : (followups.length ? followups : fallbackFollowups),
    sources: (nestedStructured?.sources && nestedStructured.sources.length)
      ? normalizeSources(nestedStructured.sources)
      : normalizeSources(parsed.sources || parsed.quellen || parsed.references || []),
    confidence: nestedStructured?.confidence ?? clamp01(parsed.confidence, null),
    evidence_note: normalizeText(nestedStructured?.evidence_note || parsed.evidence_note || parsed.reasoning_note || '')
  };
}

function buildSozialrechtSystemPrompt(cfg, hasStorage) {
  const policy = cfg?.accuracy_policy || {};
  return [
    'Du bist LINDA im Fachmodus Sozialrecht fuer angehende Personalfachkaufleute (IHK).',
    'Arbeite strikt fachlich, nachvollziehbar, ohne Spekulation und mit klarer Struktur.',
    policy.high_accuracy_required ? 'Hohe Genauigkeit ist Pflicht.' : '',
    policy.prefer_clarification_over_guessing ? 'Wenn Informationen fehlen oder unklar sind: erst Rueckfrage, keine Vermutung.' : '',
    policy.strict_unknown_on_missing_basis ? 'Wenn keine belastbare Grundlage vorhanden ist: sage klar "Ich weiss es nicht sicher".' : '',
    policy.require_legal_basis_references ? 'Nenne, wenn moeglich, SGB-Buch und Rechtsbezug als Quelle.' : '',
    hasStorage ? 'Wenn Storage-Treffer vorhanden sind, priorisiere diese Evidenz.' : '',
    'Das Feld "answer" muss als gut lesbares Markdown mit dieser Struktur kommen (wenn fachlich passend):',
    '### Kurzantwort',
    '### Rechtsgrundlage (SGB)',
    '### Pruefschema',
    '### Praxisbeispiel',
    '### Stolperfallen fuer die IHK-Pruefung',
    'Nutze im Pruefschema eine nummerierte Liste mit 3 bis 6 Schritten.',
    'Zitiere konkrete Fundstellen nur, wenn sie belastbar sind.',
    'Antworte direkt als gut lesbares Markdown.',
    'Gib keine JSON-Huelle, keine Code-Fences und keine technischen Metadaten aus.'
  ].filter(Boolean).join('\n');
}

function buildSozialrechtJudgmentSystemPrompt(cfg, hasStorage) {
  const policy = cfg?.accuracy_policy || {};
  return [
    'Du bist LINDA im Fachmodus Sozialrecht fuer angehende Personalfachkaufleute (IHK).',
    'Spezialmodus Rechtsprechung: antworte kurz, praezise und tokensparend.',
    'Antwortlaenge strikt kurz halten (maximal ca. 220 Woerter).',
    'Wenn Urteil/Beschluss oder Aktenzeichen unklar sind: frage knapp nach oder sage "Ich weiss es nicht sicher".',
    policy.require_legal_basis_references ? 'Nenne nur belastbare Gerichts- und Normbezuge.' : '',
    hasStorage ? 'Priorisiere Treffer aus dem Storage und nutze sie als Evidenz.' : '',
    'Antwortstruktur (kompakt):',
    '### Kernaussage',
    '### Relevantes Urteil / Stand',
    '### Bedeutung fuer den Personalfall',
    '### Pruefungshinweis',
    'Antworte direkt als gut lesbares Markdown.',
    'Gib keine JSON-Huelle, keine Code-Fences und keine technischen Metadaten aus.'
  ].filter(Boolean).join('\n');
}

function buildSozialrechtOverviewSystemPrompt(cfg, hasStorage) {
  const policy = cfg?.accuracy_policy || {};
  return [
    'Du bist LINDA im Fachmodus Sozialrecht fuer angehende Personalfachkaufleute (IHK).',
    'Modus: Ueberblick. Antworte kurz, klar und brauchbar fuer die erste Einordnung.',
    'Nutze vorhandene Quellen oberflaechlich und praxistauglich, aber bleibe ehrlich bei Unsicherheiten.',
    policy.require_legal_basis_references ? 'Nenne, wenn moeglich, den Rechtsbezug oder die relevante Norm.' : '',
    hasStorage ? 'Suche in vorhandenen Quellen mit Prioritaet auf direkt zitierbaren Stellen.' : '',
    'Antwortlaenge kurz halten. Erst eine knappe Einordnung, dann optional 2 bis 4 kurze Punkte.',
    'Wenn Kontext fehlt, stelle nur eine kurze Rueckfrage statt lange zu spekulieren.',
    'Das Feld "answer" muss als gut lesbares Markdown kommen, idealerweise mit:',
    '### Kurzantwort',
    '### Wichtige Einordnung',
    '### Quellenhinweis',
    '### Naechste sinnvolle Frage',
    'Antworte direkt als gut lesbares Markdown.',
    'Gib keine JSON-Huelle, keine Code-Fences und keine technischen Metadaten aus.'
  ].filter(Boolean).join('\n');
}

function toOpenAIMessages(systemPrompt, history, question) {
  const out = [{ role: 'system', content: systemPrompt }];
  sanitizeHistory(history).forEach((msg) => out.push(msg));
  out.push({ role: 'user', content: normalizeText(question) });
  return out;
}

async function callOpenAIChatCompletions({ apiKey, model, messages, temperature, maxOutputTokens }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxOutputTokens,
      response_format: { type: 'json_object' }
    })
  });
  const raw = await res.text();
  if (!res.ok) {
    const parsed = parseJsonSafe(raw, {});
    const detail = normalizeText(parsed?.error?.message || parsed?.error || raw);
    throw new Error(`OpenAI chat/completions Fehler (${res.status}): ${detail || 'unbekannt'}`);
  }
  const data = parseJsonSafe(raw, {});
  const content = data?.choices?.[0]?.message?.content;
  return normalizeMultilineText(content || '');
}

function extractResponsesText(parsed) {
  if (typeof parsed?.output_text === 'string' && parsed.output_text.trim()) return parsed.output_text.trim();
  const output = Array.isArray(parsed?.output) ? parsed.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text.trim();
      if (part?.text && typeof part.text?.value === 'string' && part.text.value.trim()) return part.text.value.trim();
    }
  }
  return '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractResponseAnnotationEntries(part) {
  return [
    ...asArray(part?.annotations),
    ...asArray(part?.citations),
    ...asArray(part?.references),
    ...asArray(part?.sources),
    ...asArray(part?.text?.annotations),
    ...asArray(part?.text?.citations),
    ...asArray(part?.text?.references),
    ...asArray(part?.text?.sources)
  ];
}

function normalizeResponseAnnotationSource(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const file = entry.file && typeof entry.file === 'object' ? entry.file : {};
  const fileCitation = entry.file_citation && typeof entry.file_citation === 'object' ? entry.file_citation : {};
  const fileId = normalizeText(entry.file_id || file.id || fileCitation.file_id || '');
  const title = normalizeText(
    entry.title ||
    entry.filename ||
    file.filename ||
    fileCitation.filename ||
    entry.label ||
    entry.document ||
    (fileId ? `Datei ${fileId}` : '')
  );
  const url = normalizeText(entry.url || entry.link || file.url || '');
  const excerpt = normalizeText(
    entry.excerpt ||
    entry.quote ||
    entry.snippet ||
    entry.chunk ||
    entry.text ||
    fileCitation.quote ||
    fileCitation.text ||
    ''
  );
  const section = normalizeText(
    entry.section ||
    entry.heading ||
    fileCitation.section ||
    entry.locator ||
    entry.type ||
    ''
  );
  const page = normalizeText(
    entry.page ||
    entry.pageNumber ||
    entry.page_number ||
    fileCitation.page ||
    fileCitation.page_number ||
    ''
  );
  const note = normalizeText(
    entry.note ||
    entry.reason ||
    entry.description ||
    (entry.type ? `Quelle (${String(entry.type)})` : 'Quelle aus Vector Store')
  );
  const confidence = clamp01(entry.confidence, null);
  if (!title && !url && !excerpt && !fileId) return null;
  return {
    title: title || (fileId ? `Datei ${fileId}` : 'Storage-Quelle'),
    url,
    excerpt,
    section,
    page,
    note,
    confidence
  };
}

function extractResponsesSources(parsed) {
  const found = [];
  const output = asArray(parsed?.output);
  for (const item of output) {
    const content = asArray(item?.content);
    for (const part of content) {
      const entries = extractResponseAnnotationEntries(part);
      for (const entry of entries) {
        const src = normalizeResponseAnnotationSource(entry);
        if (src) found.push(src);
      }
    }
  }
  return normalizeSources(found);
}

function toResponsesInput(messages) {
  return (Array.isArray(messages) ? messages : []).map((msg) => {
    const roleRaw = String(msg?.role || '').toLowerCase();
    const text = normalizeText(msg?.content || '');
    if (roleRaw === 'assistant') {
      return {
        role: 'user',
        content: [{ type: 'input_text', text: `Bisherige Antwort von LINDA zur Einordnung:\n${text}` }]
      };
    }
    return {
      role: roleRaw === 'system' ? 'system' : 'user',
      content: [{ type: 'input_text', text }]
    };
  }).filter((item) => String(item?.content?.[0]?.text || '').trim());
}

async function callOpenAIResponsesTextOnly({ apiKey, model, messages, temperature, maxOutputTokens }) {
  const body = {
    model,
    input: toResponsesInput(messages),
    temperature,
    max_output_tokens: maxOutputTokens
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    const parsed = parseJsonSafe(raw, {});
    const detail = normalizeText(parsed?.error?.message || parsed?.error || raw);
    throw new Error(`OpenAI responses Fehler (${res.status}): ${detail || 'unbekannt'}`);
  }
  const parsed = parseJsonSafe(raw, {});
  return {
    text: extractResponsesText(parsed),
    sources: extractResponsesSources(parsed)
  };
}

async function callOpenAIResponsesWithStorage({ apiKey, model, messages, temperature, maxOutputTokens, vectorStoreId }) {
  const body = {
    model,
    input: toResponsesInput(messages),
    temperature,
    max_output_tokens: maxOutputTokens,
    tools: [{ type: 'file_search', vector_store_ids: [vectorStoreId] }]
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    const parsed = parseJsonSafe(raw, {});
    const detail = normalizeText(parsed?.error?.message || parsed?.error || raw);
    throw new Error(`OpenAI responses Fehler (${res.status}): ${detail || 'unbekannt'}`);
  }
  const parsed = parseJsonSafe(raw, {});
  return {
    text: extractResponsesText(parsed),
    sources: extractResponsesSources(parsed)
  };
}

async function callDeepseekReasoner({ apiKey, messages, maxOutputTokens, timeoutMs = 12000 }) {
  const deepseekMaxTokens = Math.max(256, Math.min(4000, Number(maxOutputTokens) || 1200));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Deepseek timeout')), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        messages,
        temperature: 1.0,
        max_tokens: deepseekMaxTokens,
        response_format: { type: 'json_object' }
      })
    });
    const raw = await res.text();
    if (!res.ok) {
      const parsed = parseJsonSafe(raw, {});
      const detail = normalizeText(parsed?.error?.message || parsed?.error || raw);
      throw new Error(`Deepseek Fehler (${res.status}): ${detail || 'unbekannt'}`);
    }
    const parsed = parseJsonSafe(raw, {});
    const content = normalizeMultilineText(parsed?.choices?.[0]?.message?.content || '');
    if (!content) throw new Error('Deepseek lieferte keinen Inhalt.');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function callLegacyDeepseek(payload, req) {
  const legacyOrigin = resolveLegacyOriginForRequest(req);
  const upstream = new URL('/api/linda3?action=deepseek', legacyOrigin);
  const body = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    fachmodus: 'SOZIALRECHT',
    schnellmodus: true,
    routing: {
      ...((payload && payload.routing && typeof payload.routing === 'object') ? payload.routing : {}),
      preferred_model: 'deepseek'
    }
  };
  const res = await fetch(upstream.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) {
    const parsed = parseJsonSafe(raw, {});
    const detail = normalizeText(parsed?.error || parsed?.message || raw);
    throw new Error(`Legacy Deepseek Fehler (${res.status}): ${detail || 'unbekannt'}`);
  }
  const parsed = parseJsonSafe(raw, null);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Legacy Deepseek lieferte kein gueltiges JSON.');
  }
  return parsed;
}

async function proxyToLegacy(req, res) {
  const reqUrl = new URL(req.url || '/api/linda3', 'http://localhost');
  const legacyOrigin = resolveLegacyOriginForRequest(req);
  const upstream = new URL('/api/linda3', legacyOrigin);
  reqUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  const headers = {};
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const method = String(req.method || 'GET').toUpperCase();
  const rawBody = readRequestBodyRaw(req);
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && rawBody) init.body = rawBody;

  const upstreamRes = await fetch(upstream.toString(), init);
  const text = await upstreamRes.text();
  res.status(upstreamRes.status);
  res.setHeader('content-type', upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8');
  res.send(text);
}

async function handleHealth(req, res) {
  const cfg = loadSozialrechtConfig();
  const storageEnvKey = String(cfg?.storage?.vector_store_env_key || 'OPENAI_VECTOR_STORE_ID_SOZIALRECHT');
  const sozialrechtApi = resolveSozialrechtApiKey();
  const sozialrechtSchnell = resolveSozialrechtSchnellKey();
  const routing = cfg?.routing || {};
  const checks = {
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    Sozialrecht2026: Boolean(process.env.Sozialrecht2026 || process.env.SOZIALRECHT2026),
    SozialrechtSchnell: Boolean(sozialrechtSchnell),
    SOZIALRECHT_API_KEY_EFFECTIVE: Boolean(sozialrechtApi.key),
    [storageEnvKey]: Boolean(process.env[storageEnvKey]),
    LEGACY_API_ORIGIN: Boolean(parseOriginSafe(LEGACY_ORIGIN, ''))
  };
  res.status(200).json({
    ok: Boolean(checks.SOZIALRECHT_API_KEY_EFFECTIVE && checks.LEGACY_API_ORIGIN),
    checks,
    sozialrecht_api_key_source: sozialrechtApi.source || '',
    storage_env_key: storageEnvKey,
    storage_env_value: normalizeText(process.env[storageEnvKey] || ''),
    storage_configured: Boolean(checks[storageEnvKey]),
    baseUrl: '/api/linda3',
    ts: new Date().toISOString(),
    mode: 'sozialrecht-targeted-openai',
    legacy_origin_effective: resolveLegacyOriginForRequest(req),
    routing: {
      default_model: String(routing.default_model || DEFAULT_SOCIALRECHT_CONFIG.routing.default_model),
      fast_model: String(routing.fast_model || DEFAULT_SOCIALRECHT_CONFIG.routing.fast_model),
      overview_model: String(routing.overview_model || DEFAULT_SOCIALRECHT_CONFIG.routing.overview_model),
      judgment_model: String(routing.judgment_model || DEFAULT_SOCIALRECHT_CONFIG.routing.judgment_model),
      overview_max_output_tokens: Number.isFinite(Number(routing.overview_max_output_tokens))
        ? Number(routing.overview_max_output_tokens)
        : DEFAULT_SOCIALRECHT_CONFIG.routing.overview_max_output_tokens,
      judgment_max_output_tokens: Number.isFinite(Number(routing.judgment_max_output_tokens))
        ? Number(routing.judgment_max_output_tokens)
        : DEFAULT_SOCIALRECHT_CONFIG.routing.judgment_max_output_tokens,
      max_output_tokens: Number.isFinite(Number(routing.max_output_tokens))
        ? Number(routing.max_output_tokens)
        : DEFAULT_SOCIALRECHT_CONFIG.routing.max_output_tokens
    },
    details: {
      env: {
        OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
        Sozialrecht2026: Boolean(process.env.Sozialrecht2026 || process.env.SOZIALRECHT2026),
        SozialrechtSchnell: Boolean(sozialrechtSchnell),
        OPENAI_VECTOR_STORE_ID_SOZIALRECHT: Boolean(process.env.OPENAI_VECTOR_STORE_ID_SOZIALRECHT),
        LINDA3_LEGACY_API_ORIGIN: Boolean(process.env.LINDA3_LEGACY_API_ORIGIN)
      },
      model_rules: 'Schnellmodus=DeepSeek-only ohne OpenAI-Fallback; Überblickmodus=gpt-4.1 mit oberflächlicher Quellensuche; Quellenmodus=gpt-5.1 mit strikter Evidenzprüfung; Urteilsmodus=kompakt mit GPT-5.1.'
    }
  });
}

async function handleSozialrechtChat(req, res, action) {
  const payload = readRequestBodyObject(req);
  const cfg = loadSozialrechtConfig();
  const question = normalizeText(payload.question || payload.prompt || payload.input || payload.text || '');
  if (!question) {
    res.status(400).json({ error: 'question ist erforderlich' });
    return;
  }

  const history = sanitizeHistory(payload.history || []);
  const forceFast = action === 'deepseek';
  const requestedResponseMode = String(payload?.routing?.response_mode || '').toLowerCase();
  const expertRequested = requestedResponseMode === 'expert';
  const overviewRequested = requestedResponseMode === 'overview';
  const preferredModel = String(payload?.routing?.preferred_model || '').toLowerCase();
  const groundedModeActive = payload?.guardrails?.grounded_mode !== false;
  const fastRequested = forceFast || Boolean(payload.schnellmodus) || preferredModel === 'deepseek';
  const judgmentMode = isJudgmentQuestion(question);
  const fastMode = fastRequested && !judgmentMode;
  const deepseekMode = fastMode;
  const defaultModel = String(cfg?.routing?.default_model || DEFAULT_SOCIALRECHT_CONFIG.routing.default_model);
  const fastModel = String(cfg?.routing?.fast_model || DEFAULT_SOCIALRECHT_CONFIG.routing.fast_model);
  const overviewModel = String(cfg?.routing?.overview_model || DEFAULT_SOCIALRECHT_CONFIG.routing.overview_model);
  const judgmentModel = String(cfg?.routing?.judgment_model || DEFAULT_SOCIALRECHT_CONFIG.routing.judgment_model || defaultModel);
  const overviewMode = !judgmentMode && !deepseekMode && (overviewRequested || preferredModel === overviewModel.toLowerCase());
  const model = judgmentMode
    ? judgmentModel
    : (deepseekMode ? fastModel : (overviewMode ? overviewModel : defaultModel));

  const sozialrechtApi = resolveSozialrechtApiKey();
  const socialKey = sozialrechtApi.key;
  if (!socialKey) {
    const fallbackFollowups = buildClarificationFollowups(
      buildSozialrechtSignalProfile(question, history, cfg),
      cfg
    );
    res.status(200).json({
      answer:
        'Ich weiss es nicht sicher. Die Sozialrecht-API ist noch nicht vollstaendig konfiguriert, ' +
        'deshalb antworte ich vorsichtshalber nicht spekulativ.',
      followups: fallbackFollowups,
      sources: [],
      confidence: 0.05,
      evidence_note: 'Technischer Hinweis: API-Key fuer Sozialrecht fehlt.',
      meta: {
        domain: 'SOZIALRECHT',
        runtime_error: true,
        runtime_detail: 'Sozialrecht API-Key fehlt. Bitte Vercel-Variable "Sozialrecht2026" (oder SOZIALRECHT2026) setzen; alternativ wird OPENAI_API_KEY verwendet.'
      }
    });
    return;
  }

  const clarificationDecision = shouldClarifyQuestion(question, history, cfg);
  if (clarificationDecision.shouldClarify) {
    res.status(200).json(buildClarificationPayload(cfg, clarificationDecision, question));
    return;
  }

  let legacyDeepseekError = '';
  if (deepseekMode) {
    try {
      const schnellKey = resolveSozialrechtSchnellKey();
      if (!schnellKey) throw new Error('SozialrechtSchnell fehlt.');

      const deepseekMaxOutputTokens = expertRequested ? 2400 : 1600;
      const systemPrompt = buildSozialrechtSystemPrompt(cfg, false);
      const messages = toOpenAIMessages(systemPrompt, history, question);
      const deepseekRaw = await callDeepseekReasoner({
        apiKey: schnellKey,
        messages,
        maxOutputTokens: deepseekMaxOutputTokens,
        timeoutMs: expertRequested ? 18000 : 12000
      });
      const normalizedDeepseek = normalizeModelPayload(deepseekRaw, cfg);
      const deepseekSources = normalizeSources(normalizedDeepseek.sources || []);
      const evidenceParts = [];
      if (normalizedDeepseek.evidence_note) evidenceParts.push(normalizedDeepseek.evidence_note);
      evidenceParts.push('Deepseek-Schnellrouting ueber Variable SozialrechtSchnell aktiv.');
      evidenceParts.push(buildAiReviewDisclaimer({ fastMode: true }));
      if (!deepseekSources.length) evidenceParts.push('Im Schnellmodus koennen Quellen begrenzt sein.');

      const finalDeepseekAnswer = `${normalizedDeepseek.answer}\n\n> ${buildAiReviewDisclaimer({ fastMode: true })}`;

      res.status(200).json({
        answer: finalDeepseekAnswer,
        followups: normalizedDeepseek.followups,
        sources: deepseekSources,
        confidence: normalizedDeepseek.confidence,
        evidence_note: evidenceParts.join(' ').trim(),
        meta: {
          domain: 'SOZIALRECHT',
          api_key_source: sozialrechtApi.source || '',
          model: 'deepseek-reasoner',
          response_mode: expertRequested ? 'expert' : (requestedResponseMode || 'schnell'),
          fast_mode: true,
          judgment_mode: false,
          deepseek_via_legacy: false,
          deepseek_legacy_error: '',
          deepseek_direct: true,
          storage_used: false,
          storage_fallback: false,
          storage_error: ''
        }
      });
      return;
    } catch (deepseekErr) {
      legacyDeepseekError = normalizeText(deepseekErr?.message || 'unbekannt');
      const fallback = buildSozialrechtTechnicalFallback({
        cfg,
        question,
        detail: `Deepseek-Schnellrouting fehlgeschlagen: ${legacyDeepseekError}`,
        answerText: `Hinweis: Antwort im Schnellmodus angefragt, DeepSeek konnte die Antwort nicht rechtzeitig liefern. ${buildAiReviewDisclaimer({ fastMode: true })}`,
        storageUsed: false,
        storageFallback: false,
        apiKeySource: sozialrechtApi.source || ''
      });
      fallback.meta = {
        ...(fallback.meta || {}),
        deepseek_mode: true,
        fast_mode: true,
        response_mode: expertRequested ? 'expert' : (requestedResponseMode || 'schnell'),
        deepseek_legacy_error: legacyDeepseekError
      };
      res.status(200).json(fallback);
      return;
    }
  }

  const storageEnvKey = String(cfg?.storage?.vector_store_env_key || 'OPENAI_VECTOR_STORE_ID_SOZIALRECHT');
  const vectorStoreId = normalizeText(process.env[storageEnvKey] || '');
  const useStorage = Boolean(vectorStoreId && cfg?.storage?.enabled_when_env_present !== false && (!deepseekMode || judgmentMode));
  const temperature = Number.isFinite(Number(cfg?.routing?.temperature))
    ? Number(cfg.routing.temperature)
    : DEFAULT_SOCIALRECHT_CONFIG.routing.temperature;
  const defaultMaxOutputTokens = Number.isFinite(Number(cfg?.routing?.max_output_tokens))
    ? Number(cfg.routing.max_output_tokens)
    : DEFAULT_SOCIALRECHT_CONFIG.routing.max_output_tokens;
  const overviewMaxOutputTokens = Number.isFinite(Number(cfg?.routing?.overview_max_output_tokens))
    ? Number(cfg.routing.overview_max_output_tokens)
    : Number(DEFAULT_SOCIALRECHT_CONFIG.routing.overview_max_output_tokens || 900);
  const judgmentMaxOutputTokens = Number.isFinite(Number(cfg?.routing?.judgment_max_output_tokens))
    ? Number(cfg.routing.judgment_max_output_tokens)
    : Number(DEFAULT_SOCIALRECHT_CONFIG.routing.judgment_max_output_tokens || 520);
  const maxOutputTokens = judgmentMode
    ? Math.max(260, Math.min(900, judgmentMaxOutputTokens))
    : (overviewMode
        ? Math.max(320, Math.min(1200, overviewMaxOutputTokens))
        : (deepseekMode && expertRequested ? 12000 : defaultMaxOutputTokens));

  const systemPrompt = judgmentMode
    ? buildSozialrechtJudgmentSystemPrompt(cfg, useStorage)
    : (overviewMode
        ? buildSozialrechtOverviewSystemPrompt(cfg, useStorage)
        : buildSozialrechtSystemPrompt(cfg, useStorage));
  const messages = toOpenAIMessages(systemPrompt, history, question);

  let activeModel = model;
  let modelRaw = '';
  let storageSources = [];
  let storageUsed = false;
  let storageFallback = false;
  let storageError = '';

  try {
    if (useStorage) {
      try {
        const storageResult = await callOpenAIResponsesWithStorage({
          apiKey: socialKey,
          model: activeModel,
          messages,
          temperature,
          maxOutputTokens,
          vectorStoreId
        });
        modelRaw = storageResult.text;
        storageSources = storageResult.sources;
        storageUsed = true;
      } catch (storageErr) {
        const firstErr = normalizeText(storageErr?.message || 'unbekannt');
        storageError = firstErr;

        if ((deepseekMode || judgmentMode) && defaultModel && defaultModel !== activeModel) {
          try {
            activeModel = defaultModel;
            const retryResult = await callOpenAIResponsesWithStorage({
              apiKey: socialKey,
              model: activeModel,
              messages,
              temperature,
              maxOutputTokens,
              vectorStoreId
            });
            modelRaw = retryResult.text;
            storageSources = retryResult.sources;
            storageUsed = true;
          } catch (retryErr) {
            const retryDetail = normalizeText(retryErr?.message || 'unbekannt');
            storageError = [firstErr, `Retry mit ${defaultModel} fehlgeschlagen: ${retryDetail}`]
              .filter(Boolean)
              .join(' | ');
          }
        }

        if (!storageUsed) {
          storageFallback = true;
          const fallbackResult = await callOpenAIResponsesTextOnly({
            apiKey: socialKey,
            model: activeModel,
            messages,
            temperature,
            maxOutputTokens
          });
          modelRaw = fallbackResult.text;
          storageSources = fallbackResult.sources;
        }
      }
    } else {
      const directResult = await callOpenAIResponsesTextOnly({
        apiKey: socialKey,
        model: activeModel,
        messages,
        temperature,
        maxOutputTokens
      });
      modelRaw = directResult.text;
      storageSources = directResult.sources;
    }

    const normalized = normalizeModelPayload(modelRaw, cfg);
    const mergedSources = normalizeSources([...(normalized.sources || []), ...storageSources]);
    const finalSources = normalizeSources(mergedSources);
    const simpleOverviewFallback = !deepseekMode && !judgmentMode && finalSources.length === 0
      ? buildSimpleSgbOverviewFallback(question)
      : null;
    const standardTopicFallback = !deepseekMode && !judgmentMode && finalSources.length === 0
      ? buildStandardSocialrechtTopicFallback(question)
      : null;
    const strictUnknown = Boolean(cfg?.accuracy_policy?.strict_unknown_on_missing_basis);
    const strictUnknownClient = payload?.guardrails?.strict_unknown !== false;
    const enforceStrictUnknown = strictUnknown && strictUnknownClient && groundedModeActive && !deepseekMode;
    const effectiveConfidence = standardTopicFallback?.confidence ?? simpleOverviewFallback?.confidence ?? normalized.confidence;
    const hasConfidenceValue =
      effectiveConfidence !== null &&
      effectiveConfidence !== undefined &&
      String(effectiveConfidence).trim() !== '';
    const confidenceValue = hasConfidenceValue ? Number(effectiveConfidence) : null;
    const lowConfidence = Number.isFinite(confidenceValue) ? confidenceValue < 0.34 : false;
    const clarificationStyle = isClarificationStyleAnswer(normalized.answer);
    const resolvedAnswerBase = standardTopicFallback?.answer || simpleOverviewFallback?.answer || normalized.answer;
    const resolvedAnswer =
      !standardTopicFallback && !simpleOverviewFallback && enforceStrictUnknown && finalSources.length === 0 && lowConfidence && clarificationStyle
        ? 'Ich weiss es nicht sicher. Ohne belastbare Quelle antworte ich im Fachmodus Sozialrecht bewusst nicht spekulativ. Bitte frage enger oder nenne das konkrete Leistungsthema.'
        : resolvedAnswerBase;
    const gpt5FooterActive = judgmentMode && /gpt-5/i.test(String(activeModel || ''));
    const finalAnswer = gpt5FooterActive
      ? `${resolvedAnswer}\n\n> Diese Antwort wurde mit GPT5 erstellt.`
      : resolvedAnswer;
    const finalAnswerWithDisclaimer = `${finalAnswer}\n\n> ${buildAiReviewDisclaimer({ fastMode: fastMode || deepseekMode })}`;
    const evidenceNotes = [];
    if (normalized.evidence_note) evidenceNotes.push(normalized.evidence_note);
    if (standardTopicFallback?.evidence_note) evidenceNotes.push(standardTopicFallback.evidence_note);
    if (simpleOverviewFallback?.evidence_note) evidenceNotes.push(simpleOverviewFallback.evidence_note);
    evidenceNotes.push(buildAiReviewDisclaimer({ fastMode: fastMode || deepseekMode }));
    if (storageUsed && finalSources.length) {
      evidenceNotes.push('Vector-Store-Treffer wurden als Quellen-Chunks eingebunden.');
    } else if (storageUsed && !finalSources.length) {
      evidenceNotes.push('Vector Store war aktiv, aber es wurden keine zitierbaren Quellen-Chunks erkannt.');
    }
    if (!finalSources.length && !lowConfidence) {
      evidenceNotes.push('Hinweis: Antwort ohne extrahierte Quellen-Chunks, bitte fachlich gegenpruefen.');
    }
    if (storageFallback) {
      evidenceNotes.push('Storage-Abfrage war nicht stabil; Antwort wurde ersatzweise ohne Storage erstellt.');
    }
    if (legacyDeepseekError) {
      evidenceNotes.push(`Deepseek-Fallback-Hinweis: ${legacyDeepseekError}`);
    }
    if (overviewMode) {
      evidenceNotes.push('Ueberblickmodus aktiv: gpt-4.1 fuehrt eine oberflaechlichere Quellensuche durch.');
    }
    if (judgmentMode) {
      evidenceNotes.push('Urteilsmodus aktiv: Antwort wurde mit kompakter, tokensparender Rechtsprechungslogik erstellt.');
    }

    res.status(200).json({
      answer: finalAnswerWithDisclaimer,
      followups: standardTopicFallback?.followups || simpleOverviewFallback?.followups || normalized.followups,
      sources: finalSources,
      confidence: effectiveConfidence,
      evidence_note: evidenceNotes.join(' ').trim(),
      meta: {
        domain: 'SOZIALRECHT',
        api_key_source: sozialrechtApi.source || '',
        model: activeModel,
        response_mode: expertRequested ? 'expert' : (overviewMode ? 'overview' : (requestedResponseMode || (deepseekMode ? 'schnell' : 'genau'))),
        fast_mode: fastMode,
        deepseek_mode: deepseekMode,
        overview_mode: overviewMode,
        judgment_mode: judgmentMode,
        gpt5_footer: gpt5FooterActive,
        deepseek_via_legacy: false,
        deepseek_legacy_error: legacyDeepseekError,
        storage_used: storageUsed,
        storage_fallback: storageFallback,
        storage_error: storageFallback ? storageError : '',
        canonical_sgb_overview: Boolean(simpleOverviewFallback?.meta?.canonical_sgb_overview),
        sgb_book: simpleOverviewFallback?.meta?.sgb_book || '',
        canonical_topic: standardTopicFallback?.meta?.canonical_topic || ''
      }
    });
  } catch (err) {
    const detail = normalizeText(err?.message || 'unbekannt');
    const salvaged = modelRaw ? normalizeModelPayload(modelRaw, cfg) : null;
    const fallback = buildSozialrechtTechnicalFallback({
      cfg,
      question,
      detail,
      answerText: salvaged?.answer || '',
      sources: [
        ...(Array.isArray(salvaged?.sources) ? salvaged.sources : []),
        ...storageSources
      ],
      storageUsed,
      storageFallback,
      storageError,
      apiKeySource: sozialrechtApi.source || ''
    });
    res.status(200).json(fallback);
  }
}

module.exports = async (req, res) => {
  const action = getAction(req);
  try {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (action === 'health') {
      await handleHealth(req, res);
      return;
    }

    const payload = readRequestBodyObject(req);
    const domain = String(payload?.fachmodus || '').trim().toUpperCase();
    const sozialrecht = domain === 'SOZIALRECHT';

    if (sozialrecht && (action === 'bot' || action === 'deepseek')) {
      await handleSozialrechtChat(req, res, action);
      return;
    }

    await proxyToLegacy(req, res);
  } catch (err) {
    const detail = normalizeText(err?.message || 'unbekannt');
    const payload = readRequestBodyObject(req);
    const domain = String(payload?.fachmodus || '').trim().toUpperCase();
    if ((action === 'bot' || action === 'deepseek') && domain === 'SOZIALRECHT') {
      const fallback = buildSozialrechtTechnicalFallback({
        cfg: loadSozialrechtConfig(),
        question: normalizeText(payload.question || payload.prompt || payload.input || payload.text || ''),
        detail
      });
      res.status(200).json(fallback);
      return;
    }
    res.status(502).json({ error: `Legacy-Proxy Fehler: ${detail}` });
  }
};
