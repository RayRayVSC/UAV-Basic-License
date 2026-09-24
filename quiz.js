/* 隨堂考：頁面內嵌整個題池（#quiz-pool JSON），一次顯示 show 題（預設 5）。
   點選項即顯示對錯；骰子「隨機問題」從題池抽換；「顯示全部答案」、「重做」只作用於目前這幾題。
   開頁預設隨機抽題；<html data-quiz-fixed> 時不抽（build 量測與截圖用，顯示題池前幾題）。
   抽題前先量好每題卡片高度，挑出能排在翻頁按鈕文字之上的組合，避免版面溢出。 */
(function () {
  'use strict';
  var root = document.querySelector('.quiz');
  if (!root) return;
  var poolEl = document.getElementById('quiz-pool');
  var pool = poolEl ? JSON.parse(poolEl.textContent) : [];
  var show = parseInt(root.dataset.show || '5', 10);
  var fixed = document.documentElement.hasAttribute('data-quiz-fixed');
  var sum = root.querySelector('.qsum');
  var score = document.getElementById('quiz-score');
  var hint = document.getElementById('quiz-hint');
  var current = [], heights = {};

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function cards() { return [].slice.call(root.querySelectorAll('.qcard')); }

  function cardHTML(q) {
    var opts = ['a', 'b', 'c', 'd'].map(function (k) {
      return '<button type="button" class="opt" data-opt="' + k + '"><span class="k">' + k.toUpperCase() + '</span><span>' + esc(q.options[k]) + '</span></button>';
    }).join('');
    var exp = q.explain ? '<p class="explain">' + esc(q.explain) + '</p>' : '';
    var total = q.description.length + ['a', 'b', 'c', 'd'].reduce(function (n, k) { return n + q.options[k].length; }, 0);
    var cls = 'qcard' + ((q.description.length > 100 || total > 170) ? ' long xlong' : ((q.description.length > 60 || total > 120) ? ' long' : ''));
    return '<section class="' + cls + '" data-qid="' + esc(q.id) + '" data-answer="' + esc(q.answer) + '"><p class="q">' + esc(q.description) + '</p><div class="opts">' + opts + '</div>' + exp + '</section>';
  }

  function update() {
    var done = 0, ok = 0;
    cards().forEach(function (c) { if (c.classList.contains('done')) { done++; if (c.classList.contains('ok')) ok++; } });
    if (score) score.textContent = ok;
    var tot = document.getElementById('quiz-total'); if (tot) tot.textContent = cards().length;
    if (hint) hint.textContent = done === 0 ? '點選項作答，答完自動計分' : (done === cards().length ? '全部作答完畢' : '已作答 ' + done + ' / ' + cards().length);
  }

  function answer(card, opt) {
    if (card.classList.contains('done')) return;
    var ans = card.dataset.answer;
    card.classList.add('done');
    card.querySelectorAll('.opt').forEach(function (b) { b.disabled = true; if (b.dataset.opt === ans) b.classList.add('correct'); });
    if (opt) { if (opt === ans) card.classList.add('ok'); else card.querySelector('.opt[data-opt="' + opt + '"]').classList.add('wrong'); }
    else card.classList.add('revealed');
    update();
  }

  function render(set) {
    current = set;
    cards().forEach(function (c) { c.parentNode.removeChild(c); });
    var html = set.map(cardHTML).join('');
    if (sum) sum.insertAdjacentHTML('beforebegin', html); else root.insertAdjacentHTML('beforeend', html);
    update();
  }

  // 一次量好題池每張卡的高度（與實際欄寬相同）
  function measureAll() {
    var w = (root.clientWidth - 14) / 2;
    var box = document.createElement('div');
    box.className = 'quiz';
    box.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;display:block;width:' + w + 'px';
    box.innerHTML = pool.map(cardHTML).join('');
    root.parentNode.appendChild(box);
    [].slice.call(box.querySelectorAll('.qcard')).forEach(function (c) { heights[c.dataset.qid] = c.getBoundingClientRect().height; });
    box.parentNode.removeChild(box);
  }
  function budget() {
    var nt = document.querySelector('.nav-prev .nav-text');
    var limit = nt ? nt.getBoundingClientRect().top - 4 : 1e9;
    return limit - root.getBoundingClientRect().top - 8 * Math.ceil((show + 1) / 2 - 1);
  }
  function rowsHeight(set) {
    var hs = set.map(function (q) { return heights[q.id] || 0; }).sort(function (a, b) { return b - a; });
    var sumH = sum ? sum.getBoundingClientRect().height : 0;
    var items = hs.concat([sumH]), total = 0;
    for (var i = 0; i < items.length; i += 2) total += Math.max(items[i], items[i + 1] || 0);
    return total;
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function draw(cand) { return shuffle(cand.slice()).slice(0, show); }
  function hOf(q) { return heights[q.id] || 0; }
  function byHeightDesc(a, b) { return hOf(b) - hOf(a); }
  function greedy(cand, n, limit) {
    for (var t = 0; t < 12; t++) {
      var order = shuffle(cand.slice()), set = [];
      for (var i = 0; i < order.length && set.length < n; i++) {
        var trial = set.concat([order[i]]);
        if (rowsHeight(trial) <= limit) set = trial;
      }
      if (set.length === n) return set.sort(byHeightDesc);
    }
    return null;
  }
  function pick(before, n) {
    n = n || show;
    if (pool.length <= n) return shuffle(pool.slice());
    var avoid = {}; (before || current).forEach(function (q) { avoid[q.id] = 1; });
    var cand = pool.filter(function (q) { return !avoid[q.id]; });
    var limit = budget();
    var set = (cand.length >= n) ? greedy(cand, n, limit) : null;
    if (!set) set = greedy(pool, n, limit);          // 放寬：允許和上一組重複
    return set;                                       // null 表示 n 題排不下
  }
  function fits() {
    var nt = document.querySelector('.nav-prev .nav-text');
    var limit = nt ? nt.getBoundingClientRect().top - 4 : 1e9;
    return root.getBoundingClientRect().bottom <= limit;
  }
  function roll() {
    var before = current.slice();
    for (var n = show; n >= 2; n--) {           // 排不下就少一題
      var set = pick(before, n);
      if (!set) continue;
      render(set);
      if (fits()) return;
    }
    render(pool.slice().sort(function (a, b) { return hOf(a) - hOf(b); }).slice(0, 2));
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.opt') : null;
    if (!b || !root.contains(b)) return;
    answer(b.closest('.qcard'), b.dataset.opt);
  });
  var dice = document.getElementById('quiz-dice'), reveal = document.getElementById('quiz-reveal'), reset = document.getElementById('quiz-reset');
  if (dice) { if (pool.length <= show) dice.hidden = true; else dice.addEventListener('click', roll); }
  if (reveal) reveal.addEventListener('click', function () { cards().forEach(function (c) { answer(c, null); }); });
  if (reset) reset.addEventListener('click', function () {
    cards().forEach(function (c) { c.classList.remove('done', 'ok', 'revealed'); c.querySelectorAll('.opt').forEach(function (b) { b.disabled = false; b.classList.remove('correct', 'wrong'); }); });
    update();
  });

  // 開頁：預先產出的卡片就是題池前 show 題；非 fixed 模式時改為隨機
  current = cards().map(function (c) { for (var i = 0; i < pool.length; i++) if (pool[i].id === c.dataset.qid) return pool[i]; return null; }).filter(Boolean);
  measureAll();
  if (!fixed && pool.length > show) roll(); else update();
})();
