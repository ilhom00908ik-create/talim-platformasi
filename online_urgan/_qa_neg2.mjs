/* Xonadagi offer xatosini to'g'ridan-to'g'ri ushlash. */
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
let SRC = fs.readFileSync(new URL('./static/live_room.js', import.meta.url), 'utf8');
// negotiate/catch ichidagi xatoni global joyga yozamiz
SRC = SRC.replace(
  'negotiate(entry).catch(() => {});',
  'negotiate(entry).catch((e) => { window.__NEGERR = (window.__NEGERR || []).concat([e.message + " | state=" + entry.pc.signalingState]); });',
);

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
  await st.waitForTimeout(12000);

  const info = async (p, label) => p.evaluate((lbl) => {
    const L = window.__liveRoom;
    return {
      who: lbl,
      me: L.config.userId,
      negErr: window.__NEGERR || null,
      peers: [...(L.peers || [])].map(([id, e]) => ({
        id, st: e.pc.connectionState, sig: e.pc.signalingState,
        offerStarted: e.hasOfferStarted,
        senders: e.pc.getSenders().filter((s) => s.track).map((s) => s.track.kind),
        localType: e.pc.localDescription ? e.pc.localDescription.type : null,
        localBundle: e.pc.localDescription ? /a=group:BUNDLE/.test(e.pc.localDescription.sdp) : null,
      })),
      socket: L.socket ? L.socket.readyState : null,
    };
  }, label);
  const T = await info(page, 'T');
  const S = await info(st, 'S');
  await browser.close();
  return { T, S };
}
