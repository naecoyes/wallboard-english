// Read-only deployed-site smoke test: no credentials and no paid API requests.
import assert from 'node:assert/strict';
import { launchBrowser, delay } from '../tests/browser-harness.mjs';
const base='https://naecoyes.github.io/wallboard-english/';
const b=await launchBrowser();
const errors=[];
b.onEvent(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
try {
  await b.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await b.send('Page.navigate',{url:base+'#lessons'});
  await b.waitFor('!!document.querySelector(".ls-list")',30000);
  await b.waitFor(`(async()=>{const r=await navigator.serviceWorker.ready;return !!r.active})()`,30000);
  const version=await b.evaluate(`(async()=>{const s=await (await fetch('sw.js')).text();return s.match(/wallboard-en-v\\d+/)?.[0]})()`);
  assert.equal(version,'wallboard-en-v52');
  for(const route of ['standby','word','sentences','reading','lessons','settings']) {
    await b.evaluate(`location.hash='#${route}'`);await delay(400);
    assert.ok(await b.evaluate('!!document.querySelector("#screen > *")'),route+' empty');
  }
  await b.send('Page.reload'); // A force reload deliberately bypasses service-worker control.
  await b.waitFor('!!document.querySelector(".settings")',30000);
  await b.waitFor('!!navigator.serviceWorker.controller',10000);
  await b.send('Network.enable');
  await b.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await b.send('Page.navigate',{url:base+'#lessons'});
  await b.waitFor('!!document.querySelector(".ls-list")',20000);
  assert.deepEqual(errors,[]);
  console.log('PASS live '+version+': all routes render; offline Lessons module graph loads; no runtime exceptions.');
} finally {await b.close();}
