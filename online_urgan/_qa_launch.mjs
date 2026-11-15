/* To'g'ri bayroqlar bilan o'z brauzerimizni ishga tushirib, LNA blokini olib tashlaymiz. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
const browser = await pw.chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: [
    '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

// login
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
const url = new URL(href, BASE).href;

const boot = (p) => p.evaluate(async () => {
  if (window.__liveRoom) return 'already';
  const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
  new Function(await (await fetch(tag.src)).text())();
  return window.__liveRoom ? 'ok' : 'fail';
});

const snap = (p) => p.evaluate(() => {
  const L = window.__liveRoom || {};
  const t = (x) => `${x.kind}:${x.readyState}`;
  return {
    ws: L.socket ? ['?', 'OPEN', 'CLOSE', 'CLOSED'][L.socket.readyState] : 'none',
    local: L.localStream ? L.localStream.getTracks().map(t) : null,
    peers: L.peers ? [...L.peers.values()].map((e) => ({
      state: e.pc.connectionState,
      senders: e.pc.getSenders().filter((s) => s.track).map((s) => s.track.kind),
      receivers: e.remoteStream.getTracks().map(t),
    })) : null,
    count: document.getElementById('participantCountNum')?.textContent,
    people: [...document.querySelectorAll('#peopleList .people-row')].map((r) => `${r.querySelector('.people-name-text')?.textContent}${r.querySelector('.mic-badge.is-muted') ? ' [MUTED]' : ''}`),
    tiles: [...document.querySelectorAll('#videoGrid .tile')].map((el) => {
      const v = el.querySelector('video');
      return `${el.querySelector('.tile__name')?.textContent} ${v ? v.videoWidth + 'x' + v.videoHeight : '-'}`;
    }),
    pip: (() => { const w = document.getElementById('pipWindow'); return w && !w.hidden ? 'shown' : 'hidden'; })(),
    screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
    chat: [...document.querySelectorAll('#chatMessages .chat-item')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
  };
});

const R = {};
await page.goto(url, { waitUntil: 'domcontentloaded' });
R.tBoot = await boot(page);
await page.waitForTimeout(6000);
R.teacherAlone = await snap(page);

const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx2.grantPermissions(['camera', 'microphone'], { origin: BASE });
const st = await ctx2.newPage();
await st.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
await st.fill('input[name="username"]', 'qastudent');
await st.fill('input[name="password"]', 'QaTest!2345');
await st.click('form button[type="submit"]');
await st.waitForURL(/dashboard|pending/, { timeout: 20000 });
await st.goto(url, { waitUntil: 'domcontentloaded' });
R.sBoot = await boot(st);
await st.waitForTimeout(10000);

R.both = { teacher: await snap(page), student: await snap(st) };

// chat
await st.evaluate(() => { document.getElementById('chatInput').value = 'Salom, ustoz!'; });
await st.press('#chatInput', 'Enter');
await page.waitForTimeout(2000);
R.teacherChat = (await snap(page)).chat;
await page.evaluate(() => { const s = window.__liveRoom && window.__liveRoom.socket; if (s && s.readyState === 1) s.send(JSON.stringify({ type: 'roster-sync' })); });
await page.waitForTimeout(2000);
R.teacherChatAfterResync = (await snap(page)).chat;

// mute all
await page.evaluate(() => document.getElementById('muteAllBtn').click());
await page.waitForTimeout(2000);
R.afterMute = { student: await snap(st) };

// ekran
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const g = c.getContext('2d');
  setInterval(() => { g.fillStyle = '#14204a'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#22d3ee'; g.font = 'bold 72px sans-serif'; g.fillText('USTOZ EKRANI', 90, 380); }, 80);
  navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(15);
});
await page.evaluate(() => document.getElementById('shareScreenBtn').click());
await page.waitForTimeout(9000);
R.screen = { teacher: await snap(page), student: await snap(st) };
await page.screenshot({ path: '_qa_ok_teacher.png' });
await st.screenshot({ path: '_qa_ok_student.png' });

R.errors = [...new Set(errors)].slice(0, 8);
console.log(JSON.stringify(R, null, 1));
await browser.close();
