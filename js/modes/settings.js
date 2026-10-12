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
    h('option', { value: '' }, '自动（首选 en-US）'),
    ...englishVoices().map(v =>
      h('option', { value: v.voiceURI, ...(s.settings.voiceURI === v.voiceURI ? { selected: '' } : {}) },
        `${v.name} (${v.lang})`)));
  voiceSelect.addEventListener('change', () => {
    update(st => { st.settings.voiceURI = voiceSelect.value || null; });
    toast('发音人已保存');
  });

  const rateSelect = h('select', {},
    ...[[0.7, '慢 0.7×'], [0.85, '稍慢 0.85×'], [0.95, '标准 0.95×'], [1.1, '稍快 1.1×']].map(([v, label]) =>
      h('option', { value: v, ...(s.settings.rate === v ? { selected: '' } : {}) }, label)));
  rateSelect.addEventListener('change', () => {
    update(st => { st.settings.rate = parseFloat(rateSelect.value); });
    toast('语速已保存');
  });

  // MiMo 发音
  const providerSel = h('select', {},
    ...[['mimo', '小米 MiMo（mimo-v2.5-tts）'], ['system', '系统语音（离线）']].map(([v, t]) =>
      h('option', { value: v, ...((s.settings.ttsProvider || 'mimo') === v ? { selected: '' } : {}) }, t)));
  providerSel.addEventListener('change', () => {
    update(st => { st.settings.ttsProvider = providerSel.value; });
    toast('发音引擎已保存');
    renderAgain();
  });
  const mimoVoiceSel = h('select', {},
    ...MIMO_VOICES.map(([v, t]) => h('option', { value: v, ...((s.settings.mimoVoice || 'Mia') === v ? { selected: '' } : {}) }, t)));
  mimoVoiceSel.addEventListener('change', () => {
    update(st => { st.settings.mimoVoice = mimoVoiceSel.value; });
    speak('Hello! This is how I sound.');
  });
  const keyInput = h('input', {
    type: 'password', class: 'key-input', autocomplete: 'off', spellcheck: 'false', value: s.settings.mimoKey || '',
    placeholder: localKeyPresent() ? '已使用 js/config.local.js 中的 Key' : '粘贴 sk- 开头的 API Key',
  });
  keyInput.addEventListener('change', () => {
    update(st => { st.settings.mimoKey = keyInput.value.trim(); });
    toast(keyInput.value.trim() ? 'API Key 已保存在本机' : '已清空，改用本地配置或系统语音');
  });
  const testPill = h('span', { class: 'status-pill ' + (ttsEngine() === 'mimo' ? 'ok' : 'warn') },
    ttsEngine() === 'mimo' ? '使用中' : '未启用');
  const testBtn = h('button', {
    class: 'btn sm', onclick: async () => {
      testBtn.disabled = true;
      testPill.className = 'status-pill warn'; testPill.textContent = '请求中…';
      const r = await testMimo();
      testBtn.disabled = false;
      testPill.className = 'status-pill ' + (r.ok ? 'ok' : 'bad');
      testPill.textContent = r.ok ? `正常 · ${(r.ms / 1000).toFixed(1)} 秒` : '失败';
      if (!r.ok) toast('MiMo 测试失败：' + r.error);
    },
  }, icon('play', 16), '测试');

  // config.local.js 是异步加载的，加载完再刷新一次状态
  ttsConfigReady.then(() => {
    if (!keyInput.value && localKeyPresent()) keyInput.placeholder = '已使用 js/config.local.js 中的 Key';
    if (testPill.textContent === '未启用' && ttsEngine() === 'mimo') {
      testPill.className = 'status-pill ok'; testPill.textContent = '使用中';
    }
  });

  const cacheInfo = h('small', {}, '统计中…');
  ttsCacheCount().then(n => { cacheInfo.textContent = `已缓存 ${n ?? 0} 段音频，重复播放不再请求接口`; });

  const mimoOn = (s.settings.ttsProvider || 'mimo') === 'mimo';
  const voiceGroup = group('发音',
    row('volume', 'c-indigo', '发音引擎', 'MiMo 音质更自然，需联网；请求失败时自动改用系统语音', providerSel),
    mimoOn ? row('mic', 'c-green', 'MiMo 音色', null, mimoVoiceSel) : null,
    mimoOn ? h('div', { class: 'row stack' },
      h('div', { class: 'row-top' },
        h('span', { class: 'r-ico c-amber' }, icon('sparkle', 20)),
        h('div', { class: 'r-label' }, 'MiMo API Key',
          h('small', {}, '只保存在这台设备，导出备份时不包含')),
        testPill, testBtn),
      keyInput) : null,
    mimoOn ? h('div', { class: 'row' },
      h('span', { class: 'r-ico c-sky' }, icon('download', 20)),
      h('div', { class: 'r-label' }, '发音缓存', cacheInfo),
      h('button', {
        class: 'btn sm ghost', onclick: async () => {
          await clearTtsCache();
          cacheInfo.textContent = '已清空';
          toast('发音缓存已清空');
        },
      }, '清空')) : null,
    row('headphones', 'c-indigo', mimoOn ? '系统语音（备用）' : '英文发音人',
      englishVoices().length
        ? '浏览器自带的英文语音，MiMo 不可用时使用'
        : '当前浏览器没有英文语音包；可在平板设置里搜索「文字转语音」安装，或直接用 MiMo', voiceSelect),
    row('gauge', 'c-sky', '朗读语速', null, rateSelect),
    row('play', 'c-green', '试听', null,
      h('button', {
        class: 'btn sm', onclick: () => ttsAvailable()
          ? speak('Practice a little every day, and you will improve.')
          : toast('当前环境不支持语音合成'),
      }, icon('play', 16), '播放')));

  // ---------- 学习 ----------
  const goalInput = h('input', { type: 'number', min: '5', max: '120', value: s.settings.dailyGoalMin });
  goalInput.addEventListener('change', () => {
    const v = Math.max(5, Math.min(120, parseInt(goalInput.value) || 25));
    goalInput.value = v;
    update(st => { st.settings.dailyGoalMin = v; });
    toast(`每日目标：${v} 分钟`);
  });

  let wlPill, wlBtn = null;
  if (!wakeLockSupported()) {
    wlPill = h('span', { class: 'status-pill bad' }, '不支持');
  } else if (wakeLockActive()) {
    wlPill = h('span', { class: 'status-pill ok' }, '已激活');
  } else {
    wlPill = h('span', { class: 'status-pill warn' }, '未激活');
    wlBtn = h('button', { class: 'btn sm', onclick: async () => { await requestWakeLock(); renderAgain(); } }, '重新激活');
  }
  const pick = (key, options, label) => {
    const sel = h('select', {},
      ...options.map(([v, text]) => h('option', { value: v, ...(s.settings[key] === v ? { selected: '' } : {}) }, text)));
    sel.addEventListener('change', () => {
      update(st => { st.settings[key] = Number(sel.value); });
      toast(`${label}已保存`);
    });
    return sel;
  };
  const idleSelect = pick('idleMin', [[1, '1 分钟'], [2, '2 分钟'], [3, '3 分钟'], [5, '5 分钟'], [10, '10 分钟']], '进入单词模式时间');
  const autoSelect = pick('wordAutoSec', [[0, '不自动切换'], [30, '每 30 秒'], [45, '每 45 秒'], [60, '每 1 分钟'], [120, '每 2 分钟']], '单词切换间隔');
  const wst = s.words;

  // ---------- 显示：白天 / 夜间 ----------
  const themeSel = h('select', {},
    ...[['auto', '自动（按时间段）'], ['system', '跟随系统深色模式'], ['light', '始终白天'], ['dark', '始终夜间']].map(([v, t]) =>
      h('option', { value: v, ...((s.settings.theme || 'auto') === v ? { selected: '' } : {}) }, t)));
  themeSel.addEventListener('change', () => {
    update(st => { st.settings.theme = themeSel.value; });
    applyTheme();
    toast('主题已保存');
  });
  const hourSel = (key, from, to) => {
    const sel = h('select', {},
      ...Array.from({ length: to - from + 1 }, (_, i) => from + i).map(v =>
        h('option', { value: v, ...(s.settings[key] === v ? { selected: '' } : {}) }, `${String(v).padStart(2, '0')}:00`)));
    sel.addEventListener('change', () => {
      update(st => { st.settings[key] = Number(sel.value); });
      applyTheme();
      toast('白天时段已保存');
    });
    return sel;
  };
  const displayGroup = group('显示',
    row('sun', 'c-amber', '白天 / 夜间模式', `当前：${currentTheme() === 'light' ? '白天' : '夜间'}`, themeSel),
    row('timer', 'c-sky', '白天时段', '「自动」模式下，这段时间用白天配色，其余时间用夜间配色',
      hourSel('dayStart', 5, 10), h('span', { class: 'setting-dash' }, '至'), hourSel('dayEnd', 16, 22)));

  const learnGroup = group('学习',
    row('target', 'c-green', '每日目标', '单位：分钟，范围 5–120', goalInput),
    row('book', 'c-indigo', '无操作后显示单词', '多久没人点屏幕就自动进入单词模式（专注模式中不会跳转）', idleSelect),
    row('repeat', 'c-sky', '单词自动切换',
      `已掌握 ${wst.known.length} 个 · 不认识 ${wst.unknown.length} 个（已加入复习卡组）`, autoSelect),
    row('sun', 'c-amber', '屏幕常亮',
      wakeLockSupported() ? '需要在页面上点一下才能激活'
        : !window.isSecureContext
          ? '当前是 http 局域网地址，浏览器不允许网页阻止休眠。请在平板「设置 → 显示和亮度 → 休眠」选「永不」（或改用 https 地址）'
          : '浏览器不支持网页阻止休眠。请在平板「设置 → 显示和亮度 → 休眠」选「永不」',
      wlPill, wlBtn));

  // ---------- 数据 ----------
  const lastBk = s.settings.lastBackupHint;
  const importBox = h('textarea', { class: 'import-box', placeholder: '把备份 JSON 粘贴到这里…' });
  const dataGroup = group('数据',
    row('download', 'c-indigo', '导出备份',
      lastBk ? `上次导出：${new Date(lastBk).toLocaleDateString('zh-CN')}` : '还没有导出过，建议每周一次',
      h('button', {
        class: 'btn sm blue', onclick: () => {
          const blob = new Blob([exportJSON()], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `wallboard-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
          update(st => { st.settings.lastBackupHint = new Date().toISOString(); });
          toast('已导出备份文件');
        },
      }, icon('download', 16), '下载 JSON')),
    h('div', { class: 'row stack' },
      h('div', { class: 'row-top' },
        h('span', { class: 'r-ico c-rose' }, icon('upload', 20)),
        h('div', { class: 'r-label' }, '导入备份', h('small', {}, '会覆盖当前所有数据，请谨慎操作'))),
      importBox,
      h('div', { class: 'btn-row', style: 'margin-top:4px' },
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'btn sm danger', onclick: () => {
            if (!importBox.value.trim()) return toast('请先粘贴备份内容');
            const r = importJSON(importBox.value);
            if (r.ok) { toast('导入成功'); setTimeout(() => location.hash = '#standby', 800); }
            else toast('导入失败：' + r.error);
          },
        }, '确认导入并覆盖'))));

  // ---------- 挂墙建议 ----------
  const tips = h('section', {},
    h('div', { class: 'group-title' }, '挂墙使用建议'),
    h('div', { class: 'tips glass' },
      h('ol', {},
        h('li', {}, '在平板浏览器打开本站，从浏览器菜单选「添加到桌面」，之后从桌面图标打开即可全屏'),
        h('li', {}, '平板「设置 → 显示和亮度 → 休眠」选「永不」，挂墙时一直亮屏（建议常接电源）'),
        h('li', {}, '在平板设置里搜索「屏幕固定」并开启，可把屏幕固定在本页面，防止误触退出'),
        h('li', {}, `无操作 ${s.settings.idleMin} 分钟自动进入单词模式；专注模式进行中不会被打断`)),
      h('div', { class: 'credits' },
        '数据来源：单词表、音标、释义取自 ECDICT（MIT 许可，github.com/skywind3000/ECDICT）中标注雅思的词条；',
        '中英例句来自 Tatoeba（tatoeba.org，CC BY 2.0 FR），例句下方标注了句子编号；',
        '其余例句、辨析与搭配为本站原创。')));

  const wrap = h('div', { class: 'settings' },
    h('div', { class: 'mode-head' }, h('h1', {}, icon('settings', 24), '设置')),
    h('div', { class: 'settings-cols' },
      h('div', { class: 'settings-col' }, voiceGroup, learnGroup),
      h('div', { class: 'settings-col' }, displayGroup, dataGroup, tips)));
  root.append(wrap);

  function renderAgain() { root.innerHTML = ''; renderSettings(root); }
}
