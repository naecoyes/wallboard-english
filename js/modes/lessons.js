// lessons.js — 课堂录音：上传 1v1 课的录音 → MiMo 转写 → 分出老师 / 学生 → 点句子跳到录音位置 → 复习笔记 + 导出
// 列表页：所有课程（处理进度 / 继续 / 删除）；详情页：左边对话 + 播放器，右边总结 / 纠错 / 表达 / 生词
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { update, get } from '../store.js';
import { addCard } from '../srs.js';
import { mimoAuth, stopSpeak } from '../tts.js';
import { probeDuration } from '../lessons/audio.js';
import { DEFAULT_LLM } from '../lessons/api.js';
import { listLessons, getLesson, putLesson, getAudio, deleteLesson, deleteAllLessons } from '../lessons/db.js';
import { subscribe, jobOf, start, cancel, createLesson, regenerateNotes } from '../lessons/runner.js';
import { flatten, correctionsByLine, clock, ROLE, toTxt, toSrt, toMarkdown } from '../lessons/format.js';

const OPEN_KEY = 'wallboard-lesson-open';
const STATUS = { processing: 'Processing', paused: 'Paused', partial: 'Incomplete', error: 'Failed', done: 'Ready' };
const NEXT_ROLE = { teacher: 'student', student: 'teacher', unknown: 'teacher' };

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function dialog(cls, ...children) {
  const dlg = h('dialog', { class: `external-dialog ${cls}` }, ...children);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

export function renderLessons(root) {
  let alive = true;
  let openId = sessionStorage.getItem(OPEN_KEY);
  let audioUrl = null;
  let player = null;
  let detailSig = '';
  const wrap = h('div', { class: 'word-mode ls' });
  root.append(wrap);

  const setOpen = (id) => {
    openId = id;
    if (id) sessionStorage.setItem(OPEN_KEY, id); else sessionStorage.removeItem(OPEN_KEY);
    detailSig = '';
    paint();
  };
  const releaseAudio = () => {
    if (player) { player.pause(); player.removeAttribute('src'); player = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  };

  async function paint() {
    if (!alive) return;
    if (openId) {
      const lesson = await getLesson(openId);
      if (lesson) return paintDetail(lesson);
      openId = null; sessionStorage.removeItem(OPEN_KEY);
    }
    paintList();
  }

  // ======================= 列表 =======================
  async function paintList() {
    releaseAudio();
    const lessons = await listLessons();
    if (!alive || openId) return;
    const fileInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.aac', hidden: '' });
    fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) confirmUpload(f); });
    const head = h('div', { class: 'mode-head' },
      h('div', {}, h('h1', {}, icon('mic', 24), 'Lessons'),
        h('div', { class: 'sub' }, 'Upload a class recording to get the transcript, speakers and review notes')),
      h('div', { class: 'btn-group' },
        h('button', { type: 'button', class: 'btn sm ghost', onclick: openOptions }, icon('settings', 16), 'Options'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => fileInput.click() }, icon('upload', 16), 'Upload recording'),
        fileInput));

    const cards = lessons.map(l => {
      const job = jobOf(l.id);
      const status = job ? 'processing' : l.status === 'processing' ? 'paused' : l.status;
      const pct = job && job.total ? Math.round(job.done / job.total * 100) : 0;
      const turns = flatten(l).length;
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
            : status !== 'done' ? h('button', { type: 'button', class: 'btn sm ghost', onclick: () => resume(l.id) }, status === 'paused' ? 'Resume' : 'Retry') : null,
          h('button', { type: 'button', class: 'btn sm danger', onclick: () => remove(l) }, icon('trash', 15))));
    });
    const empty = h('section', { class: 'wm-card glass ls-empty' },
      h('span', { class: 'wm-label' }, 'HOW IT WORKS'),
      h('ol', {},
        h('li', {}, 'Record your 1-to-1 class (MP3, M4A or WAV, up to about 60 minutes).'),
        h('li', {}, 'Upload it here. MiMo transcribes the English and an AI model marks who is the teacher and who is the student.'),
        h('li', {}, 'Tap any line to hear that part of the recording. Review the summary, corrections, expressions and new words.'),
        h('li', {}, 'Export TXT, Markdown or SRT subtitles.')),
      h('p', { class: 'ls-note' }, 'Recordings stay on this device. Audio is sent to Xiaomi MiMo only for transcription. Ask your teacher before recording.'));
    wrap.replaceChildren(head, h('div', { class: 'ls-list' }, ...(cards.length ? cards : [empty])));
  }

  async function resume(id) {
    if (!(await mimoAuth())) return needKey();
    start(id);
  }

  async function remove(l) {
    if (!confirm(`Delete “${l.title}” and its recording from this device?`)) return;
    cancel(l.id);
    await deleteLesson(l.id);
    toast('Lesson deleted');
    if (openId === l.id) setOpen(null); else paint();
  }

  function needKey() {
    const close = dialog('ls-dlg',
      h('h2', {}, 'MiMo API key needed'),
      h('p', {}, 'Lessons uses your Xiaomi MiMo key for transcription (about ¥0.5 per hour of audio). Add it under Settings → Pronunciation.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => { close(); location.hash = '#settings'; } }, 'Open Settings'),
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel')));
  }

  async function confirmUpload(file) {
    if (!(await mimoAuth())) return needKey();
    const dur = await probeDuration(file);
    const title = h('input', { type: 'text', value: file.name.replace(/\.[^.]+$/, '').slice(0, 80), maxlength: '80' });
    const close = dialog('ls-dlg',
      h('h2', {}, 'New lesson'),
      h('label', {}, 'Title', title),
      h('p', { class: 'ls-meta' }, `${file.name} · ${(file.size / 1e6).toFixed(1)} MB${dur ? ` · ${clock(dur)}` : ''}`),
      dur > 3600 ? h('p', { class: 'ls-err' }, 'Longer than 60 minutes: the tablet may run out of memory while decoding. If it fails, split the recording first.') : null,
      h('p', { class: 'ls-note' }, 'The audio is sent to Xiaomi MiMo for transcription, then the text goes to the analysis model. Make sure your teacher agrees to being recorded.'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary', onclick: async () => {
            close();
            const id = await createLesson(file, title.value.trim() || file.name);
            setOpen(id);
          },
        }, 'Start'),
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel')));
    title.focus();
  }

  async function openOptions() {
    const model = h('input', { type: 'text', value: get().settings.lessonModel || DEFAULT_LLM, spellcheck: 'false' });
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const close = dialog('ls-dlg',
      h('h2', {}, 'Lesson options'),
      h('label', {}, 'Analysis model (speakers, translation, notes)', model),
      h('p', { class: 'ls-meta' }, `Transcription always uses mimo-v2.5-asr. Default analysis model: ${DEFAULT_LLM}.`),
      est ? h('p', { class: 'ls-meta' }, `Browser storage used: ${(est.usage / 1e6).toFixed(0)} MB`) : null,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary', onclick: () => {
            const v = model.value.trim();
            update(s => { s.settings.lessonModel = v && v !== DEFAULT_LLM ? v : ''; });
            close(); toast('Saved');
          },
        }, 'Save'),
        h('button', {
          class: 'btn danger', onclick: async () => {
            if (!confirm('Delete every lesson and recording from this device?')) return;
            (await listLessons()).forEach(l => cancel(l.id));
            await deleteAllLessons();
            close(); toast('All lessons deleted'); setOpen(null);
          },
        }, 'Delete all lessons'),
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Close')));
  }

  // ======================= 详情 =======================
  async function paintDetail(lesson) {
    const job = jobOf(lesson.id);
    const sig = job ? `job:${job.stage}:${job.done}:${job.total}` : `idle:${lesson.status}`;
    if (sig === detailSig) return;
    const wasRunning = detailSig.startsWith('job:');
    detailSig = sig;
    if (!job || !wasRunning) releaseAudio();

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
      await putLesson(lesson); detailSig = ''; paintDetail(lesson); toast('Teacher and student swapped');
    };
    const exportMenu = () => {
      const base = lesson.title.replace(/[\\/:*?"<>|]+/g, '_');
      const close = dialog('ls-dlg',
        h('h2', {}, 'Export'),
        h('div', { class: 'ls-export' },
          h('button', { class: 'btn', onclick: () => { download(`${base}.md`, toMarkdown(lesson), 'text/markdown'); close(); } }, 'Markdown · notes + transcript'),
          h('button', { class: 'btn', onclick: () => { download(`${base}.txt`, toTxt(lesson), 'text/plain'); close(); } }, 'TXT · transcript'),
          h('button', { class: 'btn', onclick: () => { download(`${base}.srt`, toSrt(lesson), 'application/x-subrip'); close(); } }, 'SRT · subtitles')),
        h('p', { class: 'ls-meta' }, 'Times are estimated within each 90-second part of the recording.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Close')));
    };
    actions.prepend(
      h('button', { type: 'button', class: 'btn sm ghost', onclick: swapAll, title: 'Swap Teacher and Student labels' }, icon('repeat', 16), 'Swap roles'),
      h('button', { type: 'button', class: 'btn sm', onclick: exportMenu }, icon('download', 16), 'Export'));

    // 播放器
    player = h('audio', { controls: '', preload: 'metadata', class: 'ls-audio' });
    getAudio(lesson.id).then(blob => {
      if (!alive || !player || !blob) return;
      audioUrl = URL.createObjectURL(blob);
      player.src = audioUrl;
    });
    const speeds = h('div', { class: 'ls-speeds' }, ...[0.75, 1, 1.25].map(r =>
      h('button', { type: 'button', class: 'sn-chip' + (r === 1 ? ' on' : ''), onclick: e => {
        player.playbackRate = r;
        speeds.querySelectorAll('.sn-chip').forEach(b => b.classList.toggle('on', b === e.currentTarget));
      } }, `${r}×`)));
    let showZh = false;
    const zhToggle = h('button', { type: 'button', class: 'sn-chip', onclick: () => {
      showZh = !showZh;
      zhToggle.classList.toggle('on', showZh);
      lines.querySelectorAll('.ls-zh').forEach(z => z.classList.toggle('reveal-hidden', !showZh));
    } }, '中文');

    const seek = (t) => { if (!player) return; stopSpeak(); player.currentTime = Math.max(0, t.start - 0.5); player.play().catch(() => {}); };
    const rows = turns.map((t, i) => {
      const role = h('button', { type: 'button', class: 'ls-role', title: 'Tap to change speaker', onclick: async () => {
        const c = lesson.chunks[t.chunk].turns?.[t.idx];
        if (!c) return;
        c.role = NEXT_ROLE[c.role];
        await putLesson(lesson);
        t.role = c.role;
        row.className = `ls-line ${t.role}`;
        role.textContent = ROLE[t.role];
      } }, ROLE[t.role]);
      const zh = t.zh ? h('div', { class: 'ls-zh reveal-hidden', onclick: e => e.currentTarget.classList.toggle('reveal-hidden') }, t.zh) : null;
      const row = h('div', { class: `ls-line ${t.role}`, 'data-i': i },
        h('div', { class: 'ls-line-head' }, role, h('button', { type: 'button', class: 'ls-time', onclick: () => seek(t) }, clock(t.start))),
        h('button', { type: 'button', class: 'ls-text', title: 'Play from here', onclick: () => seek(t) }, t.text),
        zh,
        ...(fixes.get(i) || []).map(c => h('div', { class: 'ls-fix' },
          h('div', {}, icon('check', 14), h('b', {}, c.suggestion)),
          c.reason ? h('small', {}, c.reason) : null)));
      return row;
    });
    const lines = h('div', { class: 'ls-lines' }, ...rows);
    if (!rows.length) lines.append(h('p', { class: 'ls-note' }, 'No speech was recognised.'));

    // 播放时高亮当前句并跟随滚动
    let cur = -1;
    player.addEventListener('timeupdate', (e) => {
      const p = e.currentTarget; // 离开详情页时 player 已置空，暂停仍会触发一次 timeupdate
      if (!p.getAttribute('src')) return;
      const t = p.currentTime;
      let i = turns.findIndex(x => x.start > t + 0.5) - 1;
      if (i < -1) i = turns.length - 1;
      if (i === cur) return;
      rows[cur]?.classList.remove('on');
      cur = i;
      if (rows[cur]) {
        rows[cur].classList.add('on');
        if (!p.paused) rows[cur].scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });

    const banner = [];
    const stopped = lesson.status === 'error' || lesson.status === 'processing' || lesson.status === 'paused';
    if (!stopped && failed.length) banner.push(h('div', { class: 'ls-warn' },
      `${failed.length} part${failed.length > 1 ? 's' : ''} of the recording could not be transcribed (${failed.map(c => `${clock(c.start)}–${clock(c.end)}`).slice(0, 3).join(', ')}).`,
      h('button', { type: 'button', class: 'btn sm', onclick: () => resume(lesson.id) }, 'Retry')));
    if (stopped) banner.push(h('div', { class: 'ls-warn' },
      lesson.error || 'Processing was interrupted.',
      h('button', { type: 'button', class: 'btn sm', onclick: () => resume(lesson.id) }, lesson.chunks?.length ? 'Resume' : 'Retry')));
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
    let tab = 'summary';
    const tabBar = h('div', { class: 'sn-chips ls-tabs' });
    const pane = h('div', { class: 'ls-pane' });
    const add = (front, back, example) => toast(addCard(front, back, example) ? `“${front}” added to your review deck` : 'Already in your review deck');
    const paintPane = () => {
      tabBar.replaceChildren(...tabs.map(([k, label]) =>
        h('button', { type: 'button', class: 'sn-chip' + (k === tab ? ' on' : ''), onclick: () => { tab = k; paintPane(); } }, label)));
      if (!notes) {
        pane.replaceChildren(h('p', { class: 'ls-note' }, lesson.notesError ? `Notes failed: ${lesson.notesError}` : 'No notes yet.'),
          turns.length ? h('button', { type: 'button', class: 'btn sm', onclick: () => regenerateNotes(lesson.id) }, 'Generate notes') : null);
        return;
      }
      if (tab === 'summary') pane.replaceChildren(
        h('p', { class: 'ls-sum' }, notes.summary.en),
        h('p', { class: 'ls-sum zh' }, notes.summary.zh),
        h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { if (confirm('Rewrite the review notes?')) regenerateNotes(lesson.id); } }, icon('repeat', 15), 'Regenerate notes'));
      else if (tab === 'corrections') pane.replaceChildren(...(notes.corrections.length ? notes.corrections.map(c => {
        const i = [...fixes].find(([, list]) => list.includes(c))?.[0];
        return h('div', { class: 'ls-item' },
          h('div', { class: 'ls-orig' }, c.original),
          h('div', { class: 'ls-sugg' }, c.suggestion),
          c.reason ? h('small', {}, c.reason) : null,
          h('div', { class: 'ls-item-actions' },
            i != null ? h('button', { type: 'button', class: 'sn-chip', onclick: () => { rows[i].scrollIntoView({ block: 'center', behavior: 'smooth' }); seek(turns[i]); } }, icon('play', 13), clock(turns[i].start)) : null,
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
  }

  const unsub = subscribe(id => {
    if (!alive) return;
    if (!openId) paintList();
    else if (id === openId) paint();
  });
  const onKey = (e) => {
    if (!player || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); player.paused ? player.play().catch(() => {}) : player.pause(); }
  };
  document.addEventListener('keydown', onKey);
  paint();

  return () => {
    alive = false;
    unsub();
    releaseAudio();
    document.removeEventListener('keydown', onKey);
  };
}
