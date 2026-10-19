// Transcript indexing is independent of the DOM so long recordings stay cheap to seek.
export function activeTurnIndex(turns, time) {
  let lo = 0, hi = turns.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (turns[mid].start <= time + 0.5) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function createHeightIndex(count, estimate = 130) {
  const heights = new Float64Array(count).fill(estimate);
  const tree = new Float64Array(count + 1);
  const add = (index, delta) => { for (let i = index + 1; i <= count; i += i & -i) tree[i] += delta; };
  for (let i = 0; i < count; i++) add(i, estimate);
  const offset = end => {
    let total = 0;
    for (let i = Math.min(count, Math.max(0, end)); i > 0; i -= i & -i) total += tree[i];
    return total;
  };
  return {
    offset,
    set(index, height) {
      if (index < 0 || index >= count || !Number.isFinite(height) || height <= 0) return;
      add(index, height - heights[index]); heights[index] = height;
    },
    indexAt(y) {
      if (!count) return -1;
      let index = 0, total = 0, bit = 1;
      while (bit * 2 <= count) bit *= 2;
      for (; bit; bit >>>= 1) {
        const next = index + bit;
        if (next <= count && total + tree[next] <= y) { index = next; total += tree[next]; }
      }
      return Math.min(index, count - 1);
    },
  };
}

export function windowRange(count, first, visibleEnd, limit = 80) {
  const start = Math.max(0, Math.min(count - limit, first - 8));
  return { start, end: Math.min(count, start + Math.min(limit, Math.max(24, visibleEnd - start + 9))) };
}

/** A measured window with full-height spacers keeps the native scrollbar usable. */
export function createTranscriptView({ turns, renderRow }) {
  const element = document.createElement('div');
  element.className = 'ls-lines';
  element.style.cssText = 'display:block;max-height:60vh;min-height:16rem;overflow-anchor:none';
  element.tabIndex = 0;
  element.setAttribute('aria-label', 'Lesson transcript');
  const heights = createHeightIndex(turns.length);
  const rows = new Map();
  let frame = 0, disposed = false, current = -1, start = -1, end = -1, manualUntil = 0;
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(paint); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  const top = document.createElement('div'), bottom = document.createElement('div');
  top.setAttribute('aria-hidden', 'true'); bottom.setAttribute('aria-hidden', 'true');
  const measure = () => {
    for (const [i, row] of rows) {
      const height = row.getBoundingClientRect().height;
      if (height > 0) heights.set(i, height + 8);
    }
    top.style.height = `${heights.offset(Math.max(0, start))}px`;
    bottom.style.height = `${heights.offset(turns.length) - heights.offset(Math.max(0, end))}px`;
  };
  function paint() {
    frame = 0;
    if (disposed) return;
    const range = windowRange(turns.length, heights.indexAt(element.scrollTop), heights.indexAt(element.scrollTop + (element.clientHeight || 600)));
    if (range.start !== start || range.end !== end) {
      observer?.disconnect(); rows.clear();
      start = range.start; end = range.end;
      const nodes = [];
      for (let i = start; i < end; i++) {
        const row = renderRow(turns[i], i);
        row.style.marginBottom = '8px';
        row.classList.toggle('on', i === current);
        rows.set(i, row); nodes.push(row); observer?.observe(row);
      }
      element.replaceChildren(top, ...nodes, bottom);
    }
    measure();
  }
  const manual = () => { manualUntil = Date.now() + 4000; };
  element.addEventListener('scroll', schedule, { passive: true });
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.addEventListener(event, manual, { passive: true });
  if (turns.length) paint();
  else { const empty = document.createElement('p'); empty.className = 'ls-note'; empty.textContent = 'No speech was recognised.'; element.append(empty); }
  const jump = i => {
    if (disposed || i < 0 || i >= turns.length) return;
    element.scrollTop = Math.max(0, heights.offset(i) - element.clientHeight / 3);
    paint();
    const row = rows.get(i);
    if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight / 3;
    schedule();
  };
  return {
    element, jump,
    refresh() { if (turns.length) { start = -1; paint(); } },
    active(i, follow) {
      rows.get(current)?.classList.remove('on'); current = i; rows.get(i)?.classList.add('on');
      if (follow && Date.now() >= manualUntil && i >= 0) jump(i);
    },
    destroy() { disposed = true; if (frame) cancelAnimationFrame(frame); observer?.disconnect(); rows.clear(); },
  };
}
