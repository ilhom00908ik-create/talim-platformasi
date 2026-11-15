/* init() qayerda to'xtaydi? Xatoni ushlash + socket holati. */
const BASE = 'http://127.0.0.1:8012';

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

export default async function run(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('live-room')) errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  await page.goto(new URL(href, BASE).href, { waitUntil: 'domcontentloaded' });

  const boot = await page.evaluate(async () => {
    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    const code = await (await fetch(tag.src)).text();
    const events = [];
    try { new Function(code)(); } catch (e) { events.push('BOOT THROW: ' + e.message); }
    return { events, wsPath: (window.__liveRoom && window.__liveRoom.config || {}).wsPath };
  });
  await page.waitForTimeout(6000);

  const state = await page.evaluate(() => {
    const LR = window.__liveRoom || {};
    return {
      socketType: typeof LR.socket,
      socketReady: LR.socket ? LR.socket.readyState : null,
      socketUrl: LR.socket ? LR.socket.url : null,
      peerCount: LR.peers ? LR.peers.size : null,
      local: LR.localStream ? LR.localStream.getTracks().map((t) => `${t.kind}:${t.readyState}`) : null,
      banner: document.getElementById('mediaBanner')?.hidden === false ? document.getElementById('mediaBannerText')?.textContent : null,
      toasts: [...document.querySelectorAll('#toastStack .toast')].map((n) => n.textContent.trim()),
      participants: document.getElementById('participantCountNum')?.textContent,
      expectedWs: (LR.config || {}).wsPath,
      host: location.host,
    };
  });
  // qo'lda WS sinovi
  const manual = await page.evaluate(async (wsPath) => new Promise((resolve) => {
    try {
      const ws = new WebSocket('ws://' + location.host + wsPath);
      const t = setTimeout(() => { try { ws.close(); } catch (e) { } resolve('timeout'); }, 6000);
      ws.onopen = () => { clearTimeout(t); ws.send(JSON.stringify({ type: 'join' })); };
      ws.onmessage = (e) => { clearTimeout(t); ws.close(); resolve('open+message: ' + String(e.data).slice(0, 80)); };
      ws.onerror = () => { clearTimeout(t); resolve('error'); };
      ws.onclose = (e) => { clearTimeout(t); resolve('close ' + e.code); };
    } catch (e) { resolve('throw ' + e.message); }
  }), state.expectedWs);
  return { boot, state, manual, errs: errs.slice(0, 8) };
}
