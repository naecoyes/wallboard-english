# WallBoard English

挂在墙上的平板常驻英语学习终端：待机仪表盘、碎片练习（5 分钟）、专注学习（25 分钟）、雅思单词模式，
短文阅读（Reading）、课堂录音（Lessons）、间隔复习、连续打卡、白天/夜间自动切换。静态网站；学习数据先保存在本机，可选同步。课堂录音和转写只保存在本机。

## 使用

- 用平板浏览器打开网址，菜单里选「添加到桌面」。
- 发音：设置 → 发音，填写小米 MiMo API Key（只存本机，导出备份不包含）；不填则用系统语音。
- 挂墙：平板「设置 → 显示和亮度 → 休眠」选「永不」，并开启「屏幕固定」。

## 双用户与学习树

- 右上角头像可在男生、女生之间切换，支持修改昵称。两人的学习记录、XP、阅读进度和复习卡组独立；主题和语音配置共用。
- 升级前的本地记录及旧云端 `progress.json` 归入男生，女生从空白进度开始。旧文件保留；新版本分别同步 `progress-male.json` 和 `progress-female.json`。
- 首页右栏的树按「累计学习完整分钟 + XP」成长，阶段积分为 0 / 50 / 150 / 400 / 800 / 1500；不消耗积分。
- 导出备份包含两位用户，排除 API Key。旧单用户备份恢复到当前选中的用户，另一位用户保留。
- 切换会保存已学时间；外部学习须先确认结束。共用设备的两位学习者无需注册，这不是权限隔离或密码登录。
- 验证数据迁移与同步：`node tools/test_profiles.mjs`。

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

## 课堂录音与可靠性

- Lessons → Options 中设置 Gemini Key；它只保存在当前浏览器，不进入同步。没有 Gemini Key 时使用已配置的 MiMo。
- Gemini 的时间定位和说话人标签是模型结果，仍应核对；MiMo 的时间按段内文字估算。识别后的原话与纠错建议分开保存。
- 音频转换、切段和编码在 Worker 处理；顺序上传以降低峰值内存。长录音仍需整段 Web Audio 解码，60/90 分钟录音应在目标平板上验证。
- 课堂数据库升级自动保留旧录音、对话和笔记。分片保存、摘要列表、虚拟对话列表减少重复读写和页面负担。
- 暂停阻止后续请求；已经到达服务商的请求是否计费由服务商决定。删除等待本机任务停止，并保留删除标记以拒绝迟到写入。
- 本地 API 密钥配置不由 Service Worker 缓存，凭证只发送给 Google / Xiaomi 的固定官方接口。
- 同步按共同基线合并字段与卡片，保留独立修改；同一字段的冲突仍按更新时间选择。没有共同基线的旧数据、缺少明细的旧历史汇总无法完全还原。
- Cloudflare 服务代码在 `cloudflare/`；尚未填写 `CLOUD_SYNC_URL` 时使用 GitHub 同步。共享链接撤销会断开所有持有旧链接的设备，不提供单设备撤销。

## 测试与发布

```bash
node tools/check.mjs
node --test tests/*.mjs cloudflare/test/worker.test.js
node tools/test_profiles.mjs
node tools/test_lesson_transcript.mjs
RUN_BROWSER_TESTS=1 node --test --test-concurrency=1 tests/db.browser.test.mjs tests/app.browser.test.mjs
```

浏览器集成测试使用独立临时配置和模拟接口，不调用付费 API。macOS 默认使用已安装的 Google Chrome；其他环境设置 `CHROME_BIN`。仅在隔离的 CI 容器需要时设置 `CHROME_NO_SANDBOX=1`。
Actions 工作流已在本地准备；当前 GitHub 凭证缺少 `workflow` 权限，尚未上传启用。现可运行上述命令完成同样检查。发布后确认 Pages 部署成功、缓存版本更新，并在实际平板核对长录音的内存与识别效果。

## 数据来源与许可

- 单词表、音标、释义、词形：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT License），取标注雅思（ielts）的词条
- 中英例句：[Tatoeba](https://tatoeba.org)（CC BY 2.0 FR），每条例句标注了 Tatoeba 句子编号
- 短文：[VOA Learning English](https://learningenglish.voanews.com)（VOA 自有内容属美国公有领域；部分文章改编自美联社等第三方报道），每篇附原文链接；「VOA audio」直接播放 VOA 服务器上的原声，中文翻译为本项目补充
- 其余例句、辨析与搭配为本项目原创
