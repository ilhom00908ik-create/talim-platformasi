/* TO'LIQ UI TEST: ustoz + talaba jonli xonada (kamera/mikrofon ruxsati bilan).
   Sahifa <script> lari bu brauzerda bajarilmagani uchun JS ni `new Function` orqali
   yuklaymiz, keyin xonaning HAQIQIY UI tugmalarini bosamiz. */
const BASE = 'http://127.0.0.1:8012';
const log = [];

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard|pending|apply/, { timeout: 20000 });
}

async function bootRoom(page) {
  return page.evaluate(async () => {
    if (window.__liveRoom) return 'already';
    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    if (!tag) return 'no-tag';
    const code = await (await fetch(tag.src)).text();
    new Function(code)();
    return window.__liveRoom ? 'booted' : 'booted-but-no-diag';
  });
}

const snap = (page) => page.evaluate(() => {
  const LR = window.__liveRoom || {};
  const t = (x) => `${x.kind}:${x.readyState}${x.enabled ? '' : '(off)'}`;
  const vids = [...document.querySelectorAll('#videoGrid video')].map((v) => `${v.videoWidth}x${v.videoHeight}`);
  return {
    ready: LR.socket ? ['connecting', 'open', 'closing', 'closed'][LR.socket.readyState] : null,
    peers: LR.peers ? [...LR.peers.values()].map((e) => ({ st: e.pc.connectionState, remote: e.remoteStream.getTracks().map(t) })) : null,
    local: LR.localStream ? LR.localStream.getTracks().map(t) : null,
    mic: document.getElementById('micBtnText')?.textContent,
    cam: document.getElementById('camBtnText')?.textContent,
    count: document.getElementById('participantCountNum')?.textContent,
    tiles: [...document.querySelectorAll('#videoGrid .tile')].map((el) => el.querySelector('.tile__name')?.textContent),
    gridVideos: vids,
    pipVisible: document.getElementById('pipWindow') && !document.getElementById('pipWindow').hidden,
    screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
    screenVideo: (() => { const v = document.getElementById('screenVideo'); return v ? `${v.videoWidth}x${v.videoHeight}` : 'none'; })(),
    screenEmptyHidden: document.getElementById('screenEmpty')?.hidden,
    chat: [...document.querySelectorAll('#chatMessages > *')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).slice(-3),
    people: [...document.querySelectorAll('#peopleList > *')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).slice(0, 6),
  };
});

const click = (page, id) => page.evaluate((elId) => document.getElementById(elId).click(), id);

export default async function run(page) {
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  const url = new URL(href, BASE).href;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  log.push({ step: 'teacher boot', r: await bootRoom(page) });
  await page.waitForTimeout(6000);
  log.push({ step: 'teacher alone', t: await snap(page) });

  const sctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 860 } });
  await sctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const student = await sctx.newPage();
  await login(student, 'qastudent', 'QaTest!2345');
  await student.goto(url, { waitUntil: 'domcontentloaded' });
  log.push({ step: 'student boot', r: await bootRoom(student) });
  await student.waitForTimeout(9000);
  log.push({ step: 'both', t: await snap(page), s: await snap(student) });

  // chat: talaba -> ustoz
  await student.evaluate(() => { document.getElementById('chatInput').value = 'Assalomu alaykum, ustoz!'; });
  await student.press('#chatInput', 'Enter');
  await page.waitForTimeout(1500);
  log.push({ step: 'chat', tChat: (await snap(page)).chat });

  // ustoz: hammasini mute
  await click(page, 'muteAllBtn');
  await page.waitForTimeout(1500);
  const s2 = await snap(student);
  log.push({ step: 'mute-all', sMic: s2.mic, sLocal: s2.local });

  // ustoz ekran uzatadi
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    setInterval(() => { g.fillStyle = '#14204a'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#22d3ee'; g.font = '72px sans-serif'; g.fillText('USTOZ EKRANI', 90, 380); }, 80);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(15);
  });
  await click(page, 'shareScreenBtn');
  await page.waitForTimeout(7000);
  log.push({ step: 'screen', t: await snap(page), s: await snap(student) });

  await page.screenshot({ path: '_qa_t_screen.png' });
  await student.screenshot({ path: '_qa_s_screen.png' });

  // ekran to'xtatish
  await click(page, 'shareScreenBtn');
  await page.waitForTimeout(2500);
  log.push({ step: 'screen-off', s: await snap(student) });

  await sctx.close();
  return log;
}
