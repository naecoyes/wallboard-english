#!/usr/bin/env python3
"""
build_passages.py — 从 VOA Learning English 抓取文章，生成短文模式的数据 js/passages.js

来源：https://learningenglish.voanews.com（VOA 自有内容属于美国公有领域；每篇都保留来源链接）
  B1 生活话题：Health & Lifestyle / Education Tips / Arts & Culture
  B2 雅思话题：Science & Technology / As It Is
每篇：标题、日期、原文链接、VOA 原声 mp3、按段落分好的句子、Words in This Story 词汇表
中文翻译放在 tools/passages_zh.json（{ 文章 id: [每段中文] }），段落数对不上会报错

用法：
  python3 tools/build_passages.py          # 抓取（缓存到 tools/.voa_cache/）并生成 js/passages.js
  python3 tools/build_passages.py --list   # 只列出选中的文章，并导出 tools/passages_en.json 供翻译
"""
import hashlib, html, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.voa_cache')
BASE = 'https://learningenglish.voanews.com'
CATS = [  # id, 名称, 级别, VOA 栏目编号
    ('health', 'Health & Lifestyle', 'B1', 955),
    ('education', 'Education Tips', 'B1', 7468),
    ('culture', 'Arts & Culture', 'B1', 986),
    ('science', 'Science & Technology', 'B2', 1579),
    ('news', 'As It Is', 'B2', 3521),
]
PER_LEVEL = 30
PER_CAT = 15
PAGES = 6
MIN_WORDS, MAX_WORDS, MIN_PARAS = 350, 800, 6


def fetch(path):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, hashlib.sha1(path.encode()).hexdigest() + '.html')
    if os.path.exists(f):
        return open(f, encoding='utf-8').read()
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + path, headers={'User-Agent': 'Mozilla/5.0'})
            text = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
            open(f, 'w', encoding='utf-8').write(text)
            time.sleep(0.3)
            return text
        except Exception as e:  # 网络偶发错误重试
            if attempt == 2:
                print('  fetch failed', path, e, file=sys.stderr)
                return ''
            time.sleep(2)


def clean(fragment):
    t = re.sub(r'<br\s*/?>', ' ', fragment)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t).strip()


ABBR = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'Prof.', 'Jr.', 'Sr.', 'Inc.', 'Co.', 'Corp.', 'Ltd.', 'No.', 'vs.',
        'U.S.', 'U.K.', 'U.N.', 'e.g.', 'i.e.', 'etc.', 'a.m.', 'p.m.', 'Gov.', 'Sen.', 'Rep.', 'Gen.', 'Lt.', 'Col.',
        'Jan.', 'Feb.', 'Aug.', 'Sept.', 'Sep.', 'Oct.', 'Nov.', 'Dec.', 'Ave.', 'Mt.', 'D.C.', 'Ph.D.', 'B.C.', 'A.D.']


def split_sentences(p):
    """固定规则分句（结果写进数据文件，网页端不再分句）"""
    t = p
    for i, a in enumerate(ABBR):
        t = t.replace(a, a.replace('.', f'\u0000{i}\u0001'))
    t = re.sub(r'\b([A-Z])\.(?=\s+[A-Z])', '\\1\u0002', t)  # 人名缩写 John F. Kennedy
    out, start = [], 0  # 按位置切分，保留句末引号
    for m in re.finditer(r'[.!?…][”"’)\]]*\s+(?=[“"‘(\[]?[A-Z0-9])', t):
        out.append(t[start:m.end()].strip())
        start = m.end()
    out.append(t[start:].strip())

    def restore(s):
        s = re.sub(r'\u0000\d+\u0001', '.', s)
        return s.replace('\u0002', '.')
    return [restore(s) for s in out if s.strip()]


SKIP = re.compile(r'^(no media source currently available|share|print|see comments|follow us|quiz\b|_+$|-{3,}|watch\b|listen\b)', re.I)
CREDIT = re.compile(r'(adapted (it|this story) for (voa )?learning english|reported (on )?this story|^i[’\']m [A-Z][a-z]+ [A-Z]|^and i[’\']m |^with .* i[’\']m |^(from|for) voa learning english|report\. i[’\']m |^and that[’\']s the .* report\.$)', re.I)


def parse_article(path):
    s = fetch(path)
    i = s.find('id="article-content"')
    if i < 0:
        return None
    body = s[i:]
    j = body.find('class="footer-toolbar"')
    body = body[:j] if j > 0 else body[:120000]
    title = clean(re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S).group(1)) if re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S) else ''
    date = (re.search(r'<time[^>]*datetime="([^"]+)"', s) or [None, ''])[1][:10]
    audio = re.search(r'https://voa-audio\.voanews\.eu/[^"&\s]+?(?<!_hq)\.mp3', s)
    k = re.search(r'Words in This Story', body, re.I)
    main, gloss_html = (body[:k.start()], body[k.end():]) if k else (body, '')
    paras, heads, head = [], [], ''
    for raw in re.findall(r'<p[^>]*>(.*?)</p>', main, re.S):
        stripped = raw.strip()
        if re.fullmatch(r'(<strong>|<b>)[^<]*(</strong>|</b>)', stripped):  # 整段加粗 = 小标题，挂到下一段
            head = clean(raw)
            continue
        if re.fullmatch(r'(<em>.*</em>|<i>.*</i>)', stripped, re.S):  # 整段斜体 = 署名 / 说明
            continue
        t = clean(raw)
        if not t or SKIP.match(t) or CREDIT.search(t) or len(t.split()) < 3:
            continue
        paras.append(t)
        heads.append(head)
        head = ''
    # 末尾常见：「I'm John Russell.」之类已去掉；再去掉结尾的空段
    gloss = []
    lines = [x for raw in re.findall(r'<p[^>]*>(.*?)</p>', gloss_html, re.S) for x in re.split(r'<br\s*/?>', raw)]
    for raw in lines:  # 有的文章整张词表在一个 <p> 里，用 <br> 分行
        t = clean(raw)
        m = re.match(r'^(.+?)\s*[–—-]\s*(n|v|adj|adv|prep|conj|pron|phrasal verb|idiom|phrase|expression|noun|verb|interj)\.?\s*(.+)$', t, re.I)
        if m:
            gloss.append([m.group(1).strip(), m.group(2).lower().rstrip('.') + '.', m.group(3).strip()])
    words = sum(len(p.split()) for p in paras)
    aid = int(re.search(r'(\d{6,8})\.html', path).group(1))
    return {'id': aid, 'title': title, 'date': date, 'url': BASE + path, 'audio': audio.group(0) if audio else '',
            'words': words, 'paras': [split_sentences(p) for p in paras], 'heads': heads, 'gloss': gloss}


def listing(z):
    links = []
    for p in range(PAGES):
        s = fetch(f'/z/{z}?p={p}')
        for l in re.findall(r'href="(/a/[^"]*?\d{7}\.html)"', s):
            if l not in links and 'lets-learn' not in l and 'quiz' not in l.lower():
                links.append(l)
    return links


def select():
    chosen = {'B1': [], 'B2': []}
    seen = set()
    for cid, name, level, z in CATS:
        n = 0
        for path in listing(z):
            if n >= PER_CAT:
                break
            a = parse_article(path)
            if not a or a['id'] in seen or not a['title']:
                continue
            if not (MIN_WORDS <= a['words'] <= MAX_WORDS) or len(a['paras']) < MIN_PARAS:
                continue
            sents = [s for p in a['paras'] for s in p]
            lvl = level
            if level == 'B1' and a['words'] / max(1, len(sents)) > 22:
                lvl = 'B2'
            a.update(cat=cid, level=lvl)
            seen.add(a['id'])
            chosen.setdefault(lvl, []).append(a)
            n += 1
        print(f'{name}: {n}', file=sys.stderr)
    out = []
    for lvl in ('B1', 'B2'):
        items = sorted(chosen[lvl], key=lambda a: a['date'], reverse=True)[:PER_LEVEL]
        out += items
    return out


def main():
    custom_path = os.path.join(ROOT, 'tools', 'custom_passages.json')
    custom_arts = json.load(open(custom_path, encoding='utf-8')) if os.path.exists(custom_path) else []
    arts = custom_arts + select()
    print(f'selected {len(arts)}: B1={sum(a["level"] == "B1" for a in arts)} B2={sum(a["level"] == "B2" for a in arts)}', file=sys.stderr)
    en = {str(a['id']): {'title': a['title'], 'heads': a['heads'], 'paras': [' '.join(p) for p in a['paras']]} for a in arts}
    if '--list' in sys.argv:
        json.dump(en, open(os.path.join(ROOT, 'tools', 'passages_en.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        for a in arts:
            print(a['id'], a['level'], a['cat'], a['words'], len(a['paras']), a['title'])
        return
    zh_path = os.path.join(ROOT, 'tools', 'passages_zh.json')
    zh = json.load(open(zh_path, encoding='utf-8')) if os.path.exists(zh_path) else {}
    bad = []
    for a in arts:
        z = zh.get(str(a['id']))
        if not z or len(z) != len(a['paras']):
            bad.append(f"{a['id']} ({len(z) if z else 0} zh vs {len(a['paras'])} paras)")
        a['zh'] = z or []
    if bad:
        sys.exit('翻译缺失或段落数不一致：\n  ' + '\n  '.join(bad))
    order = ['id', 'title', 'cat', 'level', 'date', 'url', 'audio', 'words', 'heads', 'paras', 'zh', 'gloss']
    lines = [
        '// passages.js — 由 tools/build_passages.py 自动生成，请勿手改',
        '// 文章来自 VOA Learning English（https://learningenglish.voanews.com），VOA 自有内容属美国公有领域；url 为原文链接',
        '// 中文翻译为本站补充（tools/passages_zh.json）',
        f'// 共 {len(arts)} 篇',
        'export const PASSAGE_CATS = ' + json.dumps([['custom', 'My articles', 'B2']] + [[c[0], c[1], c[2]] for c in CATS], ensure_ascii=False) + ';',
        'export const PASSAGES = [',
    ]
    lines += [json.dumps({k: a[k] for k in order}, ensure_ascii=False) + ',' for a in arts]
    lines.append('];')
    open(os.path.join(ROOT, 'js', 'passages.js'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('wrote js/passages.js', file=sys.stderr)


if __name__ == '__main__':
    main()
