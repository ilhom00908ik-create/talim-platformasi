// Chrome DevTools Protocol orqali jonli darsxonani tekshirish.
// Node built-in fetch + WebSocket ishlatiladi (qo'shimcha paket kerak emas).
const PORT = process.env.CDP_PORT || '9333';

async function newTarget(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
  });
}

let seq = 0;
const pending = new Map();
const events = [];

function send(ws, method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

function attach(ws) {
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.method + ': ' + msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method) events.push(msg);
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE_MEDIA = `
;(function () {
  function makeCanvas(bg, label) {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    let t = 0;
    (function draw() {
      t++;
      g.fillStyle = bg; g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText(label, 24, 70);
      g.font = '18px monospace'; g.fillText('frame ' + t, 24, 110);
      g.beginPath(); g.arc(320, 210, 60 + Math.sin(t / 10) * 6, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
      requestAnimationFrame(draw);
    })();
    return c;
  }
  const cam = makeCanvas(window.__camBg || '#1d4ed8', window.__camLabel || 'CAMERA').captureStream(15);
  const scr = makeCanvas('#065f46', 'SCREEN SHARE').captureStream(10);
  const md = navigator.mediaDevices;
  window.__fakeReady = true;
  md.getUserMedia = async function () {
    window.__gumCalls = (window.__gumCalls || 0) + 1;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    osc.frequency.value = 330;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dest); osc.start();
    const tracks = cam.getVideoTracks().map((t) => t.clone());
    dest.stream.getAudioTracks().forEach((t) => tracks.push(t));
    return new MediaStream(tracks);
  };
  md.getDisplayMedia = async function () {
    window.__displayCalls = (window.__displayCalls || 0) + 1;
    return new MediaStream(scr.getVideoTracks().map((t) => t.clone()));
  };
})();
;;
`;

async function evaluate(ws, sessionId, expression) {
  const res = await send(ws, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + (res.exceptionDetails.exception?.description || ''));
  return res.result.value;
}

let browserWs = null;

async function browserSocket() {
  if (browserWs) return browserWs;
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  browserWs = await connect(version.webSocketDebuggerUrl);
  attach(browserWs);
  return browserWs;
}

async function isolatedTarget() {
  // Boshqa sahifa bilan cookie almashmasin: alohida browser context
  const bws = await browserSocket();
  const ctx = await send(bws, 'Target.createBrowserContext', { disposeOnDetach: false });
  const { targetId } = await send(bws, 'Target.createTarget', {
    url: 'about:blank', browserContextId: ctx.browserContextId,
  });
  return { targetId, browserContextId: ctx.browserContextId };
}

export async function openRole({ url, login, blob, camBg, camLabel, screenshot }) {
  const { targetId } = await isolatedTarget(login.user);
  // Har bir sahifa — browser websocket orqali o'z "flat" sessiyasi
  const ws = await browserSocket();
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });

  await send(ws, 'Page.enable', {}, sessionId);
  await send(ws, 'Runtime.enable', {}, sessionId);
  await send(ws, 'Network.enable', {}, sessionId);

  const bootstrap = `window.__camBg='${camBg}';window.__camLabel='${camLabel}';`
    + `try { (0, eval)(${JSON.stringify(FAKE_MEDIA)}); } catch (e) { window.__fakeError = String(e); }`;
  await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: bootstrap }, sessionId);
  if (blob) {
    await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: blob }, sessionId);
  }

  // 1) Sessiya cookie'sini o'rnatamiz (test foydalanuvchisi uchun yaratilgan)
  await send(ws, 'Network.enable', {}, sessionId);
  await send(ws, 'Network.setCookie', {
    name: 'online_urgan_session',
    value: login.session,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }, sessionId);

  // 2) Dars xonasiga o'tish
  await send(ws, 'Page.navigate', { url }, sessionId);
  await sleep(5000);
  const landed = await evaluate(ws, sessionId, `location.href`);
  if (!landed.includes('/join/')) console.log('ROOM REDIRECTED to', landed);

  const state = await evaluate(ws, sessionId, `(() => {
    const pip = document.getElementById('pipVideo');
    const grid = document.getElementById('videoGrid');
    return {
      role: document.body.dataset.role,
      fakeReady: !!window.__fakeReady,
      gumCalls: window.__gumCalls || 0,
      bannerHidden: document.getElementById('mediaBanner')?.hidden,
      bannerText: document.getElementById('mediaBannerText')?.textContent,
      participants: document.getElementById('participantCountNum')?.textContent,
      people: [...document.querySelectorAll('.people-row .people-name-text')].map(n => n.textContent),
      pipHidden: document.getElementById('pipWindow')?.hidden,
      pipVisible: pip ? !pip.classList.contains('is-hidden') : null,
      pipDim: pip ? pip.videoWidth + 'x' + pip.videoHeight : null,
      placeholderHidden: document.getElementById('pipPlaceholder')?.hidden,
      gridTiles: grid ? grid.querySelectorAll('.tile').length : 0,
      gridVideosVisible: grid ? [...grid.querySelectorAll('video')].filter(v => !v.classList.contains('is-hidden')).length : 0,
      gridLabels: grid ? [...grid.querySelectorAll('.tile__name')].map(n => n.textContent) : [],
      hintHidden: document.getElementById('stageHint')?.hidden,
      meter: document.getElementById('pipMeter')?.style.width,
      myLevel: document.getElementById('myLevel')?.style.width,
      speaking: !document.getElementById('speakingChip')?.hidden,
      badge: document.getElementById('liveBadgeText')?.textContent,
      stageClass: document.getElementById('stageView')?.className,
    };
  })()`);

  if (screenshot) {
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  }

  return {
    ws, sessionId, state,
    async evalJson(expr) { return evaluate(ws, sessionId, expr); },
    async click(text) {
      return evaluate(ws, sessionId, `(() => {
        const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes(${JSON.stringify(text)}));
        if (!btn) return false;
        btn.click(); return true;
      })()`);
    },
    async screenshot(path) {
      const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
      (await import('node:fs')).writeFileSync(path, Buffer.from(shot.data, 'base64'));
    },
    async close() {
      try { await send(ws, 'Page.close', {}, sessionId); } catch (e) { /* noop */ }
    },
    consoleErrors() {
      return events
        .filter((e) => (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
          || e.method === 'Runtime.exceptionThrown')
        .map((e) => e.method === 'Runtime.exceptionThrown'
          ? 'exception: ' + (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text)
          : 'console: ' + e.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
        .slice(0, 15);
    },
    failedRequests() {
      return events
        .filter((e) => e.method === 'Network.loadingFailed')
        .map((e) => e.params.errorText + ' ' + (e.params.blockedReason || ''))
        .slice(0, 10);
    },
  };
}

export { sleep };
