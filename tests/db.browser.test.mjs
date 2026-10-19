// Real Chromium integration: no third-party test dependencies, no external calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchBrowser } from './browser-harness.mjs';

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let available = process.env.RUN_BROWSER_TESTS === '1';
try { await access(chrome); } catch { available = false; }
const root = resolve(import.meta.dirname, '..');
const browserScript = `
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const rejects = async fn => { try { await fn(); } catch (e) { assert(e.name === 'AbortError', 'wrong stale error: ' + e); return; } throw new Error('stale write accepted'); };
try {
  // Existing v1 transcript and audio must survive the transactional upgrade.
  const old = indexedDB.open('wallboard-lessons', 1);
  old.onupgradeneeded = () => { old.result.createObjectStore('lessons', {keyPath: 'id'}); old.result.createObjectStore('audio'); };
  const legacy = await request(old);
  const t = legacy.transaction(['lessons','audio'], 'readwrite');
  t.objectStore('lessons').put({id:'legacy', title:'Existing', createdAt:1, notes:{review:'keep'}, chunks:[{start:0,end:1,status:'done',text:'hello',turns:[{text:'hello'}]}]});
  t.objectStore('audio').put(new Blob(['recording']), 'legacy');
  await new Promise((resolve,reject) => { t.oncomplete = resolve; t.onerror = reject; });
  legacy.close();
  const db = await import('/js/lessons/db.js');
  let lesson = await db.getLesson('legacy');
  assert(lesson.chunks[0].text === 'hello' && lesson.notes.review === 'keep', 'v1 migration lost transcript/notes');
  assert(await (await db.getAudio('legacy')).text() === 'recording', 'v1 migration lost audio');
  let list = await db.listLessons();
  assert(!('chunks' in list[0]) && !('notes' in list[0]) && list[0].turnCount === 1, 'list cloned transcript');
  lesson.chunks[0].turns.push({text:'second'});
  await db.putLesson(lesson);
  assert((await db.getLesson('legacy')).chunks[0].turns.length === 2, 'changed chunk not persisted');
  assert((await db.listLessons())[0].turnCount === 2, 'summary not updated');
  const previous = await db.getLesson('legacy');
  const token = await db.beginLessonGeneration('legacy');
  await rejects(() => db.putLesson(previous));
  lesson._generation = token;
  lesson.chunks = [];
  await db.putLesson(lesson);
  assert((await db.getLesson('legacy')).chunks.length === 0, 'trailing chunks retained');
  // Simulate a failed delete midway; all stores must roll back together.
  const original = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function(key) { if (this.name === 'audio') throw new Error('injected failure'); return original.call(this,key); };
  let failed = false;
  try { await db.deleteLesson('legacy'); } catch { failed = true; }
  IDBObjectStore.prototype.delete = original;
  assert(failed && await db.getLesson('legacy') && await db.getAudio('legacy'), 'delete was not atomic');
  await db.deleteLesson('legacy');
  assert(!await db.getLesson('legacy') && !await db.getAudio('legacy') && !(await db.listLessons()).length, 'delete left records');
  await rejects(() => db.putLesson(lesson));
  await rejects(() => db.putLesson({id:'legacy',chunks:[]}));
  await rejects(() => db.putAudio('legacy',new Blob(['late'])));
  for (const id of ['a','b']) { await db.putAudio(id,new Blob([id])); await db.putLesson({id,createdAt:id==='a'?2:3,chunks:[{text:id}]}); }
  assert((await db.listLessons())[0].id === 'b', 'summary sort order');
  const late = await db.getLesson('a');
  await db.deleteAllLessons();
  await rejects(() => db.putLesson(late));
  await rejects(() => db.putAudio('b',new Blob(['late'])));
  assert(!(await db.listLessons()).length && !await db.getAudio('a'), 'delete all left data');
  // The actual module worker must decode, plan and encode without returning PCM.
  const audio = await import('/js/lessons/audio.js');
  const pcm = new Int16Array(16000); pcm[100] = 1234;
  const prepared = await audio.prepareAudio(new Blob([audio.wavBytes(pcm,0,1)],{type:'audio/wav'}));
  assert(prepared.duration === 1 && prepared.chunks.length === 1, 'worker preparation failed');
  assert(await prepared.wavBase64(0,1) === audio.base64(audio.wavBytes(pcm,0,1)), 'worker WAV changed samples');
  prepared.dispose();
  await rejects(() => prepared.wavBase64(0,1));
  document.body.textContent = 'PASS: migration, summaries, chunk updates, generations, atomic deletes, tombstones, audio worker';
} catch (e) { document.body.textContent = 'FAIL: ' + (e.stack || e); }
`;

test('browser database migration, atomicity, stale writes and real audio worker', { skip: !available, timeout: 45000 }, async () => {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body>RUNNING<script type="module">' + browserScript + '</script>'); return; }
      if (!/^\/js\/lessons\/(audio|audio-worker|db)\.js$/.test(req.url)) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile(join(root, req.url.slice(1))));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await launchBrowser();
    await browser.send('Page.navigate', {url:'http://127.0.0.1:'+server.address().port});
    await browser.waitFor("/^(PASS|FAIL):/.test(document.body?.textContent || '')",30000);
    const output = await browser.evaluate('document.body.textContent');
    assert.match(output, /^PASS: migration/, output);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
