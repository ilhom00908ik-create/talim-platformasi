/* connect() xatosini ko'rish: new WebSocket nima uchun yiqiladi? */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
const browser = await pw.chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
});
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
const page = await ctx.newPage();
await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="username"]', 'qaapproved');
await page.fill('input[name="password"]', 'QaTest!2345');
await page.click('form button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20000 });
await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
const href = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
  return a && a.getAttribute('href');
});
await page.goto(new URL(href, BASE).href, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async () => {
  const cap = [];
  const origErr = console.error;
  console.error = (...a) => { cap.push(a.map((x) => (x && x.stack) ? x.stack.split('\n').slice(0, 4).join(' ~ ') : String(x)).join(' ')); origErr(...a); };
  const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
  const code = await (await fetch(tag.src)).text();
  try { new Function(code)(); } catch (e) { cap.push('BOOT THROW ' + e.message); }
  await new Promise((r) => setTimeout(r, 4000));
  const L = window.__liveRoom || {};
  return {
    captured: cap.slice(0, 6),
    socket: L.socket ? { state: L.socket.readyState, url: L.socket.url } : null,
    diagKeys: Object.keys(L),
    probes: {
      proto: location.protocol,
      host: location.host,
      wsPath: (L.config || {}).wsPath,
      manualUrl: (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + (L.config || {}).wsPath,
    },
  };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
