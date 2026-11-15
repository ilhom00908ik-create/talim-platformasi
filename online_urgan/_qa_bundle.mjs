/* max-bundle vs balanced — qaysi biri offer yaratadi? */
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
  const res = {};
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
  for (const policy of ['max-bundle', 'balanced', 'max-compat']) {
    const pc = new RTCPeerConnection({ bundlePolicy: policy, iceServers: [] });
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    try {
      const offer = await pc.createOffer();
      res[policy] = { ok: true, audio: (offer.sdp.match(/m=audio/g) || []).length, video: (offer.sdp.match(/m=video/g) || []).length, bundle: /a=group:BUNDLE/.test(offer.sdp) };
    } catch (e) { res[policy] = { ok: false, err: e.message.slice(0, 120) }; }
    pc.close();
  }
  // ko'p track bilan
  const pc2 = new RTCPeerConnection({ bundlePolicy: 'max-bundle', iceServers: [] });
  stream.getTracks().forEach((t) => pc2.addTrack(t, stream));
  const canvas = document.createElement('canvas');
  const screen = canvas.captureStream(5).getVideoTracks()[0];
  pc2.addTrack(screen, new MediaStream([screen]));
  try {
    const o = await pc2.createOffer();
    res.threeTracksMaxBundle = { ok: true, audio: (o.sdp.match(/m=audio/g) || []).length, video: (o.sdp.match(/m=video/g) || []).length };
  } catch (e) { res.threeTracksMaxBundle = { ok: false, err: e.message.slice(0, 120) }; }
  pc2.close();
  stream.getTracks().forEach((t) => t.stop());
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
