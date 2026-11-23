/*
 * Email verification codes, for onboarding and Settings in both looks.
 * AveragesEmail.send(email) emails a 6-digit code (API: POST /email/code); AveragesEmail.check(email, code) checks it
 * (POST /email/verify). AveragesEmail.say(error) turns an error into a sentence for the student.
 * Before a code is sent, the API checks the address (2026-11-18): not a throwaway inbox, not a typo of a big provider
 * ("Did you mean gmail.com?": sending the same address again goes ahead), and a domain that gets email.
 * AveragesEmail.suggested() is the email on the student's Averages Plus account, to fill in (they can change it).
 */
(function () {
  'use strict';
  if (window.AveragesEmail) return;
  var API = /(^|\.)averages\.io$/.test(location.hostname) ? 'https://api.averages.io' : 'http://localhost:8787';
  var SAY = {
    bad_email: "That doesn't look like an email address.",
    email_rejected: "That address can't get email from us. Check it, or try another.",
    email_busy: "We're sending a lot of codes right now. Try again in a few minutes.",
    email_not_configured: "Codes aren't working yet. You can add your email later in Settings.",
    not_in_incognito: 'Not needed in Incognito.',
    wrong_code: "That code isn't right. Check the email and try again.",
    code_expired: 'That code ran out. Send a new one.',
    rate_limited: 'Too many tries. Wait a few minutes, then try again.',
    network: "You're offline. Check your connection and try again.",
    throwaway_email: "Use an email you'll keep. Throwaway inboxes can't be used.",
    email_domain: "That email's domain can't get email. Check it for a typo.",
  };
  var typo = { email: '', suggest: '' };
  var token = '', tokenFor = '';
  function post(path, body) {
    return fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .catch(function () { throw 'network'; })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (j && j.error === 'email_typo') typo = { email: norm(body.email), suggest: String(j.suggest || '') };
          if (!r.ok) throw (j && j.error) || (r.status === 429 ? 'rate_limited' : 'email_failed');
          return j;
        });
      });
  }
  function norm(e) { return String(e || '').trim().toLowerCase(); }
  window.AveragesEmail = {
    valid: function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); },
    // the same address again right after "Did you mean…?": the student meant it, so it goes ahead
    send: function (email) { var force = typo.email === norm(email); return post('/email/code', { email: email, force: force }).then(function (j) { token = j.token || ''; tokenFor = norm(email); }); },
    /** Checks the address before any code is sent (throwaway, typo, a domain that gets email); nothing is emailed. */
    precheck: function (email) { var force = typo.email === norm(email); return post('/email/check', { email: email, force: force }); },
    /** The typo fix from the last answer ("sam@gmail.com"), or '' */
    suggestion: function () { return typo.suggest; },
    suggested: function () {
      return fetch(API + '/email/suggested', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { return j && typeof j.email === 'string' ? j.email : ''; }).catch(function () { return ''; });
    },
    check: function (email, code) {
      if (!token || tokenFor !== norm(email)) return Promise.reject('code_expired');
      return post('/email/verify', { email: email, code: code, token: token }).then(function () { token = ''; tokenFor = ''; });
    },
    say: function (e) {
      if (e === 'email_typo') return typo.suggest ? 'Did you mean ' + typo.suggest + '? Fix it, or send again to use it as it is.' : 'Check that email for a typo.';
      return SAY[e] || "Couldn't send that. Try again in a moment.";
    },
  };
})();
