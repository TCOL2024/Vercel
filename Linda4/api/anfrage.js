import { Redis } from '@upstash/redis';
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const BASE_URL = process.env.PORTAL_BASE_URL || 'https://pfk2026.oldenburg-knowledge.de';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'sozialrecht2026';

// ── Linda4 Antwort-Entwurf generieren ─────────────────────────────
async function generiereEntwurf(thema, beschreibung, einschaetzung, apiKey) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Du bist Linda4, eine KI-Assistentin für deutsches Sozialrecht.
Erstelle einen professionellen Antwort-ENTWURF für einen Sozialrechts-Experten.
Der Experte wird den Entwurf prüfen, anpassen und dann an den Anfragenden senden.

Format:
- Persönliche Anrede (Du-Form)
- 3-5 Absätze: Einschätzung zum Fall, relevante Rechtsgrundlagen (SGB), mögliche nächste Schritte
- Freundlicher, professioneller Ton
- Am Ende: Platzhalter "[Expertenunterschrift]"
- Antworte auf Deutsch
- Weise auf KEINE Rechtsberatung hin (das macht der Experte)`,
          },
          {
            role: 'user',
            content: `Themenbereich: ${thema}\n\nFallbeschreibung:\n${beschreibung}\n\nLinда4-Einschätzung:\n${einschaetzung || 'keine'}`,
          },
        ],
        max_tokens: 600,
        temperature: 0.2,
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    console.error('Entwurf-Generierung fehlgeschlagen:', e.message);
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    vorname, nachname, email, fachbereich, thema, beschreibung,
    attachment, attachmentName, attachmentType, einschaetzung
  } = req.body;

  if (!vorname || !nachname || !email || !fachbereich || !thema || !beschreibung)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'E-Mail-Dienst nicht konfiguriert' });

  const apiKey = process.env.Sozialrecht2026 || process.env.OPENAI_API_KEY;
  const ts     = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const id     = crypto.randomUUID();

  // ── Fall in KV speichern ─────────────────────────────────────────
  const fallDaten = {
    id, created: new Date().toISOString(),
    vorname, nachname, email, fachbereich, thema, beschreibung,
    einschaetzung: einschaetzung || '',
    linda4Entwurf: '',
    status: 'offen',
    antwort: null, antwortDatum: null,
  };

  try {
    await kv.set(`fall:${id}`, JSON.stringify(fallDaten), { ex: 60 * 60 * 24 * 180 }); // 180 Tage
  } catch (e) {
    console.error('KV Speicher-Fehler:', e.message);
    // Nicht fatal – E-Mails trotzdem senden
  }

  // ── Linda4 Entwurf generieren (parallel) ─────────────────────────
  const entwurfPromise = apiKey
    ? generiereEntwurf(thema, beschreibung, einschaetzung, apiKey)
    : Promise.resolve('');

  const entwurf = await entwurfPromise;

  // Entwurf in KV nachspeichern
  if (entwurf) {
    try {
      fallDaten.linda4Entwurf = entwurf;
      await kv.set(`fall:${id}`, JSON.stringify(fallDaten), { ex: 60 * 60 * 24 * 180 });
    } catch (e) { console.warn('KV Entwurf-Update fehlgeschlagen:', e.message); }
  }

  const portalLink = `${BASE_URL}/portal.html?id=${id}`;
  const adminLink  = `${BASE_URL}/admin.html?id=${id}&token=${ADMIN_TOKEN}`;

  // ── E-Mail an Experte ─────────────────────────────────────────────
  const expertHtml = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:28px 36px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Neue Anfrage – Sozialrecht</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts} · Fall-ID: ${id.slice(0,8)}</p>
    </div>
    <div style="background:#fff;padding:28px 36px;border:1px solid #e2e8f0;border-top:none;">

      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:14px;">
        <tr><td style="color:#64748b;width:130px;padding:5px 0;">Name:</td><td style="font-weight:600;">${vorname} ${nachname}</td></tr>
        <tr><td style="color:#64748b;padding:5px 0;">E-Mail:</td><td><a href="mailto:${email}" style="color:#2563eb;">${email}</a></td></tr>
        <tr><td style="color:#64748b;padding:5px 0;">Thema:</td><td><span style="background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;padding:2px 10px;">${thema}</span></td></tr>
      </table>

      <h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Fallbeschreibung</h3>
      <div style="background:#f8fafc;border-left:3px solid #2563eb;padding:14px 18px;font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;margin-bottom:22px;">${beschreibung}</div>

      ${einschaetzung ? `
      <h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Linda4 – Erste Einschätzung</h3>
      <div style="background:#eff6ff;border-left:3px solid #0ea5e9;padding:14px 18px;font-size:14px;color:#1e3a8a;line-height:1.7;margin-bottom:22px;">${einschaetzung}</div>
      ` : ''}

      ${entwurf ? `
      <h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Linda4 – Antwort-Entwurf (zur Bearbeitung)</h3>
      <div style="background:#fefce8;border-left:3px solid #eab308;padding:14px 18px;font-size:14px;color:#713f12;line-height:1.7;white-space:pre-wrap;margin-bottom:22px;">${entwurf}</div>
      ` : ''}

      <div style="background:#002A5C;padding:16px 20px;text-align:center;margin-top:8px;">
        <a href="${adminLink}" style="color:#fff;font-weight:700;font-size:14px;text-decoration:none;">
          → Antwort bearbeiten &amp; absenden
        </a>
      </div>

      <p style="margin:20px 0 0;font-size:11px;color:#94a3b8;text-align:center;">Fall-ID: ${id}</p>
    </div>
  </div>`;

  // ── Bestätigungs-Mail an User ─────────────────────────────────────
  const userHtml = `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:28px 36px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Deine Anfrage ist eingegangen ✓</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts}</p>
    </div>
    <div style="background:#fff;padding:28px 36px;border:1px solid #e2e8f0;border-top:none;">
      <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Hallo ${vorname},</p>
      <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 22px;">
        deine Anfrage zum Thema <strong>${thema}</strong> wurde erfolgreich übermittelt.
        Sobald ein Experte geantwortet hat, siehst du die Antwort in deinem persönlichen Fall-Portal.
      </p>

      <div style="background:#002A5C;padding:16px 20px;text-align:center;margin-bottom:22px;">
        <p style="color:#bfdbfe;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em;">Dein persönliches Fall-Portal</p>
        <a href="${portalLink}" style="color:#fff;font-weight:700;font-size:15px;text-decoration:none;">
          → Zum Portal
        </a>
        <p style="color:#93c5fd;font-size:11px;margin:8px 0 0;">Lesezeichen setzen – du brauchst den Link zum Aufrufen der Antwort</p>
      </div>

      ${einschaetzung ? `
      <div style="background:#f0f9ff;border:1px solid #bae6fd;padding:16px 20px;margin-bottom:22px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0369a1;">🤖 Linda4 – Erste Einschätzung</p>
        <p style="margin:0;font-size:14px;color:#1e3a8a;line-height:1.75;">${einschaetzung}</p>
        <p style="margin:10px 0 0;font-size:11px;color:#64748b;">Unverbindlich · Keine Rechtsberatung · Expertenantwort folgt</p>
      </div>` : ''}

      <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:14px 18px;font-size:13px;color:#6b7280;line-height:1.6;">
        <strong style="color:#374151;">Deine Anfrage:</strong> ${thema}<br/>
        <span style="white-space:pre-wrap;font-size:12px;">${beschreibung.slice(0,200)}${beschreibung.length > 200 ? ' …' : ''}</span>
      </div>
    </div>
    <div style="padding:14px 36px;background:#f9fafb;border:1px solid #e5e7eb;border-top:none;">
      <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center;">DSGVO-konform · pfk2026.oldenburg-knowledge.de · Fall-ID: ${id.slice(0,8)}</p>
    </div>
  </div>`;

  // ── Beide E-Mails senden ──────────────────────────────────────────
  const sendMail = (to, subject, html, replyTo) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Sozialrecht Fachberatung <anfrage@resend.dev>',
        to: [to], subject, html, reply_to: replyTo,
        ...(to === 'noormann@gmx.com' && attachment
          ? { attachments: [{ filename: attachmentName, content: attachment, type: attachmentType }] }
          : {}),
      }),
    });

  const [r1, r2] = await Promise.all([
    sendMail('noormann@gmx.com', `[${thema}] ${vorname} ${nachname} – Neue Anfrage`, expertHtml, email),
    sendMail(email, `Deine Anfrage ist eingegangen – ${thema}`, userHtml, 'noormann@gmx.com'),
  ]);

  if (!r1.ok) {
    const err = await r1.text();
    console.error('Resend expert error:', err);
    return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
  }
  if (!r2.ok) console.warn('User-Bestätigung fehlgeschlagen:', await r2.text());

  return res.status(200).json({ ok: true, portalLink });
}
