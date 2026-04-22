/**
 * KI-Prüfungen Dialog Modul für Linda 2.0
 *
 * Trigger: User schreibt "KI Prüfungen" → separater Dialog-Flow
 * - Fragenbaum basierend auf Prüfer/Prüfling
 * - History abbrechen, Hinweis an User
 * - Qualitativ hochwertige Antworten via OpenAI
 *
 * Integration: Import im HTML, automatische Erkennung bei "KI Prüfungen"
 */

const KIPruefungen = (() => {
  // ============================================================
  // FRAGENBAUM – Basis-Struktur
  // ============================================================

  const questionTree = {
    // Start: Rolle abfragen
    start: {
      type: 'role_selection',
      question: '👤 Wer bist du in dieser Prüfungssituation?',
      options: [
        { label: 'Ich bin Prüfer', value: 'prufer', next: 'prufer_intro' },
        { label: 'Ich bin Prüfling', value: 'pruefling', next: 'pruefling_intro' }
      ]
    },

    // ============================================================
    // PRÜFER-FLOW
    // ============================================================
    prufer_intro: {
      type: 'info',
      message: 'Willkommen im KI-Prüfungs-Assistent für Prüfer. Ich helfe dir bei rechtlichen, didaktischen und organisatorischen Fragen zur KI-Nutzung in Prüfungen.',
      next: 'prufer_category'
    },

    prufer_category: {
      type: 'category',
      question: '📋 Welcher Bereich interessiert dich?',
      options: [
        { label: 'Rechtliche Fragen', value: 'prufer_legal', next: 'prufer_legal_q1' },
        { label: 'Didaktische Gestaltung', value: 'prufer_didactic', next: 'prufer_didactic_q1' },
        { label: 'KI-Erkennung & Authentizität', value: 'prufer_detection', next: 'prufer_detection_q1' },
        { label: 'Sicherheit & Datenschutz', value: 'prufer_security', next: 'prufer_security_q1' }
      ]
    },

    // PRÜFER – RECHTLICH
    prufer_legal_q1: {
      type: 'question',
      question: 'Hast du Fragen zur Verantwortung für KI-generierte Inhalte, zur Kommunikation mit Studierenden oder zu regulatorischen Vorgaben?',
      systemPrompt: `Du bist ein Experte für rechtliche Fragen rund um KI in Prüfungen.
      Bezug zu: Verantwortlichkeit, Haftung, DSGVO, Transparenzpflichten, institutionelle Richtlinien.
      Basiere deine Antwort auf aktuellen Best Practices und rechtlichen Standards.
      Sei konkret, aber weise auf lokale Unterschiede hin.`,
      next: 'prufer_followup'
    },

    // PRÜFER – DIDAKTIK
    prufer_didactic_q1: {
      type: 'question',
      question: 'Wie kannst du KI in deine Prüfungsgestaltung sinnvoll einbinden? (z.B. Prüfungsdesign, Aufgabentypen, Kompetenzabfrage)',
      systemPrompt: `Du bist ein Experte für Didaktik und Prüfungsgestaltung mit KI.
      Fokus: Wie KI die Prüfung verbessert (nicht ersetzt), ohne Kompetenzabfrage zu gefährden.
      Gib konkrete Beispiele für innovative Aufgabentypen.
      Berücksichtige: Assessment of Learning, Feedback-Schleifen, Formatvarianten.`,
      next: 'prufer_followup'
    },

    // PRÜFER – ERKENNUNG
    prufer_detection_q1: {
      type: 'question',
      question: 'Wie erkennst du, ob ein Prüfling KI genutzt hat? Welche Strategien und Tools helfen dir?',
      systemPrompt: `Du bist Experte für KI-Erkennung in Prüfungsleistungen.
      Themen: Stilistische Marker, technische Strategien, holistisches Assessment, Verdachtsindikatoren.
      Sei realistisch: KI ist schwer zu erkennen, menschliches Urteil bleibt zentral.
      Gib praktische Handreichungen für Prüfer.`,
      next: 'prufer_followup'
    },

    // PRÜFER – SICHERHEIT
    prufer_security_q1: {
      type: 'question',
      question: 'Wie schützt du sensible Prüfungsdaten, wenn KI-Tools eingesetzt werden?',
      systemPrompt: `Du bist Experte für Datenschutz & IT-Sicherheit in Prüfungen.
      Fokus: DSGVO, Cloud vs. On-Premise, Datenlecks, Prüfungsintegrität, Vertragsdesign mit KI-Anbietern.
      Sei konkret in deinen Empfehlungen (nicht nur abstrakt).`,
      next: 'prufer_followup'
    },

    // PRÜFER – Follow-up
    prufer_followup: {
      type: 'followup',
      question: 'Möchtest du eine Vertiefungsfrage oder ein anderes Thema?',
      options: [
        { label: 'Weiteres Thema im Bereich Prüfer', value: 'back', next: 'prufer_category' },
        { label: 'Neuen Chat starten', value: 'exit', next: 'exit' }
      ]
    },

    // ============================================================
    // PRÜFLING-FLOW
    // ============================================================
    pruefling_intro: {
      type: 'info',
      message: 'Willkommen im KI-Prüfungs-Assistent für Prüflinge. Ich helfe dir, KI verantwortungsvoll und integer in deiner Ausbildung einzusetzen.',
      next: 'pruefling_category'
    },

    pruefling_category: {
      type: 'category',
      question: '📋 Welcher Bereich interessiert dich?',
      options: [
        { label: 'Rechtliche & Ethische Regeln', value: 'pruefling_rules', next: 'pruefling_rules_q1' },
        { label: 'Praktische Nutzung & Best Practice', value: 'pruefling_practice', next: 'pruefling_practice_q1' },
        { label: 'Transparenz & Kennzeichnung', value: 'pruefling_disclosure', next: 'pruefling_disclosure_q1' },
        { label: 'Akademische Integrität', value: 'pruefling_integrity', next: 'pruefling_integrity_q1' }
      ]
    },

    // PRÜFLING – REGELN
    pruefling_rules_q1: {
      type: 'question',
      question: 'Welche Regeln und Vorgaben gelten für meine Nutzung von KI? Was ist erlaubt, was nicht?',
      systemPrompt: `Du bist Experte für rechtliche & ethische Regeln rund um KI-Nutzung in Ausbildung/Prüfungen.
      Gib konkrete Hinweise zu: Instituts-Richtlinien, Plagiarismus-Definitionen, Verantwortlichkeit des Lernenden.
      Sei fair: Erkläre, dass Kontexte unterschiedlich sind (wissenschaftliche Arbeit ≠ Prüfung ≠ Hausaufgabe).
      Warnung vor Konsequenzen ohne Angst zu schüren.`,
      next: 'pruefling_followup'
    },

    // PRÜFLING – PRAXIS
    pruefling_practice_q1: {
      type: 'question',
      question: 'Wie nutze ich KI am besten, um meine Kompetenzen zu entwickeln (nicht nur Aufgaben zu lösen)?',
      systemPrompt: `Du bist Experte für sinnvolle KI-Nutzung im Lernprozess.
      Fokus: KI als Lernwerkzeug, nicht als Lösungsmaschine. Brainstorming, Feedback-Loops, Reflexion.
      Gib konkrete Beispiele: "Nutze KI, um X zu tun, dann selbst Y überprüfen."
      Erkläre, wie das deine Kompetenzen stärkt.`,
      next: 'pruefling_followup'
    },

    // PRÜFLING – TRANSPARENZ
    pruefling_disclosure_q1: {
      type: 'question',
      question: 'Wie kennzeichne ich KI-Nutzung in meiner Arbeit/Präsentation richtig?',
      systemPrompt: `Du bist Experte für Transparenz & Kennzeichnung von KI-Nutzung.
      Gib konkrete Anleitung: Wo in der Arbeit wird es dokumentiert? Fußnoten, Anhang, Metadaten?
      Verschiedene Kontexte: schriftliche Arbeit, Präsentation, Code, Grafiken.
      Biete Muster/Vorlagen an (kurz).`,
      next: 'pruefling_followup'
    },

    // PRÜFLING – INTEGRITÄT
    pruefling_integrity_q1: {
      type: 'question',
      question: 'Wie stelle ich sicher, dass meine Arbeit akademisch integer ist, auch wenn ich KI nutze?',
      systemPrompt: `Du bist Experte für akademische Integrität im Zeitalter von KI.
      Themen: Urheberrecht, KI-Output-Qualität prüfen, eigenes Urteil bewahren, kritisches Denken.
      Erkläre die Grenzlinie zwischen "KI als Werkzeug" und "KI als Ersatz für Denken".
      Sei konstruktiv, nicht moralisierend.`,
      next: 'pruefling_followup'
    },

    // PRÜFLING – Follow-up
    pruefling_followup: {
      type: 'followup',
      question: 'Möchtest du eine Vertiefungsfrage oder ein anderes Thema?',
      options: [
        { label: 'Weiteres Thema im Bereich Prüfling', value: 'back', next: 'pruefling_category' },
        { label: 'Neuen Chat starten', value: 'exit', next: 'exit' }
      ]
    },

    // Exit
    exit: {
      type: 'exit',
      message: null // wird in send() behandelt
    }
  };

  // ============================================================
  // DETECTION & INTEGRATION
  // ============================================================

  /**
   * Erkennt, ob User "KI Prüfungen" eingegeben hat
   */
  function detectTrigger(text) {
    const normalized = text.toLowerCase().trim();
    return /\bki\s+prüfungen?\b|\bki-prüfungen?\b/.test(normalized);
  }

  /**
   * Initialisiert den KI-Prüfungen Flow
   * - Setzt neue Session
   * - Zeigt History-Abbruch Hinweis
   * - Startet Fragenbaum
   */
  function initFlow(onReady) {
    const hinweis = `🔄 **Neuer Dialog: KI-Prüfungen**\n\nDu startest einen speziellen Dialog zu KI in Prüfungen. Der bisherige Chat-Verlauf wird nicht berücksichtigt – du beginnst mit einer frischen Sitzung. Das hilft uns, fokussiert und strukturiert die Fragen zu klären.\n\nLos geht's:`;

    // Callback mit Hinweis + erste Frage
    if (onReady) {
      onReady({
        hinweis: hinweis,
        nodeId: 'start',
        node: questionTree.start
      });
    }
  }

  /**
   * Rendert einen Knoten basierend auf Typ
   */
  function renderNode(nodeId, node) {
    if (!node) return null;

    switch (node.type) {
      case 'role_selection':
      case 'category':
        return {
          type: 'choice',
          text: node.question,
          options: node.options
        };

      case 'question':
        return {
          type: 'question',
          text: node.question,
          systemPrompt: node.systemPrompt,
          nextNode: node.next
        };

      case 'info':
        return {
          type: 'info',
          text: node.message,
          nextNode: node.next
        };

      case 'followup':
        return {
          type: 'choice',
          text: node.question,
          options: node.options
        };

      case 'exit':
        return { type: 'exit' };

      default:
        return null;
    }
  }

  /**
   * Navigiert zum nächsten Knoten
   */
  function getNextNode(optionValue) {
    for (const [key, node] of Object.entries(questionTree)) {
      if (node.options) {
        const opt = node.options.find(o => o.value === optionValue);
        if (opt) {
          return { nodeId: opt.next, node: questionTree[opt.next] };
        }
      }
    }
    return null;
  }

  /**
   * Public API
   */
  return {
    detect: detectTrigger,
    init: initFlow,
    render: renderNode,
    next: getNextNode,
    tree: questionTree
  };
})();

// ============================================================
// EXPORT für HTML-Integration
// ============================================================
if (typeof window !== 'undefined') {
  window.KIPruefungen = KIPruefungen;
}

// Node.js Export (falls benötigt)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KIPruefungen;
}
