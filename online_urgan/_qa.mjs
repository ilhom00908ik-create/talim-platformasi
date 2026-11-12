export default async function run(page, ui) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:8000/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', 't_teacher');
  await page.fill('input[name="password"]', 'StrongPass123');
  await page.fill('input[name="device_key"]', '');
  await page.evaluate(() => document.querySelector('form').submit());
  await page.waitForTimeout(2500);
  const afterLogin = page.url();

  await page.goto('http://127.0.0.1:8000/online-urgat/live/1/join/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const room = {
    url: page.url(),
    role: await page.evaluate(() => (typeof userRole !== 'undefined' ? userRole : 'undefined')),
    stage: await page.evaluate(() => document.getElementById('stageView')?.className),
    controls: await page.evaluate(() => Array.from(document.querySelectorAll('.controls-bar button')).map((b) => b.id + ':' + b.textContent.trim())),
    screenBtn: await page.evaluate(() => document.getElementById('shareScreenBtn')?.textContent.trim()),
    debug: await page.evaluate(() => document.getElementById('rtcDebugPanel')?.textContent),
  };

  // Ekran rejimi CSS tekshiruvi
  const layout = await page.evaluate(() => {
    const stage = document.getElementById('stageView');
    stage.classList.add('screen-active');
    const screen = document.getElementById('screenVideo');
    const remote = document.getElementById('remoteVideo');
    const res = {
      screenDisplay: getComputedStyle(screen).display,
      remoteDisplay: getComputedStyle(remote).display,
      screenFit: getComputedStyle(screen).objectFit,
    };
    stage.classList.remove('screen-active');
    res.afterScreenDisplay = getComputedStyle(screen).display;
    res.afterRemoteDisplay = getComputedStyle(remote).display;
    return res;
  });

  // Tugmalarni sinash
  await page.click('#toggleMicBtn');
  await page.click('#toggleParticipantsBtn');
  await page.click('#shareScreenBtn');
  await page.waitForTimeout(1000);
  const btnState = {
    micLabel: await page.evaluate(() => document.getElementById('micIndicator')?.textContent),
    stripDisplay: await page.evaluate(() => getComputedStyle(document.getElementById('participantStrip')).display),
    shareLabel: await page.evaluate(() => document.getElementById('shareScreenBtn')?.textContent.trim()),
  };

  // Chat (WS bo'lmasa ham konsol xatosi bo'lmasligi kerak)
  await page.fill('#chatInput', '<b>salom</b>');
  await page.click('#sendChat');
  await page.waitForTimeout(500);
  const chat = await page.evaluate(() => ({
    bold: document.querySelectorAll('#chatMessages b').length,
    last: document.querySelector('#chatMessages > div:last-child')?.innerText,
  }));

  await page.screenshot({ path: 'live_room.png' });

  // Mening kurslarim
  await page.goto('http://127.0.0.1:8000/mening-kurslarim/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const courses = {
    lessonLinks: await page.evaluate(() => Array.from(document.querySelectorAll('#liveLessonsList a')).map((a) => a.getAttribute('href'))),
    courseLinks: await page.evaluate(() => Array.from(document.querySelectorAll('#coursesGrid a')).map((a) => a.getAttribute('href'))),
    confirmLiveJoin: await page.evaluate(() => typeof window.confirmLiveJoin),
    count: await page.evaluate(() => document.getElementById('liveLessonsCount')?.textContent),
  };
  await page.screenshot({ path: 'my_courses.png' });

  // Mobil menyu
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('http://127.0.0.1:8000/dashboard/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const mobileBefore = await page.evaluate(() => document.getElementById('mobileMenu')?.className);
  await page.click('#mobileMenuButton');
  const mobileAfter = await page.evaluate(() => document.getElementById('mobileMenu')?.className);

  // Profil
  await page.goto('http://127.0.0.1:8000/profile/', { waitUntil: 'domcontentloaded' });
  const profile = {
    cabinetLink: await page.evaluate(() => !!document.querySelector('a[href="/online-urgat/dashboard/"]')),
    roleText: (await page.evaluate(() => document.body.innerText)).match(/ROL\n(.+)/)?.[1],
  };

  return { afterLogin, room, layout, btnState, chat, courses, mobileBefore, mobileAfter, profile, errors };
}
