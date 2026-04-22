/**
 * KI-Prüfungen Dialog Manager
 *
 * Verwaltet den kompletten Dialog-Flow für KI-Prüfungen
 * - Lokale Navigation durch Fragenbaum
 * - Saubere UI-Anzeige
 * - Nur echte Fragen gehen an Make
 */

const KIPruefungenDialog = (() => {
  let currentNodeId = null;
  let currentRole = null;
  let isActive = false;
  let currentQuestionContext = null; // Speichert Kontext, wenn wir bei einer Question sind

  // ============================================================
  // FRAGENBAUM
  // ============================================================

  const tree = {
    start: {
      type: 'choice',
      title: '👤 Wer bist du?',
      description: 'Bitte wähle deine Rolle aus:',
      options: [
        { label: 'Ich bin Prüfer', value: 'prufer', next: 'prufer_menu' },
        { label: 'Ich bin Prüfling', value: 'pruefling', next: 'pruefling_menu' }
      ]
    },

    // ============================================================
    // PRÜFER-FLOW
    // ============================================================

    prufer_menu: {
      type: 'choice',
      title: '📋 Prüfer – Welcher Bereich?',
      description: 'Wähle das Thema, das dich interessiert:',
      options: [
        { label: '⚖️ Rechtliche Fragen', value: 'prufer_legal', action: 'question' },
        { label: '📚 Didaktische Gestaltung', value: 'prufer_didactic', action: 'question' },
        { label: '🔍 KI-Erkennung & Authentizität', value: 'prufer_detection', action: 'question' },
        { label: '🔐 Sicherheit & Datenschutz', value: 'prufer_security', action: 'question' }
      ]
    },

    prufer_legal: {
      type: 'question',
      title: '⚖️ Rechtliche Fragen zu KI in Prüfungen',
      prompt: 'Hast du Fragen zur Verantwortung für KI-generierte Inhalte, zur Kommunikation mit Studierenden oder zu regulatorischen Vorgaben?',
      systemContext: 'Du bist Experte für rechtliche Fragen rund um KI in Prüfungen: Verantwortlichkeit, Haftung, DSGVO, Transparenzpflichten, institutionelle Richtlinien. Sei konkret, aber weise auf lokale Unterschiede hin.'
    },

    prufer_didactic: {
      type: 'question',
      title: '📚 Didaktische Gestaltung mit KI',
      prompt: 'Wie kannst du KI in deine Prüfungsgestaltung sinnvoll einbinden (z.B. Prüfungsdesign, Aufgabentypen, Kompetenzabfrage)?',
      systemContext: 'Du bist Experte für Didaktik und Prüfungsgestaltung mit KI. Fokus: Wie KI die Prüfung verbessert, ohne Kompetenzabfrage zu gefährden. Gib konkrete Beispiele für innovative Aufgabentypen.'
    },

    prufer_detection: {
      type: 'question',
      title: '🔍 KI-Erkennung & Authentizität',
      prompt: 'Wie erkennst du, ob ein Prüfling KI genutzt hat? Welche Strategien und Tools helfen dir?',
      systemContext: 'Du bist Experte für KI-Erkennung in Prüfungsleistungen. Themen: Stilistische Marker, technische Strategien, holistisches Assessment. Sei realistisch: KI ist schwer zu erkennen. Gib praktische Handreichungen.'
    },

    prufer_security: {
      type: 'question',
      title: '🔐 Sicherheit & Datenschutz',
      prompt: 'Wie schützt du sensible Prüfungsdaten, wenn KI-Tools eingesetzt werden?',
      systemContext: 'Du bist Experte für Datenschutz & IT-Sicherheit in Prüfungen. Fokus: DSGVO, Cloud vs. On-Premise, Datenlecks, Prüfungsintegrität, Vertragsdesign. Sei konkret in deinen Empfehlungen.'
    },

    // ============================================================
    // PRÜFLING-FLOW
    // ============================================================

    pruefling_menu: {
      type: 'choice',
      title: '📋 Prüfling – Welcher Bereich?',
      description: 'Wähle das Thema, das dich interessiert:',
      options: [
        { label: '⚖️ Rechtliche & Ethische Regeln', value: 'pruefling_rules', action: 'question' },
        { label: '📚 Praktische Nutzung & Best Practice', value: 'pruefling_practice', action: 'question' },
        { label: '📝 Transparenz & Kennzeichnung', value: 'pruefling_disclosure', action: 'question' },
        { label: '✅ Akademische Integrität', value: 'pruefling_integrity', action: 'question' }
      ]
    },

    pruefling_rules: {
      type: 'question',
      title: '⚖️ Rechtliche & Ethische Regeln',
      prompt: 'Welche Regeln und Vorgaben gelten für meine Nutzung von KI? Was ist erlaubt, was nicht?',
      systemContext: 'Du bist Experte für rechtliche & ethische Regeln rund um KI-Nutzung in Ausbildung. Gib konkrete Hinweise zu: Instituts-Richtlinien, Plagiarismus-Definitionen, Verantwortlichkeit. Erkläre, dass Kontexte unterschiedlich sind.'
    },

    pruefling_practice: {
      type: 'question',
      title: '📚 Praktische Nutzung & Best Practice',
      prompt: 'Wie nutze ich KI am besten, um meine Kompetenzen zu entwickeln (nicht nur Aufgaben zu lösen)?',
      systemContext: 'Du bist Experte für sinnvolle KI-Nutzung im Lernprozess. Fokus: KI als Lernwerkzeug, nicht als Lösungsmaschine. Gib konkrete Beispiele, wie das Kompetenzen stärkt.'
    },

    pruefling_disclosure: {
      type: 'question',
      title: '📝 Transparenz & Kennzeichnung',
      prompt: 'Wie kennzeichne ich KI-Nutzung in meiner Arbeit/Präsentation richtig?',
      systemContext: 'Du bist Experte für Transparenz & Kennzeichnung von KI-Nutzung. Gib konkrete Anleitung: Wo wird dokumentiert (Fußnoten, Anhang, Metadaten)? Verschiedene Kontexte: schriftliche Arbeit, Präsentation, Code, Grafiken.'
    },

    pruefling_integrity: {
      type: 'question',
      title: '✅ Akademische Integrität',
      prompt: 'Wie stelle ich sicher, dass meine Arbeit akademisch integer ist, auch wenn ich KI nutze?',
      systemContext: 'Du bist Experte für akademische Integrität im Zeitalter von KI. Themen: Urheberrecht, KI-Output-Qualität prüfen, eigenes Urteil bewahren, kritisches Denken. Erkläre die Grenzlinie zwischen Werkzeug und Ersatz.'
    }
  };

  // ============================================================
  // ÖFFENTLICHE METHODEN
  // ============================================================

  function detect(text) {
    return /\bki\s+prüfungen?\b|\bki-prüfungen?\b/i.test(text.trim());
  }

  function start(callbacks) {
    isActive = true;
    currentNodeId = 'start';
    currentRole = null;

    // Callback zum Rendern
    if (callbacks && callbacks.onRender) {
      renderNode('start', callbacks.onRender);
    }
  }

  function handleUserInput(userText, callbacks) {
    if (!isActive) return false;

    const node = tree[currentNodeId];
    if (!node) return false;

    // ============================================================
    // CHOICE-KNOTEN: User wählt Option
    // ============================================================
    if (node.type === 'choice' && node.options) {
      const textLower = userText.toLowerCase().trim();
      let matchedOption = null;

      // Versuche auf verschiedene Weisen zu matchen
      for (let i = 0; i < node.options.length; i++) {
        const opt = node.options[i];
        const optionLetter = String.fromCharCode(97 + i); // a, b, c, d...

        // Match 1: Buchstabe (a, b, c, d)
        if (textLower === optionLetter) {
          matchedOption = opt;
          break;
        }
        // Match 2: Buchstabe mit Klammer (a), b), c), d))
        if (textLower === `${optionLetter})` || textLower === `${optionLetter})`  ) {
          matchedOption = opt;
          break;
        }
        // Match 3: Label-Text
        if (textLower.includes(opt.label.toLowerCase())) {
          matchedOption = opt;
          break;
        }
        // Match 4: Value direkt
        if (textLower === opt.value || textLower.includes(opt.value)) {
          matchedOption = opt;
          break;
        }
      }

      if (matchedOption) {
        // Rolle speichern
        if (currentNodeId === 'start') {
          currentRole = matchedOption.value;
        }

        // Nächster Knoten
        currentNodeId = matchedOption.next || matchedOption.value;
        const nextNode = tree[currentNodeId];

        if (!nextNode) return false;

        // Wenn nächster Knoten eine QUESTION ist → zeige Prompt, warte auf echte Antwort
        if (nextNode.type === 'question') {
          currentQuestionContext = {
            nodeId: currentNodeId,
            role: currentRole,
            category: currentNodeId,
            systemContext: nextNode.systemContext,
            prompt: nextNode.prompt
          };

          // Zeige die Prompt-Frage an
          if (callbacks && callbacks.onRender) {
            callbacks.onRender({
              type: 'question',
              nodeId: currentNodeId,
              title: nextNode.title,
              prompt: nextNode.prompt
            });
          }
          return true;
        }

        // Sonst: Nächste Choice anzeigen
        if (callbacks && callbacks.onRender) {
          renderNode(currentNodeId, callbacks.onRender);
        }
        return true;
      }
    }

    // ============================================================
    // QUESTION-KNOTEN: User stellt echte Frage
    // ============================================================
    if (node.type === 'question' && currentQuestionContext) {
      // User hat eine echte Frage eingegeben → zu Make senden
      return {
        action: 'sendToMake',
        userQuestion: userText,
        role: currentQuestionContext.role,
        category: currentQuestionContext.category,
        systemContext: currentQuestionContext.systemContext,
        callbacks
      };
    }

    return false;
  }

  function renderNode(nodeId, onRender) {
    const node = tree[nodeId];
    if (!node) return;

    if (node.type === 'choice') {
      onRender({
        type: 'choice',
        nodeId,
        title: node.title,
        description: node.description,
        options: node.options.map(opt => ({
          label: opt.label,
          value: opt.value
        }))
      });
    } else if (node.type === 'question') {
      onRender({
        type: 'question',
        nodeId,
        title: node.title,
        prompt: node.prompt,
        systemContext: node.systemContext
      });
    }
  }

  function isDialogActive() {
    return isActive;
  }

  function getCurrentRole() {
    return currentRole;
  }

  function exit() {
    isActive = false;
    currentNodeId = null;
    currentRole = null;
    currentQuestionContext = null;
  }

  // ============================================================
  // EXPORT
  // ============================================================

  return {
    detect,
    start,
    handleUserInput,
    renderNode,
    isActive: isDialogActive,
    getCurrentRole,
    exit,
    tree
  };
})();

// Für HTML-Integration
if (typeof window !== 'undefined') {
  window.KIPruefungenDialog = KIPruefungenDialog;
}

// Node.js Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KIPruefungenDialog;
}
