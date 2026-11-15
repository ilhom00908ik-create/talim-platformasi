export default async function run(page) {
  const out = {};
  // 1) inline skript bajariladimi?
  out.inline = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__INL = 1;';
    document.body.appendChild(s);
    return window.__INL === 1;
  });
  // 2) sahifadagi live_room.js tegining holati
  out.tag = await page.evaluate(() => {
    const t = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    return t ? { src: t.src, defer: t.defer, async: t.async, type: t.type, outer: t.outerHTML.slice(0, 160) } : null;
  });
  // 3) fetch bilan skriptni olib, qo'lda bajarish
  out.manual = await page.evaluate(async () => {
    const t = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    const code = await (await fetch(t.src)).text();
    try { new Function(code)(); } catch (e) { return 'THROW: ' + e.message; }
    return 'ran, liveRoom=' + (window.__liveRoom ? 'yes' : 'no');
  });
  await page.waitForTimeout(4000);
  out.after = await page.evaluate(() => ({
    liveRoom: !!window.__liveRoom,
    socket: window.__liveRoom ? (window.__liveRoom.socket ? window.__liveRoom.socket.readyState : 'null') : 'n/a',
    local: window.__liveRoom && window.__liveRoom.localStream ? window.__liveRoom.localStream.getTracks().map((x) => x.kind + ':' + x.readyState) : null,
    banner: document.getElementById('mediaBanner')?.hidden === false ? document.getElementById('mediaBannerText')?.textContent : null,
    count: document.getElementById('participantCountNum')?.textContent,
    chats: document.querySelectorAll('#chatMessages > *').length,
    toasts: [...document.querySelectorAll('#toastStack .toast')].map((n) => n.textContent.trim()),
  }));
  return out;
}
