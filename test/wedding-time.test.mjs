import test from 'node:test';
import assert from 'node:assert/strict';
import {weddingInstant,countdownParts} from '../public/wedding-time.js';
test('wedding time uses Jordan time rather than the visitor time zone',()=>{
  assert.equal(weddingInstant({date:'2027-05-14',ceremonyTime:'19:00',timezone:'Asia/Amman'}).toISOString(),'2027-05-14T16:00:00.000Z');
  assert.equal(weddingInstant({date:'2027-05-14',ceremonyTime:'19:00',timezone:'UTC'}).toISOString(),'2027-05-14T19:00:00.000Z');
});
test('countdown computes whole days, hours, minutes, seconds and clamps completed events',()=>{
 const target=new Date('2027-05-14T16:00:00Z');
 assert.deepEqual(countdownParts(target,target.getTime()-(2*86400+3*3600+4*60+5)*1000),{days:2,hours:3,minutes:4,seconds:5,started:false});
 assert.deepEqual(countdownParts(target,target.getTime()+1000),{days:0,hours:0,minutes:0,seconds:0,started:true});
 assert.equal(weddingInstant({date:'2027-05-14',ceremonyTime:''}),null);assert.equal(countdownParts(null),null);
});
