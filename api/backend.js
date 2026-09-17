const DEFAULT_APPS_SCRIPT_URL='https://script.google.com/macros/s/AKfycbwVi8EmI03vWQSASIPlHZ0mBPm7Zlbh-CEMxDorUcmP-qMOFl56sPoLoJRBhLli2utNuw/exec';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const upstream=process.env.APPS_SCRIPT_URL||DEFAULT_APPS_SCRIPT_URL;
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),22000);
  try{
    let url=upstream;let options={redirect:'follow',signal:controller.signal,headers:{'user-agent':'cashflow-vercel-proxy/1.1'}};
    if(req.method==='GET'){
      const u=new URL(upstream);Object.entries(req.query||{}).forEach(([k,v])=>u.searchParams.set(k,Array.isArray(v)?v[0]:String(v)));url=u.toString();
    }else{
      options={...options,method:'POST',headers:{...options.headers,'content-type':'application/json'},body:JSON.stringify(req.body||{})};
    }
    const r=await fetch(url,options);const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={ok:false,error:'invalid_upstream_response',message:'Backend ตอบกลับไม่ใช่ JSON'}}
    const status=(r.ok&&data.ok!==false)?200:(data.http_status&&Number(data.http_status)>=400?Number(data.http_status):502);
    return res.status(status).json(data);
  }catch(err){return res.status(err.name==='AbortError'?504:502).json({ok:false,error:'backend_unreachable',message:err.name==='AbortError'?'Backend ใช้เวลาตอบนานเกินไป':'เชื่อมต่อ Backend ไม่สำเร็จ'});}finally{clearTimeout(timer)}
}
