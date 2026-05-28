import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { thema, beschreibung, attachment, attachmentName, attachmentType, antworten } = req.body;
  if (!thema || !beschreibung) return res.status(400).json({ error: 'Fehlende Felder' });

  const apiKey = process.env.Sozialrecht2026 || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'KI nicht konfiguriert' });

  // ── Wenn Antworten auf Rückfragen vorhanden → direkt zur Einschätzung ──
  const hatAntworten = antworten && Object.keys(antworten).length > 0;

  const systemPrompt = hatAntworten
    ? `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Der User hat bereits Rückfragen beantwortet. Gib jetzt eine fundierte, UNVERBINDLICHE Einschätzung (4-6 Sätze).
Beziehe die Antworten auf die Rückfragen explizit ein.
Nenne das relevante SGB wenn passend. Antworte auf Deutsch. Kein Juristenjargon.
Beginne direkt mit der inhaltlichen Einschätzung. Keine Rechtsberatung.`
    : `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Analysiere die Fallbeschreibung und entscheide:

A) Ist die Beschreibung ausreichend klar und detailliert?
   → Gib eine erste UNVERBINDLICHE Einschätzung (4-5 Sätze). Nenne das relevante SGB wenn passend.

B) Ist die Beschreibung zu kurz, unklar oder fehlen wichtige Infos?
   → Stelle 1-2 gezielte Rückfragen um den Fall besser einschätzen zu können.

Antworte IMMER als gültiges JSON in diesem Format:
{
  "modus": "einschaetzung" | "rueckfragen",
  "einschaetzung": "..." | null,
  "rueckfragen": ["Frage 1?", "Frage 2?"] | null
}

Regeln:
- Bei unter 80 Zeichen Beschreibung: IMMER "rueckfragen"
- Fragen sollen spezifisch für ${thema} sein
- Kein Juristenjargon
- Antworte auf Deutsch`;

  // ── Nachricht zusammenbauen ───────────────────────────────────────
  const isImage = attachmentType?.startsWith('image/');
  const isPdf   = attachmentType === 'application/pdf' || attachmentName?.toLowerCase().endsWith('.pdf');
  const isDocx  = attachmentType?.includes('word') || attachmentName?.toLowerCase().match(/\.docx?$/);

  let docText = '';
  if (attachment && (isPdf || isDocx)) {
    try {
      const buffer = Buffer.from(attachment, 'base64');
      if (isPdf) {
        const pdfParse = require('pdf-parse');
        const parsed   = await pdfParse(buffer);
        docText = parsed.text?.slice(0, 3000) || '';
      } else {
        const mammoth = require('mammoth');
        const result  = await mammoth.extractRawText({ buffer });
        docText = result.value?.slice(0, 3000) || '';
      }
    } catch (e) {
      console.error('Dok-Extraktion fehlgeschlagen:', e.message);
    }
  }

  let userContent;
  const antwortBlock = hatAntworten
    ? '\n\nAntworten auf Rückfragen:\n' + Object.entries(antworten).map(([f, a]) => `- ${f}\n  → ${a}`).join('\n')
    : '';

  const baseText = `Themenbereich: ${thema}\n\nFallbeschreibung:\n${beschreibung}${antwortBlock}${docText ? `\n\n--- Dokument (${attachmentName}) ---\n${docText}` : ''}`;

  if (attachment && isImage) {
    userContent = [
      { type: 'text', text: baseText },
      { type: 'image_url', image_url: { url: `data:${attachmentType};base64,${attachment}`, detail: 'high' } },
    ];
  } else {
    userContent = baseText;
  }

  // ── OpenAI-Aufruf ─────────────────────────────────────────────────
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 500,
        temperature: 0.15,
        ...(hatAntworten ? {} : { response_format: { type: 'json_object' } }),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI error:', err);
      return res.status(502).json({ error: 'KI-Analyse fehlgeschlagen' });
    }

    const data   = await response.json();
    const raw    = data.choices?.[0]?.message?.content?.trim() || '';

    if (hatAntworten) {
      // Direkte Einschätzung nach Rückfragen
      return res.status(200).json({ modus: 'einschaetzung', einschaetzung: raw, rueckfragen: null });
    }

    // JSON parsen
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = { modus: 'einschaetzung', einschaetzung: raw, rueckfragen: null }; }

    const docHinweis = attachment
      ? isImage ? ' (Bild analysiert)' : isPdf ? ' (PDF ausgewertet)' : isDocx ? ' (Dokument ausgewertet)' : ''
      : '';

    return res.status(200).json({ ...parsed, docHinweis });

  } catch (err) {
    console.error('Voranalyse error:', err);
    return res.status(500).json({ error: 'Interner Fehler' });
  }
}
