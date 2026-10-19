// audio.js — 课堂录音预处理：解码 → 16 kHz 单声道 → 在安静处切段 → WAV（MiMo ASR 只收 wav / mp3，base64 后 ≤ 10 MB）
export const RATE = 16000;
export const CHUNK_SEC = 90;   // 目标段长：ASR 上下文 8k token、单次输出 2k token，90 秒留足余量
const SEARCH_SEC = 8;          // 在目标位置前后 8 秒内找最安静的地方下刀，避免切断单词
const FRAME = RATE / 20;       // 50 ms 一帧算能量

/** 解码任意浏览器支持的音频（mp3 / m4a / wav…），直接解成 16 kHz 并混成单声道 Int16 */
export async function decodeToPcm(blob) {
  const ctx = new OfflineAudioContext(1, 1, RATE); // decodeAudioData 会重采样到上下文的采样率
  const ab = await ctx.decodeAudioData(await blob.arrayBuffer());
  const n = ab.length, ch = ab.numberOfChannels;
  const pcm = new Int16Array(n);
  const chans = Array.from({ length: ch }, (_, i) => ab.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < ch; c++) v += chans[c][i];
    v /= ch;
    pcm[i] = v < -1 ? -32768 : v > 1 ? 32767 : Math.round(v * 32767);
  }
  return pcm;
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
  const total = pcm.length;
  const step = chunkSec * RATE, win = SEARCH_SEC * RATE;
  const cuts = [0];
  while (total - cuts.at(-1) > step + win) {
    const target = cuts.at(-1) + step;
    const frames = frameEnergy(pcm, target - win, Math.min(total, target + win));
    let best = frames[0];
    for (const fr of frames) if (fr[1] < best[1]) best = fr;
    cuts.push(best[0] + FRAME / 2);
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
