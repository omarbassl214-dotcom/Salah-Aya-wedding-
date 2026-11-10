import test from 'node:test';
import assert from 'node:assert/strict';
import {weddingInstant,countdownParts} from '../public/wedding-time.js';
test('wedding time uses Jordan time rather than the visitor time zone',()=>{
  assert.equal(weddingInstant({date:'2026-11-20',ceremonyTime:'19:30',timezone:'Asia/Amman'}).toISOString(),'2026-11-20T16:30:00.000Z');
  assert.equal(weddingInstant({date:'2026-11-20',ceremonyTime:'19:30',timezone:'UTC'}).toISOString(),'2026-11-20T19:30:00.000Z');
});
test('countdown computes whole days, hours, minutes, seconds and clamps completed events',()=>{
 const target=new Date('2026-11-20T16:30:00Z');
 assert.deepEqual(countdownParts(target,target.getTime()-(2*86400+3*3600+4*60+5)*1000),{days:2,hours:3,minutes:4,seconds:5,started:false});
 assert.deepEqual(countdownParts(target,target.getTime()+1000),{days:0,hours:0,minutes:0,seconds:0,started:true});
 assert.equal(weddingInstant({date:'2026-11-20',ceremonyTime:''}),null);assert.equal(countdownParts(null),null);
});
