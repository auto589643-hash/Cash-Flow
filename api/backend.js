export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const upstream=process.env.APPS_SCRIPT_URL;
  if(!upstream){return res.status(503).json({ok:false,error:'backend_not_configured',message:'Backend ยังไม่ได้เชื่อม Google Apps Script'});}
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try{
    let url=upstream;let options={redirect:'follow',signal:controller.signal,headers:{'user-agent':'cashflow-vercel-proxy/1.0'}};
    if(req.method==='GET'){
      const u=new URL(upstream);Object.entries(req.query||{}).forEach(([k,v])=>u.searchParams.set(k,Array.isArray(v)?v[0]:String(v)));url=u.toString();
    }else{
      options={...options,method:'POST',headers:{...options.headers,'content-type':'application/json'},body:JSON.stringify(req.body||{})};
    }
    const r=await fetch(url,options);const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={ok:false,error:'invalid_upstream_response',message:'Backend ตอบกลับไม่ใช่ JSON'}}
    return res.status(r.ok?200:502).json(data);
  }catch(err){return res.status(err.name==='AbortError'?504:502).json({ok:false,error:'backend_unreachable',message:err.name==='AbortError'?'Backend ใช้เวลาตอบนานเกินไป':'เชื่อมต่อ Backend ไม่สำเร็จ'});}finally{clearTimeout(timer)}
}
