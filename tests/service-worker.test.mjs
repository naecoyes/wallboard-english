import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
test('service worker never caches private config and removes historical copies',async()=>{
  const handlers={},deleted=[];let mode;
  const cache={keys:async()=>[{url:'https://site.example/js/config.local.js'},{url:'https://site.example/js/app.js'}],delete:async request=>deleted.push(request.url)};
  vm.runInNewContext(source,{
    self:{addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://site.example'},clients:{claim:async()=>{}},skipWaiting:async()=>{}},
    caches:{keys:async()=>['wallboard-en-v52'],open:async()=>cache,delete:async()=>{}},
    URL,Request,Response,fetch:async req=>{mode=req.cache;return new Response('test');},
  });
  let response;handlers.fetch({request:new Request('https://site.example/js/config.local.js'),respondWith:p=>{response=p;}});
  await response;assert.equal(mode,'no-store');
  let activation;handlers.activate({waitUntil:p=>{activation=p;}});await activation;
  assert.deepEqual(deleted,['https://site.example/js/config.local.js']);
});
