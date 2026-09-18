import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "npm:nodemailer@6.9.16";
import QRCode from "npm:qrcode@1.5.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-cashflow-mailer":"v5.0"}});
const esc=(s:any)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));

type MailCfg={gmail_app_password:string,gmail_sender_email:string,gmail_sender_name:string,gmail_sender_candidates:string[]};

async function getCfg():Promise<MailCfg>{
  const {data,error}=await db.rpc("cashflow_get_mailer_config");
  if(error)throw error;
  return {
    gmail_app_password:String(data?.gmail_app_password||""),
    gmail_sender_email:String(data?.gmail_sender_email||""),
    gmail_sender_name:String(data?.gmail_sender_name||"CA$HFLOW Meetup"),
    gmail_sender_candidates:Array.isArray(data?.gmail_sender_candidates)?data.gmail_sender_candidates:[]
  };
}

async function settingText(key:string,fallback=""){
  const {data,error}=await db.from("cashflow_settings").select("value").eq("key",key).maybeSingle();
  if(error)throw error;
  const v=data?.value;
  return typeof v==="string"?v:(v==null?fallback:String(v));
}

function transport(email:string,pass:string){
  return nodemailer.createTransport({host:"smtp.gmail.com",port:465,secure:true,auth:{user:email,pass},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
}

async function ensureSender(){
  let c=await getCfg();
  if(!c.gmail_app_password)return {...c,configured:false,reason:"missing_app_password"};
  if(c.gmail_sender_email)return {...c,configured:true};
  for(const candidate of c.gmail_sender_candidates){
    try{
      const t=transport(candidate,c.gmail_app_password);
      await t.verify();
      c={...c,gmail_sender_email:candidate};
      return {...c,configured:true};
    }catch{}
  }
  return {...c,configured:false,reason:"gmail_auth_failed"};
}

function eventRows(r:any){
  const date=esc(r?.event_date_label||r?.event_date||"-");
  const time=esc(r?.start_time?"เริ่ม "+String(r.start_time).slice(0,5)+" น.":"-");
  const place=esc(r?.location_name||"-");
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:2px solid #17121d;border-radius:16px;border-collapse:separate;border-spacing:0;overflow:hidden">'+
    '<tr><td style="padding:12px;width:34px;border-bottom:1px solid #e5dce8">DATE</td><td style="padding:12px 8px;border-bottom:1px solid #e5dce8"><small style="color:#716878">วันที่</small><br><b>'+date+'</b></td></tr>'+
    '<tr><td style="padding:12px;border-bottom:1px solid #e5dce8">TIME</td><td style="padding:12px 8px;border-bottom:1px solid #e5dce8"><small style="color:#716878">เวลา</small><br><b>'+time+'</b></td></tr>'+
    '<tr><td style="padding:12px">PLACE</td><td style="padding:12px 8px"><small style="color:#716878">สถานที่</small><br><b>'+place+'</b></td></tr></table>';
}

function refCard(code:string,label="เลขอ้างอิงใบสมัคร"){
  return '<div style="margin:14px 0;padding:15px;background:#fff1a9;border:2px solid #17121d;border-radius:16px"><div style="font-size:10px;font-weight:800;color:#6c602f">'+esc(label)+'</div><div style="margin-top:4px;font-size:26px;font-weight:900;letter-spacing:2px">'+esc(code)+'</div></div>';
}

function pill(text:string,bg="#fff0a8"){
  return '<div style="display:inline-block;margin-bottom:14px;background:'+bg+';border:2px solid #17121d;border-radius:999px;padding:7px 11px;font-size:11px;font-weight:900">'+esc(text)+'</div>';
}

function shell(title:string,intro:string,body:string){
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#21152a;font-family:Arial,sans-serif;color:#17121d">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#21152a"><tr><td align="center" style="padding:24px 10px">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf7;border:3px solid #17121d;border-radius:24px;overflow:hidden">'+
    '<tr><td style="padding:24px 20px 18px;background:#321842"><div style="font-size:11px;color:#fff;font-weight:800;letter-spacing:1px">OFFLINE BOARD GAME · CASHFLOW MEETUP</div><div style="margin-top:8px;font-size:38px;line-height:.95;font-weight:900;color:#ffd83d">CA$HFLOW</div><div style="font-size:28px;font-weight:900;color:#fff">MEETUP</div></td></tr>'+
    '<tr><td style="height:8px;background:#ffd83d"></td></tr>'+
    '<tr><td style="padding:22px 20px 8px"><div style="font-size:11px;font-weight:900;color:#6c35ae">EVENT UPDATE</div><h1 style="margin:8px 0;font-size:27px">'+esc(title)+'</h1><div style="font-size:14px;line-height:1.75;color:#493e4d">'+intro+'</div></td></tr>'+
    '<tr><td style="padding:8px 20px 24px">'+body+'</td></tr>'+
    '<tr><td style="background:#321842;color:#eee4f3;padding:16px 20px;font-size:11px;line-height:1.65"><b style="color:#ffd83d">CA$HFLOW Meetup</b><br>อีเมลนี้ส่งอัตโนมัติจากระบบลงทะเบียนกิจกรรม</td></tr>'+
    '</table></td></tr></table></body></html>';
}

function statusText(status:string){
  const m:Record<string,string>={Pending:"รอตรวจสอบ",Approved:"ยืนยันสิทธิ์แล้ว",Waitlist:"รายชื่อสำรอง",Rejected:"ไม่ผ่านการอนุมัติ",Cancelled:"ยกเลิกแล้ว"};
  return m[status]||status;
}

function calendarLink(r:any){
  if(!r?.event_date||!r?.start_time||!r?.end_time)return "";
  const d=String(r.event_date).replace(/-/g,"");
  const st=String(r.start_time).slice(0,5).replace(":","")+"00";
  const et=String(r.end_time).slice(0,5).replace(":","")+"00";
  return "https://calendar.google.com/calendar/render?"+new URLSearchParams({action:"TEMPLATE",text:r.title||"CA$HFLOW Meetup",dates:d+"T"+st+"/"+d+"T"+et,location:r.location_name||"",ctz:"Asia/Bangkok"}).toString();
}

async function buildMail(type:string,reg:any,round:any){
  const who=esc(reg.nickname||reg.full_name||"ผู้สมัคร");

  if(type==="submission"){
    const waitlist=reg.status==="Waitlist";
    const title=waitlist?"บันทึกรายชื่อสำรองแล้ว":"เราได้รับใบสมัครแล้ว";
    const intro=waitlist
      ?"สวัสดี "+who+" ขณะนี้สิทธิ์ที่ยืนยันเต็มแล้ว ระบบจึงบันทึกใบสมัครของคุณไว้ในรายชื่อสำรอง"
      :"สวัสดี "+who+" ใบสมัครของคุณถูกบันทึกเรียบร้อยแล้ว ตอนนี้อยู่ในขั้นตอนตรวจสอบ และยังไม่ถือว่าได้รับสิทธิ์เข้าร่วม";
    const next=waitlist
      ?"หากมีสิทธิ์ว่างและทีมงานอนุมัติ ระบบจะส่ง Email อีกครั้งพร้อม QR สำหรับ Check-in"
      :"ทีมงานจะตรวจสอบใบสมัคร และหากได้รับอนุมัติ ระบบจะส่ง Email อีกครั้งพร้อม QR สำหรับ Check-in";
    return {
      subject:waitlist?"อยู่ในรายชื่อสำรอง CA$HFLOW Meetup แล้ว":"ได้รับใบสมัคร CA$HFLOW Meetup แล้ว",
      text:title+"\\nสถานะ: "+statusText(reg.status)+"\\nเลขอ้างอิง: "+reg.reference_code,
      html:shell(title,intro,pill(statusText(reg.status),waitlist?"#eee2f7":"#fff0a8")+eventRows(round)+refCard(reg.reference_code)+'<div style="margin-top:14px;padding:13px 14px;background:#f4edfb;border-left:5px solid #6c35ae;border-radius:12px;font-size:12px;line-height:1.6">'+esc(next)+"</div>"),
      attachments:[]
    };
  }

  if(type==="approval"){
    const qrData=await QRCode.toDataURL("CF:"+reg.qr_token,{width:300,margin:1,errorCorrectionLevel:"M"});
    const qrBase64=qrData.split(",")[1]||"";
    const cal=calendarLink(round);
    const mapBtn=round.location_url?'<a href="'+esc(round.location_url)+'" style="display:inline-block;margin:4px;padding:11px 15px;border:2px solid #17121d;border-radius:13px;color:#17121d;text-decoration:none;font-size:12px;font-weight:900;background:#fff">ดูแผนที่</a>':"";
    const calBtn=cal?'<a href="'+esc(cal)+'" style="display:inline-block;margin:4px;padding:11px 15px;border:2px solid #17121d;border-radius:13px;color:#17121d;text-decoration:none;font-size:12px;font-weight:900;background:#ffd83d">เพิ่มลงปฏิทิน</a>':"";
    const qr='<div style="margin-top:14px;padding:16px;text-align:center;background:#f5eefb;border:2px solid #6c35ae;border-radius:16px"><div style="font-size:11px;font-weight:900;color:#6c35ae">QR CHECK-IN</div><img src="cid:cashflow-qr" width="210" height="210" alt="QR Check-in" style="display:block;margin:10px auto 6px;background:#fff"><div style="font-size:11px;color:#716878">แสดง QR นี้ที่จุดลงทะเบียนหน้างาน</div></div>';
    return {
      subject:"ยืนยันสิทธิ์เข้าร่วม CA$HFLOW Meetup",
      text:"ยืนยันสิทธิ์แล้ว\\nเลขอ้างอิง: "+reg.reference_code,
      html:shell("ยืนยันสิทธิ์เรียบร้อยแล้ว","สวัสดี "+who+" คุณได้รับการอนุมัติให้เข้าร่วม CA$HFLOW Meetup แล้ว เตรียม QR ด้านล่างไว้สำหรับ Check-in หน้างาน",pill("อนุมัติแล้ว","#dff5e8")+refCard(reg.reference_code,"Reference Code")+eventRows(round)+qr+'<div style="text-align:center;margin-top:12px">'+calBtn+mapBtn+"</div>"),
      attachments:[{filename:"cashflow-checkin-qr.png",content:qrBase64,encoding:"base64",cid:"cashflow-qr",contentType:"image/png",contentDisposition:"inline"}]
    };
  }

  if(type==="manage_link"){
    const base=await settingText("public_app_url","https://cashflow-meetup-public.vercel.app/participant/");
    const u=new URL(base);
    u.searchParams.set("round",round.round_code);
    u.searchParams.set("manage",String(reg.manage_token));
    const btn='<div style="text-align:center;margin:18px 0"><a href="'+esc(u.toString())+'" style="display:inline-block;padding:13px 18px;border:2px solid #17121d;border-radius:999px;background:#ffd83d;color:#17121d;text-decoration:none;font-size:13px;font-weight:900">เปิดหน้าจัดการใบสมัคร</a></div>';
    return {
      subject:"ลิงก์จัดการใบสมัคร CA$HFLOW Meetup",
      text:"ใช้ลิงก์นี้เพื่อดูหรือยกเลิกใบสมัคร: "+u.toString(),
      html:shell("ลิงก์จัดการใบสมัคร","สวัสดี "+who+" ใช้ปุ่มด้านล่างเพื่อเปิดสถานะและจัดการใบสมัครของคุณ ลิงก์นี้เป็นลิงก์ส่วนตัว ไม่ควรส่งต่อให้ผู้อื่น",refCard(reg.reference_code)+btn),
      attachments:[]
    };
  }

  if(type==="status_correction"){
    const label=statusText(reg.status);
    return {
      subject:"อัปเดตสถานะใบสมัคร CA$HFLOW Meetup",
      text:"สถานะใบสมัครล่าสุด: "+label+"\\nเลขอ้างอิง: "+reg.reference_code,
      html:shell("สถานะใบสมัครมีการเปลี่ยนแปลง","สวัสดี "+who+" โปรดใช้สถานะล่าสุดด้านล่างแทน Email ยืนยันก่อนหน้า",pill(label,(reg.status==="Cancelled"||reg.status==="Rejected")?"#f7dddd":"#eee2f7")+refCard(reg.reference_code)+eventRows(round)),
      attachments:[]
    };
  }

  throw new Error("unsupported_email_type");
}

function validForType(type:string,reg:any){
  if(type==="submission")return ["Pending","Waitlist"].includes(reg.status);
  if(type==="approval")return reg.status==="Approved";
  if(type==="manage_link")return ["Pending","Approved","Waitlist"].includes(reg.status)&&!reg.checked_in_at;
  if(type==="status_correction")return reg.status!=="Approved";
  return false;
}

async function cancelOutbox(id:string,reason:string){
  await db.from("cashflow_email_outbox").update({status:"cancelled",processing_at:null,updated_at:new Date().toISOString(),last_error:reason}).eq("id",id);
}

async function sendOne(outboxId:string){
  const cfg=await ensureSender();
  if(!(cfg as any).configured)throw new Error((cfg as any).reason||"gmail_not_configured");

  const {data:claimed,error:claimErr}=await db.rpc("cashflow_claim_email",{p_outbox_id:outboxId});
  if(claimErr)throw claimErr;
  const out=Array.isArray(claimed)?claimed[0]:claimed;
  if(!out)return {skipped:true,reason:"not_claimable"};

  const {data:reg,error:regErr}=await db.from("cashflow_registrations").select("*,cashflow_rounds(*)").eq("id",out.registration_id).single();
  if(regErr||!reg)throw regErr||new Error("registration_not_found");
  const round=reg.cashflow_rounds;

  if(!validForType(out.email_type,reg)){
    await cancelOutbox(out.id,"stale_"+out.email_type);
    if(out.email_type==="approval"&&!reg.approval_email_sent_at){
      await db.from("cashflow_registrations").update({approval_email_status:"skipped",updated_at:new Date().toISOString()}).eq("id",reg.id);
    }
    return {skipped:true,reason:"stale_state"};
  }

  const mail=await buildMail(out.email_type,reg,round);

  try{
    const info=await transport(cfg.gmail_sender_email,cfg.gmail_app_password).sendMail({
      from:{name:cfg.gmail_sender_name,address:cfg.gmail_sender_email},
      replyTo:cfg.gmail_sender_email,
      envelope:{from:cfg.gmail_sender_email,to:out.to_email},
      to:out.to_email,
      subject:mail.subject,
      text:mail.text,
      html:mail.html,
      attachments:mail.attachments,
      headers:{"Auto-Submitted":"auto-generated","X-Auto-Response-Suppress":"All"}
    });

    const now=new Date().toISOString();
    await db.from("cashflow_email_outbox").update({status:"sent",sent_at:now,processing_at:null,updated_at:now,last_error:null,provider:"gmail",provider_message_id:info.messageId||null}).eq("id",out.id);
    if(out.email_type==="submission"){
      await db.from("cashflow_registrations").update({submission_email_status:"sent",submission_email_sent_at:now,updated_at:now}).eq("id",reg.id);
    }else if(out.email_type==="approval"){
      await db.from("cashflow_registrations").update({approval_email_status:"sent",approval_email_sent_at:now,updated_at:now}).eq("id",reg.id);
    }
    await db.from("cashflow_audit_logs").insert({actor:"system",action:out.email_type+"_email_sent",round_id:round.id,registration_id:reg.id,detail:{provider:"gmail",outbox_id:out.id,content_profile:"cashflow_v5"}});
    return {sent:true,message_id:info.messageId||null,email_type:out.email_type};
  }catch(e){
    const msg=String((e as any)?.message||e).slice(0,500);
    const now=new Date().toISOString();
    await db.from("cashflow_email_outbox").update({status:"failed",processing_at:null,updated_at:now,last_error:msg,provider:"gmail"}).eq("id",out.id);
    if(out.email_type==="submission"){
      await db.from("cashflow_registrations").update({submission_email_status:"failed",updated_at:now}).eq("id",reg.id);
    }else if(out.email_type==="approval"){
      await db.from("cashflow_registrations").update({approval_email_status:"failed",updated_at:now}).eq("id",reg.id);
    }
    throw e;
  }
}

Deno.serve(async(req)=>{
  try{
    if(req.method==="GET"){
      const c=await ensureSender();
      return json({ok:true,provider:"gmail",transport:"smtp_465",configured:(c as any).configured,version:"5.0",content_profile:"cashflow_v5",reason:(c as any).configured?undefined:(c as any).reason});
    }
    if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
    const body=await req.json().catch(()=>({}));
    const id=String(body.outbox_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(id))return json({ok:false,error:"invalid_outbox_id"},400);
    return json({ok:true,...await sendOne(id)});
  }catch(e){
    return json({ok:false,error:String((e as any)?.message||e)},500);
  }
});