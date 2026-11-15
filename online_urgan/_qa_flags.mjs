/* Yangi brauzer, turli bayroqlar bilan — inline JS ishlaydimi? */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const variants = [
  ['default', []],
  ['disable-script-blocking', ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights']],
  ['no-extensions', ['--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-default-apps']],
  ['fresh-profile', ['--user-data-dir=C:/Users/ilhom/AppData/Local/Temp/qa-chrome-' + Date.now()]],
];
for (const [name, args] of variants) {
  try {
    const browser = await pw.chromium.launch({ headless: true, executablePath: EXE, args });
    const page = await (await browser.newContext()).newPage();
    await page.goto('http://127.0.0.1:8012/online-urgat/live/33/join/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => ({ lr: !!window.__liveRoom, socket: window.__liveRoom && window.__liveRoom.socket ? window.__liveRoom.socket.readyState : 'n/a' }));
    console.log(name, '->', JSON.stringify(r));
    await browser.close();
  } catch (e) { console.log(name, 'ERR', e.message.split('\n')[0].slice(0, 120)); }
}
