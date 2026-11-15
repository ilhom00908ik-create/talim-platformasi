/* "Q" prefiksi qayerdan keladi? peopleList ichidagi HTML. */
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
  await page.evaluate(async () => {
    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    new Function(await (await fetch(tag.src)).text())();
  });
  await page.waitForTimeout(5000);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#peopleList > *')];
    const LR = window.__liveRoom || {};
    const peer = LR.peers ? [...LR.peers.values()][0] : null;
    return {
      rowHTML: rows.map((r) => r.outerHTML.slice(0, 700)),
      users: LR.users ? [...LR.users.values()].map((u) => ({ id: u.id, name: u.name, role: u.role })) : null,
      cfg: LR.config ? { userId: LR.config.userId, userName: LR.config.userName, role: LR.config.role } : null,
      socket: LR.socket ? LR.socket.readyState : null,
      peerState: peer ? peer.pc.connectionState : null,
      peerSenders: peer ? peer.pc.getSenders().map((s) => (s.track ? s.track.kind : '-')) : null,
      local: LR.localStream ? LR.localStream.getTracks().map((t) => `${t.kind}:${t.readyState}`) : null,
      mediaBanner: document.getElementById('mediaBanner')?.hidden === false ? document.getElementById('mediaBannerText')?.textContent : null,
      wsReady: LR.socket ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][LR.socket.readyState] : 'no-socket',
    };
  });
}
