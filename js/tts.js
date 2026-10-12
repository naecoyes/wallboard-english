// tts.js — 发音：优先小米 MiMo（mimo-v2.5-tts），失败或未配置时回退到系统语音（Web Speech API）
// 对外接口不变：speak(text, {rate}) / stopSpeak() / ttsAvailable() / englishVoices()
//
// MiMo 接口：POST https://api.xiaomimimo.com/v1/chat/completions（OpenAI 兼容，允许浏览器跨域调用）
//   要合成的文本放在 role=assistant 的消息里，返回 choices[0].message.audio.data（base64 mp3）
// 同一段文本只请求一次：结果存在 IndexedDB，挂墙反复播放不重复计费。
import { get } from './store.js';
import { toast } from './ui.js';

export const MIMO_MODEL = 'mimo-v2.5-tts';
export const MIMO_DEFAULT_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
export const MIMO_VOICES = [
  ['Dean', 'Dean · male'],
  ['Milo', 'Milo · male'],
  ['Mia', 'Mia · female'],
  ['Chloe', 'Chloe · female'],
  ['mimo_default', 'MiMo default'],
];

// ---------- 本地配置（可选）：js/config.local.js 里放 API Key，免得在平板上手输 ----------
let localKey = '';
/** 本地配置加载完成（无论文件是否存在）后 resolve */
export const ttsConfigReady = import('./config.local.js')
  .then(m => { localKey = (m.MIMO_API_KEY || '').trim(); })
  .catch(() => {});
export function localKeyPresent() { return !!localKey; }

function mimoConfig() {
  const s = get().settings;
  const key = (s.mimoKey || '').trim() || localKey;
  if (s.ttsProvider === 'system' || !key) return null;
  return { key, voice: s.mimoVoice || 'Dean', endpoint: (s.mimoEndpoint || '').trim() || MIMO_DEFAULT_ENDPOINT };
}

/** 当前实际使用的引擎：'mimo' | 'system' | 'none' */
export function ttsEngine() {
  if (mimoConfig()) return 'mimo';
  return 'speechSynthesis' in window ? 'system' : 'none';
}

// ---------- 系统语音 ----------
let voicesCache = [];
function refreshVoices() { voicesCache = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}
export function englishVoices() { return voicesCache.filter(v => v.lang.toLowerCase().startsWith('en')); }
export function ttsAvailable() { return ttsEngine() !== 'none'; }

function pickVoice() {
  const saved = get().settings.voiceURI;
  const ens = englishVoices();
  if (saved) {
    const v = ens.find(v => v.voiceURI === saved);
    if (v) return v;
  }
  return ens.find(v => v.lang === 'en-US') || ens[0] || null;
}

function speakSystem(text, rate) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve(false);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'en-US';
    u.rate = rate;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}

// ---------- 音频播放（共用一个 <audio>，首次触摸时解锁，移动端浏览器才允许之后自动播放） ----------
const audio = new Audio();
audio.preload = 'auto';
let currentUrl = null;
let finishCurrent = null;

function silentWav() {
  const n = 1200, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
document.addEventListener('pointerdown', () => {
  if (audio.src) return;
  audio.src = silentWav();
  audio.play().catch(() => {});
}, { once: true, capture: true });

function playBlob(blob, rate) {
  return new Promise(resolve => {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    finishCurrent = resolve;
    audio.onended = () => { finishCurrent = null; resolve(true); };
    audio.onerror = () => { finishCurrent = null; resolve(false); };
    audio.src = currentUrl;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    audio.play().catch(err => {
      finishCurrent = null;
      if (err && err.name === 'NotAllowedError') toast('Autoplay was blocked. Tap the screen and try again.');
      resolve(false);
    });
  });
}

// ---------- IndexedDB 缓存 ----------
const mem = new Map();
let dbPromise = null;
function db() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open('wallboard-tts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}
async function idb(mode, fn) {
  try {
    const d = await db();
    return await new Promise(res => {
      const req = fn(d.transaction('clips', mode).objectStore('clips'));
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}
const cacheGet = (k) => idb('readonly', s => s.get(k));
const cachePut = (k, blob) => idb('readwrite', s => s.put(blob, k));
export const ttsCacheCount = () => idb('readonly', s => s.count());
export async function clearTtsCache() { mem.clear(); await idb('readwrite', s => s.clear()); }

// ---------- MiMo 请求 ----------
// 每个请求有自己的超时；点击朗读和预生成共用同一个进行中的请求，不会重复调用接口
async function fetchMimo(text, cfg) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(cfg.endpoint, {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MIMO_MODEL,
        messages: [{ role: 'assistant', content: text }],
        audio: { format: 'mp3', voice: cfg.voice },
      }),
    });
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).error?.message || ''; } catch { /* 非 JSON */ }
      const err = new Error(`HTTP ${r.status}${msg ? ' · ' + msg : ''}`);
      err.status = r.status;
      throw err;
    }
    const b64 = (await r.json()).choices?.[0]?.message?.audio?.data;
    if (!b64) throw new Error('No audio returned');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'audio/mpeg' });
  } catch (e) {
    throw e.name === 'AbortError' ? new Error('request timed out') : e;
  } finally {
    clearTimeout(timer);
  }
}

const keyFor = (text, cfg) => `${cfg.voice}|${text}`;
function remember(key, blob) {
  if (mem.size > 300) mem.delete(mem.keys().next().value);
  mem.set(key, blob);
}
const inflight = new Map(); // key -> Promise<Blob>

/** 已缓存（内存或 IndexedDB）则直接返回，否则请求一次；同一段文本同时只会有一个请求 */
async function getBlob(text, cfg) {
  const key = keyFor(text, cfg);
  const hit = mem.get(key) || await cacheGet(key);
  if (hit) { remember(key, hit); return hit; }
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchMimo(text, cfg)
    .then(blob => { cachePut(key, blob); remember(key, blob); return blob; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---------- 预生成：页面展示时在后台把要朗读的内容先生成好，点击时直接播放 ----------
let queue = [];
let pumping = false;
let prefetchPaused = 0; // 鉴权失败等情况下暂停一段时间，避免反复报错

/** 预生成模式：smart（默认）/ all / off */
export function prefetchMode() { return get().settings.ttsPrefetch || 'smart'; }

/**
 * 把一组文本加入预生成队列。
 * replace=true 时丢弃上一屏还没生成的内容（换页时用），只保留当前屏幕的。
 */
export function prefetch(texts, { replace = false } = {}) {
  const cfg = mimoConfig();
  if (!cfg || prefetchMode() === 'off' || Date.now() < prefetchPaused) return;
  const list = [...new Set(texts.filter(t => t && t.trim()))];
  if (replace) queue = [];
  for (const t of list) if (!queue.includes(t)) queue.push(t);
  pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      if (document.hidden) { queue = []; break; } // 熄屏 / 切后台时不在后台消耗额度
      const cfg = mimoConfig();
      if (!cfg) { queue = []; break; }
      const text = queue.shift();
      try {
        await getBlob(text, cfg);
      } catch (e) {
        if (e.status === 401 || e.status === 403 || e.status === 429) { // Key 无效或限流：暂停 10 分钟
          prefetchPaused = Date.now() + 10 * 60 * 1000;
          queue = [];
        }
      }
    }
  } finally {
    pumping = false;
  }
}

// 「生成中」小提示（只有点击时还没生成好才会出现）
let loadingEl = null;
function setLoading(on) {
  if (on && !loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.className = 'tts-loading';
    loadingEl.innerHTML = '<span class="spin"></span>Generating audio…';
    document.body.append(loadingEl);
  } else if (!on && loadingEl) {
    loadingEl.remove();
    loadingEl = null;
  }
}

let lastWarn = 0;
function warn(e) {
  if (Date.now() - lastWarn < 60000) return;
  lastWarn = Date.now();
  toast(`MiMo audio failed — using system voice (${e.message})`);
}

let seq = 0;
/** 朗读英文文本，返回 Promise（播完或失败时 resolve） */
export async function speak(text, { rate } = {}) {
  stopSpeak();
  const my = ++seq;
  const r = rate ?? get().settings.rate ?? 0.95;
  const cfg = mimoConfig();
  if (cfg) {
    try {
      const key = keyFor(text, cfg);
      if (!mem.has(key)) setLoading(true); // 已预生成好的不会闪提示
      const blob = await getBlob(text, cfg);
      if (my !== seq) return false; // 期间又点了别的
      setLoading(false);
      return await playBlob(blob, r);
    } catch (e) {
      if (my !== seq) return false;
      setLoading(false);
      warn(e);
    }
  }
  return speakSystem(text, r);
}

/** 停止播放。已发出的请求不取消：生成结果照样存进缓存，下次直接用 */
export function stopSpeak() {
  seq++;
  setLoading(false);
  if (!audio.paused) audio.pause();
  if (finishCurrent) { finishCurrent(false); finishCurrent = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** 设置页「测试连接」：直接请求一次，返回 {ok, ms, error} */
export async function testMimo(text = 'Practice a little every day, and you will improve.') {
  const cfg = mimoConfig();
  if (!cfg) return { ok: false, error: 'No API key, or system voice is selected' };
  const t0 = performance.now();
  try {
    const blob = await fetchMimo(text, cfg);
    const ms = Math.round(performance.now() - t0);
    const key = keyFor(text, cfg);
    cachePut(key, blob);
    remember(key, blob);
    playBlob(blob, 1);
    return { ok: true, ms };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
