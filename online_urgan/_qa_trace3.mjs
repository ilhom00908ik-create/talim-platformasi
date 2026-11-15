/* new WebSocket() xatosi nima? console.error ni ushlaymiz. */
const BASE = 'http://127.0.0.1:8012';

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

export default async function run(page) {
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  await page.goto(new URL(href, BASE).href, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    new Function(await (await fetch(tag.src)).text())();
  });
  await page.waitForTimeout(4000);
  const direct = await page.evaluate(() => {
    const out = {};
    try {
      const ws = new WebSocket('ws://' + location.host + '/ws/live/33/');
      out.created = true;
      out.url = ws.url;
      out.ready = ws.readyState;
      ws.close();
    } catch (e) { out.thrown = e.name + ': ' + e.message; }
    out.proto = location.protocol;
    out.host = location.host;
    out.wsSupported = typeof WebSocket;
    return out;
  });
  return { logs: logs.filter((l) => l.includes('live-room') || l.includes('error')), direct };
}
