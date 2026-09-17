const DEFAULT_ROUND={round_code:'cashflow-01',title:'CA$HFLOW Meetup',event_date_label:'19 กันยายน',start_time:'16:00',location_name:'Gateway at Bangsue',status:'Open'};
const state={roundCode:new URLSearchParams(location.search).get('round')||'cashflow-01',round:null,step:1,clientRequestId:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`};
const $=s=>document.querySelector(s);
const roundCacheKey=()=>`cashflow_round:${state.roundCode}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function api(action,payload=null,timeoutMs=18000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const opt=payload?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload}),signal:controller.signal}:{signal:controller.signal};
    const url=payload?'/api/backend':`/api/backend?action=${encodeURIComponent(action)}&roundCode=${encodeURIComponent(state.roundCode)}`;
    const r=await fetch(url,opt);
    const data=await r.json().catch(()=>({ok:false,error:'invalid_response'}));
    if(!r.ok||data.ok===false)throw Object.assign(new Error(data.message||data.error||'เกิดข้อผิดพลาด'),{data,status:r.status});
    return data;
  }catch(err){
    if(err.name==='AbortError')throw Object.assign(new Error('ระบบตอบช้ากว่าปกติ'),{code:'timeout'});
    throw err;
  }finally{clearTimeout(timer)}
}

async function registerWithRecovery(payload){
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    try{return await api('register',payload,18000)}catch(err){
      lastErr=err;
      const retryable=err.code==='timeout'||!err.status||err.status===502||err.status===504;
      if(!retryable||attempt===1)break;
      await sleep(700);
    }
  }
  throw lastErr;
}

function setText(id,value){const el=$(id);if(el)el.textContent=value||'—'}
function renderRound(round){
  if(!round)return;
  state.round=round;
  setText('#eventDate',round.event_date_label||round.event_date);
  setText('#eventTime',round.start_time?`เริ่ม ${round.start_time} น.`:'—');
  const loc=$('#eventLocation');loc.textContent=round.location_name||'—';
  if(round.location_url){loc.append(' · ');const a=document.createElement('a');a.href=round.location_url;a.target='_blank';a.rel='noopener';a.textContent='ดูแผนที่ →';loc.append(a)}
  $('#registerMeta').textContent=[round.location_name,round.event_date_label||round.event_date,round.start_time&&`เริ่ม ${round.start_time} น.`].filter(Boolean).join(' · ');
  const open=['Open','Full'].includes(round.status);$('#startBtn').disabled=!open;
  if(!open){$('#eventStatusTitle').textContent='ปิดรับใบสมัครแล้ว';$('#eventStatusText').textContent=`สถานะรอบนี้: ${round.status}`}
  else{$('#eventStatusTitle').textContent='สมัครแล้วรอทีมงานยืนยันสิทธิ์';$('#eventStatusText').textContent='ทีมงานจะตรวจใบสมัครและส่งอีเมลเมื่อได้รับการอนุมัติ'}
}
function readRoundCache(){try{const raw=localStorage.getItem(roundCacheKey());if(!raw)return null;const x=JSON.parse(raw);if(!x||Date.now()-Number(x.savedAt||0)>10*60*1000)return null;return x.round}catch{return null}}
function saveRoundCache(round){try{localStorage.setItem(roundCacheKey(),JSON.stringify({savedAt:Date.now(),round}))}catch{}}
async function loadRound(){
  const cached=readRoundCache();
  renderRound(cached||DEFAULT_ROUND);
  try{const data=await api('publicRound',null,10000);renderRound(data.round);saveRoundCache(data.round);$('#eventError').classList.add('hidden')}
  catch(err){if(!cached){$('#eventError').textContent='กำลังใช้ข้อมูลกิจกรรมล่าสุดที่บันทึกไว้ ระบบจะตรวจสอบข้อมูลอีกครั้งตอนส่งใบสมัคร';$('#eventError').classList.remove('hidden')}}
}
function showRegister(){if(!state.round)return;$('#eventView').classList.add('hidden');$('#registerView').classList.remove('hidden');scrollTo({top:0,behavior:'smooth'})}
function showEvent(){$('#registerView').classList.add('hidden');$('#eventView').classList.remove('hidden');scrollTo({top:0,behavior:'smooth'})}
function validateStep1(){let ok=true;document.querySelectorAll('#step1 .field[data-required]').forEach(field=>{const input=field.querySelector('input,select');const valid=input.checkValidity()&&input.value.trim()!=='';field.classList.toggle('invalid',!valid);if(!valid&&ok){input.focus();ok=false}});return ok}
document.querySelectorAll('#step1 input,#step1 select').forEach(el=>{['input','change'].forEach(ev=>el.addEventListener(ev,()=>el.closest('.field').classList.remove('invalid'))) });
function setLoading(on){const b=$('#regAction');b.disabled=on;b.textContent=on?'กำลังบันทึก…':state.step===1?'ถัดไป':state.step===2?'ส่งใบสมัคร':'กลับหน้ากิจกรรม'}
function showSubmitted(data){
  $('#step2').classList.remove('active');$('#pendingState').classList.add('active');$('#stepLabel').textContent='ส่งแล้ว';$('#regHelp').textContent='ระบบรับข้อมูลแล้ว · Email ยืนยันใบสมัครจะส่งอัตโนมัติ';$('#referenceCode').textContent=`Reference: ${data.registration.reference_code}`;
  if(data.duplicate_warning){$('#duplicateNotice').textContent='พบข้อมูลติดต่อที่เคยสมัครมาก่อน แต่ระบบรับใบสมัครครั้งนี้ไว้ตามปกติ';$('#duplicateNotice').classList.remove('hidden')}
  state.step=3;setLoading(false);
}
async function next(){
  if(state.step===1){if(!validateStep1())return;$('#step1').classList.remove('active');$('#step2').classList.add('active');$('#progress2').classList.add('on');$('#stepLabel').textContent='Step 2/2';$('#regHelp').textContent='ตรวจข้อมูลก่อนส่ง';state.step=2;setLoading(false);scrollTo({top:0,behavior:'smooth'});return}
  if(state.step===3){showEvent();return}
  setLoading(true);$('#submitError').classList.add('hidden');
  const fd=new FormData($('#regForm'));
  const payload={roundCode:state.roundCode,clientRequestId:state.clientRequestId,data:{full_name:fd.get('fullname'),nickname:fd.get('nickname'),age_range:fd.get('age'),phone:fd.get('phone'),email:fd.get('email'),money_style:fd.get('moneyStyle')||'',money_goal:fd.get('moneyGoal')||''}};
  try{const data=await registerWithRecovery(payload);showSubmitted(data)}
  catch(err){$('#submitError').textContent=(err.code==='timeout'||err.status===502||err.status===504)?'ระบบตอบช้า แต่ใบสมัครอาจถูกบันทึกแล้ว กด “ส่งใบสมัคร” อีกครั้งได้อย่างปลอดภัย ระบบจะไม่สร้างรายการซ้ำในรอบนี้':'สมัครไม่สำเร็จ: '+err.message;$('#submitError').classList.remove('hidden');setLoading(false)}
}
$('#startBtn').addEventListener('click',showRegister);$('#backToEvent').addEventListener('click',showEvent);$('#regAction').addEventListener('click',next);
renderRound(DEFAULT_ROUND);loadRound();
