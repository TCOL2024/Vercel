// prompts.js - KI-Prompts für Linda (Frontend-Version)
// Wird in HTML eingebunden: <script src="prompts.js"></script>

const LindaPrompts = {
  VERSION: '1.0',
  
  // ==================== CHAT-PROMPT GENERATOR ====================
  getChatPrompt: function(question, fachmodus = '', history = []) {
    const baseContext = {
      role: "system",
      content: `Du bist Linda, eine freundliche Lernassistentin für berufliche Bildung.`
    };
    
    const domainContexts = {
      'AEVO': `Du bist AEVO-Experte. Antworte präzise mit Bezug zu:
• Berufsbildungsgesetz (BBiG) 
• Ausbilder-Eignungsverordnung (AEVO)
• IHK-Prüfungsanforderungen
• Praktischen Ausbildungssituationen

Struktur:
1. Direkte Antwort
2. Erklärung in einfacher Sprache  
3. Praxisbeispiel (wenn passend)
4. Wichtige Hinweise`,
      
      'VWL': `Du bist Wirtschaftsexperte. Antworte mit Bezug zu:
• Volkswirtschaftlichen Grundlagen
• Betriebswirtschaftlichen Konzepten
• Aktuellen Wirtschaftsdaten
• Prüfungsrelevanten Modellen

Struktur:
1. Klare Definition/Erklärung
2. Grafische Veranschaulichung (wenn möglich)
3. Praktische Anwendung
4. Quellen/Weiterführendes`,
      
      'PERSONAL': `Du bist Personalexperte. Antworte mit Bezug zu:
• Arbeitsrecht
• Personalprozessen  
• HR-Instrumenten
• Aktueller Rechtsprechung

Struktur:
1. Rechtliche Einordnung
2. Prozessbeschreibung
3. Checkliste/Formulare
4. Fallbeispiel`
    };
    
    let context = baseContext.content;
    if (domainContexts[fachmodus]) {
      context = domainContexts[fachmodus];
    }
    
    // History für Token-Sparsamkeit vorbereiten
    const limitedHistory = history.slice(-2).map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: this._truncate(h.content, 300)
    }));
    
    return {
      system: context,
      messages: [
        ...limitedHistory,
        { role: "user", content: this._truncate(question, 1500) }
      ]
    };
  },
  
  // ==================== LERNKARTEN-PROMPT (HAUPT) ====================
  getFlashcardsPrompt: function(question, answer, domain = '') {
    // Maximal 1900 Zeichen für API-Limit
    const safeQuestion = this._truncate(question, 250);
    const safeAnswer = this._truncate(answer, 1400);
    
    const domainConfigs = {
      'AEVO': {
        focus: 'Gesetze, Verordnungen, Handlungsanleitungen, IHK-Anforderungen',
        categories: ['Recht', 'Methodik', 'Prüfung', 'Praxis']
      },
      'VWL': {
        focus: 'Definitionen, Formeln, Modelle, Zusammenhänge',
        categories: ['Theorie', 'Berechnung', 'Analyse', 'Anwendung']
      },
      'PERSONAL': {
        focus: 'Arbeitsrecht, Prozesse, Dokumente, Kommunikation',
        categories: ['Recht', 'Verfahren', 'Instrumente', 'Fälle']
      },
      '': {
        focus: 'Kernkonzepte, Definitionen, Anwendungen',
        categories: ['Konzepte', 'Definitionen', 'Beispiele', 'Praxistipps']
      }
    };
    
    const config = domainConfigs[domain] || domainConfigs[''];
    
    return `EXPERTE LERNKARTEN-ERSTELLUNG für ${domain || 'Allgemein'}

AUFGABE: Erstelle 8 hochwertige Lernkarten.

QUALITÄTSKRITERIEN:
✓ Jede Karte = 1 Lernziel (abgeschlossen)
✓ FRONT: Max. 10 Wörter (klare Frage/Begriff)
✓ BACK: Max. 30 Wörter (präzise, prüfungsrelevant)
✓ Keine Wiederholungen zwischen Karten
✓ Korrekte Fachsprache
✓ In verdaubare Häppchen strukturiert

FACHFOKUS: ${config.focus}
KATEGORIEN: ${config.categories.join(', ')}

FORMAT: NUR dieses JSON (KEIN Markdown):

{
  "deck_title": "Kurztitel (max. 5 Wörter)",
  "cards": [
    {
      "front": "...",
      "back": "...", 
      "tag": "${domain || 'Standard'}",
      "level": 1,
      "category": "${config.categories[0]}"
    }
  ]
}

EINGABE:
FRAGE: ${safeQuestion}

ANTWORT: ${safeAnswer}

Gib NUR das JSON zurück:`;
  },
  
  // ==================== KOMPAKT-VERSION (für lange Antworten) ====================
  getCompactFlashcardsPrompt: function(question, answer, domain = '') {
    // Super-kompakt für sehr lange Antworten
    const safeQuestion = this._truncate(question, 150);
    const safeAnswer = this._truncate(answer, 800);
    
    return `Erstelle 6-8 Lernkarten als reines JSON:
{
  "deck_title": "Kurztitel",
  "cards": [
    {"front": "Frage", "back": "Antwort", "tag": "${domain}", "level": 1}
  ]
}

Frage: ${safeQuestion}
Antwort: ${safeAnswer}
Domain: ${domain || 'Allgemein'}

Wichtig: 
- Front: maximal 8 Wörter
- Back: maximal 25 Wörter  
- Korrekte Fachinhalte
- Prüfungsrelevanz

NUR JSON zurückgeben:`;
  },
  
  // ==================== HELPER FUNCTIONS ====================
  _truncate: function(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    // Versuche bei Satzende zu kürzen
    const truncated = text.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastPeriod > maxLength * 0.8) {
      return truncated.substring(0, lastPeriod + 1);
    } else if (lastSpace > maxLength * 0.9) {
      return truncated.substring(0, lastSpace) + '...';
    }
    return truncated.substring(0, maxLength - 3) + '...';
  },
  
  estimateTokens: function(text) {
    // Grobe Schätzung: 1 Token ≈ 4 Zeichen für Deutsch
    return Math.ceil((text || '').length / 4);
  },
  
  prepareFlashcardsAPIRequest: function(userQuestion, botAnswer, domain = '') {
    const totalLength = (userQuestion + botAnswer).length;
    
    // Wähle Prompt basierend auf Länge
    let prompt;
    if (totalLength > 2000) {
      prompt = this.getCompactFlashcardsPrompt(userQuestion, botAnswer, domain);
    } else {
      prompt = this.getFlashcardsPrompt(userQuestion, botAnswer, domain);
    }
    
    // Sicherstellen, dass wir unter 1900 Zeichen bleiben
    const finalPrompt = this._truncate(prompt, 1900);
    
    return {
      question: finalPrompt,
      fachmodus: domain,
      history: []  // Keine History für Karten-Erstellung
    };
  },
  
  // ==================== DEBUG / INFO ====================
  getStats: function() {
    return {
      version: this.VERSION,
      domains: ['AEVO', 'VWL', 'PERSONAL', ''],
      features: ['chat', 'flashcards', 'compact_flashcards']
    };
  }
};

// Global verfügbar machen
if (typeof window !== 'undefined') {
  window.LindaPrompts = LindaPrompts;
}
