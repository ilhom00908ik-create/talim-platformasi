/* connect() ichida socket haqiqatan yaratiladimi va getter ko'rsatadimi? */
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
  const log = [];
  const Orig = window.WebSocket;
  function Wrapped(url, protos) {
    log.push('new WebSocket ' + url);
    const ws = new Orig(url, protos);
    ws.addEventListener('open', () => log.push('OPEN'));
    ws.addEventListener('message', (e) => log.push('MSG ' + String(e.data).slice(0, 60)));
    ws.addEventListener('error', () => log.push('ERROR'));
    ws.addEventListener('close', (e) => log.push('CLOSE ' + e.code + ' ' + (e.reason || '')));
    return ws;
  }
  Wrapped.prototype = Orig.prototype;
  Wrapped.CONNECTING = 0; Wrapped.OPEN = 1; Wrapped.CLOSING = 2; Wrapped.CLOSED = 3;
  window.WebSocket = Wrapped;

  const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
  const code = await (await fetch(tag.src)).text();
  let bootErr = null;
  try { (0, eval)(code); } catch (e) { bootErr = e.message; }
  await new Promise((r) => setTimeout(r, 7000));
  const L = window.__liveRoom || {};
  return {
    bootErr,
    log: log.slice(0, 20),
    diagSocket: L.socket ? { state: L.socket.readyState, url: L.socket.url } : null,
    peers: L.peers ? L.peers.size : null,
    local: L.localStream ? L.localStream.getTracks().map((t) => t.kind) : null,
    count: document.getElementById('participantCountNum')?.textContent,
  };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
