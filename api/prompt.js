// prompts.js - Alle KI-Prompts für Linda Lernassistentin

const LindaPrompts = {
  // ==================== CHAT-PROMPTS ====================
  getChatPrompt: (question, fachmodus, history = []) => {
    const domainContext = {
      '': 'Antworte als freundliche Lernassistentin.',
      'AEVO': `Du bist ein AEVO-Experte (Ausbildereignungsverordnung). 
      Antworte präzise mit Bezug zu:
      - Berufsbildungsgesetz (BBiG)
      - Ausbilder-Eignungsverordnung
      - IHK-Prüfungsanforderungen
      - Praktischen Ausbildungssituationen`,
      
      'VWL': `Du bist ein Wirtschaftswissenschaftler.
      Antworte mit Bezug zu:
      - Volkswirtschaftlichen Grundlagen
      - Betriebswirtschaftlichen Konzepten
      - Aktuellen Wirtschaftsdaten
      - Prüfungsrelevanten Modellen`,
      
      'PERSONAL': `Du bist Personalexperte.
      Antworte mit Bezug zu:
      - Arbeitsrecht
      - Personalprozessen
      - HR-Instrumenten
      - Aktueller Rechtsprechung`
    };
    
    const context = domainContext[fachmodus] || domainContext[''];
    
    return `${context}

AUFBAU DEINER ANTWORT:
1. Kurze, direkte Antwort auf die Frage
2. Erklärung in einfacher Sprache
3. Praktische Beispiele (falls relevant)
4. Wichtige zu beachtende Punkte
5. QUellen/Literaturhinweise (falls vorhanden)

${history.length > 0 ? 'Vorheriger Kontext:\n' + history.map(h => `${h.role}: ${h.content}`).join('\n') + '\n\n' : ''}
AKTUELLE FRAGE: ${question}

ANTWORT:`;
  },

  // ==================== LERNKARTEN-PROMPTS ====================
  getFlashcardsPrompt: (question, answer, domain) => {
    const domainTemplates = {
      'AEVO': {
        categories: ['Rechtliche Grundlagen', 'Ausbildungsmethodik', 'Prüfungsvorbereitung', 'Praxisbeispiele'],
        focus: 'Gesetze, Verordnungen, Handlungsanleitungen, IHK-Anforderungen'
      },
      'VWL': {
        categories: ['Theorien & Modelle', 'Wirtschaftsbegriffe', 'Berechnungen', 'Zusammenhänge'],
        focus: 'Definitionen, Formeln, Grafiken, aktuelle Daten'
      },
      'PERSONAL': {
        categories: ['Arbeitsrecht', 'Personalprozesse', 'Kommunikation', 'Dokumentation'],
        focus: 'Gesetze, Checklisten, Formulare, Fallbeispiele'
      },
      '': {
        categories: ['Kernkonzepte', 'Definitionen', 'Anwendungen', 'Beispiele'],
        focus: 'Wesentliche Inhalte, prüfungsrelevante Punkte'
      }
    };
    
    const template = domainTemplates[domain] || domainTemplates[''];
    
    return `DU BIST EIN EXPERTE FÜR LERNKARTEN-ERSTELLUNG FACHBEREICH: ${domain || 'Allgemein'}

AUFGABE: Erstelle 8 hochwertige Lernkarten aus folgender Frage und Antwort.

QUALITÄTSANFORDERUNGEN:
1. Jede Karte muss EIN abgeschlossenes Lernziel enthalten
2. FRONT: Maximal 12 Wörter (klare Frage oder zentraler Begriff)
3. BACK: Maximal 40 Wörter (präzise, prüfungsrelevante Erklärung)
4. Vermeide Wiederholungen zwischen Karten
5. Nutze Fachsprache korrekt
6. Strukturiere komplexe Inhalte in verdaubare Häppchen

FACHSPEZIFISCHE FOKUSPUNKTE für ${domain}:
- ${template.focus}

KATEGORIEN für die Karten:
${template.categories.map(cat => `- ${cat}`).join('\n')}

FORMAT: Gib AUSSCHLIESSLICH dieses JSON zurück (KEIN Markdown, KEIN zusätzlicher Text):

{
  "deck_title": "Kurzer, prägnanter Titel (max. 6 Wörter)",
  "cards": [
    {
      "front": "Hier die Vorderseite",
      "back": "Hier die präzise Rückseite",
      "tag": "${domain || 'Standard'}",
      "level": 1,
      "category": "Eine der oben genannten Kategorien"
    }
  ]
}

EINGABE:
FRAGE: ${question}

ANTWORT: ${answer}
---ENDE DER EINGABE---
Gib NUR das JSON-Objekt zurück:`;
  },

  // ==================== QUALITÄTS-CHECK PROMPT ====================
  getQualityCheckPrompt: (deckJson, domain) => {
    return `QUALITÄTSKONTROLLE FÜR LERNKARTEN (${domain})

Überprüfe diese Lernkarten auf:
1. FACHLICHE RICHTIGKEIT - Stimmen alle Aussagen?
2. KLARHEIT - Sind Formulierungen verständlich?
3. VOLLSTÄNDIGKEIT - Fehlen wichtige Aspekte?
4. PRÜFUNGSRELEVANZ - Sind die Inhalte prüfungsrelevant?
5. REDUNDANZEN - Gibt es Wiederholungen?

Gib für jede Karte eine Bewertung (1-5 Sterne) und ggf. Verbesserungsvorschläge.

Zu prüfendes Deck: ${JSON.stringify(deckJson, null, 2)}

Format der Rückmeldung:
{
  "overall_score": 0-100,
  "card_feedback": [
    {
      "card_index": 0,
      "score": 1-5,
      "suggestion": "Verbesserungsvorschlag"
    }
  ],
  "general_suggestions": ["Allgemeine Verbesserungen"]
}`;
  },

  // ==================== FEHLER-KORREKTUR PROMPT ====================
  getCorrectionPrompt: (incorrectCard, userCorrection, domain) => {
    return `FEHLERKORREKTUR FÜR LERNKARTE (${domain})

Eine Lernkarte wurde als fehlerhaft gemeldet.

ORIGINAL-KARTE:
Front: "${incorrectCard.front}"
Back: "${incorrectCard.back}"

VORGESCHLAGENE KORREKTUR VOM USER:
"${userCorrection}"

BITTE:
1. Überprüfe die fachliche Richtigkeit beider Versionen
2. Erstelle eine verbesserte, korrekte Version
3. Halte die Karte kurz und prägnant

Gib die korrigierte Karte in diesem Format zurück:
{
  "corrected_front": "Korrekte Vorderseite",
  "corrected_back": "Korrekte Rückseite",
  "explanation": "Kurze Erklärung der Korrektur"
}`;
  },

  // ==================== KURZ-CHECK FÜR API-LIMIT ====================
  getCompactFlashcardsPrompt: (question, answer, domain) => {
    // Minimal-Version für 2000-Zeichen-Limit
    return `Erstelle 8 Lernkarten als JSON:
{
  "deck_title": "Kurztitel",
  "cards": [
    {"front": "Frage", "back": "Antwort", "tag": "${domain}", "level": 1}
  ]
}

Frage: ${question.substring(0, 300)}
Antwort: ${answer.substring(0, 1000)}`;
  },

  // ==================== HELPER FUNCTIONS ====================
  truncateForAPI: (text, maxLength = 1900) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  },

  prepareForAPI: (promptType, data, options = {}) => {
    const { maxLength = 1900, domain = '' } = options;
    
    let prompt;
    switch(promptType) {
      case 'chat':
        prompt = this.getChatPrompt(data.question, domain, data.history);
        break;
      case 'flashcards':
        prompt = this.getFlashcardsPrompt(
          data.question.substring(0, 300),
          data.answer.substring(0, 1500),
          domain
        );
        break;
      case 'flashcards_compact':
        prompt = this.getCompactFlashcardsPrompt(
          data.question.substring(0, 200),
          data.answer.substring(0, 800),
          domain
        );
        break;
      default:
        throw new Error(`Unknown prompt type: ${promptType}`);
    }
    
    return this.truncateForAPI(prompt, maxLength);
  }
};

// Export für Browser (ohne Module System)
if (typeof window !== 'undefined') {
  window.LindaPrompts = LindaPrompts;
}
