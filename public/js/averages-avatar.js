/*
 * AveragesAvatar (2026-10-23, Martin: the default profile picture for the
 * student and teachers should have "random colors as in the background not
 * the letter", and "make sure that all letters are always visible").
 *
 * One look for every person without a photo: Apple-style initials (first
 * and last name, or one letter; Mr./Mrs./Dr. and the like left out) in
 * white, on a colored gradient. The color is picked from the person's name,
 * so it's random across people but the same for one person everywhere: the
 * profile button, Settings, the bell, Messages, Contacts, Home and the class
 * pages.
 *
 * Every color keeps white letters readable: at least 4.6:1 against even the
 * lighter top of its gradient (WCAG AA asks 4.5:1 for normal text).
 *
 *   AveragesAvatar.initials(name)    'RP' for "Ms. Rachel Patel", '' when there's no name
 *   AveragesAvatar.background(name)  the CSS gradient for that person
 *   AveragesAvatar.color(name)       its darker color (for a solid fill)
 *   AveragesAvatar.paint(el, name)   sets an element's background and initials
 *
 * Loaded in <head> by app/layout.tsx, before the page scripts.
 */
(function () {
  'use strict';
  if (window.AveragesAvatar) return;

  // [top, bottom] of each gradient. White on the top color: 4.62 to 4.67:1; on the bottom: 6.2 to 6.9:1.
  const PALETTE = [
    ['#BE534C', '#B2322A'], // red
    ['#AA6330', '#9A4509'], // orange
    ['#956E29', '#815200'], // amber
    ['#6B7B39', '#4F6113'], // olive
    ['#418255', '#1D6A34'], // green
    ['#31807C', '#096863'], // teal
    ['#307D98', '#096484'], // cyan
    ['#4973C4', '#2658B9'], // blue
    ['#686AC9', '#4B4EBF'], // indigo
    ['#8B5FC2', '#7541B6'], // purple
    ['#A856A1', '#983590'], // magenta
    ['#BB4F7A', '#AF2E60'], // pink
    ['#6E7582', '#535B6B'], // slate
    ['#916D56', '#7C5136'], // brown
  ];
  // No name at all: the plain grey Apple uses.
  const NOBODY = ['#A5ABB8', '#858994'];
  const TITLE = /^(?:mr|mrs|ms|mx|miss|dr|sr|sra|srta|prof|coach|nurse|mme|mlle|herr|frau)\.?\s+/i;

  /** The name without a title, spaces tidied. */
  function clean(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().replace(TITLE, '').trim();
  }
  function words(name) {
    return clean(name).split(/[\s,]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  }
  /** First and last initials (one when there's one word), at most two letters, always uppercase. */
  function initials(name) {
    const w = words(name);
    if (!w.length) return '';
    const first = (s) => Array.from(s)[0] || '';
    return (first(w[0]) + (w.length > 1 ? first(w[w.length - 1]) : '')).toUpperCase();
  }
  /** FNV-1a: the same name always lands on the same color. */
  function hash(s) {
    let h = 0x811c9dc5;
    for (const ch of s) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }
  function pair(name) {
    const key = words(name).join(' ').toLowerCase();
    return key ? PALETTE[hash(key) % PALETTE.length] : NOBODY;
  }
  function background(name) {
    const [top, bottom] = pair(name);
    return `linear-gradient(180deg, ${top}, ${bottom})`;
  }
  function color(name) {
    return pair(name)[1];
  }
  /** Fills a default avatar: its color and initials, white. Leaves the element's own size and font alone. */
  function paint(el, name) {
    if (!el) return;
    el.style.backgroundImage = background(name);
    el.style.backgroundColor = color(name);
    el.style.color = '#fff';
    el.textContent = initials(name);
  }

  window.AveragesAvatar = { initials, background, color, paint, PALETTE };
})();
