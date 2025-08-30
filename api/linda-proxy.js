// /api/linda-proxy.js  (bei Next App: /app/api/linda-proxy/route.js -> siehe Kommentar)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  const url = process.env.MAKE_WEBHOOK_URL_LINDA;   // <- exakt dieser Name!
  if (!url) {
    return res.status(500).json({ error: "Missing env MAKE_WEBHOOK_URL_LINDA" });
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    });

    const ct = upstream.headers.get("content-type") || "text/plain";
    const text = await upstream.text();
    res.setHeader("Content-Type", ct);
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(502).json({ error: "Relay error", detail: String(e) });
  }
}

/* Next.js App Router? Dann statt oben:
export async function OPTIONS(){ return new Response("",{status:204,headers:{
  "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});}
export async function POST(req){
  const url = process.env.MAKE_WEBHOOK_URL_LINDA;
  if(!url) return new Response(JSON.stringify({error:"Missing env MAKE_WEBHOOK_URL_LINDA"}),{status:500,headers:{"Access-Control-Allow-Origin":"*","Content-Type":"application/json"}});
  const body = await req.json().catch(()=> ({}));
  try{
    const up = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const txt = await up.text(); const ct = up.headers.get("content-type")||"text/plain";
    return new Response(txt,{status:up.status,headers:{"Access-Control-Allow-Origin":"*","Content-Type":ct}});
  }catch(e){
    return new Response(JSON.stringify({error:"Relay error",detail:String(e)}),{status:502,headers:{"Access-Control-Allow-Origin":"*","Content-Type":"application/json"}});
  }
}
*/
