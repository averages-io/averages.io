// Time zone: Settings > General > Time Zone.
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
