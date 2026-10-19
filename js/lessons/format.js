// format.js — 课堂记录的整理与导出（纯函数，Node 单测可直接引用）
export const ROLE = { teacher: 'Teacher', student: 'Student', unknown: 'Speaker' };

/** 各段的发言摊平成一条时间线（MiMo ASR 不给逐句时间戳，这时段内按字数比例估算） */
export function flatten(lesson) {
  const out = [];
  (lesson.chunks || []).forEach((c, ci) => {
    const turns = c.turns || (c.text ? [{ role: 'unknown', text: c.text, zh: '' }] : []);
    const total = turns.reduce((n, t) => n + t.text.length, 0) || 1;
    let acc = 0;
    turns.forEach((t, ti) => {
      // Gemini 给了时间戳就用（保证不倒退），否则按字数在本段内估算
      const est = c.start + (c.end - c.start) * acc / total;
      const prev = out.length ? out[out.length - 1].start : 0;
      const start = Number.isFinite(t.at) ? Math.max(prev, Math.min(c.end, t.at)) : est;
      out.push({ ...t, chunk: ci, idx: ti, start });
      acc += t.text.length;
    });
  });
  out.forEach((t, i) => { t.end = i + 1 < out.length ? out[i + 1].start : (lesson.chunks.at(-1)?.end ?? t.start); });
  return out;
}

/** 纠错挂到对应的学生发言上：优先用行号，对不上就按原文查找 */
export function correctionsByLine(turns, corrections = []) {
  const map = new Map();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const c of corrections) {
    let i = c.line;
    if (!(turns[i] && norm(turns[i].text).includes(norm(c.original)))) i = turns.findIndex(t => norm(t.text).includes(norm(c.original)));
    if (i < 0) continue;
    if (!map.has(i)) map.set(i, []);
    map.get(i).push(c);
  }
  return map;
}

export const clock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
};
const srtTime = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

export function toTxt(lesson) {
  return flatten(lesson).map(t => `[${clock(t.start)}] ${ROLE[t.role]}: ${t.text}`).join('\n') + '\n';
}

export function toSrt(lesson) {
  return flatten(lesson).map((t, i) =>
    `${i + 1}\n${srtTime(t.start)} --> ${srtTime(Math.max(t.end, t.start + 1))}\n${ROLE[t.role]}: ${t.text}\n`).join('\n');
}

export function toMarkdown(lesson) {
  const turns = flatten(lesson);
  const n = lesson.notes;
  const fixes = correctionsByLine(turns, n?.corrections);
  const L = [`# ${lesson.title}`, '', `${new Date(lesson.createdAt).toISOString().slice(0, 10)} · ${clock(lesson.duration || 0)} · ${turns.length} lines`, ''];
  if (n) {
    L.push('## Summary', '', n.summary.en, '', n.summary.zh, '');
    if (n.corrections.length) {
      L.push('## Corrections', '');
      for (const c of n.corrections) L.push(`- ~~${c.original}~~ → **${c.suggestion}**${c.reason ? `  \n  ${c.reason}` : ''}`);
      L.push('');
    }
    if (n.expressions.length) {
      L.push('## Useful expressions', '');
      for (const e of n.expressions) L.push(`- **${e.en}** — ${e.zh}${e.example ? `  \n  _${e.example}_` : ''}`);
      L.push('');
    }
    if (n.words.length) {
      L.push('## Words', '', '| Word | | Meaning | Example |', '|---|---|---|---|');
      for (const w of n.words) L.push(`| ${w.word} | ${w.pos} | ${w.zh} | ${w.example.replace(/\|/g, '/')} |`);
      L.push('');
    }
  }
  L.push('## Transcript', '');
  turns.forEach((t, i) => {
    L.push(`**${ROLE[t.role]}** \`${clock(t.start)}\`  `, t.text + (t.zh ? `  \n${t.zh}` : ''));
    for (const c of fixes.get(i) || []) L.push(`> ✎ ${c.suggestion}${c.reason ? ` — ${c.reason}` : ''}`);
    L.push('');
  });
  return L.join('\n');
}
