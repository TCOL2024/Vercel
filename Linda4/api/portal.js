import { Redis } from '@upstash/redis';
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, token } = req.query;
  if (!id) return res.status(400).json({ error: 'Keine ID angegeben' });

  try {
    const raw = await kv.get(`fall:${id}`);
    if (!raw) return res.status(404).json({ error: 'Fall nicht gefunden' });

    const fall = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Admin bekommt alles inkl. Entwurf
    const isAdmin = token && token === (process.env.ADMIN_TOKEN || 'sozialrecht2026');

    const result = {
      id:            fall.id,
      created:       fall.created,
      vorname:       fall.vorname,
      nachname:      fall.nachname,
      thema:         fall.thema,
      fachbereich:   fall.fachbereich,
      beschreibung:  fall.beschreibung,
      einschaetzung: fall.einschaetzung,
      status:        fall.status,
      antwort:       fall.antwort,
      antwortDatum:  fall.antwortDatum,
      ...(isAdmin ? {
        email:         fall.email,
        linda4Entwurf: fall.linda4Entwurf,
      } : {}),
    };

    return res.status(200).json(result);
  } catch (e) {
    console.error('KV Fehler:', e.message);
    return res.status(500).json({ error: 'Fehler beim Laden' });
  }
}
