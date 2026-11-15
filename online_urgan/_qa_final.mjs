/* YAKUNIY UI TEST — sahifa skriptlarini qo'lda yuklab, xonaning HAQIQIY UI'sini sinash.
   Bu muhitda sahifadagi <script> teglari avtomatik bajarilmaydi (patchright cheklovi),
   shuning uchun kod `new Function` bilan yuklanadi. Bu kodning o'zi emas, muhit cheklovi. */
const BASE = 'http://127.0.0.1:8012';

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard|pending|apply/, { timeout: 20000 });
}

async function boot(page) {
  return page.evaluate(async () => {
    if (window.__liveRoom) return 'already';
    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    if (!tag) return 'no-tag';
    new Function(await (await fetch(tag.src)).text())();
    return window.__liveRoom ? 'ok' : 'no-diag';
  });
}

const snap = (p) => p.evaluate(() => {
  const L = window.__liveRoom || {};
  const t = (x) => `${x.kind}:${x.readyState}`;
  const v = document.getElementById('screenVideo');
  return {
    ws: L.socket ? ['?', 'OPEN', 'CLOSE', 'CLOSED'][L.socket.readyState] : 'none',
    local: L.localStream ? L.localStream.getTracks().map(t) : null,
    peers: L.peers ? [...L.peers.values()].map((e) => ({
      state: e.pc.connectionState,
      out: e.pc.getSenders().filter((s) => s.track).map((s) => s.track.kind),
      in: e.remoteStream.getTracks().map(t),
    })) : null,
    count: document.getElementById('participantCountNum')?.textContent,
    people: [...document.querySelectorAll('#peopleList .people-row')].map((r) => ({
      name: r.querySelector('.people-name-text')?.textContent,
      muted: !!r.querySelector('.mic-badge.is-muted'),
    })),
    tiles: [...document.querySelectorAll('#videoGrid .tile')].map((el) => {
      const vid = el.querySelector('video');
      return { name: el.querySelector('.tile__name')?.textContent, size: vid ? `${vid.videoWidth}x${vid.videoHeight}` : '-' };
    }),
    pip: (() => { const w = document.getElementById('pipWindow'); return w && !w.hidden ? 'shown' : 'hidden'; })(),
    screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
    screen: v ? `${v.videoWidth}x${v.videoHeight}` : '-',
    screenPlaying: v ? !v.paused : false,
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
  await page.waitForTimeout(6000);
  R.teacherAlone = await snap(page);

  const ctx2 = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const st = await ctx2.newPage();
  await login(st, 'qastudent', 'QaTest!2345');
  await st.goto(url, { waitUntil: 'domcontentloaded' });
  R.studentBoot = await boot(st);
  await st.waitForTimeout(9000);
  R.both = { teacher: await snap(page), student: await snap(st) };

  // CHAT
  await st.evaluate(() => { document.getElementById('chatInput').value = 'Salom, ustoz!'; });
  await st.press('#chatInput', 'Enter');
  await page.waitForTimeout(1500);
  R.chatOnTeacher = (await snap(page)).chat;
  // room-state qayta yuborilganda dublikat bo'lmasligi
  await page.evaluate(() => window.__liveRoom && window.__liveRoom.socket && window.__liveRoom.socket.send(JSON.stringify({ type: 'roster-sync' })));
  await page.waitForTimeout(1500);
  R.chatAfterResync = (await snap(page)).chat;

  // MUTE ALL
  await click(page, 'muteAllBtn');
  await page.waitForTimeout(1500);
  R.afterMuteAll = (await snap(st)).people;

  // EKRAN UZATISH
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    setInterval(() => { g.fillStyle = '#14204a'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#22d3ee'; g.font = 'bold 72px sans-serif'; g.fillText('USTOZ EKRANI', 90, 380); }, 80);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(15);
  });
  await click(page, 'shareScreenBtn');
  await page.waitForTimeout(8000);
  R.screenShare = { teacher: await snap(page), student: await snap(st) };
  await page.screenshot({ path: '_qa_final_teacher.png' });
  await st.screenshot({ path: '_qa_final_student.png' });

  await click(page, 'shareScreenBtn');
  await page.waitForTimeout(3000);
  R.screenStop = { studentScreenMode: (await snap(st)).screenMode };

  await ctx2.close();
  return R;
}
