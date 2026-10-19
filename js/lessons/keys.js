// keys.js — 课堂录音用哪个服务：有 Gemini Key 用 Gemini，否则用 MiMo
// Gemini Key 只存本机 localStorage（不进同步数据）；本地开发也可写在 js/config.local.js 的 GEMINI_API_KEY
import { get } from '../store.js';
import { mimoAuth } from '../tts.js';
import { DEFAULT_GEMINI, DEFAULT_LLM } from './api.js';
import { approvedEndpoint } from '../api-origins.js';

const KEY = 'wallboard-gemini-key';
let localGemini = '';
const ready = import('../config.local.js').then(m => { localGemini = (m.GEMINI_API_KEY || '').trim(); }).catch(() => {});

export const savedGeminiKey = () => localStorage.getItem(KEY) || '';
export function setGeminiKey(v) { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); }

export async function geminiAuth() {
  await ready;
  const key = savedGeminiKey().trim() || localGemini;
  return key ? { provider: 'gemini', key, base: approvedEndpoint('gemini') } : null;
}

/** 当前可用的服务（Gemini 优先），都没有返回 null */
export async function lessonAuth() {
  const g = await geminiAuth();
  if (g) return g;
  const m = await mimoAuth();
  return m ? { provider: 'mimo', ...m } : null;
}

export const modelFor = (auth) => auth.provider === 'gemini'
  ? (get().settings.geminiModel || '').trim() || DEFAULT_GEMINI
  : (get().settings.lessonModel || '').trim() || DEFAULT_LLM;
