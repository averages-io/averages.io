/*
 * Time zone (2026-10-28, Martin): Settings > General > Time Zone.
 *
 * Schoology sends due dates as the school's wall-clock time ("2026-10-30
 * 23:59:00", no zone), and the API reads them in the student's zone, which
 * the app sends as ?tz=. Normally that's this device's zone ("Set
 * Automatically"). A student whose device is set wrong (a school Chromebook
 * on UTC, a laptop that came back from a trip) can pick their zone by hand,
 * stored as schoolagy_settings_options.timeZone ('auto' or an IANA name like
 * 'America/Los_Angeles').
 *
 *   averagesTimeZone()   the zone to send the API: the manual pick if it's a
 *                        real zone, else this device's zone ('' if unknown).
 *   averagesDeviceTimeZone()  this device's own zone.
 *   averagesManualTimeZone()  the manual pick, or '' in automatic mode.
 *   averagesWallClock(x) a Date whose local fields (getDate, getHours...)
 *                        read the wall clock in the chosen zone, for pages
 *                        that work out "today" or a due day in the browser.
 *                        In automatic mode it's just new Date(x).
 *
 * Loaded first in app/layout.tsx so every other script can use it. Each call
 * site still falls back to the device zone if this file didn't load.
 */
(function () {
  'use strict';

  function device() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  function valid(z) {
    if (typeof z !== 'string' || !z || z.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(z)) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; }
  }

  function manual() {
    try {
      var o = JSON.parse(localStorage.getItem('schoolagy_settings_options') || '{}') || {};
      var z = o.timeZone;
      return z && z !== 'auto' && valid(z) ? z : '';
    } catch (e) { return ''; }
  }

  function zone() { return manual() || device(); }

  var fmtCache = {};
  function wallClock(input) {
    var d = input === undefined || input === null ? new Date() : new Date(input);
    var z = manual();
    if (!z || isNaN(d.getTime()) || z === device()) return d;
    try {
      var f = fmtCache[z] || (fmtCache[z] = new Intl.DateTimeFormat('en-US', {
        timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      }));
      var p = {};
      f.formatToParts(d).forEach(function (x) { p[x.type] = Number(x.value); });
      return new Date(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second, d.getMilliseconds());
    } catch (e) { return d; }
  }

  window.averagesTimeZone = zone;
  window.averagesDeviceTimeZone = device;
  window.averagesManualTimeZone = manual;
  window.averagesValidTimeZone = valid;
  window.averagesWallClock = wallClock;
})();
