import { spawn } from 'node:child_process';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const delay = ms => new Promise(r => setTimeout(r, ms));
export async function launchBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'wallboard-test-'));
  const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const child = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank']);
  let stderr = '', ws, seq = 0;
  const pending = new Map(), listeners = new Set();
  child.stderr.on('data', data => { stderr += data; });
  const close = async () => {
    ws?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(r => child.once('exit', r)); child.kill();
      await Promise.race([exited, delay(3000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
    const resolved = await realpath(profile);
    if (!resolved.startsWith((await realpath(tmpdir())) + '/wallboard-test-')) throw Error('Unexpected browser profile location');
    await rm(resolved, {recursive:true,force:true});
  };
  try {
    let debug;
    for (let i=0;i<200;i++) {
      debug = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      if (debug) break;
      if (child.exitCode !== null || child.signalCode !== null) throw Error('Chrome failed: '+stderr.slice(-3000));
      await delay(50);
    }
    if (!debug) throw Error('Chrome startup timeout: '+stderr.slice(-3000));
    const u = new URL(debug);
    const tabs = await (await fetch('http://'+u.host+'/json')).json();
    ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    ws.onmessage = ({data}) => {
      const m=JSON.parse(data);
      if (m.id) { const p=pending.get(m.id); pending.delete(m.id); if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result); }
      else for(const fn of listeners) fn(m);
    };
    const send = (method,params={}) => new Promise((resolve,reject)=>{ const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params})); });
    const evaluate = async expression => {
      const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
      if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expression, timeout=20000) => {
      const end=Date.now()+timeout;
      while(Date.now()<end) { if(await evaluate(expression))return; await delay(50); }
      throw Error('Browser wait timed out: '+expression);
    };
    await send('Runtime.enable');await send('Page.enable');
    return {send,evaluate,waitFor,close,onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  } catch(e) {await close();throw e;}
}
