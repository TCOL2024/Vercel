// /api/bot.js
export default async function handler(req, res) {
  // Methode POST nötig
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }
  // Webhook-URL sicher aus Environment
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;

  try {
    // Body lesen (Achtung bei Next.js: evtl. await req.json() bei Middleware)
    const { question, history } = req.body;

    // An Make weiterleiten:
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history }),
    });

    const reply = await response.text(); // oder .json(), je nach Make-Antwort
    return res.status(200).send(reply);
  } catch (err) {
    return res.status(500).json({ error: 'Fehler beim Senden an Make', detail: err.message });
  }
}
