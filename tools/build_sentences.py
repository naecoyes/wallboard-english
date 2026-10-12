#!/usr/bin/env python3
"""
build_sentences.py — 整理「日常用句」库，生成 js/sentences.js

来源：
  · Tatoeba 中英对照句（CC BY 2.0 FR，https://tatoeba.org）——取自 manythings.org 的 cmn-eng 句对（保留句子编号作为出处）
  · js/content.js 里本站原创的每日短语（DAILY）

整理规则：
  · 4–14 个词、以句号 / 问号 / 感叹号结尾，不含数字、引号、人名、国名、语言名
  · 用词限于最常用的约 3500 个词（ECDICT 词频），最多允许 1 个稍生僻的词
  · 去掉暴力 / 色情 / 政治 / 宗教等不适合日常学习的内容
  · 繁体译文转简体；英文与中文都去重
  · 按关键词归入 12 个生活场景，每个场景限量，优先口语化、长度适中、带 I / you / 问句的句子
  · 同一场景内按「由易到难」（词数、词频）排序

用法：python3 tools/build_sentences.py      （需要 tools/.cache/ecdict.csv 和 cmn.txt，缺少会自动下载）
"""
import csv, json, os, re, sys, urllib.request, zipfile, io, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
OUT = os.path.join(ROOT, 'js', 'sentences.js')
PER_SCENE = int(os.environ.get('PER_SCENE', '110'))
KW_CAP = int(os.environ.get('KW_CAP', '10'))

try:
    from opencc import OpenCC
    to_simp = OpenCC('t2s').convert
except ImportError:
    sys.exit('缺少 opencc：pip install opencc-python-reimplemented')

# ---------- 场景：id, 名称, 关键词（整词匹配，小写）----------
SCENES = [
    # 只用「能明确指向场景」的词；how / want / like / need / give 这类万能词不参与归类
    ('greet', 'Greetings & Small Talk', 'hello hi welcome introduce pleased thanks thank sorry excuse pardon goodbye bye congratulations cheers birthday'),
    ('home', 'Home & Family', 'home house family mother father mom dad parents brother sister son daughter wife husband baby kids grandmother grandfather room kitchen bed bedroom door window garden neighbor sofa'),
    ('food', 'Food & Dining', 'eat ate eating food lunch dinner breakfast hungry thirsty drink coffee tea water milk beer wine bread rice egg eggs meat fish fruit apple cake sugar salt restaurant menu delicious taste cook cooking meal soup salad pizza cheese juice'),
    ('shop', 'Shopping & Money', 'buy bought sell price cheap expensive pay paid cost money shop store market sale discount cash dollars dollar size wear dress shirt shoes hat coat jacket'),
    ('travel', 'Travel & Directions', 'travel trip train bus taxi cab airport plane flight ticket station hotel map street road straight drive driving arrive passport luggage subway'),
    ('work', 'Work & School', 'work working job office boss company meeting business busy manager colleague salary school class teacher student homework exam study test lesson university college'),
    ('health', 'Health & Body', 'doctor hospital sick pain headache fever medicine sleep sleepy healthy health tooth stomach cough'),
    ('feel', 'Feelings & Opinions', 'happy sad angry glad afraid worried nervous proud surprised excited bored love hate feel feeling believe agree disagree opinion'),
    ('weather', 'Time & Weather', 'weather rain raining rainy snow sunny cloudy windy hot cold warm cool tomorrow yesterday tonight morning afternoon evening weekend month clock hour minute'),
    ('phone', 'Phone & Plans', 'phone telephone message email number plan plans appointment schedule invite party'),
    ('help', 'Requests & Help', 'help favor borrow lend lost wait'),
    ('daily', 'Everyday Life', 'always usually often sometimes never every wake shower brush movie music book read newspaper television tv game walk exercise hobby'),
]
SCENE_IDS = [s[0] for s in SCENES]
KEYS = {s[0]: set(s[2].split()) for s in SCENES}
# 请求 / 求助场景：以礼貌请求句式开头也算
ILL_COLD = re.compile(r"\b(caught|catch|got|get over|bad|terrible|have a|had a|with a|for a|from a|suffering from)\b.*\bcold\b|\bcold medicine\b", re.I)
# 这些句型即使命中关键词也不适合放进日常用句（歧义 / 不自然）
WEIRD = re.compile(r"\b(tired of|sick and tired|speak ill|speaking ill|ill at ease|sleep on it|turn (off|on|out|down|up|red)|my turn|your turn|radio|disappearance|bawling|at any cost|pay attention|wish to be a|want to be a|be a doctor|cotton candy|honey|made of money|black market|dire need|certain amount|gas station|post office|difficult job|good company|brighter than|plain old|chip(ped)? in|bike|reasoning|sweater under)\b", re.I)
REQUEST_OPEN = re.compile(r"^(could you|can you|would you|will you|may i|can i|could i|do you mind|would you mind|please|i need your|i'd like to ask|let me)\b", re.I)
# 口语化开头：加分
SPOKEN_OPEN = re.compile(r"^(could you|can you|would you|do you|did you|are you|have you|i'd like|i'm|i'll|i've|let's|please|what time|where is|where's|how much|how about|excuse me|i don't|it's|that's|thank|sorry|i think|i hope|i can't|i have to|i want to|would you like|shall we|why don't)\b", re.I)

AVOID = re.compile(r"\b(hit|beat|punch|slap|fight|crazy|insane|ridiculous|moron|jerk|sucks|bastard|damn|kiss|break up|kill|killed|die|died|dead|death|murder|suicide|gun|shot|bomb|war|army|soldier|police|prison|jail|crime|steal|stole|thief|rape|sex|sexual|naked|nude|porn|drug|drugs|drunk|god|jesus|church|christian|muslim|islam|allah|bible|pray|president|government|minister|politic|politics|party member|communist|nazi|hitler|racist|fuck|shit|damn|bitch|ass|stupid|idiot|fat|ugly|hate you|shut up|devil|hell|cancer|aids|abortion|divorce|pregnant|gay|lesbian|tax|election|vote|king|queen|emperor|enemy|attack|terror|weapon|knife|blood|corpse|ghost|witch)\b", re.I)
NAMES = re.compile(r"\b(Tom|Mary|John|Jim|Bob|Ken|Alice|Boston|Japan|Japanese|China|Chinese|French|France|English|German|Germany|Spanish|Spain|Esperanto|Tokyo|Osaka|America|American|Canada|Canadian|Australia|London|Paris|Europe|Asia|Korea|Korean|Russia|Russian|Italy|Italian|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|January|February|March|April|June|July|August|September|October|November|December|Christmas|Mr|Mrs|Ms|Miss|Dr|Lucy|Anne|Betty|Mike|Peter|Paul|Jack|David|Susan|Linda|Taro|Yumi|Ken|Nancy|Judy|Tony|Sam|Bill|Smith|Brown|Jackson|Ziri|Taninna|Skura|Dan|Lisa|Emi|Hiroshi|Maria|Anna|Sarah)\b")


def load_blocklist():
    p = os.path.join(ROOT, 'tools', 'sentence_blocklist.txt')
    if not os.path.exists(p):
        return set()
    return {re.sub(r'[^a-z]', '', l.lower()) for l in open(p, encoding='utf-8') if l.strip() and not l.startswith('#')}


def load_pairs():
    path = os.path.join(CACHE, 'cmn.txt')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        data = urllib.request.urlopen('https://www.manythings.org/anki/cmn-eng.zip', timeout=120).read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            open(path, 'wb').write(z.read('cmn.txt'))
    out = []
    for line in open(path, encoding='utf-8'):
        p = line.rstrip('\n').split('\t')
        if len(p) < 3:
            continue
        m = re.search(r'#(\d+)', p[2])
        out.append((p[0].strip(), p[1].strip(), int(m.group(1)) if m else 0))
    return out


def main():
    rank = {}
    with open(os.path.join(CACHE, 'ecdict.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            try:
                fr = int(r['frq'] or 0)
            except ValueError:
                fr = 0
            if fr:
                rank[r['word'].lower()] = fr
    common = {w for w, f in rank.items() if f <= 3500}
    for w in "i'm i'll i've i'd it's that's he's she's we're they're you're you'll don't doesn't didn't can't won't isn't aren't wasn't weren't let's there's what's who's how's".split():
        common.add(w)

    blocked = load_blocklist()
    seen_en, seen_zh, cands = set(), set(), []
    for en, zh, tid in load_pairs():
        n = len(en.split())
        if not (4 <= n <= 14) or not re.search(r'[.?!]$', en):
            continue
        if re.search(r'\d|["“”()\[\]:;]', en) or NAMES.search(en) or AVOID.search(en) or WEIRD.search(en):
            continue
        toks = re.findall(r"[A-Za-z']+", en.lower())
        rare = [t for t in toks if t not in common and t.split("'")[0] not in common]
        if len(rare) > 1:
            continue
        zhs = to_simp(zh)
        if not re.search(r'[\u4e00-\u9fff]', zhs) or re.search(r'[A-Za-z]{3,}', zhs) or len(zhs) > 45:
            continue
        key = re.sub(r'[^a-z]', '', en.lower())
        if key in seen_en or zhs in seen_zh or key in blocked:
            continue
        seen_en.add(key); seen_zh.add(zhs)
        # 场景归属：命中关键词最多的场景（并列取靠前的）
        hits = {s: sum(1 for t in set(toks) if t in KEYS[s]) for s in SCENE_IDS}
        if REQUEST_OPEN.match(en):
            hits['help'] += 2
        if ILL_COLD.search(en):
            hits['health'] += 3
        best = max(SCENE_IDS, key=lambda s: (hits[s], -SCENE_IDS.index(s)))
        if hits[best] == 0:
            continue
        # 译文原本就是简体（没被 opencc 改动）的更可能出自简体母语者，略优先
        if zhs == zh:
            pass
        # 口语化评分：越高越优先
        score = 0
        if 6 <= n <= 11: score += 3
        elif n in (5, 12): score += 1
        if re.search(r"\b(i|you|we|let's|please|could|would|can|shall)\b", en.lower()): score += 2
        if en.endswith('?'): score += 1
        score += min(hits[best], 3)
        if SPOKEN_OPEN.match(en): score += 3
        if zhs == zh: score += 1
        if "'" in en: score += 1
        score -= len(rare)
        if n <= 4: score -= 2
        # 句子编号是出处；较小的编号多为早期人工精选（质量更稳）
        cands.append(dict(en=en, zh=zhs, scene=best, src=tid, n=n, score=score,
                          diff=n + 0.4 * len(rare) + 0.3 * sum(1 for t in toks if rank.get(t, 99999) > 1500)))

    by = collections.defaultdict(list)
    for c in cands:
        by[c['scene']].append(c)
    picked = []
    for s in SCENE_IDS:
        pool = sorted(by[s], key=lambda c: (-c['score'], c['src']))
        # 同一场景内避免扎堆：每个开头 2 词最多 4 条；同一个场景关键词（book / plan / party…）最多 9 条
        starts, kw_count, take = collections.Counter(), collections.Counter(), []
        for c in pool:
            k = ' '.join(c['en'].lower().split()[:2])
            if starts[k] >= 4:
                continue
            kws = [t for t in set(re.findall(r"[a-z']+", c['en'].lower())) if t in KEYS[s]]
            if kws and min(kw_count[t] for t in kws) >= KW_CAP:
                continue
            starts[k] += 1
            for t in kws:
                kw_count[t] += 1
            take.append(c)
            if len(take) == PER_SCENE:
                break
        take.sort(key=lambda c: (c['diff'], c['src']))
        picked += take
        print(f"{s:8s} 候选 {len(pool):5d}  选取 {len(take)}")

    # 本站原创每日短语
    node = os.popen(f'node -e "import(\'file://{ROOT}/js/content.js\').then(m=>console.log(JSON.stringify(m.DAILY)))"').read()
    daily = json.loads(node)
    have = {re.sub(r'[^a-z]', '', p['en'].lower()) for p in picked}
    extra = [dict(en=d['en'], zh=d['zh'], scene='essential', src=0, note=d.get('note', '')) for d in daily
             if re.sub(r'[^a-z]', '', d['en'].lower()) not in have]

    items = extra + [dict(en=c['en'], zh=c['zh'], scene=c['scene'], src=c['src']) for c in picked]
    for i, it in enumerate(items):
        it['id'] = i + 1
    scenes = [['essential', 'Essential Phrases']] + [[s[0], s[1]] for s in SCENES]
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// sentences.js — 由 tools/build_sentences.py 自动生成，请勿手改\n')
        f.write('// 句子来自 Tatoeba（CC BY 2.0 FR，https://tatoeba.org），src 为 Tatoeba 英文句编号；src=0 为本站原创\n')
        f.write(f'// 共 {len(items)} 条\n')
        f.write('export const SCENES = ' + json.dumps(scenes, ensure_ascii=False) + ';\n')
        f.write('export const SENTENCES = [\n')
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False, separators=(',', ':')) + ',\n')
        f.write('];\n')
    print(f'完成：{len(items)} 条（原创 {len(extra)}）→ {OUT}（{os.path.getsize(OUT) // 1024} KB）')


if __name__ == '__main__':
    main()
