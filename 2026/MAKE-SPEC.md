# Make-Workflow: KI-Prüfungen Integration

## **Überblick**

Der bestehende `/api/bot` Webhook erhält **zwei neue optionale Parameter**:

```json
{
  "question": "...",
  "history": [...],
  
  // NEU:
  "kiPruefungenMode": boolean,
  "kiPruefungenRole": "prufer" | "pruefling" | ""
}
```

Dein Make-Workflow muss diese nutzen, um den **System Prompt** zu variieren.

---

## **Logik in Make**

### **1. Parameter prüfen**

```
IF kiPruefungenMode = true
  THEN: KI-Prüfungs-Modus starten
  ELSE: Normaler Modus (wie bisher)
```

### **2. System Prompt auswählen**

**Wenn `kiPruefungenMode = true`:**

```
IF kiPruefungenRole = "prufer"
  System Prompt = [PRUFER_SYSTEM_PROMPT]
ELSE IF kiPruefungenRole = "pruefling"  
  System Prompt = [PRUEFLING_SYSTEM_PROMPT]
ELSE
  System Prompt = [DEFAULT_SYSTEM_PROMPT]
```

**Wenn `kiPruefungenMode = false`:**
- Dein bestehender System Prompt (keine Änderung)

---

## **System Prompts (Muster)**

### **PRUFER_SYSTEM_PROMPT**

```
Du bist ein Experte für KI-gestützte Prüfungen aus Sicht eines Prüfers.
Du berätst zu rechtlichen, didaktischen und sicherheitstechnischen Fragen.
Nutze dein Wissen über aktuelle Best Practices in Hochschul- und Ausbildungsprüfungen.

Basiere deine Antworten auf:
- Transparenz & Verantwortlichkeit
- Didaktisches Potential von KI
- Rechtliche Anforderungen (DSGVO, Prüfungsordnungen)
- Praktische Handreichungen

Sei konkret, gib Beispiele, warnung vor Fallstricken.
Zielgruppe: Prüfer/Dozierende an Hochschulen & Ausbildungsbetrieben.
```

### **PRUEFLING_SYSTEM_PROMPT**

```
Du bist ein Experte für verantwortungsvolle KI-Nutzung aus Sicht eines Prüflings/Lernenden.
Du berätst zu Regeln, Transparenz, akademischer Integrität und praktischem Lernen mit KI.

Basiere deine Antworten auf:
- Akademische Integrität
- Rechtliche & ethische Regeln
- Lernen statt nur Aufgaben lösen
- Verantwortungsvolle Transparenz

Sei ermutigend, konstruktiv, nicht moralisierend.
Erkläre die Grenzlinien klar (Werkzeug vs. Ersatz).
Zielgruppe: Studierende & Auszubildende.
```

---

## **Make-Workflow: Pseudocode**

```
RECEIVE webhook: { question, history, kiPruefungenMode, kiPruefungenRole }

IF kiPruefungenMode == true
  SET systemPrompt = getSystemPrompt(kiPruefungenRole)
ELSE
  SET systemPrompt = DEFAULT_SYSTEM_PROMPT

CALL OpenAI API:
  - model: gpt-4o (oder dein aktuelles Modell)
  - system: systemPrompt
  - messages: [
      { role: "system", content: systemPrompt },
      ...history (wie bisher),
      { role: "user", content: question }
    ]
  - temperature: 0.7 (oder dein Setting)

RETURN response.content
```

---

## **Änderungen in Make (konkret)**

Wenn du ein Text-basiertes Routing in Make nutzt (z.B. Router-Modul):

### **Option A: Router-Bedingung**

```
Route 1: kiPruefungenMode == true
  → Use PRUFER/PRUEFLING systemPrompt
  
Route 2: Alles andere
  → Use DEFAULT systemPrompt (bisherig)
```

### **Option B: Variable Text-Filter**

```
Erstelle eine Variable: systemPrompt

systemPrompt = 
  IF(kiPruefungenMode AND kiPruefungenRole = "prufer",
    [PRUFER_SYSTEM_PROMPT],
    IF(kiPruefungenMode AND kiPruefungenRole = "pruefling",
      [PRUEFLING_SYSTEM_PROMPT],
      [DEFAULT_SYSTEM_PROMPT]
    )
  )
```

Nutze dann `systemPrompt` im OpenAI API Call.

---

## **Testing**

Schicke diese Test-Payloads an deinen Webhook:

### **Test 1: Normal (bisheriges Verhalten)**
```json
{
  "question": "Wie funktioniert AEVO?",
  "history": []
}
```
**Erwartung:** Normale Antwort (DEFAULT_SYSTEM_PROMPT)

### **Test 2: KI-Prüfungen Prüfer**
```json
{
  "question": "Wie erkenne ich KI-generierte Texte?",
  "history": [],
  "kiPruefungenMode": true,
  "kiPruefungenRole": "prufer"
}
```
**Erwartung:** Prüfer-fokussiert, didaktisch, rechtlich

### **Test 3: KI-Prüfungen Prüfling**
```json
{
  "question": "Darf ich KI für meine Hausarbeit nutzen?",
  "history": [],
  "kiPruefungenMode": true,
  "kiPruefungenRole": "pruefling"
}
```
**Erwartung:** Prüfling-fokussiert, ermutigend, integer

---

## **FAQ: Make-Integration**

**F: Muss ich Vector Store aktivieren?**
→ Nein, nicht für diesen Flow. Die Unterlagen sind bereits im System (falls nötig).

**F: Wie viel muss ich in Make ändern?**
→ Nur die Systemd Prompt-Logik. Die API-Calls bleiben gleich.

**F: Kann ich bestehende Sessions/History nutzen?**
→ Nein, wir brechen die History ab (siehe HTML). Neuer Flow = neuer Context.

**F: Brauche ich neue Umgebungsvariablen?**
→ Nein. Die Prompts kannst du direkt als Text in Make einbauen.

---

## **Nächste Schritte**

1. ✅ HTML anpassen (siehe HTML-INTEGRATION.md)
2. ⏳ In Make:
   - Webhook-Parameter anschauen (sollte passen)
   - System Prompt Logik hinzufügen (oben beschrieben)
   - 3 Test-Payloads schicken
3. ✅ Fertig

Das war's. Keine großen Änderungen in Make – nur Prompt-Routing.
