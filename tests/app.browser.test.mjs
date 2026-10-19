import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { launchBrowser, delay } from './browser-harness.mjs';
const root=resolve(import.meta.dirname,'..');

test('app: mocked lesson processing, cancellation, deletion, copying and bounded transcript rendering', {skip:process.env.RUN_BROWSER_TESTS!=='1',timeout:60000}, async()=>{
  const server=createServer(async(req,res)=>{
    try {
      const path=decodeURIComponent(new URL(req.url,'http://local').pathname);
      if(path.endsWith('/config.local.js')) {res.writeHead(404);res.end();return;}
      const file=resolve(root,'.'+(path==='/'?'/index.html':path));
      if(!file.startsWith(root+'/')) {res.writeHead(403);res.end();return;}
      const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.mp3':'audio/mpeg','.png':'image/png'};
      res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
      res.end(await readFile(file));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let b;
  try {
    b=await launchBrowser();const errors=[];
    b.onEvent(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Page.javascriptDialogOpening')b.send('Page.handleJavaScriptDialog',{accept:true});});
    await b.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await b.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/index.html#lessons`});
    await b.waitFor('!!document.querySelector(".ls-list")');
    await b.evaluate(`(async()=>{
      localStorage.setItem('wallboard-gemini-key','test-only');
      const native=window.fetch.bind(window); window.__apiCalls=0; window.__mode='ok';
      window.fetch=async(url,opts={})=>{
        if(!String(url).startsWith('https://generativelanguage.googleapis.com/'))return native(url,opts);
        window.__apiCalls++; const body=JSON.parse(opts.body);
        if(window.__mode==='hold')return new Promise((resolve,reject)=>{if(opts.signal.aborted)reject(opts.signal.reason);else opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true});});
        const audio=body.contents[0].parts.some(p=>p.inline_data);
        const data=audio?{turns:[{start:'00:00',role:'teacher',text:'What did you do?',zh:'你做了什么？'},{start:'00:00.5',role:'student',text:'I go yesterday.',zh:'我昨天去了。'}]}:{summary_en:'Past tense practice.',summary_zh:'过去时练习。',corrections:[{line:1,original:'I go yesterday.',suggestion:'I went yesterday.',reason_zh:'过去时'}],expressions:[{en:'over the weekend',zh:'周末',example:'over the weekend'}],words:[{word:'mall',pos:'n.',zh:'商场',example:'a mall'}]};
        return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});
      };
      const a=await import('./js/lessons/audio.js'); const runner=await import('./js/lessons/runner.js');
      window.__file=new File([a.wavBytes(new Int16Array(32000),0,2)],'lesson.wav',{type:'audio/wav'});
      window.__lesson=await runner.createLesson(window.__file,'Mock lesson');
    })()`);
    await b.waitFor(`(async()=>{const l=await (await import('./js/lessons/db.js')).getLesson(window.__lesson);return l?.status==='done'})()`);
    await b.waitFor('!!document.querySelector(".ls-card-main")');
    await b.evaluate('document.querySelector(".ls-card-main").click()');
    await b.waitFor('!!document.querySelector(".ls-line.student")');
    assert.equal(await b.evaluate('document.querySelector(".ls-line.student .ls-text").textContent'),'I go yesterday.');
    await b.evaluate('window.__copy="";navigator.clipboard.writeText=async t=>{window.__copy=t};[...document.querySelectorAll(".mode-head button")].find(b=>b.textContent.includes("Copy all")).click()');
    await b.waitFor('window.__copy.includes("## Transcript")');
    assert.ok(await b.evaluate('window.__copy.includes("## Summary") && window.__copy.includes("I go yesterday.")'));
    await b.evaluate('document.querySelector(".ls-line.student .ls-role").click()');
    await b.waitFor(`(async()=>!(await (await import('./js/lessons/db.js')).getLesson(window.__lesson)).notes)()`);
    // Long transcript uses bounded DOM, correction/role changes remain editable.
    await b.evaluate(`(async()=>{
      location.hash='#standby'; await new Promise(r=>setTimeout(r,80));
      const db=await import('./js/lessons/db.js');const l=await db.getLesson(window.__lesson);
      l.duration=4000;l.chunks=[{start:0,end:4000,status:'done',text:'long',turns:Array.from({length:2000},(_,i)=>({role:i%2?'student':'teacher',text:'Line '+i,zh:'中文',at:i*2}))}];await db.putLesson(l);location.hash='#lessons';
    })()`);
    await b.waitFor('!!document.querySelector(".ls-lines")');
    assert.ok(await b.evaluate('document.querySelectorAll(".ls-line").length<=80'));
    for(const [width,height] of [[1133,744],[390,844]]) {
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(150);
      const overflow=await b.evaluate('document.getElementById("screen").scrollWidth-document.getElementById("screen").clientWidth');
      assert.ok(overflow<=1,'horizontal overflow '+width+': '+overflow);
    }
    // Cancel while provider request is pending: no subsequent paid stage may start.
    await b.evaluate(`(async()=>{window.__mode='hold';window.__cancelId=await (await import('./js/lessons/runner.js')).createLesson(window.__file,'Cancel test');})()`);
    await b.waitFor(`(async()=>{const j=(await import('./js/lessons/runner.js')).jobOf(window.__cancelId);return j?.stage==='Transcribing'})()`);
    await b.evaluate(`(async()=>{const r=await import('./js/lessons/runner.js');await r.cancelAndWait(window.__cancelId);window.__afterCancel=window.__apiCalls;})()`);
    await delay(100);
    assert.equal(await b.evaluate('window.__apiCalls'),await b.evaluate('window.__afterCancel'));
    assert.equal(await b.evaluate(`(async()=>(await (await import('./js/lessons/db.js')).getLesson(window.__cancelId)).status)()`),'paused');
    await b.evaluate(`(async()=>{const db=await import('./js/lessons/db.js');const r=await import('./js/lessons/runner.js');r.start(window.__cancelId);await r.cancelAndWait(window.__cancelId);await db.deleteLesson(window.__cancelId);})()`);
    assert.equal(await b.evaluate(`(async()=>!!await (await import('./js/lessons/db.js')).getLesson(window.__cancelId))()`),false);
    assert.deepEqual(errors,[]);
  } finally {await b?.close();await new Promise(r=>server.close(r));}
});
