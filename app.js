const screens=[...document.querySelectorAll('.screen')];
const navBtns=[...document.querySelectorAll('.preview-nav button')];

function showScreen(id){
  screens.forEach(s=>s.classList.toggle('active',s.id===id));
  navBtns.forEach(b=>b.classList.toggle('active',b.dataset.screen===id));
  window.scrollTo({top:0,behavior:'smooth'});
}

navBtns.forEach(btn=>btn.addEventListener('click',()=>showScreen(btn.dataset.screen)));

let regStep=1;

function validateStep1(){
  let ok=true;
  const fields=[...document.querySelectorAll('#step1 .field[data-required]')];
  fields.forEach(field=>{
    const input=field.querySelector('input,select');
    let valid=input.checkValidity() && input.value.trim()!=='';
    field.classList.toggle('invalid',!valid);
    if(!valid && ok){
      input.focus();
      ok=false;
    }
  });
  return ok;
}

document.querySelectorAll('#step1 input,#step1 select').forEach(el=>{
  el.addEventListener('input',()=>el.closest('.field').classList.remove('invalid'));
  el.addEventListener('change',()=>el.closest('.field').classList.remove('invalid'));
});

function nextRegistration(){
  const action=document.getElementById('regAction');
  const help=document.getElementById('regHelp');
  const stepLabel=document.getElementById('stepLabel');

  if(regStep===1){
    if(!validateStep1()) return;
    document.getElementById('step1').classList.remove('active');
    document.getElementById('step2').classList.add('active');
    document.getElementById('progress2').classList.add('on');
    stepLabel.textContent='Step 2/2';
    action.textContent='ส่งใบสมัคร';
    help.textContent='ตรวจข้อมูลก่อนส่ง';
    regStep=2;
    window.scrollTo({top:0,behavior:'smooth'});
  } else if(regStep===2){
    document.getElementById('step2').classList.remove('active');
    document.getElementById('pendingState').classList.add('active');
    action.textContent='กลับหน้ากิจกรรม';
    help.textContent='ยังไม่ถือว่าได้รับสิทธิ์';
    stepLabel.textContent='ส่งแล้ว';
    regStep=3;
    window.scrollTo({top:0,behavior:'smooth'});
  } else {
    resetRegistration();
    showScreen('event');
  }
}

function resetRegistration(){
  document.getElementById('pendingState').classList.remove('active');
  document.getElementById('step2').classList.remove('active');
  document.getElementById('step1').classList.add('active');
  document.getElementById('progress2').classList.remove('on');
  document.getElementById('stepLabel').textContent='Step 1/2';
  document.getElementById('regAction').textContent='ถัดไป';
  document.getElementById('regHelp').textContent='Step 1 จาก 2';
  regStep=1;
}

document.querySelectorAll('.filter-chip').forEach(chip=>{
  chip.addEventListener('click',()=>{
    document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
  });
});
