/* Jonli darsxona E2E: ustoz + o'quvchi, fake kamera/mikrofon, haqiqiy WebRTC.
   node _pw_live.mjs */
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [
    'c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright',
    'c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/playwright',
    'patchright',
    'playwright',
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch (e) { /* next */ }
  }
  return null;
}

const pw = loadPlaywright();
if (!pw) {
  console.log('NO_PLAYWRIGHT');
  process.exit(2);
}

const BASE = 'http://127.0.0.1:8011';
const ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

function findBrowser() {
  const roots = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  return roots.find((p) => fs.existsSync(p)) || undefined;
}

const browser = await pw.chromium.launch({
  headless: true,
  executablePath: findBrowser(),
  args: ARGS,
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 860 },
  permissions: ['camera', 'microphone'],
});

const report = { console: [], failed: [], steps: [] };
function attach(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') report.console.push(`[${label}:${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => report.console.push(`[${label}:pageerror] ${e.message}`));
  page.on('requestfailed', (r) => report.failed.push(`[${label}] ${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) report.failed.push(`[${label}] ${r.status()} ${r.url()}`);
  });
}

async function login(page, username, password) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  const user = page.locator('input[name="username"]').first();
  await user.fill(username);
  await page.locator('input[name="password"]').first().fill(password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('form button[type="submit"], form input[type="submit"]').first().click(),
  ]);
  return page.url();
}

const step = (name, data) => report.steps.push({ name, ...(data || {}) });

// ---- 1. ustoz ----
const teacher = await ctx.newPage();
attach(teacher, 'teacher');
const afterLogin = await login(teacher, 'qaapproved', 'QaTest!2345');
step('teacher login ->', { url: afterLogin });

await teacher.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
const joinHref = await teacher.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
  return a ? a.getAttribute('href') : null;
});
step('dashboard join link', { joinHref });
const lessonUrl = joinHref
  ? new URL(joinHref, BASE).href
  : `${BASE}/online-urgat/live/${process.env.LESSON_ID}/join/`;

await teacher.goto(lessonUrl, { waitUntil: 'domcontentloaded' });
await teacher.waitForTimeout(2500);
const tState0 = await teacher.evaluate(() => ({
  hint: document.getElementById('stageHint')?.hidden,
  tiles: document.querySelectorAll('#videoGrid .tile').length,
  badge: document.getElementById('liveBadgeText')?.textContent?.trim(),
  banner: !document.getElementById('mediaBanner')?.hidden,
  bannerText: document.getElementById('mediaBannerText')?.textContent?.trim(),
  hasConfig: !!document.getElementById('liveRoomConfig'),
  socket: typeof window.__liveRoom,
  videoPlaying: document.querySelector('#videoGrid video') ? !document.querySelector('#videoGrid video').paused : null,
  localTracks: (window.__liveRoom && window.__liveRoom.room ? true : false),
}));
step('teacher room initial', tState0);
await teacher.screenshot({ path: 'qa_e2e_1_teacher.png' });

// ---- 2. o'quvchi ----
const student = await ctx.newPage();
attach(student, 'student');
await login(student, 'qastudent', 'QaTest!2345');
await student.goto(lessonUrl, { waitUntil: 'domcontentloaded' });
await student.waitForTimeout(3500);
const sState0 = await student.evaluate(() => ({
  tiles: document.querySelectorAll('#videoGrid .tile').length,
  pip: !document.getElementById('pipWindow')?.hidden,
  hint: document.getElementById('stageHint')?.hidden,
  people: document.querySelectorAll('#peopleList .people-row').length,
  count: document.getElementById('participantCountNum')?.textContent,
  videoSrc: [...document.querySelectorAll('.tile video')].map((v) => ({ paused: v.paused, w: v.videoWidth, hidden: v.classList.contains('is-hidden') })),
  pipVideo: (() => { const v = document.getElementById('pipVideo'); return v ? { paused: v.paused, w: v.videoWidth, hidden: v.classList.contains('is-hidden') } : null; })(),
}));
step('student room after join', sState0);
await student.screenshot({ path: 'qa_e2e_2_student.png' });

// ustoz tarafida o'quvchi ko'rinadimi
await teacher.waitForTimeout(1500);
const tState1 = await teacher.evaluate(() => ({
  tiles: document.querySelectorAll('#videoGrid .tile').length,
  people: document.querySelectorAll('#peopleList .people-row').length,
  count: document.getElementById('participantCountNum')?.textContent,
  videoSrc: [...document.querySelectorAll('.tile video')].map((v) => ({ paused: v.paused, w: v.videoWidth, hidden: v.classList.contains('is-hidden') })),
}));
step('teacher sees student', tState1);
await teacher.screenshot({ path: 'qa_e2e_3_teacher_with_student.png' });

// ---- 3. ekran ulashish (getDisplayMedia stub) ----
await teacher.evaluate(() => {
  // fake ekran: canvas oqimi
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx2 = canvas.getContext('2d');
  let n = 0;
  setInterval(() => {
    ctx2.fillStyle = '#1b2559'; ctx2.fillRect(0, 0, 1280, 720);
    ctx2.fillStyle = '#22d3ee'; ctx2.font = '64px sans-serif';
    ctx2.fillText('USTOZ EKRANI ' + (++n), 80, 360);
  }, 60);
  window.__fakeDisplay = () => canvas.captureStream(15);
  navigator.mediaDevices.getDisplayMedia = async () => window.__fakeDisplay();
});
await teacher.click('#shareScreenBtn');
await teacher.waitForTimeout(3500);
const tScreen = await teacher.evaluate(() => ({
  screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
  screenChip: !document.getElementById('screenChip')?.hidden,
  screenVideo: (() => { const v = document.getElementById('screenVideo'); return v ? { paused: v.paused, w: v.videoWidth } : null; })(),
  screenOwner: window.__liveRoom?.getState ? window.__liveRoom.getState() : null,
}));
step('teacher screen share', tScreen);
await teacher.screenshot({ path: 'qa_e2e_4_teacher_screen.png' });

await student.waitForTimeout(3500);
const sScreen = await student.evaluate(() => ({
  screenMode: document.getElementById('stageView')?.classList.contains('screen-mode'),
  screenChip: !document.getElementById('screenChip')?.hidden,
  screenChipText: document.getElementById('screenChipText')?.textContent,
  screenVideo: (() => { const v = document.getElementById('screenVideo'); return v ? { paused: v.paused, w: v.videoWidth } : null; })(),
  strip: [...document.querySelectorAll('#stripList .tile')].length,
  empty: !document.getElementById('screenEmpty')?.hidden,
}));
step('student sees screen', sScreen);
await student.screenshot({ path: 'qa_e2e_5_student_screen.png' });

// ---- 4. ustoz mikrofon mute -> o'quvchida indikator ----
await teacher.click('#toggleMicBtn');
await student.waitForTimeout(1200);
const sMic = await student.evaluate(() => {
  const host = [...document.querySelectorAll('#peopleList .people-row')].map((r) => ({
    name: r.querySelector('.people-name-text')?.textContent,
    muted: !!r.querySelector('.mic-badge.is-muted'),
  }));
  return { people: host, pipMic: document.getElementById('pipMic')?.classList.contains('is-muted') };
});
step('student sees teacher muted', sMic);

// ---- 5. o'quvchi mikrofon bilan gapiradi (fake tone) ----
await student.click('#toggleMicBtn'); // yoqish
await student.waitForTimeout(2500);
const tSpeak = await teacher.evaluate(() => ({
  chip: !document.getElementById('speakingChip')?.hidden,
  chipText: document.getElementById('speakingName')?.textContent,
  speakingTiles: document.querySelectorAll('.tile.is-speaking').length,
  meterWidth: [...document.querySelectorAll('#peopleList .meter__fill')].map((m) => m.style.width),
}));
step('teacher speaking indicator', tSpeak);
await teacher.screenshot({ path: 'qa_e2e_6_teacher_speaking.png' });

report.console = report.console.slice(0, 40);
report.failed = [...new Set(report.failed)].slice(0, 20);
console.log(JSON.stringify(report, null, 2));
await browser.close();
