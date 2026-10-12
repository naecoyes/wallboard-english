// settings.js — 设置与数据备份（iOS 风格分组列表）
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { get, update, exportJSON, importJSON } from '../store.js';
import {
  englishVoices, speak, ttsAvailable, ttsEngine, testMimo, MIMO_VOICES,
  localKeyPresent, ttsCacheCount, clearTtsCache, ttsConfigReady,
} from '../tts.js';
import { wakeLockSupported, wakeLockActive, requestWakeLock } from '../wakelock.js';
import { applyTheme, currentTheme } from '../theme.js';

function row(ico, color, label, desc, ...controls) {
  return h('div', { class: 'row' },
    h('span', { class: 'r-ico ' + color }, icon(ico, 20)),
    h('div', { class: 'r-label' }, label, desc ? h('small', {}, desc) : null),
    ...controls);
}

function group(title, ...rows) {
  return h('section', {},
    h('div', { class: 'group-title' }, title),
    h('div', { class: 'group glass' }, ...rows));
}

export function renderSettings(root) {
  const s = get();

  // ---------- 发音 ----------
  const voiceSelect = h('select', {},
    h('option', { value: '' }, 'Auto (prefer en-US)'),
    ...englishVoices().map(v =>
      h('option', { value: v.voiceURI, ...(s.settings.voiceURI === v.voiceURI ? { selected: '' } : {}) },
        `${v.name} (${v.lang})`)));
  voiceSelect.addEventListener('change', () => {
    update(st => { st.settings.voiceURI = voiceSelect.value || null; });
    toast('Voice saved');
  });

  const rateSelect = h('select', {},
    ...[[0.7, 'Slow 0.7×'], [0.85, 'Relaxed 0.85×'], [0.95, 'Normal 0.95×'], [1.1, 'Brisk 1.1×']].map(([v, label]) =>
      h('option', { value: v, ...(s.settings.rate === v ? { selected: '' } : {}) }, label)));
  rateSelect.addEventListener('change', () => {
    update(st => { st.settings.rate = parseFloat(rateSelect.value); });
    toast('Speed saved');
  });

  // MiMo 发音
  const providerSel = h('select', {},
    ...[['mimo', 'Xiaomi MiMo (mimo-v2.5-tts)'], ['system', 'System voice (offline)']].map(([v, t]) =>
      h('option', { value: v, ...((s.settings.ttsProvider || 'mimo') === v ? { selected: '' } : {}) }, t)));
  providerSel.addEventListener('change', () => {
    update(st => { st.settings.ttsProvider = providerSel.value; });
    toast('Voice engine saved');
    renderAgain();
  });
  const mimoVoiceSel = h('select', {},
    ...MIMO_VOICES.map(([v, t]) => h('option', { value: v, ...((s.settings.mimoVoice || 'Dean') === v ? { selected: '' } : {}) }, t)));
  mimoVoiceSel.addEventListener('change', () => {
    update(st => { st.settings.mimoVoice = mimoVoiceSel.value; });
    speak('Hello! This is how I sound.');
  });
  const prefetchSel = h('select', {},
    ...[['smart', 'Smart (recommended)'], ['all', 'Everything on screen'], ['off', 'Off — generate on tap']].map(([v, t]) =>
      h('option', { value: v, ...((s.settings.ttsPrefetch || 'smart') === v ? { selected: '' } : {}) }, t)));
  prefetchSel.addEventListener('change', () => {
    update(st => { st.settings.ttsPrefetch = prefetchSel.value; });
    toast('Pre-generation saved');
  });
  const keyInput = h('input', {
    type: 'password', class: 'key-input', autocomplete: 'off', spellcheck: 'false', value: s.settings.mimoKey || '',
    placeholder: localKeyPresent() ? 'Using the key from js/config.local.js' : 'Paste your API key (starts with sk-)',
  });
  keyInput.addEventListener('change', () => {
    update(st => { st.settings.mimoKey = keyInput.value.trim(); });
    toast(keyInput.value.trim() ? 'API key saved on this device' : 'Key cleared — using local config or system voice');
  });
  const testPill = h('span', { class: 'status-pill ' + (ttsEngine() === 'mimo' ? 'ok' : 'warn') },
    ttsEngine() === 'mimo' ? 'Active' : 'Off');
  const testBtn = h('button', {
    class: 'btn sm', onclick: async () => {
      testBtn.disabled = true;
      testPill.className = 'status-pill warn'; testPill.textContent = 'Testing…';
      const r = await testMimo();
      testBtn.disabled = false;
      testPill.className = 'status-pill ' + (r.ok ? 'ok' : 'bad');
      testPill.textContent = r.ok ? `OK · ${(r.ms / 1000).toFixed(1)} s` : 'Failed';
      if (!r.ok) toast('MiMo test failed: ' + r.error);
    },
  }, icon('play', 16), 'Test');

  // config.local.js 是异步加载的，加载完再刷新一次状态
  ttsConfigReady.then(() => {
    if (!keyInput.value && localKeyPresent()) keyInput.placeholder = 'Using the key from js/config.local.js';
    if (testPill.textContent === 'Off' && ttsEngine() === 'mimo') {
      testPill.className = 'status-pill ok'; testPill.textContent = 'Active';
    }
  });

  const cacheInfo = h('small', {}, 'Counting…');
  ttsCacheCount().then(n => { cacheInfo.textContent = `${n ?? 0} clips cached — replays don't call the API`; });

  const mimoOn = (s.settings.ttsProvider || 'mimo') === 'mimo';
  const voiceGroup = group('Voice',
    row('volume', 'c-indigo', 'Voice engine', 'MiMo sounds more natural and needs internet; falls back to the system voice if it fails', providerSel),
    mimoOn ? row('mic', 'c-green', 'MiMo voice', null, mimoVoiceSel) : null,
    mimoOn ? row('zap', 'c-amber', 'Pre-generate audio',
      'Audio is prepared before you tap, so it plays instantly. Smart waits for a touch before preparing word examples, to save API usage',
      prefetchSel) : null,
    mimoOn ? h('div', { class: 'row stack' },
      h('div', { class: 'row-top' },
        h('span', { class: 'r-ico c-amber' }, icon('sparkle', 20)),
        h('div', { class: 'r-label' }, 'MiMo API Key',
          h('small', {}, 'Stored only on this device, never included in backups')),
        testPill, testBtn),
      keyInput) : null,
    mimoOn ? h('div', { class: 'row' },
      h('span', { class: 'r-ico c-sky' }, icon('download', 20)),
      h('div', { class: 'r-label' }, 'Audio cache', cacheInfo),
      h('button', {
        class: 'btn sm ghost', onclick: async () => {
          await clearTtsCache();
          cacheInfo.textContent = 'Cleared';
          toast('Audio cache cleared');
        },
      }, 'Clear')) : null,
    row('headphones', 'c-indigo', mimoOn ? 'System voice (fallback)' : 'English voice',
      englishVoices().length
        ? "The browser's built-in English voice, used when MiMo is unavailable"
        : 'No English voice in this browser. Install one under the tablet\'s Text-to-speech settings, or use MiMo', voiceSelect),
    row('gauge', 'c-sky', 'Speaking speed', null, rateSelect),
    row('play', 'c-green', 'Preview', null,
      h('button', {
        class: 'btn sm', onclick: () => ttsAvailable()
          ? speak('Practice a little every day, and you will improve.')
          : toast('Speech is not supported here'),
      }, icon('play', 16), 'Play')));

  // ---------- 学习 ----------
  const goalInput = h('input', { type: 'number', min: '5', max: '120', value: s.settings.dailyGoalMin });
  goalInput.addEventListener('change', () => {
    const v = Math.max(5, Math.min(120, parseInt(goalInput.value) || 25));
    goalInput.value = v;
    update(st => { st.settings.dailyGoalMin = v; });
    toast(`Daily goal: ${v} min`);
  });

  let wlPill, wlBtn = null;
  if (!wakeLockSupported()) {
    wlPill = h('span', { class: 'status-pill bad' }, 'Unsupported');
  } else if (wakeLockActive()) {
    wlPill = h('span', { class: 'status-pill ok' }, 'On');
  } else {
    wlPill = h('span', { class: 'status-pill warn' }, 'Off');
    wlBtn = h('button', { class: 'btn sm', onclick: async () => { await requestWakeLock(); renderAgain(); } }, 'Retry');
  }
  const pick = (key, options, label) => {
    const sel = h('select', {},
      ...options.map(([v, text]) => h('option', { value: v, ...(s.settings[key] === v ? { selected: '' } : {}) }, text)));
    sel.addEventListener('change', () => {
      update(st => { st.settings[key] = Number(sel.value); });
      toast(`${label} saved`);
    });
    return sel;
  };
  const idleSelect = pick('idleMin', [[1, '1 min'], [2, '2 min'], [3, '3 min'], [5, '5 min'], [10, '10 min']], 'Idle time');
  const autoSelect = pick('wordAutoSec', [[0, 'Off'], [30, 'Every 30 s'], [45, 'Every 45 s'], [60, 'Every 1 min'], [120, 'Every 2 min']], 'Auto-advance');
  const wst = s.words;

  // ---------- 显示：白天 / 夜间 ----------
  const themeSel = h('select', {},
    ...[['auto', 'Auto (by time of day)'], ['system', 'Follow system dark mode'], ['light', 'Always day'], ['dark', 'Always night']].map(([v, t]) =>
      h('option', { value: v, ...((s.settings.theme || 'auto') === v ? { selected: '' } : {}) }, t)));
  themeSel.addEventListener('change', () => {
    update(st => { st.settings.theme = themeSel.value; });
    applyTheme();
    toast('Theme saved');
  });
  const hourSel = (key, from, to) => {
    const sel = h('select', {},
      ...Array.from({ length: to - from + 1 }, (_, i) => from + i).map(v =>
        h('option', { value: v, ...(s.settings[key] === v ? { selected: '' } : {}) }, `${String(v).padStart(2, '0')}:00`)));
    sel.addEventListener('change', () => {
      update(st => { st.settings[key] = Number(sel.value); });
      applyTheme();
      toast('Daytime hours saved');
    });
    return sel;
  };
  const displayGroup = group('Display',
    row('sun', 'c-amber', 'Day / night', `Now: ${currentTheme() === 'light' ? 'day' : 'night'}`, themeSel),
    row('timer', 'c-sky', 'Daytime hours', 'In Auto mode, the day palette is used between these hours',
      hourSel('dayStart', 5, 10), h('span', { class: 'setting-dash' }, 'to'), hourSel('dayEnd', 16, 22)));

  const learnGroup = group('Study',
    row('target', 'c-green', 'Daily goal', 'Minutes per day, 5–120', goalInput),
    row('book', 'c-indigo', 'Show words when idle', 'Switch to Words after this long without a tap (never during Focus)', idleSelect),
    row('repeat', 'c-sky', 'Word auto-advance',
      `${wst.known.length} known · ${wst.unknown.length} learning (in your review deck)`, autoSelect),
    row('sun', 'c-amber', 'Keep screen on',
      wakeLockSupported() ? 'Tap the page once to activate'
        : !window.isSecureContext
          ? 'Not allowed on a plain http address. Set the tablet\'s Settings → Display & brightness → Sleep to Never (or use the https address)'
          : 'This browser cannot keep the screen on. Set the tablet\'s Settings → Display & brightness → Sleep to Never',
      wlPill, wlBtn));

  // ---------- 数据 ----------
  const lastBk = s.settings.lastBackupHint;
  const importBox = h('textarea', { class: 'import-box', placeholder: 'Paste your backup JSON here…' });
  const dataGroup = group('Data',
    row('download', 'c-indigo', 'Export backup',
      lastBk ? `Last export: ${new Date(lastBk).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Never exported — weekly is a good habit',
      h('button', {
        class: 'btn sm blue', onclick: () => {
          const blob = new Blob([exportJSON()], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `wallboard-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
          update(st => { st.settings.lastBackupHint = new Date().toISOString(); });
          toast('Backup file exported');
        },
      }, icon('download', 16), 'Download JSON')),
    h('div', { class: 'row stack' },
      h('div', { class: 'row-top' },
        h('span', { class: 'r-ico c-rose' }, icon('upload', 20)),
        h('div', { class: 'r-label' }, 'Import backup', h('small', {}, 'Replaces all current data on this device'))),
      importBox,
      h('div', { class: 'btn-row', style: 'margin-top:4px' },
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'btn sm danger', onclick: () => {
            if (!importBox.value.trim()) return toast('Paste a backup first');
            const r = importJSON(importBox.value);
            if (r.ok) { toast('Backup imported'); setTimeout(() => location.hash = '#standby', 800); }
            else toast('Import failed: ' + r.error);
          },
        }, 'Import and replace'))));

  // ---------- 挂墙建议 ----------
  const tips = h('section', {},
    h('div', { class: 'group-title' }, 'Wall setup tips'),
    h('div', { class: 'tips glass' },
      h('ol', {},
        h('li', {}, 'Open this site in the tablet browser and use “Add to home screen” from the menu; launch it from that icon for full screen'),
        h('li', {}, 'Set Settings → Display & brightness → Sleep to Never, and keep the tablet plugged in'),
        h('li', {}, 'Turn on Screen pinning (search for it in Settings) to lock the tablet to this page'),
        h('li', {}, `After ${s.settings.idleMin} min without a tap the app switches to Words; Focus sessions are never interrupted`)),
      h('div', { class: 'credits' },
        'Credits: word list, phonetics and definitions from ECDICT (MIT, github.com/skywind3000/ECDICT), IELTS-tagged entries. ',
        'Example sentences from Tatoeba (tatoeba.org, CC BY 2.0 FR); sentence numbers are shown under each example. ',
        'Other examples and notes are original.')));

  const wrap = h('div', { class: 'settings' },
    h('div', { class: 'mode-head' }, h('h1', {}, icon('settings', 24), 'Settings')),
    h('div', { class: 'settings-cols' },
      h('div', { class: 'settings-col' }, voiceGroup, learnGroup),
      h('div', { class: 'settings-col' }, displayGroup, dataGroup, tips)));
  root.append(wrap);

  function renderAgain() { root.innerHTML = ''; renderSettings(root); }
}
