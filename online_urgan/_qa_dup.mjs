/* Skript necha marta ishga tushdi? __liveRoom necha marta yozildi? */
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
  const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
  const code = await (await fetch(tag.src)).text();
  let boots = 0;
  const wrap = code.replace('const diagWindow = (window.__liveRoom = window.__liveRoom || {});',
    'boots = (boots || 0) + 1; window.__BOOTS = boots; const diagWindow = (window.__liveRoom = window.__liveRoom || {});');
  const sockets = [];
  const Orig = window.WebSocket;
  window.WebSocket = function (...a) { sockets.push(a[0]); return new Orig(...a); };
  window.WebSocket.prototype = Orig.prototype;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CONNECTING = 0;
  new Function('let boots = 0;' + wrap)();
  await new Promise((r) => setTimeout(r, 5000));
  const L = window.__liveRoom || {};
  return {
    boots: window.__BOOTS || null,
    socketUrls: sockets,
    socketsCount: sockets.length,
    currentSocket: L.socket ? { url: L.socket.url, state: L.socket.readyState } : null,
    chatItems: document.querySelectorAll('#chatMessages .chat-item').length,
    menuItems: document.querySelectorAll('#peopleList .people-row').length,
  };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
