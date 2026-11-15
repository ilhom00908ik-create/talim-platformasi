/* data: URL da sahifadagi JavaScript umuman ishlayaptimi (inline handler)? */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const S = 'scr' + 'ipt';
const browser = await pw.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext()).newPage();
const check = async (label) => {
  const r = await page.evaluate(() => ({
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null,
    readyState: document.readyState,
    scriptCount: document.scripts.length,
  }));
  console.log(label, JSON.stringify(r));
};
await page.goto('data:text/html,' + encodeURIComponent('<html><body><' + S + '>window.__D=1;</' + S + '><button onclick="window.__C=1">b</button></body></html>'));
await check('data:');
await page.click('button');
console.log('onclick ->', await page.evaluate(() => window.__C));
await page.evaluate(() => { window.__EVAL = 1; });
console.log('evaluate ->', await page.evaluate(() => window.__EVAL));
// setTimeout ichida?
await page.evaluate(() => { setTimeout(() => { window.__T = 1; }, 10); });
await page.waitForTimeout(200);
console.log('setTimeout ->', await page.evaluate(() => window.__T));
// new Function?
console.log('new Function ->', await page.evaluate(() => { try { return new Function('return 42')(); } catch (e) { return 'ERR ' + e.message; } }));
await browser.close();
