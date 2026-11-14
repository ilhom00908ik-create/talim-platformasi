const BASE = 'http://127.0.0.1:8765';
const LESSON = 14;

async function login(page, username) {
  await page.goto(BASE + '/login/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('input[name="username"]', { timeout: 90000 });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', 'DemoPass123');
  await page.fill('input[name="device_key"]', '');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { }),
    page.evaluate(() => document.querySelector('form').submit()),
  ]);
  await page.goto(BASE + `/online-urgat/live/${LESSON}/join/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#stageView', { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}

const FAKE_MEDIA = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let hue = 200;
  setInterval(() => {
    hue = (hue + 3) % 360;
    ctx.fillStyle = `hsl(${hue}, 60%, 35%)`;
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText('VIDEO', 200, 260);
  }, 120);
  const videoStream = canvas.captureStream(15);

  const Ctx = window.AudioContext;
  const audioCtx = new Ctx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();
  osc.frequency.value = 220;
  gain.gain.value = 0.12;
  osc.connect(gain); gain.connect(dest);
  osc.start();

  const fakeStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  navigator.mediaDevices.getUserMedia = async () => fakeStream;
};

export default async function run(page, ui) {
  const ctx = page.context();
  await ctx.addInitScript(FAKE_MEDIA);
  await page.setViewportSize({ width: 1440, height: 860 });

  const errors = [];
  const trackConsole = (p, who) => {
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`${who} PAGEERROR: ${e.message}`));
  };

  const teacher = await login(page, 'demo_ustoz');
  trackConsole(teacher, 'teacher');
  await teacher.waitForTimeout(2500);

  const s1 = await login(await ctx.newPage(), 'demo_oqituvchi1');
  trackConsole(s1, 'student1');
  await s1.waitForTimeout(2500);
  const s2 = await login(await ctx.newPage(), 'demo_oqituvchi2');
  trackConsole(s2, 'student2');
  await s2.waitForTimeout(4500);

  const readState = (p) => p.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const row = (n) => g('peopleList')?.querySelectorAll('.people-row')[n];
    const meters = [...document.querySelectorAll('.people-row .meter__fill')]
      .map((el) => ({ for: el.dataset.meterFor, width: el.style.width }));
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      stageBg: getComputedStyle(g('stageView')).backgroundColor,
      stageClass: g('stageView')?.className,
      cols: g('videoGrid')?.style.getPropertyValue('--cols'),
      tiles: [...(g('videoGrid')?.querySelectorAll('.tile') || [])].map((t) => ({
        id: t.dataset.userId,
        speaking: t.classList.contains('is-speaking'),
        videoHidden: t.querySelector('video')?.classList.contains('is-hidden'),
        placeholder: t.querySelector('.tile__placeholder')?.hidden,
        name: t.querySelector('.tile__name')?.textContent.trim(),
      })),
      people: [...(g('peopleList')?.querySelectorAll('.people-row') || [])].map((r) => ({
        id: r.dataset.userId,
        name: r.querySelector('.people-name-text')?.textContent,
        tag: r.querySelector('.tag')?.textContent || '',
        speaking: r.classList.contains('is-speaking'),
        muted: !!r.querySelector('[data-mic].is-muted'),
        micDisabled: r.querySelector('[data-mic]')?.disabled,
      })),
      count: g('participantCountNum')?.textContent,
      meters,
      speakingChip: g('speakingChip')?.hidden === false ? g('speakingName')?.textContent : null,
      pipHidden: g('pipWindow')?.hidden,
      stripHidden: g('stageStrip')?.hidden,
      screenVideoHasStream: !!g('screenVideo')?.srcObject,
      resolve: 1,
      __row0: !!row(0),
    };
  });

  const teacherState = await readState(teacher);
  await teacher.screenshot({ path: '_live_grid.png' });

  // --- 1) Ustoz studentning mikrofonini o'chiradi ---
  const studentId = teacherState.people.find((p) => p.name.startsWith('Dilnoza'))?.id;
  await teacher.evaluate((sid) => {
    document.querySelector(`.people-row[data-user-id="${sid}"] [data-mic]`)?.click();
  }, studentId);
  await teacher.waitForTimeout(1500);
  const afterMute = await readState(teacher);
  const studentView = await readState(s1);

  // --- 2) Student "Hammasini yoqish" dan keyin o'zini yoqadi ---
  await teacher.evaluate(() => document.getElementById('muteAllBtn').click());
  await teacher.waitForTimeout(1200);
  await s1.evaluate(() => document.getElementById('toggleMicBtn').click());
  await s1.waitForTimeout(1500);
  const afterMuteAll = await readState(teacher);
  const s1Own = await readState(s1);

  // --- 3) Ustoz ekran uzatadi (fake getDisplayMedia) ---
  await teacher.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const c = canvas.getContext('2d');
    let i = 0;
    setInterval(() => {
      i += 4;
      c.fillStyle = '#0f766e'; c.fillRect(0, 0, 1280, 720);
      c.fillStyle = '#fff'; c.font = 'bold 72px sans-serif';
      c.fillText('USTOZ EKRANI ' + i, 200, 380);
    }, 100);
    navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(10);
    document.getElementById('shareScreenBtn').click();
  });
  await teacher.waitForTimeout(4000);
  const teacherScreen = await readState(teacher);
  const studentScreen = await readState(s1);
  await teacher.screenshot({ path: '_live_screen.png' });
  await s1.screenshot({ path: '_live_screen_student.png' });

  return { teacherState, afterMute, studentView, afterMuteAll, s1Own, teacherScreen, studentScreen, errors: errors.slice(0, 12) };
}
