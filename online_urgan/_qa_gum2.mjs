/* Fake kamera/mikrofon bilan getUserMedia ishlaydimi? */
const BASE = 'http://127.0.0.1:8012';

export default async function run(page) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  return page.evaluate(async () => {
    const out = { secure: window.isSecureContext };
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      await new Promise((r) => setTimeout(r, 800));
      const v = s.getVideoTracks()[0];
      out.ok = true;
      out.tracks = s.getTracks().map((t) => `${t.kind}:${t.readyState}:${t.enabled}`);
      out.videoSize = v ? `${v.getSettings().width}x${v.getSettings().height}` : null;
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      out.ok = false;
      out.name = e.name;
      out.msg = e.message;
    }
    out.devices = (await navigator.mediaDevices.enumerateDevices()).map((d) => `${d.kind}:${d.label || 'unlabeled'}`);
    return out;
  });
}
