#!/usr/bin/env python3
"""Build an offline Chinese dictionary for words used in Reading articles (ECDICT, MIT)."""
import csv
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'js/passages.js').read_text()
articles = [json.loads(line.rstrip(',')) for line in src.splitlines() if line.startswith('{"id"')]
words = {w.lower().replace('’', "'") for a in articles for p in a['paras'] for s in p
         for w in re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", s)}
entries = {}
with (ROOT / 'tools/.cache/ecdict.csv').open(newline='') as f:
    for row in csv.DictReader(f):
        word = row['word'].lower()
        if word in words and row['translation']:
            entries[word] = [row['phonetic'], row['translation']]
        for form in row['exchange'].split('/'):
            value = form.partition(':')[2].lower()
            if value in words and value not in entries and row['translation']:
                entries[value] = [row['phonetic'], row['translation']]
(ROOT / 'js/reading-dictionary.js').write_text(
    '// Reading vocabulary: ECDICT (MIT), https://github.com/skywind3000/ECDICT\n'
    + 'export const READING_DICTIONARY = ' + json.dumps(entries, ensure_ascii=False) + ';\n')
print(f'Built Chinese definitions for {len(entries)} of {len(words)} reading words.')
