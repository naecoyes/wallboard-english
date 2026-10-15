import { h } from './ui.js';

const STAGES = [
  { threshold: 0, name: 'Seed' },
  { threshold: 50, name: 'Sprout' },
  { threshold: 150, name: 'Sapling' },
  { threshold: 400, name: 'Young tree' },
  { threshold: 800, name: 'Growing tree' },
  { threshold: 1500, name: 'Flourishing tree' },
];

/** Derive lifetime growth from a snapshot without changing or saving state. */
export function treeProgress(state = {}) {
  const seconds = (Array.isArray(state?.sessions) ? state.sessions : []).reduce((total, session) => {
    const duration = Number.isFinite(session?.seconds) ? session.seconds : Number(session?.minutes) * 60;
    return total + (Number.isFinite(duration) ? Math.max(0, duration) : 0);
  }, 0);
  const minutes = Math.floor(seconds / 60);
  const rawXP = Number(state?.profile?.xp);
  const xp = Number.isFinite(rawXP) ? Math.max(0, rawXP) : 0;
  const points = minutes + xp;
  let index = 0;
  while (index < STAGES.length - 1 && points >= STAGES[index + 1].threshold) index++;
  const current = STAGES[index];
  const next = STAGES[index + 1];
  return {
    points, minutes, xp,
    stage: index + 1,
    stageName: current.name,
    threshold: current.threshold,
    nextThreshold: next?.threshold ?? null,
    nextStageName: next?.name ?? null,
    remaining: next ? next.threshold - points : 0,
    progress: next ? (points - current.threshold) / (next.threshold - current.threshold) : 1,
  };
}

// Fixed artwork only: each stage gets a taller trunk and a fuller canopy.
const ART = [
  '<ellipse class="lt-seed" cx="110" cy="149" rx="9" ry="6" transform="rotate(-25 110 149)"/><path class="lt-vein" d="M105 152l10-6"/>',
  '<path class="lt-trunk" d="M110 151v-25"/><path class="lt-leaf" d="M110 137c-16 0-23-9-21-17 14-1 23 5 21 17zm0-8c0-15 9-23 21-21 0 13-8 21-21 21z"/>',
  '<path class="lt-trunk" d="M110 151v-57m0 38-18-13m18 2 20-17"/><path class="lt-leaf" d="M94 121c-18 1-28-9-25-21 17-1 27 7 25 21zm32-13c-1-18 10-29 25-27 1 17-9 28-25 27zm-16-2c-18-2-27-14-22-28 17 2 26 13 22 28zm0-13c-2-17 7-29 21-30 4 17-4 29-21 30z"/>',
  '<path class="lt-trunk" d="M110 151V78m0 48-26-23m26 12 28-29"/><g class="lt-leaf"><circle cx="83" cy="91" r="23"/><circle cx="137" cy="83" r="25"/><circle cx="107" cy="64" r="29"/><circle cx="110" cy="94" r="25"/></g>',
  '<path class="lt-trunk lt-trunk-wide" d="M110 151V67m0 58-34-30m34 14 36-34"/><g class="lt-leaf"><circle cx="72" cy="81" r="29"/><circle cx="147" cy="73" r="29"/><circle cx="105" cy="45" r="32"/><circle cx="123" cy="81" r="32"/></g><path class="lt-vein" d="m78 85 24 21m42-29-23 25"/>',
  '<path class="lt-trunk lt-trunk-wide" d="M110 151V55m0 73L69 91m41 21 45-41"/><g class="lt-leaf"><circle cx="63" cy="74" r="32"/><circle cx="153" cy="69" r="34"/><circle cx="89" cy="40" r="33"/><circle cx="133" cy="36" r="33"/><circle cx="108" cy="78" r="39"/></g><path class="lt-vein" d="m65 80 32 25m59-31-33 31"/><g class="lt-fruit"><circle cx="70" cy="66" r="5"/><circle cx="116" cy="32" r="5"/><circle cx="150" cy="80" r="5"/><circle cx="110" cy="89" r="5"/></g>',
];

/** A local view updated by the homepage timer; no subscription or extra timer. */
export function createLearningTree(state) {
  const illustration = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  illustration.setAttribute('viewBox', '0 0 220 170');
  illustration.setAttribute('class', 'lt-art');
  illustration.setAttribute('role', 'img');
  illustration.setAttribute('focusable', 'false');
  const points = h('strong', { class: 'lt-points' });
  const stage = h('p', { class: 'lt-stage' });
  const next = h('p', { class: 'lt-next' });
  const fill = h('div', { class: 'lt-fill' });
  const progress = h('div', {
    class: 'lt-track', role: 'progressbar', 'aria-label': 'Progress to next tree stage',
    'aria-valuemin': '0', 'aria-valuemax': '100',
  }, fill);
  const breakdown = h('p', { class: 'lt-breakdown' });
  const element = h('section', { class: 'ec-card learning-tree', 'aria-label': 'My learning tree' },
    h('div', { class: 'ec-head' }, h('div', {}, h('h2', {}, 'My learning tree'))),
    h('div', { class: 'lt-body' }, illustration,
      h('div', { class: 'lt-details' },
        h('div', { class: 'lt-score' }, points, h('span', {}, 'points')),
        stage, progress, next)),
    breakdown);

  let previous;
  function update(snapshot) {
    const value = treeProgress(snapshot);
    if (previous && previous.minutes === value.minutes && previous.xp === value.xp) return;
    points.textContent = value.points.toLocaleString('en-US');
    stage.textContent = `Stage ${value.stage} of ${STAGES.length} · ${value.stageName}`;
    next.textContent = value.nextThreshold === null
      ? 'Fully grown · keep learning!'
      : `${value.remaining.toLocaleString('en-US')} points to ${value.nextStageName} · ${value.nextThreshold.toLocaleString('en-US')} total`;
    breakdown.textContent = `${value.minutes.toLocaleString('en-US')} study minute${value.minutes === 1 ? '' : 's'} + ${value.xp.toLocaleString('en-US')} XP`;
    const percent = Math.round(value.progress * 100);
    fill.style.width = `${value.progress * 100}%`;
    progress.setAttribute('aria-valuenow', String(percent));
    progress.setAttribute('aria-valuetext', value.nextThreshold === null ? 'Fully grown' : `${percent}% · ${next.textContent}`);
    if (!previous || previous.stage !== value.stage) {
      illustration.innerHTML = '<ellipse class="lt-ground" cx="110" cy="154" rx="75" ry="9"/>' + ART[value.stage - 1];
      illustration.setAttribute('aria-label', `${value.stageName}, growth stage ${value.stage} of ${STAGES.length}`);
      element.dataset.stage = String(value.stage);
    }
    previous = value;
  }
  update(state);
  return { element, update };
}
