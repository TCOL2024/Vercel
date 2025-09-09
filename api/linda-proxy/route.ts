// app/api/linda-proxy/route.ts
export const runtime = 'edge';

const MAKE_WEBHOOK = 'https://hook.us2.make.com/pkdx4lpoadncdgd9fdwvd2jlgnwfsgx6';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Make liefert oft Text zurück – wir geben unverändert weiter
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'text/plain; charset=utf-8' },
    });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
