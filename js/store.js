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
    readingAutoSec: 60, // 短文自动翻段间隔，0 = 关闭
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
  reading: { id: null, pos: {}, done: [], level: 'all' }, // 短文：当前文章 / 各文章段落位置 / 读完的文章 id / 级别筛选
  audioOverrides: {}, // 发音纠错：单词 → 'mimo'（已重生成）/ 'system'（改用浏览器语音）
  updatedAt: 0,       // 最近一次内容变化的时间，同步时判断哪边更新
  seeded: false,
});

export const USERS = [{ id: 'male', name: '男生', avatar: '👨' }, { id: 'female', name: '女生', avatar: '👩' }];
let activeUser = 'male';
let users = { male: defaults(), female: defaults() };
try {
  const data = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (data?.format === 2 && data.users) {
    for (const { id } of USERS) users[id] = migrate(data.users[id] || {});
    activeUser = data.activeUser === 'female' ? 'female' : 'male';
    for (const { id } of USERS) {
      users[id].settings = { ...defaults().settings, ...data.settings };
      users[id].settingsAt = data.settingsAt || 0;
    }
  } else if (data) users.male = migrate(data);
} catch (e) { console.warn('Could not read saved data', e); }
let state = users[activeUser];
for (const { id } of USERS) users[id].settings = state.settings;

export const currentUserId = () => activeUser;
export const getUserState = (id) => {
  const disk = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (id !== activeUser && disk?.format === 2 && (disk.users?.[id]?.updatedAt || 0) > (users[id]?.updatedAt || 0)) {
    users[id] = migrate(disk.users[id]);
    users[id].settings = state.settings;
    users[id].settingsAt = state.settingsAt || 0;
  }
  return users[id];
};
function persist() {
  // A second tab may be studying as the other learner. Never overwrite its newer snapshot.
  const disk = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (disk?.format === 2) {
    for (const { id } of USERS) {
      if (id !== activeUser && (disk.users?.[id]?.updatedAt || 0) > (users[id].updatedAt || 0)) users[id] = migrate(disk.users[id]);
    }
    if ((disk.settingsAt || 0) > (state.settingsAt || 0)) {
      for (const { id } of USERS) { users[id].settings = { ...defaults().settings, ...disk.settings }; users[id].settingsAt = disk.settingsAt; }
    }
  }
  for (const { id } of USERS) { users[id].settings = state.settings; users[id].settingsAt = state.settingsAt || 0; }
  localStorage.setItem(KEY, JSON.stringify({ format: 2, activeUser, users, settings: state.settings, settingsAt: state.settingsAt || 0 }));
}
export function switchUser(id) {
  if (!USERS.some(u => u.id === id)) throw new Error('Unknown user');
  save(true);
  const previousId = activeUser;
  activeUser = id;
  state = users[id];
  resetSnapshots();
  try { persist(); } catch (e) {
    activeUser = previousId; state = users[activeUser]; resetSnapshots(); throw e;
  }
}
export function renameUser(id, name) {
  if (!users[id]) return;
  getUserState(id);
  users[id].profile.nickname = name.trim().slice(0, 24);
  users[id].updatedAt = Date.now();
  persist();
  saveHooks.forEach(f => f());
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
  out.reading = { ...d.reading, ...(data.reading || {}) };
  if (!out.reading.pos || typeof out.reading.pos !== 'object') out.reading.pos = {};
  if (!Array.isArray(out.reading.done)) out.reading.done = [];
  out.cards = Array.isArray(data.cards) ? data.cards : [];
  out.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  out.audioOverrides = data.audioOverrides && typeof data.audioOverrides === 'object' ? { ...data.audioOverrides } : {};
  return out;
}

export function get() { return state; }

// ---------- 学习记录：全部保留；90 天前的按「天 + 模式」合并成一条，文件不会无限变大 ----------
const KEEP_DAYS = 90;
/** 学习日（凌晨 4 点前算前一天），与 streak.js 的 studyDay 一致 */
function dayOf(d) {
  const x = new Date(d.getTime() - 4 * 3600e3);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const secondsOf = (r) => (Number.isFinite(r.seconds) ? r.seconds : (r.minutes || 0) * 60);

export function compactSessions(list, now = Date.now()) {
  const cutoff = dayOf(new Date(now - KEEP_DAYS * 864e5));
  const keep = [], groups = new Map();
  for (const r of list) {
    const day = r.studyDay || dayOf(new Date(r.date));
    if (day >= cutoff) { keep.push(r); continue; }
    const id = `agg:${day}:${r.mode}`;
    const g = groups.get(id) || { day, mode: r.mode, aggSec: 0, aggCount: 0, rawSec: 0, rawCount: 0 };
    if (r.timerId === id) { g.aggSec = Math.max(g.aggSec, secondsOf(r)); g.aggCount = Math.max(g.aggCount, r.count || 0); }
    else { g.rawSec += secondsOf(r); g.rawCount += 1; }
    groups.set(id, g);
  }
  // 同一天已合并过、另一台设备又带来原始记录时取较大值，不会重复累加
  for (const [id, g] of groups) {
    const seconds = Math.round(Math.max(g.aggSec, g.rawSec));
    const count = Math.max(g.aggCount, g.rawCount);
    keep.push({ timerId: id, studyDay: g.day, date: `${g.day}T12:00:00.000Z`, mode: g.mode, seconds, minutes: seconds / 60, count, result: `${count} sessions` });
  }
  return keep.sort((a, b) => a.date.localeCompare(b.date));
}

const saveHooks = [];
export const onSave = (fn) => saveHooks.push(fn);
let settingsSnap = JSON.stringify({ ...state.settings, mimoKey: '' });

/** 设置变化时记录时间，同步时用来判断哪台设备的设置更新 */
function touchSettings() {
  const snap = JSON.stringify({ ...state.settings, mimoKey: '' });
  if (snap !== settingsSnap) {
    settingsSnap = snap;
    const at = Date.now();
    for (const { id } of USERS) { users[id].settings = state.settings; users[id].settingsAt = at; }
  }
}

let contentSnap = JSON.stringify({ ...state, updatedAt: 0 });
/** 内容真的变了才更新 updatedAt（避免计时器每 5 秒保存一次就触发同步） */
function touchContent() {
  const snap = JSON.stringify({ ...state, updatedAt: 0 });
  if (snap === contentSnap) return false;
  contentSnap = snap;
  state.updatedAt = Date.now();
  return true;
}

export function save(silent = false) {
  touchSettings();
  const changed = touchContent();
  if (!changed && !silent) return;
  try { persist(); }
  catch (e) { console.warn('Save failed', e); }
  if (!silent) saveHooks.forEach(f => f());
}

/** 用合并后的数据整体替换（同步用） */
function resetSnapshots() {
  settingsSnap = JSON.stringify({ ...state.settings, mimoKey: '' });
  contentSnap = JSON.stringify({ ...state, updatedAt: 0 });
}
export function replaceState(next, { silent = false, userId = activeUser } = {}) {
  if (!users[userId]) throw new Error('Unknown user');
  const replacement = migrate(next);
  const shared = (replacement.settingsAt || 0) > (state.settingsAt || 0)
    ? { ...replacement.settings, mimoKey: state.settings.mimoKey || replacement.settings.mimoKey }
    : state.settings;
  const settingsAt = Math.max(replacement.settingsAt || 0, state.settingsAt || 0);
  users[userId] = replacement;
  for (const { id } of USERS) { users[id].settings = shared; users[id].settingsAt = settingsAt; }
  state = users[activeUser];
  resetSnapshots();
  try { persist(); } catch (e) { console.warn('Save failed', e); }
  if (!silent) saveHooks.forEach(f => f());
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
    s.sessions = compactSessions(s.sessions);
  });
}

/** 导出备份：去掉 API Key，避免备份文件泄露密钥 */
export function exportJSON() {
  for (const { id } of USERS) getUserState(id);
  const copy = JSON.parse(JSON.stringify({ format: 2, users, settings: state.settings, settingsAt: state.settingsAt || 0 }));
  copy.settings.mimoKey = '';
  for (const user of Object.values(copy.users)) user.settings.mimoKey = '';
  return JSON.stringify(copy, null, 2);
}

/** 导入 JSON，返回 {ok, error} */
export function importJSON(text) {
  const previous = structuredClone(users);
  try {
    const data = JSON.parse(text);
    if (typeof data !== 'object' || data === null) throw new Error('Not a valid backup object');
    const keepKey = state.settings.mimoKey;
    if (data.format === 2) {
      if (!data.users?.male || !data.users?.female) throw new Error('Backup must contain both users');
      const restored = {};
      for (const { id } of USERS) restored[id] = migrate(data.users[id]);
      const settings = { ...defaults().settings, ...data.settings, mimoKey: keepKey };
      for (const { id } of USERS) { restored[id].settings = settings; restored[id].settingsAt = Date.now(); restored[id].updatedAt = Date.now(); }
      users = restored;
      state = users[activeUser];
    } else {
      users[activeUser] = migrate(data);
      state = users[activeUser];
      state.settings.mimoKey = keepKey;
      for (const { id } of USERS) users[id].settings = state.settings;
    }
    const restoredAt = Date.now();
    state.updatedAt = restoredAt;
    for (const { id } of USERS) users[id].settingsAt = restoredAt;
    resetSnapshots();
    persist();
    saveHooks.forEach(f => f());
    return { ok: true };
  } catch (e) {
    users = previous; state = users[activeUser]; resetSnapshots();
    return { ok: false, error: String(e.message || e) };
  }
}
