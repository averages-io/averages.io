/*
 * New-notification popup (2026-11-03, Martin: "new notifications have a banner in the top right corner right?").
 * Martin's notification-popup design, the one Settings > Notifications > "Send a test" used in the mock: it looks
 * like a browser notification, slides in at the top right, stays 5 seconds (it waits while you point at it or tab
 * into it), then slides back out to the right. The X closes it right away; a new one first slides the old one out.
 * Potato mode and reduced motion: no slide, it just appears and disappears. Both looks use it (the Windowed bell,
 * averages-bell.js, and Fullscreen's averages-fs-data.js).
 *
 *   AveragesNote.show({ title, body, onClick })   one popup
 *   AveragesNote.notify(items, { openAll })       items: [{ key: 'g:123', title, body, onClick }] that are unread.
 *       Each key pops up once on this device (averages_note_shown, the newest 300), whichever look it shows in.
 *       One new item: its own popup. Several: "N new notifications", which opens the bell (openAll).
 *       The very first time (nothing remembered yet) everything already there is remembered without a popup, so a
 *       student isn't greeted by a pile of old ones; the same for the first 20 seconds after that, while the page's
 *       slower parts (course updates) are still arriving.
 */
(function () {
  'use strict';
  if (window.AveragesNote) return;
  var LOGO = 'data:image/png;base64,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';
  var KEY = 'averages_note_shown', CAP = 300, SETTLE_MS = 20000, STAY_MS = 5000;
  var CSS = ''
    + '.avn-note{position:fixed;top:16px;right:16px;z-index:2147483000;width:min(360px,calc(100vw - 32px));box-sizing:border-box;display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-radius:16px;background:var(--field,#ffffff);color:var(--ink,#14151f);box-shadow:var(--pop-shadow,0 16px 40px rgba(20,21,31,.16),0 2px 6px rgba(20,21,31,.06));text-align:left;line-height:1.3}'
    + '.avn-note.in{animation:avnNote .32s cubic-bezier(.2,.8,.2,1) backwards}'
    + '@keyframes avnNote{from{opacity:0;transform:translateX(24px)}}'
    + '.avn-note img{width:36px;height:36px;border-radius:9px;flex:none}'
    + '.avn-go{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;border:0;background:none;padding:0;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer}'
    + '.avn-go:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-ring,rgba(10,29,158,.35));border-radius:6px}'
    + '.avn-go small{font-size:12px;font-weight:700;color:var(--muted,#5a5c70)}'
    + '.avn-go b{font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.avn-go span{font-size:13px;font-weight:600;color:var(--ink-2,#44465a);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '.avn-x{flex:none;width:28px;height:28px;margin:-4px -8px 0 0;padding:0;border:0;border-radius:8px;background:none;display:grid;place-items:center;color:var(--muted,#5a5c70);cursor:pointer;transition:background-color .15s ease}'
    + '.avn-x:hover,.avn-x:focus-visible{background:var(--panel,#eaeaec);color:var(--ink,#14151f);outline:none}'
    + '.avn-x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.075;stroke-linecap:round;stroke-linejoin:round}';
  var X = '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="translate(12 12) scale(1.06) translate(-12 -12)"><path d="M6 6l12 12M18 6 6 18"/></g></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function calm() {
    try { return document.body.classList.contains('potato-mode') || matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function style() {
    if (document.getElementById('avnStyle')) return;
    var st = document.createElement('style'); st.id = 'avnStyle'; st.textContent = CSS; document.head.appendChild(st);
  }

  function go(n) {
    if (!n || n.dataset.going) return; n.dataset.going = '1'; clearTimeout(n._t);
    if (calm() || !n.animate) { n.remove(); return; }
    n.style.pointerEvents = 'none';
    n.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(calc(100% + 24px))' }], { duration: 280, easing: 'cubic-bezier(.4, 0, .8, .2)', fill: 'forwards' }).onfinish = function () { n.remove(); };
  }

  function show(o) {
    if (!document.body) return null;
    style();
    document.querySelectorAll('.avn-note').forEach(go);
    var n = document.createElement('div');
    n.className = 'avn-note' + (calm() ? '' : ' in');
    n.setAttribute('role', 'status');
    n.innerHTML = '<img src="' + LOGO + '" alt=""><button type="button" class="avn-go"><small>Averages.io · now</small><b>' + esc(o.title) + '</b>' + (o.body ? '<span>' + esc(o.body) + '</span>' : '') + '</button><button type="button" class="avn-x" aria-label="Close the notification">' + X + '</button>';
    document.body.appendChild(n);
    var wait = function () { clearTimeout(n._t); n._t = setTimeout(function () { go(n); }, STAY_MS); };
    n.querySelector('.avn-x').addEventListener('click', function () { go(n); });
    n.querySelector('.avn-go').addEventListener('click', function () { go(n); if (o.onClick) o.onClick(); });
    n.addEventListener('mouseenter', function () { clearTimeout(n._t); }); n.addEventListener('mouseleave', wait);
    n.addEventListener('focusin', function () { clearTimeout(n._t); }); n.addEventListener('focusout', wait);
    wait();
    return n;
  }

  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && Array.isArray(v.ids) ? v : null; } catch (e) { return null; }
  }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage off: popups may repeat */ } }

  function notify(items, opts) {
    items = (items || []).filter(function (it) { return it && it.key; });
    var v = read(), now = Date.now();
    var fresh = v ? items.filter(function (it) { return v.ids.indexOf(it.key) < 0; }) : items;
    if (!fresh.length && v) return;
    var quiet = !v || (v.since && now - v.since < SETTLE_MS);
    v = v || { since: now, ids: [] };
    v.ids = v.ids.concat(fresh.map(function (it) { return it.key; })).slice(-CAP);
    write(v);
    if (quiet || !fresh.length) return;
    if (fresh.length === 1) { show(fresh[0]); return; }
    show({
      title: fresh.length + ' new notifications',
      body: fresh.slice(0, 2).map(function (it) { return it.title; }).join(' · ') + (fresh.length > 2 ? ' · and more' : ''),
      onClick: opts && opts.openAll,
    });
  }

  window.AveragesNote = { show: show, notify: notify };
})();
