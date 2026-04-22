/**
 * KI-Prüfungen Form – Strukturiertes Multi-Step Formular mit Cluster-Fragen
 *
 * Flow:
 * 1. Rolle wählen (Prüfer / Prüfling)
 * 2. Kontext wählen (abhängig von Rolle)
 * 3. Kernfrage wählen (aus Cluster-Fragen oder "Sonstige Frage")
 * 4. Bei "Sonstige Frage": Freie Text-Eingabe
 * 5. Fertig → an Make senden mit Codes + kontextualisierter Beschreibung
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
  // DATEN: Kontexte und Cluster-Fragen je Rolle
  // ============================================================

  const formData = {
    prufer: {
      contexts: [
        { id: 'ihk', label: 'IHK-Abschlussprüfung (z.B. Personalfachkaufleute)' },
        { id: 'berufsschule', label: 'Berufsschule / schulische Prüfung' },
        { id: 'hochschule', label: 'Hochschule / Universität' },
        { id: 'innerbetrieb', label: 'Innerbetriebliche Prüfung / Assessment' }
      ],
      questions: [
        {
          id: 'q1',
          label: 'KI-Einsatz in Prüfungsvorbereitung und -gestaltung',
          description: 'Wie nutze ich KI sinnvoll bei der Vorbereitung und Gestaltung von Prüfungen?'
        },
        {
          id: 'q2',
          label: 'Bewertung und Benotung durch / mit KI',
          description: 'Darf KI Prüfungsleistungen bewerten oder benoten? Wo liegen die Grenzen?'
        },
        {
          id: 'q3',
          label: 'Verantwortung und Haftung bei KI-Einsatz',
          description: 'Wer haftet für KI-gestützte Prüfungen? Welche rechtlichen Verpflichtungen habe ich?'
        },
        {
          id: 'q4',
          label: 'Datenschutz und Transparenz in KI-Systemen',
          description: 'Wie schütze ich sensible Prüfungsdaten? Was muss ich über KI-Nutzung offenlegen?'
        },
        {
          id: 'q5',
          label: 'KI-Erkennung und Authentizität von Leistungen',
          description: 'Wie erkenne ich, ob ein Prüfling KI genutzt hat? Welche Strategien helfen mir?'
        }
      ]
    },

    pruefling: {
      contexts: [
        { id: 'abschlussprüfung', label: 'Vorbereitung Abschlussprüfung' },
        { id: 'präsentation', label: 'Vorbereitung Präsentation' },
        { id: 'projektarbeit', label: 'Vorbereitung Projektarbeit' },
        { id: 'report', label: 'Vorbereitung Report / Dokumentation' }
      ],
      questions: [
        {
          id: 'q1',
          label: 'KI-Nutzung für Recherche und Brainstorming',
          description: 'Darf ich KI für Recherche und Ideenfindung nutzen? Wo sind die Grenzen?'
        },
        {
          id: 'q2',
          label: 'KI-Nutzung bei Erstellung von Drafts und Dokumentation',
          description: 'Kann ich KI für erste Entwürfe und Dokumentationen nutzen? Was muss ich beachten?'
        },
        {
          id: 'q3',
          label: 'Kennzeichnung und Transparenzpflichten',
          description: 'Wie und wo muss ich KI-Nutzung dokumentieren? Was ist ausreichend?'
        },
        {
          id: 'q4',
          label: 'Akademische Integrität und institutionelle Regelwerke',
          description: 'Was sind die Regeln meiner Institution? Wie vermeide ich Plagiarismus?'
        },
        {
          id: 'q5',
          label: 'Risiken und Konsequenzen bei Verstößen',
          description: 'Was passiert, wenn ich KI gegen die Regeln nutze? Welche Konsequenzen drohen?'
        }
      ]
    }
  };

  // ============================================================
  // HILFSFUNKTIONEN: LABELS UND BESCHREIBUNGEN
  // ============================================================

  function getContextLabel(role, contextId) {
    const context = formData[role]?.contexts.find(c => c.id === contextId);
    return context ? context.label : contextId;
  }

  function getQuestionLabel(role, questionId) {
    const question = formData[role]?.questions.find(q => q.id === questionId);
    return question ? question.label : questionId;
  }

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
          label: c.label
        })),
        showOther: true
      };
    }

    if (step === 2) {
      // Step 3: Kernfrage wählen
      const questions = formData[data.role].questions;
      return {
        step: 3,
        type: 'modal',
        title: 'Was ist deine Kernfrage?',
        options: questions.map((q, idx) => ({
          id: q.id,
          label: q.label
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
  // KONTEXTUALISIERTE BESCHREIBUNG FÜR MAKE
  // ============================================================

  function buildContextDescription(formData) {
    const roleLabel = formData.role === 'prufer' ? 'Prüfer' : 'Prüfling';
    const contextLabel = getContextLabel(formData.role, formData.context);
    const questionLabel = formData.customQuestion
      ? formData.customQuestion
      : getQuestionLabel(formData.role, formData.question);

    return `${roleLabel} möchte zu KI-Prüfungen folgendes wissen:\n` +
           `Kontext: ${contextLabel}\n` +
           `Frage: ${questionLabel}`;
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
    getCurrentData: () => ({ ...data }),
    getContextLabel,
    getQuestionLabel,
    buildContextDescription
  };
})();

// Für HTML-Integration
if (typeof window !== 'undefined') {
  window.KIPruefungenForm = KIPruefungenForm;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KIPruefungenForm;
}
