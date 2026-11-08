"""python3 -I cu_verify.py <scenario> — checks the end product of a computer-use scenario on disk.
Prints one line per criterion (PASS/FAIL) and a score. Files are read from the cu-out folder."""
import csv, json, os, re, subprocess, sys, zipfile

OUT = '/private/tmp/claude-501/-Users-sidmishra-Desktop-Projects-generatorAI/c4d587b8-91f7-439b-b467-3bbea6ba535b/scratchpad/cu-out'
checks = []

def check(name, ok, detail=''):
    checks.append((name, bool(ok), detail))

def text_of(path):
    return subprocess.run(['textutil', '-convert', 'txt', '-stdout', path], capture_output=True, text=True).stdout

def s1():
    p = f'{OUT}/groceries.rtf'
    check('file saved', os.path.exists(p), p)
    if not os.path.exists(p): return
    raw = open(p, encoding='latin-1').read()
    txt = text_of(p)
    lines = [l.strip() for l in txt.splitlines() if l.strip()]
    check('title first line', bool(lines) and lines[0].lower().endswith('groceries'), lines[:1])
    items = ['Milk', 'Eggs', 'Bread', 'Apples', 'Coffee']
    check('all 5 items', all(any(i.lower() in l.lower() for l in lines) for i in items), lines[1:])
    before = raw.split('Groceries')[0] if 'Groceries' in raw else ''
    toggles = re.findall(r'\\b(0?)(?![a-z])', before)
    check('title bold', bool(toggles) and toggles[-1] == '', 'last bold toggle before the title')
    check('bulleted list', '\\ls1' in raw or 'listtext' in raw or bool(re.search(r'^[\u2022\-\*]', txt, re.M)), 'RTF list markers')

def s2():
    p = f'{OUT}/draft.txt'
    t = open(p).read() if os.path.exists(p) else ''
    check('typos fixed', all(w in t for w in ['notes', 'agreed', 'Friday']) and not any(w in t for w in ['notse', 'agred', 'Fridya']), repr(t))
    check('new last line', t.rstrip().splitlines()[-1:] == ['Owner: Sam'], repr(t[-40:]))
    check('plain text kept', not t.startswith('{\\rtf'), '')

def csv_rows(p):
    if os.path.isdir(p):
        check('a single CSV file', False, f'a folder: {sorted(os.listdir(p))}')
        return []
    with open(p, newline='', encoding='utf-8-sig') as f:
        return [[c.strip() for c in r] for r in csv.reader(f) if any(c.strip() for c in r)]

def num(s):
    try: return float(re.sub(r'[^0-9.\-]', '', s))
    except ValueError: return None

def s3():
    p = f'{OUT}/budget.csv'
    check('csv exported', os.path.exists(p), p)
    if not os.path.exists(p): return
    rows = csv_rows(p)
    check('header', rows and [c.lower() for c in rows[0][:4]] == ['item', 'qty', 'unit price', 'total'], rows[:1])
    want = {'pens': 15.0, 'notebooks': 13.0, 'stapler': 12.0, 'folders': 4.8}
    got = {r[0].lower(): num(r[3]) for r in rows[1:] if len(r) >= 4}
    check('row totals', all(abs((got.get(k) or -1) - v) < 0.001 for k, v in want.items()), got)
    gt = [num(r[3]) for r in rows if r and 'grand' in r[0].lower() and len(r) >= 4]
    check('grand total 44.8', bool(gt) and abs(gt[0] - 44.8) < 0.001, gt)

def s4():
    p = f'{OUT}/sales.pdf'
    check('pdf exported', os.path.exists(p), p)
    if os.path.exists(p):
        subprocess.run(['sips', '-s', 'format', 'png', p, '--out', f'{OUT}/sales-page1.png'], capture_output=True)
        check('rendered for review', os.path.exists(f'{OUT}/sales-page1.png'), f'{OUT}/sales-page1.png (judge visually: chart, title, 4 bars)')

def s5():
    p = f'{OUT}/flow.pdf'
    check('pdf exported', os.path.exists(p), p)
    if os.path.exists(p):
        subprocess.run(['sips', '-s', 'format', 'png', p, '--out', f'{OUT}/flow-page1.png'], capture_output=True)
        txt = subprocess.run(['mdls', '-name', 'kMDItemTextContent', p], capture_output=True, text=True).stdout
        check('rendered for review', os.path.exists(f'{OUT}/flow-page1.png'), f'{OUT}/flow-page1.png (judge visually: 3 labelled shapes, 2 arrows)')

def s6():
    p = f'{OUT}/report.docx'
    check('docx saved', os.path.exists(p), p)
    if not os.path.exists(p): return
    xml = zipfile.ZipFile(p).read('word/document.xml').decode('utf-8')
    plain = re.sub(r'<[^>]+>', ' ', xml)
    check('heading text', 'Quarterly Report' in plain, '')
    styles = zipfile.ZipFile(p).read('word/styles.xml').decode('utf-8') if 'word/styles.xml' in zipfile.ZipFile(p).namelist() else ''
    para = re.search(r'<w:p[ >](?:(?!</w:p>).)*Quarterly Report.*?</w:p>', xml, re.S)
    sid = re.search(r'w:pStyle w:val="([^"]+)"', para.group(0)) if para else None
    sname = re.search(r'w:styleId="%s".*?<w:name w:val="([^"]+)"' % re.escape(sid.group(1)), styles, re.S) if sid else None
    check('heading style', bool(sid) and ('heading' in sid.group(1).lower() or (sname and 'heading' in sname.group(1).lower())), sid.group(1) if sid else 'no style')
    check('paragraph', 'Revenue grew in every region.' in plain, '')
    check('table present', '<w:tbl>' in xml, '')
    cells = re.findall(r'<w:tc>.*?</w:tc>', xml, re.S)
    vals = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
    vals = [v for v in vals]
    check('table 3x3 values', vals[:9] == ['Region', 'Q1', 'Q2', 'North', '120', '140', 'South', '90', '110'], vals[:9])

def s8():
    p = f'{OUT}/fruit-sorted.csv'
    check('csv exported', os.path.exists(p), p)
    if not os.path.exists(p): return
    rows = csv_rows(p)
    check('header', rows and [c.lower() for c in rows[0][:2]] == ['fruit', 'count'], rows[:1])
    body = [(r[0], num(r[1])) for r in rows[1:] if len(r) >= 2]
    check('sorted desc', body == [('Cherry', 12), ('Elderberry', 9), ('Apple', 7), ('Date', 5), ('Banana', 3)], body)

def s9():
    p = f'{OUT}/calc-report.txt'
    check('file saved', os.path.exists(p), p)
    if not os.path.exists(p): return
    t = open(p, encoding='utf-8', errors='replace').read()
    lines = [l.strip() for l in t.splitlines() if l.strip()]
    check('plain text', not t.startswith('{\\rtf'), '')
    check('exactly two lines', len(lines) == 2, lines)
    tip = num(lines[0].split(':', 1)[1]) if lines and ':' in lines[0] else None
    hrs = num(lines[1].split(':', 1)[1]) if len(lines) > 1 and ':' in lines[1] else None
    check('Tip = 434', lines[:1] and lines[0].lower().startswith('tip:') and tip is not None and abs(tip - 434) < 0.001, lines[:1])
    check('Hours = 8760', len(lines) > 1 and lines[1].lower().startswith('hours:') and hrs is not None and abs(hrs - 8760) < 0.001, lines[1:2])

def s10():
    p = f'{OUT}/q3-review.pdf'
    check('pdf exported', os.path.exists(p), p)
    if not os.path.exists(p): return
    raw = open(p, 'rb').read()
    pages = len(re.findall(rb'/Type\s*/Page[^s]', raw))
    check('two pages', pages == 2, f'{pages} pages')
    subprocess.run(['sips', '-s', 'format', 'png', p, '--out', f'{OUT}/q3-page1.png'], capture_output=True)
    check('rendered for review', os.path.exists(f'{OUT}/q3-page1.png'), f'{OUT}/q3-page1.png (judge visually: title slide)')


def h1():
    p = f'{OUT}/offsite.docx'
    check('docx saved', os.path.exists(p), p)
    if not os.path.exists(p): return
    xml = zipfile.ZipFile(p).read('word/document.xml').decode('utf-8')
    paras = re.findall(r'<w:p[ >].*?</w:p>', xml, re.S)
    text = lambda x: re.sub(r'<[^>]+>', '', x).strip()
    head = next((x for x in paras if text(x) == 'Team Offsite'), None)
    check('heading text', head is not None, [text(x) for x in paras][:5])
    sid = re.search(r'w:pStyle w:val="([^"]+)"', head) if head else None
    check('Heading 1 style', bool(sid) and re.sub(r'[^a-z0-9]', '', sid.group(1).lower()) == 'heading1', sid.group(1) if sid else 'no style')
    items = ['Welcome', 'Roadmap review', 'Dinner']
    got = [x for x in paras if text(x) in items]
    check('three items in order', [text(x) for x in got] == items, [text(x) for x in paras])
    check('numbered list', len(got) == 3 and all('<w:numPr>' in x or 'ListNumber' in x for x in got), '')

def h2():
    p = f'{OUT}/sine.pdf'
    check('pdf exported', os.path.exists(p), p)
    if not os.path.exists(p): return
    check('is a PDF', open(p, 'rb').read(5) == b'%PDF-', '')
    subprocess.run(['sips', '-s', 'format', 'png', p, '--out', f'{OUT}/sine-page1.png'], capture_output=True)
    check('rendered for review', os.path.exists(f'{OUT}/sine-page1.png'), f'{OUT}/sine-page1.png (judge visually: a sine curve)')

def dims(f):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', f], capture_output=True, text=True).stdout
    return tuple(int(v) for v in re.findall(r'pixel(?:Width|Height): (\d+)', out))

def h3():
    p = f'{OUT}/badge-rotated.jpg'
    src = f'{OUT}/badge.png'
    check('jpeg exported', os.path.exists(p), p)
    check('original untouched', os.path.exists(src) and dims(src) == (500, 300), dims(src) if os.path.exists(src) else 'missing')
    if not os.path.exists(p): return
    check('is a JPEG', open(p, 'rb').read(3) == b'\xff\xd8\xff', '')
    check('rotated 90 (300x500)', dims(p) == (300, 500), dims(p))

def h4():
    p = f'{OUT}/answer.applescript'
    check('script saved', os.path.exists(p), p)
    if not os.path.exists(p): return
    raw = open(p, 'rb').read()
    check('plain text', not raw.startswith(b'FasdUAS'), raw[:8])
    lines = [l.strip() for l in raw.decode('utf-8', 'replace').replace('\r', '\n').splitlines() if l.strip()]
    check('exact two lines', lines == ['set total to 6 * 7', 'return total'], lines)


def g1():
    p = f'{OUT}/style-notes.txt'
    t = open(p, encoding='utf-8', errors='replace').read() if os.path.exists(p) else ''
    check('file kept', bool(t), p)
    check('every colour replaced', 'colour' not in t.lower() and t.lower().count('color') == 3, repr(t))
    check('rest unchanged', 'The palette guide' in t and t.rstrip().endswith('Ship it.'), repr(t[-40:]))
    check('plain text kept', not t.startswith('{\\rtf'), '')

def g4():
    p = f'{OUT}/hello.py'
    check('file saved', os.path.exists(p), p)
    if not os.path.exists(p): return
    lines = [l.rstrip() for l in open(p, encoding='utf-8', errors='replace').read().splitlines() if l.strip()]
    check('exact content', lines == ['print("hello")', 'print(2 + 3)'], lines)

def g5():
    p = f'{OUT}/badge.pdf'
    src = f'{OUT}/badge.png'
    check('pdf exported', os.path.exists(p), p)
    check('original untouched', os.path.exists(src) and dims(src) == (500, 300), dims(src) if os.path.exists(src) else 'missing')
    if os.path.exists(p):
        check('is a PDF', open(p, 'rb').read(5) == b'%PDF-', '')

def g6():
    p = f'{OUT}/roadmap.pdf'
    check('pdf exported', os.path.exists(p), p)
    if not os.path.exists(p): return
    raw = open(p, 'rb').read()
    pages = len(re.findall(rb'/Type\s*/Page[^s]', raw))
    check('two pages', pages == 2, f'{pages} pages')
    subprocess.run(['sips', '-s', 'format', 'png', p, '--out', f'{OUT}/roadmap-page1.png'], capture_output=True)
    check('rendered for review', os.path.exists(f'{OUT}/roadmap-page1.png'), f'{OUT}/roadmap-page1.png (judge visually: title slide "Roadmap")')

fn = {'G1': g1, 'G4': g4, 'G5': g5, 'G6': g6, 'H1': h1, 'H2': h2, 'H3': h3, 'H4': h4, 'S9': s9, 'S10': s10, 'S1': s1, 'S2': s2, 'S3': s3, 'S4': s4, 'S5': s5, 'S6': s6, 'S8': s8}.get(sys.argv[1])
if fn: fn()
for name, ok, detail in checks:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail if not ok or 'judge' in str(detail) else ''}")
if checks:
    print(f"SCORE {sum(ok for _, ok, _ in checks)}/{len(checks)}")
