/* getUserMedia va viewport ({?}) sahifada bajariladimi? */
const BASE = 'http://127.0.0.1:8011';

export default async function run(page) {
  const out = {};
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  out.secureContext = await page.evaluate(() => window.isSecureContext);
  out.hasMediaDevices = await page.evaluate(() => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
  out.permissions = await page.evaluate(async () => {
    try {
      const p = await navigator.permissions.query({ name: 'camera' });
      return p.state;
    } catch (e) { return 'err: ' + e.message; }
  });
  out.gum = await page.evaluate(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      await new Promise((r) => setTimeout(r, 1000));
      const tracks = s.getTracks().map((t) => `${t.kind}:${t.readyState}`);
      const v = s.getVideoTracks()[0];
      await new Promise((r) => setTimeout(r, 500));
      const size = v ? `${v.getSettings().width}x${v.getSettings().height}` : null;
      s.getTracks().forEach((t) => t.stop());
      return { ok: true, tracks, size };
    } catch (e) {
      return { ok: false, name: e.name, msg: e.message };
    }
  });
  out.wrtc = await page.evaluate(async () => {
    if (!window.RTCPeerConnection) return 'no-wrtc';
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const dc = pc.createDataChannel('x');
      const ice = [];
      pc.onicecandidate = (e) => { if (e.candidate) ice.push(e.candidate.type); };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((r) => setTimeout(r, 2500));
      const res = { gathering: pc.iceGatheringState, candidates: [...new Set(ice)] };
      pc.close();
      return res;
    } catch (e) { return 'err: ' + e.message; }
  });
  out.ws = await page.evaluate(async () => new Promise((resolve) => {
    try {
      const ws = new WebSocket('ws://127.0.0.1:8011/ws/live/33/');
      ws.onopen = () => { ws.close(); resolve('open'); };
      ws.onerror = () => resolve('error');
      ws.onclose = (e) => resolve('close:' + e.code);
      setTimeout(() => resolve('timeout'), 6000);
    } catch (e) { resolve('err: ' + e.message); }
  }));
  return out;
}
