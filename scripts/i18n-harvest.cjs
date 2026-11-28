// Finds the app's English text that has no translation yet. With the local API (wrangler dev
// --port 8787, without the "ai" binding) and app (--port 3000) running, it signs in as the review sandbox student,
// opens every Fullscreen page in Spanish with public/js/averages-i18n.js collecting what it couldn't translate,
// and writes the list to i18n-harvest.json, most-seen first. Add the ones that are the app's own words (not names,
// titles or dates) to i18n/keys.txt and each language's file, then run node scripts/i18n-build.mjs.
// Run: NODE_PATH=$(npm root -g) node scripts/i18n-harvest.cjs <file with REVIEW_KEY= and REVIEW_SECRET=>
const { chromium } = require('playwright'); const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('http://localhost:8787/**', async (route) => { const r = await route.fetch(); const headers = {};
    for (const { name, value } of r.headersArray()) { const k = name.toLowerCase(); const v = k === 'set-cookie' ? value.replace(/;\s*Domain=[^;]+/i, '') : value; headers[k] = headers[k] ? headers[k] + (k === 'set-cookie' ? '\n' : ', ') + v : v; }
    await route.fulfill({ status: r.status(), headers, body: await r.body() }); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/?keys'); await p.waitForTimeout(1000);
  await p.click('[data-go="api"]'); await p.fill('#siKey', env.REVIEW_KEY); await p.fill('#siSecret', env.REVIEW_SECRET);
  await p.click('#siConnect'); await p.waitForURL(/onboard|home/, { timeout: 20000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { localStorage.setItem('averages_onboarded', '1'); const o = JSON.parse(localStorage.getItem('averages_settings_options') || '{}'); o.windowType = 'fullscreen'; localStorage.setItem('averages_settings_options', JSON.stringify(o)); });
  await p.evaluate(() => { localStorage.setItem('averages_onboarded', '1'); const o = JSON.parse(localStorage.getItem('averages_settings_options') || '{}'); o.windowType = 'fullscreen'; localStorage.setItem('averages_settings_options', JSON.stringify(o));
    localStorage.setItem('averages_lang', 'es'); localStorage.setItem('averages_i18n_collect', '1'); localStorage.setItem('averages_tr_items', '1'); localStorage.removeItem('averages_i18n_es'); });
  const all = {}; const errs = [];
  const grab = async (q, tag) => { const m = await q.evaluate(() => window.AvI18n ? AvI18n.missing() : []); for (const [k, n] of m) { all[k] = all[k] || { n: 0, pages: new Set() }; all[k].n += n; all[k].pages.add(tag); } };
  const q = await ctx.newPage(); q.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  const pages = ['home', 'courses', 'assignments', 'calendar', 'grades', 'messages', 'files', 'contacts', 'settings'];
  for (const pg of pages) {
    await q.goto('http://localhost:3000/IS/' + pg); try { await q.waitForFunction(() => window.FSD && !document.documentElement.classList.contains('fs-wait'), null, { timeout: 30000 }); } catch (e) { console.log('slow', pg); }
    await q.waitForTimeout(2500);
    // open the shared panels
    for (const sel of ['#ntBtn, [data-nt], .nt-btn', '#avBtn, .av-btn, [data-profile]']) { try { const b = q.locator(sel).first(); if (await b.count()) { await b.click({ timeout: 1500 }); await q.waitForTimeout(500); await q.keyboard.press('Escape'); } } catch (e) {} }
    try { await q.keyboard.press('Control+k'); await q.waitForTimeout(600); await q.keyboard.press('Escape'); } catch (e) {}
    if (pg === 'settings') { const secs = await q.$$eval('[data-sec]', bs => bs.map(b => b.dataset.sec)); for (const s of secs) { await q.click(`[data-sec="${s}"]`); await q.waitForTimeout(500); } }
    if (pg === 'courses') { const href = await q.evaluate(() => { const a = document.querySelector('a[href*="course-hub"], [data-course]'); return a && (a.href || ''); }); if (href) { await grab(q, pg); await q.goto(href); await q.waitForTimeout(4000); const tabs = await q.$$('[role="tab"], .hub-tab, [data-tab]'); for (const t of tabs.slice(0, 8)) { try { await t.click({ timeout: 1000 }); await q.waitForTimeout(600); } catch (e) {} } await grab(q, 'course-hub'); continue; } }
    if (pg === 'messages') { try { await q.locator('.th, .ms-row, [data-thread]').first().click({ timeout: 2000 }); await q.waitForTimeout(1500); } catch (e) {} }
    await grab(q, pg);
  }
  const out = Object.entries(all).map(([k, v]) => ({ k, n: v.n, pages: [...v.pages] })).sort((a, b) => b.pages.length - a.pages.length || b.n - a.n);
  require('fs').writeFileSync('i18n-harvest.json', JSON.stringify(out, null, 1));
  console.log('strings', out.length, 'errors', errs.slice(0, 5)); await b.close();
})();
