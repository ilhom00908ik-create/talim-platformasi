/* Xona kodining AYNAN konfiguratsiyasi bilan turli bundlePolicy sinovi. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
const browser = await pw.chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights', '--use-fake-ui-for-media-stream'],
});
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
const page = await ctx.newPage();
await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 1280, height: 720, facingMode: 'user' } });
  const a = stream.getAudioTracks()[0];
  const v = stream.getVideoTracks()[0];
  const R = {};

  for (const policy of ['max-bundle', 'balanced', 'max-compat']) {
    // addTrack
    const p1 = new RTCPeerConnection({ bundlePolicy: policy, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceCandidatePoolSize: 0 });
    p1.addTrack(a, stream); p1.addTrack(v, stream);
    try { const o = await p1.createOffer(); await p1.setLocalDescription(o); R[policy + '-addTrack'] = 'ok bundle=' + /a=group:BUNDLE/.test(p1.localDescription.sdp); }
    catch (e) { R[policy + '-addTrack'] = 'ERR ' + e.message.slice(-60); }
    p1.close();

    // addTransceiver + replaceTrack
    const p2 = new RTCPeerConnection({ bundlePolicy: policy, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceCandidatePoolSize: 0 });
    p2.addTransceiver('audio', { direction: 'sendrecv' }).sender.replaceTrack(a).catch(() => { });
    p2.addTransceiver('video', { direction: 'sendrecv' }).sender.replaceTrack(v).catch(() => { });
    try { const o = await p2.createOffer(); await p2.setLocalDescription(o); R[policy + '-transceiver'] = 'ok bundle=' + /a=group:BUNDLE/.test(p2.localDescription.sdp); }
    catch (e) { R[policy + '-transceiver'] = 'ERR ' + e.message.slice(-60); }
    p2.close();
  }
  stream.getTracks().forEach((t) => t.stop());
  return R;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
