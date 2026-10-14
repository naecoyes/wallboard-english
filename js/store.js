// store.js — localStorage 存取、数据迁移、导出/导入
const KEY = 'wallboard-en-v1';

const defaults = () => ({
  version: 1,
  profile: { xp: 0, level: 1, streak: 0, bestStreak: 0, lastCheckIn: null },
  cards: [],        // { id, front, back, example, due, interval, ease, reps, lapses, added }
  sessions: [],     // { date, mode: 'micro'|'focus', minutes, result }
  settings: {
    dailyGoalMin: 25, voiceURI: null, rate: 0.95, lastBackupHint: null,
    idleMin: 2,        // 无操作多少分钟后自动进入单词模式
    sentenceAutoSec: 45, // 日常用句自动切换间隔，0 = 关闭
    wordAutoSec: 45,   // 单词模式自动切换间隔（0 = 不自动切换）
    wordAutoPlay: true, // 切换到新词时自动朗读
    theme: 'auto',     // auto 按时间段 / system 跟随系统 / light 白天 / dark 夜间
    palette: 'forest', // 配色主题，见 theme.js PALETTES
    dayStart: 7,       // 白天模式开始（时）
    dayEnd: 19,        // 白天模式结束（时）
    nightDim: 'auto',  // 深夜极暗模式：auto（23:00-06:00）/ on 始终开启 / off 关闭
    pixelShift: true,  // 防烧屏像素微移（每分钟轻微偏移 1-2px）
    motion: 'auto',    // 动画：auto（系统减少动态效果时用 subtle）/ full / subtle / off
    ttsProvider: 'mimo', // mimo 小米 MiMo（有 Key 时）/ system 系统语音
    mimoVoice: 'Dean', // 默认男声
    mimoKey: '',       // 只存在本机，导出备份时会被去掉
    mimoEndpoint: '',  // 留空 = https://api.xiaomimimo.com/v1/chat/completions
    ttsPrefetch: 'smart', // 预生成发音：smart 当前屏幕 + 下一个词（例句在有人操作时）/ all 全部 / off 关闭
    voiceRev: 2,       // 默认音色版本：旧数据 <2 时迁移到男声
  },
  words: { idx: 0, known: [], unknown: [] }, // 单词模式进度：当前位置 / 太简单 / 不认识
  sentences: { scene: 'all', pos: {}, known: [] }, // 日常用句：当前场景 / 各场景位置 / 已掌握的句子 id
  seeded: false,
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read saved data, starting fresh', e);
    return defaults();
  }
}

function migrate(data) {
  const d = defaults();
  const out = { ...d, ...data };
  out.profile = { ...d.profile, ...(data.profile || {}) };
  out.settings = { ...d.settings, ...(data.settings || {}) };
  // 一次性迁移：默认音色从女声 Mia 改为男声 Dean（之前没有 voiceRev 字段）
  if (!(data.settings && data.settings.voiceRev >= 2)) {
    out.settings.mimoVoice = 'Dean';
    out.settings.voiceRev = 2;
  }
  out.words = { ...d.words, ...(data.words || {}) };
  out.sentences = { ...d.sentences, ...(data.sentences || {}) };
  if (!out.sentences.pos || typeof out.sentences.pos !== 'object') out.sentences.pos = {};
  out.cards = Array.isArray(data.cards) ? data.cards : [];
  out.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return out;
}

export function get() { return state; }

const saveHooks = [];
export const onSave = (fn) => saveHooks.push(fn);
let settingsSnap = JSON.stringify({ ...state.settings, mimoKey: '' });

/** 设置变化时记录时间，同步时用来判断哪台设备的设置更新 */
function touchSettings() {
  const snap = JSON.stringify({ ...state.settings, mimoKey: '' });
  if (snap !== settingsSnap) { settingsSnap = snap; state.settingsAt = Date.now(); }
}

export function save(silent = false) {
  touchSettings();
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Save failed', e); }
  if (!silent) saveHooks.forEach(f => f());
}

/** 用合并后的数据整体替换（同步用） */
export function replaceState(next, { silent = false } = {}) {
  state = migrate(next);
  settingsSnap = JSON.stringify({ ...state.settings, mimoKey: '' });
  save(silent);
}

export function update(fn) { fn(state); save(); }

/** 增加 XP 并按 100 XP/级 升级 */
export function addXP(amount) {
  update(s => {
    s.profile.xp += amount;
    s.profile.level = Math.floor(s.profile.xp / 100) + 1;
  });
}

/** 记录一次会话 */
export function logSession(mode, minutes, result) {
  update(s => {
    s.sessions.push({ date: new Date().toISOString(), mode, minutes, result });
    // 只保留最近 400 条，防止无限膨胀
    if (s.sessions.length > 400) s.sessions = s.sessions.slice(-400);
  });
}

/** 导出备份：去掉 API Key，避免备份文件泄露密钥 */
export function exportJSON() {
  const copy = JSON.parse(JSON.stringify(state));
  copy.settings.mimoKey = '';
  return JSON.stringify(copy, null, 2);
}

/** 导入 JSON，返回 {ok, error} */
export function importJSON(text) {
  try {
    const data = JSON.parse(text);
    if (typeof data !== 'object' || data === null) throw new Error('Not a valid backup object');
    const keepKey = state.settings.mimoKey;
    state = migrate(data);
    if (!state.settings.mimoKey) state.settings.mimoKey = keepKey; // 备份里没有 Key 时保留本机的
    save();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
