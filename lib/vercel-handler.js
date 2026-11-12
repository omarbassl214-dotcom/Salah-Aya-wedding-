import { randomBytes, createHash } from 'node:crypto';
import { weddingConfig } from './wedding-config.js';
import { getStore } from './neon-store.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const response = row => row ? { id:row.id, attending:row.attending, companions:row.companions,
  note:row.note, partySize:row.attending ? 1+row.companions : 0 } : null;
function json(res,status,value) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(value));
}
function guest(req,res) {
  let token = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('wedding_guest='))?.slice(14);
  if (!/^[a-f0-9]{64}$/.test(token || '')) {
    token=randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie',`wedding_guest=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${process.env.VERCEL || process.env.SECURE_COOKIES==='true' ? '; Secure' : ''}`);
  }
  return hash(token);
}
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415,'تعذر قراءة البيانات المرسلة.');
  let value;
  if (req.body !== undefined) {
    if (Buffer.byteLength(typeof req.body==='string' ? req.body : JSON.stringify(req.body))>20000) fail(413,'الرسالة طويلة جدًا.');
    try { value=typeof req.body==='string' ? JSON.parse(req.body) : req.body; } catch { fail(400,'البيانات غير صالحة.'); }
  } else {
    let size=0; const chunks=[];
    for await (const chunk of req) { size+=Buffer.byteLength(chunk); if(size>20000) fail(413,'الرسالة طويلة جدًا.'); chunks.push(Buffer.from(chunk)); }
    try { value=JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400,'البيانات غير صالحة.'); }
  }
  if(!value || typeof value!=='object' || Array.isArray(value)) fail(400,'البيانات غير صالحة.');
  return value;
}
function sameOrigin(req) {
  try {
    const origin=new URL(req.headers.origin);
    const allowed = new Set([req.headers.host, 'salah-aya-wedding.pages.dev', 'salah-aya-wedding.vercel.app']);
    // Host comes from the request, not a client-supplied forwarded-host header.
    if(!allowed.has(origin.host) || !['https:','http:'].includes(origin.protocol)) throw 0;
    if(process.env.VERCEL && origin.protocol!=='https:') throw 0;
  } catch { fail(403,'يرجى إرسال الرد من موقع الدعوة.'); }
}
export function createHandler(storeProvider=getStore) {
  return async function handler(req,res,path) {
    try {
      if (path==='/api/wedding' && req.method==='GET') return json(res,200,weddingConfig);
      if (!['GET','POST'].includes(req.method)) fail(405,'هذا الطلب غير مسموح.');
      if (path==='/api/rsvp/simple' && req.method==='POST') sameOrigin(req);
      if (!['/api/rsvp/simple','/api/admin/counts','/api/admin/comments','/api/admin/reset','/api/health'].includes(path)) fail(404,'لم يتم العثور على الطلب.');
      const store=await storeProvider();
      if(path==='/api/admin/reset') { if(req.method!=='POST') fail(405,'هذا الطلب غير مسموح.'); await store.reset(); return json(res,200,{ok:true,yes:0,no:0}); }
      if(path==='/api/health') { await store.counts(); return json(res,200,{ok:true,storage:'postgres'}); }
      if(path==='/api/admin/counts') return json(res,200,await store.counts());
      if(path==='/api/admin/comments') {
        const comments = store.comments ? await store.comments() : [];
        return json(res,200,{comments});
      }
      const key=guest(req,res);
      if(req.method==='GET') return json(res,200,{response:response(await store.get(key))});
      const value=await readBody(req);
      if(typeof value.attending!=='boolean') fail(400,'يرجى اختيار تأكيد الحضور أو الاعتذار.');
      if(value.note!==undefined && typeof value.note!=='string') fail(400,'يرجى كتابة الملاحظة كنص.');
      if((value.note || '').length>500) fail(400,'يرجى اختصار الملاحظة إلى ٥٠٠ حرف.');
      const companions=value.companions ?? 0;
      if(!Number.isInteger(companions) || companions<0 || companions>999) fail(400,'يرجى اختيار عدد مرافقين صحيح من صفر إلى ٩٩٩.');
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:weddingConfig.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      if(weddingConfig.rsvpDeadline && today>weddingConfig.rsvpDeadline) fail(400,'انتهت مهلة تأكيد الحضور. يرجى التواصل مع العروسين.');
      if(!await store.allow(key)) fail(429,'محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة مجددًا.');
      const saved=await store.save(key,{id:randomBytes(12).toString('hex'),attending:value.attending,
        companions:value.attending ? companions : 0,note:(value.note || '').trim().replace(/[\u0000-\u001f\u007f]/g,'')});
      return json(res,200,{ok:true,response:response(saved)});
    } catch(error) {
      // Do not expose database URLs, query text, credentials, or private notes.
      return json(res,error.status || 503,{error:error.status ? error.message : 'تعذر الاتصال بخدمة تأكيد الحضور. يرجى المحاولة لاحقًا.'});
    }
  };
}
export const handler=createHandler();
