import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../lib/vercel-handler.js';

async function harness(t,provider) {
  const rows=new Map();
  const store={
    async get(key){ return rows.get(key) || null; },
    async save(key,value){const row={...value,id:rows.get(key)?.id || value.id};rows.set(key,row);return row;},
    async allow(){return true;},
    async counts(){return {yes:[...rows.values()].reduce((sum,r)=>sum+(r.attending?1+r.companions:0),0),no:[...rows.values()].filter(r=>!r.attending).length};}
  };
  const handler=createHandler(provider || (()=>store));
  const server=http.createServer((req,res)=>handler(req,res,new URL(req.url,'http://localhost').pathname));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {store,rows,base,async send(path,{body,cookie,origin=base,method=body===undefined?'GET':'POST'}={}){
    return fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json',Origin:origin}: {})},body:body===undefined?undefined:JSON.stringify(body)});
  }};
}
test('Vercel RSVP counts companions, replaces repeat responses, and restores browser response',async t=>{
  const h=await harness(t);
  const initial=await h.send('/api/rsvp/simple');
  assert.deepEqual(await initial.json(),{response:null});
  const cookie=initial.headers.get('set-cookie').split(';')[0];
  assert.match(initial.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const yes={attending:true,companions:3,note:'سنأتي مع العائلة'};
  let result=await (await h.send('/api/rsvp/simple',{body:yes,cookie})).json();
  assert.equal(result.response.partySize,4);
  const id=result.response.id;
  // A cold function instance shares durable storage, not its process memory.
  const fresh=await harness(t,()=>h.store);
  const afterColdStart=await (await fresh.send('/api/rsvp/simple',{cookie})).json();
  assert.equal(afterColdStart.response.id,id);
  assert.equal(afterColdStart.response.partySize,4);
  await h.send('/api/rsvp/simple',{body:yes,cookie});
  assert.equal(h.rows.size,1);
  assert.deepEqual(await (await h.send('/api/admin/counts')).json(),{yes:4,no:0});
  result=await (await h.send('/api/rsvp/simple',{body:{...yes,companions:5},cookie})).json();
  assert.equal(result.response.id,id);
  assert.equal(result.response.partySize,6);
  const restored=await (await h.send('/api/rsvp/simple',{cookie})).json();
  assert.equal(restored.response.companions,5);
  await h.send('/api/rsvp/simple',{body:{attending:false,companions:5,note:''},cookie});
  assert.deepEqual(await (await h.send('/api/admin/counts')).json(),{yes:0,no:1});
  assert.equal((await (await h.send('/api/rsvp/simple',{cookie})).json()).response.companions,0);
  // A second browser's answer has a separate cookie and adds its whole party.
  await h.send('/api/rsvp/simple',{body:{attending:true,companions:2,note:''}});
  assert.deepEqual(await (await h.send('/api/admin/counts')).json(),{yes:3,no:1});
});
test('Vercel rejects invalid inputs and foreign origins without changing counts',async t=>{
  const h=await harness(t);
  for(const companions of [-1,1.5,1000,'3']) assert.equal((await h.send('/api/rsvp/simple',{body:{attending:true,companions}})).status,400);
  assert.equal((await h.send('/api/rsvp/simple',{body:{attending:true,note:'x'.repeat(501)}})).status,400);
  assert.equal((await h.send('/api/rsvp/simple',{body:{attending:'yes'}})).status,400);
  assert.equal((await h.send('/api/rsvp/simple',{body:{attending:true},origin:'https://other.example'})).status,403);
  assert.equal(h.rows.size,0);
  assert.equal((await h.send('/api/admin/guests')).status,404);
  h.store.allow=async()=>false;
  assert.equal((await h.send('/api/rsvp/simple',{body:{attending:true}})).status,429);
  assert.equal(h.rows.size,0);
});
test('Vercel fails clearly when database is unavailable and never pretends to save',async t=>{
  const h=await harness(t,()=>{throw new Error('postgres://private-secret');});
  const r=await h.send('/api/rsvp/simple',{body:{attending:true,companions:3}});
  assert.equal(r.status,503);
  const body=await r.text();assert.ok(!body.includes('private-secret'));assert.ok(!body.includes('"ok":true'));
  assert.equal((await h.send('/api/health')).status,503);
  assert.equal((await h.send('/api/wedding')).status,200);
});
