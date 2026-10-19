// lessons.js — 课堂录音：上传 1v1 课的录音 → MiMo 转写 → 分出老师 / 学生 → 点句子跳到录音位置 → 复习笔记 + 导出
// 列表页：所有课程（处理进度 / 继续 / 删除）；详情页：左边对话 + 播放器，右边总结 / 纠错 / 表达 / 生词
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { update, get } from '../store.js';
import { addCard } from '../srs.js';
import { stopSpeak } from '../tts.js';
import { probeDuration } from '../lessons/audio.js';
import { DEFAULT_LLM, DEFAULT_GEMINI } from '../lessons/api.js';
import { lessonAuth, savedGeminiKey, setGeminiKey } from '../lessons/keys.js';
import { listLessons, getLesson, putLesson, getAudio, deleteLesson, deleteAllLessons } from '../lessons/db.js';
import { subscribe, jobOf, start, cancel, cancelAndWait, createLesson, regenerateNotes } from '../lessons/runner.js';
import { flatten, invalidateNotes, correctionsByLine, clock, ROLE, toTxt, toSrt, toMarkdown } from '../lessons/format.js';

import { activeTurnIndex, createTranscriptView } from '../lessons/transcript-view.js';

const OPEN_KEY = 'wallboard-lesson-open';
const STATUS = { processing: 'Processing', paused: 'Paused', partial: 'Incomplete', error: 'Failed', done: 'Ready' };
const NEXT_ROLE = { teacher: 'student', student: 'teacher', unknown: 'teacher' };

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 复制到剪贴板；不支持 Clipboard API 时用隐藏文本框兜底 */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
  ta.value = text;
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

export function renderLessons(root) {
  let alive = true;
  let openId = sessionStorage.getItem(OPEN_KEY);
  let audioUrl = null;
  let player = null;
  let detailSig = '';
  let generation = 0, progressTimer = 0, uploadGeneration = 0;
  let transcript = null;
  let audioLessonId = null, pendingSeek = null;
  let pendingWrite = Promise.resolve();
  let detailState = { showZh: false, revealed: new Set(), scroll: 0, tab: 'summary' };
  const saveEdit = lesson => {
    generation++;
    const snapshot = structuredClone(lesson);
    pendingWrite = pendingWrite.catch(() => {}).then(() => putLesson(snapshot));
    return pendingWrite.catch(e => { if (alive) { detailSig = ''; paint(); } throw e; });
  };
  const rewriteNotes = async id => { await pendingWrite; if (alive && openId === id) await regenerateNotes(id); };
  const dialogs = new Set();
  const report = e => { if (alive) toast(e?.message || String(e)); };
  const attempt = fn => (...args) => { try { Promise.resolve(fn(...args)).catch(report); } catch (e) { report(e); } };
  function dialog(cls, ...children) {
    if (!alive) return () => {};
    const dlg = h('dialog', { class: `external-dialog ${cls}` }, ...children);
    const close = () => { dialogs.delete(close); if (dlg.open) dlg.close(); dlg.remove(); };
    dialogs.add(close);
    dlg.addEventListener('close', close);
    document.body.append(dlg);
    try { dlg.showModal(); } catch (e) { close(); report(e); }
    return close;
  }
  const wrap = h('div', { class: 'word-mode ls' });
  root.append(wrap);

  const setOpen = (id) => {
    if (!alive) return;
    generation++;
    uploadGeneration++;
    for (const close of dialogs) close();
    releaseAudio();
    detailState = { showZh: false, revealed: new Set(), scroll: 0, tab: 'summary' };
    openId = id;
    if (id) sessionStorage.setItem(OPEN_KEY, id); else sessionStorage.removeItem(OPEN_KEY);
    detailSig = '';
    paint();
  };
  const releaseAudio = () => {
    transcript?.destroy(); transcript = null;
    audioLessonId = null; pendingSeek = null;
    if (player) { player.ontimeupdate = null; player.pause(); player.removeAttribute('src'); player = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  };

  async function paint() {
    if (!alive) return;
    const version = ++generation, id = openId;
    const current = () => alive && version === generation && id === openId;
    try {
      await pendingWrite.catch(() => {});
      if (!current()) return;
      if (id) {
        const lesson = await getLesson(id);
        if (!current()) return;
        if (lesson) return paintDetail(lesson);
        openId = null; sessionStorage.removeItem(OPEN_KEY);
      }
      await paintList(version);
    } catch (e) { if (alive && version === generation) report(e); }
  }

  // ======================= 列表 =======================
  async function paintList(version) {
    const lessons = await listLessons();
    if (!alive || openId || version !== generation) return;
    releaseAudio();
    const fileInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.aac', hidden: '' });
    fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) attempt(confirmUpload)(f); });
    const head = h('div', { class: 'mode-head' },
      h('div', {}, h('h1', {}, icon('mic', 24), 'Lessons'),
        h('div', { class: 'sub' }, 'Upload a class recording to get the transcript, speakers and review notes')),
      h('div', { class: 'btn-group' },
        h('button', { type: 'button', class: 'btn sm ghost', onclick: attempt(openOptions) }, icon('settings', 16), 'Options'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => fileInput.click() }, icon('upload', 16), 'Upload recording'),
        fileInput));

    const cards = lessons.map(l => {
      const job = jobOf(l.id);
      const status = job ? 'processing' : l.status === 'processing' ? 'paused' : l.status;
      const pct = job && job.total ? Math.round(job.done / job.total * 100) : 0;
      const turns = l.turnCount || 0;
      return h('section', { class: 'wm-card glass ls-card' },
        h('button', { type: 'button', class: 'ls-card-main', onclick: () => setOpen(l.id) },
          h('b', {}, l.title),
          h('small', {}, `${new Date(l.createdAt).toLocaleDateString()} · ${l.duration ? clock(l.duration) : '—'}${turns ? ` · ${turns} lines` : ''}`)),
        h('span', { class: 'chip' + (status === 'done' ? ' green' : status === 'error' ? ' amber' : '') },
          job ? `${job.stage}${job.total ? ` ${job.done}/${job.total}` : ''}` : STATUS[status] || status),
        job ? h('div', { class: 'ls-bar' }, h('i', { style: `width:${pct}%` })) : null,
        l.error && !job ? h('p', { class: 'ls-err' }, l.error) : null,
        h('div', { class: 'btn-row ls-card-actions' },
          h('button', { type: 'button', class: 'btn sm', onclick: () => setOpen(l.id) }, 'Open'),
          job ? h('button', { type: 'button', class: 'btn sm ghost', onclick: () => cancel(l.id) }, 'Pause')
            : status !== 'done' ? h('button', { type: 'button', class: 'btn sm ghost', onclick: attempt(() => resume(l.id)) }, status === 'paused' ? 'Resume' : 'Retry') : null,
          h('button', { type: 'button', class: 'btn sm danger', onclick: attempt(() => remove(l)) }, icon('trash', 15))));
    });
    const empty = h('section', { class: 'wm-card glass ls-empty' },
      h('span', { class: 'wm-label' }, 'HOW IT WORKS'),
      h('ol', {},
        h('li', {}, 'Record your 1-to-1 class (MP3, M4A or WAV, up to about 60 minutes).'),
        h('li', {}, 'Upload it here. Gemini transcribes the English, marks who is the teacher and who is the student, and translates each line.'),
        h('li', {}, 'Tap any line to hear that part of the recording. Review the summary, corrections, expressions and new words.'),
        h('li', {}, 'Export TXT, Markdown or SRT subtitles.')),
      h('p', { class: 'ls-note' }, 'Recordings stay on this device. Audio is sent to Google Gemini (or Xiaomi MiMo) only for transcription. Ask your teacher before recording.'));
    wrap.replaceChildren(head, h('div', { class: 'ls-list' }, ...(cards.length ? cards : [empty])));
  }

  async function resume(id) {
    const navigation = uploadGeneration, opened = openId;
    await pendingWrite;
    const auth = await lessonAuth();
    if (!alive || navigation !== uploadGeneration || opened !== openId) return;
    if (!auth) return needKey();
    await start(id);
  }

  async function remove(l) {
    if (!confirm(`Delete “${l.title}” and its recording from this device?`)) return;
    await pendingWrite.catch(() => {});
    await cancelAndWait(l.id);
    await deleteLesson(l.id);
    if (!alive) return;
    toast('Lesson deleted');
    if (openId === l.id) setOpen(null); else paint();
  }

  function needKey() {
    const close = dialog('ls-dlg',
      h('h2', {}, 'API key needed'),
      h('p', {}, 'Lessons needs a Google Gemini API key (recommended) or a Xiaomi MiMo key. Add a Gemini key under Options on this page; the MiMo key is under Settings → Pronunciation.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => { close(); attempt(openOptions)(); } }, 'Add Gemini key'),
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel')));
  }

  async function confirmUpload(file) {
    const request = ++uploadGeneration, id = openId;
    const auth = await lessonAuth();
    if (!alive || request !== uploadGeneration || id !== openId) return;
    if (!auth) return needKey();
    const dur = await probeDuration(file);
    if (!alive || request !== uploadGeneration || id !== openId) return;
    const title = h('input', { type: 'text', value: file.name.replace(/\.[^.]+$/, '').slice(0, 80), maxlength: '80' });
    const close = dialog('ls-dlg',
      h('h2', {}, 'New lesson'),
      h('label', {}, 'Title', title),
      h('p', { class: 'ls-meta' }, `${file.name} · ${(file.size / 1e6).toFixed(1)} MB${dur ? ` · ${clock(dur)}` : ''}`),
      dur > 3600 ? h('p', { class: 'ls-err' }, 'Longer than 60 minutes: the tablet may run out of memory while decoding. If it fails, split the recording first.') : null,
      h('p', { class: 'ls-note' }, `The audio is sent to ${auth.provider === 'gemini' ? 'Google Gemini' : 'Xiaomi MiMo'} for transcription and analysis. Make sure your teacher agrees to being recorded.`),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary', onclick: attempt(async () => {
            close();
            const created = await createLesson(file, title.value.trim() || file.name);
            if (alive && request === uploadGeneration && id === openId) setOpen(created);
          }),
        }, 'Start'),
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel')));
    title.focus();
  }

  async function openOptions() {
    const request = uploadGeneration, id = openId;
    const key = h('input', { type: 'password', value: savedGeminiKey(), placeholder: 'Paste your Gemini API key', autocomplete: 'off', spellcheck: 'false' });
    const gModel = h('input', { type: 'text', value: get().settings.geminiModel || DEFAULT_GEMINI, spellcheck: 'false' });
    const mModel = h('input', { type: 'text', value: get().settings.lessonModel || DEFAULT_LLM, spellcheck: 'false' });
    const auth = await lessonAuth();
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (!alive || request !== uploadGeneration || id !== openId) return;
    const close = dialog('ls-dlg',
      h('h2', {}, 'Lesson options'),
      h('p', { class: 'ls-meta' }, `Now using: ${!auth ? 'no key yet' : auth.provider === 'gemini' ? 'Google Gemini' : 'Xiaomi MiMo (add a Gemini key for speakers and exact times)'}`),
      h('label', {}, 'Gemini API key — stored only on this device, never synced', key),
      h('label', {}, 'Gemini model', gModel),
      h('label', {}, 'MiMo analysis model (used when there is no Gemini key)', mModel),
      est ? h('p', { class: 'ls-meta' }, `Browser storage used: ${(est.usage / 1e6).toFixed(0)} MB`) : null,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary', onclick: attempt(() => {
            setGeminiKey(key.value.trim());
            const g = gModel.value.trim(), m = mModel.value.trim();
            update(s => {
              s.settings.geminiModel = g && g !== DEFAULT_GEMINI ? g : '';
              s.settings.lessonModel = m && m !== DEFAULT_LLM ? m : '';
            });
            close(); toast('Saved');
          }),
        }, 'Save'),
        h('button', {
          class: 'btn danger', onclick: attempt(async () => {
            if (!confirm('Delete every lesson and recording from this device?')) return;
            await pendingWrite.catch(() => {});
            const lessons = await listLessons();
            await Promise.all(lessons.map(l => cancelAndWait(l.id)));
            await deleteAllLessons();
            close(); if (alive) { toast('All lessons deleted'); setOpen(null); }
          }),
        }, 'Delete all lessons'),
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Close')));
  }

  // ======================= 详情 =======================
  function paintDetail(lesson) {
    if (!alive || openId !== lesson.id) return;
    const job = jobOf(lesson.id);
    const sig = JSON.stringify([lesson.id, job && [job.stage, job.done, job.total], lesson]);
    if (sig === detailSig) return;
    detailSig = sig;
    if (transcript) detailState.scroll = transcript.element.scrollTop;
    transcript?.destroy(); transcript = null;
    const wasPlaying = player && !player.paused;
    if (job || audioLessonId !== lesson.id) releaseAudio();

    const back = h('button', { type: 'button', class: 'btn sm ghost', onclick: () => setOpen(null) }, icon('arrowRight', 16), 'All lessons');
    back.firstChild.style.transform = 'rotate(180deg)';
    const turns = flatten(lesson);
    const sub = h('div', { class: 'sub' },
      `${new Date(lesson.createdAt).toLocaleDateString()} · ${lesson.duration ? clock(lesson.duration) : '—'} · ${turns.length} lines${job ? '' : ` · ${STATUS[lesson.status === 'processing' ? 'paused' : lesson.status]}`}`);
    const actions = h('div', { class: 'btn-group' }, back);
    const head = h('div', { class: 'mode-head' }, h('div', { class: 'ls-head-text' }, h('h1', {}, icon('mic', 24), h('span', {}, lesson.title)), sub), actions);

    if (job) {
      // ---------- 处理中 ----------
      const pct = job.total ? Math.round(job.done / job.total * 100) : 0;
      const dots = (lesson.chunks || []).map(c => h('i', { class: `ls-dot ${c.status}${c.turns ? ' labeled' : ''}`, title: `${clock(c.start)}–${clock(c.end)}` }));
      actions.prepend(h('button', { type: 'button', class: 'btn sm ghost', onclick: () => cancel(lesson.id) }, 'Pause'));
      wrap.replaceChildren(head, h('section', { class: 'wm-card glass ls-progress' },
        h('span', { class: 'wm-label' }, 'PROCESSING'),
        h('div', { class: 'ls-stage' }, `${job.stage}${job.total ? ` · ${job.done} of ${job.total}` : '…'}`),
        h('div', { class: 'ls-bar' }, h('i', { style: `width:${pct}%` })),
        dots.length ? h('div', { class: 'ls-dots' }, ...dots) : null,
        h('p', { class: 'ls-note' }, 'You can switch to other screens; processing continues while WallBoard stays open. If the page is closed, tap Resume later to continue from where it stopped.')));
      return;
    }

    // ---------- 已完成 / 部分完成 ----------
    const notes = lesson.notes;
    const fixes = correctionsByLine(turns, notes?.corrections);
    const failed = (lesson.chunks || []).filter(c => c.status !== 'done');
    const swapAll = async () => {
      for (const c of lesson.chunks) for (const t of c.turns || []) if (t.role !== 'unknown') t.role = NEXT_ROLE[t.role];
      invalidateNotes(lesson);
      const saving = saveEdit(lesson);
      detailSig = ''; paintDetail(lesson);
      await saving;
      if (alive && openId === lesson.id) toast('Teacher and student swapped');
    };
    const exportMenu = () => {
      const base = lesson.title.replace(/[\\/:*?"<>|]+/g, '_');
      const close = dialog('ls-dlg',
        h('h2', {}, 'Export'),
        h('div', { class: 'ls-export' },
          h('button', { class: 'btn', onclick: () => { download(`${base}.md`, toMarkdown(lesson), 'text/markdown'); close(); } }, 'Markdown · notes + transcript'),
          h('button', { class: 'btn', onclick: () => { download(`${base}.txt`, toTxt(lesson), 'text/plain'); close(); } }, 'TXT · transcript'),
          h('button', { class: 'btn', onclick: () => { download(`${base}.srt`, toSrt(lesson), 'application/x-subrip'); close(); } }, 'SRT · subtitles')),
        lesson.provider === 'gemini' ? null : h('p', { class: 'ls-meta' }, 'Times are estimated within each 90-second part of the recording.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Close')));
    };
    actions.prepend(
      h('button', { type: 'button', class: 'btn sm ghost', onclick: attempt(swapAll), title: 'Swap Teacher and Student labels' }, icon('repeat', 16), 'Swap roles'),
      h('button', { type: 'button', class: 'btn sm', title: 'Copy notes and the full transcript', onclick: attempt(async () => {
        const copied = await copyText(toMarkdown(lesson));
        if (alive && openId === lesson.id) toast(copied ? 'Copied notes and transcript' : 'Copy failed — use Export instead');
      }) }, icon('cards', 16), 'Copy all'),
      h('button', { type: 'button', class: 'btn sm', onclick: exportMenu }, icon('download', 16), 'Export'));

    // Keep this recording's audio element when notes or speaker labels repaint.
    if (!player) {
      player = h('audio', { controls: '', preload: 'metadata', class: 'ls-audio' });
      audioLessonId = lesson.id;
      const captured = player;
      getAudio(lesson.id).then(blob => {
        if (!alive || openId !== lesson.id || player !== captured) return;
        if (!blob) { toast('The recording is no longer available on this device.'); return; }
        audioUrl = URL.createObjectURL(blob);
        captured.src = audioUrl;
      }).catch(e => { if (alive && player === captured) report(e); });
      captured.addEventListener('loadedmetadata', () => {
        if (player !== captured || pendingSeek == null) return;
        captured.currentTime = pendingSeek; pendingSeek = null;
        captured.play().catch(report);
      });
      captured.addEventListener('error', () => { if (alive && player === captured) toast('This recording could not be played.'); });
    }
    const captured = player;
    const speeds = h('div', { class: 'ls-speeds' }, ...[0.75, 1, 1.25].map(r =>
      h('button', { type: 'button', class: 'sn-chip' + (r === captured.playbackRate ? ' on' : ''), onclick: e => {
        captured.playbackRate = r;
        speeds.querySelectorAll('.sn-chip').forEach(b => b.classList.toggle('on', b === e.currentTarget));
      } }, `${r}×`)));
    let showZh = detailState.showZh;
    const revealed = detailState.revealed;
    const zhToggle = h('button', { type: 'button', class: 'sn-chip' + (showZh ? ' on' : ''), onclick: () => {
      showZh = !showZh; detailState.showZh = showZh;
      zhToggle.classList.toggle('on', showZh);
      view.refresh();
    } }, '中文');
    const seek = t => {
      if (!alive || openId !== lesson.id || player !== captured) return;
      stopSpeak();
      const time = Math.max(0, t.start - 0.5);
      if (!captured.readyState) { pendingSeek = time; return; }
      captured.currentTime = time;
      captured.play().catch(report);
    };
    const view = createTranscriptView({ turns, renderRow: (t, i) => {
      const role = h('button', { type: 'button', class: 'ls-role', title: 'Tap to change speaker', onclick: attempt(async () => {
        const c = lesson.chunks[t.chunk].turns?.[t.idx];
        if (!c) return;
        c.role = NEXT_ROLE[c.role] || 'teacher';
        invalidateNotes(lesson);
        const saving = saveEdit(lesson);
        detailSig = ''; paintDetail(lesson);
        await saving;
      }) }, ROLE[t.role]);
      const zh = t.zh ? h('div', { class: 'ls-zh' + (showZh || revealed.has(i) ? '' : ' reveal-hidden'), onclick: e => {
        const hidden = e.currentTarget.classList.toggle('reveal-hidden');
        if (hidden) revealed.delete(i); else revealed.add(i);
      } }, t.zh) : null;
      const row = h('div', { class: `ls-line ${t.role}`, 'data-i': i },
        h('div', { class: 'ls-line-head' }, role, h('button', { type: 'button', class: 'ls-time', onclick: () => seek(t) }, clock(t.start))),
        h('button', { type: 'button', class: 'ls-text', title: 'Play from here', onclick: () => seek(t) }, t.text), zh,
        ...(fixes.get(i) || []).map(c => h('div', { class: 'ls-fix' },
          h('div', {}, icon('check', 14), h('b', {}, c.suggestion)), c.reason ? h('small', {}, c.reason) : null)));
      if (t.role === 'student') row.style.marginLeft = 'auto';
      return row;
    } });
    transcript = view;
    const lines = view.element;
    let cur = -2;
    captured.ontimeupdate = () => {
      if (!alive || player !== captured || !captured.getAttribute('src')) return;
      const i = activeTurnIndex(turns, captured.currentTime);
      if (i === cur) return;
      cur = i; view.active(i, !captured.paused);
    };
    captured.ontimeupdate();

    const banner = [];
    const stopped = lesson.status === 'error' || lesson.status === 'processing' || lesson.status === 'paused';
    if (!stopped && failed.length) banner.push(h('div', { class: 'ls-warn' },
      `${failed.length} part${failed.length > 1 ? 's' : ''} of the recording could not be transcribed (${failed.map(c => `${clock(c.start)}–${clock(c.end)}`).slice(0, 3).join(', ')}).`,
      h('button', { type: 'button', class: 'btn sm', onclick: attempt(() => resume(lesson.id)) }, 'Retry')));
    if (stopped) banner.push(h('div', { class: 'ls-warn' },
      lesson.error || 'Processing was interrupted.',
      h('button', { type: 'button', class: 'btn sm', onclick: attempt(() => resume(lesson.id)) }, lesson.chunks?.length ? 'Resume' : 'Retry')));
    if (turns.length && turns.every(t => t.role === 'unknown')) banner.push(h('div', { class: 'ls-warn' }, 'Speakers could not be identified. Tap a label to set it.'));

    const main = h('section', { class: 'wm-card glass ls-main' },
      h('div', { class: 'ls-player' }, player, speeds, zhToggle),
      ...banner, lines);

    // ---------- 右：复习笔记 ----------
    const tabs = [
      ['summary', 'Summary'],
      ['corrections', `Corrections${notes ? ` · ${notes.corrections.length}` : ''}`],
      ['expressions', `Expressions${notes ? ` · ${notes.expressions.length}` : ''}`],
      ['words', `Words${notes ? ` · ${notes.words.length}` : ''}`],
    ];
    let tab = detailState.tab;
    const tabBar = h('div', { class: 'sn-chips ls-tabs' });
    const pane = h('div', { class: 'ls-pane' });
    const add = (front, back, example) => toast(addCard(front, back, example) ? `“${front}” added to your review deck` : 'Already in your review deck');
    const paintPane = () => {
      tabBar.replaceChildren(...tabs.map(([k, label]) =>
        h('button', { type: 'button', class: 'sn-chip' + (k === tab ? ' on' : ''), onclick: () => { tab = k; detailState.tab = k; paintPane(); } }, label)));
      if (!notes) {
        pane.replaceChildren(h('p', { class: 'ls-note' }, lesson.notesError ? `Notes failed: ${lesson.notesError}` : 'No notes yet.'),
          turns.length ? h('button', { type: 'button', class: 'btn sm', onclick: attempt(() => rewriteNotes(lesson.id)) }, 'Generate notes') : null);
        return;
      }
      if (tab === 'summary') pane.replaceChildren(
        h('p', { class: 'ls-sum' }, notes.summary.en),
        h('p', { class: 'ls-sum zh' }, notes.summary.zh),
        h('button', { type: 'button', class: 'btn sm ghost', onclick: attempt(() => { if (confirm('Rewrite the review notes?')) return rewriteNotes(lesson.id); }) }, icon('repeat', 15), 'Regenerate notes'));
      else if (tab === 'corrections') pane.replaceChildren(...(notes.corrections.length ? notes.corrections.map(c => {
        const i = [...fixes].find(([, list]) => list.includes(c))?.[0];
        return h('div', { class: 'ls-item' },
          h('div', { class: 'ls-orig' }, c.original),
          h('div', { class: 'ls-sugg' }, c.suggestion),
          c.reason ? h('small', {}, c.reason) : null,
          h('div', { class: 'ls-item-actions' },
            i != null ? h('button', { type: 'button', class: 'sn-chip', onclick: () => { view.jump(i); seek(turns[i]); } }, icon('play', 13), clock(turns[i].start)) : null,
            h('button', { type: 'button', class: 'sn-chip', onclick: () => add(c.suggestion, c.reason, c.original) }, icon('plus', 13), 'Review')));
      }) : [h('p', { class: 'ls-note' }, 'No corrections — nice work.')]));
      else if (tab === 'expressions') pane.replaceChildren(...notes.expressions.map(e =>
        h('button', { type: 'button', class: 'ls-item ls-add', onclick: () => add(e.en, e.zh, e.example) },
          h('b', {}, e.en), h('span', {}, e.zh), e.example ? h('small', {}, e.example) : null, icon('plus', 14))));
      else pane.replaceChildren(...notes.words.map(w =>
        h('button', { type: 'button', class: 'ls-item ls-add', onclick: () => add(w.word, `${w.pos} ${w.zh}`.trim(), w.example) },
          h('b', {}, w.word, w.pos ? h('em', {}, ` ${w.pos}`) : null), h('span', {}, w.zh), w.example ? h('small', {}, w.example) : null, icon('plus', 14))));
    };
    paintPane();
    const side = h('section', { class: 'wm-card glass ls-notes' },
      h('div', { class: 'wm-card-head' }, h('span', { class: 'wm-label' }, 'REVIEW NOTES')), tabBar, pane);

    wrap.replaceChildren(head, h('div', { class: 'wm-body ls-body' }, main, side));
    view.element.scrollTop = detailState.scroll;
    view.refresh();
    if (wasPlaying && captured.paused) captured.play().catch(report);
  }

  const unsub = subscribe(id => {
    if (!alive) return;
    if (openId && id !== openId) return;
    if (progressTimer) return;
    progressTimer = setTimeout(() => { progressTimer = 0; paint(); }, 100);
  });
  const onKey = (e) => {
    if (!player || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT|BUTTON|A|AUDIO/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === ' ') { e.preventDefault(); player.paused ? player.play().catch(() => {}) : player.pause(); }
  };
  document.addEventListener('keydown', onKey);
  paint();

  return () => {
    alive = false; generation++; uploadGeneration++;
    clearTimeout(progressTimer);
    for (const close of dialogs) close();
    unsub();
    releaseAudio();
    document.removeEventListener('keydown', onKey);
  };
}
