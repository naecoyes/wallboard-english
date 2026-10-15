# WallBoard English

挂在墙上的平板常驻英语学习终端：待机仪表盘、碎片练习（5 分钟）、专注学习（25 分钟）、雅思单词模式，
短文阅读（Reading）、间隔复习、连续打卡、白天/夜间自动切换。纯前端静态网站，数据只保存在本机浏览器。

## 使用

- 用平板浏览器打开网址，菜单里选「添加到桌面」。
- 发音：设置 → 发音，填写小米 MiMo API Key（只存本机，导出备份不包含）；不填则用系统语音。
- 挂墙：平板「设置 → 显示和亮度 → 休眠」选「永不」，并开启「屏幕固定」。

## 本地运行

需要通过 http 打开（浏览器不允许 file:// 加载 ES 模块）：

```bash
python3 -m http.server 8931
```

可选：新建 `js/config.local.js`（已在 .gitignore 中，不要提交）：

```js
export const MIMO_API_KEY = 'sk-...';
```

## 重新生成词库

```bash
pip install opencc-python-reimplemented
python3 tools/build_words.py
```

## 重新生成短文

```bash
python3 tools/build_passages.py --list   # 抓取 VOA 并导出 tools/passages_en.json 供翻译
python3 tools/build_passages.py          # 合并 tools/passages_zh.json，生成 js/passages.js
python3 tools/gen_audio.py               # 补齐新句子的朗读音频
```

## 数据来源与许可

- 单词表、音标、释义、词形：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT License），取标注雅思（ielts）的词条
- 中英例句：[Tatoeba](https://tatoeba.org)（CC BY 2.0 FR），每条例句标注了 Tatoeba 句子编号
- 短文：[VOA Learning English](https://learningenglish.voanews.com)（VOA 自有内容属美国公有领域；部分文章改编自美联社等第三方报道），每篇附原文链接；「VOA audio」直接播放 VOA 服务器上的原声，中文翻译为本项目补充
- 其余例句、辨析与搭配为本项目原创
