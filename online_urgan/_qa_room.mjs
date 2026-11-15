/* Jonli dars xonasi UI tekshiruvi: ustoz + talaba.
   Ishlatish: SET CODEGPT_BROWSER_PATH=... && node browser.mjs <login-url> --script _qa_room.mjs */
const BASE = 'http://127.0.0.1:8011';
const OUT = [];

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard|pending|apply/, { timeout: 20000 });
}

const roomUrl = async (teacherPage) => {
  await teacherPage.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await teacherPage.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  return new URL(href, BASE).href;
};

const snap = (page) => page.evaluate(() => {
  const LR = window.__liveRoom || {};
  const track = (t) => `${t.kind}:${t.readyState}${t.enabled ? '' : '(off)'}`;
  return {
    role: document.body.dataset.role,
    scriptLoaded: !!window.__liveRoom,
    socket: LR.socket ? ['connecting', 'open', 'closing', 'closed'][LR.socket.readyState] : null,
    connected: LR.peers ? [...LR.peers.values()].every((e) => e.pc.connectionState === 'connected') : null,
    peers: LR.peers ? [...LR.peers.values()].map((e) => ({
      state: e.pc.connectionState,
      remoteVideo: e.remoteStream.getVideoTracks().length,
      remoteAudio: e.remoteStream.getAudioTracks().length,
    })) : null,
    local: LR.localStream ? LR.localStream.getTracks().map(track) : null,
    micBtn: document.getElementById('micBtnText')?.textContent,
    count: document.getElementById('participantCountNum')?.textContent,
    gridTiles: [...document.querySelectorAll('#videoGrid .tile')].map((t) => {
      const v = t.querySelector('video');
      return {
        name: t.querySelector('.tile__name')?.textContent,
        videoSize: v ? `${v.videoWidth}x${v.videoHeight}` : 'no-el',
        placeholderShown: t.querySelector('.tile__placeholder') ? getComputedStyle(t.querySelector('.tile__placeholder')).display !== 'none' : false,
      };
    }),
    screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
    screenVideo: (() => { const v = document.getElementById('screenVideo'); return { size: `${v.videoWidth}x${v.videoHeight}`, playing: !v.paused }; })(),
    chat: [...document.querySelectorAll('#chatMessages > *')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).slice(-2),
  };
});

export default async function run(page) {
  await login(page, 'qaapproved', 'QaTest!2345');
  const url = await roomUrl(page);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  OUT.push({ step: 'teacher alone', teacher: await snap(page) });

  const sctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 860 } });
  const student = await sctx.newPage();
  await login(student, 'qastudent', 'QaTest!2345');
  await student.goto(url, { waitUntil: 'domcontentloaded' });
  await student.waitForTimeout(6000);
  OUT.push({ step: 'both in room', teacher: await snap(page), student: await snap(student) });

  // chat
  await student.fill('#chatInput', 'Assalomu alaykum!');
  await student.press('#chatInput', 'Enter');
  await page.waitForTimeout(1200);
  OUT.push({ step: 'chat', teacherChat: (await snap(page)).chat });

  // ustoz: hammasini mute
  await page.evaluate(() => document.getElementById('muteAllBtn').click());
  await page.waitForTimeout(1200);
  OUT.push({ step: 'mute all', student: await snap(student) });

  // ustoz: ekran uzatish (fake capture)
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    setInterval(() => { g.fillStyle = '#14204a'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#22d3ee'; g.font = '72px sans-serif'; g.fillText('USTOZ EKRANI', 90, 380); }, 80);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(15);
  });
  await page.evaluate(() => document.getElementById('shareScreenBtn').click());
  await page.waitForTimeout(5000);
  OUT.push({ step: 'screen share', teacher: await snap(page), student: await snap(student) });

  await student.screenshot({ path: '_qa_room_student.png' });
  await page.screenshot({ path: '_qa_room_teacher.png' });
  await sctx.close();
  return OUT;
}
