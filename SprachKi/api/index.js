const OpenAI = require("openai");
const Busboy = require("busboy");

const client = new OpenAI({ apiKey: process.env.ASK || process.env.OPENAI_API_KEY });
const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID;

function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function route(req) {
  const p = new URL(req.url, `https://${req.headers.host || "localhost"}`).pathname.replace(/\/+$/,"");
  if (p.endsWith("/ask")) return "ask";
  if (p.endsWith("/rewrite")) return "rewrite";
  if (p.endsWith("/context-upload")) return "context-upload";
  if (p.endsWith("/context-search")) return "context-search";
  return "";
}
async function bodyJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw=""; for await (const c of req) raw+=c;
  return raw ? JSON.parse(raw) : {};
}
function textOf(r) {
  if (!r) return "";
  if (typeof r.output_text==="string") return r.output_text;
  if (typeof r.text==="string") return r.text;
  if (Array.isArray(r.output)) return r.output.flatMap(x=>Array.isArray(x.content)?x.content:[]).map(x=>x.text||"").filter(Boolean).join("\n");
  return "";
}
async function ask(req,res) {
  if(req.method!=="POST") return send(res,405,{error:"Method not allowed"});
  const b=await bodyJson(req), q=String(b.question||"").trim();
  if(!q) return send(res,400,{error:"question fehlt"});
  const r=await client.responses.create({model:process.env.OPENAI_MODEL||"gpt-5-mini",input:q});
  return send(res,200,{result:textOf(r),output_text:r.output_text||textOf(r)});
}
async function rewrite(req,res) {
  return ask(req,res);
}
function multipart(req){
  return new Promise((resolve,reject)=>{
    const bb=Busboy({headers:req.headers}), fields={}, chunks=[];
    let file=null;
    bb.on("field",(n,v)=>fields[n]=v);
    bb.on("file",(n,stream,info)=>{
      if(n!=="file"){stream.resume();return;}
      file={...info}; stream.on("data",c=>chunks.push(c));
    });
    bb.on("finish",()=>resolve({fields,file:file?{...file,buffer:Buffer.concat(chunks)}:null}));
    bb.on("error",reject); req.pipe(bb);
  });
}
async function contextUpload(req,res){
  if(req.method!=="POST") return send(res,405,{error:"Method not allowed"});
  if(!VECTOR_STORE_ID) return send(res,500,{error:"OPENAI_VECTOR_STORE_ID fehlt"});
  const {fields,file}=await multipart(req);
  if(!file) return send(res,400,{error:"Datei fehlt"});
  let meta={}; try{meta=fields.metadata?JSON.parse(fields.metadata):{}}catch{return send(res,400,{error:"metadata ist kein gültiges JSON"})}
  const contextId=fields.context_id||meta.context_id;
  if(!contextId) return send(res,400,{error:"context_id fehlt"});
  if(file.buffer.length>20*1024*1024) return send(res,413,{error:"Datei zu groß"});
  const uploaded=await client.files.create({file:new File([file.buffer],file.filename,{type:file.mimeType||"application/octet-stream"}),purpose:"assistants"});
  const vf=await client.vectorStores.files.create(VECTOR_STORE_ID,{file_id:uploaded.id,attributes:{context_id:String(contextId),source_name:String(file.filename),...meta}});
  return send(res,200,{file_id:uploaded.id,name:file.filename,type:file.mimeType,indexed:vf.status==="completed",status:vf.status,vector_store_file_id:vf.id});
}
async function contextSearch(req,res){
  if(req.method!=="POST") return send(res,405,{error:"Method not allowed"});
  if(!VECTOR_STORE_ID) return send(res,500,{error:"OPENAI_VECTOR_STORE_ID fehlt"});
  const b=await bodyJson(req), query=String(b.query||"").trim(), contextId=String(b.context_id||"").trim();
  if(!query||!contextId) return send(res,400,{error:!query?"query fehlt":"context_id fehlt"});
  const r=await client.vectorStores.search(VECTOR_STORE_ID,{query,max_num_results:8,rewrite_query:true,attribute_filter:{type:"eq",key:"context_id",value:contextId}});
  const chunks=[], counts={};
  for(const item of (r.data||[])){
    const text=(item.content||[]).map(x=>x.text||"").filter(Boolean).join("\n").trim();
    if(!text) continue;
    const name=item.filename||item.file_name||"Quelle";
    chunks.push({file_id:item.file_id,filename:name,score:item.score,text});
    counts[name]=(counts[name]||0)+1;
  }
  return send(res,200,{relevant_context:chunks.map((c,i)=>`[Quelle ${i+1}: ${c.filename} | Treffer ${Number(c.score||0).toFixed(3)}]\n${c.text}`).join("\n\n"),chunks,sources:Object.entries(counts).map(([name,hits])=>({name,hits}))});
}
module.exports=async function(req,res){
  try{
    switch(route(req)){
      case "ask": return ask(req,res);
      case "rewrite": return rewrite(req,res);
      case "context-upload": return contextUpload(req,res);
      case "context-search": return contextSearch(req,res);
      default: return send(res,404,{error:"Unbekannter API-Endpunkt"});
    }
  }catch(e){console.error(e);return send(res,500,{error:e.message||"Interner Serverfehler"});}
};
