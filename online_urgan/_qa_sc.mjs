/* Xona kodi bilan aynan bir xil RTCPeerConnection konfiguratsiyasini sinash. */
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
  const cfg = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
    iceCandidatePoolSize: 0,
  };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 1280, height: 720, facingMode: 'user' } });
  const R = {};
  // 1) xonaning aynan konfiguratsiyasi
  const pc = new RTCPeerConnection(cfg);
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  const off = await pc.createOffer();
  R.offerBundle = /a=group:BUNDLE/.test(off.sdp);
  try { await pc.setLocalDescription(off); R.setLocal = 'ok'; } catch (e) { R.setLocal = e.message.slice(0, 130); }
  pc.close();

  // 2) initial offer (implicit setLocalDescription)
  const pc2 = new RTCPeerConnection(cfg);
  stream.getTracks().forEach((t) => pc2.addTrack(t, stream));
  try { await pc2.setLocalDescription(); R.implicit = 'ok, bundle=' + /a=group:BUNDLE/.test(pc2.localDescription.sdp); }
  catch (e) { R.implicit = e.message.slice(0, 130); }
  pc2.close();

  // 3) audio/video ni ALOHIDA stream bilan
  const pc3 = new RTCPeerConnection(cfg);
  const v = stream.getVideoTracks()[0], a = stream.getAudioTracks()[0];
  pc3.addTrack(v, new MediaStream([v]));
  pc3.addTrack(a, new MediaStream([a]));
  try { await pc3.setLocalDescription(await pc3.createOffer()); R.separate = 'ok, bundle=' + /a=group:BUNDLE/.test(pc3.localDescription.sdp); }
  catch (e) { R.separate = e.message.slice(0, 130); }
  pc3.close();

  stream.getTracks().forEach((t) => t.stop());
  return R;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
