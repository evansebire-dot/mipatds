#!/usr/bin/env python3
"""Regenerate MISSING-SHEETS.md / .csv — the list of sheets that 404 on Mipa's server.

These are every document in app/datasheets.json whose `size` is null (the PDF could not
be mirrored because Mipa's own server returns 404). Run from the repo root after a
re-scrape:  python scraper/Get-MissingSheets.py
"""
import json
import collections
import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'app', 'datasheets.json'), encoding='utf-8'))

rows = []
for p in d['products']:
    for doc in p['docs']:
        if doc.get('size') is None:
            rows.append((p['category'], p['group'], p['name'],
                         doc['type'], doc.get('lang', ''), doc['source']))
rows.sort(key=lambda r: (r[0], r[1], r[2], r[3]))

bycat = collections.Counter(r[0] for r in rows)
bytype = collections.Counter(r[3] for r in rows)

out = []
out.append('# Mipa Data Sheets — sheets that could not be mirrored')
out.append('')
out.append("These PDFs are linked from Mipa's product pages, but the file itself returns "
           "**404 / not found** on Mipa's own document server (mipa-paints.com). Because the "
           "source file is missing, it cannot be mirrored for offline use. In the app these "
           "sheets fall back to the live Mipa link (which also fails until Mipa republishes the file).")
out.append('')
out.append("Several of the URLs below are visibly malformed on Mipa's site (double slashes, a "
           "stray leading space) — that is the broken link as published, and is itself the likely "
           "cause of the 404.")
out.append('')
out.append('**Snapshot:** ' + d['generatedAt'] + ' · **' + str(len(rows)) +
           ' documents** across ' + str(len(set(r[2] for r in rows))) + ' products.')
out.append('')
out.append('| Category | Count |')
out.append('|---|---|')
for c in d['categories']:
    if bycat.get(c):
        out.append('| ' + c + ' | ' + str(bycat[c]) + ' |')
out.append('| **Total** | **' + str(len(rows)) + '** |')
out.append('')
out.append('Document types: ' + ', '.join(k + ' ' + str(v) for k, v in sorted(bytype.items())))
out.append('')
cur = None
for cat, grp, name, typ, lang, src in rows:
    if cat != cur:
        cur = cat
        out.append('## ' + cat)
        out.append('')
    out.append('- **' + name + '** — ' + typ + ' (' + lang + ')  ')
    out.append('  ' + src)
out.append('')
open(os.path.join(ROOT, 'MISSING-SHEETS.md'), 'w', encoding='utf-8').write('\n'.join(out))

with open(os.path.join(ROOT, 'MISSING-SHEETS.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['Category', 'Group', 'Product', 'Type', 'Lang', 'URL'])
    for r in rows:
        w.writerow(r)

print('wrote MISSING-SHEETS.md and MISSING-SHEETS.csv -', len(rows), 'rows')
