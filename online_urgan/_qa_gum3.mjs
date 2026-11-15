/* Eksplicit ruxsat bilan getUserMedia */
const BASE = 'http://127.0.0.1:8012';

export default async function run(page) {
  const out = {};
  try { await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE }); out.granted = true; }
  catch (e) { out.granted = 'err: ' + e.message; }
  out.origin = BASE;
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  out.permState = await page.evaluate(async () => {
    const r = {};
    for (const name of ['camera', 'microphone']) {
      try { r[name] = (await navigator.permissions.query({ name })).state; } catch (e) { r[name] = 'err ' + e.message; }
    }
    return r;
  });
  out.gum = await page.evaluate(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
      await new Promise((r) => setTimeout(r, 600));
      const v = s.getVideoTracks()[0];
      const res = { ok: true, tracks: s.getTracks().map((t) => `${t.kind}:${t.readyState}`), size: v ? `${v.getSettings().width}x${v.getSettings().height}` : null };
      s.getTracks().forEach((t) => t.stop());
      return res;
    } catch (e) { return { ok: false, name: e.name, msg: e.message }; }
  });
  return out;
}
