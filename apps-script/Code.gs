const SHEETS={REG:'Registrations',ROUNDS:'Rounds',SETTINGS:'Settings',AUDIT:'AuditLog',MAIL:'EmailQueue'};
const REG_HEADERS=['registration_id','round_code','submitted_at','full_name','nickname','age_range','phone','email','money_style','money_goal','status','reference_code','qr_token','approved_at','checked_in_at','admin_note','updated_at','client_request_id','submission_email_sent_at','approval_email_sent_at','manage_token','cancelled_at','reapply_of_registration_id'];
const ACTIVE_REG_STATUSES=['Pending','Approved','Waitlist'];
const ROUND_HEADERS=['round_id','round_code','title','event_date','event_date_label','start_time','end_time','location_name','location_url','status','capacity_enabled','approval_capacity','public_seat_display','created_at','updated_at'];
const MAIL_HEADERS=['queue_id','type','registration_id','round_code','to_email','status','created_at','attempts','last_error','sent_at'];
const BRAND={ink:'#17121d',plum:'#321842',purple:'#6b33a0',yellow:'#f6ca2f',yellow2:'#ffe66a',paper:'#fffaf2',muted:'#716878',line:'#ded5e3',success:'#216b50'};

function onOpen(){SpreadsheetApp.getUi().createMenu('Cashflow System').addItem('ตรวจ/เตรียมฐานข้อมูล','setupCashflow').addItem('ตั้งรหัส Admin','setupAdminPassword').addItem('ทดสอบส่ง Email Queue','processEmailQueue').addToUi();}

function setupCashflow(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw new Error('กรุณาเปิด Apps Script จาก Google Sheet นี้');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID',ss.getId());
  ensureSheet_(ss,SHEETS.REG,REG_HEADERS);
  ensureSheet_(ss,SHEETS.ROUNDS,ROUND_HEADERS);
  ensureSheet_(ss,SHEETS.SETTINGS,['key','value','description']);
  ensureSheet_(ss,SHEETS.AUDIT,['timestamp','actor','action','round_code','registration_id','detail']);
  ensureSheet_(ss,SHEETS.MAIL,MAIL_HEADERS);
  installEmailQueueTrigger_();
  SpreadsheetApp.getUi().alert('ฐานข้อมูลและ Email Queue พร้อมแล้ว');
}

function setupAdminPassword(){
  const ui=SpreadsheetApp.getUi();
  const r=ui.prompt('ตั้งรหัส Admin','ใช้รหัสที่คาดเดายากอย่างน้อย 8 ตัวอักษร',ui.ButtonSet.OK_CANCEL);
  if(r.getSelectedButton()!==ui.Button.OK)return;
  const p=r.getResponseText();
  if(!p||p.length<8)throw new Error('รหัสต้องยาวอย่างน้อย 8 ตัวอักษร');
  const props=PropertiesService.getScriptProperties();
  const salt=Utilities.getUuid().replace(/-/g,'');
  props.setProperty('ADMIN_PASSWORD_SALT',salt);
  props.setProperty('ADMIN_PASSWORD_HASH',sha256Hex_(salt+':'+p));
  ui.alert('ตั้งรหัส Admin แล้ว');
}

function doGet(e){
  try{
    const a=(e&&e.parameter&&e.parameter.action)||'health';
    if(a==='health')return json_({ok:true,configured:isConfigured_(),version:'2.0'});
    if(a==='publicRound')return json_({ok:true,...publicRound_((e.parameter||{}).roundCode)});
    return json_({ok:false,error:'unknown_action'},400);
  }catch(err){return json_({ok:false,error:'server_error',message:userMessage_(err.message)},500)}
}

function doPost(e){
  try{
    const body=JSON.parse((e.postData&&e.postData.contents)||'{}');
    const a=body.action;let out;
    if(a==='register')out=register_(body);
    else if(a==='registrationStatus')out=registrationStatus_(body);
    else if(a==='cancelRegistration')out=cancelRegistration_(body);
    else if(a==='adminLogin')out=adminLogin_(body.password);
    else if(a==='adminLogout')out=adminLogout_(body.token);
    else if(a==='adminBootstrap'){requireAdmin_(body.token);out=adminBootstrap_(body.roundCode)}
    else if(a==='adminDashboard'){requireAdmin_(body.token);out=adminDashboard_(body.roundCode)}
    else if(a==='updateRegistrationStatus'){requireAdmin_(body.token);out=updateRegistrationStatus_(body)}
    else if(a==='checkinSearch'){requireAdmin_(body.token);out=checkinSearch_(body)}
    else if(a==='checkIn'){requireAdmin_(body.token);out=checkIn_(body)}
    else if(a==='listRounds'){requireAdmin_(body.token);out={rounds:listRoundsForAdmin_()}}
    else if(a==='setActiveRound'){requireAdmin_(body.token);out=setActiveRound_(body.roundCode)}
    else if(a==='saveRound'){requireAdmin_(body.token);out=saveRound_(body.round)}
    else throw new Error('unknown_action');
    return json_({ok:true,...out});
  }catch(err){
    const code=err.message==='unauthorized'?401:400;
    return json_({ok:false,error:err.message==='unauthorized'?'unauthorized':'request_failed',message:userMessage_(err.message)},code);
  }
}

function userMessage_(m){
  const map={
    unauthorized:'Session ไม่ถูกต้องหรือหมดอายุ',
    admin_not_configured:'ยังไม่ได้ตั้งรหัส Admin',
    round_not_found:'ไม่พบรอบกิจกรรม',
    round_closed:'รอบนี้ปิดรับใบสมัครแล้ว',
    capacity_full:'จำนวนอนุมัติเต็มแล้ว',
    registration_not_found:'ไม่พบผู้สมัคร',
    invalid_email:'Email ไม่ถูกต้อง',
    invalid_phone:'เบอร์มือถือไม่ถูกต้อง',
    missing_required_fields:'กรอกข้อมูลที่จำเป็นไม่ครบ',
    duplicate_round_code:'Round code ซ้ำ',
    backend_not_configured:'Backend ยังตั้งค่าไม่ครบ',
    invalid_status:'สถานะไม่ถูกต้อง',
    contact_conflict:'เบอร์มือถือหรือ Email นี้มีใบสมัครที่ยังใช้งานอยู่ในรอบนี้แล้ว กรุณาเช็กสถานะใบสมัครเดิม',
    checked_in_locked:'ผู้สมัคร Check-in แล้ว จึงไม่สามารถเปลี่ยนสถานะปกติได้',
    invalid_manage_token:'ลิงก์จัดการใบสมัครไม่ถูกต้อง'
  };
  return map[m]||m;
}

function publicRound_(code){
  const requested=clean_(code,60);
  const key='publicRound:'+(requested||'active');
  const cached=cacheGet_(key);
  if(cached)return cached;
  const round=findRound_(requested);
  if(!round)throw new Error('round_not_found');

  const regs=listRows_(SHEETS.REG);
  const approved=regs.reduce((n,r)=>n+(r.round_code===round.round_code&&r.status==='Approved'?1:0),0);
  const cap=Number(round.approval_capacity||0);
  const capacityEnabled=truthy_(round.capacity_enabled);
  const isFull=round.status==='Open'&&capacityEnabled&&cap>0&&approved>=cap;
  const result={
    round:{
      ...round,
      stored_status:round.status,
      status:isFull?'Full':round.status,
      approved_count:approved,
      remaining_seats:capacityEnabled&&cap?Math.max(0,cap-approved):null,
      registration_mode:isFull?'waitlist':'standard'
    }
  };
  cachePut_(key,result,20);
  return result;
}

function register_(body){
  const d=body.data||{};
  const required=['full_name','nickname','age_range','phone','email'];
  if(required.some(k=>!clean_(d[k],k==='email'?254:120)))throw new Error('missing_required_fields');

  const email=clean_(d.email,254).toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(email))throw new Error('invalid_email');

  const phone=normalizeThaiPhone_(d.phone);
  if(!/^0[689]\d{8}$/.test(phone))throw new Error('invalid_phone');

  const round=findRound_(body.roundCode);
  if(!round)throw new Error('round_not_found');
  if(round.status!=='Open')throw new Error('round_closed');

  const clientId=clean_(body.clientRequestId,120)||Utilities.getUuid();
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const all=listRowsWithRow_(SHEETS.REG);
    const existingRequest=all.find(r=>r.client_request_id===clientId);
    if(existingRequest){
      return {
        registration:publicRegistration_(existingRequest),
        already_registered:false,
        idempotent:true,
        email_queued:false
      };
    }

    const activeMatches=all.filter(r=>
      r.round_code===round.round_code&&
      ACTIVE_REG_STATUSES.includes(r.status)&&
      (normalizeThaiPhone_(r.phone)===phone||String(r.email||'').toLowerCase()===email)
    );
    const exactActive=activeMatches.find(r=>
      normalizeThaiPhone_(r.phone)===phone&&String(r.email||'').toLowerCase()===email
    );
    if(exactActive){
      return {
        registration:publicRegistration_(exactActive),
        already_registered:true,
        duplicate_warning:true,
        idempotent:false,
        email_queued:false
      };
    }
    if(activeMatches.length)throw new Error('contact_conflict');

    const inactiveExact=all.filter(r=>
      r.round_code===round.round_code&&
      ['Rejected','Cancelled'].includes(r.status)&&
      normalizeThaiPhone_(r.phone)===phone&&
      String(r.email||'').toLowerCase()===email
    ).sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];

    const cap=Number(round.approval_capacity||0);
    const approved=all.reduce((n,r)=>n+(r.round_code===round.round_code&&r.status==='Approved'?1:0),0);
    const full=truthy_(round.capacity_enabled)&&cap>0&&approved>=cap;
    const now=now_();
    const row={
      registration_id:Utilities.getUuid(),
      round_code:round.round_code,
      submitted_at:now,
      full_name:clean_(d.full_name,100),
      nickname:clean_(d.nickname,40),
      age_range:clean_(d.age_range,40),
      phone,
      email,
      money_style:clean_(d.money_style,80),
      money_goal:clean_(d.money_goal,500),
      status:full?'Waitlist':'Pending',
      reference_code:uniqueReferenceFromRows_(all),
      qr_token:Utilities.getUuid(),
      approved_at:'',
      checked_in_at:'',
      admin_note:'',
      updated_at:now,
      client_request_id:clientId,
      submission_email_sent_at:'',
      approval_email_sent_at:'',
      manage_token:newOpaqueToken_(),
      cancelled_at:'',
      reapply_of_registration_id:inactiveExact?inactiveExact.registration_id:''
    };

    appendObject_(SHEETS.REG,REG_HEADERS,row);
    enqueueEmail_('submission',row,round);
    audit_(
      'participant',
      full?'register_waitlist':'register',
      round.round_code,
      row.registration_id,
      inactiveExact?'reapplication':''
    );
    invalidateDataCache_(round.round_code);

    return {
      registration:publicRegistration_(row),
      reapplication:!!inactiveExact,
      waitlist:full,
      already_registered:false,
      idempotent:false,
      email_queued:true
    };
  }finally{
    lock.releaseLock();
  }
}

function registrationStatus_(body){
  const all=listRows_(SHEETS.REG);
  const token=clean_(body.manageToken,160);
  let reg=null;

  if(token){
    reg=all.find(r=>r.manage_token===token)||null;
    if(!reg)throw new Error('invalid_manage_token');
    if(body.roundCode&&reg.round_code!==clean_(body.roundCode,60))throw new Error('registration_not_found');
  }else{
    const phone=normalizeThaiPhone_(body.phone);
    const email=clean_(body.email,254).toLowerCase();
    if(!/^0[689]\d{8}$/.test(phone))throw new Error('invalid_phone');
    if(!/^\S+@\S+\.\S+$/.test(email))throw new Error('invalid_email');
    const round=findRound_(body.roundCode);
    if(!round)throw new Error('round_not_found');

    const matches=all.filter(r=>
      r.round_code===round.round_code&&
      normalizeThaiPhone_(r.phone)===phone&&
      String(r.email||'').toLowerCase()===email
    ).sort((a,b)=>{
      const activeDelta=(ACTIVE_REG_STATUSES.includes(b.status)?1:0)-(ACTIVE_REG_STATUSES.includes(a.status)?1:0);
      return activeDelta||String(b.submitted_at).localeCompare(String(a.submitted_at));
    });
    reg=matches[0]||null;
  }

  if(!reg)return {found:false};
  return registrationStatusResponse_(reg);
}

function cancelRegistration_(body){
  const token=clean_(body.manageToken,160);
  if(!token)throw new Error('invalid_manage_token');

  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const all=listRowsWithRow_(SHEETS.REG);
    const reg=all.find(r=>r.manage_token===token);
    if(!reg)throw new Error('invalid_manage_token');
    if(body.roundCode&&reg.round_code!==clean_(body.roundCode,60))throw new Error('registration_not_found');
    if(reg.checked_in_at)throw new Error('checked_in_locked');
    if(reg.status==='Cancelled')return registrationStatusResponse_(reg);
    if(!ACTIVE_REG_STATUSES.includes(reg.status))return registrationStatusResponse_(reg);

    const now=now_();
    const patch={status:'Cancelled',cancelled_at:now,updated_at:now};
    updateObjectRow_(SHEETS.REG,reg.__row,patch);
    cancelQueuedApprovalEmails_(reg.registration_id);
    audit_('participant','cancel_registration',reg.round_code,reg.registration_id,'');
    invalidateDataCache_(reg.round_code);

    const updated={...reg,...patch};
    delete updated.__row;
    return registrationStatusResponse_(updated);
  }finally{
    lock.releaseLock();
  }
}

function adminLogin_(password){
  const props=PropertiesService.getScriptProperties();
  const expected=props.getProperty('ADMIN_PASSWORD_HASH');
  const salt=props.getProperty('ADMIN_PASSWORD_SALT');
  if(!expected||!salt)throw new Error('admin_not_configured');
  const cache=CacheService.getScriptCache();
  const fail=Number(cache.get('admin_fail_count')||0);
  if(fail>=10)throw new Error('ลองใหม่อีกครั้งภายหลัง');
  if(sha256Hex_(salt+':'+String(password||''))!==expected){cache.put('admin_fail_count',String(fail+1),300);throw new Error('unauthorized')}
  cache.remove('admin_fail_count');
  const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  const minutes=Math.min(360,Math.max(5,Number(getSetting_('admin_session_minutes')||360)));
  const ttl=Math.round(minutes*60);cache.put('session:'+token,'admin',ttl);
  return {token,expires_in_seconds:ttl};
}

function adminLogout_(token){if(token)CacheService.getScriptCache().remove('session:'+token);return {logged_out:true}}
function requireAdmin_(token){if(!token||CacheService.getScriptCache().get('session:'+token)!=='admin')throw new Error('unauthorized')}

function adminBootstrap_(roundCode){
  const rounds=listRoundsForAdmin_();
  const target=findRound_(roundCode);
  if(!target)throw new Error('round_not_found');
  const regs=listRows_(SHEETS.REG)
    .filter(r=>r.round_code===target.round_code)
    .sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at)));
  return {...dashboardFrom_(target,regs),rounds};
}

function adminDashboard_(roundCode){
  const round=findRound_(roundCode);
  if(!round)throw new Error('round_not_found');
  const regs=listRows_(SHEETS.REG)
    .filter(r=>r.round_code===round.round_code)
    .sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at)));
  return dashboardFrom_(round,regs);
}

function dashboardFrom_(round,regs){
  const mail=listRows_(SHEETS.MAIL);
  const registrations=decorateAdminRegistrations_(regs,mail);
  const cap=Number(round.approval_capacity||0);
  const approved=countStatus_(regs,'Approved');
  const capacityEnabled=truthy_(round.capacity_enabled);
  const activeCode=getSetting_('active_round_code');

  return {
    round:{...round,is_public_active:round.round_code===activeCode},
    stats:{
      total:regs.length,
      pending:countStatus_(regs,'Pending'),
      approved,
      waitlist:countStatus_(regs,'Waitlist'),
      rejected:countStatus_(regs,'Rejected'),
      cancelled:countStatus_(regs,'Cancelled'),
      checked_in:regs.filter(r=>!!r.checked_in_at).length,
      capacity_enabled:capacityEnabled,
      approval_capacity:capacityEnabled?cap:null,
      remaining_seats:capacityEnabled&&cap?Math.max(0,cap-approved):null
    },
    registrations
  };
}

function countStatus_(rows,status){
  return rows.reduce((n,r)=>n+(r.status===status?1:0),0);
}

function updateRegistrationStatus_(body){
  const status=String(body.status||'');
  if(!['Pending','Approved','Waitlist','Rejected','Cancelled'].includes(status))throw new Error('invalid_status');

  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const all=listRowsWithRow_(SHEETS.REG);
    const reg=all.find(r=>r.registration_id===body.registrationId);
    if(!reg)throw new Error('registration_not_found');
    if(reg.checked_in_at&&status!=='Approved')throw new Error('checked_in_locked');

    const round=findRound_(reg.round_code);
    if(!round)throw new Error('round_not_found');

    if(status==='Approved'&&reg.status!=='Approved'&&truthy_(round.capacity_enabled)){
      const cap=Number(round.approval_capacity||0);
      const approved=all.reduce((n,r)=>n+(r.round_code===round.round_code&&r.status==='Approved'?1:0),0);
      if(cap&&approved>=cap)throw new Error('capacity_full');
    }

    if(reg.status==='Approved'&&status!=='Approved'){
      cancelQueuedApprovalEmails_(reg.registration_id);
    }

    const now=now_();
    const patch={status,updated_at:now};
    if(status==='Approved'&&!reg.approved_at)patch.approved_at=now;
    if(status==='Cancelled'&&!reg.cancelled_at)patch.cancelled_at=now;

    updateObjectRow_(SHEETS.REG,reg.__row,patch);
    const updated={...reg,...patch};
    delete updated.__row;

    let emailQueued=false;
    if(
      status==='Approved'&&
      reg.status!=='Approved'&&
      !updated.approval_email_sent_at&&
      !hasOpenEmailQueue_('approval',updated.registration_id)
    ){
      enqueueEmail_('approval',updated,round);
      emailQueued=true;
    }

    audit_('admin','status:'+status,reg.round_code,reg.registration_id,clean_(body.note,300));
    invalidateDataCache_(reg.round_code);

    return {
      registration:adminRegistration_(updated),
      email_queued:emailQueued
    };
  }finally{
    lock.releaseLock();
  }
}

function checkinSearch_(body){
  const q=clean_(body.query,150).toLowerCase();if(!q||q.length<2)return {matches:[]};
  const phone=normalizePhone_(q);
  const regs=listRows_(SHEETS.REG).filter(r=>(!body.roundCode||r.round_code===body.roundCode)&&r.status==='Approved');
  const matches=regs.filter(r=>String(r.reference_code||'').toLowerCase()===q||(phone.length>=4&&normalizePhone_(r.phone).includes(phone))||String(r.full_name||'').toLowerCase().includes(q)||String(r.nickname||'').toLowerCase().includes(q)).slice(0,10).map(adminRegistration_);
  return {matches};
}

function checkIn_(body){
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const all=listRowsWithRow_(SHEETS.REG);
    const reg=all.find(r=>(!body.roundCode||r.round_code===body.roundCode)&&((body.registrationId&&r.registration_id===body.registrationId)||(body.qrToken&&r.qr_token===body.qrToken)));
    if(!reg)throw new Error('registration_not_found');
    if(reg.status!=='Approved')throw new Error('ผู้สมัครยังไม่ได้รับการอนุมัติ');
    if(reg.checked_in_at)return {registration:adminRegistration_(reg),already_checked_in:true};
    const now=now_();updateObjectRow_(SHEETS.REG,reg.__row,{checked_in_at:now,updated_at:now});
    audit_('admin','check_in',reg.round_code,reg.registration_id,'');invalidateDataCache_(reg.round_code);
    reg.checked_in_at=now;reg.updated_at=now;delete reg.__row;
    return {registration:adminRegistration_(reg),already_checked_in:false};
  }finally{lock.releaseLock()}
}

function saveRound_(input){
  const r=input||{};
  const code=clean_(r.round_code,60);
  const title=clean_(r.title,120);
  if(!code||!title)throw new Error('กรอก Round code และชื่อรอบ');

  const all=listRowsWithRow_(SHEETS.ROUNDS);
  if(all.find(x=>x.round_code===code&&x.round_id!==r.round_id))throw new Error('duplicate_round_code');

  const enabled=truthy_(r.capacity_enabled);
  const now=now_();
  const obj={
    round_id:r.round_id||Utilities.getUuid(),
    round_code:code,
    title,
    event_date:clean_(r.event_date,20),
    event_date_label:clean_(r.event_date_label,80),
    start_time:clean_(r.start_time,10),
    end_time:clean_(r.end_time,10),
    location_name:clean_(r.location_name,160),
    location_url:clean_(r.location_url,500),
    status:['Draft','Open','Closed','Completed','Cancelled'].includes(r.status)?r.status:'Draft',
    capacity_enabled:enabled,
    approval_capacity:enabled?Math.max(1,Number(r.approval_capacity||30)):'',
    public_seat_display:enabled?(clean_(r.public_seat_display,80)||'จำนวนจำกัด'):'ไม่จำกัดจำนวนอนุมัติ',
    updated_at:now
  };

  if(r.round_id){
    const ref=all.find(x=>x.round_id===r.round_id);
    if(!ref)throw new Error('round_not_found');
    if(ref.round_code!==code&&listRows_(SHEETS.REG).some(x=>x.round_code===ref.round_code)){
      throw new Error('เปลี่ยน Round code ไม่ได้หลังมีผู้สมัครแล้ว');
    }
    updateObjectRow_(SHEETS.ROUNDS,ref.__row,obj);
  }else{
    obj.created_at=now;
    appendObject_(SHEETS.ROUNDS,ROUND_HEADERS,obj);
  }

  audit_('admin',r.round_id?'update_round':'create_round',code,'',title);
  invalidateDataCache_(code);
  invalidateRoundListCache_();
  return {round:{...obj,is_public_active:code===getSetting_('active_round_code')}};
}

function setActiveRound_(roundCode){
  const round=findRound_(clean_(roundCode,60));
  if(!round)throw new Error('round_not_found');
  setSetting_('active_round_code',round.round_code,'Public participant round used when URL has no explicit ?round=');
  CacheService.getScriptCache().remove('publicRound:active');
  audit_('admin','set_active_round',round.round_code,'',round.title||'');
  return {round:{...round,is_public_active:true}};
}

function listRoundsForAdmin_(){
  const active=getSetting_('active_round_code');
  return listRows_(SHEETS.ROUNDS).map(r=>({...r,is_public_active:r.round_code===active}));
}

function enqueueEmail_(type,reg,round){
  if(!reg.email)return false;
  const now=now_();
  appendObject_(SHEETS.MAIL,MAIL_HEADERS,{queue_id:Utilities.getUuid(),type,registration_id:reg.registration_id,round_code:round.round_code,to_email:reg.email,status:'Pending',created_at:now,attempts:0,last_error:'',sent_at:''});
  return true;
}

function installEmailQueueTrigger_(){
  const exists=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='processEmailQueue');
  if(!exists)ScriptApp.newTrigger('processEmailQueue').timeBased().everyMinutes(1).create();
}

function processEmailQueue(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(5000))return;
  try{
    const queue=listRowsWithRow_(SHEETS.MAIL)
      .filter(q=>q.status==='Pending'&&Number(q.attempts||0)<5)
      .slice(0,20);
    if(!queue.length)return;

    const regs=listRows_(SHEETS.REG);
    const rounds=listRows_(SHEETS.ROUNDS);
    const regMap=Object.fromEntries(regs.map(r=>[r.registration_id,r]));
    const roundMap=Object.fromEntries(rounds.map(r=>[r.round_code,r]));

    queue.forEach(q=>{
      let reg=regMap[q.registration_id];
      const round=roundMap[q.round_code];

      if(!reg||!round){
        updateObjectRow_(SHEETS.MAIL,q.__row,{
          status:'Failed',
          attempts:Number(q.attempts||0)+1,
          last_error:'missing registration or round'
        });
        return;
      }

      if(q.type==='approval'&&(reg.status!=='Approved'||reg.approval_email_sent_at)){
        updateObjectRow_(SHEETS.MAIL,q.__row,{status:'Cancelled',last_error:'registration no longer eligible for approval email'});
        return;
      }

      if(q.type==='submission'&&reg.status==='Cancelled'){
        updateObjectRow_(SHEETS.MAIL,q.__row,{status:'Cancelled',last_error:'registration cancelled before submission email'});
        return;
      }

      reg=ensureManageToken_(reg);
      regMap[reg.registration_id]=reg;

      updateObjectRow_(SHEETS.MAIL,q.__row,{
        status:'Sending',
        attempts:Number(q.attempts||0)+1,
        last_error:''
      });

      try{
        if(q.type==='submission')sendSubmissionEmail_(reg,round);
        else if(q.type==='approval')sendApprovalEmail_(reg,round);
        else throw new Error('unknown email type');

        const sentAt=now_();
        updateObjectRow_(SHEETS.MAIL,q.__row,{status:'Sent',sent_at:sentAt,last_error:''});
        const ref=findRowBy_(SHEETS.REG,'registration_id',reg.registration_id);
        if(ref){
          updateObjectRow_(SHEETS.REG,ref.row,{
            [q.type==='submission'?'submission_email_sent_at':'approval_email_sent_at']:sentAt,
            updated_at:sentAt
          });
        }
        audit_('system',q.type+'_email_sent',reg.round_code,reg.registration_id,'');
      }catch(err){
        const attempts=Number(q.attempts||0)+1;
        updateObjectRow_(SHEETS.MAIL,q.__row,{
          status:attempts>=5?'Failed':'Pending',
          attempts,
          last_error:clean_(String(err.message||err),500)
        });
        audit_('system',q.type+'_email_failed',reg.round_code,reg.registration_id,String(err.message||err));
      }
    });
  }finally{
    lock.releaseLock();
  }
}

function sendSubmissionEmail_(reg,round){
  const waitlist=reg.status==='Waitlist';
  const subject=`${waitlist?'รายชื่อสำรอง':'รับใบสมัครแล้ว'} · ${round.title||'CA$HFLOW Meetup'}`;
  const manageBtn=manageButtonHtml_(reg,round);
  const html=mailShell_({
    badge:waitlist?'WAITLIST':'PENDING REVIEW',
    badgeBg:BRAND.yellow2,
    badgeColor:BRAND.ink,
    eyebrow:'CA$HFLOW MEETUP',
    title:waitlist?'อยู่ในรายชื่อสำรองแล้ว':'เราได้รับใบสมัครแล้ว',
    intro:waitlist
      ?`สวัสดี ${escapeHtml_(reg.nickname||reg.full_name)} ที่นั่งยืนยันของรอบนี้เต็มแล้ว ระบบบันทึกใบสมัครของคุณเป็น <b>รายชื่อสำรอง</b> และจะแจ้งเมื่อได้รับสิทธิ์`
      :`สวัสดี ${escapeHtml_(reg.nickname||reg.full_name)} ตอนนี้ใบสมัครของคุณอยู่ในสถานะ <b>รอตรวจสอบ</b> และยังไม่ถือว่าได้รับสิทธิ์เข้าร่วม`,
    body:eventCardHtml_(round)+referenceCardHtml_(reg.reference_code,'เลขอ้างอิงใบสมัคร')+manageBtn+
      `<p style="margin:20px 0 0;color:${BRAND.muted};font-size:13px;line-height:1.7">เมื่อได้รับการอนุมัติ เราจะส่ง Email อีกครั้งพร้อม QR สำหรับ Check-in</p>`,
    footer:'Email นี้ส่งอัตโนมัติหลังจากส่งใบสมัคร'
  });
  MailApp.sendEmail({
    to:reg.email,
    subject,
    htmlBody:html,
    name:getSetting_('email_sender_name')||'CA$HFLOW Meetup'
  });
}

function sendApprovalEmail_(reg,round){
  const subject=`ยืนยันสิทธิ์แล้ว · ${round.title||'CA$HFLOW Meetup'}`;
  const qrText='CF:'+reg.qr_token;
  const qrUrl='https://quickchart.io/qr?size=320&margin=1&text='+encodeURIComponent(qrText);
  let qrHtml=`<div style="text-align:center;padding:18px"><div style="font-size:13px;color:${BRAND.muted}">QR Check-in</div><div style="margin-top:8px;font-weight:800">${escapeHtml_(reg.reference_code)}</div></div>`;
  let inlineImages={};
  try{
    const resp=UrlFetchApp.fetch(qrUrl,{muteHttpExceptions:true,followRedirects:true});
    if(resp.getResponseCode()===200){
      inlineImages.qr=resp.getBlob().setName('cashflow-checkin.png');
      qrHtml='<div style="text-align:center;padding:8px 0 4px"><img src="cid:qr" width="220" height="220" alt="QR Check-in" style="display:block;margin:0 auto;border:0"><div style="font-size:12px;color:#716878;margin-top:8px">แสดง QR นี้ที่จุด Check-in</div></div>';
    }
  }catch(e){}

  const calendar=calendarLink_(round);
  const locationBtn=round.location_url
    ?`<a href="${escapeAttr_(round.location_url)}" style="display:inline-block;background:${BRAND.paper};color:${BRAND.ink};border:2px solid ${BRAND.ink};border-radius:999px;padding:11px 16px;text-decoration:none;font-weight:800;margin:6px">ดูแผนที่</a>`
    :'';
  const calBtn=calendar
    ?`<a href="${escapeAttr_(calendar)}" style="display:inline-block;background:${BRAND.yellow};color:${BRAND.ink};border:2px solid ${BRAND.ink};border-radius:999px;padding:11px 16px;text-decoration:none;font-weight:800;margin:6px">เพิ่มลงปฏิทิน</a>`
    :'';

  const html=mailShell_({
    badge:'APPROVED',
    badgeBg:BRAND.yellow,
    badgeColor:BRAND.ink,
    eyebrow:'CA$HFLOW MEETUP',
    title:'ยืนยันสิทธิ์เรียบร้อยแล้ว',
    intro:`สวัสดี ${escapeHtml_(reg.nickname||reg.full_name)} ใบสมัครของคุณได้รับการอนุมัติแล้ว เตรียมมาเล่นและตัดสินใจเรื่องเงินจริงผ่านเกมกัน`,
    body:referenceCardHtml_(reg.reference_code,'Reference Code')+
      eventCardHtml_(round)+qrHtml+
      `<div style="text-align:center;margin-top:12px">${calBtn}${locationBtn}</div>`+
      manageButtonHtml_(reg,round),
    footer:'Email นี้ส่งอัตโนมัติเมื่อทีมงานอนุมัติใบสมัคร'
  });

  const options={
    to:reg.email,
    subject,
    htmlBody:html,
    name:getSetting_('email_sender_name')||'CA$HFLOW Meetup'
  };
  if(Object.keys(inlineImages).length)options.inlineImages=inlineImages;
  MailApp.sendEmail(options);
}

function mailShell_(x){
  return `<!doctype html><html><body style="margin:0;background:#f3eef5;font-family:Arial,'Noto Sans Thai',sans-serif;color:${BRAND.ink}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3eef5"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid ${BRAND.line}"><tr><td style="background:${BRAND.ink};padding:28px 28px 26px"><div style="color:${BRAND.yellow};font-size:13px;font-weight:800;letter-spacing:1.6px">${escapeHtml_(x.eyebrow)}</div><div style="margin-top:9px;color:#ffffff;font-size:34px;line-height:1.15;font-weight:900">CA<span style="color:${BRAND.yellow}">$</span>HFLOW</div><div style="margin-top:18px"><span style="display:inline-block;background:${x.badgeBg};color:${x.badgeColor};border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900">${escapeHtml_(x.badge)}</span></div><h1 style="margin:16px 0 0;color:#ffffff;font-size:28px;line-height:1.3">${escapeHtml_(x.title)}</h1></td></tr><tr><td style="padding:28px"><div style="font-size:15px;line-height:1.8;color:#3d3442">${x.intro}</div><div style="margin-top:22px">${x.body}</div></td></tr><tr><td style="background:${BRAND.paper};padding:18px 28px;border-top:1px solid ${BRAND.line};color:${BRAND.muted};font-size:12px;line-height:1.6">${escapeHtml_(x.footer)}<br>CA$HFLOW Meetup</td></tr></table></td></tr></table></body></html>`;
}

function eventCardHtml_(round){
  const date=escapeHtml_(round.event_date_label||round.event_date||'จะแจ้งให้ทราบ');const time=escapeHtml_(round.start_time?`เริ่ม ${round.start_time} น.`:'จะแจ้งให้ทราบ');const location=escapeHtml_(round.location_name||'จะแจ้งให้ทราบ');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:2px solid ${BRAND.ink};border-radius:16px;background:#ffffff"><tr><td style="padding:16px;border-bottom:1px solid ${BRAND.line};font-size:12px;color:${BRAND.muted};width:86px">วันที่</td><td style="padding:16px;border-bottom:1px solid ${BRAND.line};font-size:14px;font-weight:800">${date}</td></tr><tr><td style="padding:16px;border-bottom:1px solid ${BRAND.line};font-size:12px;color:${BRAND.muted}">เวลา</td><td style="padding:16px;border-bottom:1px solid ${BRAND.line};font-size:14px;font-weight:800">${time}</td></tr><tr><td style="padding:16px;font-size:12px;color:${BRAND.muted}">สถานที่</td><td style="padding:16px;font-size:14px;font-weight:800">${location}</td></tr></table>`;
}
function referenceCardHtml_(code,label){return `<div style="margin:18px 0;background:${BRAND.yellow2};border:2px solid ${BRAND.ink};border-radius:16px;padding:18px;text-align:center"><div style="font-size:11px;font-weight:800;color:#6c5d2b;letter-spacing:.6px">${escapeHtml_(label)}</div><div style="margin-top:6px;font-size:28px;font-weight:900;letter-spacing:3px;color:${BRAND.ink}">${escapeHtml_(code)}</div></div>`}

function calendarLink_(round){
  if(!round.event_date||!round.start_time||!round.end_time)return '';
  const start=String(round.event_date).replace(/-/g,'')+'T'+String(round.start_time).replace(':','')+'00';
  const end=String(round.event_date).replace(/-/g,'')+'T'+String(round.end_time).replace(':','')+'00';
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(round.title||'CA$HFLOW Meetup')+'&dates='+start+'/'+end+'&location='+encodeURIComponent(round.location_name||'')+'&ctz=Asia%2FBangkok';
}

function findRound_(code){
  const rounds=getRoundsCached_();
  const requested=clean_(code,60);
  if(requested)return rounds.find(r=>r.round_code===requested)||null;

  const active=clean_(getSetting_('active_round_code'),60);
  if(active){
    const activeRound=rounds.find(r=>r.round_code===active);
    if(activeRound)return activeRound;
  }

  return rounds.find(r=>r.status==='Open')||rounds[0]||null;
}

function getRoundsCached_(){
  const cached=cacheGet_('rounds:v2');
  if(cached)return cached;
  const rows=listRows_(SHEETS.ROUNDS);
  cachePut_('rounds:v2',rows,60);
  return rows;
}

function invalidateRoundListCache_(){
  CacheService.getScriptCache().remove('rounds:v2');
}

function invalidateDataCache_(roundCode){
  const cache=CacheService.getScriptCache();
  cache.remove('publicRound:'+(roundCode||'active'));
  cache.remove('publicRound:active');
}

function cacheGet_(key){
  try{
    const x=CacheService.getScriptCache().get(key);
    return x?JSON.parse(x):null;
  }catch(e){
    return null;
  }
}

function cachePut_(key,value,ttl){
  try{CacheService.getScriptCache().put(key,JSON.stringify(value),ttl)}catch(e){}
}

function publicRegistration_(r){
  return {
    registration_id:r.registration_id,
    status:r.status,
    reference_code:r.reference_code,
    submitted_at:r.submitted_at,
    checked_in_at:r.checked_in_at||'',
    cancelled_at:r.cancelled_at||''
  };
}

function registrationStatusResponse_(r){
  return {
    found:true,
    registration:publicRegistration_(r),
    can_cancel:ACTIVE_REG_STATUSES.includes(r.status)&&!r.checked_in_at,
    can_reapply:['Rejected','Cancelled'].includes(r.status)
  };
}

function adminRegistration_(r){
  return {
    registration_id:r.registration_id,
    round_code:r.round_code,
    submitted_at:r.submitted_at,
    full_name:r.full_name,
    nickname:r.nickname,
    age_range:r.age_range,
    phone:r.phone,
    email:r.email,
    money_style:r.money_style,
    money_goal:r.money_goal,
    status:r.status,
    reference_code:r.reference_code,
    approved_at:r.approved_at,
    checked_in_at:r.checked_in_at,
    cancelled_at:r.cancelled_at||'',
    reapply_of_registration_id:r.reapply_of_registration_id||'',
    admin_note:r.admin_note,
    submission_email_sent_at:r.submission_email_sent_at,
    approval_email_sent_at:r.approval_email_sent_at,
    updated_at:r.updated_at
  };
}

function decorateAdminRegistrations_(regs,mail){
  return regs.map(r=>{
    const dupIds=new Set(
      regs.filter(x=>
        x.registration_id!==r.registration_id&&
        (
          (normalizeThaiPhone_(r.phone)&&normalizeThaiPhone_(x.phone)===normalizeThaiPhone_(r.phone))||
          (String(r.email||'').toLowerCase()&&String(x.email||'').toLowerCase()===String(r.email||'').toLowerCase())
        )
      ).map(x=>x.registration_id)
    );

    const type=r.status==='Approved'||r.approval_email_sent_at?'approval':'submission';
    const latest=[...mail].filter(q=>q.registration_id===r.registration_id&&q.type===type)
      .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
    const sentAt=type==='approval'?r.approval_email_sent_at:r.submission_email_sent_at;
    const emailStatus=sentAt?'Sent':(latest?.status||'NotQueued');

    return {
      ...adminRegistration_(r),
      duplicate_contact_count:dupIds.size,
      email_delivery:{type,status:emailStatus,sent_at:sentAt||latest?.sent_at||''}
    };
  });
}

function hasOpenEmailQueue_(type,registrationId){
  return listRows_(SHEETS.MAIL).some(q=>
    q.registration_id===registrationId&&
    q.type===type&&
    ['Pending','Sending'].includes(q.status)
  );
}

function cancelQueuedApprovalEmails_(registrationId){
  listRowsWithRow_(SHEETS.MAIL)
    .filter(q=>q.registration_id===registrationId&&q.type==='approval'&&['Pending','Sending'].includes(q.status))
    .forEach(q=>updateObjectRow_(SHEETS.MAIL,q.__row,{status:'Cancelled',last_error:'registration status changed before send'}));
}

function newOpaqueToken_(){
  return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
}

function ensureManageToken_(reg){
  if(reg.manage_token)return reg;
  const token=newOpaqueToken_();
  const ref=findRowBy_(SHEETS.REG,'registration_id',reg.registration_id);
  if(ref)updateObjectRow_(SHEETS.REG,ref.row,{manage_token:token,updated_at:now_()});
  return {...reg,manage_token:token};
}

function manageLink_(reg){
  const base=String(getSetting_('public_app_url')||'https://cashflow-meetup-public.vercel.app/participant/').trim();
  const sep=base.includes('?')?'&':'?';
  return base+sep+'round='+encodeURIComponent(reg.round_code)+'&manage='+encodeURIComponent(reg.manage_token||'');
}

function manageButtonHtml_(reg,round){
  if(!reg.manage_token)return '';
  const href=escapeAttr_(manageLink_(reg));
  return `<div style="text-align:center;margin-top:20px"><a href="${href}" style="display:inline-block;background:#ffffff;color:${BRAND.ink};border:2px solid ${BRAND.ink};border-radius:999px;padding:11px 16px;text-decoration:none;font-weight:800">ดูสถานะ / จัดการใบสมัคร</a></div>`;
}

function uniqueReferenceFromRows_(rows){
  const used=new Set(rows.map(r=>String(r.reference_code||'')));
  for(let i=0;i<30;i++){const n=String(Math.floor(100000+Math.random()*900000));if(!used.has(n))return n}
  return String(Date.now()).slice(-6);
}

function listRows_(sheetName){return listRowsWithRow_(sheetName).map(r=>{const x={...r};delete x.__row;return x})}
function listRowsWithRow_(sheetName){
  const sh=getSheet_(sheetName);const lastRow=sh.getLastRow(),lastCol=sh.getLastColumn();if(lastRow<2||lastCol<1)return [];
  const values=sh.getRange(1,1,lastRow,lastCol).getDisplayValues();const headers=values[0];
  return values.slice(1).filter(row=>row.some(v=>v!=='' )).map((row,i)=>{const obj={__row:i+2};headers.forEach((h,j)=>{if(h)obj[h]=row[j]??''});return obj});
}
function findRowBy_(sheetName,key,value){const rows=listRowsWithRow_(sheetName);const obj=rows.find(r=>String(r[key])===String(value));return obj?{row:obj.__row,obj}:null}
function appendObject_(sheetName,headers,obj){const sh=getSheet_(sheetName);ensureHeaders_(sh,headers);const activeHeaders=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];const row=activeHeaders.map(h=>obj[h]??'');sh.appendRow(row)}
function updateObjectRow_(sheetName,rowNumber,patch){const sh=getSheet_(sheetName);const headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];Object.entries(patch).forEach(([k,v])=>{const col=headers.indexOf(k)+1;if(col>0)sh.getRange(rowNumber,col).setValue(v)})}
function ensureSheet_(ss,name,headers){let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);ensureHeaders_(sh,headers);sh.setFrozenRows(1);return sh}
function ensureHeaders_(sh,headers){const lastCol=Math.max(sh.getLastColumn(),1);const current=sh.getRange(1,1,1,lastCol).getDisplayValues()[0];const existing=current.filter(Boolean);let changed=false;headers.forEach(h=>{if(!existing.includes(h)){existing.push(h);changed=true}});if(!existing.length){existing.push(...headers);changed=true}if(changed||current.slice(0,existing.length).join('|')!==existing.join('|'))sh.getRange(1,1,1,existing.length).setValues([existing]);}
function getSheet_(name){const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');if(!id)throw new Error('backend_not_configured');const sh=SpreadsheetApp.openById(id).getSheetByName(name);if(!sh)throw new Error('backend_not_configured');return sh}
function getSetting_(key){const row=listRows_(SHEETS.SETTINGS).find(r=>r.key===key);return row?row.value:''}
function setSetting_(key,value,description){
  const ref=findRowBy_(SHEETS.SETTINGS,'key',key);
  const row={key,value:String(value??''),description:description||''};
  if(ref)updateObjectRow_(SHEETS.SETTINGS,ref.row,row);
  else appendObject_(SHEETS.SETTINGS,['key','value','description'],row);
}
function audit_(actor,action,roundCode,registrationId,detail){try{appendObject_(SHEETS.AUDIT,['timestamp','actor','action','round_code','registration_id','detail'],{timestamp:now_(),actor,action,round_code:roundCode||'',registration_id:registrationId||'',detail:clean_(detail,500)})}catch(e){}}

function normalizePhone_(s){return String(s||'').replace(/\D/g,'')}
function normalizeThaiPhone_(s){
  let digits=normalizePhone_(s);
  if(digits.startsWith('0066'))digits='0'+digits.slice(4);
  else if(digits.startsWith('66')&&digits.length>=11)digits='0'+digits.slice(2);
  return digits.slice(0,10);
}
function clean_(v,max){return String(v??'').trim().replace(/[\u0000-\u001F\u007F]/g,'').slice(0,max||500)}
function truthy_(v){return v===true||String(v).toLowerCase()==='true'||String(v)==='1'}
function now_(){return Utilities.formatDate(new Date(),'Asia/Bangkok',"yyyy-MM-dd'T'HH:mm:ssXXX")}
function sha256Hex_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s)).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('')}
function escapeHtml_(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function escapeAttr_(s){return escapeHtml_(s)}
function isConfigured_(){const p=PropertiesService.getScriptProperties();return !!(p.getProperty('SPREADSHEET_ID')&&p.getProperty('ADMIN_PASSWORD_HASH')&&p.getProperty('ADMIN_PASSWORD_SALT'))}
function json_(obj,status){return ContentService.createTextOutput(JSON.stringify({...obj,http_status:status||200})).setMimeType(ContentService.MimeType.JSON)}