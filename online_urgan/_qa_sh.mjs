const BASE = 'http://127.0.0.1:8011';

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

export default async function run(page) {
  const info = {};
  page.on('pageerror', (e) => { (info.pageErrors = info.pageErrors || []).push(e.message.slice(0, 300)); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) (info.consoleErrors = info.consoleErrors || []).push(m.text().slice(0, 300));
  });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  await page.goto(new URL(href, BASE).href, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  info.state = await page.evaluate(() => ({
    liveRoom: typeof window.__liveRoom,
    keys: window.__liveRoom ? Object.keys(window.__liveRoom) : null,
    cfgPara: (() => { try { const j = JSON.parse(document.getElementById('liveRoomConfig').textContent); return { ok: true, userId: j.userId, lessonId: j.lessonId, role: j.role, wsPath: j.wsPath }; } catch (e) { return { ok: false, error: e.message }; } })(),
    hasGrid: !!document.getElementById('videoGrid'),
    hasMicBtn: !!document.getElementById('toggleMicBtn'),
    mediaBanner: document.getElementById('mediaBanner')?.hidden === false ? document.getElementById('mediaBannerText')?.textContent : 'hidden',
    chatItems: document.querySelectorAll('#chatMessages > *').length,
    wsProtocol: location.protocol,
  }));
  // sahifada inline skript bajariladimi?
  info.inlineWorks = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__INL=1;'; document.body.appendChild(s); return window.__INL === 1; });
  info.scriptSrcs = await page.evaluate(() => [...document.scripts].map((s) => s.src || ('inline:' + (s.type || 'js'))));
  return info;
}
