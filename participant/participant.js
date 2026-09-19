const CASHFLOW_API_BASE=location.hostname.endsWith('.supabase.co')?'https://cjqcyjuxsqtuybjqumlk.supabase.co/functions/v1/cashflow':'/api/backend';
const DEFAULT_ROUND={
  round_code:'cashflow-01',
  title:'CA$HFLOW Meetup',
  event_date_label:'19 กันยายน',
  start_time:'16:00',
  location_name:'Gateway at Bangsue',
  status:'Open'
};

const params=new URLSearchParams(location.search);
const explicitRoundCode=params.get('round')||'';
const initialManageToken=params.get('manage')||'';
const DRAFT_KEY='cashflow_registration_draft_v2';
const state={
  roundCode:explicitRoundCode,
  round:null,
  roundVerified:false,
  step:1,
  view:'event',
  hasDraft:false,
  clientRequestId:makeClientId(),
  existingLookup:null,
  contactCheckSeq:0,
  manageToken:initialManageToken,
  lastRegistrationData:null
};

const $=s=>document.querySelector(s);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ACTIVE_STATUSES=new Set(['Pending','Approved','Waitlist']);

function makeClientId(){
  return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function esc(s){
  return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function roundCacheKey(){
  return `cashflow_round:${state.roundCode||'active'}`;
}

async function api(action,payload=null,timeoutMs=18000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let url=CASHFLOW_API_BASE;
    let opt={signal:controller.signal};
    if(payload===null){
      const qs=new URLSearchParams({action});
      if(state.roundCode)qs.set('roundCode',state.roundCode);
      url+=`?${qs.toString()}`;
    }else{
      opt={
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({action,...payload}),
        signal:controller.signal
      };
    }
    const r=await fetch(url,opt);
    const data=await r.json().catch(()=>({ok:false,error:'invalid_response'}));
    if(!r.ok||data.ok===false){
      throw Object.assign(new Error(data.message||data.error||'เกิดข้อผิดพลาด'),{data,status:r.status});
    }
    return data;
  }catch(err){
    if(err.name==='AbortError')throw Object.assign(new Error('ระบบตอบช้ากว่าปกติ'),{code:'timeout'});
    if(!navigator.onLine)throw Object.assign(new Error('อินเทอร์เน็ตหลุดชั่วคราว ข้อมูลที่กรอกยังอยู่ในแท็บนี้'),{code:'offline'});
    throw err;
  }finally{
    clearTimeout(timer);
  }
}

async function registerWithRecovery(payload){
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    try{return await api('register',payload,18000)}
    catch(err){
      lastErr=err;
      const retryable=err.code==='timeout'||!err.status||err.status===502||err.status===504;
      if(!retryable||attempt===1)break;
      await sleep(700);
    }
  }
  throw lastErr;
}

function setText(id,value){
  const el=$(id);
  if(el)el.textContent=value||'—';
}

function formatEventTime(value){
  const m=String(value||'').match(/^(\d{1,2}):(\d{2})/);
  return m?`${m[1].padStart(2,'0')}:${m[2]} น.`:'—';
}

function viewName(name){
  return name==='#registerView'?'register':name==='#statusView'?'status':'event';
}

function setView(name,{push=true}={}){
  ['#eventView','#registerView','#statusView'].forEach(id=>$(id)?.classList.add('hidden'));
  $(name)?.classList.remove('hidden');
  state.view=viewName(name);
  document.body.classList.toggle('flow-mode',state.view!=='event');
  if(push&&history.state?.cashflowView!==state.view){
    history.pushState({cashflowView:state.view},'',location.href);
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  scrollTo({top:0,behavior:reduced?'auto':'smooth'});
}

function renderRound(round,{verified=false}={}){
  if(!round)return;
  state.round=round;
  if(verified){
    state.roundVerified=true;
    if(round.round_code)state.roundCode=round.round_code;
  }

  setText('#eventDate',round.event_date_label||round.event_date);
  setText('#eventTime',formatEventTime(round.start_time));

  const loc=$('#eventLocation');
  loc.textContent=round.location_name||'—';
  if(round.location_url){
    const a=document.createElement('a');
    a.href=round.location_url;
    a.target='_blank';
    a.rel='noopener';
    a.className='map-link';
    a.textContent='ดูแผนที่ ↗';
    loc.append(a);
  }

  $('#registerMeta').textContent=[
    round.location_name,
    round.event_date_label||round.event_date,
    round.start_time&&formatEventTime(round.start_time)
  ].filter(Boolean).join(' · ');

  $('#statusMeta').textContent=`${round.title||'CA$HFLOW Meetup'} · ใช้ข้อมูลเดียวกับที่สมัคร`;

  const topTag=$('#eventTopTag');
  const seatBadge=$('#eventSeatBadge');
  const seatLabel=cleanSeatLabel(round.public_seat_display,round);
  if(seatBadge)seatBadge.textContent=seatLabel;
  if(topTag)topTag.textContent=round.status==='Open'?'OPEN':round.status==='Full'?'WAITLIST':'CLOSED';

  const start=$('#startBtn');
  if(!state.roundVerified){
    start.disabled=true;
    start.textContent='กำลังตรวจสอบรอบ…';
    return;
  }

  if(round.status==='Open'){
    start.disabled=false;
    start.textContent=state.hasDraft?'กรอกใบสมัครต่อ':'สมัครเข้าร่วม';
    $('#eventStatusTitle').textContent='หลังสมัคร ทีมงานจะตรวจสอบสิทธิ์';
    const seatText=Number.isFinite(Number(round.remaining_seats))&&round.remaining_seats!==null
      ?` · เหลือสำหรับอนุมัติ ${round.remaining_seats} ที่`:'';
    $('#eventStatusText').textContent=`เมื่อได้รับการอนุมัติ ระบบจะส่ง Email พร้อม QR สำหรับ Check-in${seatText}`;
  }else if(round.status==='Full'){
    start.disabled=false;
    start.textContent='สมัครรายชื่อสำรอง';
    $('#eventStatusTitle').textContent='ที่นั่งยืนยันเต็มแล้ว — เปิดรับรายชื่อสำรอง';
    $('#eventStatusText').textContent='สมัครไว้ได้ ระบบจะบันทึกเป็น Waitlist และแจ้งเมื่อมีสิทธิ์ว่าง';
  }else{
    start.disabled=true;
    start.textContent='ปิดรับใบสมัคร';
    $('#eventStatusTitle').textContent='ปิดรับใบสมัครแล้ว';
    $('#eventStatusText').textContent=`สถานะรอบนี้: ${round.status}`;
  }
}

function cleanSeatLabel(publicText,round){
  const raw=String(publicText||'').trim();
  if(raw)return raw.replace(/เท่านั้น$/,'').trim();
  if(round?.capacity_enabled&&Number(round.approval_capacity)>0)return `ฟรี · ${Number(round.approval_capacity)} ที่นั่ง`;
  return 'เข้าร่วมฟรี';
}

function readRoundCache(){
  try{
    const raw=localStorage.getItem(roundCacheKey());
    if(!raw)return null;
    const x=JSON.parse(raw);
    if(!x||Date.now()-Number(x.savedAt||0)>10*60*1000)return null;
    return x.round;
  }catch{return null}
}

function saveRoundCache(round){
  try{localStorage.setItem(roundCacheKey(),JSON.stringify({savedAt:Date.now(),round}))}catch{}
}

async function loadRound(){
  const cached=readRoundCache();
  if(cached)renderRound(cached,{verified:false});
  else renderRound(DEFAULT_ROUND,{verified:false});

  try{
    const data=await api('publicRound',null,10000);
    renderRound(data.round,{verified:true});
    saveRoundCache(data.round);
    $('#eventError').classList.add('hidden');
  }catch(err){
    const box=$('#eventError');
    if(cached){
      box.textContent='เชื่อมต่อระบบชั่วคราวไม่ได้ กำลังแสดงข้อมูลรอบล่าสุดที่ตรวจสอบไว้ ระบบจะตรวจอีกครั้งตอนส่งใบสมัคร';
      box.classList.remove('hidden');
    }else{
      state.roundVerified=false;
      $('#startBtn').disabled=true;
      $('#startBtn').textContent='ยังสมัครไม่ได้';
      box.textContent=explicitRoundCode
        ?'ไม่สามารถยืนยันรอบกิจกรรมจากลิงก์นี้ได้ กรุณาตรวจสอบลิงก์หรือลองใหม่'
        :'ยังยืนยันข้อมูลรอบกิจกรรมไม่ได้ กรุณาลองใหม่ก่อนส่งใบสมัคร';
      box.classList.remove('hidden');
    }
  }
}

function normalizeThaiPhone(value){
  let digits=String(value||'').replace(/\D/g,'');
  if(digits.startsWith('0066'))digits='0'+digits.slice(4);
  else if(digits.startsWith('66')&&digits.length>=11)digits='0'+digits.slice(2);
  return digits.slice(0,10);
}

function isValidThaiMobile(value){
  return /^0[689]\d{8}$/.test(normalizeThaiPhone(value));
}

function formatPhone(value){
  const d=normalizeThaiPhone(value);
  if(d.length<=3)return d;
  if(d.length<=6)return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6,10)}`;
}

function attachPhoneFormatter(el){
  el.addEventListener('input',()=>{
    const before=el.value;
    const d=normalizeThaiPhone(before);
    el.value=formatPhone(d);
    el.closest('.field')?.classList.remove('invalid');
    el.removeAttribute('aria-invalid');
  });
  el.addEventListener('blur',()=>{el.value=formatPhone(el.value)});
}

function setFieldValidity(input,valid){
  const field=input.closest('.field');
  field?.classList.toggle('invalid',!valid);
  if(valid)input.removeAttribute('aria-invalid');
  else input.setAttribute('aria-invalid','true');
}

function validateStep1(){
  let ok=true;
  const fields=[...document.querySelectorAll('#step1 .field[data-required]')];
  fields.forEach(field=>{
    const input=field.querySelector('input,select');
    let valid=input.checkValidity()&&input.value.trim()!=='';
    if(input.id==='phone')valid=isValidThaiMobile(input.value);
    setFieldValidity(input,valid);
    if(!valid&&ok){input.focus();ok=false}
  });
  return ok;
}

function statusLabel(status){
  return ({
    Pending:'รอตรวจสอบ',
    Approved:'ยืนยันสิทธิ์แล้ว',
    Waitlist:'รายชื่อสำรอง',
    Rejected:'ไม่ผ่านการอนุมัติ',
    Cancelled:'ยกเลิกแล้ว'
  })[status]||status;
}

function statusDescription(reg){
  if(reg.status==='Pending')return 'ทีมงานได้รับใบสมัครแล้วและกำลังตรวจสอบ ไม่ต้องสมัครซ้ำ';
  if(reg.status==='Approved')return reg.checked_in_at
    ?`Check-in แล้วเมื่อ ${reg.checked_in_at}`
    :'ได้รับสิทธิ์แล้ว กรุณาตรวจ Email สำหรับ QR Check-in';
  if(reg.status==='Waitlist')return 'ขณะนี้อยู่ในรายชื่อสำรอง ระบบจะแจ้งหากได้รับสิทธิ์';
  if(reg.status==='Rejected')return 'ใบสมัครก่อนหน้านี้ไม่ผ่านการอนุมัติ สามารถสมัครใหม่ได้';
  if(reg.status==='Cancelled')return 'ใบสมัครนี้ถูกยกเลิกแล้ว สามารถสมัครใหม่ได้';
  return '';
}

function renderContactCheck(data){
  const box=$('#contactCheck');
  state.existingLookup=data?.found?data:null;
  if(!data?.found){
    box.classList.add('hidden');
    box.classList.remove('warning','success');
    box.textContent='';
    return;
  }
  const reg=data.registration;
  box.classList.remove('hidden','success');
  box.classList.toggle('warning',ACTIVE_STATUSES.has(reg.status));
  box.innerHTML=`<strong>${esc(statusLabel(reg.status))}</strong><br>${esc(statusDescription(reg))}`;
}

async function lookupExistingRegistration({silent=false}={}){
  const phone=$('#phone').value;
  const email=$('#email').value.trim().toLowerCase();
  if(!state.roundVerified||!isValidThaiMobile(phone)||!$('#email').checkValidity()||!email){
    renderContactCheck(null);
    return null;
  }

  const seq=++state.contactCheckSeq;
  const box=$('#contactCheck');
  if(!silent){
    box.className='notice compact';
    box.textContent='กำลังตรวจสอบใบสมัครเดิม…';
  }

  try{
    const data=await api('registrationStatus',{
      roundCode:state.roundCode,
      phone:normalizeThaiPhone(phone),
      email
    },10000);
    if(seq!==state.contactCheckSeq)return null;
    renderContactCheck(data);
    return data;
  }catch(err){
    if(seq!==state.contactCheckSeq)return null;
    state.existingLookup=null;
    if(!silent){
      box.className='notice compact warning';
      box.textContent='ยังตรวจสอบใบสมัครเดิมไม่ได้ ระบบจะตรวจซ้ำอีกครั้งตอนส่ง';
    }
    return null;
  }
}

function renderReview(){
  const rows=[
    ['เบอร์มือถือ',formatPhone($('#phone').value)],
    ['Email',$('#email').value.trim()],
    ['ชื่อ-นามสกุล',$('#fullname').value.trim()],
    ['ชื่อเล่น',$('#nickname').value.trim()],
    ['ช่วงอายุ',$('#age').value]
  ];
  $('#reviewSummary').innerHTML=rows.map(([k,v])=>`<div class="review-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
}

function setStep(step){
  state.step=step;
  $('#step1').classList.toggle('active',step===1);
  $('#step2').classList.toggle('active',step===2);
  $('#pendingState').classList.toggle('active',step===3);
  $('#progress2').classList.toggle('on',step>=2);
  $('.progress')?.setAttribute('aria-valuenow',String(Math.min(step,2)));

  $('#regBack').classList.toggle('hidden',step!==2);
  if(step===1){
    $('#stepLabel').textContent='Step 1/2';
    $('#regAction').textContent='ถัดไป';
    $('#regHelp').textContent='ข้อมูลหลักสำหรับสมัครและรับผลยืนยันสิทธิ์';
  }else if(step===2){
    $('#stepLabel').textContent='Step 2/2';
    $('#regAction').textContent='ยืนยันและส่งใบสมัคร';
    $('#regHelp').textContent='ตรวจชื่อและช่องทางติดต่อก่อนส่ง';
    renderReview();
  }else{
    $('#stepLabel').textContent='ส่งแล้ว';
    $('#regAction').textContent='กลับหน้ากิจกรรม';
    $('#regBack').classList.add('hidden');
    $('#regHelp').textContent='ระบบรับข้อมูลแล้ว';
  }
  if(step<3)saveDraftSoon();
}

function setLoading(on){
  const b=$('#regAction');
  b.disabled=on;
  if(on)b.textContent=state.step===1?'กำลังตรวจสอบ…':'กำลังบันทึก…';
  else setStep(state.step);
}

function resetRegistrationFlow({preserveContact=false}={}){
  const phone=preserveContact?$('#phone').value:'';
  const email=preserveContact?$('#email').value:'';
  clearDraft();
  $('#regForm').reset();
  $('#phone').value=phone;
  $('#email').value=email;
  document.querySelectorAll('#regForm .field.invalid').forEach(x=>x.classList.remove('invalid'));
  document.querySelectorAll('#regForm [aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));
  $('#submitError').classList.add('hidden');
  $('#duplicateNotice').classList.add('hidden');
  renderContactCheck(null);
  state.clientRequestId=makeClientId();
  state.existingLookup=null;
  state.lastRegistrationData=null;
  setStep(1);
}

function showRegister(){
  if(!state.roundVerified)return;
  if(state.lastRegistrationData){
    showStatus(state.lastRegistrationData);
    return;
  }
  setView('#registerView');
  setStep(state.step===2?2:1);
}

function showEvent({push=true}={}){
  setView('#eventView',{push});
}

function backToEvent(){
  setView('#eventView',{push:false});
  history.replaceState({cashflowView:'event'},'',location.pathname+location.search);
}

function finishRegistrationToEvent(){
  resetRegistrationFlow();
  state.manageToken='';
  state.lastRegistrationData=null;
  backToEvent();
}

function showStatus(data=null){
  setView('#statusView');
  $('#statusError').classList.add('hidden');

  if(data&&!state.manageToken){
    if(!$('#statusPhone').value&&$('#phone').value)$('#statusPhone').value=formatPhone($('#phone').value);
    if(!$('#statusEmail').value&&$('#email').value)$('#statusEmail').value=$('#email').value.trim();
  }

  if(data)renderStatusResult(data);
  else{
    $('#statusResult').classList.add('hidden');
    $('#statusActions').classList.add('hidden');
    $('#statusLookupFields').classList.remove('hidden');
  }
}

function renderStatusResult(data){
  if(!data?.found){
    $('#statusResult').innerHTML='<div class="notice"><strong>ยังไม่พบใบสมัคร</strong><br>ตรวจสอบเบอร์มือถือและ Email หรือกลับไปสมัครใหม่ได้</div>';
    $('#statusResult').classList.remove('hidden');
    $('#statusActions').classList.add('hidden');
    return;
  }

  state.lastStatusData=data;
  const reg=data.registration;
  const checked=reg.checked_in_at?`<div class="status-meta">Check-in: ${esc(reg.checked_in_at)}</div>`:'';
  $('#statusResult').innerHTML=`
    <article class="status-card status-${esc(reg.status)}">
      <span class="status-eyebrow">สถานะใบสมัคร</span>
      <h2>${esc(statusLabel(reg.status))}</h2>
      <p>${esc(statusDescription(reg))}</p>
      <div class="status-reference">Reference: <strong>${esc(reg.reference_code)}</strong></div>
      ${checked}
    </article>`;
  $('#statusResult').classList.remove('hidden');
  $('#statusActions').classList.remove('hidden');

  const canReapply=Boolean(data.can_reapply);
  $('#statusReapplyBtn').classList.toggle('hidden',!canReapply);

  const canCancel=Boolean(data.can_cancel)&&Boolean(state.manageToken);
  $('#statusCancelBtn').classList.toggle('hidden',!canCancel);

  const canRequestManage=Boolean(data.can_cancel)&&!state.manageToken;
  $('#statusManageLinkBtn').classList.toggle('hidden',!canRequestManage);

  if(canRequestManage){
    $('#statusResult').insertAdjacentHTML('beforeend','<p class="status-help">ต้องการยกเลิกใบสมัคร? ส่งลิงก์จัดการแบบปลอดภัยไปที่ Email ที่ใช้สมัครได้</p>');
  }
}

async function lookupStatusFromForm(){
  $('#statusError').classList.add('hidden');
  const phone=$('#statusPhone').value;
  const email=$('#statusEmail').value.trim().toLowerCase();
  if(!isValidThaiMobile(phone)){
    $('#statusError').textContent='กรุณากรอกเบอร์มือถือไทย 10 หลักให้ถูกต้อง';
    $('#statusError').classList.remove('hidden');
    $('#statusPhone').focus();
    return;
  }
  if(!$('#statusEmail').checkValidity()||!email){
    $('#statusError').textContent='กรุณากรอก Email ให้ถูกต้อง';
    $('#statusError').classList.remove('hidden');
    $('#statusEmail').focus();
    return;
  }

  const btn=$('#statusLookupBtn');
  btn.disabled=true;
  btn.textContent='กำลังตรวจ…';
  try{
    const data=await api('registrationStatus',{
      roundCode:state.roundCode,
      phone:normalizeThaiPhone(phone),
      email
    },10000);
    renderStatusResult(data);
  }catch(err){
    $('#statusError').textContent=err.message;
    $('#statusError').classList.remove('hidden');
  }finally{
    btn.disabled=false;
    btn.textContent='ตรวจสถานะ';
  }
}

async function loadManagedStatus(){
  if(!state.manageToken)return;
  showStatus();
  $('#statusLookupFields').classList.add('hidden');
  try{
    const data=await api('registrationStatus',{
      roundCode:state.roundCode,
      manageToken:state.manageToken
    },10000);
    renderStatusResult(data);
  }catch(err){
    $('#statusLookupFields').classList.remove('hidden');
    $('#statusError').textContent='ลิงก์จัดการใบสมัครไม่ถูกต้องหรือหมดอายุ กรุณาใช้เบอร์มือถือและ Email ตรวจสถานะแทน';
    $('#statusError').classList.remove('hidden');
  }
}

function showSubmitted(data){
  clearDraft();
  const reg=data.registration;
  state.lastRegistrationData={
    found:true,
    registration:reg,
    can_cancel:false,
    can_reapply:false
  };

  $('#submittedTitle').textContent=reg.status==='Waitlist'?'อยู่ในรายชื่อสำรองแล้ว':'ได้รับใบสมัครแล้ว';
  $('#submittedText').textContent=reg.status==='Waitlist'
    ?'ที่นั่งยืนยันเต็มแล้ว ระบบบันทึกใบสมัครของคุณเป็น Waitlist และจะแจ้งเมื่อมีสิทธิ์ว่าง'
    :'สถานะตอนนี้คือ รอตรวจสอบ หากได้รับสิทธิ์ ระบบจะส่ง Email ยืนยันพร้อม QR Check-in';
  $('#referenceCode').textContent=`Reference: ${reg.reference_code}`;

  if(data.reapplication){
    $('#duplicateNotice').textContent='ระบบสร้างใบสมัครใหม่จากประวัติที่ถูกยกเลิกหรือไม่ผ่านการอนุมัติก่อนหน้า โดยเก็บประวัติเดิมไว้';
    $('#duplicateNotice').classList.remove('hidden');
  }else{
    $('#duplicateNotice').classList.add('hidden');
  }

  setStep(3);
  $('#regAction').disabled=false;
}

async function next(){
  if(state.step===1){
    if(!validateStep1())return;
    setLoading(true);
    const existing=await lookupExistingRegistration({silent:false});
    if(existing?.found&&ACTIVE_STATUSES.has(existing.registration.status)){
      setLoading(false);
      showStatus(existing);
      return;
    }
    setLoading(false);
    setStep(2);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTo({top:0,behavior:reduced?'auto':'smooth'});
    return;
  }

  if(state.step===3){
    finishRegistrationToEvent();
    return;
  }

  setLoading(true);
  $('#submitError').classList.add('hidden');
  const fd=new FormData($('#regForm'));
  const payload={
    roundCode:state.roundCode,
    clientRequestId:state.clientRequestId,
    data:{
      full_name:fd.get('fullname'),
      nickname:fd.get('nickname'),
      age_range:fd.get('age'),
      phone:normalizeThaiPhone(fd.get('phone')),
      email:String(fd.get('email')||'').trim().toLowerCase(),
      money_style:fd.get('moneyStyle')||'',
      money_goal:fd.get('moneyGoal')||''
    }
  };

  try{
    const data=await registerWithRecovery(payload);
    if(data.already_registered&&data.registration){
      setLoading(false);
      showStatus({found:true,registration:data.registration,can_cancel:false,can_reapply:false});
      return;
    }
    showSubmitted(data);
  }catch(err){
    if(err.data?.registration){
      setLoading(false);
      showStatus({
        found:true,
        registration:err.data.registration,
        can_cancel:false,
        can_reapply:false
      });
      return;
    }
    $('#submitError').textContent=(err.code==='timeout'||err.status===502||err.status===504)
      ?'ระบบตอบช้า แต่ใบสมัครอาจถูกบันทึกแล้ว กด “ส่งใบสมัคร” อีกครั้งได้อย่างปลอดภัย ระบบจะไม่สร้างรายการซ้ำจากการส่งครั้งเดิม'
      :`สมัครไม่สำเร็จ: ${err.message}`;
    $('#submitError').classList.remove('hidden');
    $('#submitError').setAttribute('tabindex','-1');
    $('#submitError').focus();
    setLoading(false);
  }
}

async function sendManageLink(){
  const phone=$('#statusPhone').value||$('#phone').value;
  const email=($('#statusEmail').value||$('#email').value).trim().toLowerCase();
  if(!isValidThaiMobile(phone)||!email){
    $('#statusError').textContent='กรุณาตรวจสถานะด้วยเบอร์มือถือและ Email ก่อนขอลิงก์จัดการ';
    $('#statusError').classList.remove('hidden');
    return;
  }

  const btn=$('#statusManageLinkBtn');
  btn.disabled=true;
  btn.textContent='กำลังส่ง…';
  $('#statusError').classList.add('hidden');
  try{
    await api('sendManageLink',{
      roundCode:state.roundCode,
      phone:normalizeThaiPhone(phone),
      email
    },12000);
    btn.textContent='ส่งแล้ว · ตรวจ Email';
    $('#statusResult').insertAdjacentHTML('beforeend','<div class="notice success compact">หากข้อมูลตรงกับใบสมัคร ระบบส่งลิงก์จัดการให้แล้ว กรุณาตรวจ Inbox และ Spam/Junk</div>');
  }catch(err){
    $('#statusError').textContent=err.message;
    $('#statusError').classList.remove('hidden');
    btn.disabled=false;
    btn.textContent='ส่งลิงก์จัดการไปที่ Email';
  }
}

async function cancelManagedRegistration(){
  if(!state.manageToken)return;
  if(!confirm('ยืนยันยกเลิกใบสมัครนี้? หากต้องการเข้าร่วมอีกครั้ง คุณสามารถสมัครใหม่ได้ภายหลัง'))return;
  const btn=$('#statusCancelBtn');
  btn.disabled=true;
  btn.textContent='กำลังยกเลิก…';
  try{
    const data=await api('cancelRegistration',{
      roundCode:state.roundCode,
      manageToken:state.manageToken
    },12000);
    renderStatusResult(data);
  }catch(err){
    $('#statusError').textContent=err.message;
    $('#statusError').classList.remove('hidden');
  }finally{
    btn.disabled=false;
    btn.textContent='ยกเลิกใบสมัคร';
  }
}

let draftTimer=null;
function draftPayload(){
  const fd=new FormData($('#regForm'));
  return {
    savedAt:Date.now(),
    step:Math.min(state.step,2),
    fields:{
      phone:$('#phone').value,
      email:$('#email').value,
      fullname:$('#fullname').value,
      nickname:$('#nickname').value,
      age:$('#age').value,
      moneyStyle:fd.get('moneyStyle')||'',
      moneyGoal:$('#moneyGoal').value
    }
  };
}
function saveDraft(){
  if(state.step>=3)return;
  try{
    const d=draftPayload();
    const hasValue=Object.values(d.fields).some(v=>String(v||'').trim());
    if(!hasValue){sessionStorage.removeItem(DRAFT_KEY);state.hasDraft=false;return}
    sessionStorage.setItem(DRAFT_KEY,JSON.stringify(d));
    state.hasDraft=true;
  }catch{}
}
function saveDraftSoon(){
  clearTimeout(draftTimer);
  draftTimer=setTimeout(saveDraft,180);
}
function clearDraft(){
  clearTimeout(draftTimer);
  try{sessionStorage.removeItem(DRAFT_KEY)}catch{}
  state.hasDraft=false;
}
function restoreDraft(){
  try{
    const raw=sessionStorage.getItem(DRAFT_KEY);
    if(!raw)return false;
    const d=JSON.parse(raw);
    if(!d?.fields||Date.now()-Number(d.savedAt||0)>12*60*60*1000){clearDraft();return false}
    const f=d.fields;
    $('#phone').value=formatPhone(f.phone||'');
    $('#email').value=f.email||'';
    $('#fullname').value=f.fullname||'';
    $('#nickname').value=f.nickname||'';
    $('#age').value=f.age||'';
    $('#moneyGoal').value=f.moneyGoal||'';
    if(f.moneyStyle){
      const radio=[...document.querySelectorAll('input[name="moneyStyle"]')].find(x=>x.value===f.moneyStyle);
      if(radio)radio.checked=true;
    }
    if(f.moneyStyle||f.moneyGoal)$('#optionalDetails').open=true;
    state.step=Number(d.step)===2?2:1;
    state.hasDraft=true;
    return true;
  }catch{clearDraft();return false}
}

history.replaceState({cashflowView:'event'},'',location.href);
window.addEventListener('popstate',e=>{
  const view=e.state?.cashflowView||'event';
  if(view==='register')setView('#registerView',{push:false});
  else if(view==='status')setView('#statusView',{push:false});
  else showEvent({push:false});
});

window.addEventListener('offline',()=>{
  const box=state.view==='event'?$('#eventError'):$('#submitError');
  if(box){
    box.textContent='อินเทอร์เน็ตหลุดชั่วคราว ข้อมูลที่กรอกยังเก็บไว้ในแท็บนี้ กรุณาเชื่อมต่อแล้วลองอีกครั้ง';
    box.classList.remove('hidden');
  }
});
window.addEventListener('online',()=>{
  if(state.view==='event')loadRound();
});

attachPhoneFormatter($('#phone'));
attachPhoneFormatter($('#statusPhone'));

document.querySelectorAll('#regForm input,#regForm select,#regForm textarea').forEach(el=>{
  ['input','change'].forEach(ev=>el.addEventListener(ev,()=>{
    el.closest('.field')?.classList.remove('invalid');
    el.removeAttribute('aria-invalid');
    saveDraftSoon();
  }));
});

['blur','change'].forEach(ev=>{
  $('#phone').addEventListener(ev,()=>lookupExistingRegistration({silent:true}));
  $('#email').addEventListener(ev,()=>lookupExistingRegistration({silent:true}));
});

$('#moneyGoal').addEventListener('input',()=>{
  const left=500-$('#moneyGoal').value.length;
  $('#moneyGoalCount').textContent=left<100?`เหลือ ${left} ตัวอักษร`:'สูงสุด 500 ตัวอักษร';
});

$('#startBtn').addEventListener('click',showRegister);
$('#statusBtn').addEventListener('click',()=>showStatus());
$('#backToEvent').addEventListener('click',backToEvent);
$('#statusBackBtn').addEventListener('click',backToEvent);
$('#regForm').addEventListener('submit',e=>{
  e.preventDefault();
  next();
});
$('#regBack').addEventListener('click',()=>setStep(1));
$('#editDetailsBtn').addEventListener('click',()=>setStep(1));

$('#statusForm').addEventListener('submit',e=>{
  e.preventDefault();
  lookupStatusFromForm();
});
$('#statusCancelBtn').addEventListener('click',cancelManagedRegistration);
$('#statusManageLinkBtn').addEventListener('click',sendManageLink);
$('#statusReapplyBtn').addEventListener('click',()=>{
  const phone=$('#statusPhone').value;
  const email=$('#statusEmail').value;
  resetRegistrationFlow();
  $('#phone').value=formatPhone(phone);
  $('#email').value=email;
  state.manageToken='';
  showRegister();
});

restoreDraft();
renderRound(DEFAULT_ROUND,{verified:false});
setStep(state.step);
loadRound().then(()=>{
  if(state.hasDraft&&state.round?.status==='Open')$('#startBtn').textContent='กรอกใบสมัครต่อ';
  return loadManagedStatus();
});
