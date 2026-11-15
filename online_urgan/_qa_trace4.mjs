/* connect() ichidagi catch xatosini olish: console.error ni patch qilamiz. */
const BASE = 'http://127.0.0.1:8012';

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

export default async function run(page) {
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  await page.goto(new URL(href, BASE).href, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    window.__CAP = [];
    const origErr = console.error;
    console.error = (...a) => { window.__CAP.push('console.error: ' + a.map(String).join(' ').slice(0, 300)); origErr(...a); };
    const origWarn = console.warn;
    console.warn = (...a) => { window.__CAP.push('console.warn: ' + a.map(String).join(' ').slice(0, 300)); origWarn(...a); };

    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    let code = await (await fetch(tag.src)).text();
    // connect ichidagi try/catch xatosini oshkor qilamiz
    code = code.replace(
      "console.error('[live-room] socket create failed', error);",
      "console.error('[live-room] socket create failed', error && (error.name + ': ' + error.message + ' | ' + (error.stack||'').split('\\n').slice(0,3).join(' ~ ')));",
    );
    // new WebSocket qatorini ham tekshiramiz
    code = code.replace(
      "socket = new WebSocket(proto + '://' + window.location.host + wsPath);",
      "console.log('[live-room] WS url =', proto + '://' + window.location.host + wsPath); socket = new WebSocket(proto + '://' + window.location.host + wsPath);",
    );
    new Function(code)();
    await new Promise((r) => setTimeout(r, 5000));
    const LR = window.__liveRoom || {};
    return {
      cap: window.__CAP || [],
      socket: LR.socket ? { url: LR.socket.url, ready: LR.socket.readyState } : null,
      wsPath: (LR.config || {}).wsPath,
      host: location.host,
    };
  });
  return result;
}
