/*
 * GPA, unweighted and weighted, with a scale the student can edit (both looks).
 * Kept in schoolagy_settings_options.gpa, so it syncs like the other settings:
 *   { points: { 'A+': 4, ... }, bonus: { honors: 0.5, ap: 1 }, levels: { <class id>: 'regular' | 'honors' | 'ap' } }
 * A class's level starts from its name (AP or IB = AP, Honors = Honors) until the student picks one.
 * AveragesGPA.compute(classes) with [{ id, name, grade }] answers { unweighted, weighted } (null with nothing graded).
 * AveragesGPA.edit(classes, onSave) opens the scale editor.
 */
(function () {
  'use strict';
  if (window.AveragesGPA) return;
  var LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
  var POINTS = { 'A+': 4, 'A': 4, 'A-': 3.7, 'B+': 3.3, 'B': 3, 'B-': 2.7, 'C+': 2.3, 'C': 2, 'C-': 1.7, 'D+': 1.3, 'D': 1, 'D-': 0.7, 'F': 0 };
  var BONUS = { honors: 0.5, ap: 1 };
  var LEVELS = [['regular', 'Regular'], ['honors', 'Honors'], ['ap', 'AP / IB']];

  function opts() { try { return JSON.parse(localStorage.getItem('schoolagy_settings_options') || '{}') || {}; } catch (e) { return {}; } }
  function saved() { var g = opts().gpa; return g && typeof g === 'object' ? g : {}; }
  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : d; }
  function points() { var p = saved().points || {}, out = {}; LETTERS.forEach(function (l) { out[l] = num(p[l], 0, 10, POINTS[l]); }); return out; }
  function bonus() { var b = saved().bonus || {}; return { honors: num(b.honors, 0, 5, BONUS.honors), ap: num(b.ap, 0, 5, BONUS.ap) }; }
  function guess(name) { name = String(name || ''); return /^(AP|IB)\b|\b(AP|IB)\s/i.test(name) ? 'ap' : /\bhonou?rs\b|\bhon\.?\s/i.test(name) ? 'honors' : 'regular'; }
  function level(c) { var l = (saved().levels || {})[String(c.id)]; return l === 'regular' || l === 'honors' || l === 'ap' ? l : guess(c.name); }
  function store(g) {
    var o = opts(); o.gpa = g;
    try { localStorage.setItem('schoolagy_settings_options', JSON.stringify(o)); } catch (e) { /* storage off */ }
    // Windowed pages push synced settings on their own; Fullscreen pages through FSX
    try { if (window.FSX && window.FSX.syncPush) window.FSX.syncPush(); else window.dispatchEvent(new StorageEvent('storage', { key: 'schoolagy_settings_options' })); } catch (e) { /* fine */ }
    window.dispatchEvent(new CustomEvent('averages:gpa'));
  }
  function compute(classes) {
    var P = points(), B = bonus(), list = (classes || []).filter(function (c) { return c && P[c.grade] !== undefined; });
    if (!list.length) return { unweighted: null, weighted: null, count: 0 };
    var u = 0, w = 0;
    list.forEach(function (c) { var p = P[c.grade], l = level(c); u += p; w += p + (p > 0 ? (l === 'ap' ? B.ap : l === 'honors' ? B.honors : 0) : 0); });
    return { unweighted: u / list.length, weighted: w / list.length, count: list.length };
  }

  // ---------- the editor ----------
  var CSS = '.avg-scrim{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(12,12,20,.5)}'
    + '.avg-box{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:20px;padding:22px 24px;background:var(--panel,var(--panel-bg,#fff));color:var(--ink,var(--text-dark,#14151f));box-shadow:0 20px 60px rgba(0,0,0,.35);font:inherit}'
    + '.avg-box h2{margin:0 0 4px;font-size:1.15rem;font-weight:900}.avg-box>p{margin:0 0 14px;font-size:.84rem;color:var(--muted,var(--text-muted,#666))}'
    + '.avg-box h3{margin:16px 0 8px;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,var(--text-muted,#666))}'
    + '.avg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}.avg-grid.wide{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}.avg-grid label{white-space:nowrap}'
    + '.avg-grid label,.avg-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:12px;background:var(--field,var(--panel-inner,#f2f2f5));font-weight:800;font-size:.86rem}'
    + '.avg-box input{width:52px;box-sizing:border-box;min-width:0;height:30px;border:0;border-radius:8px;padding:0 6px;text-align:right;font:inherit;font-weight:800;background:var(--panel,var(--panel-bg,#fff));color:inherit;box-shadow:inset 0 0 0 2px var(--inner,var(--border,#ddd))}'
    + '.avg-box input:focus{outline:none;box-shadow:inset 0 0 0 2px var(--accent,#3d3f9e)}'
    + '.avg-rows{display:flex;flex-direction:column;gap:6px}.avg-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.avg-seg{display:inline-flex;flex:none;gap:2px;padding:2px;border-radius:10px;background:var(--panel,var(--panel-bg,#fff))}'
    + '.avg-seg button{border:0;border-radius:8px;padding:5px 10px;background:none;color:inherit;font:inherit;font-size:.76rem;font-weight:800;cursor:pointer}'
    + '.avg-seg button[aria-pressed="true"]{background:var(--accent,#3d3f9e);color:#fff}'
    + '.avg-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:18px}'
    + '.avg-foot div{display:flex;gap:8px}.avg-btn{border:0;border-radius:12px;padding:10px 16px;font:inherit;font-weight:800;font-size:.86rem;cursor:pointer;background:var(--field,var(--panel-inner,#eee));color:inherit}'
    + '.avg-btn.primary{background:var(--accent,#3d3f9e);color:#fff}.avg-btn.link{background:none;padding:10px 4px;text-decoration:underline;text-underline-offset:2px;color:var(--muted,var(--text-muted,#666))}';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function edit(classes, onSave) {
    if (!document.getElementById('avgCss')) { var st = document.createElement('style'); st.id = 'avgCss'; st.textContent = CSS; document.head.appendChild(st); }
    var P = points(), B = bonus(), lv = {};
    (classes || []).forEach(function (c) { lv[c.id] = level(c); });
    var from = document.activeElement, el = document.createElement('div');
    el.className = 'avg-scrim';
    function draw() {
      el.innerHTML = '<div class="avg-box" role="dialog" aria-modal="true" aria-labelledby="avgT"><h2 id="avgT">GPA scale</h2><p>How many points each grade is worth, and what Honors and AP classes add for the weighted GPA.</p>'
        + '<h3>Points per grade</h3><div class="avg-grid">' + LETTERS.map(function (l) { return '<label>' + l + '<input inputmode="decimal" data-pt="' + l + '" value="' + P[l] + '" aria-label="Points for ' + l + '"></label>'; }).join('') + '</div>'
        + '<h3>Weighted GPA adds</h3><div class="avg-grid wide"><label>Honors<input inputmode="decimal" data-bn="honors" value="' + B.honors + '" aria-label="Points added for Honors"></label><label>AP / IB<input inputmode="decimal" data-bn="ap" value="' + B.ap + '" aria-label="Points added for AP or IB"></label></div>'
        + ((classes || []).length ? '<h3>Your classes</h3><div class="avg-rows">' + classes.map(function (c) { return '<div class="avg-row"><span>' + esc(c.name) + '</span><span class="avg-seg" role="group" aria-label="' + esc(c.name) + ' level">' + LEVELS.map(function (x) { return '<button type="button" data-lv="' + esc(c.id) + '" data-v="' + x[0] + '" aria-pressed="' + (lv[c.id] === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</span></div>'; }).join('') + '</div>' : '')
        + '<div class="avg-foot"><button type="button" class="avg-btn link" data-x="reset">Use the usual scale</button><div><button type="button" class="avg-btn" data-x="cancel">Cancel</button><button type="button" class="avg-btn primary" data-x="save">Save</button></div></div></div>';
    }
    function read() {
      el.querySelectorAll('[data-pt]').forEach(function (i) { P[i.dataset.pt] = num(i.value, 0, 10, P[i.dataset.pt]); });
      el.querySelectorAll('[data-bn]').forEach(function (i) { B[i.dataset.bn] = num(i.value, 0, 5, B[i.dataset.bn]); });
    }
    function close() { el.remove(); document.removeEventListener('keydown', key, true); if (from && from.focus) from.focus(); }
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } }
    el.addEventListener('click', function (e) {
      if (e.target === el) { close(); return; }
      var b = e.target.closest('[data-lv]');
      if (b) { read(); lv[b.dataset.lv] = b.dataset.v; draw(); var again = el.querySelector('[data-lv="' + b.dataset.lv + '"][data-v="' + b.dataset.v + '"]'); if (again) again.focus(); return; }
      var x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'cancel') { close(); return; }
      if (x.dataset.x === 'reset') { P = Object.assign({}, POINTS); B = Object.assign({}, BONUS); lv = {}; (classes || []).forEach(function (c) { lv[c.id] = guess(c.name); }); draw(); return; }
      read();
      var levels = Object.assign({}, saved().levels || {});
      (classes || []).forEach(function (c) { if (lv[c.id] === guess(c.name)) delete levels[c.id]; else levels[c.id] = lv[c.id]; });
      store({ points: P, bonus: B, levels: levels });
      close(); if (onSave) onSave();
    });
    document.addEventListener('keydown', key, true);
    draw(); document.body.appendChild(el);
    var f = el.querySelector('input'); if (f) f.focus();
  }
  window.AveragesGPA = { compute: compute, edit: edit, level: level, points: points, bonus: bonus };
})();
