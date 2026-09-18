const state={
  token:sessionStorage.getItem('cashflow_admin_token')||'',
  roundCode:sessionStorage.getItem('cashflow_admin_round')||'',
  currentRound:null,
  registrations:[],
  rounds:[],
  stats:{},
  filter:'Pending',
  stream:null,
  scanning:false,
  scanPaused:false,
  detector:null,
  refreshTimer:null,
  lastSync:0,
  lastQr:'',
  lastQrAt:0
};

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cacheKey=()=>`cashflow_admin_snapshot:${state.roundCode||'active'}`;

async function api(action,payload={},timeoutMs=20000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch('/api/backend',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({action,token:state.token,...payload}),
      signal:controller.signal
    });
    const data=await r.json().catch(()=>({ok:false,error:'invalid_response'}));
    if(!r.ok||data.ok===false){
      const e=new Error(data.message||data.error||'เกิดข้อผิดพลาด');
      e.status=r.status;
      e.data=data;
      throw e;
    }
    return data;
  }catch(err){
    if(err.name==='AbortError'){
      const e=new Error('ระบบตอบช้ากว่าปกติ กรุณาลองใหม่');
      e.code='timeout';
      throw e;
    }
    throw err;
  }finally{
    clearTimeout(timer);
  }
}

function formatClock(ts){
  if(!ts)return '';
  return new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(ts));
}

function setSyncStatus(mode,textValue){
  const el=$('#syncStatus');
  el.className=`sync-pill ${mode||''}`.trim();
  el.textContent=textValue;
}

function showLogin(msg=''){
  stopScanner();
  stopAutoRefresh();
  $('#loginView').classList.remove('hidden');
  $('#adminView').classList.add('hidden');
  if(msg){
    $('#loginError').textContent=msg;
    $('#loginError').classList.remove('hidden');
  }else{
    $('#loginError').classList.add('hidden');
  }
}

function showAdmin(){
  $('#loginView').classList.add('hidden');
  $('#adminView').classList.remove('hidden');
  startAutoRefresh();
}

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  $('#loginError').classList.add('hidden');
  const submit=e.submitter;
  if(submit){submit.disabled=true;submit.textContent='กำลังเข้าสู่ระบบ…'}
  try{
    const data=await api('adminLogin',{password:$('#adminPassword').value});
    state.token=data.token;
    sessionStorage.setItem('cashflow_admin_token',state.token);
    $('#adminPassword').value='';
    showAdmin();
    await loadAll({useCache:true});
  }catch(err){
    showLogin(err.message);
  }finally{
    if(submit){submit.disabled=false;submit.textContent='เข้าสู่ระบบ'}
  }
});

$('#logoutBtn').addEventListener('click',async()=>{
  try{await api('adminLogout')}catch{}
  sessionStorage.removeItem('cashflow_admin_token');
  sessionStorage.removeItem('cashflow_admin_round');
  state.token='';
  state.roundCode='';
  showLogin();
});

function restoreSnapshot(){
  try{
    const raw=sessionStorage.getItem(cacheKey());
    if(!raw)return false;
    const s=JSON.parse(raw);
    if(!s||Date.now()-Number(s.savedAt||0)>10*60*1000)return false;
    applySnapshot(s);
    setSyncStatus('stale',`ข้อมูลล่าสุด ${formatClock(s.savedAt)}`);
    return true;
  }catch{
    return false;
  }
}

function saveSnapshot(){
  try{
    sessionStorage.setItem(cacheKey(),JSON.stringify({
      savedAt:Date.now(),
      round:state.currentRound,
      stats:state.stats,
      registrations:state.registrations,
      rounds:state.rounds
    }));
  }catch{}
}

function applySnapshot(s){
  state.currentRound=s.round||null;
  state.registrations=s.registrations||[];
  state.rounds=s.rounds||[];
  state.stats=s.stats||computeStats();
  if(s.round?.round_code)state.roundCode=s.round.round_code;
  renderAll();
}

function renderHeader(round){
  state.currentRound=round||state.currentRound;
  const r=state.currentRound||{};
  const active=r.is_public_active?' · Public':'';
  $('#adminRoundMeta').textContent=[
    r.title,
    r.event_date_label||r.event_date,
    r.location_name
  ].filter(Boolean).join(' · ')+(active||'');
}

function renderRoundSelector(){
  const select=$('#roundSelector');
  const current=state.roundCode||state.currentRound?.round_code||'';
  select.innerHTML=state.rounds.length
    ?state.rounds.map(r=>`<option value="${esc(r.round_code)}"${r.round_code===current?' selected':''}>${esc(r.title)} · ${esc(r.round_code)}${r.is_public_active?' · Public':''}</option>`).join('')
    :'<option value="">ยังไม่มีรอบ</option>';
  select.disabled=!state.rounds.length;
}

async function fetchBootstrap(){
  try{
    return await api('adminBootstrap',{roundCode:state.roundCode});
  }catch(err){
    if(err.status===401)throw err;
    const roundsResponse=await api('listRounds');
    const rounds=roundsResponse.rounds||[];
    const target=
      rounds.find(r=>r.round_code===state.roundCode)||
      rounds.find(r=>r.is_public_active)||
      rounds.find(r=>r.status==='Open')||
      rounds[0];
    if(!target)throw err;
    state.roundCode=target.round_code;
    sessionStorage.setItem('cashflow_admin_round',state.roundCode);
    const dash=await api('adminDashboard',{roundCode:state.roundCode});
    return {...dash,rounds};
  }
}

async function loadAll({silent=false,useCache=false}={}){
  if(useCache)restoreSnapshot();
  if(!silent)$('#applicantError').classList.add('hidden');
  setSyncStatus('syncing','กำลังซิงก์…');

  try{
    const data=await fetchBootstrap();
    state.currentRound=data.round||null;
    state.registrations=data.registrations||[];
    state.rounds=data.rounds||[];
    state.stats=data.stats||computeStats();
    state.roundCode=data.round?.round_code||state.roundCode;
    if(state.roundCode)sessionStorage.setItem('cashflow_admin_round',state.roundCode);
    state.lastSync=Date.now();
    renderAll();
    saveSnapshot();
    setSyncStatus('ok',`อัปเดต ${formatClock(state.lastSync)}`);
  }catch(err){
    if(err.status===401||err.data?.error==='unauthorized'){
      showLogin('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
      return;
    }
    const staleAt=state.lastSync?formatClock(state.lastSync):'ไม่ทราบเวลา';
    setSyncStatus('error',`ซิงก์ไม่ได้ · ${staleAt}`);
    if(!silent){
      $('#applicantError').textContent=err.message;
      $('#applicantError').classList.remove('hidden');
    }
  }
}

function renderAll(){
  renderHeader(state.currentRound||{});
  renderRoundSelector();
  renderStats(state.stats||computeStats());
  renderApplicants();
  renderRounds();
}

function startAutoRefresh(){
  stopAutoRefresh();
  state.refreshTimer=setInterval(()=>{
    if(document.visibilityState==='visible'&&state.token)loadAll({silent:true});
  },15000);
}

function stopAutoRefresh(){
  if(state.refreshTimer){
    clearInterval(state.refreshTimer);
    state.refreshTimer=null;
  }
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&state.token)loadAll({silent:true});
});

function computeStats(){
  const approved=state.registrations.filter(r=>r.status==='Approved').length;
  const enabled=String(state.currentRound?.capacity_enabled).toLowerCase()==='true';
  const cap=enabled?Number(state.currentRound?.approval_capacity||0):null;
  return {
    total:state.registrations.length,
    pending:state.registrations.filter(r=>r.status==='Pending').length,
    approved,
    waitlist:state.registrations.filter(r=>r.status==='Waitlist').length,
    rejected:state.registrations.filter(r=>r.status==='Rejected').length,
    cancelled:state.registrations.filter(r=>r.status==='Cancelled').length,
    checked_in:state.registrations.filter(r=>!!r.checked_in_at).length,
    capacity_enabled:enabled,
    approval_capacity:cap,
    remaining_seats:enabled&&cap?Math.max(0,cap-approved):null
  };
}

function renderStats(s){
  state.stats=s;
  $('#statTotal').textContent=s.total||0;
  $('#statPending').textContent=s.pending||0;
  $('#statApproved').textContent=s.approved||0;
  $('#statWaitlist').textContent=s.waitlist||0;
  $('#statChecked').textContent=s.checked_in||0;
  $('#statCapacity').textContent=s.capacity_enabled
    ?`${s.remaining_seats??0} / ${s.approval_capacity??0}`
    :'ไม่จำกัด';
}

function patchRegistration(updated){
  const i=state.registrations.findIndex(r=>r.registration_id===updated.registration_id);
  if(i>=0)state.registrations[i]={...state.registrations[i],...updated};
  state.stats=computeStats();
  renderStats(state.stats);
  renderApplicants();
  saveSnapshot();
}

function emailStateLabel(delivery){
  const status=delivery?.status||'NotQueued';
  if(status==='Sent')return 'Email ส่งแล้ว';
  if(status==='Pending'||status==='Sending')return 'Email กำลังส่ง';
  if(status==='Failed')return 'Email ส่งไม่สำเร็จ';
  if(status==='Cancelled')return 'Email ถูกยกเลิก';
  return 'ยังไม่มี Email';
}

function emailStateClass(delivery){
  const status=delivery?.status||'';
  if(status==='Sent')return 'success';
  if(status==='Failed')return 'danger';
  if(status==='Pending'||status==='Sending')return 'warning';
  return 'neutral';
}

function statusActionButtons(r){
  if(r.checked_in_at){
    return '<div class="locked-note">Check-in แล้ว · ล็อกสถานะเพื่อป้องกันข้อมูลขัดแย้ง</div>';
  }

  if(['Rejected','Cancelled'].includes(r.status)){
    return `<button type="button" class="secondary" data-action="Pending" data-id="${esc(r.registration_id)}">คืนเป็น Pending</button>`;
  }

  return [
    r.status!=='Approved'?`<button type="button" class="approve" data-action="Approved" data-id="${esc(r.registration_id)}">Approve</button>`:'',
    r.status!=='Waitlist'?`<button type="button" class="secondary" data-action="Waitlist" data-id="${esc(r.registration_id)}">Waitlist</button>`:'',
    r.status!=='Rejected'?`<button type="button" class="secondary danger" data-action="Rejected" data-id="${esc(r.registration_id)}">Reject</button>`:'',
    r.status==='Approved'?`<button type="button" class="secondary" data-checkin="${esc(r.registration_id)}">Check-in</button>`:''
  ].join('');
}

function renderApplicants(){
  const q=$('#searchInput').value.trim().toLowerCase();
  const list=state.registrations.filter(r=>
    (state.filter==='ALL'||r.status===state.filter)&&
    (!q||[r.full_name,r.nickname,r.phone,r.email,r.reference_code].some(v=>String(v||'').toLowerCase().includes(q)))
  );

  $('#applicantList').innerHTML=list.length?list.map(r=>{
    const duplicate=Number(r.duplicate_contact_count||0)>0
      ?`<span class="meta-chip duplicate">ข้อมูลติดต่อซ้ำ ${Number(r.duplicate_contact_count)} รายการ</span>`:'';
    const email=`<span class="meta-chip ${emailStateClass(r.email_delivery)}">${esc(emailStateLabel(r.email_delivery))}</span>`;
    const reapply=r.reapply_of_registration_id?'<span class="meta-chip neutral">สมัครใหม่จากประวัติเดิม</span>':'';
    const checked=r.checked_in_at?`<span class="meta-chip success">Check-in ${esc(r.checked_in_at)}</span>`:'';

    return `<article class="applicant">
      <div class="applicant-top">
        <div>
          <h3>${esc(r.full_name)} <span class="nickname">(${esc(r.nickname)})</span></h3>
          <p>${esc(r.age_range)} · ${esc(r.phone)} · ${esc(r.email)}</p>
          <p class="reference-line">Reference: <strong>${esc(r.reference_code)}</strong></p>
        </div>
        <span class="badge ${esc(r.status)}">${esc(r.status)}</span>
      </div>
      <div class="meta-row">${duplicate}${email}${reapply}${checked}</div>
      ${r.money_style||r.money_goal?`<div class="answer">${r.money_style?`สไตล์: ${esc(r.money_style)}<br>`:''}${r.money_goal?`อยากเข้าใจ: ${esc(r.money_goal)}`:''}</div>`:''}
      <div class="admin-actions">${statusActionButtons(r)}</div>
    </article>`;
  }).join(''):'<div class="notice">ไม่พบรายการในตัวกรองนี้</div>';

  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>changeStatus(b.dataset.id,b.dataset.action)));
  document.querySelectorAll('[data-checkin]').forEach(b=>b.addEventListener('click',()=>checkIn({registrationId:b.dataset.checkin},{target:'manual'})));
}

async function changeStatus(id,status){
  const reg=state.registrations.find(r=>r.registration_id===id);
  if(!reg)return;

  if(reg.checked_in_at){
    alert('ผู้สมัคร Check-in แล้ว จึงไม่สามารถเปลี่ยนสถานะปกติได้');
    return;
  }

  if(status==='Approved'){
    const cap=state.stats?.capacity_enabled
      ?`\nที่ว่างก่อนอนุมัติ: ${state.stats.remaining_seats??0} / ${state.stats.approval_capacity??0}`:'';
    if(!confirm(`ยืนยัน Approve ${reg.full_name}?${cap}\nระบบอาจส่ง Email ยืนยันพร้อม QR หลังบันทึก`))return;
  }else if(status==='Rejected'){
    if(!confirm(`ยืนยัน Reject ใบสมัครของ ${reg.full_name}?`))return;
  }else if(status==='Pending'&&['Rejected','Cancelled'].includes(reg.status)){
    if(!confirm(`คืนใบสมัครของ ${reg.full_name} เป็น Pending?`))return;
  }

  const btn=document.querySelector(`[data-action="${CSS.escape(status)}"][data-id="${CSS.escape(id)}"]`);
  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='กำลังบันทึก…'}

  try{
    const data=await api('updateRegistrationStatus',{
      registrationId:id,
      status,
      roundCode:state.roundCode
    });
    patchRegistration(data.registration);
    await loadAll({silent:true});
  }catch(err){
    alert(err.message);
    if(btn){btn.disabled=false;btn.textContent=old||status}
  }
}

$('#searchInput').addEventListener('input',renderApplicants);
$('#refreshBtn').addEventListener('click',()=>loadAll());

document.querySelectorAll('.filter-chip').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.filter-chip').forEach(x=>{
    x.classList.remove('active');
    x.setAttribute('aria-pressed','false');
  });
  b.classList.add('active');
  b.setAttribute('aria-pressed','true');
  state.filter=b.dataset.status;
  renderApplicants();
}));

document.querySelectorAll('.admin-nav [data-tab]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.admin-nav [data-tab]').forEach(x=>{
    const active=x===b;
    x.classList.toggle('active',active);
    x.setAttribute('aria-selected',String(active));
  });
  ['applicants','rounds','checkin'].forEach(t=>$('#tab-'+t).classList.toggle('hidden',t!==b.dataset.tab));
  if(b.dataset.tab!=='checkin')stopScanner();
}));

$('#roundSelector').addEventListener('change',async()=>{
  const code=$('#roundSelector').value;
  if(!code||code===state.roundCode)return;
  stopScanner();
  state.roundCode=code;
  sessionStorage.setItem('cashflow_admin_round',code);
  state.filter='Pending';
  $('#searchInput').value='';
  document.querySelectorAll('.filter-chip').forEach(x=>{
    const active=x.dataset.status==='Pending';
    x.classList.toggle('active',active);
    x.setAttribute('aria-pressed',String(active));
  });
  await loadAll({useCache:true});
});

function renderRounds(){
  $('#roundList').innerHTML=state.rounds.length?state.rounds.map(r=>{
    const working=r.round_code===state.roundCode;
    return `<article class="round-item ${working?'working':''}">
      <div class="round-item-head">
        <div>
          <strong>${esc(r.title)}</strong>
          <div>${esc(r.round_code)} · ${esc(r.status)} · ${esc(r.event_date_label||r.event_date||'ยังไม่ระบุวัน')}</div>
        </div>
        <div class="round-badges">
          ${r.is_public_active?'<span class="meta-chip success">Public</span>':''}
          ${working?'<span class="meta-chip neutral">กำลังจัดการ</span>':''}
        </div>
      </div>
      <div class="round-actions">
        <button type="button" class="secondary" data-manage-round="${esc(r.round_code)}">จัดการรอบนี้</button>
        <button type="button" class="secondary" data-edit-round="${esc(r.round_id)}">แก้ไข</button>
        ${r.is_public_active?'':`<button type="button" class="secondary" data-public-round="${esc(r.round_code)}">ตั้งเป็น Public</button>`}
      </div>
    </article>`;
  }).join(''):'<div class="notice">ยังไม่มีรอบ</div>';

  document.querySelectorAll('[data-manage-round]').forEach(b=>b.addEventListener('click',async()=>{
    state.roundCode=b.dataset.manageRound;
    sessionStorage.setItem('cashflow_admin_round',state.roundCode);
    await loadAll({useCache:true});
    document.querySelector('[data-tab="applicants"]')?.click();
  }));
  document.querySelectorAll('[data-edit-round]').forEach(b=>b.addEventListener('click',()=>editRound(b.dataset.editRound)));
  document.querySelectorAll('[data-public-round]').forEach(b=>b.addEventListener('click',()=>setPublicRound(b.dataset.publicRound)));
}

async function setPublicRound(code){
  const round=state.rounds.find(r=>r.round_code===code);
  if(!round)return;
  if(!confirm(`ตั้ง “${round.title}” เป็นรอบ Public เริ่มต้นสำหรับหน้า Participant?`))return;
  try{
    await api('setActiveRound',{roundCode:code});
    await loadAll({silent:true});
  }catch(err){
    alert(err.message);
  }
}

function syncCapacityField(){
  const enabled=$('#capacityEnabled').checked;
  $('#approvalCapacity').disabled=!enabled;
  $('#capacityField').classList.toggle('disabled',!enabled);
}

function resetRoundForm(){
  $('#roundForm').reset();
  $('#roundId').value='';
  $('#roundFormTitle').textContent='สร้างรอบใหม่';
  $('#capacityEnabled').checked=true;
  $('#approvalCapacity').value='30';
  $('#roundError').classList.add('hidden');
  syncCapacityField();
}

function editRound(id){
  const r=state.rounds.find(x=>x.round_id===id);
  if(!r)return;
  $('#roundFormTitle').textContent='แก้ไขรอบ';
  $('#roundId').value=r.round_id||'';
  $('#roundCode').value=r.round_code||'';
  $('#roundTitle').value=r.title||'';
  $('#roundDate').value=r.event_date||'';
  $('#roundDateLabel').value=r.event_date_label||'';
  $('#roundStart').value=r.start_time||'';
  $('#roundEnd').value=r.end_time||'';
  $('#roundLocation').value=r.location_name||'';
  $('#roundLocationUrl').value=r.location_url||'';
  $('#roundStatus').value=r.status||'Draft';
  $('#capacityEnabled').checked=String(r.capacity_enabled).toLowerCase()==='true';
  $('#approvalCapacity').value=r.approval_capacity||30;
  syncCapacityField();
  $('#roundForm').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}

$('#capacityEnabled').addEventListener('change',syncCapacityField);
$('#newRoundBtn').addEventListener('click',()=>{
  resetRoundForm();
  $('#roundForm').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
});
$('#resetRoundBtn').addEventListener('click',resetRoundForm);

$('#roundForm').addEventListener('submit',async e=>{
  e.preventDefault();
  $('#roundError').classList.add('hidden');

  const round={
    round_id:$('#roundId').value,
    round_code:$('#roundCode').value.trim(),
    title:$('#roundTitle').value.trim(),
    event_date:$('#roundDate').value,
    event_date_label:$('#roundDateLabel').value.trim(),
    start_time:$('#roundStart').value,
    end_time:$('#roundEnd').value,
    location_name:$('#roundLocation').value.trim(),
    location_url:$('#roundLocationUrl').value.trim(),
    status:$('#roundStatus').value,
    capacity_enabled:$('#capacityEnabled').checked,
    approval_capacity:$('#capacityEnabled').checked?Number($('#approvalCapacity').value||30):0,
    public_seat_display:$('#capacityEnabled').checked?'จำนวนจำกัด':'ไม่จำกัดจำนวนอนุมัติ'
  };

  const submit=e.submitter;
  const old=submit?.textContent;
  if(submit){submit.disabled=true;submit.textContent='กำลังบันทึก…'}

  try{
    const data=await api('saveRound',{round});
    state.roundCode=data.round.round_code;
    sessionStorage.setItem('cashflow_admin_round',state.roundCode);
    resetRoundForm();
    await loadAll({silent:true});
  }catch(err){
    $('#roundError').textContent=err.message;
    $('#roundError').classList.remove('hidden');
  }finally{
    if(submit){submit.disabled=false;submit.textContent=old}
  }
});

function checkinMessage(data){
  const r=data.registration;
  if(data.already_checked_in){
    return {
      cls:'warning',
      title:'Check-in แล้ว',
      detail:`${r.full_name} (${r.nickname}) · ${r.reference_code}\n${r.checked_in_at||''}`
    };
  }
  return {
    cls:'success',
    title:'Check-in สำเร็จ',
    detail:`${r.full_name} (${r.nickname}) · ${r.reference_code}`
  };
}

function renderCheckinFeedback(container,data){
  const msg=checkinMessage(data);
  container.innerHTML=`<div class="notice ${msg.cls}"><strong>${esc(msg.title)}</strong><br>${esc(msg.detail).replace(/\n/g,'<br>')}</div>`;
}

async function checkIn(payload,{target='manual'}={}){
  const container=target==='scanner'?$('#scanResult'):$('#checkResult');
  try{
    const data=await api('checkIn',{roundCode:state.roundCode,...payload});
    renderCheckinFeedback(container,data);
    patchRegistration(data.registration);
    return {ok:true,data};
  }catch(err){
    container.innerHTML=`<div class="notice error"><strong>Check-in ไม่สำเร็จ</strong><br>${esc(err.message)}</div>`;
    return {ok:false,error:err};
  }
}

async function searchCheckin(){
  const q=$('#checkQuery').value.trim();
  if(q.length<2){
    $('#checkResult').innerHTML='<div class="notice">พิมพ์อย่างน้อย 2 ตัวอักษร หรือใช้ Reference / เบอร์โทร</div>';
    return;
  }
  const btn=$('#checkSearchBtn');
  btn.disabled=true;
  btn.textContent='กำลังค้นหา…';
  try{
    const data=await api('checkinSearch',{roundCode:state.roundCode,query:q});
    const matches=data.matches||[];
    $('#checkResult').innerHTML=matches.length?matches.map(r=>`<article class="applicant compact-card">
      <div class="applicant-top">
        <div>
          <h3>${esc(r.full_name)} <span class="nickname">(${esc(r.nickname)})</span></h3>
          <p>${esc(r.phone)} · ${esc(r.reference_code)}</p>
        </div>
        <span class="badge Approved">${r.checked_in_at?'Checked-in':'Approved'}</span>
      </div>
      <div class="admin-actions">
        ${r.checked_in_at
          ?`<span class="cta-help align-left">Check-in แล้ว ${esc(r.checked_in_at)}</span>`
          :`<button type="button" class="approve" data-check-result="${esc(r.registration_id)}">ยืนยัน Check-in</button>`}
      </div>
    </article>`).join(''):'<div class="notice">ไม่พบผู้ได้รับอนุมัติที่ตรงกับคำค้น</div>';

    document.querySelectorAll('[data-check-result]').forEach(b=>b.addEventListener('click',()=>checkIn({registrationId:b.dataset.checkResult},{target:'manual'})));
  }catch(err){
    $('#checkResult').innerHTML=`<div class="notice error">${esc(err.message)}</div>`;
  }finally{
    btn.disabled=false;
    btn.textContent='ค้นหา';
  }
}

$('#checkSearchBtn').addEventListener('click',searchCheckin);
$('#checkQuery').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    searchCheckin();
  }
});

function parseQr(raw){
  if(raw.startsWith('CF:'))return raw.slice(3);
  try{
    const u=new URL(raw);
    return u.searchParams.get('token')||u.searchParams.get('qr')||raw;
  }catch{
    return raw;
  }
}

function scanCanvasForQr(video){
  if(typeof window.jsQR!=='function')return '';
  if(!video.videoWidth||!video.videoHeight)return '';

  const canvas=$('#scannerCanvas');
  const maxWidth=720;
  const scale=Math.min(1,maxWidth/video.videoWidth);
  const width=Math.max(1,Math.round(video.videoWidth*scale));
  const height=Math.max(1,Math.round(video.videoHeight*scale));
  if(canvas.width!==width||canvas.height!==height){
    canvas.width=width;
    canvas.height=height;
  }
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return '';
  ctx.drawImage(video,0,0,width,height);
  const image=ctx.getImageData(0,0,width,height);
  const code=window.jsQR(image.data,width,height,{inversionAttempts:'dontInvert'});
  return code?.data||'';
}

async function detectQr(video){
  if(state.detector){
    try{
      const codes=await state.detector.detect(video);
      return codes[0]?.rawValue||'';
    }catch{
      state.detector=null;
    }
  }
  return scanCanvasForQr(video);
}

async function handleScannedValue(raw){
  const now=Date.now();
  if(raw===state.lastQr&&now-state.lastQrAt<3000)return;
  state.lastQr=raw;
  state.lastQrAt=now;
  state.scanPaused=true;

  const token=parseQr(raw);
  await checkIn({qrToken:token},{target:'scanner'});
  await sleep(1300);

  if(state.scanning)state.scanPaused=false;
}

async function scannerLoop(){
  if(!state.scanning)return;
  const video=$('#scannerVideo');

  if(!state.scanPaused&&video.readyState>=2){
    try{
      const raw=await detectQr(video);
      if(raw)await handleScannedValue(raw);
    }catch(err){
      $('#scanResult').innerHTML=`<div class="notice error">อ่าน QR ไม่สำเร็จ: ${esc(err.message)}</div>`;
      state.scanPaused=false;
    }
  }

  if(state.scanning)setTimeout(scannerLoop,110);
}

async function startScanner(){
  if(state.scanning){
    stopScanner();
    return;
  }

  $('#scanResult').innerHTML='';
  $('#scanPlaceholder').textContent='กำลังเปิดกล้อง…';

  try{
    state.stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},
      audio:false
    });

    const video=$('#scannerVideo');
    video.srcObject=state.stream;
    video.classList.remove('hidden');
    $('#scanPlaceholder').classList.add('hidden');
    await video.play();

    state.detector=null;
    if('BarcodeDetector' in window){
      try{
        state.detector=new BarcodeDetector({formats:['qr_code']});
      }catch{
        state.detector=null;
      }
    }

    if(!state.detector&&typeof window.jsQR!=='function'){
      throw new Error('อุปกรณ์นี้ไม่มีตัวอ่าน QR ที่รองรับ');
    }

    state.scanning=true;
    state.scanPaused=false;
    $('#scanBtn').textContent='ปิดกล้อง';
    $('#scanBtn').classList.add('danger-action');
    scannerLoop();
  }catch(err){
    stopScanner();
    $('#scanResult').innerHTML=`<div class="notice error"><strong>เปิดกล้องไม่ได้</strong><br>${esc(err.message)}<br>ใช้ค้นหาชื่อ เบอร์ หรือ Reference ด้านล่างแทนได้</div>`;
  }
}

function stopScanner(){
  state.scanning=false;
  state.scanPaused=false;
  state.detector=null;

  if(state.stream){
    state.stream.getTracks().forEach(t=>t.stop());
    state.stream=null;
  }

  const video=$('#scannerVideo');
  if(video){
    video.pause();
    video.srcObject=null;
    video.classList.add('hidden');
  }

  const placeholder=$('#scanPlaceholder');
  if(placeholder){
    placeholder.textContent='พร้อมเปิดกล้อง';
    placeholder.classList.remove('hidden');
  }

  const btn=$('#scanBtn');
  if(btn){
    btn.textContent='เปิดกล้องสแกน';
    btn.classList.remove('danger-action');
  }
}

$('#scanBtn').addEventListener('click',startScanner);

syncCapacityField();
if(state.token){
  showAdmin();
  loadAll({useCache:true});
}else{
  showLogin();
}
