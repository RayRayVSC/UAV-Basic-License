#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""0.0.1.0 投影片產生器。

用法：
    python build.py            產生全部頁面並量測、截圖
    python build.py --no-check 只產生，不量測

規則：
- pages/*.md 的檔名就是頁面規格：ch{章}p{頁}_{章節}_{短語意}[_{其他}].md
  例：ch2p33_3.1_Newtons_Laws.md → ch2p33_3.1_Newtons_Laws.html
- 檔頭 --- 之間為設定（title、description、main、sub、lead、type…），其後為內容框 HTML。
- type: custom 的頁面整頁自行維護（file: 指向本資料夾的 HTML），產生器只填前後頁連結並量測。
- 前後頁依（章, 頁）排序自動串接，第一頁的上一頁與最後一頁的下一頁為 #。
- 量測結果寫到 build/report.md，截圖在 build/shots/。任何一頁 FAIL 則結束碼為 1。
"""
import glob, html, io, json, os, re, subprocess, sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGES_DIR = os.path.join(ROOT, 'pages')
TPL_DIR = os.path.join(ROOT, '_template')
BUILD_DIR = os.path.join(ROOT, 'build')
LIMIT_TITLE = 144      # 標題框 y67–211
LIMIT_CONTENT = 421    # 內容框 y221–642（法規行另外固定在 y642–680，不計入）
LIMIT_CONTENT_FULL = 459  # quiz、blank：整個內容框 y221–680
STAGE = (1280, 720)

# 內容型別：載入的元件 CSS、附加的頁內腳本（檔案在 _template/）
TYPES = {
    'matrix': dict(css=['matrix.css'], script=None),
    'levels': dict(css=['levels.css'], script='type-levels.script.html'),
    'page':   dict(css=['page.css'], script=None),
    'quiz':   dict(css=['quiz.css'], script='type-quiz.script.html'),
    'cover':  dict(css=['cover.css'], script=None, template='cover.template.html'),
    'blank':  dict(css=['blank.css'], script=None),
    'custom': dict(css=[], script=None),
}
NAME_RE = re.compile(r'^ch(\d+)p(\d+)_([\d.]+)_(.+)$')
QUIZ_RE = re.compile(r'^ch(\d+)_Quiz_(\d+(?:\.\d+)?(?:-\d+\.\d+)?)(?:_(.+))?$')  # 隨堂考：無頁碼，自成序列


def sec_key(sec):
    """章節字串 → 排序鍵：'3.2' → (3, 2)；'3.5-3.6' → (3, 5)；'3'（整章綜合）→ (3, 999)。"""
    first = sec.split('-')[0]
    parts = [int(x) for x in first.split('.')]
    return tuple(parts) if len(parts) > 1 else (parts[0], 999)


def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)


def parse_page(path):
    name = os.path.splitext(os.path.basename(path))[0]
    m = NAME_RE.match(name)
    qm = None if m else QUIZ_RE.match(name)
    if not m and not qm:
        raise SystemExit('檔名不合規則：%s（應為 ch{章}p{頁}_{章節}_{短語意}[_{其他}].md 或 ch{章}_Quiz_{x.y}[_{其他}].md）' % name)
    text = read(path)
    if not text.startswith('---'):
        raise SystemExit('%s 缺少檔頭 ---' % name)
    parts = text.split('\n---', 1)
    if len(parts) < 2:
        raise SystemExit('%s 檔頭沒有結尾 ---' % name)
    head, body = parts[0][3:], parts[1].lstrip('\n')
    fm = {}
    for line in head.splitlines():
        if ':' in line:
            k, v = line.split(':', 1)
            fm[k.strip()] = v.strip()
    typ = fm.get('type', '')
    if typ not in TYPES:
        raise SystemExit('%s 的 type「%s」未登記，可用：%s' % (name, typ, ', '.join(TYPES)))
    if m:
        return dict(name=name, ch=int(m.group(1)), p=int(m.group(2)), sec=m.group(3), slug=m.group(4), chain='main',
                    fm=fm, body=body, type=typ, out=name + '.html')
    return dict(name=name, ch=int(qm.group(1)), p=None, sec=qm.group(2), slug='Quiz', chain='quiz', qkey=(int(qm.group(1)),) + sec_key(qm.group(2)) + ((qm.group(3) or ''),),
                fm=fm, body=body, type=typ, out=name + '.html')


def load_pages():
    pages = [parse_page(p) for p in sorted(glob.glob(os.path.join(PAGES_DIR, '*.md')))]
    for pg in pages:
        pg['file'] = pg['fm'].get('file', pg['out']) if pg['type'] == 'custom' else pg['out']
    off = [p for p in pages if p['type'] == 'blank']
    for p in off:
        p['prev'] = p['next'] = '#'; p['chain'] = 'off'
    main = sorted([p for p in pages if p['chain'] == 'main' and p['type'] != 'blank'], key=lambda x: (x['ch'], x['p']))
    quiz = sorted([p for p in pages if p['chain'] == 'quiz'], key=lambda x: x['qkey'])
    seen = {}
    for pg in main:
        key = (pg['ch'], pg['p'])
        if key in seen:
            raise SystemExit('頁碼重複：%s 與 %s' % (seen[key], pg['name']))
        seen[key] = pg['name']
    # 隨堂考依章節號接進教學序列：ch{N}_Quiz_{sec} 接在第 N 章章節 sec 的最後一頁之後；
    # sec 只有一層（如「2」）時接在該大節（2.x）的最後一頁之後。沒有對應教學頁的隨堂考自成一條序列。
    def major(x): return x.split('-')[0].split('.')[0]
    def in_range(psec, qsec):
        if '-' not in qsec: return False
        try:
            a, b = qsec.split('-'); a = tuple(int(v) for v in a.split('.')); b = tuple(int(v) for v in b.split('.'))
            p = tuple(int(v) for v in psec.split('-')[0].split('.'))
        except ValueError:
            return False
        return a <= p[:len(a)] <= b if len(p) >= len(a) else False
    linked, loose = [], []
    for qz in quiz:
        idx = None
        for i, pg in enumerate(main):
            if pg['ch'] != qz['ch'] or pg['type'] == 'blank': continue
            if pg['sec'] == qz['sec'] or ('.' not in qz['sec'] and '-' not in qz['sec'] and major(pg['sec']) == qz['sec']) or in_range(pg['sec'], qz['sec']):
                idx = i
        (linked if idx is not None else loose).append((idx, qz))
    combined = []
    for i, pg in enumerate(main):
        combined.append(pg)
        combined += [qz for j, qz in sorted(linked, key=lambda t: t[1]['qkey']) if j == i]
    loose_chain = [qz for _, qz in sorted(loose, key=lambda t: t[1]['qkey'])]
    for chain in (combined, loose_chain):
        for i, pg in enumerate(chain):
            pg['prev'] = chain[i - 1]['file'] if i > 0 else '#'
            pg['next'] = chain[i + 1]['file'] if i < len(chain) - 1 else '#'
            pg['chain'] = 'main' if chain is combined else 'quiz'
    # 檔頭 prev: / next: 可覆寫連結（例如最後一頁的下一頁接到教材外的網頁，相對路徑從本資料夾起算）
    for pg in combined + loose_chain + off:
        for k in ('prev', 'next'):
            if pg['fm'].get(k, '').strip(): pg[k] = pg['fm'][k].strip()
    return combined + loose_chain + off


_BANKS = {}


def load_bank(rel, var):
    """讀題庫 JS（const <var> = {...};），快取。"""
    key = (rel, var)
    if key not in _BANKS:
        text = read(os.path.join(ROOT, rel))
        m = re.search(r'const\s+%s\s*=\s*(\{.*\})\s*;?\s*$' % var, text, re.S)
        if not m:
            raise SystemExit('題庫格式不符：%s（找不到 const %s = {...}）' % (rel, var))
        _BANKS[key] = json.loads(m.group(1))
    return _BANKS[key]


DICE_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3"/><circle cx="6.5" cy="6.5" r="1.4"/><circle cx="13.5" cy="6.5" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="6.5" cy="13.5" r="1.4"/><circle cx="13.5" cy="13.5" r="1.4"/></svg>'


def quiz_card(q, qid, exp=''):
    opts = ''.join('<button type="button" class="opt" data-opt="%s"><span class="k">%s</span><span>%s</span></button>' % (k, k.upper(), html.escape(q['options'][k])) for k in 'abcd')
    total = len(q['description']) + sum(len(v) for v in q['options'].values())
    cls = 'qcard long xlong' if (len(q['description']) > 100 or total > 170) else ('qcard long' if (len(q['description']) > 60 or total > 120) else 'qcard')
    return ('      <section class="%s" data-qid="%s" data-answer="%s"><p class="q">%s</p><div class="opts">%s</div>%s</section>'
            % (cls, qid, q['answer'], html.escape(q['description']), opts, ('<p class="explain">%s</p>' % html.escape(exp)) if exp else ''))


def quiz_pool(pg):
    """讀檔頭 questions 題池，回傳 [(qid, q, explain)]。"""
    fm = pg['fm']
    bank = load_bank(fm.get('bank', 'bank/data_pro.js'), fm.get('bank_var', 'dataPro'))
    ids = [x.strip() for x in fm.get('questions', '').split(',') if x.strip()]
    if not ids:
        raise SystemExit('%s：quiz 頁需要 questions: Q1, Q2, …' % pg['name'])
    pool = []
    for qid in ids:
        q = bank['data'].get(qid)
        if not q:
            raise SystemExit('%s：題庫裡沒有 %s' % (pg['name'], qid))
        pool.append((qid, q, fm.get('explain_' + qid, '')))
    return pool


def render_quiz(pg):
    """type: quiz：整個題池以 JSON 嵌入，預先產出前 show 題；開頁後由 quiz.js 隨機抽題。"""
    fm = pg['fm']
    pool = quiz_pool(pg)
    show = min(int(fm.get('show', '5')), len(pool))
    cards = [quiz_card(q, qid, exp) for qid, q, exp in pool[:show]]
    data = [dict(id=qid, description=q['description'], options=q['options'], answer=q['answer'], explain=exp) for qid, q, exp in pool]
    pool_json = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
    summary = ('      <aside class="qsum" aria-label="計分"><p class="score"><b id="quiz-score">0</b>/ <span id="quiz-total">%d</span></p><p class="hint" id="quiz-hint">點選項作答，答完自動計分</p>'
               '<div class="qbtns"><button type="button" id="quiz-dice" class="dice" title="從題池 %d 題隨機抽換">%s隨機問題</button>'
               '<button type="button" id="quiz-reveal">顯示全部答案</button><button type="button" id="quiz-reset">重做</button></div></aside>' % (show, len(pool), DICE_SVG))
    body = ('    <div class="quiz" data-show="%d">\n' % show) + '\n'.join(cards) + '\n' + summary + '\n    </div>\n'
    body += '    <script type="application/json" id="quiz-pool">%s</script>' % pool_json
    if pg['body'].strip():
        body += '\n' + pg['body'].rstrip('\n')
    return body


def foot_link(spec):
    """頁尾按鈕（下一頁左邊）：front matter `foot_link: 標籤 | 連結`，開新分頁。"""
    if not spec.strip(): return ''
    if '|' not in spec: raise SystemExit('foot_link 格式：標籤 | 連結')
    label, href = [x.strip() for x in spec.split('|', 1)]
    return '      <a class="foot-link" href="%s" target="_blank" rel="noopener">%s</a>\n' % (html.escape(href, quote=True), label)


def render(pg, tpl):
    fm = pg['fm']
    t = TYPES[pg['type']]
    if pg['type'] == 'quiz':
        pg = dict(pg, body=render_quiz(pg))
    css = list(t['css']) + [c.strip() for c in fm.get('css', '').split(',') if c.strip()]
    css_links = ''.join('  <link rel="stylesheet" href="%s">\n' % c for c in css)
    scripts = read(os.path.join(TPL_DIR, t['script'])) if t['script'] else ''
    main, sub = fm.get('main', ''), fm.get('sub', '')
    values = {
        'page_title': fm.get('title') or '%s－%s｜投影片版（固定 1280×720）' % (main, sub),
        'description': html.escape(fm.get('description') or re.sub(r'<[^>]+>', '', fm.get('lead', '')), quote=True),
        'component_css': css_links,
        'title_main': main, 'title_sub': sub, 'title_lead': fm.get('lead', ''),
        'content': pg['body'].rstrip('\n'),
        'prev_href': pg['prev'], 'next_href': pg['next'],
        'extra_scripts': scripts,
        'foot_link': foot_link(fm.get('foot_link', '')),
    }
    out = tpl
    for k, v in values.items():
        out = out.replace('{{%s}}' % k, v)
    left = re.findall(r'\{\{[a-z_]+\}\}', out)
    if left:
        raise SystemExit('範本有未填的插槽：%s' % left)
    return out


def inject_nav(path, prev, nxt):
    """custom 頁：只換前後頁連結。"""
    h = read(path)
    h2 = re.sub(r'(<a class="nav-btn nav-prev" href=")[^"]*(")', r'\g<1>%s\2' % prev, h, count=1)
    h2 = re.sub(r'(<a class="nav-btn nav-next" href=")[^"]*(")', r'\g<1>%s\2' % nxt, h2, count=1)
    if '<a class="nav-btn nav-prev"' not in h or '<a class="nav-btn nav-next"' not in h:
        raise SystemExit('%s 缺少標準頁尾翻頁連結（<a class="nav-btn nav-prev/nav-next" href=…>）' % os.path.basename(path))
    if h2 != h:
        write(path, h2)
        return True
    return False


# ---------- 量測 ----------
MEASURE_JS = r"""
<div id="__m" hidden></div><script>
(function(){var o={};function R(e){return e?e.getBoundingClientRect():null}
var h1=document.querySelector('.slide-head h1'),ld=document.querySelector('.title-lead');
if(h1&&ld){o.title_used=Math.round(R(ld).bottom-R(h1).top);o.lead_lines=Math.round(R(ld).height/27);o.title_overflow=h1.scrollWidth>h1.clientWidth+1}
var sc=document.querySelector('.slide-content');
var np=R(document.querySelector('.nav-prev')),nn=R(document.querySelector('.nav-next'));
o.has_nav=!!(np&&nn);
if(sc){var kids=[].slice.call(sc.children).filter(function(e){return e.tagName!=='SCRIPT'&&e.tagName!=='STYLE'&&!e.matches('p.tip,p.levels-tip')&&R(e).height>0});var mb=0;kids.forEach(function(e){mb=Math.max(mb,R(e).bottom)});o.content_used=kids.length?Math.round(mb-R(sc).top):0;
 var ov=[];sc.querySelectorAll('.lv-cell,.m-cell,.card,.card li,.qcard,.opt').forEach(function(c){if(c.scrollHeight>c.clientHeight+1||c.scrollWidth>c.clientWidth+1)ov.push(c.textContent.trim().slice(0,14))});o.overflow=ov;
 var col=[];function hit(r,label){[np,nn].forEach(function(n){if(n&&r.width&&r.height&&r.left<n.right&&r.right>n.left&&r.top<n.bottom&&r.bottom>n.top)col.push(label)})}
 var w=document.createTreeWalker(sc,NodeFilter.SHOW_TEXT);var t;while((t=w.nextNode())){if(!t.nodeValue.trim())continue;var rg=document.createRange();rg.selectNodeContents(t);var rs=rg.getClientRects();for(var i=0;i<rs.length;i++)hit(rs[i],t.nodeValue.trim().slice(0,12))}
 sc.querySelectorAll('img,svg,canvas,video').forEach(function(e){hit(R(e),e.tagName)});
 o.nav_collision=col.slice(0,5);
 var tips=[];sc.querySelectorAll('p.tip,p.levels-tip').forEach(function(t){var tr=document.createRange();tr.selectNodeContents(t);var th=tr.getBoundingClientRect().height;if(th>22)tips.push(Math.round(th))});o.tip_lines=tips;
 var nt=document.querySelector('.nav-prev .nav-text');var navTop=nt?R(nt).top:1e9;var low=[];
 function lowHit(r,el,label){if(r.width&&r.height&&r.bottom>navTop+0.5&&!(el.closest&&el.closest('p.tip')))low.push(label+'('+Math.round(r.bottom)+')')}
 var w2=document.createTreeWalker(sc,NodeFilter.SHOW_TEXT);var t2;while((t2=w2.nextNode())){if(!t2.nodeValue.trim())continue;var rg2=document.createRange();rg2.selectNodeContents(t2);var rs2=rg2.getClientRects();for(var j=0;j<rs2.length;j++)lowHit(rs2[j],t2.parentElement,t2.nodeValue.trim().slice(0,12))}
 sc.querySelectorAll('img,svg,canvas,video').forEach(function(e){lowHit(R(e),e,e.tagName)});
 o.below_nav=low.slice(0,5);o.nav_top=Math.round(navTop)}
o.doc_title=document.title;
document.getElementById('__m').textContent='MEASURE|'+JSON.stringify(o);
})();
</script>
"""


QUIZ_CARD_MAX = 150  # 單卡高度提醒門檻：超過的題目只能和矮題配對，抽題時較難放進版面


def check_quiz_pool(browser, pg):
    """把題池全部題目排成卡片量高度，回傳超過上限的 (qid, 高度)。"""
    pool = quiz_pool(pg)
    cards = '\n'.join(quiz_card(q, qid, exp) for qid, q, exp in pool)
    h = ('<!doctype html><html><head><meta charset="utf-8"><base href="%s"><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="slide.css"><link rel="stylesheet" href="quiz.css">'
         '<style>.slide-content{position:static!important;width:1056px;margin:0 auto}html,body{overflow:auto!important;height:auto!important}.quiz{display:block!important}.qcard{width:521px;margin:0 0 8px}</style></head><body>'
         '<main class="stage"><section class="slide-content"><div class="quiz">%s</div></section></main>'
         '<div id="__m" hidden></div><script>var o=[];document.querySelectorAll(".qcard").forEach(function(c){o.push([c.dataset.qid,Math.round(c.getBoundingClientRect().height)])});'
         'document.getElementById("__m").textContent="POOL|"+JSON.stringify(o);</script></body></html>') % (file_url(ROOT + '/'), cards)
    tmp_dir = os.path.join(BUILD_DIR, 'tmp'); os.makedirs(tmp_dir, exist_ok=True)
    tmp = os.path.join(tmp_dir, pg['name'] + '_pool.html'); write(tmp, h)
    cmd = [browser, '--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1280,900', '--virtual-time-budget=1500', '--dump-dom', file_url(tmp)]
    out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=90).stdout.decode('utf-8', 'ignore')
    m = re.search(r'POOL\|(\[.*?\])</div>', out, re.S)
    if not m:
        return [('量測失敗', 0)]
    return [(qid, hh) for qid, hh in json.loads(html.unescape(m.group(1))) if hh > QUIZ_CARD_MAX]


def sub_has_section(pg):
    """副標必須以檔名的章節段開頭；合併節可寫「3.5 到 3.6」；整章綜合可寫「第 3 章」。"""
    sub = pg['fm'].get('sub', '').strip().replace(' 到 ', '-')
    sec = pg['sec']
    if sub.startswith(sec + ' ') or sub.startswith(sec + '-') or sub == sec:
        return True
    if '.' not in sec and '-' not in sec and sub.startswith('第 %s 章' % sec):
        return True
    return False


def find_browser():
    for p in [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
              r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
              r'C:\Program Files\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']:
        if os.path.exists(p):
            return p
    return None


def file_url(path):
    return 'file:///' + quote(path.replace('\\', '/'), safe='/:')


pg_tmp = {}


def measure(browser, name, html_path):
    tmp_dir = os.path.join(BUILD_DIR, 'tmp'); os.makedirs(tmp_dir, exist_ok=True)
    h = read(html_path)
    base = '<base href="%s">' % file_url(ROOT + '/')
    fixed = '<script>document.documentElement.setAttribute("data-quiz-fixed","1")</script>'
    h = h.replace('<head>', '<head>\n  ' + base + fixed, 1).replace('</body>', MEASURE_JS + '</body>', 1)
    tmp = os.path.join(tmp_dir, name + '.html'); write(tmp, h)
    pg_tmp[name] = tmp
    cmd = [browser, '--headless=new', '--disable-gpu', '--allow-file-access-from-files',
           '--window-size=1280,900', '--virtual-time-budget=1500', '--dump-dom', file_url(tmp)]
    out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=90).stdout.decode('utf-8', 'ignore')
    m = re.search(r'MEASURE\|(\{.*?\})</div>', out, re.S)
    return json.loads(html.unescape(m.group(1))) if m else None


def screenshot(browser, name, html_path):
    shots = os.path.join(BUILD_DIR, 'shots'); os.makedirs(shots, exist_ok=True)
    png = os.path.join(shots, name + '.png')
    cmd = [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=%d,%d' % STAGE,
           '--virtual-time-budget=1500', '--screenshot=' + png, file_url(pg_tmp.get(name, html_path))]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
    return png


def main(argv):
    check = '--no-check' not in argv
    tpl = read(os.path.join(TPL_DIR, 'slide.template.html'))
    tpl_by_type = {t: read(os.path.join(TPL_DIR, v['template'])) for t, v in TYPES.items() if v.get('template')}
    pages = load_pages()

    print('頁面順序：')
    generated = []
    for pg in pages:
        path = os.path.join(ROOT, pg['file'])
        if pg['type'] == 'custom':
            if not os.path.exists(path):
                raise SystemExit('custom 頁找不到檔案：%s' % pg['file'])
            changed = inject_nav(path, pg['prev'], pg['next'])
            print('  %-48s custom%s' % (pg['file'], '（已更新前後頁連結）' if changed else ''))
        else:
            write(path, render(pg, tpl_by_type.get(pg['type'], tpl)))
            print('  %-48s %s' % (pg['file'], pg['type']))
        generated.append(pg['file'])

    managed = set(generated)
    stray = [os.path.basename(p) for p in glob.glob(os.path.join(ROOT, '*.html')) if os.path.basename(p) not in managed]
    if stray:
        print('未納管的 HTML（不在 pages/ 裡，請確認是否刪除）：', ', '.join(stray))

    os.makedirs(BUILD_DIR, exist_ok=True)
    write(os.path.join(BUILD_DIR, 'manifest.json'), json.dumps(
        [dict(name=p['name'], file=p['file'], ch=p['ch'], p=p['p'], sec=p['sec'], chain=p['chain'], type=p['type'], prev=p['prev'], next=p['next']) for p in pages],
        ensure_ascii=False, indent=2))
    if not check:
        return 0

    browser = find_browser()
    if not browser:
        print('找不到 Edge 或 Chrome，略過量測。'); return 0
    rows, failed = [], 0
    for pg in pages:
        path = os.path.join(ROOT, pg['file'])
        m = measure(browser, pg['name'], path) or {}
        png = screenshot(browser, pg['name'], path)
        problems = []
        for k in ('prev', 'next'):
            target = pg[k]
            if target != '#' and not target.startswith(('http://', 'https://')) and not os.path.exists(os.path.join(ROOT, target)):
                problems.append('%s 連結目標不存在：%s' % (k, target))
        if pg['type'] not in ('blank', 'cover') and not sub_has_section(pg):
            problems.append('副標未以章節序號開頭（應為「%s …」）' % pg['sec'])
        if not m:
            problems.append('量測失敗（頁面無法載入）')
        elif pg['type'] != 'custom':
            if m.get('title_used', 0) > LIMIT_TITLE: problems.append('標題框 %d > %d' % (m['title_used'], LIMIT_TITLE))
            if m.get('title_overflow'): problems.append('標題列超過 1056 px（主標＋副標太長）')
            if m.get('lead_lines', 1) > 1: problems.append('引言超過一行')
            lim = LIMIT_CONTENT_FULL if pg['type'] in ('quiz', 'blank') else LIMIT_CONTENT
            if m.get('content_used', 0) > lim: problems.append('內容框 %d > %d' % (m['content_used'], lim))
            if m.get('overflow'): problems.append('格子溢出：' + '；'.join(m['overflow'][:3]))
            if m.get('nav_collision'): problems.append('與翻頁按鈕重疊：' + '；'.join(m['nav_collision'][:3]))
            if m.get('tip_lines'): problems.append('法規行超過一行（高 %s px）：只寫法規名稱與條號，條文移進正文' % m['tip_lines'][0])
            if m.get('below_nav'): problems.append('頁尾區（y %d 以下）只能放 TIP｜相關法規：' % m.get('nav_top', 642) + '；'.join(m['below_nav'][:3]))
            if not m.get('has_nav'): problems.append('缺少頁尾翻頁按鈕')
        else:
            if not m.get('has_nav'): problems.append('缺少頁尾翻頁按鈕')
        warn = ''
        if pg['type'] == 'quiz':
            tall = check_quiz_pool(browser, pg)
            if tall:
                warn = '題池偏高（> %d px）：' % QUIZ_CARD_MAX + '、'.join('%s %dpx' % t for t in tall)
        status = 'PASS' if not problems else 'FAIL'
        if warn:
            problems.append('提醒：' + warn)
        failed += status == 'FAIL'
        rows.append((pg['file'], pg['type'], m.get('title_used', '-'), m.get('content_used', '-'), status, '；'.join(problems) or '-', os.path.relpath(png, ROOT)))

    lines = ['# build 報告', '', '| 檔案 | type | 標題框/%d | 內容框/%d | 結果 | 問題 | 截圖 |' % (LIMIT_TITLE, LIMIT_CONTENT), '|---|---|---|---|---|---|---|']
    for r in rows:
        lines.append('| %s | %s | %s | %s | %s | %s | %s |' % r)
    if stray:
        lines += ['', '未納管的 HTML：' + '、'.join(stray)]
    write(os.path.join(BUILD_DIR, 'report.md'), '\n'.join(lines) + '\n')
    print('\n量測結果：')
    for r in rows:
        print('  %-5s %-48s 標題 %s 內容 %s  %s' % (r[4], r[0], r[2], r[3], r[5]))
    print('報告：build/report.md；截圖：build/shots/')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
