#!/usr/bin/env python3
"""
gen_audio.py — 用小米 MiMo（mimo-v2.5-tts）为词库里每个单词预先生成发音，存成静态文件随网站发布。
生成后网页直接播放 audio/words/<单词>.mp3：不再调用接口、离线可用、点开即播。

输出：
  audio/words/<word>.mp3     每个单词一个文件
  audio/words/index.json     {"voice": "Dean", "words": [...已生成的单词...]}
  audio/s/<hash>.mp3         句子 / 短语 / 短文（文本见 tools/speech_texts.mjs），文件名为文本的 FNV-1a 64 位哈希
  audio/s/index.json         {"voice": "Dean", "ids": [...已生成的哈希...]}

用法：
  python3 tools/gen_audio.py                 # API Key 取自环境变量 MIMO_API_KEY 或 js/config.local.js
  VOICE=Milo python3 tools/gen_audio.py      # 换音色需删掉 audio/words 后重新生成
已存在的文件会跳过，可随时中断后重跑；词库更新后再跑一次即可补齐新词。
"""
import base64, concurrent.futures as cf, json, os, re, subprocess, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'audio', 'words')
OUT_S = os.path.join(ROOT, 'audio', 's')
ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions'
VOICE = os.environ.get('VOICE', 'Dean')
WORKERS = int(os.environ.get('WORKERS', '4'))


def api_key():
    k = os.environ.get('MIMO_API_KEY', '').strip()
    if k:
        return k
    try:
        src = open(os.path.join(ROOT, 'js', 'config.local.js'), encoding='utf-8').read()
        m = re.search(r"MIMO_API_KEY\s*=\s*['\"]([^'\"]+)", src)
        if m:
            return m.group(1).strip()
    except FileNotFoundError:
        pass
    sys.exit('缺少 API Key：设置环境变量 MIMO_API_KEY，或在 js/config.local.js 中填写')


def load_words():
    src = open(os.path.join(ROOT, 'js', 'words.js'), encoding='utf-8').read()
    return [json.loads(l.rstrip().rstrip(','))['w'] for l in src.split('\n') if l.startswith('{"w"')]


def safe_name(w):
    return re.sub(r'[^a-z0-9-]', '_', w.lower())


def text_id(text):
    """FNV-1a 64 位哈希（UTF-8），与 js/tts.js 中的 textId() 完全一致"""
    h = 0xcbf29ce484222325
    for b in text.encode('utf-8'):
        h ^= b
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return f'{h:016x}'


def too_long(audio, text):
    """MiMo 偶尔会在音频里多说内容。按约 6 KB/秒、每词约 0.55 秒估算，明显超长就重试"""
    words = max(1, len(text.split()))
    return len(audio) > 6200 * (0.55 * words + 1.6)


def synth_checked(key, text):
    best = None
    for _ in range(3):
        audio = synth(key, text)
        if best is None or len(audio) < len(best):
            best = audio
        if not too_long(audio, text):
            return audio
    return best


def synth(key, text):
    body = json.dumps({
        'model': 'mimo-v2.5-tts',
        'messages': [{'role': 'assistant', 'content': text}],
        'audio': {'format': 'mp3', 'voice': VOICE},
    }).encode()
    for attempt in range(6):
        req = urllib.request.Request(ENDPOINT, data=body, headers={
            'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            return base64.b64decode(data['choices'][0]['message']['audio']['data'])
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                sys.exit(f'API Key 无效（HTTP {e.code}）')
            time.sleep(2 ** attempt + 1)  # 429 / 5xx：退避重试
        except Exception:
            time.sleep(2 ** attempt + 1)
    raise RuntimeError(f'多次失败：{text}')


def main():
    key = api_key()
    os.makedirs(OUT, exist_ok=True)
    words = load_words()
    todo = [w for w in words if not os.path.exists(os.path.join(OUT, safe_name(w) + '.mp3'))]
    print(f'词库 {len(words)} 个，已有 {len(words) - len(todo)} 个，待生成 {len(todo)} 个（音色 {VOICE}，并发 {WORKERS}）', flush=True)

    def job(w):
        path = os.path.join(OUT, safe_name(w) + '.mp3')
        audio = synth_checked(key, w)
        tmp = path + '.part'
        with open(tmp, 'wb') as f:
            f.write(audio)
        os.replace(tmp, path)
        return w

    done, failed, t0 = 0, [], time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(job, w): w for w in todo}
        for fut in cf.as_completed(futs):
            try:
                fut.result()
                done += 1
            except Exception as e:
                failed.append(futs[fut])
            if done % 100 == 0 and done:
                rate = done / (time.time() - t0)
                print(f'  {done}/{len(todo)}  约剩 {int((len(todo) - done) / rate / 60)} 分钟', flush=True)

    have = [w for w in words if os.path.exists(os.path.join(OUT, safe_name(w) + '.mp3'))]
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'voice': VOICE, 'words': have}, f, separators=(',', ':'))
    size = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT) if n.endswith('.mp3'))
    print(f'单词完成：本次生成 {done}，失败 {len(failed)}{(" " + str(failed[:10])) if failed else ""}；'
          f'共 {len(have)} 个文件，{size / 1e6:.1f} MB', flush=True)
    sentences(key)


def sentences(key):
    texts = json.loads(subprocess.run(['node', os.path.join(ROOT, 'tools', 'speech_texts.mjs')],
                                      capture_output=True, text=True, check=True).stdout)
    os.makedirs(OUT_S, exist_ok=True)
    todo = [t for t in texts if not os.path.exists(os.path.join(OUT_S, text_id(t) + '.mp3'))]
    print(f'句子 {len(texts)} 条，已有 {len(texts) - len(todo)}，待生成 {len(todo)}', flush=True)

    def job(t):
        path = os.path.join(OUT_S, text_id(t) + '.mp3')
        audio = synth_checked(key, t)
        with open(path + '.part', 'wb') as f:
            f.write(audio)
        os.replace(path + '.part', path)

    done, failed, t0 = 0, [], time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(job, t): t for t in todo}
        for fut in cf.as_completed(futs):
            try:
                fut.result()
                done += 1
            except Exception:
                failed.append(futs[fut][:40])
            if done and done % 250 == 0:
                rate = done / (time.time() - t0)
                print(f'  {done}/{len(todo)}  约剩 {int((len(todo) - done) / rate / 60)} 分钟', flush=True)
    ids = [text_id(t) for t in texts if os.path.exists(os.path.join(OUT_S, text_id(t) + '.mp3'))]
    with open(os.path.join(OUT_S, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'voice': VOICE, 'ids': ids}, f, separators=(',', ':'))
    size = sum(os.path.getsize(os.path.join(OUT_S, n)) for n in os.listdir(OUT_S) if n.endswith('.mp3'))
    print(f'句子完成：本次生成 {done}，失败 {len(failed)}{(" " + str(failed[:5])) if failed else ""}；'
          f'共 {len(ids)} 个文件，{size / 1e6:.1f} MB', flush=True)


if __name__ == '__main__':
    main()
