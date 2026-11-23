// Opened from inside Schoology (worker/index.js launchRedirect, 2026-11-23 security sweep): who Schoology says it is
// is believed only when Schoology sent them, so another site can't sign anyone out. Run by npm run verify.
import worker, { schoologyLaunch } from '../worker/index.js';
const saml = (d, u) => btoa(`<samlp:Response><saml:Attribute Name="domain"><saml:AttributeValue>${d}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="uid"><saml:AttributeValue>${u}</saml:AttributeValue></saml:Attribute></samlp:Response>`);
const env = { ASSETS: { fetch: async () => new Response('page') } };
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  PASS ' : '  FAIL ') + n); };
const post = (origin, d = 'school.schoology.com', u = '146180046', extra = {}) => worker.fetch(new Request('https://app.averages.io/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}), ...extra }, body: new URLSearchParams({ SAMLResponse: saml(d, u) }).toString() }), env);
let r = await post('https://school.schoology.com');
ok('from Schoology: school in the address, uid only in a 2-minute cookie', r.status === 303 && r.headers.get('Location') === '/?launch=school.schoology.com' && /^averages_launch_as=146180046; Path=\/; Max-Age=120; Secure; SameSite=Lax$/.test(r.headers.get('Set-Cookie') || ''));
r = await post('https://app.schoology.com'); ok('app.schoology.com counts', !!r.headers.get('Set-Cookie'));
r = await post('https://lms.school.org', 'lms.school.org'); ok("a school's own Schoology address (the packet's domain) counts", !!r.headers.get('Set-Cookie'));
r = await post('https://evil.example'); ok('another site: school only, no uid, nobody gets signed out', r.headers.get('Location') === '/?launch=school.schoology.com' && !r.headers.get('Set-Cookie'));
r = await post('https://schoology.com.evil.example'); ok('look-alike host: no uid', !r.headers.get('Set-Cookie'));
r = await post('null'); ok('Origin null, no Referer: no uid', !r.headers.get('Set-Cookie'));
r = await post(null, undefined, undefined, { Referer: 'https://school.schoology.com/apps/123' }); ok('no Origin, Referer from Schoology: uid kept', !!r.headers.get('Set-Cookie'));
r = await post(null, undefined, undefined, { Referer: 'https://evil.example/x' }); ok('no Origin, Referer elsewhere: no uid', !r.headers.get('Set-Cookie'));
r = await post('https://school.schoology.com', 'bad domain!', '1'); ok('a strange domain: plain "/", nothing set', r.headers.get('Location') === '/' && !r.headers.get('Set-Cookie'));
r = await post('https://school.schoology.com', 'school.schoology.com', '1; Domain=.averages.io'); ok('a strange uid never reaches the cookie', !r.headers.get('Set-Cookie'));
r = await worker.fetch(new Request('https://app.averages.io/?SAMLResponse=' + encodeURIComponent(saml('school.schoology.com', '42')), { headers: { Referer: 'https://evil.example/' } }), env);
ok('the GET form from another site: no uid', r.status === 303 && !r.headers.get('Set-Cookie'));
ok('schoologyLaunch itself unchanged', schoologyLaunch(new URLSearchParams({ SAMLResponse: saml('school.schoology.com', '42') }).toString()) === '/?launch=school.schoology.com&as=42');
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
