(() => {
  const normalize = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();
  const low = (value = '') => normalize(value).toLowerCase();

  const steps = [
    {
      key: 'alter',
      question: 'Wie alt ist die Person?',
      progress: '1 von 3',
      freePlaceholder: 'Alter eingeben…',
      options: [
        { value: 'unter18', label: 'Unter 18 Jahre' },
        { value: '18-23-kein-azubi', label: '18–23 Jahre (ohne Ausbildung/Studium)' },
        { value: '18-25-azubi', label: '18–25 Jahre (in Ausbildung/Studium/Freiwilligendienst)' },
        { value: '25+', label: 'Über 25 Jahre' }
      ]
    },
    {
      key: 'einkommen',
      question: 'Hat die Person regelmäßiges eigenes Einkommen über der aktuellen Einkommensgrenze nach § 10 SGB V?',
      progress: '2 von 3',
      freePlaceholder: 'Einkommenssituation beschreiben…',
      options: [
        { value: 'unterGrenze', label: 'Nein / unter der aktuellen Einkommensgrenze' },
        { value: 'ueberGrenze', label: 'Ja, über der aktuellen Einkommensgrenze' }
      ]
    },
    {
      key: 'elternteil',
      question: 'Ist das Elternteil (Hauptversicherter) Mitglied einer gesetzlichen Krankenversicherung (GKV)?',
      progress: '3 von 3',
      freePlaceholder: 'Krankenversicherung nennen…',
      options: [
        { value: 'gkv', label: 'Ja, gesetzlich versichert (GKV)' },
        { value: 'pkv', label: 'Nein, privat versichert (PKV)' },
        { value: 'unbekannt', label: 'Nicht bekannt' }
      ]
    }
  ];

  const helper = {
    version: '2026-04-21',
    steps,
    isEligibleMode(domain = '') {
      const mode = low(domain);
      return mode === 'sozialrecht' || mode === 'standard';
    },
    isTriggerQuestion(text = '') {
      const raw = low(text);
      if (!raw) return false;
      return (
        /\bfamilienversicherung\b/i.test(raw) ||
        /\bfamilienversichert\b/i.test(raw) ||
        /§\s*10\s*sgb\s*v/i.test(raw) ||
        /\bfamilie(n)?versicherung\s*prüf/i.test(raw) ||
        /\bfamilienversicherung\s+(pruef|prüf|check)\b/i.test(raw)
      );
    },
    isAffirmative(text = '') {
      const raw = low(text);
      return /^(ja|ja bitte|bitte ja|klar|gerne|ok|okay|jo|mach|prüf es|pruef es)\b/i.test(raw);
    },
    isNegative(text = '') {
      const raw = low(text);
      return /^(nein|nee|no|nicht jetzt|überspringen|ueberspringen|später|spaeter)\b/i.test(raw);
    },
    confirmationPrompt() {
      return 'Soll ich die Familienversicherung abprüfen? Wenn ja, stelle ich dir jetzt die drei kurzen Fragen.';
    },
    buildAnswerLabel(key, value) {
      const step = steps.find((item) => item.key === key);
      const entry = step ? step.options.find((option) => option.value === value) : null;
      return entry ? entry.label : normalize(value);
    },
    buildAnswerLines(answers = {}) {
      return steps.map((step) => {
        const value = normalize(answers[step.key] || '');
        const label = value ? helper.buildAnswerLabel(step.key, value) : 'nicht angegeben';
        return `${step.question}: ${label}`;
      });
    },
    evaluate(fvState = {}) {
      const answers = fvState.answers || {};
      const alter = normalize(answers.alter);
      const einkommen = normalize(answers.einkommen);
      const elternteil = normalize(answers.elternteil);
      const freeTextUsed = Boolean(fvState.freeTextUsed);
      const summary = helper.buildAnswerLines(answers);

      if (freeTextUsed || elternteil === 'unbekannt') {
        return { status: 'unklar', summary };
      }

      const notPossibleReasons = [];
      if (alter === '25+') {
        notPossibleReasons.push('Die Person ist über 25 Jahre alt.');
      }
      if (alter === '18-23-kein-azubi') {
        notPossibleReasons.push('Die Person ist 18 bis 23 Jahre alt, aber nicht in Ausbildung oder Studium.');
      }
      if (einkommen === 'ueberGrenze') {
        notPossibleReasons.push('Die Person hat regelmäßiges eigenes Einkommen über der aktuellen Einkommensgrenze.');
      }
      if (elternteil === 'pkv') {
        notPossibleReasons.push('Das Elternteil ist privat versichert und damit nicht GKV-Mitglied.');
      }
      if (notPossibleReasons.length) {
        return { status: 'nicht-moeglich', reason: notPossibleReasons.join(' '), summary };
      }

      const possible =
        (alter === 'unter18' || alter === '18-25-azubi') &&
        einkommen === 'unterGrenze' &&
        elternteil === 'gkv';
      if (possible) return { status: 'moeglich', summary };

      return { status: 'unklar', summary };
    },
    buildHtml(status, detail = '') {
      const cleanDetail = normalize(detail);
      if (status === 'moeglich') {
        return `
          <div class="sozialrecht-stack">
            <span class="sozialrecht-topline">✓ Familienversicherung (GKV) möglich</span>
            <div class="sozialrecht-section intro">
              <p class="sozialrecht-section-head">Voraussetzungen erfüllt</p>
              <p>${cleanDetail || 'Die Angaben sprechen für eine Familienversicherung in der gesetzlichen Krankenversicherung (GKV).'} — Bitte Anmeldung direkt bei der GKV des Elternteils vornehmen.</p>
            </div>
          </div>
        `;
      }
      if (status === 'nicht-moeglich') {
        return `
          <div class="sozialrecht-stack">
            <span class="sozialrecht-topline">✗ Familienversicherung nicht möglich</span>
            <div class="sozialrecht-section intro">
              <p class="sozialrecht-section-head">Grund</p>
              <p>${cleanDetail || 'Nach den Angaben liegt keine Familienversicherung in der gesetzlichen Krankenversicherung (GKV) vor.'}</p>
            </div>
          </div>
        `;
      }
      return `
        <div class="sozialrecht-stack">
          <span class="sozialrecht-topline">? Prüfung erforderlich</span>
          <div class="sozialrecht-section intro">
            <p class="sozialrecht-section-head">Hinweis</p>
            <p>${cleanDetail || 'Aufgrund der Angaben kann keine eindeutige Aussage getroffen werden. Linda prüft weiter…'}</p>
          </div>
        </div>
      `;
    }
  };

  window.LINDA_FV_CHECK = helper;
  window.FV_CHECK_STEPS = steps;
})();
