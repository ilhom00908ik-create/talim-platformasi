/* Ustoz tomonida nima sotinib qolyapti: ICE candidate'lar va STUN javobi. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
const browser = await pw.chromium.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
});
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
const page = await ctx.newPage();
await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(async () => {
  const res = {};
  // 1) xonaning o'z konfiguratsiyasi
  for (const servers of [
    [],
    [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }],
  ]) {
    const cfg = { iceServers: servers, bundlePolicy: 'balanced', iceCandidatePoolSize: 0 };
    const pc = new RTCPeerConnection(cfg);
    const cands = [];
    pc.onicecandidate = (e) => { if (e.candidate) cands.push(e.candidate.type + ':' + e.candidate.protocol + ':' + e.candidate.address); };
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') cands.push('COMPLETE'); };
    pc.createDataChannel('x');
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => setTimeout(r, 4000));
    res[servers.length ? 'with-stun' : 'no-stun'] = { gathering: pc.iceGatheringState, cands: cands.slice(0, 10) };
    pc.close();
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
