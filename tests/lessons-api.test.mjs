import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, geminiTurns, parseClock } from '../js/lessons/api.js';
import { approvedEndpoint } from '../js/api-origins.js';
import { flatten, toSrt, correctionsByLine, invalidateNotes } from '../js/lessons/format.js';
const auth = {provider:'mimo',key:'test',endpoint:approvedEndpoint('mimo')};
const originalFetch = globalThis.fetch;
test('already cancelled requests never reach fetch', async () => {
  const ctl = new AbortController(); ctl.abort(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('should not run'); };
  try { await assert.rejects(transcribe(auth,'',{signal:ctl.signal}),{name:'AbortError'}); assert.equal(calls,0); }
  finally { globalThis.fetch=originalFetch; }
});
test('cancel remains attached until the response body is consumed', async () => {
  const ctl = new AbortController(); let began;
  const bodyStarted = new Promise(r => { began=r; });
  globalThis.fetch = async (_, {signal}) => ({ok:true,json:()=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true}); began();
  })});
  try { const pending=transcribe(auth,'',{signal:ctl.signal}); await bodyStarted; ctl.abort(); await assert.rejects(pending,{name:'AbortError'}); }
  finally {globalThis.fetch=originalFetch;}
});
test('reject unapproved credential destinations', async()=>{
  assert.throws(()=>approvedEndpoint('mimo','https://attacker.example/v1/chat/completions'));
  await assert.rejects(transcribe({...auth,endpoint:'https://attacker.example'},''),/Unapproved/);
});
test('invalid success shape stays retryable and explicit silence is accepted', async()=>{
  const gem={provider:'gemini',key:'test',base:approvedEndpoint('gemini')};
  let output={unexpected:true};
  globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:'STOP'}]})});
  try {
    await assert.rejects(geminiTurns(gem,'test','',null),/Invalid transcript/);
    output={turns:[]}; await assert.rejects(geminiTurns(gem,'test','',null),/silence/);
    output={turns:[],silence:true}; assert.deepEqual(await geminiTurns(gem,'test','',null),[]);
  } finally {globalThis.fetch=originalFetch;}
});
test('bad request is not automatically classified as an oversized audio', async()=>{
  globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({error:{message:'Unsupported model'}})});
  try { await assert.rejects(transcribe(auth,''),e=>e.status===400&&!e.tooLong); }
  finally {globalThis.fetch=originalFetch;}
});
test('timestamps reject absent/invalid values and never move backwards',()=>{
  for(const t of [null,undefined,'','bad','1:99',-1]) assert.ok(Number.isNaN(parseClock(t)));
  assert.equal(parseClock('1:02.5'),62.5);
  const lesson={duration:100,chunks:[{start:0,end:100,turns:[{role:'student',text:'one',at:80},{role:'teacher',text:'two'}]}]};
  assert.deepEqual(flatten(lesson).map(t=>t.start),[80,80]);
});
test('subtitles do not overlap or exceed duration',()=>{
  const s=toSrt({duration:0.8,chunks:[{start:0,end:0.8,turns:[{role:'student',text:'a',at:0},{role:'teacher',text:'b',at:0.5}]}]});
  assert.match(s,/00:00:00,000 --> 00:00:00,500/); assert.match(s,/00:00:00,500 --> 00:00:00,800/);
});
test('corrections require nonempty evidence and student ownership; edits invalidate notes',()=>{
  const turns=[{role:'teacher',text:'我去商场'},{role:'student',text:'我去商场'}];
  const fixes=correctionsByLine(turns,[{line:0,original:'我去商场',suggestion:'test'},{line:0,original:'!!!',suggestion:'bad'}]);
  assert.deepEqual([...fixes.keys()],[1]);
  const lesson={notes:{summary:{}},transcriptVersion:1}; invalidateNotes(lesson); assert.equal(lesson.notes,null); assert.equal(lesson.transcriptVersion,2);
});
