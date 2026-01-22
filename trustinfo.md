# Linda Privacy Portal – Datenschutz-Anfragen

## Übersicht
Das "Linda Privacy Portal" stellt ein benutzerfreundliches und responsives Interface für Nutzer:innen bereit, um datenschutz-relevante Anfragen gemäß der DSGVO (Datenschutz-Grundverordnung) einzureichen. Es deckt verschiedene Arten von Anfragen ab, wie z. B. **Auskunft**, **Löschung** und **Berichtigung** personenbezogener Daten.

### Features:
- **Modernes Design**: Ansprechend und klar strukturiert, inspiriert durch die Eleganz und Professionalität von metafinanz.de.
- **Interaktiv und Intuitiv**: Tile-basierte Auswahl der Anfragetypen.
- **Mobile Ready**: Vollständig responsiv für die Nutzung auf allen Geräten.
- **Backend-Integration**: Bereit für Webhook-Anbindung, z. B. über `make.com`.

---

## Key Komponenten

### Einleitung (Header)
Der Header enthält:
- **Branding**: Logo-Bereich und Portal-Beschreibung.
- **API-Statusanzeige**: Dynamische Anzeige des konfigurierten Backend-Endpunkts ("Backend: nicht gesetzt").

```html
<header>
  ...
  <h1>Linda Privacy Portal</h1>
  <p>Reiche hier Datenschutz-Anfragen ein (z. B. Auskunft, Löschung, Berichtigung).</p>
  <b id="pillBackend" class="mono">nicht gesetzt</b>
  ...
</header>