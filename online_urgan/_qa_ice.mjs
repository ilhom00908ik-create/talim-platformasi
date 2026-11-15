/* Ustoz/talaba o'rtasida ICE candidate'lar oqimi. */
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
const HOOK = () => {
  window.__ICE = [];
  const O = window.RTCPeerConnection;
  function W(cfg) {
    const pc = new O(cfg);
    pc.addEventListener('icecandidate', (e) => window.__ICE.push(e.candidate ? 'OUT:' + (e.candidate.candidate || '').slice(0, 60) : 'OUT:null'));
    pc.addEventListener('icecandidateerror', (e) => window.__ICE.push('ICEFAIL:' + (e.errorText || '').slice(0, 60)));
    pc.addEventListener('iceconnectionstatechange', () => window.__ICE.push('ICE:' + pc.iceConnectionState));
    pc.addEventListener('connectionstatechange', () => window.__ICE.push('PC:' + pc.connectionState));
    pc.addEventListener('track', (e) => window.__ICE.push('TRACK:' + e.track.kind));
    window.__PCS = (window.__PCS || []).concat([pc]);
    return pc;
  }
  W.prototype = O.prototype;
  window.RTCPeerConnection = W;
};

export default async function run() {
  const browser = await pw.chromium.launch({
    headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const mk = async (user) => {
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
    const p = await ctx.newPage();
    await p.addInitScript(HOOK);
    await login(p, user, 'QaTest!2345');
    return p;
  };
  const T = await mk('qaapproved');
  await T.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await T.evaluate(() => { const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href'))); return a && a.getAttribute('href'); });
  const url = new URL(href, BASE).href;
  await T.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(T);
  await T.waitForTimeout(7000);

  const S = await mk('qastudent');
  await S.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(S);
  await S.waitForTimeout(14000);

  const grab = (p) => p.evaluate(() => ({
    ice: (window.__ICE || []).slice(0, 30),
    pcStates: [...(window.__liveRoom?.peers || [])].map(([id, e]) => ({ id, st: e.pc.connectionState, ice: e.pc.iceConnectionState, senders: e.pc.getSenders().filter((s) => s.track).map((s) => s.track.kind), remote: e.remoteStream.getTracks().map((t) => t.kind) })),
  }));
  const t = await grab(T);
  const s = await grab(S);
  await browser.close();
  return { teacher: t, student: s };
}
