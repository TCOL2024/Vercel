import { runWorkflow } from "../lindaAgent";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed" });
  }

  try {
    const { input_as_text } = req.body as { input_as_text?: string };

    if (!input_as_text || typeof input_as_text !== "string") {
      return res.status(400).json({ error: "input_as_text is required" });
    }

    const result = await runWorkflow({ input_as_text });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Linda 2.0 Fehler:", err);
    return res.status(500).json({
      error: "Fehler beim Aufruf von Linda 2.0",
      details: err?.message ?? String(err)
    });
  }
}
