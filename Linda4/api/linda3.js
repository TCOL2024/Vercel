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
    fast_model: 'gpt-4.1-mini',
    judgment_model: 'gpt-5.1',
    judgment_max_output_tokens: 520,
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
  const normFallbackSources = sourceList.length ? [] : extractNormReferenceSources(normalizedAnswer || question || '');
  const finalSources = normalizeSources([...(sourceList || []), ...normFallbackSources]);
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
    evidenceBits.push('Fallback-Antwort ohne zitierbare Quellen-Chunks.');
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

function decodeEscapedJsonString(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function extractAnswerFromJsonLikeText(rawText) {
  const raw = normalizeMultilineText(rawText || '');
  if (!raw) return '';
  const direct = parseJsonSafe(raw, null);
  if (direct && typeof direct === 'object') {
    const text = normalizeMultilineText(direct.answer || direct.response || direct.text || '');
    if (text) return text;
  }

  const rx = /"answer"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:followups|sources|confidence|meta|evidence_note|reasoning_note)"/i;
  const m = raw.match(rx);
  if (m && m[1]) {
    const decoded = decodeEscapedJsonString(m[1]);
    if (decoded) return decoded;
  }

  const open = raw.indexOf('{');
  const close = raw.lastIndexOf('}');
  if (open >= 0 && close > open) {
    const inner = parseJsonSafe(raw.slice(open, close + 1), null);
    if (inner && typeof inner === 'object') {
      const text = normalizeMultilineText(inner.answer || inner.response || inner.text || '');
      if (text) return text;
    }
  }
  return '';
}

function extractNormReferenceSources(answerText) {
  const raw = normalizeMultilineText(answerText || '');
  if (!raw) return [];
  const lines = raw
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .slice(0, 80);
  const found = [];
  const seen = new Set();
  const re = /(§\s*\d+[a-z]?(?:\s*abs\.?\s*\d+)?(?:\s*s\.?\s*\d+)?(?:\s*nr\.?\s*\d+)?)\s*(efzg|aag|sgb\s*[ivx0-9]+|sgg|bgb)?/ig;

  for (const line of lines) {
    let match;
    while ((match = re.exec(line)) !== null) {
      const para = normalizeText(match[1] || '');
      const law = normalizeText((match[2] || '').toUpperCase());
      if (!para) continue;
      const title = law ? `${para} ${law}` : para;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        title: `Normbezug: ${title}`,
        url: '',
        excerpt: line,
        section: 'Rechtsgrundlage',
        page: '',
        note: 'Automatisch aus der Antwort extrahiert (kein direkter Dokument-Chunk).',
        confidence: 0.36
      });
      if (found.length >= 6) return found;
    }
  }
  return found;
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
  const parsedAnswerRaw = parsed.answer || parsed.response || parsed.text || parsed.output || '';
  const parsedAnswerText = extractAnswerFromJsonLikeText(parsedAnswerRaw) || normalizeMultilineText(parsedAnswerRaw) || 'Ich weiss es nicht sicher.';
  return {
    answer: parsedAnswerText,
    followups: followups.length ? followups : fallbackFollowups,
    sources: normalizeSources(parsed.sources || parsed.quellen || parsed.references || []),
    confidence: clamp01(parsed.confidence, null),
    evidence_note: normalizeText(parsed.evidence_note || parsed.reasoning_note || '')
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
    'Gib ausschliesslich JSON zurueck, exakt im Format:',
    '{"answer":"...","followups":["..."],"sources":[{"title":"...","excerpt":"...","section":"...","page":"","note":"","confidence":0.0}],"confidence":0.0,"evidence_note":"..."}'
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
    'Gib ausschliesslich JSON zurueck, exakt im Format:',
    '{"answer":"...","followups":["..."],"sources":[{"title":"...","excerpt":"...","section":"...","page":"","note":"","confidence":0.0}],"confidence":0.0,"evidence_note":"..."}'
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

async function callOpenAIResponsesWithStorage({ apiKey, model, messages, temperature, maxOutputTokens, vectorStoreId }) {
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: 'input_text', text: m.content }]
  }));
  const body = {
    model,
    input,
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

async function callDeepseekReasoner({ apiKey, messages, maxOutputTokens, timeoutMs = 22000 }) {
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
    storage_configured: Boolean(checks[storageEnvKey]),
    baseUrl: '/api/linda3',
    ts: new Date().toISOString(),
    mode: 'sozialrecht-targeted-openai',
    legacy_origin_effective: resolveLegacyOriginForRequest(req)
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
  const preferredModel = String(payload?.routing?.preferred_model || '').toLowerCase();
  const groundedModeActive = payload?.guardrails?.grounded_mode !== false;
  const fastRequested = forceFast || Boolean(payload.schnellmodus) || preferredModel === 'deepseek';
  const judgmentMode = isJudgmentQuestion(question);
  const fastMode = fastRequested && !judgmentMode;
  const deepseekMode = fastMode && !groundedModeActive;
  const defaultModel = String(cfg?.routing?.default_model || DEFAULT_SOCIALRECHT_CONFIG.routing.default_model);
  const fastModel = String(cfg?.routing?.fast_model || DEFAULT_SOCIALRECHT_CONFIG.routing.fast_model);
  const judgmentModel = String(cfg?.routing?.judgment_model || DEFAULT_SOCIALRECHT_CONFIG.routing.judgment_model || defaultModel);
  const model = judgmentMode
    ? judgmentModel
    : (deepseekMode ? fastModel : defaultModel);

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
        timeoutMs: expertRequested ? 36000 : 22000
      });
      const normalizedDeepseek = normalizeModelPayload(deepseekRaw, cfg);
      const deepseekSources = normalizeSources(normalizedDeepseek.sources || []);
      const evidenceParts = [];
      if (normalizedDeepseek.evidence_note) evidenceParts.push(normalizedDeepseek.evidence_note);
      evidenceParts.push('Deepseek-Schnellrouting ueber Variable SozialrechtSchnell aktiv.');
      if (!deepseekSources.length) evidenceParts.push('Im Schnellmodus koennen Quellen begrenzt sein.');

      res.status(200).json({
        answer: normalizedDeepseek.answer,
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
  const judgmentMaxOutputTokens = Number.isFinite(Number(cfg?.routing?.judgment_max_output_tokens))
    ? Number(cfg.routing.judgment_max_output_tokens)
    : Number(DEFAULT_SOCIALRECHT_CONFIG.routing.judgment_max_output_tokens || 520);
  const maxOutputTokens = judgmentMode
    ? Math.max(260, Math.min(900, judgmentMaxOutputTokens))
    : (deepseekMode && expertRequested ? 12000 : defaultMaxOutputTokens);

  const systemPrompt = judgmentMode
    ? buildSozialrechtJudgmentSystemPrompt(cfg, useStorage)
    : buildSozialrechtSystemPrompt(cfg, useStorage);
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
          modelRaw = await callOpenAIChatCompletions({
            apiKey: socialKey,
            model: activeModel,
            messages,
            temperature,
            maxOutputTokens
          });
        }
      }
    } else {
      modelRaw = await callOpenAIChatCompletions({
        apiKey: socialKey,
        model: activeModel,
        messages,
        temperature,
        maxOutputTokens
      });
    }

    const normalized = normalizeModelPayload(modelRaw, cfg);
    const mergedSources = normalizeSources([...(normalized.sources || []), ...storageSources]);
    const normFallbackSources = mergedSources.length ? [] : extractNormReferenceSources(normalized.answer || '');
    const finalSources = normalizeSources([...(mergedSources || []), ...normFallbackSources]);
    const strictUnknown = Boolean(cfg?.accuracy_policy?.strict_unknown_on_missing_basis);
    const strictUnknownClient = payload?.guardrails?.strict_unknown !== false;
    const enforceStrictUnknown = strictUnknown && strictUnknownClient && groundedModeActive && !deepseekMode;
    const confidenceValue = Number(normalized.confidence);
    const lowConfidence = Number.isFinite(confidenceValue) ? confidenceValue < 0.34 : false;
    const resolvedAnswer =
      enforceStrictUnknown && finalSources.length === 0 && lowConfidence
        ? 'Ich weiss es nicht sicher. Ohne belastbare Quelle antworte ich im Fachmodus Sozialrecht bewusst nicht spekulativ. Bitte frage enger oder nenne das konkrete Leistungsthema.'
        : normalized.answer;
    const gpt5FooterActive = judgmentMode && /gpt-5/i.test(String(activeModel || ''));
    const finalAnswer = gpt5FooterActive
      ? `${resolvedAnswer}\n\n> Diese Antwort wurde mit GPT5 erstellt.`
      : resolvedAnswer;
    const evidenceNotes = [];
    if (normalized.evidence_note) evidenceNotes.push(normalized.evidence_note);
    if (storageUsed && finalSources.length) {
      evidenceNotes.push('Vector-Store-Treffer wurden als Quellen-Chunks eingebunden.');
    } else if (storageUsed && !finalSources.length) {
      evidenceNotes.push('Vector Store war aktiv, aber es wurden keine zitierbaren Quellen-Chunks erkannt.');
    }
    if (normFallbackSources.length) {
      evidenceNotes.push('Normbezüge wurden als Quellen-Fallback aus der Antwort extrahiert.');
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
    if (judgmentMode) {
      evidenceNotes.push('Urteilsmodus aktiv: Antwort wurde mit kompakter, tokensparender Rechtsprechungslogik erstellt.');
    }

    res.status(200).json({
      answer: finalAnswer,
      followups: normalized.followups,
      sources: finalSources,
      confidence: normalized.confidence,
      evidence_note: evidenceNotes.join(' ').trim(),
      meta: {
        domain: 'SOZIALRECHT',
        api_key_source: sozialrechtApi.source || '',
        model: activeModel,
        response_mode: expertRequested ? 'expert' : (requestedResponseMode || (deepseekMode ? 'schnell' : 'genau')),
        fast_mode: fastMode,
        deepseek_mode: deepseekMode,
        judgment_mode: judgmentMode,
        gpt5_footer: gpt5FooterActive,
        deepseek_via_legacy: false,
        deepseek_legacy_error: legacyDeepseekError,
        storage_used: storageUsed,
        storage_fallback: storageFallback,
        storage_error: storageFallback ? storageError : ''
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
