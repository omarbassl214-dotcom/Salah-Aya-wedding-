import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

const testPassword='test-only-password-not-for-real-hosting';
async function launch(dataDir){
 const process=spawn(globalThis.process.execPath,['server.mjs'],{cwd:resolve('.'),env:{...globalThis.process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dataDir,ADMIN_PASSWORD:testPassword},stdio:['ignore','pipe','pipe']});
 let output='',errors='';process.stderr.on('data',d=>errors+=d);
 const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server did not start: '+errors)),15000);process.stdout.on('data',d=>{output+=d;const m=output.match(/Wedding invitation: http:\/\/localhost:(\d+)/);if(m){clearTimeout(timeout);resolve('http://127.0.0.1:'+m[1]);}});process.once('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code+': '+errors));});});
 return {process,base,stop:async()=>{if(process.exitCode===null){process.kill();await once(process,'exit');}}};
}
test('Wedding invitation: durable RSVP, private administration, browser flows',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ali-alaa-wedding-test-'));let service=await launch(dir),cookie='';
 const send=async(path,method='GET',body,authenticated=false,origin=true)=>{const r=await fetch(service.base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:service.base}:{}),...(authenticated?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,text,headers:r.headers};};
 const login=async()=>{const r=await send('/api/admin/login','POST',{password:testPassword});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);};
 let response;const party={name:'Test Guest',contact:'guest@example.test',attending:true,adults:2,children:1,guestNames:['Test Partner','Test Child'],dietary:'Child: nut allergy',note:'Looking forward to it',confirmed:true};
 try{
 await t.test('serves invitation, admin, and local assets; protects guest data',async()=>{for(const path of ['/','/admin','/styles.css','/app.js','/admin.js','/fonts.css','/assets/envelope.png','/assets/celebration.png'])assert.equal((await send(path)).status,200,path);assert.equal((await send('/api/admin/guests')).status,401);assert.equal((await send('/api/admin/counts')).status,200);assert.deepEqual(Object.keys((await send('/api/admin/counts')).data).sort(),['no','yes']);assert.equal((await send('/data/wedding.sqlite')).status,404);assert.equal((await send('/.env')).status,404);assert.equal((await send('/api/admin/export')).status,401);});
 await t.test('rejects cross-origin, unconfirmed, and invalid party submissions',async()=>{assert.equal((await send('/api/rsvp','POST',party,false,false)).status,403);assert.equal((await send('/api/rsvp','POST',{...party,confirmed:false})).status,400);assert.equal((await send('/api/rsvp','POST',{...party,adults:2.5})).status,400);assert.equal((await send('/api/rsvp','POST',{...party,guestNames:[]})).status,400);});
 await t.test('persists confirmed response and counts people rather than submissions',async()=>{response=await send('/api/rsvp','POST',party);assert.equal(response.status,200);assert.equal(response.data.guests,3);await login();const r=await send('/api/admin/guests','GET',null,true);assert.equal(r.data.stats.confirmedGuests,3);assert.equal(r.data.stats.confirmedParties,1);assert.equal(r.data.stats.children,1);assert.equal(r.data.stats.checkedIn,0);assert.equal(r.data.guests[0].token_hash,undefined);});
 await t.test('deduplicates normalized contacts and requires a private token to update',async()=>{assert.equal((await send('/api/rsvp','POST',{...party,contact:'GUEST@EXAMPLE.TEST'})).status,409);assert.equal((await send('/api/rsvp','POST',{...party,id:response.data.id,token:'wrong'})).status,403);const r=await send('/api/rsvp','POST',{...party,id:response.data.id,token:response.data.token,children:0,guestNames:['Test Partner']});assert.equal(r.status,200);assert.equal(r.data.guests,2);const stats=(await send('/api/admin/guests','GET',null,true)).data.stats;assert.equal(stats.responses,1);assert.equal(stats.confirmedGuests,2);});
 await t.test('declines have zero attendees and CSV export neutralizes spreadsheet formulas',async()=>{assert.equal((await send('/api/rsvp','POST',{name:'=SUM(1,2)',contact:'decline@example.test',attending:false,adults:8,children:6,guestNames:[],confirmed:false})).status,200);const r=await send('/api/admin/guests','GET',null,true);assert.equal(r.data.stats.confirmedGuests,2);assert.equal(r.data.stats.declined,1);const csv=await send('/api/admin/export','GET',null,true);assert.equal(csv.status,200);assert.ok(csv.text.includes("'=SUM(1,2)"));});
 await t.test('check-in is bounded and idempotent, independent of RSVP',async()=>{const path=`/api/admin/guests/${response.data.id}/check-in`;assert.equal((await send(path,'PATCH',{count:3},true)).status,400);assert.equal((await send(path,'PATCH',{count:1},true)).status,200);assert.equal((await send(path,'PATCH',{count:1},true)).status,200);const stats=(await send('/api/admin/guests','GET',null,true)).data.stats;assert.equal(stats.checkedIn,1);assert.equal(stats.confirmedGuests,2);assert.equal((await send('/api/rsvp','POST',{...party,id:response.data.id,token:response.data.token})).status,409);});
 await t.test('settings validate and RSVP deadlines are enforced server-side',async()=>{const cfg=(await send('/api/wedding')).data;assert.equal((await send('/api/admin/settings','PUT',{...cfg,date:'2027-02-30'},true)).status,400);assert.equal((await send('/api/admin/settings','PUT',{...cfg,mapsUrl:'javascript:alert(1)'},true)).status,400);assert.equal((await send('/api/admin/settings','PUT',{...cfg,rsvpDeadline:'2000-01-01'},true)).status,200);assert.equal((await send('/api/rsvp','POST',{...party,contact:'late@example.test'})).status,400);assert.equal((await send('/api/admin/settings','PUT',cfg,true)).status,200);});
 await t.test('guest records survive a server restart',async()=>{await service.stop();service=await launch(dir);await login();const r=await send('/api/admin/guests','GET',null,true);assert.equal(r.data.stats.responses,2);assert.equal(r.data.stats.checkedIn,1);});

 await t.test('simple Arabic RSVP requires no identity fields, updates once, and survives restart',async()=>{
  const before=(await send('/api/admin/guests','GET',null,true)).data.stats;
  const initial=await fetch(service.base+'/api/rsvp/simple');assert.equal(initial.status,200);
  assert.equal((await initial.json()).response,null);const guestCookie=initial.headers.get('set-cookie').split(';')[0];
  assert.match(initial.headers.get('set-cookie'),/HttpOnly/);
  const simple=async payload=>{const r=await fetch(service.base+'/api/rsvp/simple',{method:'POST',headers:{'Content-Type':'application/json',Origin:service.base,Cookie:guestCookie},body:JSON.stringify(payload)});return{status:r.status,data:await r.json()};};
  const accepted=await simple({attending:true,note:'محمد: ألف مبروك'});assert.equal(accepted.status,200);
  assert.equal((await simple({attending:true,note:'محمد: نراكم قريبًا'})).data.response.id,accepted.data.response.id);
  let stats=(await send('/api/admin/guests','GET',null,true)).data.stats;
  assert.equal(stats.responses,before.responses+1);assert.equal(stats.confirmedGuests,before.confirmedGuests+1);
  assert.equal((await simple({attending:'yes'})).status,400);assert.equal((await simple({attending:true,note:'x'.repeat(501)})).status,400);
  assert.equal((await simple({attending:false,note:''})).status,200);
  stats=(await send('/api/admin/guests','GET',null,true)).data.stats;assert.equal(stats.responses,before.responses+1);assert.equal(stats.confirmedGuests,before.confirmedGuests);
  await service.stop();service=await launch(dir);await login();
  const restored=await fetch(service.base+'/api/rsvp/simple',{headers:{Cookie:guestCookie}});const data=await restored.json();assert.equal(data.response.id,accepted.data.response.id);assert.equal(data.response.attending,false);
 });
 await t.test('accompanying guests add to yes totals, edits replace them, and declines clear them',async()=>{
  const baseline=(await send('/api/admin/counts','GET',null,true)).data;
  const initial=await fetch(service.base+'/api/rsvp/simple');const guestCookie=initial.headers.get('set-cookie').split(';')[0];
  const save=async payload=>{const r=await fetch(service.base+'/api/rsvp/simple',{method:'POST',headers:{'Content-Type':'application/json',Origin:service.base,Cookie:guestCookie},body:JSON.stringify(payload)});return{status:r.status,data:await r.json()};};
  for(const invalid of [-1,1.5,'3',1000])assert.equal((await save({attending:true,companions:invalid})).status,400);
  const accepted=await save({attending:true,companions:5});assert.equal(accepted.status,200);assert.equal(accepted.data.response.partySize,6);assert.equal((await send('/api/admin/counts','GET',null,true)).data.yes,baseline.yes+6);
  assert.equal((await save({attending:true,companions:12})).data.response.partySize,13);assert.equal((await send('/api/admin/counts','GET',null,true)).data.yes,baseline.yes+13);
  await save({attending:true,companions:3});await save({attending:true,companions:3});assert.equal((await send('/api/admin/counts','GET',null,true)).data.yes,baseline.yes+4);
  await service.stop();service=await launch(dir);await login();const restored=await fetch(service.base+'/api/rsvp/simple',{headers:{Cookie:guestCookie}});assert.equal((await restored.json()).response.companions,3);assert.equal((await send('/api/admin/counts','GET',null,true)).data.yes,baseline.yes+4);
  await save({attending:false,companions:3});await save({attending:false});assert.deepEqual((await send('/api/admin/counts','GET',null,true)).data,{yes:baseline.yes,no:baseline.no+1});
 });
 await t.test('Arabic phone invitation: large controls, note-only RSVP, updates, dashboard and settings',async()=>{
   const baseline=(await send('/api/admin/guests','GET',null,true)).data.stats;const originalWedding=(await send('/api/wedding')).data;
   const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[];
   const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   try{
   await mkdir('output',{recursive:true});await page.goto(service.base);await page.waitForLoadState('networkidle');await page.screenshot({path:'output/envelope-desktop-ar.png'});
   assert.equal(await page.locator('html').getAttribute('lang'),'ar');assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
   await page.getByRole('button',{name:'فتح الدعوة',exact:true}).click();await page.locator('#envelope-cover').waitFor({state:'hidden'});await page.screenshot({path:'output/invitation-desktop-ar.png',fullPage:true});
   assert.match(await page.locator('#couple-names').innerText(),/صلاح/);assert.match(await page.locator('#couple-names').innerText(),/آية/);
   assert.equal(await page.locator('#rsvp-form input').count(),1);assert.equal(await page.locator('#rsvp-form textarea').count(),1);assert.equal(await page.locator('#rsvp-form [name=decision]').count(),2);assert.equal(await page.locator('#companions-panel').isVisible(),false);
   await page.locator('[name="note"]').fill('ضيف الاختبار: ألف مبروك');await page.getByRole('button',{name:'أنا قادم بإذن الله'}).click();await page.locator('#response-message').waitFor({state:'visible'});assert.match(await page.locator('#response-message').innerText(),/تم تأكيد حضورك/);assert.equal(await page.locator('#ticket-party-count').innerText(),'١');
   let stats=(await send('/api/admin/guests','GET',null,true)).data.stats;assert.equal(stats.confirmedGuests,baseline.confirmedGuests+1);assert.equal(stats.responses,baseline.responses+1);
   await page.getByRole('button',{name:'أعتذر عن الحضور'}).click();await page.waitForFunction(()=>document.querySelector('#response-message').textContent.includes('شكرًا'));stats=(await send('/api/admin/guests','GET',null,true)).data.stats;assert.equal(stats.responses,baseline.responses+1);assert.equal(stats.confirmedGuests,baseline.confirmedGuests);
   await page.reload();await page.keyboard.press('Escape');await page.locator('#envelope-cover').waitFor({state:'hidden'});assert.match(await page.locator('#response-message').innerText(),/شكرًا/);
   await page.getByRole('button',{name:'أنا قادم بإذن الله'}).click();await page.waitForFunction(()=>document.querySelector('#response-message').textContent.includes('تم تأكيد'));
   const admin=await context.newPage();admin.on('pageerror',e=>errors.push(e.message));await admin.goto(service.base+'/admin');await admin.locator('#dashboard').waitFor({state:'visible'});assert.equal(await admin.locator('input[type=password]').count(),0);await admin.waitForFunction(()=>document.querySelector('#stat-confirmed').textContent!=='٠');
   assert.equal(await admin.locator('#stat-confirmed').innerText(),new Intl.NumberFormat('ar-JO').format(baseline.confirmedGuests+1));
   assert.equal(await admin.locator('.simple-counts article').count(),2);assert.equal(await admin.locator('table').count(),0);assert.equal(await admin.locator('#settings-form').count(),0);
   await page.locator('#companions-count').fill('3');await page.waitForFunction(()=>document.querySelector('#response-message').textContent.includes('٤'));assert.equal(await page.locator('#ticket-party-count').innerText(),'٤');
   await admin.getByRole('button',{name:/تحديث العدد/}).click();await admin.waitForFunction(expected=>document.querySelector('#stat-confirmed').textContent===expected,new Intl.NumberFormat('ar-JO').format(baseline.confirmedGuests+4));
   await page.getByRole('button',{name:'إضافة مرافق',exact:true}).click();await page.getByRole('button',{name:'إضافة مرافق',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#response-message').textContent.includes('٦'));
   await admin.getByRole('button',{name:/تحديث العدد/}).click();await admin.waitForFunction(expected=>document.querySelector('#stat-confirmed').textContent===expected,new Intl.NumberFormat('ar-JO').format(baseline.confirmedGuests+6));
   await page.locator('#rsvp').screenshot({path:'output/rsvp-companions.png'});await admin.screenshot({path:'output/dashboard-simple.png',fullPage:true});
   await page.reload();await page.keyboard.press('Escape');await page.locator('#envelope-cover').waitFor({state:'hidden'});assert.equal(await page.locator('#companions-count').inputValue(),'5');
   await page.getByRole('button',{name:'أعتذر عن الحضور'}).click();await page.waitForFunction(()=>document.querySelector('#response-message').textContent.includes('شكرًا'));assert.equal(await page.locator('#companions-panel').isVisible(),false);
   await admin.getByRole('button',{name:/تحديث العدد/}).click();await admin.waitForFunction(expected=>document.querySelector('#stat-confirmed').textContent===expected,new Intl.NumberFormat('ar-JO').format(baseline.confirmedGuests));
   const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const mobile=await mobileContext.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(service.base);await mobile.waitForLoadState('networkidle');await mobile.screenshot({path:'output/envelope-mobile-ar.png'});await mobile.keyboard.press('Escape');await mobile.locator('#envelope-cover').waitFor({state:'hidden'});
   assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await mobile.locator('[value="yes"]').evaluate(x=>x.getBoundingClientRect().height>=58));await mobile.screenshot({path:'output/invitation-mobile-ar.png',fullPage:true});
   await mobile.getByRole('button',{name:'أعتذر عن الحضور'}).click();await mobile.locator('#response-message').waitFor({state:'visible'});assert.match(await mobile.locator('#response-message').innerText(),/شكرًا/);await mobileContext.close();assert.deepEqual(errors,[]);
   }finally{await context.close();await browser.close();}
 });
 await t.test('real video loops 0.2s, stops at 4s, fades through gold, and shows countdown and maps card',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
  try{
   await page.goto(service.base);
   await page.waitForFunction(()=>{const v=document.querySelector('#envelope-idle');return !v.hidden&&!v.paused&&v.duration>0;});
   const loop=await page.locator('#envelope-idle').evaluate(async v=>{let wraps=0,last=v.currentTime,max=0;const end=performance.now()+1300;while(performance.now()<end){await new Promise(r=>setTimeout(r,20));max=Math.max(max,v.currentTime);if(v.currentTime<last-.04)wraps++;last=v.currentTime;}return{wraps,max,duration:v.duration};});
   assert.ok(Math.abs(loop.duration-.2)<.01);assert.ok(loop.wraps>=2,JSON.stringify(loop));assert.ok(loop.max<=.215,JSON.stringify(loop));
   assert.equal(await page.locator('#envelope-video').evaluate(v=>v.duration),4);
   assert.ok(await page.locator('#envelope-video').evaluate(v=>!v.controls&&v.muted&&v.playsInline));
   await page.getByRole('button',{name:'فتح الدعوة',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#envelope-light').classList.contains('blooming'));
   assert.equal(await page.locator('#envelope-idle').evaluate(v=>v.paused),true);
   await page.screenshot({path:'output/reveal-gold-transition.png'});
   await page.locator('#envelope-cover').waitFor({state:'hidden',timeout:12000});
   const ending=await page.locator('#envelope-video').evaluate(v=>({time:v.currentTime,paused:v.paused,duration:v.duration}));assert.ok(ending.time>=3.95&&ending.time<=4.01,JSON.stringify(ending));assert.equal(ending.paused,true);
   await page.locator('#envelope-light').waitFor({state:'hidden'});assert.equal(await page.locator('#invitation').evaluate(x=>x.inert),false);
   assert.equal(await page.locator('#countdown').isVisible(),true);const seconds=await page.locator('#count-seconds').innerText();await page.waitForFunction(previous=>document.querySelector('#count-seconds').textContent!==previous,seconds,{timeout:2500});
   const map=new URL(await page.locator('#venue-card').getAttribute('href'));assert.equal(map.hostname,'www.google.com');assert.equal(map.pathname,'/maps/search/');assert.equal(map.searchParams.get('query'),'Fairmont Hotel Amman Jordan');assert.equal(await page.locator('#venue-card').getAttribute('target'),'_blank');
   const cfg=(await send('/api/wedding')).data;assert.equal(cfg.date,'2026-11-20');assert.equal(cfg.ceremonyTime,'19:30');assert.equal(await page.locator('.program-row').count(),10);assert.equal(await page.locator('.program-row time').first().getAttribute('datetime'),'2026-11-20T16:30:00+03:00');assert.equal(await page.locator('.program-row time').last().getAttribute('data-end'),'23:00');
   await page.locator('.program-row').last().scrollIntoViewIfNeeded();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.program-row:last-child')).opacity==='1');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await page.locator('#venue-card').evaluate(x=>x.getBoundingClientRect().height>150));
   await page.screenshot({path:'output/invitation-video-countdown-mobile.png',fullPage:true});
   await page.locator('#venue-card').screenshot({path:'output/venue-card.png'});
   await page.locator('.countdown-card').screenshot({path:'output/countdown-card.png'});
   await page.getByRole('button',{name:'مشاهدة الظرف مجددًا'}).click();await page.waitForFunction(()=>{const v=document.querySelector('#envelope-idle');return !v.paused&&v.currentTime<.21;});
   await page.keyboard.press('Escape');await page.locator('#envelope-cover').waitFor({state:'hidden'});assert.equal(await page.locator('#envelope-idle').evaluate(v=>v.paused),true);
  }finally{await context.close();await browser.close();}
 });
 }finally{await service.stop();await rm(dir,{recursive:true,force:true});}
});
