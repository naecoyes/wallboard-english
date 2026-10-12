// speech_texts.mjs — 列出网站会朗读的所有句子 / 短语（不含单词本身，单词另存 audio/words）
// 供 tools/gen_audio.py 调用：node tools/speech_texts.mjs > 输出 JSON 数组
import { DAILY, PASSAGES, QUICK_QUESTIONS, SEED_DECK } from '../js/content.js';
import { WORDS } from '../js/words.js';
const out = new Set();
const add = t => { if (t && t.trim()) out.add(t.trim()); };
for (const w of WORDS) for (const e of w.ex) add(e[0]);          // 单词例句
for (const d of DAILY) add(d.en);                                  // 每日短语
for (const p of PASSAGES) {
  add(p.sentences.join(' '));                                      // 专注：整段播放
  p.sentences.forEach(add);                                        // 逐句跟读
  p.phrases.forEach(x => add(x.en));                               // 表达积累
  add(p.question);                                                 // 口语问题
}
QUICK_QUESTIONS.forEach(add);                                      // 快答
SEED_DECK.forEach(c => add(c.front));                              // 初始卡组
add('Practice a little every day, and you will improve.');         // 设置页试听
add('Hello! This is how I sound.');                                // 切换音色试听
process.stdout.write(JSON.stringify([...out]));
