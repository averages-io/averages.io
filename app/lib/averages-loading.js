// Averages.io loading animations (needs averages-loading.css)
//
//   import { skelBar, chartSkeleton, revealRows, startSpin } from './averages-loading.js';
//
//   1. While loading, fill a list with placeholder rows:
//        list.innerHTML = [0, 1, 2].map(i => `<div class="row" data-skel>${skelBar('28px', 28, '8px')}
//          <span class="skel-tx">${skelBar(['60%', '46%', '54%'][i], 12)}${skelBar('34%', 9)}</span></div>`).join('');
//   2. Charts get a skeleton that keeps drawing:   const stopChart = chartSkeleton(chartEl, { kind: 'line' });
//   3. The refresh icon spins:                     const stopSpin = startSpin(button.querySelector('svg'));
//   4. When a section's data arrives:              revealRows(list, () => renderRealRows(list));
//      When a chart's data arrives:                stopChart(); revealRows(chartEl, () => drawChart(chartEl));  // draw it with <svg class="enter">
//   5. When everything is in:                      stopSpin();
//
// Each section lands on its own as its request comes back, so nothing waits on the slowest one.
// Motion is off when <body> has .potato-mode or the system asks for reduced motion: everything still works, it just doesn't move.

export const calm = () => document.body.classList.contains('potato-mode') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// one shimmering bar; w is any CSS width ('60%', '28px'), h is pixels, r an optional border radius
export const skelBar = (w, h = 10, r) => `<span class="skel-bar" style="width:${w};height:${h}px${r ? ';border-radius:' + r : ''}"></span>`;

// ---------- chart skeleton ----------
// Faint gridlines and axis labels, then a line (or bars) that draws itself, fades, and draws again with new made-up values
// every ~2 seconds, so it reads as "loading a chart". Returns a function that stops it.
export function chartSkeleton(el, { kind = 'line', points = kind === 'bar' ? 8 : 5 } = {}) {
  let timer = 0;
  const w = el.clientWidth || 320, h = el.clientHeight || 150, L = 34, R = 6, T = 8, B = 22, y = f => T + f * (h - T - B);
  let g = [0, .5, 1].map(f => `<line class="g" x1="${L}" x2="${w - R}" y1="${y(f)}" y2="${y(f)}"/><rect class="axs" x="${L - 30}" y="${y(f) - 4}" width="22" height="8" rx="4"/>`).join('');
  g += [0, .5, 1].map(f => `<rect class="axs" x="${L + f * (w - L - R) - 18 - (f === 1 ? 18 : f ? 0 : -18)}" y="${h - 11}" width="36" height="8" rx="4"/>`).join('');
  el.innerHTML = `<svg class="cskel" viewBox="0 0 ${w} ${h}" aria-hidden="true">${g}<g class="sk-run"></g></svg>`;
  const svg = el.firstChild, run = svg.lastChild, N = points;
  // a random walk, so every pass looks like a different week of grades
  const walk = () => { let v = .25 + Math.random() * .5; return Array.from({ length: N }, () => (v = Math.min(.88, Math.max(.12, v + (Math.random() - .5) * .38)))); };
  const cycle = () => {
    if (!svg.isConnected) return;
    const F = walk();
    if (kind === 'bar') {
      const slot = (w - L - R) / N, bw = Math.min(48, slot * .84);
      run.innerHTML = F.map((f, i) => `<rect class="sbar" style="--i:${i}" x="${L + slot * (i + .5) - bw / 2}" y="${y(f)}" width="${bw}" height="${y(1) - y(f)}" rx="4"/>`).join('');
    } else {
      const x = i => L + i * (w - L - R) / (N - 1), d = F.map((f, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(f).toFixed(1)).join(' ');
      run.innerHTML = `<path class="sarea" d="${d} L ${x(N - 1)} ${y(1)} L ${L} ${y(1)} Z"/><path class="sdraw" pathLength="100" d="${d}"/>` +
        F.map((f, i) => `<circle class="spt" cx="${x(i)}" cy="${y(f)}" r="3" style="--d:${Math.max(0, Math.round(Math.acos(1 - 2 * i / (N - 1)) / Math.PI * 1000) - 60)}ms"/>`).join('');
    }
    run.classList.remove('out');
    if (calm()) return;
    timer = setTimeout(() => { run.classList.add('out'); timer = setTimeout(cycle, 320); }, 1750);
  };
  cycle();
  return () => clearTimeout(timer);
}

// ---------- reveal ----------
// A section's data arrived: a frozen copy of the placeholders fades out on top, the real rows rise in underneath
// (35ms apart, capped so a long list doesn't drag), and the box eases to its new height.
//   el:     the element whose children are the rows (its innerHTML gets replaced by render)
//   render: draws the real content into el
//   grow:   optional outer box whose height should animate (defaults to el)
export function revealRows(el, render, { grow = el } = {}) {
  const h0 = grow.offsetHeight;
  const g = !calm() && el.offsetParent ? ghost(el) : null;
  render();
  if (calm()) return;
  [...el.children].forEach(rise);
  const h1 = grow.offsetHeight;
  if (h0 && Math.abs(h1 - h0) > 2 && grow.animate) {
    grow.style.overflow = 'hidden';
    grow.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 520, easing: 'cubic-bezier(.16, 1, .3, 1)' }).onfinish = () => { grow.style.overflow = ''; };
  }
  if (g) setTimeout(() => g.remove(), 420);
}

// one row rising in; i is its place in the list
export function rise(el, i) {
  const d = 40 + Math.min(i * 35, 245);
  el.style.animation = `averagesRise 560ms cubic-bezier(.16, 1, .3, 1) ${d}ms both, averagesFadeIn 420ms cubic-bezier(.33, 1, .68, 1) ${d}ms both`;
  el.addEventListener('animationend', function end(e) {
    if (e.target === el && e.animationName === 'averagesRise') { el.style.animation = ''; el.removeEventListener('animationend', end); }
  });
}

// a copy of el laid exactly over it, with its shimmer frozen where it was, that fades out
function ghost(el) {
  const par = el.parentNode;
  if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
  const g = el.cloneNode(true);
  g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true'); g.classList.add('skel-ghost');
  freezeInto(el, g);
  Object.assign(g.style, { position: 'absolute', left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px', margin: '0' });
  par.appendChild(g);
  return g;
}
const SKIP = new Set(['offset', 'easing', 'composite', 'computedOffset']);
const hyph = p => p.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
function freezeInto(src, dst) {
  if (!src.getAnimations) return;
  const a = [src, ...src.querySelectorAll('*')], b = [dst, ...dst.querySelectorAll('*')];
  a.forEach((el, i) => {
    const anims = el.getAnimations();
    if (!anims.length || !b[i]) return;
    const props = new Set(), cs = getComputedStyle(el);
    anims.forEach(an => {
      if (an.transitionProperty) props.add(an.transitionProperty);
      else if (an.effect && an.effect.getKeyframes) an.effect.getKeyframes().forEach(k => Object.keys(k).forEach(p => { if (!SKIP.has(p)) props.add(hyph(p)); }));
    });
    props.forEach(p => b[i].style.setProperty(p, cs.getPropertyValue(p)));
  });
}

// ---------- refresh spin ----------
// Spins while loading. The returned stop() finishes the turn, swings a little past the start, then settles back.
const SPIN_MS = 800;
export function startSpin(svg) {
  if (calm() || !svg || !svg.animate) return () => {};
  svg.style.transformOrigin = '50% 50%';
  const spin = svg.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: SPIN_MS, iterations: Infinity, easing: 'linear' });
  return function stop() {
    const a = ((spin.currentTime || 0) % SPIN_MS) / SPIN_MS * 360;
    spin.cancel();
    const left = 360 - a, over = 40, toOver = (left + over) / 360 * SPIN_MS * 1.35, back = 380;
    svg.animate([
      { transform: `rotate(${a}deg)`, easing: 'cubic-bezier(.25, .7, .35, 1)' },
      { transform: `rotate(${360 + over}deg)`, offset: toOver / (toOver + back), easing: 'cubic-bezier(.45, 0, .3, 1)' },
      { transform: 'rotate(360deg)' },
    ], { duration: toOver + back });
  };
}
