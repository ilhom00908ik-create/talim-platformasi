/* mute_all dublikati va ekran track'i: server qancha marta yuboradi? */
const BASE = 'http://127.0.0.1:8012';

async function login(p, u, pw) {
  await p.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await p.fill('input[name="username"]', u);
  await p.fill('input[name="password"]', pw);
  await p.click('form button[type="submit"]');
  await p.waitForURL(/dashboard/, { timeout: 20000 });
}

async function boot(p) {
  return p.evaluate(async () => {
    if (window.__liveRoom) return 'already';
    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    new Function(await (await fetch(tag.src)).text())();
    return window.__liveRoom ? 'ok' : 'fail';
  });
}

export default async function run(page) {
  // xom WS xabarlarini ushlash
  await page.addInitScript(() => {
    window.__WSMSG = [];
    const Orig = window.WebSocket;
    window.WebSocket = function (...a) {
      const ws = new Orig(...a);
      ws.addEventListener('message', (e) => { try { const d = JSON.parse(e.data); window.__WSMSG.push(d.type + (d.sender_id ? ':' + d.sender_id : '')); } catch (err) { } });
      return ws;
    };
    window.WebSocket.prototype = Orig.prototype;
    window.WebSocket.OPEN = 1;
  });
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  const url = new URL(href, BASE).href;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(page);
  await page.waitForTimeout(5000);

  const ctx2 = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.grantPermissions(['camera', 'microphone'], { origin: BASE });
  const st = await ctx2.newPage();
  await st.addInitScript(() => {
    window.__WSMSG = [];
    const Orig = window.WebSocket;
    window.WebSocket = function (...a) {
      const ws = new Orig(...a);
      ws.addEventListener('message', (e) => { try { const d = JSON.parse(e.data); window.__WSMSG.push(d.type + (d.sender_id ? ':' + d.sender_id : '')); } catch (err) { } });
      return ws;
    };
    window.WebSocket.prototype = Orig.prototype;
    window.WebSocket.OPEN = 1;
  });
  await login(st, 'qastudent', 'QaTest!2345');
  await st.goto(url, { waitUntil: 'domcontentloaded' });
  await boot(st);
  await st.waitForTimeout(8000);

  const peerState = await st.evaluate(() => [...(window.__liveRoom?.peers?.values() || [])].map((e) => ({
    state: e.pc.connectionState,
    transceivers: e.pc.getTransceivers().map((t) => `${t.sender.track ? t.sender.track.kind : '-'}->${t.receiver.track ? t.receiver.track.kind : '-'}/dir=${t.direction}/mid=${t.mid}`),
    remote: e.remoteStream.getTracks().map((t) => t.kind),
  })));

  await st.evaluate(() => { window.__WSMSG.length = 0; });
  await page.evaluate(() => document.getElementById('muteAllBtn').click());
  await page.waitForTimeout(2500);
  const muteMsgs = await st.evaluate(() => window.__WSMSG.slice());

  return {
    studentPeers: peerState,
    studentVideoTracks: await st.evaluate(() => [...(window.__liveRoom?.peers?.values() || [])].map((e) => e.remoteStream.getVideoTracks().map((t) => t.label))),
    muteAllMessagesReceived: muteMsgs.filter((m) => m.includes('mute_all')),
    allMessages: muteMsgs.slice(0, 20),
    ctx2close: await ctx2.close().then(() => 'closed'),
  };
}
