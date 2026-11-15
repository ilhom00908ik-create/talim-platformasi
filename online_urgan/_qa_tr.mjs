/* Xonadagi transceiver'lar ro'yxati. */
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
const SRC = fs.readFileSync(new URL('./static/live_room.js', import.meta.url), 'utf8');
async function login(p, u, pw) {
  await p.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await p.fill('input[name="username"]', u); await p.fill('input[name="password"]', pw);
  await p.click('form button[type="submit"]');
  await p.waitForURL(/dashboard|pending|apply/, { timeout: 20000 });
}
const boot = (p) => p.evaluate((c) => { if (window.__liveRoom) return 'already'; (0, eval)(c); return 'ok'; }, SRC);

export default async function run() {
  const browser = await pw.chromium.launch({
    headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const page = await ctx.newPage();
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => { const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href'))); return a && a.getAttribute('href'); });
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

  const d = await page.evaluate(() => [...(window.__liveRoom.peers || [])].map(([id, e]) => ({
    id,
    transceivers: e.pc.getTransceivers().map((t) => ({ mid: t.mid, dir: t.direction, cur: t.currentDirection, snd: t.sender.track ? t.sender.track.kind : null, rcv: t.receiver.track ? t.receiver.track.kind : null, stopped: t.stopped })),
    senders: e.pc.getSenders().map((s) => s.track ? s.track.kind : 'null'),
    sig: e.pc.signalingState,
    bundle: e.pc.localDescription ? /a=group:BUNDLE/.test(e.pc.localDescription.sdp) : null,
  })));
  await browser.close();
  return d;
}
