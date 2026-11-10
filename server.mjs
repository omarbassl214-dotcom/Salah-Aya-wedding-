import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, timingSafeEqual, scryptSync } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
mkdirSync(dataDir, { recursive: true });
const accessFile = join(dataDir, 'admin-access.txt');
let password = process.env.ADMIN_PASSWORD;
if (!password) {
  if (existsSync(accessFile)) password = readFileSync(accessFile, 'utf8').match(/^Password: (.+)$/m)?.[1];
  if (!password) {
    password = randomBytes(18).toString('base64url');
    writeFileSync(accessFile, `ALI & ALAA — PRIVATE HOST ACCESS\n\nDashboard: http://localhost:${port}/admin\nUsername: admin\nPassword: ${password}\n\nKeep this file private. Guest data is in data/wedding.sqlite.\nSet ADMIN_PASSWORD in .env to override this password.\n`, { mode: 0o600 });
  }
}
const salt = randomBytes(32);
const passwordHash = scryptSync(password, salt, 64);
password = undefined;
const db = new DatabaseSync(join(dataDir, 'wedding.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rsvps (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
 contact_key TEXT NOT NULL UNIQUE, attending INTEGER NOT NULL CHECK(attending IN (0,1)),
 adults INTEGER NOT NULL CHECK(adults BETWEEN 0 AND 8), children INTEGER NOT NULL CHECK(children BETWEEN 0 AND 6),
 guest_names TEXT NOT NULL, dietary TEXT NOT NULL, note TEXT NOT NULL,
 checked_in INTEGER NOT NULL DEFAULT 0 CHECK(checked_in>=0 AND checked_in<=adults+children),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);`);
// Add accompanying guests without rebuilding or deleting existing RSVP records.
if(!db.prepare('PRAGMA table_info(rsvps)').all().some(column=>column.name==='companions')) {
 db.exec('ALTER TABLE rsvps ADD COLUMN companions INTEGER NOT NULL DEFAULT 0 CHECK(companions BETWEEN 0 AND 999)');
}

const defaults = {
 names: ['صلاح', 'آية'], date: '2027-05-14', ceremonyTime: '19:00', dinnerTime: '', timezone: 'Asia/Amman',
 venue: 'القاعة الكبرى — فندق فورسيزونز عمّان', address: 'الدوار الخامس، شارع الكندي، عمّان، الأردن', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Four+Seasons+Hotel+Amman+Jordan', rsvpDeadline: '', dressCode: 'لباس رسمي',
 envelopeVideo: '/assets/envelope-reveal-4s.mp4', envelopeLoopVideo: '/assets/envelope-idle-020s.mp4', loopEnd: 0.2, videoEnd: 4,
 welcome: 'ندعوكم لمشاركتنا فرحة زفافنا'
};
db.prepare('INSERT OR IGNORE INTO settings (id,value) VALUES (1,?)').run(JSON.stringify(defaults));
const settings = () => ({ ...defaults, ...JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value) });

// Apply the requested Arabic design once, preserving dates, venue and guest records.
const priorSettings = JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);
if (priorSettings.locale !== 'ar') {
 Object.assign(priorSettings, { locale: 'ar', theme: 'green-pink-gold', names: ['صلاح', 'آية'], welcome: defaults.welcome, dressCode: defaults.dressCode, envelopeVideo: '' });
 db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(priorSettings));
}

// Requested four-second reveal and example event details; keep existing guest records.
const revealSettings=JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);
if(revealSettings.videoRevealRevision!==2){
 Object.assign(revealSettings,{envelopeVideo:defaults.envelopeVideo,envelopeLoopVideo:defaults.envelopeLoopVideo,loopEnd:.2,videoEnd:4,videoRevealRevision:2});
 for(const key of ['date','ceremonyTime','venue','address','mapsUrl'])if(!revealSettings[key])revealSettings[key]=defaults[key];
 db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(revealSettings));
}

const sessions = new Map();
const limits = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');
const cookie = (value, age) => `wedding_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.SECURE_COOKIES === 'true' ? '; Secure' : ''}`;
const clean = (v, max = 200) => typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function json(res, status, data, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(data)); }
function rate(req, key, max, ms) {
 const id = `${req.socket.remoteAddress}:${key}`;
 let v = limits.get(id);
 if (!v || v.until < Date.now()) { v = { count: 0, until: Date.now() + ms }; limits.set(id, v); }
 if (++v.count > max) fail(429, 'محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة مجددًا.');
}
function auth(req) {
 const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('wedding_session='))?.slice(16);
 const expiry = token && sessions.get(hash(token));
 if (!expiry || expiry < Date.now()) fail(401, 'يرجى تسجيل الدخول إلى لوحة الدعوة.');
 return token;
}
function guestKey(req,res) {
 let token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('wedding_guest='))?.slice(14);
 if(!token || !/^[a-f0-9]{64}$/.test(token)) {
  token=randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', `wedding_guest=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${process.env.SECURE_COOKIES === 'true' ? '; Secure' : ''}`);
 }
 return 'simple:'+hash(token);
}
function deadlineCheck() {
 const cfg=settings();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:cfg.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(cfg.rsvpDeadline && today>cfg.rsvpDeadline)fail(400,'انتهت مهلة تأكيد الحضور. يرجى التواصل مع العروسين.');
}

async function body(req) {
 if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'تعذر قراءة البيانات المرسلة.');
 let size = 0; const chunks = [];
 for await (const chunk of req) { size += chunk.length; if (size > 20000) fail(413, 'الرسالة طويلة جدًا.'); chunks.push(chunk); }
 try { const v = JSON.parse(Buffer.concat(chunks).toString()); if (!v || Array.isArray(v) || typeof v !== 'object') fail(400, 'البيانات غير صالحة.'); return v; }
 catch { fail(400, 'يرجى مراجعة البيانات والمحاولة مجددًا.'); }
}
function validateRsvp(v) {
 const name = clean(v.name, 100), contact = clean(v.contact, 160);
 if (name.length < 2) fail(400, 'يرجى إدخال الاسم الكامل.');
 let contactKey;
 if (contact.includes('@')) {
   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) fail(400, 'يرجى إدخال بريد إلكتروني صحيح.');
   contactKey = contact.toLowerCase();
 } else {
   const digits = contact.replace(/[\s()+.\-]/g, '');
   if (!/^\d{7,15}$/.test(digits)) fail(400, 'يرجى إدخال بريد إلكتروني أو رقم هاتف صحيح.');
   contactKey = digits;
 }
 if (typeof v.attending !== 'boolean') fail(400, 'يرجى اختيار الحضور أو الاعتذار.');
 if (v.attending && v.confirmed !== true) fail(400, 'يرجى تأكيد الحضور قبل الإرسال.');
 const adults = v.attending ? v.adults : 0, children = v.attending ? v.children : 0;
 if (!Number.isInteger(adults) || adults < (v.attending ? 1 : 0) || adults > 8 || !Number.isInteger(children) || children < 0 || children > 6) fail(400, 'يرجى التحقق من عدد الضيوف.');
 const guestNames = Array.isArray(v.guestNames) ? v.guestNames.map(x => clean(x, 100)) : [];
 if (v.attending && (guestNames.length !== adults + children - 1 || guestNames.some(x => x.length < 2))) fail(400, 'يرجى إدخال أسماء المرافقين.');
 return { name, contact, contactKey, attending: v.attending ? 1 : 0, adults, children, guestNames: v.attending ? guestNames : [], dietary: clean(v.dietary, 500), note: clean(v.note, 1000) };
}
function validateSettings(v) {
 const out = { ...settings() };
 if (!Array.isArray(v.names) || v.names.length !== 2 || v.names.some(n => !clean(n, 60))) fail(400, 'يرجى إدخال اسمَي العروسين.');
 out.names = v.names.map(n => clean(n, 60));
 for (const key of ['venue','address','welcome','dressCode']) out[key] = clean(v[key], key === 'welcome' ? 400 : 200);
 for (const key of ['date', 'rsvpDeadline']) {
   const value = clean(v[key], 10);
   if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) fail(400, 'يرجى اختيار تاريخ صحيح.');
   out[key] = value;
 }
 if (out.date && out.rsvpDeadline && out.rsvpDeadline > out.date) fail(400, 'يجب أن تسبق مهلة الرد موعد الزفاف أو توافقه.');
 for (const key of ['ceremonyTime','dinnerTime']) { const value = clean(v[key],5); if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(400, 'يرجى اختيار وقت صحيح.'); out[key] = value; }
 out.timezone = clean(v.timezone, 80) || 'Asia/Amman';
 try { new Intl.DateTimeFormat('en', { timeZone: out.timezone }).format(); } catch { fail(400, 'يرجى إدخال منطقة زمنية صحيحة.'); }
 out.mapsUrl = clean(v.mapsUrl, 500);
 if (out.mapsUrl) { try { if (new URL(out.mapsUrl).protocol !== 'https:') throw 0; } catch { fail(400, 'يجب أن يبدأ رابط الموقع بـ https://.'); } }
 out.envelopeVideo = clean(v.envelopeVideo, 160);
 if (out.envelopeVideo && !/^\/assets\/[a-zA-Z0-9_\-/]+\.(mp4|webm)$/.test(out.envelopeVideo)) fail(400, 'أدخل مسار فيديو محلي مثل /assets/envelope-opening.mp4.');
 out.envelopeLoopVideo=clean(v.envelopeLoopVideo ?? out.envelopeLoopVideo,160);
 if(out.envelopeLoopVideo && !/^\/assets\/[a-zA-Z0-9_\-/]+\.(mp4|webm)$/.test(out.envelopeLoopVideo))fail(400,'يرجى إدخال مسار فيديو التكرار المحلي الصحيح.');
 out.loopEnd = Number(v.loopEnd ?? 0.2);
 if (!Number.isFinite(out.loopEnd) || out.loopEnd < 0.2 || out.loopEnd > 10) fail(400, 'يجب أن تتراوح مدة الجزء المغلق بين ٠٫٢ و١٠ ثوانٍ.');
 out.videoEnd=Number(v.videoEnd ?? out.videoEnd ?? 4);
 if(!Number.isFinite(out.videoEnd)||out.videoEnd<=out.loopEnd||out.videoEnd>60)fail(400,'يجب أن تكون نهاية الفيديو بعد جزء التكرار وأقل من دقيقة.');
 return out;
}
function guests() { return db.prepare('SELECT id,name,contact,attending,adults,children,companions,guest_names,dietary,note,checked_in,created_at,updated_at FROM rsvps ORDER BY created_at DESC').all().map(row => ({ ...row, guest_names: JSON.parse(row.guest_names) })); }
function stats(rows) { return { responses: rows.length, confirmedParties: rows.filter(x => x.attending).length, confirmedGuests: rows.reduce((a,x) => a + (x.attending ? x.adults+x.children+(x.companions||0) : 0),0), adults: rows.reduce((a,x) => a+x.adults,0), children: rows.reduce((a,x) => a+x.children,0), declined: rows.filter(x => !x.attending).length, checkedIn: rows.reduce((a,x) => a+x.checked_in,0) }; }
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.woff2':'font/woff2', '.mp4':'video/mp4', '.webm':'video/webm', '.ico':'image/x-icon' };
const server = http.createServer(async (req,res) => {
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
 try {
   const actualPort = server.address()?.port || port;
   const allowedHosts = new Set([`localhost:${actualPort}`,`127.0.0.1:${actualPort}`]);
   if (process.env.PUBLIC_ORIGIN) allowedHosts.add(new URL(process.env.PUBLIC_ORIGIN).host);
   if (!allowedHosts.has(req.headers.host)) fail(403, 'عنوان الموقع غير معتمد.');
   const url = new URL(req.url, `http://${req.headers.host}`);
   if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
     const origin = req.headers.origin;
     const allowedOrigins = new Set([`http://localhost:${actualPort}`, `http://127.0.0.1:${actualPort}`, process.env.PUBLIC_ORIGIN].filter(Boolean));
     if (!origin || !allowedOrigins.has(origin)) fail(403, 'يرجى إرسال الرد من موقع الدعوة.');
   }
   if (req.method === 'GET' && url.pathname === '/api/health') return json(res,200,{ok:true});
   if (req.method === 'GET' && url.pathname === '/api/wedding') return json(res,200,settings());
   if(url.pathname==='/api/rsvp/simple' && req.method==='GET') {
     const key=guestKey(req,res),row=db.prepare('SELECT id,attending,note,adults,children,companions FROM rsvps WHERE contact_key=?').get(key);
     return json(res,200,{response:row?{id:row.id,attending:!!row.attending,note:row.note,companions:row.companions,partySize:row.attending?row.adults+row.children+row.companions:0}:null});
   }
   if(url.pathname==='/api/rsvp/simple' && req.method==='POST') {
     rate(req,'simple-rsvp',30,3600e3);const v=await body(req);deadlineCheck();
     if(typeof v.attending!=='boolean')fail(400,'يرجى اختيار تأكيد الحضور أو الاعتذار.');
     if(v.note!==undefined && typeof v.note!=='string')fail(400,'يرجى كتابة الملاحظة كنص.');
     if((v.note||'').length>500)fail(400,'يرجى اختصار الملاحظة إلى ٥٠٠ حرف.');
     const requestedCompanions=v.companions??0;
     if(!Number.isInteger(requestedCompanions)||requestedCompanions<0||requestedCompanions>999)fail(400,'يرجى اختيار عدد مرافقين صحيح من صفر إلى ٩٩٩.');
     const companions=v.attending?requestedCompanions:0;
     const key=guestKey(req,res),note=clean(v.note,500),now=new Date().toISOString();
     const existing=db.prepare('SELECT id,checked_in FROM rsvps WHERE contact_key=?').get(key);
     if(existing?.checked_in>0)fail(409,'تم تسجيل وصولك. يرجى طلب تعديل الرد من صاحب الدعوة.');
     const id=existing?.id || randomBytes(12).toString('hex');
     if(existing)db.prepare('UPDATE rsvps SET attending=?,adults=?,children=0,companions=?,note=?,updated_at=? WHERE id=?').run(v.attending?1:0,v.attending?1:0,companions,note,now,id);
     else db.prepare('INSERT INTO rsvps (id,token_hash,name,contact,contact_key,attending,adults,children,guest_names,dietary,note,created_at,updated_at,companions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,hash(key),'ضيف '+id.slice(0,4),'',key,v.attending?1:0,v.attending?1:0,0,'[]','',note,now,now,companions);
     return json(res,200,{ok:true,response:{id,attending:v.attending,note,companions,partySize:v.attending?1+companions:0}});
   }
   if (req.method === 'POST' && url.pathname === '/api/admin/login') {
     rate(req,'login',8,15*60e3); const v = await body(req);
     if (typeof v.password !== 'string' || v.password.length > 200 || !timingSafeEqual(scryptSync(v.password,salt,64),passwordHash)) fail(401,'كلمة المرور غير صحيحة.');
     const token = randomBytes(32).toString('hex'); sessions.set(hash(token),Date.now()+12*3600e3);
     return json(res,200,{ok:true},{'Set-Cookie':cookie(token,12*3600)});
   }
   if (req.method === 'POST' && url.pathname === '/api/admin/logout') { const t=auth(req); sessions.delete(hash(t)); return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)}); }
   // The password-free dashboard exposes aggregate counts only.
   if(req.method==='GET' && url.pathname==='/api/admin/counts'){const s=stats(guests());return json(res,200,{yes:s.confirmedGuests,no:s.declined});}
   if (url.pathname.startsWith('/api/admin/')) {
     auth(req);
     if (req.method === 'GET' && url.pathname === '/api/admin/guests') { const rows=guests(); return json(res,200,{guests:rows,stats:stats(rows)}); }
     if (req.method === 'PUT' && url.pathname === '/api/admin/settings') { const v=validateSettings(await body(req)); db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(v)); return json(res,200,v); }
     if (req.method === 'GET' && url.pathname === '/api/admin/export') {
       const rows=guests(), header=['الاسم أو مرجع الرد','التواصل','الرد','بالغون','أطفال','عدد المرافقين الإضافيين','المرافقون','ملاحظات غذائية','الرسالة','الواصلون','وقت الرد'];
       const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@\-]/, "'$&").replace(/"/g,'""')+'"';
       const csv='\uFEFF'+[header,...rows.map(x=>[x.name,x.contact,x.attending?'حضور مؤكد':'اعتذار',x.adults,x.children,x.companions,x.guest_names.join('; '),x.dietary,x.note,x.checked_in,x.created_at])].map(row=>row.map(cell).join(',')).join('\r\n');
       res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="salah-and-aya-guests.csv"','Cache-Control':'no-store'}); return res.end(csv);
     }
     const match=url.pathname.match(/^\/api\/admin\/guests\/([\w-]+)\/check-in$/);
     if (req.method==='PATCH' && match) {
       const v=await body(req), row=db.prepare('SELECT * FROM rsvps WHERE id=?').get(match[1]);
       if (!row) fail(404,'لم يتم العثور على الرد.');
       if (!row.attending || !Number.isInteger(v.count) || v.count<0 || v.count>row.adults+row.children) fail(400,'عدد الواصلين يجب أن يكون ضمن العدد المؤكد.');
       db.prepare('UPDATE rsvps SET checked_in=?,updated_at=? WHERE id=?').run(v.count,new Date().toISOString(),row.id);
       return json(res,200,{ok:true});
     }
   }
   if (req.method === 'POST' && url.pathname === '/api/rsvp') {
     rate(req,'rsvp',30,3600e3); const v=await body(req);
     if (v.website) return json(res,200,{ok:true});
     const cfg=settings();
     const today = new Intl.DateTimeFormat('en-CA',{timeZone:cfg.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
     if (cfg.rsvpDeadline && today > cfg.rsvpDeadline) fail(400,'انتهت مهلة تأكيد الحضور. يرجى التواصل مع العروسين.');
     const r=validateRsvp(v), now=new Date().toISOString();
     let id, token;
     if (v.id) {
       const existing=db.prepare('SELECT * FROM rsvps WHERE id=?').get(clean(v.id,60));
       if (!existing || typeof v.token!=='string' || hash(v.token)!==existing.token_hash) fail(403,'رابط التعديل غير صالح. يرجى التواصل مع العروسين.');
       if (existing.checked_in>0) fail(409,'تم تسجيل الوصول. يرجى طلب التعديل من صاحب الدعوة.');
       const duplicate=db.prepare('SELECT id FROM rsvps WHERE contact_key=? AND id<>?').get(r.contactKey,existing.id);
       if (duplicate) fail(409,'تم حفظ رد سابق لهذه البيانات. يرجى استخدام الجهاز نفسه أو التواصل مع العروسين.');
       id=existing.id; token=v.token;
       db.prepare('UPDATE rsvps SET name=?,contact=?,contact_key=?,attending=?,adults=?,children=?,guest_names=?,dietary=?,note=?,updated_at=? WHERE id=?').run(r.name,r.contact,r.contactKey,r.attending,r.adults,r.children,JSON.stringify(r.guestNames),r.dietary,r.note,now,id);
     } else {
       if (db.prepare('SELECT id FROM rsvps WHERE contact_key=?').get(r.contactKey)) fail(409,'تم حفظ رد سابق لهذه البيانات. يرجى استخدام الجهاز نفسه أو التواصل مع العروسين.');
       id=randomBytes(12).toString('hex'); token=randomBytes(24).toString('base64url');
       db.prepare('INSERT INTO rsvps (id,token_hash,name,contact,contact_key,attending,adults,children,guest_names,dietary,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,hash(token),r.name,r.contact,r.contactKey,r.attending,r.adults,r.children,JSON.stringify(r.guestNames),r.dietary,r.note,now,now);
     }
     return json(res,200,{ok:true,id,token,attending:!!r.attending,guests:r.adults+r.children});
   }
   if (url.pathname.startsWith('/api/')) fail(404,'لم يتم العثور على الطلب.');
   if (!['GET','HEAD'].includes(req.method)) fail(405,'هذا الطلب غير مسموح.');
   const pathname = url.pathname==='/admin' || url.pathname==='/admin/' ? '/admin.html' : url.pathname==='/' ? '/index.html' : decodeURIComponent(url.pathname);
   const publicRoot=join(root,'public'), path=resolve(publicRoot,'.'+pathname);
   if (!path.startsWith(publicRoot+sep)) fail(403,'الوصول غير مسموح.');
   if (!existsSync(path) || !statSync(path).isFile()) fail(404,'الصفحة غير موجودة.');
   const st=statSync(path), headers={'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','Accept-Ranges':'bytes'};
   // Native range support keeps the closed-first-second video loop and seeking smooth.
   if (req.headers.range && /\.(mp4|webm)$/.test(path)) {
     const range=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);
     if (!range) {res.writeHead(416,{'Content-Range':`bytes */${st.size}`}); return res.end();}
     const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),st.size-1):st.size-1;
     if(start> end || start>=st.size){res.writeHead(416,{'Content-Range':`bytes */${st.size}`});return res.end();}
     res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${st.size}`,'Content-Length':end-start+1});
     if(req.method==='HEAD')return res.end(); return createReadStream(path,{start,end}).pipe(res);
   }
   res.writeHead(200,{...headers,'Content-Length':st.size});
   if(req.method==='HEAD')return res.end(); createReadStream(path).pipe(res);
 } catch (e) {
   if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'تعذر إتمام الطلب. يرجى المحاولة مجددًا.'}); else res.end();
   if(!e.status) console.error(e);
 }
});
setInterval(()=>{const now=Date.now();for(const[k,v]of sessions)if(v<now)sessions.delete(k);for(const[k,v]of limits)if(v.until<now)limits.delete(k);},60e3).unref();
server.listen(port,host,()=>console.log(`Wedding invitation: http://localhost:${server.address().port}\nHost dashboard: http://localhost:${server.address().port}/admin\nPrivate password file: ${accessFile}`));
function shutdown(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
