import {weddingInstant,countdownParts} from './wedding-time.js';
const $=selector=>document.querySelector(selector);
const cover=$('#envelope-cover'),invitation=$('#invitation'),video=$('#envelope-video'),idle=$('#envelope-idle'),light=$('#envelope-light'),form=$('#rsvp-form');
const buttons=Array.from(form.querySelectorAll('[name=decision]'));
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let wedding=null,response=null,phase='closed',hasNativeIdle=false,frameId=null,usesVideoFrames=false,glowStarted=null,countdownTimer;
let openingPath='',loopPath='',openingLoad=null,openingUrl='',openingAbort=null,openingAttempt=0,lastFrameTime=0,lastProgressAt=0,recoveryAttempted=false;
const timers=new Set();
function schedule(callback,delay){const id=setTimeout(()=>{timers.delete(id);callback();},delay);timers.add(id);return id;}
function clearTimers(){for(const id of timers)clearTimeout(id);timers.clear();}
function stopTracking(){if(frameId!==null){if(usesVideoFrames)video.cancelVideoFrameCallback(frameId);else cancelAnimationFrame(frameId);}frameId=null;}
invitation.inert=true;
const text=(selector,value)=>{const el=$(selector);if(el)el.textContent=value;};
async function api(url,options={}){const res=await fetch(url,options);let data;try{data=await res.json();}catch{throw Error('تعذر الاتصال. يرجى المحاولة مرة أخرى.');}if(!res.ok)throw Error(data.error||'تعذر حفظ الرد. يرجى المحاولة مرة أخرى.');return data;}
function dateLabel(value){return new Intl.DateTimeFormat('ar-EG',{calendar:'gregory',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));}
function timeLabel(value){const[h,m]=value.split(':').map(Number);return new Intl.DateTimeFormat('ar-JO',{hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(2000,0,1,h,m));}
function updateCountdown(){
  if(!wedding)return;
  const parts=countdownParts(weddingInstant(wedding));
  $('#countdown').hidden=!parts;
  $('#countdown-note').hidden=!!parts;
  if(!parts){text('#countdown-note','سنعلن الموعد والوقت قريبًا');return;}
  const numbers=new Intl.NumberFormat('ar-JO',{minimumIntegerDigits:2,useGrouping:false});
  for(const key of ['days','hours','minutes','seconds'])text('#count-'+key,numbers.format(parts[key]));
  text('#countdown-title',parts.started?'حان موعد فرحتنا':'بقي على فرحتنا');
  $('#countdown').setAttribute('aria-label',parts.started?'حان موعد الزفاف':`الوقت المتبقي: ${parts.days} يوم و${parts.hours} ساعة و${parts.minutes} دقيقة و${parts.seconds} ثانية`);
}
function applyWedding(cfg){
  wedding=cfg;document.title=cfg.names.join(' و')+' | دعوة زفاف';
  document.querySelectorAll('[data-couple]').forEach(el=>el.replaceChildren(document.createTextNode(cfg.names[0]+' '),Object.assign(document.createElement('span'),{textContent:'و'}),document.createTextNode(' '+cfg.names[1])));
  text('#name-one',cfg.names[0]);text('#name-two',cfg.names[1]);setHeroLettering(cfg.names);text('#welcome-copy',cfg.welcome||'ندعوكم لمشاركتنا فرحة زفافنا');
  text('#detail-date',cfg.date?dateLabel(cfg.date):'سنعلن الموعد قريبًا');$('#detail-time').hidden=!cfg.ceremonyTime;
  if(cfg.ceremonyTime)text('#detail-time','موعد الحفل: الساعة '+timeLabel(cfg.ceremonyTime)+' — بتوقيت عمّان');
  text('#detail-venue',cfg.venue||'سنشارككم المكان قريبًا');text('#detail-address',cfg.address||'');
  const location=$('#venue-card');const mapUrl=cfg.mapsUrl||(cfg.venue?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(cfg.venue+' الأردن'):'');
  location.setAttribute('aria-disabled',String(!mapUrl));if(mapUrl)location.href=mapUrl;else location.removeAttribute('href');
  $('#rsvp-deadline').hidden=!cfg.rsvpDeadline;if(cfg.rsvpDeadline)text('#rsvp-deadline','يرجى الرد قبل '+dateLabel(cfg.rsvpDeadline));
  clearInterval(countdownTimer);updateCountdown();countdownTimer=setInterval(updateCountdown,1000);
  if(cfg.envelopeVideo&&!reducedMotion)setupVideo(cfg);
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){updateCountdown();if(phase==='opening'&&openingUrl){lastProgressAt=performance.now();video.play().catch(()=>resetOpening());}}
});
function playEnd(){return Math.min(Number(wedding?.videoEnd)||4,Number.isFinite(video.duration)?video.duration:Infinity);}
function startLight(){
  if(glowStarted!==null||reducedMotion)return;
  glowStarted=performance.now();light.hidden=false;light.classList.remove('fading');light.classList.add('blooming');cover.classList.add('light-transition');
}
function nextFrame(){
  if(phase!=='opening')return;
  usesVideoFrames=typeof video.requestVideoFrameCallback==='function';
  frameId=usesVideoFrames?video.requestVideoFrameCallback(trackMedia):requestAnimationFrame(trackMedia);
}
function trackMedia(now,metadata){
  frameId=null;if(phase!=='opening')return;
  // Use presented frames when supported; a decoder stall must not advance the reveal.
  const time=metadata?.mediaTime??video.currentTime;
  if(time>lastFrameTime+.005){lastFrameTime=time;lastProgressAt=performance.now();}
  if(time>=playEnd()-.45)startLight();
  if(video.ended||time>=playEnd()-.015){finishOpening();return;}
  nextFrame();
}
function beginTracking(){stopTracking();nextFrame();}
function releaseIdle(){idle.pause();idle.hidden=true;idle.removeAttribute('src');idle.load();}
function startIdle(){
  if(!hasNativeIdle||reducedMotion)return;
  if(idle.getAttribute('src')!==loopPath){idle.src=loopPath;idle.load();}
  idle.play().then(()=>{if(phase==='closed')idle.hidden=false;else idle.pause();}).catch(()=>{idle.hidden=true;});
}
function prepareOpening(){
  if(openingUrl)return Promise.resolve();
  if(openingLoad)return openingLoad;
  const path=openingPath,controller=new AbortController();openingAbort=controller;
  const timeout=setTimeout(()=>controller.abort(),30000);
  openingLoad=fetch(path,{cache:'force-cache',signal:controller.signal}).then(async result=>{
    if(!result.ok)throw Error('Video download failed');
    const blob=await result.blob();
    if(blob.size<1000||!blob.type.startsWith('video/'))throw Error('Invalid video response');
    if(path!==openingPath||controller.signal.aborted)throw Error('Video source changed');
    openingUrl=URL.createObjectURL(blob);video.src=openingUrl;video.load();
  }).catch(error=>{if(path===openingPath)openingLoad=null;throw error;}).finally(()=>{clearTimeout(timeout);if(openingAbort===controller)openingAbort=null;});
  return openingLoad;
}
function setupVideo(cfg){
  if(!cfg.envelopeVideo||cfg.envelopeVideo===openingPath)return;
  openingAbort?.abort();if(openingUrl)URL.revokeObjectURL(openingUrl);
  openingUrl='';openingLoad=null;openingPath=cfg.envelopeVideo;loopPath=cfg.envelopeLoopVideo||'';hasNativeIdle=!!loopPath;
  video.muted=true;video.defaultMuted=true;video.playsInline=true;video.preload='auto';video.hidden=true;
  idle.muted=true;idle.defaultMuted=true;idle.playsInline=true;idle.loop=true;
  // Download the complete small clip before playback. Mobile preload="auto" is only a hint.
  prepareOpening().catch(()=>{});if(phase==='closed')startIdle();
}
video.addEventListener('playing',()=>{
  if(phase!=='opening')return;
  cover.classList.remove('cover-loading');cover.classList.add('playing-video');video.hidden=false;lastProgressAt=performance.now();beginTracking();releaseIdle();
});
video.addEventListener('ended',()=>{if(phase==='opening')finishOpening();});
video.addEventListener('error',()=>{if(phase==='opening')resetOpening();});
idle.addEventListener('error',()=>{idle.hidden=true;});
function reveal(illuminated=false){
  if(phase==='revealed')return;
  ++openingAttempt;clearTimers();stopTracking();phase='revealed';video.pause();idle.pause();
  cover.classList.add('dismissed');cover.classList.remove('cover-loading');cover.inert=true;invitation.inert=false;document.body.classList.remove('intro-active');window.scrollTo({top:0,behavior:'instant'});document.body.classList.add('reveal-enter');setupScrollReveals();
  if(illuminated&&!reducedMotion){light.classList.add('fading');schedule(()=>{light.hidden=true;light.classList.remove('blooming','fading');},1000);}
  else{light.hidden=true;light.classList.remove('blooming','fading');}
  schedule(()=>{cover.hidden=true;$('#main-content').setAttribute('tabindex','-1');$('#main-content').focus({preventScroll:true});},reducedMotion?0:800);
  schedule(()=>document.body.classList.remove('reveal-enter'),1200);
}
function finishOpening(){
  // Never turn a timeout, network error, or rejected play() into a flash of the website.
  if(phase!=='opening'||video.currentTime<playEnd()-.08)return;
  video.pause();idle.pause();stopTracking();clearTimers();phase='transition';startLight();
  const wait=glowStarted===null?0:Math.max(0,700-(performance.now()-glowStarted));
  schedule(()=>reveal(true),wait);
}
function resetOpening(){
  if(phase!=='opening')return;
  ++openingAttempt;clearTimers();stopTracking();phase='closed';video.pause();video.load();glowStarted=null;
  light.hidden=true;light.classList.remove('blooming','fading');cover.classList.remove('opening','playing-video','light-transition','cover-loading');
  const button=$('#open-envelope');button.disabled=false;button.setAttribute('aria-busy','false');button.setAttribute('aria-label','فتح الدعوة');startIdle();
}
function watchPlayback(attempt){
  if(phase!=='opening'||attempt!==openingAttempt)return;
  if(document.hidden)lastProgressAt=performance.now();
  const stalledFor=performance.now()-lastProgressAt;
  if(stalledFor>10000){resetOpening();return;}
  if(stalledFor>4000&&!recoveryAttempted){recoveryAttempted=true;video.play().catch(()=>resetOpening());}
  schedule(()=>watchPlayback(attempt),1000);
}
function playBuffered(attempt){
  if(phase!=='opening'||attempt!==openingAttempt)return;
  lastFrameTime=0;lastProgressAt=performance.now();recoveryAttempted=false;
  // No seek at the tap: play from the first keyframe, including its closed 0.2 seconds.
  video.play().then(()=>{if(phase==='opening'&&attempt===openingAttempt)beginTracking();}).catch(()=>resetOpening());
  schedule(()=>watchPlayback(attempt),1000);
}
function openEnvelope(skip=false){
  if(skip){reveal(false);return;}
  if(phase!=='closed')return;
  if(reducedMotion){reveal(false);return;}
  clearTimers();phase='opening';const attempt=++openingAttempt;const button=$('#open-envelope');button.disabled=true;button.setAttribute('aria-busy','true');cover.classList.add('opening','cover-loading');releaseIdle();
  // A warm clip starts within the tap gesture; a cold clip keeps the closed poster visible.
  if(openingUrl)playBuffered(attempt);
  else prepareOpening().then(()=>playBuffered(attempt)).catch(()=>{if(attempt===openingAttempt)resetOpening();});
}
$('#open-envelope').addEventListener('click',()=>openEnvelope());
cover.addEventListener('keydown',event=>{if(event.key==='Escape')openEnvelope(true);if(event.key==='Tab'){event.preventDefault();if(!$('#open-envelope').disabled)$('#open-envelope').focus();}});$('#open-envelope').focus({preventScroll:true});
$('#replay-intro').addEventListener('click',()=>{
  ++openingAttempt;clearTimers();stopTracking();window.scrollTo({top:0,behavior:'instant'});cover.hidden=false;cover.inert=false;invitation.inert=true;phase='closed';glowStarted=null;video.pause();video.load();
  light.hidden=true;light.classList.remove('blooming','fading');cover.classList.remove('dismissed','opening','playing-video','light-transition','cover-loading');$('#open-envelope').disabled=false;$('#open-envelope').setAttribute('aria-busy','false');document.body.classList.add('intro-active');
  if(!reducedMotion){startIdle();prepareOpening().catch(()=>{});}$('#open-envelope').focus();
});
// Prepare media independently of the RSVP/database request, including an immediate first tap.
if(!reducedMotion)setupVideo({envelopeVideo:video.dataset.src,envelopeLoopVideo:idle.dataset.src});

const companionPanel=$('#companions-panel'),companionInput=$('#companions-count');
const stepperButtons=[$('#remove-companion'),$('#add-companion')];
let companionSaveTimer=null,savingRsvp=false;
const countLabel=value=>new Intl.NumberFormat('ar-JO').format(value);
function companionCount(){
  const value=companionInput.value===''?0:Number(companionInput.value);
  if(!Number.isInteger(value)||value<0||value>999)throw Error('يرجى اختيار عدد صحيح للمرافقين من صفر إلى ٩٩٩.');
  return value;
}
function showPartyTotal(){
  let count;try{count=companionCount();}catch{return;}
  text('#party-total',count===0?'الإجمالي: شخص واحد — أنت فقط':`الإجمالي: ${countLabel(count+1)} أشخاص — أنت و${countLabel(count)} من المرافقين`);
  $('#remove-companion').disabled=savingRsvp||count===0;$('#add-companion').disabled=savingRsvp||count===999;
}
function setSaving(value){savingRsvp=value;buttons.forEach(button=>button.disabled=value);companionInput.disabled=value;form.elements.note.disabled=value;stepperButtons.forEach(button=>button.disabled=value);if(!value)showPartyTotal();}
function showResponse(value){
  response=value;text('#ticket-party-count',value?.attending?countLabel(value.partySize):'—');
  text('#pass-status-label',value?(value.attending?'تم تأكيد الحضور ✓ صالحة للدخول':'اعتذار عن الحضور'):'دعوة معتمدة ومصرح بالدخول');
  if(!value)return;
  form.elements.note.value=value.note||'';companionInput.value=String(value.companions||0);companionPanel.hidden=!value.attending;
  const message=$('#response-message');message.hidden=false;message.classList.toggle('declined',!value.attending);
  message.textContent=value.attending?(value.partySize>1?`تم تأكيد حضورك مع المرافقين. الإجمالي: ${countLabel(value.partySize)} أشخاص.`:'تم تأكيد حضورك. بانتظارك بكل حب.'):'شكرًا لإخبارنا، لك منا كل المحبة.';
  buttons.forEach(button=>{const selected=(button.value==='yes')===value.attending;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));if(button.value==='yes')button.setAttribute('aria-expanded',String(value.attending));});
  showPartyTotal();text('#reply-hint','يمكنك تغيير قرارك أو تعديل عدد المرافقين من هنا.');
}
async function saveRsvp(attending){
  clearTimeout(companionSaveTimer);if(savingRsvp)return;
  let companions=0;try{companions=attending?companionCount():0;}catch(error){text('#form-error',error.message);$('#form-error').hidden=false;return;}
  setSaving(true);$('#form-error').hidden=true;$('#response-message').hidden=true;text('#reply-hint','جارٍ حفظ ردك…');
  try{const data=await api('/api/rsvp/simple',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attending,companions,note:form.elements.note.value.trim()})});showResponse(data.response);}
  catch(error){text('#form-error',error.message);$('#form-error').hidden=false;text('#reply-hint','لم يُحفظ التعديل. اضغط زر الحضور للمحاولة مجددًا.');}
  finally{setSaving(false);}
}
function scheduleCompanionSave(){
  if(savingRsvp||!response?.attending)return;
  clearTimeout(companionSaveTimer);showPartyTotal();
  try{companionCount();$('#form-error').hidden=true;}catch(error){text('#form-error',error.message);$('#form-error').hidden=false;return;}
  text('#reply-hint','جارٍ تحديث عدد المرافقين…');companionSaveTimer=setTimeout(()=>saveRsvp(true),450);
}
$('#add-companion').addEventListener('click',()=>{try{companionInput.value=String(Math.min(999,companionCount()+1));}catch{companionInput.value='0';}scheduleCompanionSave();});
$('#remove-companion').addEventListener('click',()=>{try{companionInput.value=String(Math.max(0,companionCount()-1));}catch{companionInput.value='0';}scheduleCompanionSave();});
companionInput.addEventListener('input',scheduleCompanionSave);
companionInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();saveRsvp(true);}});
form.addEventListener('submit',event=>{event.preventDefault();const choice=event.submitter?.value;if(!['yes','no'].includes(choice))return;saveRsvp(choice==='yes');});
Promise.allSettled([api('/api/wedding'),api('/api/rsvp/simple')]).then(results=>{if(results[0].status==='fulfilled')applyWedding(results[0].value);if(results[1].status==='fulfilled'){showResponse(results[1].value.response);buttons.forEach(button=>button.disabled=false);}else{text('#form-error','تعذر تحميل تأكيد الحضور. يرجى تحديث الصفحة والمحاولة مرة أخرى.');$('#form-error').hidden=false;}});

// Keep all content visible if motion is reduced or IntersectionObserver is unavailable.
let scrollObserver;
function setupScrollReveals(){
  if(reducedMotion||!('IntersectionObserver' in window))return;
  if(scrollObserver)scrollObserver.disconnect();
  document.body.classList.add('scroll-motion-ready');
  scrollObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-visible');scrollObserver.unobserve(entry.target);}},{threshold:.08,rootMargin:'0px 0px -24px 0px'});
  document.querySelectorAll('[data-scroll-reveal]').forEach(el=>scrollObserver.observe(el));
}
if(document.fonts)document.fonts.ready.then(()=>document.body.classList.add('calligraphy-ready'));
else document.body.classList.add('calligraphy-ready');

function setHeroLettering(names){
  const ns='http://www.w3.org/2000/svg';
  document.querySelectorAll('[data-hero-names]').forEach(text=>{
    if(names[0]!=='صلاح'){text.textContent=names.join(' و');return;}
    const first=document.createElementNS(ns,'tspan');first.textContent='صلا';
    const ha=document.createElementNS(ns,'tspan');ha.textContent='ح';ha.setAttribute('class','name-ha');ha.setAttribute('font-size','0.8em');ha.setAttribute('baseline-shift','36');
    const rest=document.createElementNS(ns,'tspan');rest.textContent=' و'+names[1];
    text.replaceChildren(first,ha,rest);
  });
}
