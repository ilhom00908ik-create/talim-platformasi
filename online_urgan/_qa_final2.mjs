/* YAKUNIY TEST — live_room.js manbasi Node'dan `evaluate` orqali sahifaga uzatiladi
   (bu muhitda sahifa <script> teglari va fetch() ishonchsiz ishlaydi). Keyin xonaning
   HAQIQIY UI tugmalari bosiladi. */
import fs from 'fs';
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
  try { (0, eval)(code); } catch (e) { return 'THROW: ' + e.message; }
  return window.__liveRoom ? 'ok' : 'no-diag';
}, SRC);

const snap = (p) => p.evaluate(() => {
  const L = window.__liveRoom || {};
  const t = (x) => `${x.kind}:${x.readyState}${x.enabled ? '' : '(off)'}`;
  const v = document.getElementById('screenVideo');
  return {
    socket: L.socket ? ['CONN', 'OPEN', 'CLOSE', 'CLOSED'][L.socket.readyState] : 'none',
    local: L.localStream ? L.localStream.getTracks().map(t) : null,
    peers: L.peers ? [...L.peers.values()].map((e) => ({
      st: e.pc.connectionState,
      out: e.pc.getSenders().filter((s) => s.track).map((s) => s.track.kind),
      remote: e.remoteStream.getTracks().map(t),
    })) : null,
    count: document.getElementById('participantCountNum')?.textContent,
    people: [...document.querySelectorAll('#peopleList .people-row')].map((r) => `${r.querySelector('.people-name-text')?.textContent}${r.querySelector('.mic-badge.is-muted') ? '[M]' : ''}`),
    tiles: [...document.querySelectorAll('#videoGrid .tile')].map((el) => {
      const vid = el.querySelector('video');
      return `${el.querySelector('.tile__name')?.textContent}:${vid ? vid.videoWidth + 'x' + vid.videoHeight : '-'}`;
    }),
    pip: (() => { const w = document.getElementById('pipWindow'); return w && !w.hidden ? 'shown' : 'hidden'; })(),
    screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
    screen: v ? `${v.videoWidth}x${v.videoHeight}` : '-',
    chat: [...document.querySelectorAll('#chatMessages .chat-item')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
  };
});

const click = (p, id) => p.evaluate((i) => document.getElementById(i).click(), id);

export default async function run(page) {
  const R = {};
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  const url = new URL(href, BASE).href;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  R.teacherBoot = await boot(page);
  await page.waitForTimeout(7000);
  R.teacherAlone = await snap(page);

  const ctx2 = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const st = await ctx2.newPage();
  await login(st, 'qastudent', 'QaTest!2345');
  await st.goto(url, { waitUntil: 'domcontentloaded' });
  R.studentBoot = await boot(st);
  await st.waitForTimeout(12000);
  R.both = { teacher: await snap(page), student: await snap(st) };

  await st.evaluate(() => { document.getElementById('chatInput').value = 'Salom, ustoz!'; });
  await st.press('#chatInput', 'Enter');
  await page.waitForTimeout(2000);
  R.chat = (await snap(page)).chat;

  await page.evaluate(() => { const s = window.__liveRoom.socket; if (s && s.readyState === 1) s.send(JSON.stringify({ type: 'roster-sync' })); });
  await page.waitForTimeout(2500);
  R.chatAfterResync = (await snap(page)).chat;

  await click(page, 'muteAllBtn');
  await page.waitForTimeout(2500);
  R.muteAll = { student: await snap(st) };

  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    setInterval(() => { g.fillStyle = '#14204a'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#22d3ee'; g.font = 'bold 72px sans-serif'; g.fillText('USTOZ EKRANI', 90, 380); }, 80);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(15);
  });
  await click(page, 'shareScreenBtn');
  await page.waitForTimeout(10000);
  R.screen = { teacher: await snap(page), student: await snap(st) };
  await page.screenshot({ path: '_qa_T.png' });
  await st.screenshot({ path: '_qa_S.png' });

  await ctx2.close();
  return R;
}
