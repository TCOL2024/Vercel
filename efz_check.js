(function () {
  'use strict';

  const MODULE = 'efz-check';

  const EFZ_SOURCES = [
    {
      title: 'Entgeltfortzahlungsgesetz (EFZG) - § 3',
      url: 'https://www.gesetze-im-internet.de/entgfg/__3.html',
      section: 'Grundanspruch',
      excerpt: '§ 3 EFZG regelt den Anspruch auf Entgeltfortzahlung, die vierwoechige Wartezeit und die Begrenzung auf sechs Wochen.'
    },
    {
      title: 'Entgeltfortzahlungsgesetz (EFZG) - § 5',
      url: 'https://www.gesetze-im-internet.de/entgfg/__5.html',
      section: 'Anzeige und Nachweis',
      excerpt: '§ 5 EFZG betrifft die Anzeige- und Nachweispflichten bei Arbeitsunfaehigkeit.'
    },
    {
      title: 'IHK Oldenburg - Entgeltfortzahlung im Krankheitsfall',
      url: 'file:///Users/jensnoormann/Downloads/Entgeltfortzahlung im Krankheitsfall - Oldenburgische IHK.pdf',
      section: 'Merkblatt',
      excerpt: 'Das Merkblatt fasst Grundvoraussetzungen, sechs Wochen Entgeltfortzahlung, eAU, Zweifel an der AU und BEM-Hinweise zusammen.'
    },
    {
      title: 'Vorerkrankungen: Pruefung und Anrechnung',
      url: 'file:///Users/jensnoormann/Downloads/Vorerkrankungen_ Pru\u0308fung und Anrechnung.pdf',
      section: 'Vorerkrankungen',
      excerpt: 'Die Unterlage beschreibt 6-Monats-Frist, 12-Monats-Frist und die elektronische Krankenkassenpruefung bei moeglichen Vorerkrankungen.'
    },
    {
      title: 'Haufe - Vorerkrankungen richtig anrechnen',
      url: 'file:///Users/jensnoormann/Downloads/Entgeltfortzahlung_ Vorerkrankungen richtig anrechnen _ Personal _ Haufe.pdf',
      section: 'Fortsetzungserkrankung',
      excerpt: 'Haufe erlaeutert, wann Vorerkrankungen auf den Entgeltfortzahlungszeitraum angerechnet werden koennen.'
    }
  ];

  const STEPS = [
    {
      key: 'employment',
      progress: '1 von 10',
      question: 'Besteht ein Arbeitsverhaeltnis?',
      intro: 'Zuerst klaeren wir, ob das EFZG ueberhaupt als Anspruchsgrundlage passt.',
      freePlaceholder: 'Arbeitsverhaeltnis beschreiben...',
      options: [
        { value: 'yes', label: 'Ja, normales Arbeitsverhaeltnis', description: 'auch Teilzeit oder befristet' },
        { value: 'azubi', label: 'Ja, Ausbildungsverhaeltnis', description: 'Auszubildende sind grundsaetzlich erfasst' },
        { value: 'minijob', label: 'Ja, Minijob', description: 'geringfuegige Beschaeftigung ist nicht ausgeschlossen' },
        { value: 'no', label: 'Nein', description: 'kein Arbeitnehmerstatus' },
        { value: 'unknown', label: 'Unklar', description: 'Status muss noch geprueft werden' }
      ]
    },
    {
      key: 'waitingPeriod',
      progress: '2 von 10',
      question: 'Besteht das Arbeitsverhaeltnis seit mindestens vier Wochen ununterbrochen?',
      intro: 'Der gesetzliche Anspruch entsteht erst nach der Wartezeit des § 3 Abs. 3 EFZG.',
      freePlaceholder: 'Beginn des Arbeitsverhaeltnisses...',
      options: [
        { value: 'yes', label: 'Ja, mindestens vier Wochen', description: 'Wartezeit erfuellt' },
        { value: 'no', label: 'Nein, unter vier Wochen', description: 'gesetzlicher EFZ-Anspruch noch nicht entstanden' },
        { value: 'unknown', label: 'Unklar', description: 'Beginn muss noch geklaert werden' }
      ]
    },
    {
      key: 'au',
      progress: '3 von 10',
      question: 'Liegt eine krankheitsbedingte Arbeitsunfaehigkeit vor?',
      intro: 'Entgeltfortzahlung setzt Krankheit und daraus folgende Arbeitsunfaehigkeit voraus.',
      freePlaceholder: 'AU/eAU beschreiben...',
      options: [
        { value: 'yes', label: 'Ja, AU liegt vor', description: 'aerztlich festgestellt oder eAU abrufbar' },
        { value: 'missingProof', label: 'AU behauptet, Nachweis offen', description: 'materieller Anspruch und Nachweis getrennt pruefen' },
        { value: 'no', label: 'Nein', description: 'keine krankheitsbedingte AU' },
        { value: 'unknown', label: 'Unklar', description: 'AU-Status offen' }
      ]
    },
    {
      key: 'soleCause',
      progress: '4 von 10',
      question: 'Ist die Arbeitsunfaehigkeit der Grund dafuer, dass nicht gearbeitet wird?',
      intro: 'Die AU muss Ursache fuer den Arbeitsausfall sein.',
      freePlaceholder: 'Grund des Arbeitsausfalls...',
      options: [
        { value: 'yes', label: 'Ja', description: 'ohne Krankheit waere gearbeitet worden' },
        { value: 'no', label: 'Nein', description: 'z. B. Urlaub, Freistellung, Streik oder anderer Grund' },
        { value: 'unknown', label: 'Unklar', description: 'Ursache muss noch eingeordnet werden' }
      ]
    },
    {
      key: 'fault',
      progress: '5 von 10',
      question: 'Ist die Arbeitsunfaehigkeit selbst verschuldet?',
      intro: 'Nur unverschuldete Krankheit loest den gesetzlichen Anspruch aus.',
      freePlaceholder: 'Umstaende beschreiben...',
      options: [
        { value: 'no', label: 'Nein / nichts ersichtlich', description: 'Regelfall' },
        { value: 'possible', label: 'Moeglicherweise', description: 'z. B. grob riskantes Verhalten, gesondert pruefen' },
        { value: 'yes', label: 'Ja', description: 'Anspruch kann ausgeschlossen sein' },
        { value: 'unknown', label: 'Unklar', description: 'Sachverhalt offen' }
      ]
    },
    {
      key: 'currentDuration',
      progress: '6 von 10',
      question: 'Wie lange dauert die aktuelle Arbeitsunfaehigkeit voraussichtlich?',
      intro: 'Der gesetzliche Zeitraum ist auf sechs Wochen bzw. 42 Kalendertage begrenzt.',
      freePlaceholder: 'z. B. 02.04. bis 18.04....',
      options: [
        { value: 'upTo42', label: 'Bis 42 Kalendertage', description: 'innerhalb des gesetzlichen EFZ-Zeitraums' },
        { value: 'over42', label: 'Mehr als 42 Kalendertage', description: 'danach regelmaessig Krankengeld statt EFZ' },
        { value: 'ongoing', label: 'Noch laufend / Ende offen', description: 'Dauer muss beobachtet werden' },
        { value: 'unknown', label: 'Unklar', description: 'Zeitraum offen' }
      ]
    },
    {
      key: 'priorAu',
      progress: '7 von 10',
      question: 'Gab es vor der aktuellen AU fruehere Arbeitsunfaehigkeitszeiten?',
      intro: 'Jetzt pruefen wir, ob Vorerkrankungen den Anspruch verbrauchen oder begrenzen.',
      freePlaceholder: 'fruehere AU-Zeiten beschreiben...',
      options: [
        { value: 'no', label: 'Nein', description: 'keine bekannte Vorerkrankung' },
        { value: 'yes', label: 'Ja', description: 'fruehere AU-Zeiten vorhanden' },
        { value: 'unknown', label: 'Unklar', description: 'moegliche Krankenkassenpruefung' }
      ]
    },
    {
      key: 'sameDisease',
      progress: '8 von 10',
      question: 'Geht es bei aktueller AU und Vorerkrankung um dieselbe Krankheit bzw. dieselbe Grunderkrankung?',
      intro: 'Nur gleiche Krankheit bzw. Fortsetzungserkrankung kann angerechnet werden.',
      freePlaceholder: 'Zusammenhang beschreiben...',
      when: (answers) => ['yes', 'unknown'].includes(answers.priorAu),
      options: [
        { value: 'no', label: 'Nein, andere Krankheit', description: 'grundsaetzlich neuer 6-Wochen-Anspruch' },
        { value: 'yes', label: 'Ja, dieselbe Krankheit', description: 'Fortsetzungserkrankung moeglich' },
        { value: 'unknown', label: 'Unklar', description: 'Krankenkasse muss Zusammenhang pruefen' }
      ]
    },
    {
      key: 'sixMonths',
      progress: '9 von 10',
      question: 'War die Person vor der erneuten AU mindestens sechs Monate nicht wegen derselben Krankheit arbeitsunfaehig?',
      intro: 'Wenn ja, entsteht trotz gleicher Krankheit grundsaetzlich ein neuer Anspruch.',
      freePlaceholder: 'Zeitraum beschreiben...',
      when: (answers) => ['yes', 'unknown'].includes(answers.sameDisease),
      options: [
        { value: 'yes', label: 'Ja, sechs Monate frei', description: 'neuer Anspruch grundsaetzlich moeglich' },
        { value: 'no', label: 'Nein', description: '12-Monats-Frist weiter pruefen' },
        { value: 'unknown', label: 'Unklar', description: 'Daten/Diagnose offen' }
      ]
    },
    {
      key: 'twelveMonths',
      progress: '10 von 10',
      question: 'Sind seit Beginn der ersten AU wegen derselben Krankheit mindestens zwoelf Monate vergangen?',
      intro: 'Die 12-Monats-Frist kann einen neuen Anspruch eroeffnen, wenn die neue AU ausserhalb dieser Frist beginnt.',
      freePlaceholder: 'Beginn der ersten AU beschreiben...',
      when: (answers) => ['yes', 'unknown'].includes(answers.sameDisease) && answers.sixMonths !== 'yes',
      options: [
        { value: 'yes', label: 'Ja, 12 Monate vergangen', description: 'neuer Anspruch grundsaetzlich moeglich' },
        { value: 'no', label: 'Nein', description: 'anrechenbare Fortsetzungserkrankung wahrscheinlich' },
        { value: 'unknown', label: 'Unklar', description: 'Zeitraeume muessen geklaert werden' }
      ]
    },
    {
      key: 'usedDays',
      progress: 'Zusatz',
      question: 'Wie viele Entgeltfortzahlungstage wurden fuer diese Krankheit bereits verbraucht?',
      intro: 'Bei Fortsetzungserkrankung zaehlen die Zeiten zusammen bis maximal 42 Kalendertage.',
      freePlaceholder: 'verbrauchte Tage beschreiben...',
      when: (answers) => answers.sameDisease === 'yes' && answers.sixMonths !== 'yes' && answers.twelveMonths !== 'yes',
      options: [
        { value: 'none', label: 'Noch keine', description: 'Anspruch waere noch nicht verbraucht' },
        { value: 'partial', label: 'Teilweise', description: 'nur Resttage bleiben' },
        { value: 'exhausted', label: '42 Tage bereits ausgeschoepft', description: 'kein weiterer EFZ-Anspruch fuer dieselbe Krankheit' },
        { value: 'unknown', label: 'Unklar', description: 'Krankenkassen-/Abrechnungspruefung noetig' }
      ]
    },
    {
      key: 'addedDisease',
      progress: 'Zusatz',
      question: 'Ist waehrend einer laufenden AU nur eine weitere Krankheit hinzugetreten?',
      intro: 'Eine hinzutretende Krankheit verlaengert die sechs Wochen nicht automatisch.',
      freePlaceholder: 'hinzutretende Krankheit beschreiben...',
      when: (answers) => answers.priorAu !== 'no',
      options: [
        { value: 'no', label: 'Nein', description: 'getrennte AU oder keine Zusatzkrankheit' },
        { value: 'yes', label: 'Ja', description: 'keine neue 6-Wochen-Frist durch blosses Hinzutreten' },
        { value: 'unknown', label: 'Unklar', description: 'zeitlicher Ablauf offen' }
      ]
    }
  ];

  function init(app) {
    if (!app || app.logic.__efzCheckInstalled) return;
    app.logic.__efzCheckInstalled = true;

    const safeText = (value) => app.utils.safeText(String(value || ''));
    const normalize = (value) => app.utils.normalizeForKeyword
      ? app.utils.normalizeForKeyword(value)
      : String(value || '').toLowerCase();

    let state = { active: false, step: 0, answers: {}, promptText: '', source: 'frontend' };

    const activeSteps = () => STEPS.filter((step) => !step.when || step.when(state.answers || {}));
    const stepLabel = (step, value) => {
      const opt = (step.options || []).find((item) => item.value === value);
      return opt ? opt.label : String(value || 'uebersprungen');
    };
    const answered = (key) => String((state.answers || {})[key] || '').trim();

    app.logic.detectEfzIntent = (text) => {
      const t = normalize(text);
      const topic = /\b(entgeltfortzahlung|lohnfortzahlung|efzg|fortsetzungserkrankung|vorerkrankungen?|krankheitstage|au zeiten|arbeitsunfaehigkeit)\b/.test(t);
      const intent = /\b(pruef(?:e|en|st|t|ung)?|check(?:e|en|st|t)?|test(?:e|en|est|et)?|anspruch|berechne|anrechn(?:en|ung)|fortsetzung|vorerkrank)\b/.test(t);
      return t === 'efz-check' || (topic && intent);
    };

    app.logic.isEfzCheckActive = () => Boolean(state.active);

    app.logic.buildEfzIntroText = () => [
      'Ich pruefe die Entgeltfortzahlung Schritt fuer Schritt.',
      '',
      'Bitte beantworte die Karten. Ein Ergebnis kommt erst, wenn die Grundvoraussetzungen und moegliche Vorerkrankungen sauber geklaert sind.'
    ].join('\n');

    app.logic.renderEfzDock = () => {
      const dock = app.ui.clarifyDock;
      if (!dock || !state.active) return false;
      const steps = activeSteps();
      const stepIndex = Math.max(0, Math.min(steps.length - 1, Number(state.step) || 0));
      const step = steps[stepIndex];
      if (!step) return false;
      const freeDraft = String((state.answers || {})[step.key] || '').trim();
      const progress = `${stepIndex + 1} von ${steps.length}`;

      dock.innerHTML = `
        <section class="clarify-card" role="group" aria-label="Entgeltfortzahlung pruefen">
          <div class="clarify-handle" aria-hidden="true"></div>
          <div class="clarify-head">
            <div class="clarify-head-main">
              <span class="clarify-kicker">Entgeltfortzahlung pruefen</span>
              <span class="clarify-progress">${safeText(progress)}</span>
            </div>
            <div class="clarify-head-actions">
              <button type="button" class="clarify-back" data-efz-back aria-label="Zurueck" ${stepIndex === 0 ? 'disabled' : ''}>‹</button>
              <button type="button" class="clarify-cancel" data-efz-cancel aria-label="Pruefung schliessen">×</button>
            </div>
          </div>
          <div class="clarify-body">
            <p class="clarify-intro">${safeText(step.intro || '')}</p>
            <h4 class="clarify-question">${safeText(step.question)}</h4>
            <ul class="clarify-options">
              ${(step.options || []).map((option, i) => `
                <li>
                  <button type="button" class="clarify-option" data-efz-option="${safeText(option.value)}">
                    <span class="clarify-option-index">${i + 1}</span>
                    <span class="clarify-option-copy">
                      <span class="clarify-option-label">${safeText(option.label)}</span>
                      ${option.description ? `<span class="clarify-option-desc">${safeText(option.description)}</span>` : ''}
                    </span>
                  </button>
                </li>
              `).join('')}
            </ul>
            <div class="clarify-free">
              <input type="text" data-efz-free-input value="${safeText(freeDraft).replace(/"/g, '&quot;')}" placeholder="${safeText(step.freePlaceholder || 'Antwort beschreiben...')}" aria-label="Eigene Antwort">
              <button type="button" data-efz-free>Uebernehmen</button>
            </div>
            <div class="clarify-actions">
              <button type="button" data-efz-skip>${stepIndex >= steps.length - 1 ? 'Ohne Angabe abschliessen' : 'Ueberspringen'}</button>
            </div>
          </div>
        </section>
      `;
      dock.hidden = false;
      return true;
    };

    const originalRenderDock = app.ui.renderClarifierDock.bind(app.ui);
    app.ui.renderClarifierDock = () => {
      if (state.active && app.logic.renderEfzDock()) return;
      originalRenderDock();
    };

    app.logic.openEfzCheck = ({ source = 'frontend', promptText = '', introText = '' } = {}) => {
      app.logic.ensureSession();
      if (typeof app.logic.closeClaudeClarifier === 'function') app.logic.closeClaudeClarifier({ save: false });
      if (typeof app.logic.closeFvCheck === 'function') app.logic.closeFvCheck({ save: false });
      state = {
        active: true,
        step: 0,
        answers: {},
        source: String(source || 'frontend'),
        promptText: String(promptText || '').trim()
      };

      const cleanPrompt = String(promptText || '').trim();
      if (cleanPrompt) {
        app.logic.appendUserMessage(cleanPrompt, { module: MODULE });
        const session = app.logic.activeSession();
        if (session && (!session.name || session.name === 'Neuer Chat')) {
          session.name = cleanPrompt.slice(0, 48);
        }
      }

      app.logic.appendAssistantMessage(
        introText || app.logic.buildEfzIntroText(),
        { module: MODULE, stage: 'intro', domain: 'SOZIALRECHT' },
        EFZ_SOURCES.slice(0, 3)
      );
      app.ui.renderClarifierDock();
      app.ui.scrollBottom();
      app.utils.save();
      return true;
    };

    app.logic.closeEfzCheck = (opts = {}) => {
      const hadActive = Boolean(state.active);
      state = { active: false, step: 0, answers: {}, promptText: '', source: 'frontend' };
      app.ui.renderClarifierDock();
      if (hadActive && opts.save !== false) app.utils.save();
    };

    app.logic.goBackEfzCheckStep = () => {
      if (!state.active) return;
      state.step = Math.max(0, Number(state.step || 0) - 1);
      app.ui.renderClarifierDock();
      app.utils.save();
    };

    app.logic.answerEfzCheckStep = (value = '', opts = {}) => {
      if (!state.active) return;
      const steps = activeSteps();
      const stepIndex = Math.max(0, Math.min(steps.length - 1, Number(state.step) || 0));
      const step = steps[stepIndex];
      if (!step) {
        app.logic.closeEfzCheck({ save: true });
        return;
      }
      const cleanValue = String(value || '').trim();
      if (!cleanValue && opts.skip !== true) return;
      state.answers[step.key] = cleanValue;

      const nextSteps = activeSteps();
      const atLastStep = stepIndex >= nextSteps.length - 1;
      if (!atLastStep) {
        state.step = stepIndex + 1;
        app.ui.renderClarifierDock();
        app.utils.save();
        return;
      }
      app.logic.finishEfzCheck();
    };

    app.logic.buildEfzQuestionAnswerSummary = () => {
      return activeSteps()
        .filter((step) => Object.prototype.hasOwnProperty.call(state.answers || {}, step.key))
        .map((step) => `F: ${step.question}\nA: ${stepLabel(step, state.answers[step.key])}`)
        .join('\n\n');
    };

    app.logic.evaluateEfzCheck = () => {
      const a = state.answers || {};
      const reasons = [];
      const next = [];

      if (a.employment === 'no') {
        return {
          status: 'kein-anspruch',
          headline: 'Ergebnis: Kein gesetzlicher Entgeltfortzahlungsanspruch nach EFZG.',
          reason: 'Es fehlt ein Arbeitsverhaeltnis. Das EFZG setzt Arbeitnehmerstatus voraus.',
          reasons: ['Kein Arbeitsverhaeltnis angegeben.'],
          next: ['Status des Vertragsverhaeltnisses gesondert pruefen.']
        };
      }
      if (a.employment === 'unknown' || !a.employment) {
        return {
          status: 'unklar',
          headline: 'Ergebnis: Noch nicht entscheidungsreif.',
          reason: 'Der Arbeitnehmerstatus ist offen. Ohne diese Einordnung kann der EFZG-Anspruch nicht sauber bewertet werden.',
          reasons: ['Arbeitnehmerstatus klaeren.'],
          next: ['Vertrag, Beschaeftigungsart und Weisungsgebundenheit pruefen.']
        };
      }
      if (a.waitingPeriod === 'no') {
        return {
          status: 'kein-anspruch',
          headline: 'Ergebnis: Gesetzlicher EFZ-Anspruch noch nicht entstanden.',
          reason: 'Das Arbeitsverhaeltnis besteht noch keine vier Wochen ununterbrochen (§ 3 Abs. 3 EFZG).',
          reasons: ['Vierwoechige Wartezeit nicht erfuellt.'],
          next: ['Pruefen, ob Arbeitsvertrag, Tarifvertrag oder Betriebsvereinbarung guenstigere Regeln enthalten.']
        };
      }
      if (a.waitingPeriod === 'unknown' || !a.waitingPeriod) {
        next.push('Beginn des Arbeitsverhaeltnisses klaeren.');
      }
      if (a.au === 'no') {
        return {
          status: 'kein-anspruch',
          headline: 'Ergebnis: Kein EFZ-Anspruch ohne krankheitsbedingte Arbeitsunfaehigkeit.',
          reason: 'Es wurde keine krankheitsbedingte Arbeitsunfaehigkeit angegeben.',
          reasons: ['Krankheit und Arbeitsunfaehigkeit sind Anspruchsvoraussetzungen.'],
          next: ['AU-Status und Nachweis pruefen.']
        };
      }
      if (a.au === 'missingProof' || a.au === 'unknown' || !a.au) {
        next.push('AU/eAU und Nachweisstatus klaeren.');
      }
      if (a.soleCause === 'no') {
        return {
          status: 'kein-anspruch',
          headline: 'Ergebnis: Kein klarer EFZ-Anspruch fuer diesen Ausfall.',
          reason: 'Die Krankheit ist nicht die Ursache fuer den Arbeitsausfall.',
          reasons: ['Arbeitsausfall beruht auf einem anderen Grund.'],
          next: ['Ausfallgrund arbeitsrechtlich getrennt pruefen.']
        };
      }
      if (a.soleCause === 'unknown' || !a.soleCause) next.push('Klaeren, ob ohne Krankheit gearbeitet worden waere.');
      if (a.fault === 'yes') {
        return {
          status: 'kein-anspruch',
          headline: 'Ergebnis: Anspruch kann wegen Eigenverschuldens ausgeschlossen sein.',
          reason: 'Bei selbst verschuldeter Arbeitsunfaehigkeit besteht kein gesetzlicher EFZ-Anspruch.',
          reasons: ['Eigenverschulden wurde bejaht.'],
          next: ['Sachverhalt und Verschuldensmassstab sorgfaeltig pruefen.']
        };
      }
      if (a.fault === 'possible' || a.fault === 'unknown' || !a.fault) {
        next.push('Eigenverschulden bei Bedarf gesondert pruefen.');
      }

      if (a.priorAu === 'unknown') {
        return {
          status: 'kk-pruefung',
          headline: 'Ergebnis: Vorerkrankungspruefung erforderlich.',
          reason: 'Es ist unklar, ob anrechenbare Vorerkrankungen vorliegen. Der Arbeitgeber kann bei gesetzlich Versicherten eine Krankenkassenpruefung ueber DTA EEL veranlassen, wenn die Voraussetzungen vorliegen.',
          reasons: ['Fruehere AU-Zeiten sind unklar.', 'Anrechnung haengt vom Zusammenhang der Erkrankungen ab.'],
          next: ['Aktuelle AU und moegliche Vorerkrankungszeiten zusammentragen.', 'Krankenkassenpruefung nur bei konkretem Pruefbedarf anstossen.']
        };
      }

      if (a.priorAu === 'yes') {
        if (a.addedDisease === 'yes') {
          return {
            status: 'begrenzt',
            headline: 'Ergebnis: Keine neue Sechs-Wochen-Frist durch hinzutretende Krankheit.',
            reason: 'Tritt waehrend laufender Arbeitsunfaehigkeit eine weitere Krankheit hinzu, verlaengert das den Entgeltfortzahlungszeitraum nicht automatisch.',
            reasons: ['Weitere Krankheit ist waehrend laufender AU hinzugetreten.', 'Der einheitliche Verhinderungsfall bleibt zu pruefen.'],
            next: ['Zeitlichen Ablauf der AU-Zeiten dokumentieren.', 'Restanspruch aus bisher verbrauchten Tagen berechnen.']
          };
        }
        if (a.sameDisease === 'unknown' || !a.sameDisease) {
          return {
            status: 'kk-pruefung',
            headline: 'Ergebnis: Zusammenhang der Erkrankungen muss geklaert werden.',
            reason: 'Ob Vorerkrankungen anzurechnen sind, haengt davon ab, ob dieselbe Krankheit bzw. dieselbe Grunderkrankung vorliegt.',
            reasons: ['Gleiche Krankheit ist unklar.', 'Diagnosedaten liegen dem Arbeitgeber regelmaessig nicht vor.'],
            next: ['Bei gesetzlich Versicherten Krankenkassenpruefung zu Vorerkrankungen einleiten.', 'Bei privat Versicherten Nachweis durch Arbeitnehmer klaeren.']
          };
        }
        if (a.sameDisease === 'no') {
          reasons.push('Fruehere AU beruht nicht auf derselben Krankheit.');
          return buildPositiveResult(a, reasons, next);
        }
        if (a.sixMonths === 'yes') {
          reasons.push('Mindestens sechs Monate keine AU wegen derselben Krankheit.');
          return buildPositiveResult(a, reasons, next);
        }
        if (a.sixMonths === 'unknown' || !a.sixMonths) {
          return {
            status: 'kk-pruefung',
            headline: 'Ergebnis: Sechs-Monats-Frist noch unklar.',
            reason: 'Es muss geklaert werden, ob vor der erneuten AU mindestens sechs Monate keine AU wegen derselben Krankheit bestand.',
            reasons: ['Gleiche Krankheit moeglich.', '6-Monats-Frist nicht sicher beantwortet.'],
            next: ['AU-Zeiten der letzten sechs Monate bezogen auf dieselbe Krankheit pruefen.']
          };
        }
        if (a.twelveMonths === 'yes') {
          reasons.push('Seit Beginn der ersten AU wegen derselben Krankheit sind mindestens zwoelf Monate vergangen.');
          return buildPositiveResult(a, reasons, next);
        }
        if (a.twelveMonths === 'unknown' || !a.twelveMonths) {
          return {
            status: 'kk-pruefung',
            headline: 'Ergebnis: 12-Monats-Frist noch unklar.',
            reason: 'Wenn die 6-Monats-Frist keinen neuen Anspruch ergibt, muss die 12-Monats-Frist geprueft werden.',
            reasons: ['Gleiche Krankheit liegt nahe.', '12-Monats-Frist nicht sicher beantwortet.'],
            next: ['Beginn der ersten AU wegen derselben Krankheit feststellen.']
          };
        }
        if (a.usedDays === 'exhausted') {
          return {
            status: 'kein-rest',
            headline: 'Ergebnis: Kein weiterer EFZ-Anspruch fuer diese Fortsetzungserkrankung.',
            reason: 'Die sechs Wochen wurden fuer dieselbe Krankheit bereits ausgeschoepft und weder 6-Monats- noch 12-Monats-Frist eroeffnen einen neuen Anspruch.',
            reasons: ['Fortsetzungserkrankung.', '42 Kalendertage bereits verbraucht.'],
            next: ['Krankengeld bzw. weitere sozialversicherungsrechtliche Schritte pruefen.']
          };
        }
        if (a.usedDays === 'partial') {
          return {
            status: 'teilweise',
            headline: 'Ergebnis: Entgeltfortzahlung nur noch fuer Resttage.',
            reason: 'Bei Fortsetzungserkrankung werden die AU-Zeiten zusammengerechnet. Es bleiben nur die noch nicht verbrauchten Tage bis 42 Kalendertage.',
            reasons: ['Gleiche Krankheit.', 'Kein neuer voller Sechs-Wochen-Zeitraum.', 'Tage wurden teilweise verbraucht.'],
            next: ['Bisherige EFZ-Tage exakt zaehlen.', 'Restanspruch berechnen.']
          };
        }
        if (a.usedDays === 'unknown' || !a.usedDays) {
          return {
            status: 'kk-pruefung',
            headline: 'Ergebnis: Restanspruch muss berechnet werden.',
            reason: 'Bei Fortsetzungserkrankung ist entscheidend, wie viele der 42 Kalendertage schon verbraucht sind.',
            reasons: ['Fortsetzungserkrankung moeglich.', 'Verbrauchte Tage unklar.'],
            next: ['Vor-AU-Zeiten und bereits geleistete Entgeltfortzahlung auswerten.']
          };
        }
      }

      if (a.priorAu === 'no') reasons.push('Keine bekannten Vorerkrankungen.');
      return buildPositiveResult(a, reasons, next);
    };

    function buildPositiveResult(a, reasons, next) {
      const headline = a.currentDuration === 'over42'
        ? 'Ergebnis: Anspruch dem Grunde nach, aber nur bis sechs Wochen.'
        : 'Ergebnis: Entgeltfortzahlung ist wahrscheinlich moeglich.';
      const reason = a.currentDuration === 'over42'
        ? 'Die Grundvoraussetzungen sprechen fuer Entgeltfortzahlung, der gesetzliche Zeitraum ist aber auf 42 Kalendertage begrenzt. Danach kommt regelmaessig Krankengeld in Betracht.'
        : 'Die Grundvoraussetzungen sind nach den Angaben erfuellt. Ohne anrechenbare Vorerkrankung besteht der Anspruch grundsaetzlich bis zu sechs Wochen.';
      if (a.currentDuration === 'ongoing' || a.currentDuration === 'unknown' || !a.currentDuration) {
        next.push('Dauer der aktuellen AU weiter beobachten und bei Ueberschreiten von 42 Tagen Krankengeld pruefen.');
      }
      return {
        status: a.currentDuration === 'over42' ? 'begrenzt' : 'moeglich',
        headline,
        reason,
        reasons,
        next
      };
    }

    app.logic.buildEfzHtml = (result) => {
      const reasons = (result.reasons || []).filter(Boolean);
      const next = (result.next || []).filter(Boolean);
      const renderList = (items) => items.length
        ? `<ol>${items.map((item) => `<li>${safeText(item)}</li>`).join('')}</ol>`
        : '<p>Keine weiteren Punkte offen.</p>';
      return `
        <h2>${safeText(result.headline || 'Ergebnis: Entgeltfortzahlung pruefen.')}</h2>
        <p>${safeText(result.reason || '')}</p>
        <h3>Begruendung</h3>
        ${renderList(reasons)}
        <h3>Was jetzt?</h3>
        ${renderList(next)}
        <p><strong>Merksatz:</strong> Erst Grundanspruch pruefen, dann 42 Tage zaehlen, dann Vorerkrankungen nur bei derselben Krankheit anrechnen.</p>
      `.trim();
    };

    app.logic.finishEfzCheck = () => {
      const result = app.logic.evaluateEfzCheck();
      const summary = app.logic.buildEfzQuestionAnswerSummary();
      if (summary) app.logic.appendUserMessage(summary, { module: MODULE, stage: 'summary' });
      app.logic.appendAssistantMessage(
        app.logic.buildEfzHtml(result),
        { module: MODULE, status: result.status, domain: 'SOZIALRECHT' },
        EFZ_SOURCES
      );
      app.logic.closeEfzCheck({ save: false });
      app.ui.scrollBottom();
      app.utils.save();
    };

    const originalSendMessage = app.logic.sendMessage.bind(app.logic);
    app.logic.sendMessage = (opts = {}) => {
      const forcedText = String(opts && opts.textOverride ? opts.textOverride : '').trim();
      const text = forcedText || String(app.ui.input?.value || '').trim();
      if (state.active) {
        if (!forcedText && app.ui.input) {
          app.ui.input.value = '';
          app.ui.input.dispatchEvent(new Event('input'));
        }
        app.logic.answerEfzCheckStep(text, { freeText: true, source: 'chat' });
        return;
      }
      if (text && app.state.consentGiven && app.logic.detectEfzIntent(text)) {
        if (!forcedText && app.ui.input) {
          app.ui.input.value = '';
          app.ui.input.dispatchEvent(new Event('input'));
        }
        app.logic.openEfzCheck({
          source: 'keyword',
          promptText: text,
          introText: app.logic.buildEfzIntroText()
        });
        return;
      }
      return originalSendMessage(opts);
    };

    const originalPrompting = app.logic.getPromptingSuggestions
      ? app.logic.getPromptingSuggestions.bind(app.logic)
      : null;
    if (originalPrompting) {
      app.logic.getPromptingSuggestions = (inputValue) => {
        const suggestions = originalPrompting(inputValue) || [];
        const t = normalize(inputValue);
        if (/\b(entgelt|lohnfortzahlung|vorerkrank|efzg|arbeitsunfaehigkeit)\b/.test(t)) {
          suggestions.unshift({
            label: 'Entgeltfortzahlung pruefen',
            value: 'Entgeltfortzahlung pruefen',
            kind: 'Modul'
          });
        }
        return suggestions
          .filter((item, idx, arr) => arr.findIndex((x) => x.value === item.value) === idx)
          .slice(0, 8);
      };
    }

    if (app.ui.clarifyDock) {
      app.ui.clarifyDock.addEventListener('click', (event) => {
        if (!state.active) return;
        const closeBtn = event.target.closest('[data-efz-cancel]');
        if (closeBtn) {
          event.preventDefault();
          app.logic.closeEfzCheck({ save: true });
          return;
        }
        const backBtn = event.target.closest('[data-efz-back]');
        if (backBtn && !backBtn.disabled) {
          event.preventDefault();
          app.logic.goBackEfzCheckStep();
          return;
        }
        const optionBtn = event.target.closest('[data-efz-option]');
        if (optionBtn) {
          event.preventDefault();
          const value = String(optionBtn.getAttribute('data-efz-option') || '').trim();
          if (value) app.logic.answerEfzCheckStep(value);
          return;
        }
        const skipBtn = event.target.closest('[data-efz-skip]');
        if (skipBtn) {
          event.preventDefault();
          app.logic.answerEfzCheckStep('', { skip: true });
          return;
        }
        const freeBtn = event.target.closest('[data-efz-free]');
        if (freeBtn) {
          event.preventDefault();
          const input = app.ui.clarifyDock.querySelector('[data-efz-free-input]');
          const value = String(input?.value || '').trim();
          if (!value) {
            alert('Bitte gib einen kurzen Hinweis ein oder waehle eine Option.');
            return;
          }
          app.logic.answerEfzCheckStep(value, { freeText: true });
        }
      }, true);

      app.ui.clarifyDock.addEventListener('keydown', (event) => {
        if (!state.active || event.key !== 'Enter') return;
        const input = event.target.closest('[data-efz-free-input]');
        if (!input) return;
        event.preventDefault();
        const value = String(input.value || '').trim();
        if (value) app.logic.answerEfzCheckStep(value, { freeText: true });
      }, true);
    }

    window.LINDA_EFZ_CHECK = {
      steps: STEPS,
      sources: EFZ_SOURCES,
      open: app.logic.openEfzCheck,
      evaluate: () => app.logic.evaluateEfzCheck()
    };
  }

  if (window.LINDA_APP) {
    init(window.LINDA_APP);
  } else {
    window.addEventListener('linda:app-ready', (event) => init(event.detail && event.detail.app), { once: true });
  }
})();
