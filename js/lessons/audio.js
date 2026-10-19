// audio.js — 课堂录音预处理：解码 → 16 kHz 单声道 → 在安静处切段 → WAV（MiMo ASR 只收 wav / mp3，base64 后 ≤ 10 MB）
export const RATE = 16000;
export const CHUNK_SEC = 90;   // 目标段长：ASR 上下文 8k token、单次输出 2k token，90 秒留足余量
const SEARCH_SEC = 8;          // 在目标位置前后 8 秒内找最安静的地方下刀，避免切断单词
const FRAME = RATE / 20;       // 50 ms 一帧算能量

/** Pure conversion, also used by the module worker and Node tests. */
export function pcmFromChannels(channels) {
  if (!channels.length) return new Int16Array();
  const pcm = new Int16Array(channels[0].length);
  for (let i = 0; i < pcm.length; i++) {
    let v = 0;
    for (const channel of channels) v += channel[i];
    v /= channels.length;
    pcm[i] = v < -1 ? -32768 : v > 1 ? 32767 : Math.round(v * 32767);
  }
  return pcm;
}

async function decodeChannels(blob) {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  return Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
}

/** Compatible PCM-returning API. Prefer prepareAudio for long recordings. */
export async function decodeToPcm(blob) {
  return pcmFromChannels(await decodeChannels(blob));
}

const abortError = () => new DOMException('Audio preparation cancelled', 'AbortError');

/**
 * Decode once; transfer float channels to a worker and retain its sole Int16 PCM.
 * A one-hour recording still needs ~115 MB PCM plus Web Audio's transient float
 * decode (~230 MB/channel). Never pre-encode all chunks; request each on demand.
 * dispose() terminates the worker immediately, including conversion/encoding.
 */
export async function prepareAudio(blob, { chunkSec = CHUNK_SEC, signal } = {}) {
  if (signal?.aborted) throw abortError();
  let worker;
  if (typeof Worker !== 'undefined') {
    try { worker = new Worker(new URL('./audio-worker.js', import.meta.url), { type: 'module' }); }
    catch { /* Restricted/older browsers keep the compatible local path. */ }
  }
  let disposed = false, seq = 0, pcm;
  const pending = new Map();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    worker?.terminate();
    pcm = null;
    for (const { reject } of pending.values()) reject(abortError());
    pending.clear();
    signal?.removeEventListener('abort', dispose);
  };
  signal?.addEventListener('abort', dispose, { once: true });
  const request = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    if (disposed) { reject(abortError()); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ id, type, ...payload }, transfer); }
    catch (error) { pending.delete(id); reject(error); }
  });
  if (worker) {
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id);
      if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
    };
    worker.onerror = (event) => {
      for (const { reject } of pending.values()) reject(new Error(event.message || 'Audio worker failed'));
      dispose();
    };
  }
  try {
    let channels = await decodeChannels(blob);
    if (disposed) throw abortError();
    let result;
    if (worker) {
      result = await request('prepare', { channels, chunkSec }, [...new Set(channels.map(c => c.buffer))]);
    } else {
      pcm = pcmFromChannels(channels);
      result = { duration: pcm.length / RATE, chunks: planChunks(pcm, chunkSec) };
    }
    channels = null;
    return {
      ...result,
      wavBase64(start, end) {
        if (disposed) return Promise.reject(abortError());
        return worker ? request('wavBase64', { start, end }) : Promise.resolve(base64(wavBytes(pcm, start, end)));
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}

/** 每 50 ms 的平均绝对振幅 */
function frameEnergy(pcm, from, to) {
  const out = [];
  for (let f = from; f + FRAME <= to; f += FRAME) {
    let e = 0;
    for (let i = f; i < f + FRAME; i += 4) e += Math.abs(pcm[i]);
    out.push([f, e]);
  }
  return out;
}

/** 切段：返回 [[起始秒, 结束秒], …]，每段约 CHUNK_SEC，边界落在附近最安静的 50 ms */
export function planChunks(pcm, chunkSec = CHUNK_SEC) {
  if (!Number.isFinite(chunkSec) || chunkSec <= 0) throw new RangeError('chunkSec must be positive');
  const total = pcm.length;
  if (!total) return [];
  const step = Math.max(1, Math.round(chunkSec * RATE)), win = Math.min(SEARCH_SEC * RATE, Math.floor(step / 2));
  const cuts = [0];
  while (total - cuts.at(-1) > step + win) {
    const target = cuts.at(-1) + step;
    const frames = frameEnergy(pcm, target - win, Math.min(total, target + win));
    let best = frames[0];
    for (const fr of frames) if (fr[1] < best[1]) best = fr;
    cuts.push(best ? best[0] + FRAME / 2 : target);
  }
  cuts.push(total);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) out.push([cuts[i] / RATE, cuts[i + 1] / RATE]);
  return out;
}

/** 截取 [start, end) 秒，编码成 16 位 PCM WAV */
export function wavBytes(pcm, start, end) {
  const a = Math.max(0, Math.round(start * RATE)), b = Math.min(pcm.length, Math.round(end * RATE));
  const data = pcm.subarray(a, b);
  const buf = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data.length * 2, true);
  new Int16Array(buf, 44).set(data);
  return new Uint8Array(buf);
}

export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 只读时长（不解码整段音频），上传前提示用 */
export function probeDuration(blob) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
}
