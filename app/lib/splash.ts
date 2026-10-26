/**
 * First-open logo splash (2026-10-24, Martin: "on first log in/tab open can we
 * show the logo loading ... then open the page", "but only when there is no
 * cache").
 *
 * When a signed-in page opens in a tab that has no saved grades yet (a fresh
 * tab, or right after signing in), the logo loader from the sign-in screen
 * covers the page instead of the shimmer placeholders. It fades away once the
 * page has its data, so the page appears already filled in.
 *
 * - Only when this tab has no saved bundle (`schoolagy_bundle_cache`) and
 *   hasn't shown the splash yet (`averages_splash_shown`). Every later page in
 *   the tab skips it. Sign-out clears the flag (app/lib/averages.ts), so the
 *   next sign-in in the same tab gets it again.
 * - Stays at least 1 s (LegacyPage waits that long before drawing the data) so
 *   it never just flickers, and at most 5 s: past that it fades by itself and
 *   the shimmer page carries on.
 * - Same look as the sign-in "checking" screen (CHECKING_CSS / CHECKING_JS in
 *   scripts/port-pages.mjs): #17181c, the logo in #E5484D, the #FF7A50 glow on
 *   a random path. LOGO_MASK is the same SVG.
 * - Potato mode: no glow motion and no fade. Reduced motion: no glow motion.
 *
 * Has to run before the first paint, like THEME_BOOT_JS, so it's a synchronous
 * inline script that LegacyPage renders for signed-in pages. It's drawn with
 * html::before (logo) and html::after (backdrop), so nothing goes into <body>,
 * which React owns. LegacyPage uses window.__averagesSplash: { on, at, hide() }.
 */

export const SPLASH_KEY = "averages_splash_shown";
export const SPLASH_MIN_MS = 1000;
export const SPLASH_MAX_MS = 5000;

const LOGO_MASK = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%22-8%20-8%20470%20470%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M0.02%20452.75C0.15%20442.97%205.78%20407.10%2010.02%20389.00C11.63%20382.12%2015.00%20367.50%2017.51%20356.50C28.03%20310.27%2040.89%20265.53%2058.60%20213.50C77.33%20158.47%2085.57%20136.89%20103.25%2096.50C118.88%2060.79%20129.55%2039.21%20141.04%2020.00C144.17%2014.78%20147.92%208.14%20149.38%205.25L152.03%200.00L226.00%200.00L299.97%200.00L302.62%205.25C304.08%208.14%20307.83%2014.78%20310.96%2020.00C322.28%2038.92%20336.94%2068.63%20348.06%2095.18C350.75%20101.61%20354.55%20110.26%20356.49%20114.41C367.49%20137.90%20397.74%20222.92%20410.96%20267.50C419.09%20294.91%20429.04%20332.52%20434.49%20356.50C437.00%20367.50%20440.37%20382.12%20441.98%20389.00C446.22%20407.10%20451.85%20442.97%20451.98%20452.75C452.00%20453.74%20436.27%20454.00%20376.64%20454.00L301.28%20454.00L299.60%20442.75C296.88%20424.51%20291.11%20392.27%20288.63%20381.50L286.34%20371.50L223.34%20371.24L160.34%20370.99L158.19%20380.33C155.44%20392.33%20149.65%20424.19%20147.53%20439.00C146.63%20445.32%20145.66%20451.29%20145.38%20452.25C144.90%20453.90%20140.55%20454.00%2072.43%20454.00C15.14%20454.00%200.00%20453.74%200.02%20452.75ZM184.00%20348.25C189.69%20345.41%20191.44%20335.66%20187.41%20329.29C184.35%20324.47%20172.42%20324.01%20167.19%20328.51C164.78%20330.58%20164.50%20331.51%20164.50%20337.31C164.50%20344.14%20166.09%20347.25%20170.50%20349.05C173.93%20350.46%20180.35%20350.07%20184.00%20348.25ZM274.28%20347.02C284.17%20342.33%20288.64%20332.80%20287.74%20318.33C286.79%20303.07%20279.66%20295.00%20265.16%20292.75C256.25%20291.37%20245.93%20293.01%20240.22%20296.71C232.38%20301.79%20228.36%20311.77%20229.23%20323.96C230.09%20335.93%20235.58%20344.50%20244.50%20347.78C249.77%20349.72%20251.32%20349.90%20260.50%20349.59C267.31%20349.35%20270.66%20348.73%20274.28%20347.02ZM220.00%20325.25L220.00%20301.50L209.50%20301.50L199.00%20301.50L199.00%20325.25L199.00%20349.00L209.50%20349.00L220.00%20349.00L220.00%20325.25ZM252.40%20330.90C250.89%20329.22%20250.50%20327.26%20250.50%20321.31C250.50%20314.35%20250.70%20313.66%20253.31%20311.41C256.89%20308.33%20260.44%20308.35%20263.55%20311.45C265.70%20313.61%20266.00%20314.79%20266.00%20321.23C266.00%20330.70%20264.56%20333.00%20258.60%20333.00C255.51%20333.00%20253.78%20332.41%20252.40%20330.90ZM218.38%20292.67C221.03%20290.93%20222.25%20286.49%20221.33%20281.90C220.47%20277.58%20215.94%20275.01%20209.18%20275.00C200.42%20275.00%20197.08%20277.76%20197.03%20285.08C197.01%20288.68%20197.53%20290.15%20199.48%20291.98C203.75%20295.99%20212.81%20296.32%20218.38%20292.67ZM258.58%20254.35C258.23%20253.44%20256.13%20245.45%20253.90%20236.60C244.34%20198.58%20227.57%20140.97%20224.09%20134.18L222.37%20130.84L216.22%20150.67C207.52%20178.73%20204.15%20190.56%20195.49%20223.50C191.29%20239.45%20187.63%20253.29%20187.36%20254.25C186.90%20255.89%20189.07%20256.00%20223.04%20256.00C256.26%20256.00%20259.16%20255.87%20258.58%20254.35Z%22%2F%3E%3C%2Fsvg%3E";

export const SPLASH_CSS =
  "html[data-av-splash]::after{content:'';position:fixed;inset:0;z-index:2147483646;background:#17181c;opacity:1;transition:opacity .36s ease}" +
  "html[data-av-splash]::before{content:'';position:fixed;z-index:2147483647;left:50%;top:50%;width:168px;height:168px;margin:-84px 0 0 -84px;" +
  "background:radial-gradient(circle 151px at calc(50% + var(--av-dx,0px)) calc(50% + var(--av-dy,-27px)),rgba(255,122,80,1) 0%,rgba(255,122,80,.85) 25%,rgba(255,122,80,.45) 55%,rgba(255,122,80,.12) 80%,rgba(255,122,80,0) 100%),#E5484D;" +
  "-webkit-mask:url('" + LOGO_MASK + "') center/contain no-repeat;mask:url('" + LOGO_MASK + "') center/contain no-repeat;" +
  "opacity:1;transition:opacity .24s ease,transform .36s cubic-bezier(.2,.8,.2,1)}" +
  "html[data-av-splash=out]::after,html[data-av-splash=out]::before{opacity:0;pointer-events:none}" +
  "html[data-av-splash=out]::before{transform:scale(1.06)}";

export const SPLASH_JS =
  "(function(){var d=document.documentElement,api={on:false,at:0,hide:function(){}};window.__averagesSplash=api;" +
  "try{var s=window.sessionStorage;if(s.getItem('schoolagy_bundle_cache')||s.getItem('" + SPLASH_KEY + "'))return;s.setItem('" + SPLASH_KEY + "','1');}catch(e){return;}" +
  "var potato=false,calm=false;try{potato=(JSON.parse(localStorage.getItem('schoolagy_settings_options')||'{}')||{}).potatoMode===true;}catch(e){}" +
  "try{calm=potato||matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){}" +
  "api.on=true;api.at=performance.now();d.setAttribute('data-av-splash','');var done=false;" +
  "function clear(){d.removeAttribute('data-av-splash');d.style.removeProperty('--av-dx');d.style.removeProperty('--av-dy');}" +
  "api.hide=function(){if(done)return;done=true;api.on=false;if(potato){clear();return;}d.setAttribute('data-av-splash','out');setTimeout(clear,400);};" +
  "setTimeout(api.hide," + SPLASH_MAX_MS + ");" +
  "if(calm||!window.requestAnimationFrame)return;" +
  "function dr(lo,hi,ms){var f=lo+Math.random()*(hi-lo),t=lo+Math.random()*(hi-lo),t0=performance.now(),l=ms;return function(n){if(n-t0>l){f=t;t=lo+Math.random()*(hi-lo);t0=n;l=ms*(0.6+Math.random()*0.8);}var k=Math.min(1,(n-t0)/l);return f+(t-f)*(1-Math.cos(Math.PI*k))/2;};}" +
  "var r=dr(21,66,900),sp=dr(2.2,6.5,1100),sq=dr(0.55,1,1500),a=Math.random()*6.283,last=performance.now();" +
  "function fr(n){if(!d.hasAttribute('data-av-splash'))return;var dt=Math.min(0.05,Math.max(0,(n-last)/1000));last=n;a+=sp(n)*dt;var rr=r(n);" +
  "d.style.setProperty('--av-dx',(Math.cos(a)*rr).toFixed(1)+'px');d.style.setProperty('--av-dy',(Math.sin(a)*rr*sq(n)+6).toFixed(1)+'px');requestAnimationFrame(fr);}" +
  "requestAnimationFrame(fr);})();";
