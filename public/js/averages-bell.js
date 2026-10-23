/*
 * Notifications (2026-10-19, Martin): the bell next to the profile picture,
 * and the "read" memory behind every notification dot in the app.
 *
 * AveragesSeen — which notifications this student has opened, on this device
 * (localStorage averages_seen, the newest 300 ids per kind). Schoology can't
 * tell us: the API calls a course update "unread" for 24 hours after it's
 * posted and a grade "new" for 2 days, whether or not it was opened. So a dot
 * shows while the item is new AND it hasn't been opened here.
 *   AveragesSeen.has(kind, id)    kind: 'u' course update, 'g' grade, 'm' message thread
 *   AveragesSeen.mark(kind, id)   also markMany(kind, ids)
 * Marking fires an `averages:seen` event, so Home, the class page and the bell
 * all drop the dot at once.
 *
 * AveragesBell — LegacyPage calls mount({ mode }) once the page's own script
 * has run, and setData(data) when the background fetch of course updates
 * lands (pages other than Home and the class page don't load them). It reads
 * window.__AVERAGES__.data (COURSES, COURSE_UPDATES, RECENT_GRADES, MESSAGES).
 * Demo sessions get the same sample items Home and Messages show.
 */
(function () {
  'use strict';
  if (window.AveragesBell) return;

  // ---------------------------------------------------------------- seen
  const SEEN_KEY = 'averages_seen';
  const SEEN_CAP = 300;
  function readSeen() {
    try {
      const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  }
  const Seen = {
    has(kind, id) {
      if (id == null || id === '') return false;
      const list = readSeen()[kind];
      return Array.isArray(list) && list.includes(String(id));
    },
    markMany(kind, ids) {
      const v = readSeen();
      const list = Array.isArray(v[kind]) ? v[kind].map(String) : [];
      let changed = false;
      (ids || []).forEach((id) => {
        const s = id == null ? '' : String(id);
        if (s && !list.includes(s)) { list.push(s); changed = true; }
      });
      if (!changed) return;
      v[kind] = list.slice(-SEEN_CAP);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch {}
      window.dispatchEvent(new CustomEvent('averages:seen', { detail: { kind } }));
    },
    mark(kind, id) { Seen.markMany(kind, [id]); },
  };
  window.AveragesSeen = Seen;
  // Another tab opened something: same dots, there too.
  window.addEventListener('storage', (e) => { if (e.key === SEEN_KEY) window.dispatchEvent(new CustomEvent('averages:seen', { detail: {} })); });

  // ---------------------------------------------------------------- data
  const CAP = 5;   // items per section
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isId = (v) => /^\d{1,20}$/.test(String(v == null ? '' : v));
  const courseQ = (c) => (isId(c) ? 'id=' : 'course=') + encodeURIComponent(c == null ? '' : c);
  const initial = (n) => String(n || '').replace(/^(Mr\.|Mrs\.|Ms\.|Mx\.|Dr\.|Sra\.|Sr\.|Coach)\s*/i, '').trim().charAt(0).toUpperCase() || '?';
  /*
   * People get Apple-style monograms (2026-10-23, Martin: notifications from
   * people were hard to tell apart): first and last initials, on each
   * person's own color since 2026-10-23 (averages-avatar.js), the same as
   * their profile picture everywhere else. No real name (a class
   * announcement): Apple's plain person on grey instead.
   */
  const monogram = (n) => {
    const words = String(n || '').replace(/^(Mr\.?|Mrs\.?|Ms\.?|Mx\.?|Dr\.?|Sra\.?|Sr\.?|Coach)\s+/i, '').split(/[\s,]+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean);
    if (!words.length) return '';
    return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : '')).toUpperCase();
  };
  const PERSON = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="12.5" r="5.5" fill="#fff"/><path d="M6.5 27.5c1-5.4 5-8.5 9.5-8.5s8.5 3.1 9.5 8.5z" fill="#fff"/></svg>';

  // The same samples Home and Messages show in a demo session.
  const DEMO = {
    COURSES: [
      { id: 'apchem', name: 'AP Chemistry', color: '#a67a22' },
      { id: 'english10', name: 'English 10', color: '#3b6fd1' },
    ],
    COURSE_UPDATES: [
      { id: 'demo-u1', from: 'Mr. Alvarez', courseId: 'apchem', when: '1h ago', unread: true, body: 'Lab report grading rubric is posted in Materials. Read it before Thursday’s lab.' },
      { id: 'demo-u2', from: 'Mr. Cho', courseId: 'english10', when: '4h ago', unread: true, body: 'Essay Draft feedback is in. Check the comments before you revise for the final draft.' },
    ],
    RECENT_GRADES: [
      { id: 'demo-g1', title: 'Unit 3 Quiz', courseId: 'apchem', letter: 'B+', pct: 88, when: 'Today', isNew: true },
    ],
    MESSAGES: [
      { id: 'cho-essay', from: 'Mr. Cho', subject: 'Essay Extension', preview: 'Sure, you can have until Monday.', time: '3h ago', unread: true },
      { id: 'alvarez-unit2', from: 'Mr. Alvarez', subject: 'Unit 2 Test Corrections', preview: 'Corrections are due Friday.', time: 'Yesterday', unread: true },
    ],
  };

  let mode = 'out';
  let extra = null;          // what setData() brought in (the background updates fetch)
  let updatesPending = false;

  function data() {
    if (mode === 'demo') return DEMO;
    const base = (window.__AVERAGES__ && window.__AVERAGES__.data) || {};
    return extra ? Object.assign({}, base, extra) : base;
  }
  const messagesOn = () => !(document.documentElement.getAttribute('data-feature-off') || '').split(/\s+/).includes('messaging-features');

  function sections() {
    const d = data();
    const courses = Array.isArray(d.COURSES) ? d.COURSES : [];
    const course = (id) => courses.find((c) => String(c.id) === String(id)) || null;
    const out = [];

    const updates = Array.isArray(d.COURSE_UPDATES) ? d.COURSE_UPDATES : null;
    if (updates || updatesPending) {
      out.push({
        key: 'u', title: 'Course updates', tab: 'Updates', loading: !updates,
        items: (updates || []).slice(0, CAP).map((u) => {
          const c = course(u.courseId);
          const from = String(u.from || '').trim();
          const named = from && from !== 'Announcement' ? from : (c && c.teacher && !String(c.teacher).includes(',') ? c.teacher : '');
          const poster = named || 'Your teacher';
          const id = u.id != null && u.id !== '' ? String(u.id) : '';
          return {
            kind: 'u', id,
            unread: !!u.unread && !Seen.has('u', id),
            person: true, who: named, mark: monogram(named),
            title: poster, sub: c ? c.name : '', body: u.body, when: u.when, label: 'Update',
            href: '/course-home?' + courseQ(u.courseId) + (id ? '&update=' + encodeURIComponent(id) : '') + '#updates',
          };
        }),
      });
    }

    const grades = Array.isArray(d.RECENT_GRADES) ? d.RECENT_GRADES : [];
    if (grades.length) {
      out.push({
        key: 'g', title: 'New grades', tab: 'Grades', all: { label: 'See all grades', href: '/grades' },
        items: grades.slice(0, CAP).map((r) => {
          const c = course(r.courseId);
          const id = r.id != null && r.id !== '' ? String(r.id) : '';
          const pct = typeof r.pct === 'number' && isFinite(r.pct) ? r.pct + '%' : '';
          return {
            kind: 'g', id,
            unread: !!r.isNew && !Seen.has('g', id),
            mark: String(r.letter || '').slice(0, 2) || initial(c ? c.name : 'G'), color: (c && c.color) || '#6b6d82',
            title: r.title || 'Assignment', sub: c ? c.name : '', when: r.when, label: 'Grade',
            score: pct || r.letter || '',
            href: '/gradebook?' + courseQ(r.courseId),
          };
        }),
      });
    }

    const msgs = messagesOn() && Array.isArray(d.MESSAGES) ? d.MESSAGES : [];
    if (msgs.length) {
      out.push({
        key: 'm', title: 'Messages', tab: 'Messages', all: { label: 'See all messages', href: '/messages' },
        items: msgs.slice(0, CAP).map((m) => {
          const id = m.id != null && m.id !== '' ? String(m.id) : '';
          return {
            kind: 'm', id,
            unread: !!m.unread && !Seen.has('m', id),
            person: true, who: m.from, mark: monogram(m.from),
            title: m.from || 'Teacher', body: m.subject || m.preview, when: m.time, label: 'Message',
            href: id ? '/messages?thread=' + encodeURIComponent(id) : '/messages',
          };
        }),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- view
  // Redesigned 2026-10-21 (Martin: the icon "looks really weird", it should swing "like a real
  // bell" when something new comes in, and the dropdown "feels really cluttered"):
  //   - a solid bell with a clapper that swings when a new notification arrives (once per item,
  //     remembered in averages_bell_rung), a small nudge on hover, and a badge that pops in;
  //   - the panel grows out of the bell instead of appearing;
  //   - one list at a time: All (new first) / Updates / Grades / Messages, each with its count,
  //     calmer rows (one bold weight, one muted body line, a single unread dot) and a footer link.
  // Potato mode and reduced motion get no movement (the potato CSS also stops every animation).
  const CSS = `
.avb-wrap { position: relative; flex-shrink: 0; margin-left: auto; margin-right: 4px; }
.avb-btn { position: relative; width: 42px; height: 42px; border-radius: 50%; padding: 0; background: none; border: 0; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.avb-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-ring, rgba(255,255,255,0.6)); }
.avb-btn svg { width: 24px; height: 24px; display: block; overflow: visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35)); }
.avb-bell, .avb-clapper { transform-box: view-box; transform-origin: 12px 2.75px; }
@media (prefers-reduced-motion: no-preference) {
  .avb-btn.ringing .avb-bell { animation: avb-ring 1.2s cubic-bezier(.36,.07,.19,.97); }
  .avb-btn.ringing .avb-clapper { animation: avb-clap 1.2s cubic-bezier(.36,.07,.19,.97) 0.06s; }
  .avb-btn:not(.ringing):hover .avb-bell { animation: avb-nudge 0.5s ease-in-out; }
  .avb-badge.pop { animation: avb-pop 0.36s cubic-bezier(.34,1.56,.64,1); }
  .avb-panel.opening { animation: avb-in 0.16s cubic-bezier(.2,.8,.2,1); }
}
@keyframes avb-ring { 0% { transform: rotate(0); } 10% { transform: rotate(18deg); } 22% { transform: rotate(-15deg); } 34% { transform: rotate(11deg); } 46% { transform: rotate(-8deg); } 58% { transform: rotate(5deg); } 70% { transform: rotate(-3deg); } 82% { transform: rotate(1.5deg); } 100% { transform: rotate(0); } }
@keyframes avb-clap { 0% { transform: rotate(0); } 10% { transform: rotate(-10deg); } 22% { transform: rotate(14deg); } 34% { transform: rotate(-10deg); } 46% { transform: rotate(7deg); } 58% { transform: rotate(-4deg); } 70% { transform: rotate(2deg); } 100% { transform: rotate(0); } }
@keyframes avb-nudge { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(-10deg); } 65% { transform: rotate(6deg); } }
@keyframes avb-pop { 0% { transform: scale(0.4); } 100% { transform: scale(1); } }
@keyframes avb-in { from { opacity: 0; transform: translateY(-4px) scale(0.97); } to { opacity: 1; transform: none; } }
.avb-badge { position: absolute; top: 2px; right: 1px; min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: #E5484D; color: #fff; font-family: "puffin", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 0.66rem; font-weight: 800; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; justify-content: center; line-height: 1; box-shadow: 0 0 0 2px rgba(0,0,0,0.18); }
.avb-badge > span { display: block; text-box: trim-both cap alphabetic; }
/* The number is centered by its own height (2026-10-21): the inner span is trimmed to cap height and baseline (text-box), so flex centers the digits; browsers without text-box (Firefox) still get flex centering. */
.avb-badge[hidden] { display: none; }

.avb-panel { position: absolute; top: calc(100% + 12px); right: -46px; width: min(360px, calc(100vw - 32px)); max-height: min(520px, calc(100vh - 120px)); display: flex; flex-direction: column; background: var(--panel-bg, #eaeaec); color: var(--text-dark, #14151f); border-radius: var(--window-radius-md, 14px); box-shadow: 0 20px 45px -16px rgba(0,0,0,0.5); z-index: 30; text-align: left; overflow: hidden; transform-origin: calc(100% - 66px) 0; }
.avb-panel[hidden] { display: none; }
.avb-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 16px 8px; }
.avb-head h2 { margin: 0; font-size: 1rem; font-weight: 800; }
.avb-read-all { border: 0; background: none; padding: 4px 8px; margin-right: -8px; border-radius: 8px; font: inherit; font-size: 0.78rem; font-weight: 700; color: var(--text-muted, #4b4d63); cursor: pointer; }
.avb-read-all:hover, .avb-read-all:focus-visible { background: var(--panel-inner, #dcdce0); color: var(--text-dark, #14151f); outline: none; }
.avb-read-all[hidden] { display: none; }
.avb-tabs { display: flex; gap: 4px; padding: 0 12px 12px; overflow-x: auto; scrollbar-width: none; }
.avb-tabs::-webkit-scrollbar { display: none; }
.avb-tab { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--panel-inner, #dcdce0); font: inherit; font-size: 0.78rem; font-weight: 700; color: var(--text-muted, #4b4d63); cursor: pointer; }
.avb-tab:hover { color: var(--text-dark, #14151f); }
.avb-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-ring, rgba(10,29,158,0.35)); }
.avb-tab[aria-pressed="true"] { background: var(--text-dark, #14151f); color: var(--panel-bg, #eaeaec); }
.avb-tab .avb-n { font-variant-numeric: tabular-nums; opacity: 0.7; }
.avb-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 8px 8px; border-top: 1px solid var(--border, #cfcfd6); padding-top: 4px; }
.avb-row { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; align-items: start; width: 100%; padding: 8px 8px 8px 20px; border: 0; border-radius: var(--window-radius-sm, 10px); background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.avb-row + .avb-row { margin-top: 2px; }
.avb-row:hover, .avb-row:focus-visible { background: var(--panel-inner, #dcdce0); outline: none; }
.avb-dot { position: absolute; left: 6px; top: 20px; width: 8px; height: 8px; border-radius: 50%; background: #E5484D; }
.avb-av { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.01em; background: linear-gradient(180deg, #A5ABB8, #858994); }
.avb-av.avb-me { background: linear-gradient(180deg, #A5ABB8, #858994); font-family: ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-weight: 600; font-size: 0.8rem; letter-spacing: 0.02em; }
.avb-av.avb-anon { overflow: hidden; }
.avb-av.avb-anon svg { width: 32px; height: 32px; display: block; opacity: 0.92; }
.avb-tx { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.avb-l1 { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.avb-t { flex: 1 1 auto; min-width: 0; font-size: 0.86rem; font-weight: 700; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avb-w { flex: none; font-size: 0.74rem; font-weight: 600; color: var(--text-faint, #6b6d82); white-space: nowrap; font-variant-numeric: tabular-nums; }
.avb-row.unread .avb-w { color: var(--text-muted, #4b4d63); }
.avb-score { flex: none; font-size: 0.8rem; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
.avb-b { font-size: 0.8rem; font-weight: 500; line-height: 1.35; color: var(--text-muted, #4b4d63); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avb-m { font-size: 0.72rem; font-weight: 600; color: var(--text-faint, #6b6d82); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avb-row:not(.unread) .avb-t { font-weight: 600; color: var(--text-muted, #4b4d63); }
.avb-empty { margin: 0; padding: 24px 12px; text-align: center; font-size: 0.84rem; font-weight: 600; color: var(--text-muted, #4b4d63); }
.avb-foot { display: block; margin: 4px 8px 0; padding: 8px; border-radius: var(--window-radius-sm, 10px); text-align: center; font-size: 0.8rem; font-weight: 700; color: var(--text-dark, #14151f); text-decoration: none; }
.avb-foot:hover, .avb-foot:focus-visible { background: var(--panel-inner, #dcdce0); outline: none; }
.avb-skel { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; padding: 8px 8px 8px 20px; pointer-events: none; }
/* Phones: the full width of the screen, just under the bell (top is set when it opens). */
@media (max-width: 520px) { .avb-panel { position: fixed; right: 16px; left: 16px; width: auto; transform-origin: calc(100% - 80px) 0; } }
`;
  // A solid bell (no outline icon set): the body and its top swing from the loop, the clapper
  // underneath lags behind it, like a real bell.
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<g class="avb-clapper"><path d="M9.6 18.6a2.4 2.4 0 0 0 4.8 0z" fill="currentColor"/></g>'
    + '<g class="avb-bell"><circle cx="12" cy="2.75" r="1.35" fill="currentColor"/>'
    + '<path d="M12 3.6c-3.45 0-6 2.7-6 6.25v3.4c0 .95-.36 1.86-1.02 2.55L3.75 17.1c-.3.32-.08.85.36.85h15.78c.44 0 .66-.53.36-.85l-1.23-1.3A3.7 3.7 0 0 1 18 13.25v-3.4c0-3.55-2.55-6.25-6-6.25z" fill="currentColor"/></g>'
    + '</svg>';

  let wrap = null, btn = null, panel = null, badge = null;
  let tab = 'all';
  let lastUnread = -1;

  // Which unread items have already rung the bell (this device): a new one rings it once.
  const RUNG_KEY = 'averages_bell_rung';
  function readRung() {
    try { const v = JSON.parse(localStorage.getItem(RUNG_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  function ringIfNew(unreadKeys) {
    if (!unreadKeys.length) return;
    const rung = readRung();
    const fresh = unreadKeys.filter((k) => !rung.includes(k));
    if (!fresh.length) return;
    try { localStorage.setItem(RUNG_KEY, JSON.stringify(rung.concat(fresh).slice(-300))); } catch {}
    const calm = document.body && document.body.classList.contains('potato-mode');
    if (calm || !btn) return;
    btn.classList.remove('ringing');
    void btn.offsetWidth;   // restart the animation if it was mid-swing
    btn.classList.add('ringing');
  }

  function bar(w, h, r) {
    const L = window.AveragesLoading;
    return L && L.skelBar ? L.skelBar(w, h, r) : `<span class="skel-bar" style="width:${w};height:${h}px${r ? ';border-radius:' + r : ''}"></span>`;
  }
  const short = (w) => String(w || '').replace(/\s+ago$/i, '');
  function rowHTML(it, showKind) {
    const av = it.person
      ? `<span class="avb-av avb-me${it.mark ? '' : ' avb-anon'}"${it.mark && window.AveragesAvatar ? ` style="background:${esc(window.AveragesAvatar.background(it.who))}"` : ''} aria-hidden="true">${it.mark ? esc(window.AveragesAvatar ? window.AveragesAvatar.initials(it.who) || it.mark : it.mark) : PERSON}</span>`
      : `<span class="avb-av"${it.color ? ` style="background:${esc(it.color)}"` : ''} aria-hidden="true">${esc(it.mark)}</span>`;
    const right = it.score ? `<span class="avb-score">${esc(it.score)}</span>` : it.when ? `<span class="avb-w">${esc(short(it.when))}</span>` : '';
    const meta = [showKind ? it.label : '', it.sub, it.score && it.when ? short(it.when) : ''].filter(Boolean).join(' · ');
    const label = [it.unread ? 'New.' : '', it.label, it.title, it.sub, it.body, it.score, it.when].filter(Boolean).join(', ');
    return `<button type="button" class="avb-row${it.unread ? ' unread' : ''}" data-kind="${it.kind}" data-id="${esc(it.id)}" data-href="${esc(it.href)}" aria-label="${esc(label)}">
      ${it.unread ? '<span class="avb-dot" aria-hidden="true"></span>' : ''}${av}
      <span class="avb-tx"><span class="avb-l1"><span class="avb-t">${esc(it.title)}</span>${right}</span>${it.body ? `<span class="avb-b">${esc(it.body)}</span>` : ''}${meta ? `<span class="avb-m">${esc(meta)}</span>` : ''}</span>
    </button>`;
  }
  function skelRows() {
    return [0, 1].map((i) => `<div class="avb-skel" data-skel>${bar('32px', 32, '50%')}<span class="skel-tx">${bar(['62%', '48%'][i], 12)}${bar('34%', 9)}</span></div>`).join('');
  }

  function listFor(secs) {
    if (tab === 'all') {
      const all = [];
      secs.forEach((s) => s.items.forEach((it) => all.push(it)));
      // New first (in section order), then the rest; at most 8.
      const items = all.filter((i) => i.unread).concat(all.filter((i) => !i.unread)).slice(0, 8);
      const loading = secs.some((s) => s.loading);
      if (!items.length && !loading) return '<p class="avb-empty">You’re all caught up.</p>';
      return `<section class="avb-sec" data-sec="all">${loading ? skelRows() : ''}${items.map((it) => rowHTML(it, true)).join('')}</section>`;
    }
    const s = secs.find((x) => x.key === tab);
    if (!s) return '<p class="avb-empty">You’re all caught up.</p>';
    const body = s.loading ? skelRows() : s.items.length ? s.items.map((it) => rowHTML(it, false)).join('') : `<p class="avb-empty">Nothing new from your teachers.</p>`;
    return `<section class="avb-sec" data-sec="${s.key}" aria-label="${esc(s.title)}">${body}</section>`
      + (s.all ? `<a class="avb-foot" href="${esc(s.all.href)}">${esc(s.all.label)}</a>` : '');
  }

  function render() {
    if (!wrap) return;
    const secs = sections();
    const unreadItems = [];
    secs.forEach((s) => s.items.forEach((i) => { if (i.unread) unreadItems.push(i); }));
    const unread = unreadItems.length;
    badge.hidden = unread === 0;
    const n = document.createElement('span');
    n.textContent = unread > 9 ? '9+' : String(unread);
    badge.replaceChildren(n);
    if (unread > lastUnread && lastUnread !== -1) { badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
    lastUnread = unread;
    btn.setAttribute('aria-label', unread ? `Notifications, ${unread} new` : 'Notifications');
    ringIfNew(unreadItems.filter((i) => i.id).map((i) => i.kind + ':' + i.id));
    if (panel.hidden) return;   // the list is drawn when it's opened
    if (tab !== 'all' && !secs.some((x) => x.key === tab)) tab = 'all';
    const count = (list) => list.filter((i) => i.unread).length;
    const tabs = [{ key: 'all', name: 'All', n: unread }].concat(secs.map((x) => ({ key: x.key, name: x.tab, n: count(x.items) })));
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.avb-tab');
    const focusKey = focused ? focused.dataset.tab : '';
    panel.innerHTML = `<div class="avb-head"><h2 id="avbTitle">Notifications</h2><button type="button" class="avb-read-all"${unread ? '' : ' hidden'}>Mark all read</button></div>`
      + (secs.length ? `<div class="avb-tabs" aria-label="Show">${tabs.map((t) => `<button type="button" class="avb-tab" data-tab="${t.key}" aria-pressed="${t.key === tab}">${esc(t.name)}${t.n ? ` <span class="avb-n">${t.n > 9 ? '9+' : t.n}</span>` : ''}</button>`).join('')}</div>` : '')
      + `<div class="avb-list">${secs.length ? listFor(secs) : '<p class="avb-empty">You’re all caught up.</p>'}</div>`;
    if (focusKey) { const b = panel.querySelector(`.avb-tab[data-tab="${focusKey}"]`); if (b) b.focus(); }
  }

  function open() {
    if (matchMedia('(max-width: 520px)').matches) {
      const top = Math.round(btn.getBoundingClientRect().bottom + 12);
      panel.style.top = top + 'px';
      panel.style.maxHeight = `calc(100vh - ${top + 16}px)`;
    } else {
      panel.style.top = '';
      panel.style.maxHeight = '';
    }
    panel.hidden = false;
    panel.classList.remove('opening');
    void panel.offsetWidth;
    panel.classList.add('opening');
    btn.setAttribute('aria-expanded', 'true');
    render();
  }
  function close(focus) {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focus) btn.focus();
  }

  function mount(opts) {
    mode = (opts && opts.mode) || window.__AVERAGES_MODE__ || mode;
    if (wrap && wrap.isConnected) { render(); return true; }
    const profile = document.getElementById('profileBtn');
    const anchor = profile && (profile.closest('.profile-menu-wrap') || profile);
    if (!anchor || !anchor.parentNode) return false;
    if (!document.getElementById('avbStyle')) {
      const st = document.createElement('style');
      st.id = 'avbStyle';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    wrap = document.createElement('div');
    wrap.className = 'avb-wrap';
    wrap.innerHTML = `<button class="avb-btn" id="avbBtn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="avbPanel" aria-label="Notifications">${BELL}<span class="avb-badge" hidden></span></button>
      <div class="avb-panel" id="avbPanel" role="dialog" aria-labelledby="avbTitle" hidden></div>`;
    anchor.parentNode.insertBefore(wrap, anchor);
    btn = wrap.querySelector('.avb-btn');
    panel = wrap.querySelector('.avb-panel');
    badge = wrap.querySelector('.avb-badge');

    btn.addEventListener('click', () => (panel.hidden ? open() : close(false)));
    btn.addEventListener('animationend', (e) => { if (e.animationName === 'avb-ring') btn.classList.remove('ringing'); });
    badge.addEventListener('animationend', () => badge.classList.remove('pop'));
    panel.addEventListener('animationend', () => panel.classList.remove('opening'));
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('.avb-tab');
      if (t) { tab = t.dataset.tab; render(); return; }
      if (e.target.closest('.avb-read-all')) {
        sections().forEach((s) => Seen.markMany(s.key, s.items.filter((i) => i.unread).map((i) => i.id)));
        return;
      }
      const row = e.target.closest('.avb-row');
      if (!row) return;
      if (row.dataset.id) Seen.mark(row.dataset.kind, row.dataset.id);
      window.location.href = row.dataset.href;
    });
    // By the click's path, not e.target: a tab redraws the panel, so its button is already detached here.
    document.addEventListener('click', (e) => { if (!panel.hidden && !(e.composedPath ? e.composedPath().includes(wrap) : wrap.contains(e.target))) close(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(true); });
    window.addEventListener('averages:seen', render);
    render();
    return true;
  }

  window.AveragesBell = {
    mount,
    /** Course updates are on their way (pages that don't load them themselves). */
    expectUpdates() { updatesPending = true; render(); },
    /** The background fetch landed. Pass null when it failed: the section goes away. */
    setData(more) {
      // Open with the placeholders showing: the real rows rise in where they were.
      const wasLoading = !!(panel && !panel.hidden && panel.querySelector('[data-skel]'));
      updatesPending = false;
      extra = more && typeof more === 'object' ? more : null;
      render();
      const L = window.AveragesLoading;
      if (wasLoading && L && L.rise && !(L.calm && L.calm())) {
        panel.querySelectorAll('.avb-row[data-kind="u"]').forEach((el, i) => L.rise(el, i));
      }
    },
  };
})();
