// bot.js - Backend API für Linda
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Konfiguration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Domain-spezifische System Prompts
const SYSTEM_PROMPTS = {
  '': `Du bist Linda, eine freundliche Lernassistentin. Antworte auf Deutsch, sei präzise und hilfreich.`,
  'AEVO': `Du bist Linda, eine Expertin für Ausbildereignung (AEVO). Antworte präzise und prüfungsrelevant.`,
  'VWL': `Du bist Linda, eine Expertin für Volkswirtschaftslehre und Betriebswirtschaft.`,
  'PERSONAL': `Du bist Linda, eine Expertin für Personalwesen und HR-Management.`
};

// API Endpoint für Chat
app.post('/api/bot', async (req, res) => {
  try {
    const { question, fachmodus, history } = req.body;
    
    // System Prompt basierend auf Fachmodus
    const systemPrompt = SYSTEM_PROMPTS[fachmodus] || SYSTEM_PROMPTS[''];
    
    // Vorbereite Messages für OpenAI
    const messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Füge Verlauf hinzu (falls vorhanden)
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      });
    }
    
    // Füge aktuelle Frage hinzu
    messages.push({ role: 'user', content: question });
    
    // OpenAI API Call
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 1500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const answer = response.data.choices[0].message.content;
    res.send(answer);
    
  } catch (error) {
    console.error('API Fehler:', error.message);
    res.status(500).send('Fehler bei der Verarbeitung deiner Anfrage.');
  }
});

// Starte Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Linda API läuft auf Port ${PORT}`);
});
