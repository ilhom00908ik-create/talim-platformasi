/* max-bundle + createOffer nima uchun BUNDLE guruhini bermaydi? */
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
  const R = {};
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });

  // A) sdpSemantics
  const pcA = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  stream.getTracks().forEach((t) => pcA.addTrack(t, stream));
  const oA = await pcA.createOffer();
  R.A = { bundle: /a=group:BUNDLE/.test(oA.sdp), mids: (oA.sdp.match(/a=mid:(\S+)/g) || []) };

  // B) setLocalDescription(offer)
  try { await pcA.setLocalDescription(oA); R.B = 'ok'; } catch (e) { R.B = e.message.slice(0, 140); }
  R.B_localBundle = pcA.localDescription ? /a=group:BUNDLE/.test(pcA.localDescription.sdp) : null;
  pcA.close();

  // C) addTrack bitta MediaStream bilan — balki bundle shunda yaratiladi
  const pcC = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  pcC.addTransceiver('audio', { direction: 'sendrecv' });
  pcC.addTransceiver('video', { direction: 'sendrecv' });
  const oC = await pcC.createOffer();
  R.C = { bundle: /a=group:BUNDLE/.test(oC.sdp), mids: (oC.sdp.match(/a=mid:(\S+)/g) || []) };
  pcC.close();

  // D) bundlePolicy bermay
  const pcD = new RTCPeerConnection({});
  stream.getTracks().forEach((t) => pcD.addTrack(t, stream));
  const oD = await pcD.createOffer();
  R.D = { bundle: /a=group:BUNDLE/.test(oD.sdp), mids: (oD.sdp.match(/a=mid:(\S+)/g) || []) };
  pcD.close();

  stream.getTracks().forEach((t) => t.stop());
  return R;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
