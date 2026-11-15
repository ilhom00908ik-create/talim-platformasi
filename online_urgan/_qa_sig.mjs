/* Offer/answer topilmadi. Sabab: connectPeer(id, me.id < id) — ikkalasi ham
   "men kichikman" deb o'ylasa offer yuborilmaydi. Yoki offer yetib bormayapti. */
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
const SRC = fs.readFileSync(new URL('./static/live_room.js', import.meta.url), 'utf8');

async function login(p, u, pw) {
  await p.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await p.fill('input[name="username"]', u);
  await p.fill('input[name="password"]', pw);
  await p.click('form button[type="submit"]');
  await p.waitForURL(/dashboard|pending|apply/, { timeout: 20000 });
}

const boot = (p) => p.evaluate((code) => {
  if (window.__liveRoom) return 'already';
  (0, eval)(code);
  return 'ok';
}, SRC);

// browser.mjs o'z brauzerini boshqaradi; LNA blokini o'chirib bo'lmaydi.
// Shuning uchun test o'z brauzerini ishga tushiradi.
export default async function run() {
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  // WS xabarlarini ushlash
  const hook = () => {
    window.__MSG = [];
    const O = window.WebSocket;
    function W(u) {
      const ws = new O(u);
      ws.addEventListener('message', (e) => { try { const d = JSON.parse(e.data); window.__MSG.push(d.type + (d.sender_id ? '/' + d.sender_id : '') + (d.target_user_id ? '>' + d.target_user_id : '')); } catch (x) { } });
      ws.addEventListener('send', () => { });
      const s = ws.send.bind(ws);
      ws.send = (d) => { try { const j = JSON.parse(d); window.__MSG.push('OUT ' + j.type + (j.target_user_id ? '>' + j.target_user_id : '')); } catch (x) { } return s(d); };
      return ws;
    }
    W.prototype = O.prototype; W.OPEN = 1; W.CONNECTING = 0; W.CLOSED = 3; W.CLOSING = 2;
    window.WebSocket = W;
  };
  await page.addInitScript(hook);

  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  const url = new URL(href, BASE).href;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(page);
  await page.waitForTimeout(6000);

  const ctx2 = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1440, height: 900 } });
  await ctx2.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const st = await ctx2.newPage();
  await st.addInitScript(hook);
  await login(st, 'qastudent', 'QaTest!2345');
  await st.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(st);
  await st.waitForTimeout(10000);

  const T = await page.evaluate(() => ({ me: (window.__liveRoom.config || {}).userId, msgs: (window.__MSG || []).slice(0, 40) }));
  const S = await st.evaluate(() => ({
    me: (window.__liveRoom.config || {}).userId,
    msgs: (window.__MSG || []).slice(0, 40),
    peers: [...(window.__liveRoom.peers || [])].map(([id, e]) => ({ id, st: e.pc.connectionState, sig: e.pc.signalingState, hasOffer: e.hasOfferStarted, local: e.pc.localDescription ? e.pc.localDescription.type : null })),
  }));
  await browser.close();
  return { teacher: T, student: S };
}
