/*
 * Email verification codes, for onboarding and Settings in both looks.
 * AveragesEmail.send(email) emails a 6-digit code (API: POST /email/code); AveragesEmail.check(email, code) checks it
 * (POST /email/verify). AveragesEmail.say(error) turns an error into a sentence for the student.
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
  };
  var token = '', tokenFor = '';
  function post(path, body) {
    return fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .catch(function () { throw 'network'; })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw (j && j.error) || (r.status === 429 ? 'rate_limited' : 'email_failed');
          return j;
        });
      });
  }
  function norm(e) { return String(e || '').trim().toLowerCase(); }
  window.AveragesEmail = {
    valid: function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); },
    send: function (email) { return post('/email/code', { email: email }).then(function (j) { token = j.token || ''; tokenFor = norm(email); }); },
    check: function (email, code) {
      if (!token || tokenFor !== norm(email)) return Promise.reject('code_expired');
      return post('/email/verify', { email: email, code: code, token: token }).then(function () { token = ''; tokenFor = ''; });
    },
    say: function (e) { return SAY[e] || "Couldn't send that. Try again in a moment."; },
  };
})();
