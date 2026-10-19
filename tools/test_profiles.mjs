import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { treeProgress } from '../js/learning-tree.js';
import * as cloudMerge from '../js/cloud-merge.js';
// Inject the store's real module dependency into each isolated VM tab.
const source = fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/export /g, '');
function store(initial) {
  const data = new Map(initial ? [['wallboard-en-v1', JSON.stringify(initial)]] : []);
  const localStorage = { getItem: k => data.get(k) || null, setItem: (k,v) => data.set(k,v) };
  const c = vm.createContext({ localStorage, console, Date, JSON, Math, structuredClone, crypto: webcrypto, ...cloudMerge });
  vm.runInContext(source + '\nthis.api={get,update,switchUser,currentUserId,getUserState,replaceState,exportJSON,importJSON,onSave};', c);
  return { ...c.api, data, context: c };
}
const s = store({ profile: {xp: 75}, sessions: [{seconds: 90, date: new Date().toISOString()}], reading: {id:9000001}, settings:{mimoKey:'private',theme:'dark',voiceRev:2} });
assert.equal(s.get().profile.xp,75);
s.switchUser('female');
assert.equal(s.get().profile.xp,0);
assert.equal(s.get().sessions.length,0);
assert.equal(s.get().settings.theme,'dark');
s.update(st => {st.profile.xp=20; st.settings.palette='ocean';});
s.switchUser('male');
assert.equal(s.get().profile.xp,75);
assert.equal(s.get().settings.palette,'ocean');
assert.equal(treeProgress(s.get()).points,76);
assert.equal(treeProgress(s.getUserState('female')).points,20);
const next=JSON.parse(JSON.stringify(s.getUserState('female')));next.profile.xp=60;
s.replaceState(next,{userId:'female',silent:true});
assert.equal(s.get().profile.xp,75,'background sync must not change active learner');
assert.equal(s.getUserState('female').profile.xp,60);
const backup=s.exportJSON();assert(!backup.includes('private'));
assert.equal(JSON.parse(backup).users.male.profile.xp,75);
const fresh=store(JSON.parse(s.data.get('wallboard-en-v1')));
assert.equal(fresh.getUserState('female').profile.xp,60);
fresh.switchUser('female');
assert(fresh.importJSON(JSON.stringify({profile:{xp:3}})).ok);
assert.equal(fresh.get().profile.xp,3);
assert.equal(fresh.getUserState('male').profile.xp,75);
assert(fresh.importJSON(backup).ok);
assert.equal(fresh.get().profile.xp,60);
assert.equal(fresh.get().settings.mimoKey,'private');
assert(!fresh.importJSON('{"format":2,"users":{}}').ok);
assert.equal(fresh.get().profile.xp,60);
// A failed restore must leave the previous in-memory learner unchanged.
const diskStorage = fresh.context.localStorage;
const originalWrite = diskStorage.setItem;
diskStorage.setItem = () => { throw new Error('Quota exceeded'); };
assert(!fresh.importJSON(JSON.stringify({profile:{xp:9999}})).ok);
assert.equal(fresh.get().profile.xp,60);
diskStorage.setItem = originalWrite;
// Opposite-profile tabs must retain each other's persisted progress.
const tabA=store(JSON.parse(s.data.get('wallboard-en-v1')));
const tabB=store(JSON.parse(s.data.get('wallboard-en-v1')));
tabB.context.localStorage.getItem=k=>tabA.data.get(k)||null;
tabB.context.localStorage.setItem=(k,v)=>tabA.data.set(k,v);
tabA.switchUser('female');tabA.update(st=>{st.profile.xp=123;});
tabB.update(st=>{st.profile.xp=222;});
assert.equal(JSON.parse(tabA.data.get('wallboard-en-v1')).users.female.profile.xp,123);
assert.equal(tabB.getUserState('female').profile.xp,123);
for(const points of [0,49,50,149,150,399,400,799,800,1499,1500]) {
 const result=treeProgress({profile:{xp:points},sessions:[]});
 assert.equal(result.stage,[0,50,150,400,800,1500].filter(t=>points>=t).length);
}
// Mock GitHub to exercise legacy migration and a profile switch during the remote read.
let switched=false;const written=new Map();
const remote={state:{...s.getUserState('male'),updatedAt:Date.now()+1000},salt:'unused'};
const syncSrc=fs.readFileSync(new URL('../js/github-sync.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
const ctx=s.context;
Object.assign(ctx, {crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,btoa,atob,
 setTimeout:()=>0,clearTimeout:()=>{},window:{dispatchEvent(){}},CustomEvent:class{},
 fetch:async(url,opts)=> {
   const file=url.split('/').at(-1);
   if(opts.method==='PUT') {written.set(file,JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(JSON.parse(opts.body).content),c=>c.charCodeAt(0)))));return {ok:true,json:async()=>({})};}
   if(!switched) {switched=true;s.switchUser('female');}
   if(file==='progress.json') return {ok:true,json:async()=>({sha:'legacy',content:btoa(unescape(encodeURIComponent(JSON.stringify(remote))))})};
   return {status:404};
 }});
// Avoid redeclaring store bindings when loading the sync module into the same VM.
const scoped='(async()=>{'+syncSrc+'\n token="test";cfg={repo:"test/test",salt:"salt"};key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);await syncNow();return syncState;})()';
const result=await vm.runInContext(scoped,ctx);
assert.equal(result.status,'ok',result.message);
assert.equal(s.currentUserId(),'female');
assert.equal(s.get().profile.xp,60);
assert(written.has('progress-male.json'));
assert(written.has('progress-female.json'));
assert.equal(written.get('progress-female.json').state.profile.xp,60);
assert(!written.has('progress.json'));
// Route teardown must flush the old learner before activating the next timer.
let clock=0;
Object.assign(ctx,{performance:{now:()=>clock},document:{hidden:false},studyDay:()=> '2026-10-15'});
const timerSrc=fs.readFileSync(new URL('../js/study-timer.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
const timer=vm.runInContext('(()=>{'+timerSrc+';return {startStudyTimer,stopStudyTimer};})()',ctx);
timer.startStudyTimer('reading');clock=65000;timer.stopStudyTimer();
const femaleSeconds=s.get().sessions.reduce((n,r)=>n+(r.seconds||0),0);
s.switchUser('male');timer.startStudyTimer('word');clock=95000;timer.stopStudyTimer();
assert.equal(s.getUserState('female').sessions.reduce((n,r)=>n+(r.seconds||0),0),femaleSeconds);
assert(s.get().sessions.some(r=>r.mode==='word'&&r.seconds===30));
console.log('PASS: migration, independent progress, shared settings, failed restore rollback, opposite-user tabs, sync during switching, two-user backup, old backup, tree thresholds, timer ownership, legacy cloud migration.');
