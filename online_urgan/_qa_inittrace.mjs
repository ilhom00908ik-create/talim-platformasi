/* init() qaysi qadamda yiqiladi? Har bir chaqiruvni probe qilib bajarish. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const BASE = 'http://127.0.0.1:8012';
const browser = await pw.chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
});
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
await ctx.grantPermissions(['camera', 'microphone'], { origin: BASE });
const page = await ctx.newPage();
await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="username"]', 'qaapproved');
await page.fill('input[name="password"]', 'QaTest!2345');
await page.click('form button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20000 });
await page.goto(`${BASE}/online-urgat/dashboard/`, { waitUntil: 'domcontentloaded' });
const href = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
  return a && a.getAttribute('href');
});
await page.goto(new URL(href, BASE).href, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate(async () => {
  const tag = [...document.scripts].find((s) => s.src && s.src.includes('live_room.js'));
  let code = await (await fetch(tag.src)).text();
  // init ichidagi har bir qatorni iz bilan almashtiramiz
  const marks = [
    ['const own = upsertUser(me.id,', 'T-upsert'],
    ['updateMicButton();\n', 'T-updateMicBtn'],
    ['updateCamButton();\n', 'T-updateCamBtn'],
    ['updateMuteAllButton();\n', 'T-updateMuteAll'],
    ['bindEvents();\n', 'T-bindEvents'],
    ['refreshAll();\n', 'T-refreshAll'],
    ['connect();\n', 'T-connect'],
    ['await startLocalMedia();', 'T-startMedia'],
  ];
  for (const [needle, label] of marks) {
    const i = code.lastIndexOf(needle);
    if (i < 0) continue;
    code = code.slice(0, i) + `window.__T.push(${JSON.stringify(label)});\n` + code.slice(i);
  }
  code = code.replace("'use strict';", "'use strict';\nwindow.__T = [];");
  code = code.replace('function refreshAll() {', 'function refreshAll() {\n    window.__T.push("refreshAll-called");');
  code = code.replace('function connect() {', 'function connect() {\n    window.__T.push("connect-called");');
  code = code.replace('async function startLocalMedia(', 'async function startLocalMedia( /* traced */');
  const errs = [];
  try { new Function(code)(); } catch (e) { errs.push('boot: ' + e.message); }
  await new Promise((r) => setTimeout(r, 5000));
  return { trace: window.__T, errs, socket: window.__liveRoom && window.__liveRoom.socket ? window.__liveRoom.socket.readyState : 'null' };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
