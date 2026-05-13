const SOURCE_MAP = {
  bmasRechengroessen2026: {
    label: 'BMAS: Sozialversicherungsrechengrößen-Verordnung 2026',
    url: 'https://www.bmas.de/DE/Service/Gesetze-und-Gesetzesvorhaben/sozialversicherungs-rechengroessenverordnung-2026.html'
  },
  gesetzeImInternetSvbezgrv2026: {
    label: 'Gesetze im Internet: SVBezGrV 2026',
    url: 'https://www.gesetze-im-internet.de/svbezgrv_2026/BJNR1160A0025.html'
  },
  bmgKrankenversicherung2026: {
    label: 'BMG: Beiträge der gesetzlichen Krankenversicherung',
    url: 'https://www.bundesgesundheitsministerium.de/beitraege.html'
  },
  bmgPflegeversicherung2026: {
    label: 'BMG: Finanzierung der sozialen Pflegeversicherung',
    url: 'https://www.bundesgesundheitsministerium.de/themen/pflege/online-ratgeber-pflege/die-pflegeversicherung/finanzierung.html'
  },
  rvBeitrSbek2026: {
    label: 'Gesetze im Internet: RVBeitrSBek 2026',
    url: 'https://www.gesetze-im-internet.de/rvbeitrsbek_2026/BJNR1230A0025.html'
  },
  bmasAenderungen2026: {
    label: 'BMAS: Das ändert sich im neuen Jahr',
    url: 'https://www.bmas.de/DE/Service/Presse/Pressemitteilungen/2025/das-aendert-sich-im-neuen-jahr.html'
  },
  bundesanzeigerZusatzbeitrag2026: {
    label: 'Bundesanzeiger: durchschnittlicher Zusatzbeitrag 2026',
    url: 'https://www.bundesanzeiger.de/pub/publication/oUJYVk8GYRXybnb9Y4h'
  },
  tkRechengroessen2026: {
    label: 'TK: Sozialversicherungs-Rechengrößen 2026',
    url: 'https://www.tk.de/firmenkunden/service/fachthemen/fachthema-beitraege/sozialversicherungs-rechengroessen-2026-2203234'
  }
};

const SOCIAL_SECURITY_VALUE_SET_2026 = {
  id: 'sozialversicherung-2026',
  label: 'Sozialversicherungswerte 2026',
  valueStand: '2026',
  validFrom: '2026-01-01',
  checkedAt: '2026-05-13',
  disclaimer:
    'Die Werte dienen der Lern- und Prüfungsvorbereitung. Sie ersetzen keine Rechtsberatung und keine Prüfung der jeweils aktuellen amtlichen Rechtslage.',
  sources: SOURCE_MAP,
  values: [
    {
      id: 'bezugsgröße_sozialversicherung',
      label: 'Bezugsgröße in der Sozialversicherung',
      aliases: ['bezugsgröße', 'bezugsgröße sozialversicherung', 'bezugsgrösse'],
      type: 'currency',
      monthly: 3955,
      yearly: 47460,
      unit: 'EUR',
      law: '§ 18 SGB IV',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026', 'tkRechengroessen2026']
    },
    {
      id: 'jaeg_allgemein_kv_pv',
      label: 'Allgemeine Jahresarbeitsentgeltgrenze in der Kranken- und Pflegeversicherung',
      aliases: ['jaeg', 'jahresarbeitsentgeltgrenze', 'versicherungspflichtgrenze', 'allgemeine jaeg'],
      type: 'currency',
      monthly: 6450,
      yearly: 77400,
      unit: 'EUR',
      law: '§ 6 Abs. 6 SGB V',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026', 'tkRechengroessen2026']
    },
    {
      id: 'jaeg_besonders_kv_pv',
      label: 'Besondere Jahresarbeitsentgeltgrenze in der Kranken- und Pflegeversicherung',
      aliases: ['besondere jaeg', 'besondere jahresarbeitsentgeltgrenze', 'besondere versicherungspflichtgrenze'],
      type: 'currency',
      monthly: 5812.5,
      yearly: 69750,
      unit: 'EUR',
      law: '§ 6 Abs. 7 SGB V',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026', 'tkRechengroessen2026']
    },
    {
      id: 'bbg_kv_pv',
      label: 'Beitragsbemessungsgrenze in der Kranken- und Pflegeversicherung',
      aliases: ['bbg', 'beitragsbemessungsgrenze', 'bbg kv', 'bbg pv', 'bbg krankenversicherung', 'bbg pflegeversicherung'],
      type: 'currency',
      monthly: 5812.5,
      yearly: 69750,
      unit: 'EUR',
      law: '§ 6 Abs. 7 SGB V',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026', 'bmgKrankenversicherung2026', 'bmgPflegeversicherung2026', 'tkRechengroessen2026']
    },
    {
      id: 'bbg_rv_alv',
      label: 'Beitragsbemessungsgrenze in der allgemeinen Rentenversicherung und Arbeitslosenversicherung',
      aliases: ['bbg rv', 'bbg alv', 'bbg rentenversicherung', 'bbg arbeitslosenversicherung', 'rentenversicherung beitragsbemessungsgrenze', 'arbeitslosenversicherung beitragsbemessungsgrenze'],
      type: 'currency',
      monthly: 8450,
      yearly: 101400,
      unit: 'EUR',
      law: '§ 159 SGB VI',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026', 'bmgPflegeversicherung2026', 'tkRechengroessen2026']
    },
    {
      id: 'bbg_knappschaftliche_rv',
      label: 'Beitragsbemessungsgrenze in der knappschaftlichen Rentenversicherung',
      aliases: ['bbg knappschaft', 'knappschaftliche rentenversicherung', 'knappschaftliche rv'],
      type: 'currency',
      monthly: 10400,
      yearly: 124800,
      unit: 'EUR',
      law: '§ 159 SGB VI',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026', 'tkRechengroessen2026']
    },
    {
      id: 'durchschnittsentgelt_rv_vorlaeufig_2026',
      label: 'Vorläufiges Durchschnittsentgelt 2026 in der Rentenversicherung',
      aliases: ['vorläufiges durchschnittsentgelt', 'durchschnittsentgelt 2026', 'rentenversicherung durchschnittsentgelt'],
      type: 'currency',
      yearly: 51944,
      unit: 'EUR',
      law: '§ 69 SGB VI',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026']
    },
    {
      id: 'durchschnittsentgelt_rv_endgueltig_2024',
      label: 'Endgültiges Durchschnittsentgelt 2024 in der Rentenversicherung',
      aliases: ['endgültiges durchschnittsentgelt', 'durchschnittsentgelt 2024'],
      type: 'currency',
      yearly: 47085,
      unit: 'EUR',
      law: '§ 69 SGB VI',
      sources: ['bmasRechengroessen2026', 'gesetzeImInternetSvbezgrv2026']
    },
    {
      id: 'kv_beitragssatz_allgemein',
      label: 'Allgemeiner Beitragssatz der gesetzlichen Krankenversicherung',
      aliases: ['krankenversicherung beitragssatz', 'kv beitragssatz', 'allgemeiner beitragssatz', 'krankengeld ab dem 43. tag'],
      type: 'percent',
      totalPercent: 14.6,
      employerPercent: 7.3,
      employeePercent: 7.3,
      sources: ['bmgKrankenversicherung2026']
    },
    {
      id: 'kv_beitragssatz_ermaessigt',
      label: 'Ermäßigter Beitragssatz der gesetzlichen Krankenversicherung',
      aliases: ['ermäßigter beitragssatz', 'ermaessigter beitragssatz', 'kv ermäßigt', 'kv ermaessigt'],
      type: 'percent',
      totalPercent: 14,
      employerPercent: 7,
      employeePercent: 7,
      sources: ['bmgKrankenversicherung2026']
    },
    {
      id: 'kv_durchschnittlicher_zusatzbeitrag',
      label: 'Durchschnittlicher Zusatzbeitragssatz der gesetzlichen Krankenversicherung',
      aliases: ['zusatzbeitrag', 'durchschnittlicher zusatzbeitrag', 'zusatzbeitragssatz'],
      type: 'percent',
      totalPercent: 2.9,
      sources: ['bmgKrankenversicherung2026', 'bundesanzeigerZusatzbeitrag2026']
    },
    {
      id: 'rv_beitragssatz_allgemein',
      label: 'Beitragssatz der allgemeinen Rentenversicherung',
      aliases: ['rentenversicherung beitragssatz', 'rv beitragssatz', 'allgemeine rentenversicherung beitragssatz'],
      type: 'percent',
      totalPercent: 18.6,
      employerPercent: 9.3,
      employeePercent: 9.3,
      sources: ['rvBeitrSbek2026', 'bmgPflegeversicherung2026']
    },
    {
      id: 'rv_beitragssatz_knappschaft',
      label: 'Beitragssatz der knappschaftlichen Rentenversicherung',
      aliases: ['knappschaft beitragssatz', 'knappschaftliche rentenversicherung beitragssatz'],
      type: 'percent',
      totalPercent: 24.7,
      employerPercent: 15.4,
      employeePercent: 9.3,
      sources: ['rvBeitrSbek2026']
    },
    {
      id: 'alv_beitragssatz',
      label: 'Beitragssatz zur Arbeitsförderung/Arbeitslosenversicherung',
      aliases: ['arbeitslosenversicherung beitragssatz', 'alv beitragssatz', 'arbeitsförderung beitragssatz', 'arbeitsfoerderung beitragssatz'],
      type: 'percent',
      totalPercent: 2.6,
      employerPercent: 1.3,
      employeePercent: 1.3,
      sources: ['bmasAenderungen2026', 'bmgPflegeversicherung2026']
    },
    {
      id: 'pv_beitragssatz_allgemein',
      label: 'Beitragssatz der sozialen Pflegeversicherung mit einem Kind/Elterneigenschaft',
      aliases: ['pflegeversicherung beitragssatz', 'pv beitragssatz', 'pflegebeitrag', 'elterneigenschaft'],
      type: 'percent',
      totalPercent: 3.6,
      employerPercent: 1.8,
      employeePercent: 1.8,
      notes: 'In Sachsen: Arbeitgeber 1,3 %, Arbeitnehmer 2,3 %.',
      sources: ['bmgPflegeversicherung2026']
    },
    {
      id: 'pv_beitragssatz_kinderlos',
      label: 'Beitragssatz der sozialen Pflegeversicherung für Kinderlose',
      aliases: ['kinderlosenzuschlag', 'pflegeversicherung kinderlos', 'pv kinderlos'],
      type: 'percent',
      totalPercent: 4.2,
      employerPercent: 1.8,
      employeePercent: 2.4,
      surchargePercent: 0.6,
      notes: 'In Sachsen: Arbeitgeber 1,3 %, Arbeitnehmer kinderlos 2,9 %.',
      sources: ['bmgPflegeversicherung2026']
    },
    {
      id: 'pv_beitragssatz_mehrere_kinder',
      label: 'Pflegeversicherung: Abschläge für Eltern mit mehreren Kindern',
      aliases: ['abschlag kinder', 'mehrere kinder pflegeversicherung', 'pv kinderabschlag'],
      type: 'percentTable',
      values: [
        { label: '2 Kinder', totalPercent: 3.35, employeePercent: 1.55 },
        { label: '3 Kinder', totalPercent: 3.1, employeePercent: 1.3 },
        { label: '4 Kinder', totalPercent: 2.85, employeePercent: 1.05 },
        { label: '5 und mehr Kinder', totalPercent: 2.6, employeePercent: 0.8 }
      ],
      employerPercent: 1.8,
      notes: 'Abschlag 0,25 Beitragssatzpunkte je Kind vom zweiten bis zum fünften Kind; nur während der Erziehungsphase bis 25 Jahre. In Sachsen Arbeitgeberanteil 1,3 %.',
      sources: ['bmgPflegeversicherung2026']
    }
  ]
};

const SOCIAL_SECURITY_TRIGGERS = [
  'sozialversicherungsrecht',
  'sozialversicherung',
  'bbg',
  'beitragsbemessungsgrenze',
  'jaeg',
  'jahresarbeitsentgeltgrenze',
  'versicherungspflichtgrenze',
  'bezugsgröße',
  'bezugsgrösse',
  'beitragssatz',
  'zusatzbeitrag',
  'rentenversicherung',
  'krankenversicherung',
  'pflegeversicherung',
  'arbeitslosenversicherung',
  'arbeitsförderung',
  'arbeitsfoerderung',
  'knappschaft'
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

function normalizeNumber(value) {
  const parsed = Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(parsed)) return '';
  return parsed.toFixed(2);
}

function formatGermanNumber(value, decimals = 2) {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

function formatCurrencyLine(value) {
  const parts = [];
  if (Number.isFinite(value.monthly)) {
    parts.push(`monatlich ${formatGermanNumber(value.monthly)} Euro`);
  }
  if (Number.isFinite(value.yearly)) {
    parts.push(`jährlich ${formatGermanNumber(value.yearly)} Euro`);
  }
  return parts.join(', ');
}

function formatPercent(value) {
  return `${formatGermanNumber(value)} %`;
}

function formatPercentLine(value) {
  if (Array.isArray(value.values)) {
    return [
      value.values.map((entry) => `${entry.label}: gesamt ${formatPercent(entry.totalPercent)}, Arbeitnehmer ${formatPercent(entry.employeePercent)}`).join('; '),
      `Arbeitgeber ${formatPercent(value.employerPercent)}`
    ].join('; ');
  }

  const parts = [`gesamt ${formatPercent(value.totalPercent)}`];
  if (Number.isFinite(value.employerPercent)) parts.push(`Arbeitgeber ${formatPercent(value.employerPercent)}`);
  if (Number.isFinite(value.employeePercent)) parts.push(`Arbeitnehmer ${formatPercent(value.employeePercent)}`);
  if (Number.isFinite(value.surchargePercent)) parts.push(`Zuschlag ${formatPercent(value.surchargePercent)}`);
  return parts.join(', ');
}

function formatValueLine(value) {
  const amount = value.type === 'currency' ? formatCurrencyLine(value) : formatPercentLine(value);
  const law = value.law ? ` (${value.law})` : '';
  const notes = value.notes ? ` Hinweis: ${value.notes}` : '';
  return `- ${value.label}${law}: ${amount}.${notes}`;
}

function valueMatches(value, normalizedText) {
  return value.aliases.some((alias) => normalizedText.includes(normalizeText(alias)));
}

function isBroadSocialSecurityRequest(normalizedText) {
  return normalizedText.includes('sozialversicherungsrecht') || normalizedText.includes('sozialversicherung');
}

function isGenericBbgRequest(normalizedText) {
  return normalizedText.includes('bbg') || normalizedText.includes('beitragsbemessungsgrenze');
}

function isGenericJaegRequest(normalizedText) {
  return normalizedText.includes('jaeg') || normalizedText.includes('jahresarbeitsentgeltgrenze') || normalizedText.includes('versicherungspflichtgrenze');
}

function isGenericRateRequest(normalizedText) {
  return normalizedText.includes('beitragssatz');
}

function getSocialSecurityValueContext(input) {
  const normalizedText = normalizeText([
    input && input.topic,
    input && input.material
  ].filter(Boolean).join(' '));

  const hasTrigger = SOCIAL_SECURITY_TRIGGERS.some((trigger) => normalizedText.includes(normalizeText(trigger)));
  if (!hasTrigger) return null;

  const broad = isBroadSocialSecurityRequest(normalizedText);
  const values = broad
    ? SOCIAL_SECURITY_VALUE_SET_2026.values
    : isGenericBbgRequest(normalizedText)
      ? SOCIAL_SECURITY_VALUE_SET_2026.values.filter((value) => value.id.startsWith('bbg_'))
      : isGenericJaegRequest(normalizedText)
        ? SOCIAL_SECURITY_VALUE_SET_2026.values.filter((value) => value.id.startsWith('jaeg_'))
        : isGenericRateRequest(normalizedText)
          ? SOCIAL_SECURITY_VALUE_SET_2026.values.filter((value) => value.type === 'percent' || value.type === 'percentTable')
    : SOCIAL_SECURITY_VALUE_SET_2026.values.filter((value) => valueMatches(value, normalizedText));

  if (!values.length) return null;

  const sourceIds = Array.from(new Set(values.flatMap((value) => value.sources || [])));
  const sources = sourceIds.map((id) => SOCIAL_SECURITY_VALUE_SET_2026.sources[id]).filter(Boolean);

  return {
    id: SOCIAL_SECURITY_VALUE_SET_2026.id,
    label: SOCIAL_SECURITY_VALUE_SET_2026.label,
    valueStand: SOCIAL_SECURITY_VALUE_SET_2026.valueStand,
    validFrom: SOCIAL_SECURITY_VALUE_SET_2026.validFrom,
    checkedAt: SOCIAL_SECURITY_VALUE_SET_2026.checkedAt,
    disclaimer: SOCIAL_SECURITY_VALUE_SET_2026.disclaimer,
    values,
    sources,
    promptText: [
      `${SOCIAL_SECURITY_VALUE_SET_2026.label}, Stand ${SOCIAL_SECURITY_VALUE_SET_2026.valueStand}.`,
      'Wenn Sozialversicherungswerte, Euro-Beträge oder Beitragssätze gebraucht werden, nutze ausschließlich die folgenden geprüften Werte oder Zahlen aus dem Lernstoff.',
      'Erfinde keine Werte. Wenn ein benötigter Wert nicht aufgeführt ist, formuliere ohne konkrete Zahl.',
      values.map(formatValueLine).join('\n')
    ].join('\n')
  };
}

function addNumberToSet(set, value) {
  if (Number.isFinite(value)) set.add(Number(value).toFixed(2));
}

function collectAllowedNumbers(context, extraText) {
  const allowed = new Set();
  const values = context && Array.isArray(context.values) ? context.values : [];

  values.forEach((value) => {
    addNumberToSet(allowed, value.monthly);
    addNumberToSet(allowed, value.yearly);
    addNumberToSet(allowed, value.totalPercent);
    addNumberToSet(allowed, value.employerPercent);
    addNumberToSet(allowed, value.employeePercent);
    addNumberToSet(allowed, value.surchargePercent);

    if (Array.isArray(value.values)) {
      value.values.forEach((entry) => {
        addNumberToSet(allowed, entry.totalPercent);
        addNumberToSet(allowed, entry.employerPercent);
        addNumberToSet(allowed, entry.employeePercent);
        addNumberToSet(allowed, entry.surchargePercent);
      });
    }
  });

  const extraMatches = String(extraText || '').match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)(?=\s*(?:€|Euro|Prozent|%))/gi) || [];
  extraMatches.map(normalizeNumber).filter(Boolean).forEach((number) => allowed.add(number));

  return allowed;
}

function extractGuardedNumbers(text) {
  const matches = String(text || '').match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)(?=\s*(?:€|Euro|Prozent|%))/gi) || [];
  return matches
    .map((raw) => ({ raw, normalized: normalizeNumber(raw) }))
    .filter((entry) => entry.normalized);
}

function findUnsupportedSocialSecurityNumbers(text, context, extraText) {
  if (!context) return [];

  const allowed = collectAllowedNumbers(context, extraText);
  const numbers = extractGuardedNumbers(text);
  const unsupported = [];

  numbers.forEach((entry) => {
    if (!allowed.has(entry.normalized) && !unsupported.some((item) => item.normalized === entry.normalized)) {
      unsupported.push(entry);
    }
  });

  return unsupported;
}

function getPublicFacts(context) {
  if (!context) return null;

  return {
    label: context.label,
    valueStand: context.valueStand,
    checkedAt: context.checkedAt,
    disclaimer: context.disclaimer,
    sources: context.sources
  };
}

module.exports = {
  SOCIAL_SECURITY_VALUE_SET_2026,
  findUnsupportedSocialSecurityNumbers,
  getPublicFacts,
  getSocialSecurityValueContext
};
