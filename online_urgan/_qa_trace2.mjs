/* init() ni qadam-baqadam kuzatish: manba kodini probe'lar bilan o'zgartirib bajarish. */
const BASE = 'http://127.0.0.1:8012';

async function login(page, user, pass) {
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

export default async function run(page) {
  await page.context().grantPermissions(['camera', 'microphone'], { origin: BASE });
  await login(page, 'qaapproved', 'QaTest!2345');
  await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  await page.goto(new URL(href, BASE).href, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const trace = [];
    const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
    let code = await (await fetch(tag.src)).text();
    const mark = (label) => `window.__T.push(${JSON.stringify(label)});`;
    // init ichidagi chaqiruvlar oldiga iz qo'shamiz
    const targets = [
      ['updateMicButton();\n', 'before-updateMicButton'],
      ['updateMuteAllButton();\n', 'before-updateMuteAll'],
      ['bindEvents();\n', 'before-bindEvents'],
      ['refreshAll();\n', 'before-refreshAll'],
      ['connect();\n', 'before-connect'],
    ];
    // faqat init() ichidagi (oxirgi) uchraydiganini almashtiramiz
    for (const [needle, label] of targets) {
      const idx = code.lastIndexOf(needle);
      if (idx < 0) { trace.push('needle not found: ' + label); continue; }
      code = code.slice(0, idx) + mark(label) + needle + code.slice(idx + needle.length);
    }
    // connect() ichiga ham
    code = code.replace('function connect() {\n', 'function connect() {\n' + mark('connect-called'));
    // global xatolarni ushlash
    code = code.replace("'use strict';", "'use strict';\nwindow.__T = [];\nwindow.addEventListener('error', function (e) { window.__T.push('ERR ' + e.message); });");
    try { new Function(code)(); } catch (e) { trace.push('boot throw: ' + e.message); }
    await new Promise((r) => setTimeout(r, 4000));
    return { trace, at: window.__T || [], socket: window.__liveRoom ? window.__liveRoom.socket && window.__liveRoom.socket.readyState : 'no-lr' };
  });
  return result;
}
