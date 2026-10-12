# WallBoard English

挂在墙上的平板常驻英语学习终端：待机仪表盘、碎片练习（5 分钟）、专注学习（25 分钟）、雅思单词模式，
间隔复习、连续打卡、白天/夜间自动切换。纯前端静态网站，数据只保存在本机浏览器。

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

## 数据来源与许可

- 单词表、音标、释义、词形：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT License），取标注雅思（ielts）的词条
- 中英例句：[Tatoeba](https://tatoeba.org)（CC BY 2.0 FR），每条例句标注了 Tatoeba 句子编号
- 其余例句、辨析与搭配为本项目原创
