/**
 * KI-Prüfungen Form – Strukturiertes Multi-Step Formular
 *
 * Flow:
 * 1. Rolle wählen (Prüfer / Prüfling)
 * 2. Kontext wählen (abhängig von Rolle)
 * 3. Kernfrage wählen (vordefiniert oder "Sonstige Frage")
 * 4. Bei "Sonstige Frage": Freie Text-Eingabe
 * 5. Fertig → an Make senden mit allen Daten
 */

const KIPruefungenForm = (() => {
  let step = 0;
  let data = {
    role: null,
    context: null,
    question: null,
    customQuestion: null
  };

  // ============================================================
  // DATEN: Kontexte und Fragen je Rolle
  // ============================================================

  const formData = {
    prufer: {
      contexts: [
        { id: 'ihk', label: 'IHK-Abschlussprüfung (z.B. Personalfachkaufleute)' },
        { id: 'berufsschule', label: 'Berufsschule / schulische Prüfung' },
        { id: 'hochschule', label: 'Hochschule / Universität' },
        { id: 'innerbetrieb', label: 'Innerbetriebliche Prüfung / Assessment' }
      ],
      questions: {
        default: [
          'Um welchen Prüfungskontext geht es konkret?',
          'Darf KI eigenständig bewerten / benoten?',
          'Darf KI prüfungsrelevante Daten verarbeiten?',
          'Wer haftet bei KI-gestützter Prüfung?',
          'Alle drei'
        ]
      }
    },
    pruefling: {
      contexts: [
        { id: 'abschlussprüfung', label: 'Vorbereitung Abschlussprüfung' },
        { id: 'präsentation', label: 'Vorbereitung Präsentation' },
        { id: 'projektarbeit', label: 'Vorbereitung Projektarbeit' },
        { id: 'report', label: 'Vorbereitung Report / Dokumentation' }
      ],
      questions: {
        default: [
          'Darf ich KI für Recherche nutzen?',
          'Darf ich KI für Drafts nutzen?',
          'Wie kennzeichne ich KI-Nutzung?',
          'Kann ich damit durchfallen?',
          'Alle drei'
        ]
      }
    }
  };

  // ============================================================
  // ÖFFENTLICHE METHODEN
  // ============================================================

  function detect(text) {
    return /\bki\s+prüfungen?\b|\bki-prüfungen?\b/i.test(text.trim());
  }

  function start() {
    step = 0;
    data = {
      role: null,
      context: null,
      question: null,
      customQuestion: null
    };
    return getStepContent();
  }

  function getStepContent() {
    if (step === 0) {
      // Step 1: Rolle wählen
      return {
        step: 1,
        type: 'modal',
        title: '👤 Wer bist du?',
        options: [
          { id: 'prufer', label: 'Ich bin Prüfer' },
          { id: 'pruefling', label: 'Ich bin Prüfling' }
        ]
      };
    }

    if (step === 1) {
      // Step 2: Kontext wählen
      const contexts = formData[data.role].contexts;
      return {
        step: 2,
        type: 'modal',
        title: 'Um welchen Prüfungskontext geht es konkret?',
        options: contexts.map((c, idx) => ({
          id: c.id,
          label: `${c.label}`
        })),
        showOther: true
      };
    }

    if (step === 2) {
      // Step 3: Kernfrage wählen
      const questions = formData[data.role].questions.default;
      return {
        step: 3,
        type: 'modal',
        title: 'Was ist deine Kernfrage?',
        options: questions.slice(0, -1).map((q, idx) => ({
          id: `q${idx}`,
          label: q
        })),
        showOther: true,
        otherLabel: 'Etwas anderes'
      };
    }

    if (step === 3 && data.question === 'custom') {
      // Step 4: Freie Text-Eingabe bei "Sonstige Frage"
      return {
        step: 4,
        type: 'text_input',
        title: 'Beschreibe deine Frage:',
        placeholder: 'Deine Frage hier eingeben...'
      };
    }

    return null;
  }

  function handleSelection(optionId) {
    if (step === 0) {
      // Rolle gewählt
      data.role = optionId;
      step = 1;
    } else if (step === 1) {
      // Kontext gewählt
      if (optionId === 'other') {
        data.context = 'custom';
      } else {
        data.context = optionId;
      }
      step = 2;
    } else if (step === 2) {
      // Frage gewählt
      if (optionId === 'other') {
        data.question = 'custom';
        step = 3;
      } else {
        data.question = optionId;
        return { complete: true, data };
      }
    }

    return { complete: false, nextStep: getStepContent() };
  }

  function handleTextInput(text) {
    if (step === 3 && data.question === 'custom') {
      data.customQuestion = text;
      return { complete: true, data };
    }
    return { complete: false };
  }

  function isDetected(text) {
    return detect(text);
  }

  function reset() {
    step = 0;
    data = {
      role: null,
      context: null,
      question: null,
      customQuestion: null
    };
  }

  // ============================================================
  // EXPORT
  // ============================================================

  return {
    detect,
    start,
    handleSelection,
    handleTextInput,
    getStepContent,
    isDetected,
    reset,
    getCurrentData: () => ({ ...data })
  };
})();

// Für HTML-Integration
if (typeof window !== 'undefined') {
  window.KIPruefungenForm = KIPruefungenForm;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KIPruefungenForm;
}
