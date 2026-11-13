/**
 * The grade report PDF (2026-11-12): Grades' "Report card" button makes a one-page PDF of the student's
 * current grades on Martin's letterhead design, made right here on the device (nothing is sent anywhere).
 *
 *   AveragesReport.download(data)  -> makes it and saves "Averages grade report - <name> - <date>.pdf"
 *   AveragesReport.make(data)      -> Promise<Uint8Array> (the PDF's bytes)
 *
 * data: {
 *   name, studentId,                          // the student (studentId may be '')
 *   source: 'Schoology' | 'Google Classroom',
 *   classes: [{ period, name, teacher, pct }],   // pct: number, or null for a class with nothing graded
 *   overall: { letter, pct } | null,
 *   gpa: { unweighted, weighted } | null,
 *   cuts: [[97, 'A+'], ...], points: { 'A+': 4, ... }, bonus: { honors, ap },
 *   ap: ['AP Chemistry'], honors: [],         // classes the weighted GPA counted as AP / Honors
 *   date: Date (optional, now)
 * }
 *
 * The page itself (stripe, logo, rule, column names, bottom logo) is public/report/v1/report-template.pdf,
 * Martin's design with the per-student text taken out. Page 2 of that file is the logo mark, drawn small
 * inside the seal. Everything else is drawn on top here, at the same places as the approved sample.
 * pdf-lib and fontkit (MIT) are in public/vendor; the fonts are Inter (OFL), subset to Latin.
 */
(function () {
  'use strict';
  if (window.AveragesReport) return;

  var KIT = '/report/v1/';
  var LIBS = ['/vendor/pdf-lib-1.17.1/pdf-lib.min.js', '/vendor/pdf-lib-fontkit-1.1.1/fontkit.umd.min.js'];

  function script(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = ok; s.onerror = function () { no(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  var libs = null;
  function loadLibs() {
    if (window.PDFLib && window.fontkit) return Promise.resolve();
    if (!libs) libs = script(LIBS[0]).then(function () { return script(LIBS[1]); }).catch(function (e) { libs = null; throw e; });
    return libs;
  }
  function bytes(path) {
    return fetch(KIT + path).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.arrayBuffer(); });
  }

  /* ---------- small helpers ---------- */
  var H = 841.8898;                       // A4 height, pt; positions below are measured from the top like the design
  function hex(h) { var n = parseInt(h.slice(1), 16), P = window.PDFLib; return P.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /** 4 -> "4.0", 3.7 -> "3.7", 3.67 -> "3.67": one decimal, or two when the setting has two. */
  function num(v) { v = Math.round(Number(v) * 100) / 100; return Math.round(v * 10) === v * 10 ? v.toFixed(1) : v.toFixed(2); }
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  function count(n) { return n < WORDS.length ? WORDS[n] : String(n); }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  /** Text the font can draw: characters it doesn't have become '?' (so nothing throws on a rare name). */
  function safe(font, s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    var set = font.getCharacterSet ? font.getCharacterSet() : null;
    if (!set) return s;
    var ok = {}; set.forEach(function (c) { ok[c] = 1; });
    return Array.from(s).map(function (ch) { return ok[ch.codePointAt(0)] ? ch : '?'; }).join('');
  }
  /** Cut to fit a width, with an ellipsis. */
  function fit(font, s, size, max) {
    s = safe(font, s);
    if (font.widthOfTextAtSize(s, size) <= max) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + '\u2026', size) > max) s = s.slice(0, -1).replace(/\s+$/, '');
    return s + '\u2026';
  }
  /** Word-wrap runs of [text, font, color] into lines no wider than max. */
  function wrap(runs, size, max) {
    var words = [];
    runs.forEach(function (r) { r[0].split(/(\s+)/).forEach(function (w) { if (w) words.push({ t: w, f: r[1], c: r[2] }); }); });
    var lines = [[]], width = 0;
    words.forEach(function (w) {
      var ww = w.f.widthOfTextAtSize(w.t, size), space = /^\s+$/.test(w.t);
      if (!space && width + ww > max && lines[lines.length - 1].length) { lines.push([]); width = 0; }
      if (space && !lines[lines.length - 1].length) return;
      lines[lines.length - 1].push(w); width += ww;
    });
    return lines;
  }

  function make(data) {
    data = data || {};
    return loadLibs().then(function () {
      return Promise.all([bytes('report-template.pdf'), bytes('Inter-Regular.ttf'), bytes('Inter-Bold.ttf'), bytes('Inter-ExtraBold.ttf')]);
    }).then(function (got) {
      var P = window.PDFLib;
      return P.PDFDocument.load(got[0]).then(function (doc) {
        doc.registerFontkit(window.fontkit);
        return Promise.all([doc.embedFont(got[1], { subset: true }), doc.embedFont(got[2], { subset: true }), doc.embedFont(got[3], { subset: true }), doc.embedPdf(got[0], [1])]).then(function (F) {
          return draw(doc, P, F[0], F[1], F[2], F[3][0], data);
        });
      });
    });
  }

  function draw(doc, P, REG, BOLD, XB, MARK, data) {
    var page = doc.getPage(0);
    var INK = hex('#000000'), INK1 = hex('#14151f'), INK2 = hex('#44465a'), MUTED = hex('#5a5c70'), LINE = hex('#dcdce0'), BOX = hex('#c9cad6'), PUNCH = hex('#e5484d'), DEEP = hex('#b8352f');
    var L = 59.5, R = 536, RT = 529.7, W = R - L;   // the table's left and right edges, and where right-aligned text ends
    function text(s, x, base, font, size, color) { if (s) page.drawText(s, { x: x, y: H - base, font: font, size: size, color: color || INK }); }
    function right(s, xr, base, font, size, color) { text(s, xr - font.widthOfTextAtSize(s, size), base, font, size, color); }
    function center(s, xc, base, font, size, color) { text(s, xc - font.widthOfTextAtSize(s, size) / 2, base, font, size, color); }
    function rule(x1, x2, top, thick, color) { page.drawRectangle({ x: x1, y: H - top - thick, width: x2 - x1, height: thick, color: color }); }
    function caps(s, x, base, color) { // small capitals labels: 7pt bold, spaced out
      s = s.toUpperCase(); var at = x;
      Array.from(s).forEach(function (ch) { text(ch, at, base, BOLD, 7, color || MUTED); at += BOLD.widthOfTextAtSize(ch, 7) + 0.84; });
    }
    function roundBox(x, top, w, h, r) {
      var d = 'M' + r + ',0 H' + (w - r) + ' Q' + w + ',0 ' + w + ',' + r + ' V' + (h - r) + ' Q' + w + ',' + h + ' ' + (w - r) + ',' + h + ' H' + r + ' Q0,' + h + ' 0,' + (h - r) + ' V' + r + ' Q0,0 ' + r + ',0 Z';
      page.drawSvgPath(d, { x: x, y: H - top, borderColor: BOX, borderWidth: 0.75 });
    }

    var when = data.date instanceof Date ? data.date : new Date();
    var dateStr = pad(when.getMonth() + 1) + '/' + pad(when.getDate()) + '/' + when.getFullYear();
    var timeStr = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var source = data.source || 'Schoology';

    /* ---- the header: date under the title, the student on the right ---- */
    text(dateStr, 170.9, 91.46, BOLD, 12, INK);
    right(fit(REG, data.name || 'Student', 12, 200), RT, 61.5, REG, 12);
    if (data.studentId) right(fit(REG, data.studentId, 12, 200), RT, 75.75, REG, 12);

    /* ---- the classes: rows under the design's column names ---- */
    var rows = (data.classes || []).slice(), n = Math.max(rows.length, 1);
    // Rows are 30pt apart like the design; with many classes they close up (and the text gets smaller) so the
    // grading scale still ends above the seal: the last row's line stays at or above 435pt from the top.
    var rh = n > 1 ? Math.min(30, 242 / (n - 1)) : 30, size = rh >= 24 ? 12 : rh >= 19 ? 10.5 : rh >= 15 ? 9 : 7.5;
    var top0 = 172, baseOff = 10.25 * size / 12, lineOff = Math.min(21, rh - 4);
    rule(L, R, 161.2, 0.8, INK1);
    rows.forEach(function (c, i) {
      var top = top0 + i * rh, base = top + baseOff;
      text(fit(REG, c.period == null || c.period === '' ? '\u2014' : c.period, size, 120), L, base, REG, size);
      text(fit(REG, c.name || 'Class', size, 383.3 - 194.1 - 10), 194.1, base, REG, size);
      var markW;
      if (typeof c.pct === 'number' && isFinite(c.pct)) {
        var letter = safe(BOLD, c.letter || ''), pct = ' ' + c.pct.toFixed(1) + '%';
        var wl = BOLD.widthOfTextAtSize(letter, size), wp = REG.widthOfTextAtSize(pct, size);
        text(letter, RT - wp - wl, base, BOLD, size, INK); text(pct, RT - wp, base, REG, size, INK2);
        markW = wl + wp;
      } else {
        right('No grade yet', RT, base, REG, size, MUTED); markW = REG.widthOfTextAtSize('No grade yet', size);
      }
      text(fit(REG, c.teacher || '', size, RT - markW - 10 - 383.3), 383.3, base, REG, size);
      rule(L, R, top + lineOff - 0.4, 0.8, LINE);
    });
    var lastLine = top0 + (rows.length ? (rows.length - 1) * rh : 0) + lineOff;

    /* ---- overall grade and both GPAs ---- */
    var S = Math.max(372, lastLine + 29), bw = (W - 20) / 3, gpa = data.gpa || {}, ov = data.overall;
    [['Overall grade', ov ? ov.letter : '\u2014', ov ? ov.pct.toFixed(1) + '%' : ''],
     ['Unweighted GPA', typeof gpa.unweighted === 'number' ? gpa.unweighted.toFixed(2) : '\u2014', ''],
     ['Weighted GPA', typeof gpa.weighted === 'number' ? gpa.weighted.toFixed(2) : '\u2014', '']].forEach(function (b, i) {
      var x = L + i * (bw + 10);
      roundBox(x, S, bw, 55, 4);
      caps(b[0], x + 11.74, S + 21.75);
      text(b[1], x + 11.74, S + 43.5, XB, 18, INK);
      if (b[2]) text(b[2], x + 11.74 + XB.widthOfTextAtSize(b[1] + ' ', 18), S + 43.5, REG, 10, INK2);
    });

    /* ---- how those were worked out ---- */
    var graded = rows.filter(function (c) { return typeof c.pct === 'number'; }).length, B = data.bonus || { honors: 0.5, ap: 1 };
    var ap = (data.ap || []).map(function (s) { return safe(REG, s); }), hon = (data.honors || []).map(function (s) { return safe(REG, s); });
    var note = !graded ? 'Nothing is graded yet, so there is no overall grade or GPA. GPA will use the points below. ' : 'Overall grade is the average of ' + (graded === rows.length ? (graded === 1 ? 'the one class' : 'all ' + count(graded) + ' classes') : 'the ' + count(graded) + ' graded classes') + '. GPA uses the points below. '
      + 'Weighted GPA adds +' + num(B.ap) + ' for AP/IB and +' + num(B.honors) + ' for Honors classes (from this student\'s GPA settings in Averages.io); '
      + (ap.length || hon.length
        ? [ap.length ? 'counted as AP: ' + list(ap) : '', hon.length ? 'counted as Honors: ' + list(hon) : ''].filter(Boolean).join('; ') + '.'
        : 'no classes are counted as AP or Honors, so it matches the unweighted GPA.');
    wrap([[note, REG, MUTED]], 8, W).slice(0, 5).forEach(function (line, i) {
      var x = L; line.forEach(function (w) { text(w.t, x, S + 74.25 + i * 11.25, w.f, 8, w.c); x += w.f.widthOfTextAtSize(w.t, 8); });
    });

    /* ---- the grading scale ---- */
    var T = S + 128, cuts = data.cuts || [], pts = data.points || {}, colW = (W - 50) / Math.max(cuts.length, 1);
    caps('Grading scale', L, T + 12.25);
    caps('Grade', L, T + 30.25); caps('Percent', L, T + 52); caps('Points', L, T + 72.25);
    cuts.forEach(function (cut, i) {
      var xc = L + 50 + colW * (i + 0.5), hi = i === 0 ? 100 : cuts[i - 1][0] - 1;
      center(cut[1], xc, T + 31.75, BOLD, 10, INK);
      center(cut[0] + '\u2013' + hi, xc, T + 52, REG, 7.4, INK2);
      center(num(typeof pts[cut[1]] === 'number' ? pts[cut[1]] : 0), xc, T + 72.25, REG, 8, INK2);
    });
    rule(L, R, T + 39.2, 1, INK1);
    rule(L, R, T + 59.4, 0.6, LINE);

    /* ---- the note, under a line ---- */
    rule(L, L + 345, 714, 1, INK1);
    var foot = [['Please note:', BOLD, INK1], [' grades are copied from ' + source + ' as they stood on ' + dateStr + ' at ' + timeStr + ' and may change. '
      + 'GPA is worked out by Averages.io, not the school, and may differ from the school\'s own. '
      + 'Prepared by Averages.io, an independent app; this is not an official transcript or report card from the school.', REG, MUTED]];
    wrap(foot, 7.5, 345).forEach(function (line, i) {
      var x = L; line.forEach(function (w) { text(w.t, x, 734.25 + i * 11.25, w.f, 7.5, w.c); x += w.f.widthOfTextAtSize(w.t, 7.5); });
    });

    /* ---- the seal, with this year in it ---- */
    var k = 106.3 / 110, cx = 509.4, cyTop = 724.9, cy = H - cyTop, tilt = 6 * Math.PI / 180;
    page.drawCircle({ x: cx, y: cy, size: 53 * k, borderColor: PUNCH, borderWidth: 1.5 * k });
    page.drawCircle({ x: cx, y: cy, size: 31 * k, borderColor: PUNCH, borderWidth: 1 * k });
    var ring = 'AVERAGES.IO \u00B7 GRADE REPORT \u00B7 ' + when.getFullYear() + ' \u00B7', rr = 41 * k, fs = 8.6 * k, ls = 2.2 * k, s = 0;
    Array.from(ring).forEach(function (ch) {
      var adv = XB.widthOfTextAtSize(ch, fs), mid = s + adv / 2, phi = Math.PI + mid / rr + tilt, th = phi + Math.PI / 2;
      var px = cx + rr * Math.cos(phi), py = cy - rr * Math.sin(phi);
      if (ch !== ' ') page.drawText(ch, { x: px - adv / 2 * Math.cos(th), y: py + adv / 2 * Math.sin(th), font: XB, size: fs, color: DEEP, rotate: P.radians(-th) });
      s += adv + ls;
    });
    {
      var m = MARK, side = 34 * k, mcx = cx + 2 * k * Math.sin(tilt), mcy = cy + 2 * k * Math.cos(tilt), a = -tilt;
      var ox = -side / 2, oy = -side / 2;
      page.drawPage(m, { x: mcx + ox * Math.cos(a) - oy * Math.sin(a), y: mcy + ox * Math.sin(a) + oy * Math.cos(a), width: side, height: side, rotate: P.radians(a) });
      doc.removePage(1);
      doc.setTitle('Student Grade Report' + (data.name ? ' \u00B7 ' + data.name : ''));
      doc.setCreator('Averages.io'); doc.setProducer('Averages.io');
      doc.setCreationDate(when); doc.setModificationDate(when);
      return doc.save();
    }
  }

  function fileName(data) {
    var d = data.date instanceof Date ? data.date : new Date();
    var who = String(data.name || 'Student').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    return 'Averages grade report - ' + who + ' - ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.pdf';
  }

  function download(data) {
    data = Object.assign({}, data, { date: data && data.date instanceof Date ? data.date : new Date() });
    return make(data).then(function (pdf) {
      var url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      var a = document.createElement('a'); a.href = url; a.download = fileName(data); a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return fileName(data);
    });
  }

  window.AveragesReport = { make: make, download: download, fileName: fileName };
})();
