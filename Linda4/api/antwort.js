import { Redis } from '@upstash/redis';
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const BASE_URL    = process.env.PORTAL_BASE_URL || 'https://pfk2026.oldenburg-knowledge.de';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'sozialrecht2026';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, token, antwort } = req.body;

  if (!id || !antwort) return res.status(400).json({ error: 'Fehlende Felder' });
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Nicht autorisiert' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'E-Mail-Dienst nicht konfiguriert' });

  // ── Fall aus KV laden ────────────────────────────────────────────
  let fall;
  try {
    const raw = await kv.get(`fall:${id}`);
    if (!raw) return res.status(404).json({ error: 'Fall nicht gefunden' });
    fall = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return res.status(500).json({ error: 'Datenbankfehler' });
  }

  // ── Fall aktualisieren ───────────────────────────────────────────
  fall.antwort     = antwort;
  fall.antwortDatum = new Date().toISOString();
  fall.status      = 'beantwortet';

  try {
    await kv.set(`fall:${id}`, JSON.stringify(fall), { ex: 60 * 60 * 24 * 180 });
  } catch (e) {
    console.error('KV Update Fehler:', e.message);
  }

  const portalLink = `${BASE_URL}/portal.html?id=${id}`;
  const ts = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  // ── Benachrichtigungs-Mail an User ───────────────────────────────
  const userHtml = `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#002A5C,#1e40af);padding:28px 36px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Du hast eine Antwort erhalten ✓</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${ts}</p>
    </div>
    <div style="background:#fff;padding:28px 36px;border:1px solid #e2e8f0;border-top:none;">
      <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Hallo ${fall.vorname},</p>
      <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 22px;">
        Deine Anfrage zum Thema <strong>${fall.thema}</strong> wurde beantwortet.
      </p>

      <h3 style="color:#1e293b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;">Expertenantwort</h3>
      <div style="background:#f8fafc;border-left:3px solid #002A5C;padding:16px 20px;font-size:14px;color:#1e293b;line-height:1.8;white-space:pre-wrap;margin-bottom:22px;">${antwort}</div>

      <div style="background:#002A5C;padding:16px 20px;text-align:center;">
        <p style="color:#bfdbfe;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em;">Vollständige Übersicht im Portal</p>
        <a href="${portalLink}" style="color:#fff;font-weight:700;font-size:15px;text-decoration:none;">
          → Zum Fall-Portal
        </a>
      </div>
    </div>
    <div style="padding:14px 36px;background:#f9fafb;border:1px solid #e5e7eb;border-top:none;">
      <p style="font-size:11px;color:#9ca3af;margin:0;text-align:center;">Sozialrecht · Fachberatung · DSGVO-konform</p>
    </div>
  </div>`;

  const mailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Sozialrecht Fachberatung <anfrage@resend.dev>',
      to: [fall.email],
      subject: `Antwort auf deine Anfrage – ${fall.thema}`,
      html: userHtml,
      reply_to: 'noormann@gmx.com',
    }),
  });

  if (!mailRes.ok) {
    const errText = await mailRes.text();
    console.error('User-Antwort-Mail fehlgeschlagen:', errText);
  } else {
    console.log('User-Antwort-Mail gesendet an:', fall.email);
  }

  return res.status(200).json({ ok: true });
}
