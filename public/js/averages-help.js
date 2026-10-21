/* Averages.io first-time help popups for Add from Canva and Add from Google Drive.
   Needs averages-help.css. Usage, from the click handler of each button:

     canvaButton.onclick = () => AveragesHelp.open('canva', { prepare: () => makeDesign(), onContinue: editUrl => openCanva(editUrl) });
     driveButton.onclick = () => AveragesHelp.open('drive', { onContinue: () => openGoogleDrive() });

   Also: AveragesHelp.shouldShow('canva'), AveragesHelp.reset() to show them again, AveragesHelp.close().
   "Don't show this again" is saved in localStorage under av_help_skip_canva and av_help_skip_drive. */
(() => {
const SPRITE = `<svg id="avh-sprite" width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="avh-i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
<symbol id="avh-i-out" viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></symbol>
<symbol id="avh-i-go" viewBox="0 0 24 24"><path d="M4 12h16M14 6l6 6-6 6"/></symbol>
<symbol id="avh-i-back" viewBox="0 0 24 24"><path d="M10 6 4 12l6 6M4 12h16"/></symbol>
<symbol id="avh-i-alert" viewBox="0 0 24 24"><path d="M12 3 2.5 20h19z"/><path d="M12 9.5v5M12 16.5v2"/></symbol>
<symbol id="avh-i-ok" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
<symbol id="avh-i-pause" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></symbol>
<symbol id="avh-i-play" viewBox="0 0 24 24"><path d="M7 5v14l12-7z"/></symbol>
<symbol id="avh-i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/></symbol>
<symbol id="avh-i-plus" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></symbol>
<symbol id="avh-i-home" viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/></symbol>
<symbol id="avh-i-folder" viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z"/></symbol>
<symbol id="avh-i-people" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2.1.8 3.5 2.8 3.5 5.6"/></symbol>
<symbol id="avh-i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></symbol>
<symbol id="avh-i-star" viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></symbol>
<symbol id="avh-i-move" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></symbol>
<symbol id="avh-i-download" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></symbol>
<symbol id="avh-i-pencil" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></symbol>
<symbol id="avh-i-copy" viewBox="0 0 24 24"><path d="M8 8h11v12H8z"/><path d="M5 16V4h11"/></symbol>
<symbol id="avh-i-share" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M19 8v6M16 11h6"/></symbol>
<symbol id="avh-i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></symbol>
<symbol id="avh-i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="avh-i-doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/></symbol>
</svg>`;
const $ = id => document.getElementById(id);
const ico = n => `<svg class="avh-i"><use href="#avh-i-${n}"/></svg>`;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
// your Averages.io logo (the same image the app's top bar uses), for the tab and the Open with menu
const AV_LOGO = 'data:image/png;base64,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';
// a puffy, rounded pointer (no tail), with a thick white outline
const CURSOR = '<svg viewBox="0 0 24 24"><path d="M4.6 3.9c-.5-.9.4-1.8 1.3-1.4l14.1 6.6c1 .5.9 1.9-.1 2.2l-5.6 1.8c-.4.1-.7.4-.8.8l-1.9 5.6c-.3 1-1.7 1.1-2.2.1z" fill="#14151f" stroke="#ffffff" stroke-width="2.25" stroke-linejoin="round"/></svg>';

// ---------- the two popups ----------
const HELP = {
  canva: {
    title: 'Before you open Canva',
    lead: "Canva opens in this tab. Here's how to get your design back here.",
    mark: 'canva', go: 'Open Canva', goIcon: 'go', cancel: false, sameTab: true,
    wait: 'Making your design', ready: 'Your design is ready. Open Canva.', fail: "Couldn't make your design. Try again.",
    steps: [
      ['Canva opens in this tab', 'It takes the place of Averages.io for now.'],
      ['Make your design', 'Edit it in Canva like you normally would.'],
      ['Click Return to Averages.io', "It's in the top right corner of Canva."],
      ["You're back, with your design attached", 'You land right back on this page.'],
    ],
    note: 'Come back with the <b>Return to Averages.io</b> button, so your design comes with you.',
  },
  drive: {
    title: 'Add files from Google Drive',
    lead: 'Google Drive only shares the files you open with Averages.io. It takes a few seconds per file.',
    mark: 'drive', go: 'Open Google Drive',
    steps: [
      ['Find your file in Google Drive', 'Google Drive opens in a new tab.'],
      ['Right-click it, then pick Open with', 'Or click the <kbd>⋮</kbd> on the file.'],
      ['Choose Averages.io for Drive', 'It sends that file to Averages.io.'],
      ["It's in your Averages.io files", 'Come back here and it shows up under Google Drive.'],
    ],
    note: null,
  },
};

// ---------- the little browser for each how-to ----------
function stageHTML(k) {
  const tabs = `<div class="avh-br-tabs"><span class="avh-br-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="avh-tab avh-on" data-tab="av"><span class="avh-mk avh-av"></span>Averages.io</span>
    <span class="avh-tab avh-gone" data-tab="ext"><span class="avh-mk avh-${k}"></span>${k === 'canva' ? 'Canva' : 'Google Drive'}</span></div>
    <div class="avh-br-url"><span data-url>app.averages.io</span></div>`;
  const avScene = `<div class="avh-sc avh-s-av avh-on" data-sc="av"><h4>Turn in</h4>
    <div class="avh-s-adds"><span class="avh-s-add" data-hit="drive"><span class="avh-mk avh-drive"></span>Google Drive</span><span class="avh-s-add" data-hit="canva"><span class="avh-mk avh-canva"></span>Canva</span></div>
    <div class="avh-s-drop">Drop files here</div>
    <div class="avh-s-file" data-file><span class="avh-ft" style="background:${k === 'canva' ? '#7a4fd6' : '#2f5fb3'}">${k === 'canva' ? 'PNG' : 'DOCX'}</span><span><b>${k === 'canva' ? 'Lab 4 poster.png' : 'Lab 4 report.docx'}</b><small>From ${k === 'canva' ? 'Canva' : 'Google Drive'}</small></span><span class="avh-ok">${ico('ok')}Added</span></div></div>`;
  const ext = k === 'canva'
    ? `<div class="avh-sc avh-s-ed" data-sc="ext"><div class="avh-ed-top"><span class="avh-mk avh-canva"></span><span class="avh-ln"></span><span class="avh-ln"></span><span class="avh-grow"></span><span class="avh-ret" data-hit="ret">${ico('back')}Return to Averages.io</span></div>
        <div class="avh-ed-main"><div class="avh-ed-rail"><i></i><i></i><i></i><i></i></div><div class="avh-ed-can"><div class="avh-art" data-art><i class="avh-a1"></i><i class="avh-a2"></i><i class="avh-a3"></i><i class="avh-a4"></i></div></div></div></div>`
    // a simplified Google Drive: its layout, colors and menu wording, drawn with generic icons
    : `<div class="avh-sc avh-s-dr" data-sc="ext">
        <div class="avh-dr-top"><span class="avh-mk avh-drive"></span><b>Drive</b><span class="avh-dr-search">${ico('search')}Search in Drive</span><span class="avh-dr-me"></span></div>
        <div class="avh-dr-side"><span class="avh-dr-new">${ico('plus')}<span>New</span></span>
          ${[['home', 'Home'], ['folder', 'My Drive'], ['people', 'Shared with me'], ['clock', 'Recent'], ['star', 'Starred']].map(([i, n]) => `<span class="avh-dr-nav${n === 'My Drive' ? ' avh-on' : ''}">${ico(i)}<span>${n}</span></span>`).join('')}</div>
        <div class="avh-dr-main"><div class="avh-dr-h">My Drive<span>▾</span></div>
          <div class="avh-dr-chips"><span>Type ▾</span><span>People ▾</span><span>Modified ▾</span></div>
          <div class="avh-dr-grid">${[['Lab 4 report', '#4f7fe0'], ['Notes', '#4f7fe0'], ['Class data', '#1e8e3e'], ['Unit 3 slides', '#e8a600']].map(([n, c], i) => `<div class="avh-dr-card" ${i === 0 ? 'data-hit="file"' : ''}><span class="avh-dr-ch"><i class="avh-dr-ty" style="background:${c}"></i><span class="avh-dr-nm">${n}</span><span class="avh-dr-dots">⋮</span></span><span class="avh-pv"><i></i><i></i><i></i></span></div>`).join('')}</div></div>
        <div class="avh-menu" data-menu="main"><div data-hit="openwith">${ico('move')}Open with<span class="avh-car">›</span></div><hr>
          <div>${ico('download')}Download</div><div>${ico('pencil')}Rename</div><div>${ico('copy')}Make a copy</div><hr>
          <div>${ico('share')}Share<span class="avh-car">›</span></div><div>${ico('folder')}Organize<span class="avh-car">›</span></div><hr>
          <div>${ico('trash')}Move to trash</div></div>
        <div class="avh-menu" data-menu="sub"><div>${ico('eye')}Preview</div><div>${ico('out')}Open in new tab</div><hr>
          <div>${ico('doc')}Google Docs</div><div data-hit="avpick"><span class="avh-mk avh-av"></span>Averages.io for Drive</div><hr>
          <div>${ico('plus')}Connect more apps</div></div></div>`;
  return `<div class="avh-br" aria-hidden="true">${tabs}<div class="avh-scenes">${avScene}${ext}</div></div><span class="avh-cur" data-cur>${CURSOR}</span>`;
}

// Each step is a list of moves: point the cursor at something, click it, or change what the browser shows.
// The how-to loops, and the step list follows along.
const PLAYS = {
  canva: [
    [['reset'], ['wait', 300], ['point', 'canva'], ['wait', 900], ['click'], ['hot', 'canva'], ['wait', 300], ['tab', 'ext'], ['url', 'canva.com/design'], ['wait', 1100]],
    [['wait', 200], ['point', '.avh-art', .5, .7], ['wait', 900], ['draw'], ['wait', 1900]],
    [['point', 'ret'], ['ping'], ['wait', 1300], ['click'], ['wait', 300]],
    [['tab', 'av'], ['close'], ['url', 'app.averages.io'], ['wait', 300], ['file'], ['point', '[data-file]', .8, .55], ['wait', 2400]],
  ],
  drive: [
    [['reset'], ['wait', 300], ['tab', 'ext'], ['url', 'drive.google.com/drive/my-drive'], ['wait', 500], ['point', 'file'], ['wait', 900], ['hot', 'file'], ['wait', 600]],
    [['click'], ['menu', 'main', 'file'], ['wait', 600], ['point', 'openwith'], ['wait', 700], ['hot', 'openwith'], ['wait', 500]],
    [['menu', 'sub', 'openwith'], ['wait', 500], ['point', 'avpick'], ['wait', 900], ['hot', 'avpick'], ['click'], ['wait', 500]],
    [['menus off'], ['tab', 'av'], ['url', 'app.averages.io'], ['wait', 300], ['file'], ['point', '[data-file]', .8, .55], ['wait', 2400]],
  ],
};
function makePlayer(root, k, onStep) {
  const br = root.querySelector('.avh-br'), cur = root.querySelector('[data-cur]'), plays = PLAYS[k];
  let step = 0, i = 0, timer = 0, paused = false, startedAt = 0;
  const q = sel => br.querySelector(sel.startsWith('.') || sel.startsWith('[') ? sel : `[data-hit="${sel}"]`);
  // the cursor moves like a hand: a gentle curve, speeding up then slowing down, a tiny overshoot, then it settles
  let pos = { x: 0, y: 0 }, glide = null;
  const place = (x, y) => { if (glide) { glide.cancel(); glide = null; } pos = { x, y }; cur.style.transform = `translate(${x}px, ${y}px)`; };
  const moveTo = (sel, fx = .55, fy = .6) => {
    const el = q(sel); if (!el) return;
    const r = el.getBoundingClientRect(), s = root.getBoundingClientRect();
    const x = r.left - s.left + r.width * fx, y = r.top - s.top + r.height * fy;
    if (calm() || root.classList.contains('avh-jump') || !cur.animate) { place(x, y); return; }
    const from = { ...pos }, dx = x - from.x, dy = y - from.y, dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    // bend the path to one side by 10 to 22% of the distance; hands arc, they don't draw rulers
    const bend = (Math.random() < .7 ? 1 : -1) * dist * (.1 + Math.random() * .12);
    const c = { x: from.x + dx * .45 - dy / dist * bend, y: from.y + dy * .45 + dx / dist * bend };
    const over = Math.min(6, dist * .04), ox = x + dx / dist * over, oy = y + dy / dist * over;
    const ease = t => t * t * t * (10 + t * (6 * t - 15)); // slow start, fast middle, slow end
    const at = t => { const u = ease(t), v = 1 - u; return [v * v * from.x + 2 * v * u * c.x + u * u * ox, v * v * from.y + 2 * v * u * c.y + u * u * oy]; };
    const frames = [];
    for (let n = 0; n <= 20; n++) { const [px, py] = at(n / 20); frames.push({ transform: `translate(${px}px, ${py}px)`, offset: n / 20 * .86 }); }
    frames.push({ transform: `translate(${x}px, ${y}px)`, offset: 1 });
    const ms = Math.round(Math.min(950, Math.max(480, 300 + dist * 2.2)));
    if (glide) glide.cancel();
    pos = { x, y }; cur.style.transform = `translate(${x}px, ${y}px)`;
    glide = cur.animate(frames, { duration: ms, easing: 'linear' });
    glide.onfinish = () => { glide = null; };
  };
  const sameTab = !!HELP[k].sameTab;
  const showTab = t => {
    br.querySelectorAll('[data-sc]').forEach(x => x.classList.toggle('avh-on', x.dataset.sc === t));
    if (sameTab) br.querySelector('[data-tab="av"]').classList.toggle('avh-gone', t !== 'av');
    br.querySelectorAll('[data-tab]').forEach(x => { x.classList.toggle('avh-on', x.dataset.tab === t); if (x.dataset.tab === 'ext' && t === 'ext') x.classList.remove('avh-gone'); });
  };
  const ACT = {
    reset() {
      showTab('av'); br.querySelector('[data-tab="ext"]').classList.add('avh-gone');
      br.querySelectorAll('.avh-hot').forEach(x => x.classList.remove('avh-hot'));
      br.querySelectorAll('.avh-in, .avh-drawn, .avh-ping').forEach(x => x.classList.remove('avh-in', 'avh-drawn', 'avh-ping'));
      br.querySelector('[data-url]').textContent = 'app.averages.io';
      const s = root.getBoundingClientRect(); place(s.width * .7, s.height * .8);
    },
    wait() {}, point(sel, fx, fy) { moveTo(sel, fx, fy); },
    click() { cur.classList.remove('avh-click'); void cur.offsetWidth; cur.classList.add('avh-click'); },
    hot(sel) { const el = q(sel); if (el) el.classList.add('avh-hot'); },
    tab(t) { showTab(t); }, url(u) { br.querySelector('[data-url]').textContent = u; },
    draw() { br.querySelector('[data-art]').classList.add('avh-drawn'); },
    ping() { const r = q('ret'); if (r) r.classList.add('avh-ping'); },
    close() { const r = q('ret'); if (r) r.classList.remove('avh-ping'); br.querySelector('[data-tab="ext"]').classList.add('avh-gone'); },
    file() { br.querySelector('[data-file]').classList.add('avh-in'); },
    // menus are placed inside the page area (not the whole browser), next to what was clicked;
    // the second menu opens to the right of the first, or to its left when there's no room
    menu(which, at) {
      const m = br.querySelector(`[data-menu="${which}"]`), a = q(at); if (!m || !a) return;
      const box = m.offsetParent.getBoundingClientRect(), r = a.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
      let x, y;
      if (which === 'main') { x = r.left - box.left + r.width * .3; y = r.top - box.top + r.height * .6; if (x + w > box.width - 4) x = r.right - box.left - w - 8; }
      else { const main = br.querySelector('[data-menu="main"]').getBoundingClientRect(); x = main.right - box.left - 2; y = r.top - box.top - 4; if (x + w > box.width - 4) x = main.left - box.left - w + 2; }
      x = Math.max(4, Math.min(x, box.width - w - 4)); y = Math.max(4, Math.min(y, box.height - h - 4));
      m.style.left = x + 'px'; m.style.top = y + 'px'; m.classList.add('avh-in');
    },
    'menus off'() { br.querySelectorAll('[data-menu]').forEach(m => m.classList.remove('avh-in')); br.querySelectorAll('.avh-hot').forEach(x => x.classList.remove('avh-hot')); },
  };
  const stepMs = s => plays[s].reduce((t, [a, v]) => t + (a === 'wait' ? v : 0), 0) + plays[s].filter(([a]) => a === 'point').length * 0;
  function run() {
    clearTimeout(timer); if (paused) return;
    const moves = plays[step];
    if (i === 0) { startedAt = performance.now(); onStep(step, stepMs(step)); }
    while (i < moves.length) {
      const [a, ...args] = moves[i++];
      if (a === 'wait') { timer = setTimeout(run, args[0]); return; }
      ACT[a](...args);
    }
    i = 0; step = (step + 1) % plays.length; timer = setTimeout(run, 0);
  }
  // jump to a step: replay everything before it instantly, then play from there
  function goTo(s, play = !calm()) {
    clearTimeout(timer); i = 0;
    root.classList.add('avh-jump'); ACT.reset();
    for (let p = 0; p < s; p++) plays[p].forEach(([a, ...args]) => { if (a !== 'wait' && a !== 'click') ACT[a](...args); });
    step = s;
    if (play && !paused) { root.classList.remove('avh-jump'); run(); }
    else { plays[s].forEach(([a, ...args]) => { if (a !== 'wait' && a !== 'click') ACT[a](...args); }); onStep(s, 0); root.classList.remove('avh-jump'); }
  }
  return {
    start() { goTo(0); },
    goTo,
    pause(v) { paused = v; if (v) clearTimeout(timer); else goTo(step); },
    get paused() { return paused; },
    stop() { clearTimeout(timer); },
  };
}

// ---------- open and close ----------
let open = null, opener = null;
function openHelp(k, from, onContinue, prepare) {
  if (store.get('av_help_skip_' + k)) { onContinue(); return; }
  if (open) return;
  const h = HELP[k]; opener = from;
  // the icons, added the first time a popup opens (the script can load in <head>, before <body> exists)
  if (!document.getElementById('avh-sprite')) document.body.insertAdjacentHTML('beforeend', SPRITE);
  document.body.insertAdjacentHTML('beforeend', `<div class="avh-hp-scrim"><div class="avh-hp-pop" role="dialog" aria-modal="true" aria-labelledby="avhTitle" aria-describedby="avhLead">
    <div class="avh-hp-top"><span class="avh-mk avh-${h.mark}" aria-hidden="true"></span><div class="avh-hp-tt"><h2 id="avhTitle">${h.title}</h2><p id="avhLead">${h.lead}</p></div><button class="avh-hp-x" data-close aria-label="Close">${ico('x')}</button></div>
    <div class="avh-hp-body">
      <div class="avh-st" role="img" aria-label="An animation of the steps listed here">${stageHTML(k)}<button class="avh-st-ctl" data-pause aria-label="Pause the animation">${ico('pause')}</button></div>
      <div><ol class="avh-hp-steps">${h.steps.map(([t, s], n) => `<li><button class="avh-hp-step" data-step="${n}"><span class="avh-hp-num">${n + 1}</span><span class="avh-hp-st"><b>${t}</b><small>${s}</small></span><span class="avh-hp-bar" aria-hidden="true"><i></i></span></button></li>`).join('')}</ol>
        ${h.note ? `<div class="avh-hp-note" role="note">${ico('alert')}<span>${h.note}</span></div>` : ''}</div>
    </div>
    <div class="avh-hp-foot"><label class="avh-hp-check"><input type="checkbox" data-skip>Don't show this again</label>${h.cancel === false ? '' : '<button class="avh-btn" data-close>Cancel</button>'}<button class="avh-btn avh-primary" data-go>${h.go}${ico(h.goIcon || 'out')}</button><span class="avh-sr" aria-live="polite" data-live></span></div>
  </div></div>`);
  const el = document.body.lastElementChild;
  el.style.setProperty('--avh-logo', `url("${AV_LOGO}")`);
  const steps = [...el.querySelectorAll('.avh-hp-step')];
  const player = makePlayer(el.querySelector('.avh-st'), k, (s, ms) => {
    steps.forEach((b, n) => { b.classList.toggle('avh-on', n === s); b.classList.toggle('avh-done', n < s); b.setAttribute('aria-current', n === s ? 'step' : 'false'); });
    const bar = steps[s].querySelector('.avh-hp-bar i');
    if (bar && bar.animate && ms && !calm()) bar.animate([{ width: '0%' }, { width: '100%' }], { duration: ms, easing: 'linear', fill: 'forwards' });
  });
  open = { el, k, player };
  // with prepare (Canva: making the design), the go button stays grey until it's done; if it fails, the button says Try again
  const go = el.querySelector('[data-go]'), live = el.querySelector('[data-live]');
  let state = 'ready', result;
  const setGo = s => {
    state = s; go.setAttribute('aria-disabled', s === 'wait' ? 'true' : 'false');
    go.classList.toggle('avh-wait', s === 'wait');
    go.innerHTML = s === 'wait' ? `<span class="avh-spin" aria-hidden="true"></span>${h.wait || 'Getting ready'}` : s === 'fail' ? 'Try again' : `${h.go}${ico(h.goIcon || 'out')}`;
  };
  const make = () => {
    setGo('wait'); live.textContent = (h.wait || 'Getting ready') + '.';
    Promise.resolve().then(prepare).then(
      v => { if (open && open.el === el) { result = v; setGo('ready'); live.textContent = h.ready || ''; } },
      () => { if (open && open.el === el) { setGo('fail'); live.textContent = h.fail || 'Something went wrong. Try again.'; } });
  };
  if (prepare) make();
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('[data-close]')) { closeHelp(); return; }
    if (e.target.closest('[data-go]')) {
      if (state === 'wait') return;
      if (state === 'fail') { make(); return; }
      if (el.querySelector('[data-skip]').checked) store.set('av_help_skip_' + k, true); closeHelp(true); onContinue(result); return;
    }
    const st = e.target.closest('[data-step]'); if (st) { player.goTo(+st.dataset.step); return; }
    const pz = e.target.closest('[data-pause]'); if (pz) { player.pause(!player.paused); pz.innerHTML = ico(player.paused ? 'play' : 'pause'); pz.setAttribute('aria-label', player.paused ? 'Play the animation' : 'Pause the animation'); }
  });
  el.addEventListener('change', e => { if (e.target.matches('[data-skip]')) store.set('av_help_skip_' + k, e.target.checked); });
  // reduced motion: start paused on step 1; tap a step (or play) to see it
  requestAnimationFrame(() => { if (calm()) { player.pause(true); player.goTo(0, false); const pz = el.querySelector('[data-pause]'); pz.innerHTML = ico('play'); pz.setAttribute('aria-label', 'Play the animation'); } else player.start(); });
  el.querySelector('[data-go]').focus({ preventScroll: true });
}
function closeHelp(keep) {
  if (!open) return; const { el, player } = open; open = null; player.stop();
  if (calm()) el.remove(); else { el.classList.add('avh-out'); setTimeout(() => el.remove(), 170); }
  if (!keep && opener && opener.focus) opener.focus({ preventScroll: true });
}

document.addEventListener('keydown', e => {
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); closeHelp(); return; }
  if (e.key === 'Tab') { const f = [...open.el.querySelectorAll('button, input')]; if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } }
});
addEventListener('resize', () => { if (open && !open.player.paused) open.player.goTo(0); });
// ---------- public API ----------
window.AveragesHelp = {
  // Show the first-time help for 'canva' or 'drive'. onContinue runs when they click Open Canva / Open Google Drive,
  // or right away if they ticked "Don't show this again" before. Call it from the click handler so new tabs aren't blocked.
  // prepare (optional): a function returning a Promise, like making the Canva design. The go button stays grey until it
  // resolves, and onContinue gets what it resolved to (the design's edit link). If it rejects, the button says Try again.
  // If they ticked "Don't show this again", onContinue runs right away with no value and prepare isn't called,
  // so keep the app's own open-a-tab-then-load flow for that case.
  open(kind, { onContinue = () => {}, prepare = null, from = document.activeElement } = {}) { if (!HELP[kind]) throw new Error('AveragesHelp: kind must be "canva" or "drive"'); openHelp(kind, from, onContinue, prepare); },
  shouldShow: kind => !store.get('av_help_skip_' + kind),
  reset(kind) { (kind ? [kind] : Object.keys(HELP)).forEach(k => store.set('av_help_skip_' + k, false)); },
  close: () => closeHelp(),
};
})();
