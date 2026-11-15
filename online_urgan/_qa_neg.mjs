/* negotiate() ni qo'lda chaqirib ko'rish: offer yaratiladimi? */
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
const boot = (p) => p.evaluate((code) => { if (window.__liveRoom) return 'already'; (0, eval)(code); return 'ok'; }, SRC);

export default async function run() {
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  const wsErr = [];
  page.on('console', (m) => { if (m.type() === 'error') wsErr.push(m.text().slice(0, 200)); });

  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  const url = new URL(href, BASE).href;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(page);
  await page.waitForTimeout(7000);

  const ctx2 = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx2.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const st = await ctx2.newPage();
  await login(st, 'qastudent', 'QaTest!2345');
  await st.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(st);
  await st.waitForTimeout(10000);

  // 1) holat
  const before = await st.evaluate(() => {
    const e = [...(window.__liveRoom?.peers?.values() || [])][0];
    return e ? { id: e.id, st: e.pc.connectionState, sig: e.pc.signalingState, offer: e.hasOfferStarted, senders: e.pc.getSenders().length, tracks: e.pc.getSenders().filter((s) => s.track).length } : null;
  });

  // 2) offer yaratishni qo'lda sinab ko'rish
  const manual = await st.evaluate(async () => {
    const e = [...(window.__liveRoom?.peers?.values() || [])][0];
    if (!e) return 'no-peer';
    try {
      const offer = await e.pc.createOffer();
      return { ok: true, type: offer.type, sdp: offer.sdp.slice(0, 120), audio: (offer.sdp.match(/m=audio/g) || []).length, video: (offer.sdp.match(/m=video/g) || []).length };
    } catch (err) { return { ok: false, err: err.name + ': ' + err.message }; }
  });

  // 3) socket holati va send imkoniyati
  const sock = await st.evaluate(() => {
    const L = window.__liveRoom;
    const s = L.socket;
    let sent = 'n/a';
    try { s.send(JSON.stringify({ type: 'roster-sync' })); sent = 'sent'; } catch (e) { sent = 'ERR ' + e.message; }
    return { state: s ? s.readyState : null, url: s ? s.url : null, sent };
  });
  await st.waitForTimeout(1500);

  await browser.close();
  return { before, manual, sock, wsErr: [...new Set(wsErr)].slice(0, 5) };
}
