// api.js — 调用小米 MiMo：mimo-v2.5-asr 转写 + mimo-v2.6-flash 分说话人 / 翻译 / 复习笔记
// 浏览器直接请求（与发音同一个 Key 和接口地址），Key 只存在本机
export const ASR_MODEL = 'mimo-v2.5-asr';
export const DEFAULT_LLM = 'mimo-v2.6-flash';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
  /** 音频太长 / 超出上下文：把这一段对半切再试 */
  get tooLong() { return this.status === 400 || this.status === 413; }
}

function friendly(status, msg) {
  if (status === 401 || status === 403) return 'MiMo rejected the API key';
  if (status === 402) return 'MiMo account balance is empty — top up at platform.xiaomimimo.com';
  if (status === 429) return 'MiMo rate limit reached';
  return `MiMo error ${status}${msg ? ': ' + msg.slice(0, 160) : ''}`;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** POST 一次；429 / 5xx / 网络错误自动退避重试 */
async function post(auth, body, { timeout = 120000, signal, tries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('Timed out', 'TimeoutError')), timeout);
    const onAbort = () => ctl.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    let res, err;
    try {
      res = await fetch(auth.endpoint, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${auth.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) { err = e; } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (res?.ok) return res.json();
    const status = res?.status || 0;
    let msg = '';
    if (res) { try { const j = await res.json(); msg = j.error?.message || ''; } catch {} }
    const retry = !res || status === 429 || status >= 500;
    if (!retry || attempt >= tries - 1) throw new ApiError(status, res ? friendly(status, msg) : `Network error: ${err?.message || err}`);
    const after = Number(res?.headers.get('retry-after')) || 0;
    await sleep(Math.max(after * 1000, (status === 429 ? 15000 : 3000) * (attempt + 1)), signal);
  }
}

/** 一段 WAV（base64）→ 英文文本 */
export async function transcribe(auth, b64, opts) {
  const d = await post(auth, {
    model: ASR_MODEL,
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${b64}` } }] }],
    asr_options: { language: 'en' },
  }, opts);
  return (d.choices?.[0]?.message?.content || '').trim();
}

/** 宽松解析：去掉 ```json 代码块、截取第一个 { 到最后一个 } */
export function parseJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

/** 让文本模型返回 JSON（关闭深度思考，坏 JSON 重试一次） */
export async function chatJSON(auth, model, system, user, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const d = await post(auth, {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      temperature: 0.2,
    }, { timeout: 180000, ...opts });
    try { return parseJSON(d.choices?.[0]?.message?.content); }
    catch (e) { if (attempt >= 1) throw new ApiError(0, 'The model returned invalid JSON'); }
  }
}

const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

/** 模型的分段和转写大体对得上（没有乱编 / 大段漏掉）才采用 */
export function verbatimOk(source, turns) {
  const a = words(source), b = words(turns.map(t => t.text).join(' '));
  if (!a.length) return !b.length;
  if (Math.abs(a.length - b.length) / a.length > 0.15) return false;
  const count = new Map();
  for (const w of a) count.set(w, (count.get(w) || 0) + 1);
  let same = 0;
  for (const w of b) { const c = count.get(w); if (c) { same++; count.set(w, c - 1); } }
  return same / a.length >= 0.85;
}

/** 只用模型给的「从哪里换人」，文字一律从原始转写里切出来——模型就算偷偷改对了学生的错句也不会进到记录里 */
export function alignTurns(source, turns) {
  const toks = [...source.matchAll(/\S+/g)].map(m => ({ i: m.index, w: words(m[0]).join(' ') }));
  const starts = [0];
  let pos = 0;
  for (let k = 1; k < turns.length; k++) {
    const expected = pos + words(turns[k - 1].text).length;
    const head = words(turns[k].text).slice(0, 3);
    let best = Math.min(expected, toks.length), bestScore = -1;
    for (let j = Math.max(pos + 1, expected - 8); j <= Math.min(toks.length - 1, expected + 8); j++) {
      let score = 0;
      head.forEach((w, x) => { if (toks[j + x]?.w === w) score += 3 - x; });
      if (score > bestScore || (score === bestScore && Math.abs(j - expected) < Math.abs(best - expected))) { best = j; bestScore = score; }
    }
    pos = Math.max(pos + 1, best);
    starts.push(pos);
  }
  return turns.map((t, k) => {
    const a = toks[starts[k]]?.i ?? source.length;
    const b = k + 1 < turns.length ? (toks[starts[k + 1]]?.i ?? source.length) : source.length;
    return { ...t, text: source.slice(a, b).trim() };
  }).filter(t => t.text);
}

const TURNS_PROMPT = `You segment transcripts of one-to-one English lessons between a TEACHER and a STUDENT (an English learner, native Chinese speaker).
You get one chunk of raw speech-to-text output with no speaker labels. Split it into speaker turns in order and label each turn.
Clues: the teacher asks questions, explains, models correct English and gives feedback; the student answers, often with mistakes.
Return JSON only: {"turns":[{"role":"teacher"|"student","text":"...","zh":"..."}]}
Rules:
- "text" must be copied VERBATIM from the input, including every grammar mistake. Never fix, paraphrase, add or drop words. Concatenating all "text" values must reproduce the input.
- "zh": natural Simplified Chinese translation of that turn.
- Merge consecutive sentences by the same speaker into one turn.`;

/** 一段转写 → [{role, text, zh}]；文字被改动时退回为一整段、角色未知 */
export async function splitTurns(auth, model, text, prev, opts) {
  if (!text.trim()) return [];
  const ctx = prev ? `Context — the previous chunk ended with the ${prev.role} saying: "${prev.text.slice(-200)}"\n\n` : '';
  const out = await chatJSON(auth, model, TURNS_PROMPT, `${ctx}Transcript chunk:\n${text}`, opts);
  const turns = (Array.isArray(out.turns) ? out.turns : [])
    .filter(t => t && typeof t.text === 'string' && t.text.trim())
    .map(t => ({ role: t.role === 'student' ? 'student' : t.role === 'teacher' ? 'teacher' : 'unknown', text: t.text.trim(), zh: String(t.zh || '').trim() }));
  if (!turns.length || !verbatimOk(text, turns)) return [{ role: 'unknown', text: text.trim(), zh: '' }];
  return alignTurns(text.trim(), turns);
}

const NOTES_PROMPT = `You are an experienced English teacher writing review notes for a Chinese-speaking adult student after a one-to-one lesson.
Input: the numbered transcript, lines like "[12] Student: ...".
Return JSON only:
{"summary_en":"3-5 sentences: topics covered and how the student did",
 "summary_zh":"the same summary in Simplified Chinese",
 "corrections":[{"line":12,"original":"exact words the student said","suggestion":"natural corrected version","reason_zh":"short explanation in Chinese"}],
 "expressions":[{"en":"useful phrase from the lesson","zh":"Chinese meaning","example":"short example sentence"}],
 "words":[{"word":"...","pos":"n./v./adj./…","zh":"Chinese meaning","example":"sentence from the lesson if possible"}]}
Rules: corrections only for STUDENT lines with real errors (grammar, word choice, unnatural phrasing); "original" must be copied exactly from that line; skip filler words and tiny slips.
Up to 25 corrections, 15 expressions, 20 words, most useful first.`;

export async function buildNotes(auth, model, turns, opts) {
  const lines = turns.map((t, i) => `[${i}] ${t.role === 'teacher' ? 'Teacher' : t.role === 'student' ? 'Student' : 'Speaker'}: ${t.text}`).join('\n');
  const n = await chatJSON(auth, model, NOTES_PROMPT, lines, opts);
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    summary: { en: String(n.summary_en || ''), zh: String(n.summary_zh || '') },
    corrections: arr(n.corrections).filter(c => c && c.original && c.suggestion)
      .map(c => ({ line: Number.isInteger(c.line) ? c.line : -1, original: String(c.original), suggestion: String(c.suggestion), reason: String(c.reason_zh || '') })),
    expressions: arr(n.expressions).filter(e => e && e.en).map(e => ({ en: String(e.en), zh: String(e.zh || ''), example: String(e.example || '') })),
    words: arr(n.words).filter(w => w && w.word).map(w => ({ word: String(w.word), pos: String(w.pos || ''), zh: String(w.zh || ''), example: String(w.example || '') })),
  };
}
