/* Jonli xona: sahifa <script> larini qo'lda bajarib, real UI'ni tekshirish. */
const BASE = 'http://127.0.0.1:8011';

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard|pending|apply/, { timeout: 20000 });
}

// Sahifadagi tashqi skriptlarni fetch qilib, o'z-o'zidan bajarish
async function bootRoomJs(page) {
  return page.evaluate(async () => {
    if (window.__liveRoom) return 'already';
    const srcs = [...document.scripts].map((s) => s && s.src).filter(Boolean);
    const room = srcs.find((s) => s.includes('live_room.js'));
    if (!room) return 'no-script-tag';
    const code = await (await fetch(room)).text();
    try {
      new Function(code)();
      return 'ran:' + (window.__liveRoom ? 'liveRoom-ok' : 'liveRoom-missing');
    } catch (e) {
      return 'error: ' + e.message;
    }
  });
}

const snap = (page) => page.evaluate(() => {
  const LR = window.__liveRoom || {};
  const track = (t) => `${t.kind}:${t.readyState}${t.enabled ? '' : '(off)'}`;
  return {
    scriptLoaded: !!window.__liveRoom,
    socket: LR.socket ? ['connecting', 'open', 'closing', 'closed'][LR.socket.readyState] : null,
    peers: LR.peers ? [...LR.peers.values()].map((e) => ({
      state: e.pc.connectionState,
      remote: e.remoteStream.getTracks().map(track),
    })) : null,
    local: LR.localStream ? LR.localStream.getTracks().map(track) : null,
    micBtn: document.getElementById('micBtnText')?.textContent,
    count: document.getElementById('participantCountNum')?.textContent,
    tiles: [...document.querySelectorAll('#videoGrid .tile')].map((t) => {
      const v = t.querySelector('video');
      return { name: t.querySelector('.tile__name')?.textContent, video: v ? `${v.videoWidth}x${v.videoHeight}` : 'no-el' };
    }),
    screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
    screen: (() => { const v = document.getElementById('screenVideo'); return `${v.videoWidth}x${v.videoHeight}`; })(),
    chat: [...document.querySelectorAll('#chatMessages > *')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).slice(-2),
  };
});

const click = (page, id) => page.evaluate((elId) => document.getElementById(elId).click(), id);
const typeChat = (page, text) => page.evaluate((t) => {
  const input = document.getElementById('chatInput');
  input.value = t;
  document.getElementById('chatForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}, text);

export default async function run(page) {
  const out = [];
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  const url = new URL(href, BASE).href;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  out.push({ step: 'teacher boot', boot: await bootRoomJs(page) });
  await page.waitForTimeout(5000);
  out.push({ step: 'teacher alone', teacher: await snap(page) });

  const sctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 860 } });
  const student = await sctx.newPage();
  await login(student, 'qastudent', 'QaTest!2345');
  await student.goto(url, { waitUntil: 'domcontentloaded' });
  out.push({ step: 'student boot', boot: await bootRoomJs(student) });
  await student.waitForTimeout(7000);
  out.push({ step: 'both', teacher: await snap(page), student: await snap(student) });

  await typeChat(student, 'Assalomu alaykum!');
  await page.waitForTimeout(1500);
  out.push({ step: 'chat', teacherChat: (await snap(page)).chat });

  await click(page, 'muteAllBtn');
  await page.waitForTimeout(1500);
  out.push({ step: 'mute-all', student: await snap(student) });

  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    setInterval(() => { g.fillStyle = '#14204a'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#22d3ee'; g.font = '72px sans-serif'; g.fillText('USTOZ EKRANI', 90, 380); }, 80);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(15);
  });
  await click(page, 'shareScreenBtn');
  await page.waitForTimeout(6000);
  out.push({ step: 'screen-share', teacher: await snap(page), student: await snap(student) });

  await student.screenshot({ path: '_qa_room_student.png' });
  await page.screenshot({ path: '_qa_room_teacher.png' });
  await sctx.close();
  return out;
}
