#!/usr/bin/env python3
"""
build_words.py — 生成单词模式词库 js/words.js

数据来源（均为公开数据，按各自协议使用）：
  · 词表 / 音标 / 中文释义 / 词形变化 / 考试标签：ECDICT（MIT License）
      https://github.com/skywind3000/ECDICT —— 取 tag 含 "ielts" 的词条
  · 中英对照例句：Tatoeba（CC BY 2.0 FR）
      https://tatoeba.org —— 英文句 + 与之链接的中文翻译
  · tools/curated.json：本站原创编写的 71 个词（例句、辨析、搭配），优先保留

筛选规则：
  · ECDICT 标注雅思（ielts）的小写单词，去掉中考词（zk，太基础）、词形变化条目（如复数）
  · 必须有音标、释义，并且在 Tatoeba 中找得到至少 1 条中英例句
  · 按词频（ECDICT frq）从常用到少见排序

用法：
  pip install opencc-python-reimplemented     # 繁体例句转简体
  python3 tools/build_words.py                # 数据缓存在 tools/.cache（首次自动下载约 100MB）
  DATA_DIR=/path/to/cache python3 tools/build_words.py
"""
import bz2, collections, csv, json, os, re, shutil, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('DATA_DIR') or os.path.join(ROOT, 'tools', '.cache')
OUT = os.path.join(ROOT, 'js', 'words.js')
CURATED = os.path.join(ROOT, 'tools', 'curated.json')
MAX_EX = 3
EASY_COLLINS = 4  # 柯林斯星级 ≥ 此值视为简单词，不收录

SOURCES = {
    'ecdict.csv': 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
    'eng_sentences.tsv': 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
    'cmn_sentences.tsv': 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
    'cmn-eng_links.tsv': 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2',
}


def fetch():
    os.makedirs(DATA, exist_ok=True)
    for name, url in SOURCES.items():
        path = os.path.join(DATA, name)
        if os.path.exists(path):
            continue
        print('下载', url)
        tmp = path + ('.bz2' if url.endswith('.bz2') else '.part')
        urllib.request.urlretrieve(url, tmp)
        if url.endswith('.bz2'):
            with bz2.open(tmp, 'rb') as src, open(path, 'wb') as dst:
                shutil.copyfileobj(src, dst)
            os.remove(tmp)
        else:
            os.rename(tmp, path)


try:
    from opencc import OpenCC
    _cc = OpenCC('t2s')
    to_simp = _cc.convert
except ImportError:
    sys.exit('缺少 opencc：pip install opencc-python-reimplemented')


# ---------- ECDICT 字段处理 ----------
def to_ipa(p):
    """ECDICT 多为旧式 DJ 音标（ә / i / u / '），统一转成现行英式 IPA"""
    p = p.strip().replace('ә', 'ə')  # 西里尔字母 ә → IPA ə
    if not any(c in p for c in 'ɪʊːɜ'):
        p = p.replace('ə:', 'ɜː')
        for a, b in (('i:', 'iː'), ('u:', 'uː'), ('ɑ:', 'ɑː'), ('ɔ:', 'ɔː'), (':', 'ː')):
            p = p.replace(a, b)
        p = re.sub(r'i(?!ː)', 'ɪ', p)
        p = re.sub(r'u(?!ː)', 'ʊ', p)
        p = re.sub(r'ɔ(?![ːɪ])', 'ɒ', p)   # 旧式短元音 ɔ → ɒ
    p = p.replace('ɒː', 'ɔː').replace('ɒɪ', 'ɔɪ')  # ECDICT 个别条目把 ɔː / ɔɪ 写成 ɒ: / ɒi
    p = p.replace("'", 'ˈ').replace('.', 'ˌ').replace(',', 'ˌ').replace('g', 'ɡ')
    return f'/{p}/'


POS_MAP = {'a.': 'adj.', 'ad.': 'adv.', 'art.': 'art.', 'abbr.': 'abbr.'}


def parse_defs(tr):
    out = []
    for line in tr.replace('\\n', '\n').split('\n'):
        line = line.strip()
        if not line or line.startswith('['):  # [网络] [医] 等专业/网络释义不要
            continue
        m = re.match(r'^((?:[a-z]+\.\s*)+(?:&\s*[a-z]+\.\s*)?)(.*)$', line)
        pos, zh = (m.group(1).strip(), m.group(2)) if m else ('', line)
        pos = POS_MAP.get(pos, pos)
        items = []
        for x in re.split(r'[,，;；]', zh):
            x = re.sub(r'\[[^\]]*\]', '', x).strip()
            if x and x not in items:
                items.append(x)
        if items:
            out.append([pos, '；'.join(items[:4])])
        if len(out) == 3:
            break
    return out


FORM_LABEL = {'p': '过去式', 'd': '过去分词', 'i': '现在分词', '3': '三单', 's': '复数', 'r': '比较级', 't': '最高级'}


def parse_forms(ex):
    forms, seen = [], set()
    for part in (ex or '').split('/'):
        if ':' not in part:
            continue
        k, v = part.split(':', 1)
        if k in FORM_LABEL and v and (k, v) not in seen:
            seen.add((k, v))
            forms.append([FORM_LABEL[k], v])
    return forms


EXAM_TAGS = ['ielts', 'cet4', 'cet6', 'ky', 'toefl', 'gre']


def main():
    fetch()
    print('读取 ECDICT …')
    ecdict = {}
    with open(os.path.join(DATA, 'ecdict.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            ecdict[r['word']] = r

    def tags(r):
        return (r.get('tag') or '').split()

    def is_candidate(r):
        w = r['word']
        if 'ielts' not in tags(r) or 'zk' in tags(r):
            return False
        if not re.fullmatch(r'[a-z]{3,}(-[a-z]+)?', w):
            return False
        if not r['phonetic'] or not r['translation']:
            return False
        if re.search(r'(^|/)0:', r['exchange'] or ''):  # 本身是别的词的变形（复数、过去式…）
            return False
        if too_easy(r):
            return False
        return True

    def too_easy(r):
        """柯林斯 4–5 星 = 最常用的日常词（system、million、power…），对备考雅思意义不大，去掉"""
        try:
            return int(r.get('collins') or 0) >= EASY_COLLINS
        except ValueError:
            return False

    # ---------- Tatoeba 中英句对 ----------
    print('读取 Tatoeba …')
    eng, cmn = {}, {}
    with open(os.path.join(DATA, 'eng_sentences.tsv'), encoding='utf-8') as f:
        for line in f:
            i, _, t = line.rstrip('\n').split('\t', 2)
            eng[i] = t
    with open(os.path.join(DATA, 'cmn_sentences.tsv'), encoding='utf-8') as f:
        for line in f:
            i, _, t = line.rstrip('\n').split('\t', 2)
            cmn[i] = t
    pairs = collections.defaultdict(list)
    with open(os.path.join(DATA, 'cmn-eng_links.tsv')) as f:
        for line in f:
            c, e = line.split()
            if c in cmn and e in eng:
                pairs[e].append(c)
    index = collections.defaultdict(set)
    for e in pairs:
        for tok in set(re.findall(r"[a-z]+(?:-[a-z]+)?", eng[e].lower())):
            index[tok].add(e)
    print('可用中英句对：', len(pairs))

    def pick_zh(cids):
        # 优先原本就是简体的译文，其次最短
        cids = sorted(cids, key=lambda c: (to_simp(cmn[c]) != cmn[c], len(cmn[c]), int(c)))
        return cids[0], to_simp(cmn[cids[0]])

    def examples(word, forms, exclude=()):
        keys = {word} | {v.lower() for _, v in forms}
        cands = set()
        for k in keys:
            cands |= index.get(k, set())
        scored = []
        for e in cands:
            text = eng[e]
            n = len(text.split())
            s = abs(n - 11)
            if n < 5: s += 6
            if n > 22: s += 10
            if re.search(r'\b(Tom|Mary|John)\b', text): s += 3
            if '"' in text: s += 2
            scored.append((s, len(text), int(e), e))
        scored.sort()
        out, seen = [], {x.lower() for x in exclude}
        for *_, e in scored:
            t = eng[e]
            if t.lower() in seen:
                continue
            seen.add(t.lower())
            cid, zh = pick_zh(pairs[e])
            out.append([t, zh, int(e), int(cid)])
            if len(out) == MAX_EX:
                break
        out.sort(key=lambda x: len(x[0]))  # 短句在前
        return out

    def freq(r):
        try:
            v = int(r.get('frq') or 0)
        except ValueError:
            v = 0
        return v or 10 ** 9

    words = {}
    # ---------- ECDICT 雅思词 ----------
    for w, r in ecdict.items():
        if not is_candidate(r):
            continue
        forms = parse_forms(r['exchange'])
        defs = parse_defs(r['translation'])
        if not defs:
            continue
        ex = examples(w, forms)
        if not ex:
            continue
        words[w] = {
            'w': w, 'ipa': to_ipa(r['phonetic']), 'defs': defs, 'ex': ex,
            'forms': forms, 'tags': [t for t in EXAM_TAGS if t in tags(r)],
            'collins': int(r['collins'] or 0), '_frq': freq(r),
        }

    # ---------- 原创词条（优先，补充 Tatoeba 例句） ----------
    with open(CURATED, encoding='utf-8') as f:
        curated = json.load(f)
    for c in curated:
        w = c['w']
        r = ecdict.get(w, {})
        if r and too_easy(r):
            continue
        forms = parse_forms(r.get('exchange'))
        own = [[c['ex'][0], c['ex'][1], 0, 0], [c['ex2'][0], c['ex2'][1], 0, 0]]
        extra = examples(w, forms, exclude=[x[0] for x in own])[:MAX_EX - len(own)]
        words[w] = {
            'w': w, 'ipa': c['ipa'], 'defs': [[c['pos'], c['zh']]], 'ex': own + extra,
            'forms': forms, 'tags': [t for t in EXAM_TAGS if t in tags(r)] if r else ['ielts'],
            'collins': int(r.get('collins') or 0) if r else 0,
            'notes': c.get('notes', []), 'col': c.get('col', []), '_frq': freq(r) if r else 10 ** 9,
        }

    ordered = sorted(words.values(), key=lambda x: (x['_frq'], x['w']))
    for x in ordered:
        # 保留词典英文释义（词性 + 定义），最多展示前三项，不另行机器翻译
        definition = ecdict.get(x['w'], {}).get('definition', '') or ''
        x['enDefs'] = [line.strip() for line in definition.replace('\\n', '\n').splitlines() if line.strip()][:3]
        del x['_frq']
        if not x['forms']: del x['forms']
        if not x.get('notes'): x.pop('notes', None)
        if not x.get('col'): x.pop('col', None)

    n_tatoeba = sum(1 for x in ordered for e in x['ex'] if e[2])
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// words.js — 由 tools/build_words.py 自动生成，请勿手改（改 tools/curated.json 后重新生成）\n')
        f.write('// 词表/音标/释义/词形：ECDICT（MIT）https://github.com/skywind3000/ECDICT 中标注雅思（ielts）的词\n')
        f.write('// 例句：Tatoeba（CC BY 2.0 FR）https://tatoeba.org ，ex 每项为 [英文, 中文, 英文句ID, 中文句ID]；ID 为 0 表示本站原创\n')
        f.write(f'// 共 {len(ordered)} 词，Tatoeba 例句 {n_tatoeba} 条\n')
        f.write('export const WORDS = [\n')
        for x in ordered:
            f.write(json.dumps(x, ensure_ascii=False, separators=(',', ':')) + ',\n')
        f.write('];\n')
    print(f'完成：{len(ordered)} 词，Tatoeba 例句 {n_tatoeba} 条 → {OUT}（{os.path.getsize(OUT) // 1024} KB）')


if __name__ == '__main__':
    main()
