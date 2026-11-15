/* Xonada negotiate xatosini AYNAN takrorlash. */
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

  // talaba tomonida: peer bor, offer qo'lda yaratib ko'ramiz
  const diag = await st.evaluate(async () => {
    const L = window.__liveRoom;
    const entry = [...(L.peers || [])][0];
    if (!entry) return { err: 'no peers', peers: L.peers ? L.peers.size : null };
    const e = entry[1];
    const out = {
      id: e.id,
      sig: e.pc.signalingState,
      ice: e.pc.iceGatheringState,
      conn: e.pc.connectionState,
      localStream: L.localStream ? L.localStream.getTracks().map((t) => `${t.kind}:${t.readyState}`) : null,
      senders: e.pc.getSenders().map((s) => s.track ? `${s.track.kind}:${s.track.readyState}` : 'null'),
      config: e.pc.getConfiguration ? e.pc.getConfiguration().bundlePolicy : '?',
    };
    try {
      const offer = await e.pc.createOffer();
      out.offer = { ok: true, bundle: /a=group:BUNDLE/.test(offer.sdp), mlines: (offer.sdp.match(/^m=/gm) || []).length };
      await e.pc.setLocalDescription(offer);
      out.set = 'ok';
      out.localBundle = /a=group:BUNDLE/.test(e.pc.localDescription.sdp);
    } catch (err) { out.err = err.name + ': ' + err.message.slice(0, 200); }
    return out;
  });

  await browser.close();
  return diag;
}
