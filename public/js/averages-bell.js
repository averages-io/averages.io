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
        key: 'u', title: 'Course updates', loading: !updates,
        items: (updates || []).slice(0, CAP).map((u) => {
          const c = course(u.courseId);
          const from = String(u.from || '').trim();
          const poster = from && from !== 'Announcement' ? from : (c && c.teacher && !String(c.teacher).includes(',') ? c.teacher : 'Your teacher');
          const id = u.id != null && u.id !== '' ? String(u.id) : '';
          return {
            kind: 'u', id,
            unread: !!u.unread && !Seen.has('u', id),
            mark: initial(poster), color: (c && c.color) || '#6b6d82',
            title: poster, sub: c ? c.name : '', body: u.body, when: u.when,
            href: '/course-home?' + courseQ(u.courseId) + (id ? '&update=' + encodeURIComponent(id) : '') + '#updates',
          };
        }),
      });
    }

    const grades = Array.isArray(d.RECENT_GRADES) ? d.RECENT_GRADES : [];
    if (grades.length) {
      out.push({
        key: 'g', title: 'New grades', all: { label: 'See grades', href: '/grades' },
        items: grades.slice(0, CAP).map((r) => {
          const c = course(r.courseId);
          const id = r.id != null && r.id !== '' ? String(r.id) : '';
          const pct = typeof r.pct === 'number' && isFinite(r.pct) ? r.pct + '%' : '';
          return {
            kind: 'g', id,
            unread: !!r.isNew && !Seen.has('g', id),
            tick: (c && c.color) || '#6b6d82',
            title: r.title || 'Assignment', sub: c ? c.name : '', when: r.when,
            score: [r.letter, pct].filter(Boolean).join(' '),
            href: '/gradebook?' + courseQ(r.courseId),
          };
        }),
      });
    }

    const msgs = messagesOn() && Array.isArray(d.MESSAGES) ? d.MESSAGES : [];
    if (msgs.length) {
      out.push({
        key: 'm', title: 'Messages', all: { label: 'See messages', href: '/messages' },
        items: msgs.slice(0, CAP).map((m) => {
          const id = m.id != null && m.id !== '' ? String(m.id) : '';
          return {
            kind: 'm', id,
            unread: !!m.unread && !Seen.has('m', id),
            mark: initial(m.from), color: '#4b4d63',
            title: m.from || 'Teacher', body: m.subject || m.preview, when: m.time,
            href: id ? '/messages?thread=' + encodeURIComponent(id) : '/messages',
          };
        }),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- view
  const CSS = `
.avb-wrap { position: relative; flex-shrink: 0; margin-left: auto; margin-right: 12px; }
.avb-btn { position: relative; width: 42px; height: 42px; border-radius: 50%; padding: 0; background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.5); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.14s ease; }
.avb-btn:hover, .avb-btn[aria-expanded="true"] { background: rgba(255,255,255,0.32); }
.avb-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-ring, rgba(255,255,255,0.6)); }
.avb-btn svg { width: 20px; height: 20px; display: block; }
.avb-badge { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: #E5484D; color: #fff; font-family: inherit; font-size: 0.7rem; font-weight: 800; line-height: 20px; text-align: center; box-shadow: 0 0 0 2px rgba(0,0,0,0.18); }
.avb-badge[hidden] { display: none; }
.avb-panel { position: absolute; top: calc(100% + 12px); right: -54px; width: min(380px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 120px)); overflow-y: auto; background: var(--panel-bg, #eaeaec); color: var(--text-dark, #14151f); border-radius: var(--window-radius-md, 14px); box-shadow: 0 20px 45px -16px rgba(0,0,0,0.5); padding: 8px; z-index: 30; text-align: left; }
.avb-panel[hidden] { display: none; }
.avb-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 8px 4px 12px; }
.avb-head h2 { margin: 0; font-size: 1rem; font-weight: 800; }
.avb-read-all { border: 0; background: none; padding: 4px 8px; border-radius: 8px; font: inherit; font-size: 0.8rem; font-weight: 800; color: var(--accent, #0a1d9e); cursor: pointer; }
.avb-read-all:hover { background: var(--panel-inner, #dcdce0); }
.avb-read-all[hidden] { display: none; }
.avb-sec { padding: 4px 0; }
.avb-sec + .avb-sec { border-top: 1px solid var(--border, #cfcfd6); margin-top: 4px; padding-top: 8px; }
.avb-sec-head { display: flex; align-items: baseline; justify-content: space-between; padding: 4px 12px; }
.avb-sec-title { margin: 0; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted, #4b4d63); }
.avb-sec-all { font-size: 0.78rem; font-weight: 800; color: var(--accent, #0a1d9e); text-decoration: none; }
.avb-sec-all:hover { text-decoration: underline; }
.avb-rows { display: flex; flex-direction: column; }
.avb-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 12px; align-items: start; width: 100%; padding: 8px 12px; border: 0; border-radius: var(--window-radius-sm, 10px); background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.avb-row:hover, .avb-row:focus-visible { background: var(--panel-inner, #dcdce0); outline: none; }
.avb-mark { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 0.82rem; font-weight: 800; }
.avb-tick { width: 6px; height: 32px; border-radius: 3px; justify-self: center; }
.avb-tx { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.avb-t { font-size: 0.86rem; font-weight: 800; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avb-row.unread .avb-t { font-weight: 900; }
.avb-sub { font-weight: 700; color: var(--text-muted, #4b4d63); }
.avb-b { font-size: 0.8rem; font-weight: 600; line-height: 1.35; color: var(--text-muted, #4b4d63); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.avb-row.unread .avb-b { color: var(--text-dark, #14151f); }
.avb-m { font-size: 0.74rem; font-weight: 700; color: var(--text-muted, #4b4d63); }
.avb-end { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
.avb-score { font-size: 0.8rem; font-weight: 800; white-space: nowrap; }
.avb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #0a1d9e); flex: none; }
.avb-empty { margin: 0; padding: 16px 12px 12px; font-size: 0.86rem; font-weight: 700; color: var(--text-muted, #4b4d63); }
.avb-skel { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; padding: 8px 12px; pointer-events: none; }
/* Phones: the full width of the screen, just under the bell (top is set when it opens). */
@media (max-width: 520px) { .avb-panel { position: fixed; right: 16px; left: 16px; width: auto; } }
`;
  const BELL = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.75 2H4.25z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="miter"/><path d="M9.75 21h4.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="butt"/><path d="M12 3v2" stroke="currentColor" stroke-width="1.75" stroke-linecap="butt"/></svg>';

  let wrap = null, btn = null, panel = null, badge = null;

  function bar(w, h, r) {
    const L = window.AveragesLoading;
    return L && L.skelBar ? L.skelBar(w, h, r) : `<span class="skel-bar" style="width:${w};height:${h}px${r ? ';border-radius:' + r : ''}"></span>`;
  }
  function rowHTML(it) {
    const lead = it.tick
      ? `<span class="avb-tick" style="background:${esc(it.tick)}" aria-hidden="true"></span>`
      : `<span class="avb-mark" style="background:${esc(it.color)}" aria-hidden="true">${esc(it.mark)}</span>`;
    const title = esc(it.title) + (it.sub ? ` <span class="avb-sub">· ${esc(it.sub)}</span>` : '');
    const label = [it.unread ? 'New.' : '', it.title, it.sub, it.body, it.score, it.when].filter(Boolean).join(', ');
    return `<button type="button" class="avb-row${it.unread ? ' unread' : ''}" data-kind="${it.kind}" data-id="${esc(it.id)}" data-href="${esc(it.href)}" aria-label="${esc(label)}">
      ${lead}
      <span class="avb-tx"><span class="avb-t">${title}</span>${it.body ? `<span class="avb-b">${esc(it.body)}</span>` : ''}${it.when ? `<span class="avb-m">${esc(it.when)}</span>` : ''}</span>
      <span class="avb-end">${it.score ? `<span class="avb-score">${esc(it.score)}</span>` : ''}${it.unread ? '<span class="avb-dot"></span>' : ''}</span>
    </button>`;
  }
  function skelRows() {
    return [0, 1].map((i) => `<div class="avb-skel" data-skel>${bar('32px', 32, '50%')}<span class="skel-tx">${bar(['62%', '48%'][i], 12)}${bar('34%', 9)}</span></div>`).join('');
  }

  function render() {
    if (!wrap) return;
    const secs = sections();
    const unread = secs.reduce((n, s) => n + s.items.filter((i) => i.unread).length, 0);
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    btn.setAttribute('aria-label', unread ? `Notifications, ${unread} new` : 'Notifications');
    if (panel.hidden) return;   // the list is drawn when it's opened
    const any = secs.some((s) => s.items.length || s.loading);
    panel.innerHTML = `<div class="avb-head"><h2 id="avbTitle">Notifications</h2><button type="button" class="avb-read-all"${unread ? '' : ' hidden'}>Mark all read</button></div>` +
      (any ? secs.map((s) => `<section class="avb-sec" data-sec="${s.key}" aria-label="${esc(s.title)}">
          <div class="avb-sec-head"><h3 class="avb-sec-title">${esc(s.title)}</h3>${s.all ? `<a class="avb-sec-all" href="${esc(s.all.href)}">${esc(s.all.label)}</a>` : ''}</div>
          <div class="avb-rows">${s.loading ? skelRows() : s.items.length ? s.items.map(rowHTML).join('') : '<p class="avb-empty">Nothing new from your teachers.</p>'}</div>
        </section>`).join('') : '<p class="avb-empty">You’re all caught up. New grades, teacher updates and messages show up here.</p>');
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
    panel.addEventListener('click', (e) => {
      if (e.target.closest('.avb-read-all')) {
        sections().forEach((s) => Seen.markMany(s.key, s.items.filter((i) => i.unread).map((i) => i.id)));
        return;
      }
      const row = e.target.closest('.avb-row');
      if (!row) return;
      if (row.dataset.id) Seen.mark(row.dataset.kind, row.dataset.id);
      window.location.href = row.dataset.href;
    });
    document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.avb-wrap')) close(false); });
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
      const wasLoading = !!(panel && !panel.hidden && panel.querySelector('[data-sec="u"] [data-skel]'));
      updatesPending = false;
      extra = more && typeof more === 'object' ? more : null;
      render();
      const L = window.AveragesLoading;
      if (wasLoading && L && L.rise && !(L.calm && L.calm())) {
        panel.querySelectorAll('[data-sec="u"] .avb-row').forEach((el, i) => L.rise(el, i));
      }
    },
  };
})();
