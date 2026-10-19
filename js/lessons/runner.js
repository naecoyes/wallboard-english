// runner.js — 后台处理流水线（切到别的页面也继续跑）：解码切段 → ASR 转写 → 分说话人 + 翻译 → 复习笔记
// 每完成一段就存一次 IndexedDB；中途关掉页面，下次打开可从断点继续
import { get } from '../store.js';
import { mimoAuth } from '../tts.js';
import { decodeToPcm, planChunks, wavBytes, base64, RATE } from './audio.js';
import { transcribe, splitTurns, buildNotes, DEFAULT_LLM } from './api.js';
import { getLesson, putLesson, getAudio, putAudio } from './db.js';
import { flatten } from './format.js';

const ASR_WORKERS = 2;
const MIN_SPLIT_SEC = 20;
const jobs = new Map(); // id → { ctl, stage, done, total }
const subs = new Set();
const emit = (id) => subs.forEach(fn => { try { fn(id); } catch {} });

export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const jobOf = (id) => jobs.get(id) || null;
export const lessonModel = () => (get().settings.lessonModel || '').trim() || DEFAULT_LLM;
export function cancel(id) { jobs.get(id)?.ctl.abort(); }

export async function createLesson(file, title) {
  const id = `ls-${Date.now().toString(36)}`;
  await putAudio(id, file);
  await putLesson({ id, title, createdAt: Date.now(), fileName: file.name, mime: file.type, duration: 0, status: 'processing', chunks: [], notes: null });
  start(id);
  return id;
}

export function start(id) {
  if (!jobs.has(id)) run(id);
}

class Fatal extends Error {}

async function run(id) {
  const ctl = new AbortController();
  const signal = ctl.signal;
  const job = { ctl, stage: 'Preparing', done: 0, total: 0 };
  jobs.set(id, job);
  const stage = (s, done = job.done, total = job.total) => { Object.assign(job, { stage: s, done, total }); emit(id); };
  let lesson = await getLesson(id);
  if (!lesson) { jobs.delete(id); return; }
  const save = () => putLesson(lesson).then(() => emit(id));
  try {
    const auth = await mimoAuth();
    if (!auth) throw new Fatal('Add your MiMo API key in Settings → Pronunciation first');
    const model = lessonModel();
    lesson.status = 'processing'; lesson.error = ''; lesson.model = model;
    await save();

    // ---------- 1. 解码 + 切段 ----------
    let pcm = null;
    if (!lesson.chunks.length || lesson.chunks.some(c => c.status !== 'done')) {
      stage('Decoding audio');
      const blob = await getAudio(id);
      try { pcm = await decodeToPcm(blob); }
      catch (e) { throw new Fatal(`This recording could not be decoded (${e.message || e.name}). Try MP3, M4A or WAV, or a shorter file.`); }
      if (!lesson.chunks.length) {
        lesson.duration = pcm.length / RATE;
        lesson.chunks = planChunks(pcm).map(([start, end]) => ({ start, end, status: 'pending' }));
        await save();
      }
    }

    // ---------- 2. 转写（两路并发；太长被拒就对半切） ----------
    const counts = () => [lesson.chunks.filter(c => c.status === 'done').length, lesson.chunks.length];
    const tried = new Set();
    let fresh = false;
    const next = () => lesson.chunks.find(c => c.status !== 'done' && !tried.has(c));
    const worker = async () => {
      for (let c; (c = next());) {
        tried.add(c);
        stage('Transcribing', ...counts());
        try {
          c.text = await transcribe(auth, base64(wavBytes(pcm, c.start, c.end)), { signal });
          c.status = 'done'; delete c.error; delete c.turns;
          fresh = true;
        } catch (e) {
          if (signal.aborted) throw e;
          if ([401, 402, 403].includes(e.status)) { ctl.abort(); throw new Fatal(e.message); }
          if (e.tooLong && c.end - c.start > MIN_SPLIT_SEC) {
            const mid = (c.start + c.end) / 2;
            lesson.chunks.splice(lesson.chunks.indexOf(c), 1, { start: c.start, end: mid, status: 'pending' }, { start: mid, end: c.end, status: 'pending' });
          } else { c.status = 'failed'; c.error = e.message; }
        }
        await save();
        stage('Transcribing', ...counts());
      }
    };
    const results = await Promise.allSettled(Array.from({ length: ASR_WORKERS }, worker));
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);
    if (failed.length) throw failed.find(e => e instanceof Fatal) || (signal.aborted ? failed[0] : new Fatal(failed[0]?.message));
    pcm = null;

    // ---------- 3. 分说话人 + 中文 ----------
    let prev = null;
    const todo = lesson.chunks.filter(c => c.status === 'done' && !c.turns && c.text);
    let n = 0;
    for (const c of lesson.chunks) {
      if (c.status === 'done' && !c.turns && c.text) {
        stage('Finding teacher and student', n++, todo.length);
        try { c.turns = await splitTurns(auth, model, c.text, prev, { signal }); fresh = true; }
        catch (e) {
          if (signal.aborted) throw e;
          if ([401, 402, 403].includes(e.status)) throw new Fatal(e.message);
          lesson.error = `Speaker labels failed for part of the lesson: ${e.message}`;
        }
        await save();
      }
      if (c.turns?.length) prev = c.turns.at(-1);
    }

    // ---------- 4. 复习笔记 ----------
    if (fresh) lesson.notes = null;
    if (!lesson.notes && lesson.chunks.some(c => c.text)) {
      stage('Writing review notes', 0, 1);
      try { lesson.notes = await buildNotes(auth, model, flatten(lesson), { signal }); lesson.notesError = ''; }
      catch (e) {
        if (signal.aborted) throw e;
        if ([401, 402, 403].includes(e.status)) throw new Fatal(e.message);
        lesson.notesError = e.message;
      }
    }
    const incomplete = lesson.chunks.some(c => c.status !== 'done' || (c.text && !c.turns)) || !lesson.notes;
    lesson.status = incomplete ? 'partial' : 'done';
    await save();
  } catch (e) {
    lesson.status = signal.aborted && !(e instanceof Fatal) ? 'paused' : 'error';
    lesson.error = lesson.status === 'paused' ? '' : (e.message || String(e));
    await putLesson(lesson);
  } finally {
    jobs.delete(id);
    emit(id);
  }
}

/** 重新生成笔记（不重新转写） */
export async function regenerateNotes(id) {
  const lesson = await getLesson(id);
  if (!lesson || jobs.has(id)) return;
  lesson.notes = null;
  await putLesson(lesson);
  start(id);
}
