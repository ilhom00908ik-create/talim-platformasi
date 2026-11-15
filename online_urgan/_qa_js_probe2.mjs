/* Nega sahifa <script> lari bajarilmayapti? Turli launch variantlari. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const S = 'scr' + 'ipt';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const variants = [
  ['plain', {}],
  ['no-default-args', { ignoreDefaultArgs: true, args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--user-data-dir=' + process.env.TEMP + '\\qa-chrome-' + Date.now()] }],
  ['fresh-profile', { args: ['--user-data-dir=' + process.env.TEMP + '\\qa-chrome2-' + Date.now()] }],
  ['channel-chromium-arg', { args: ['--disable-extensions', '--disable-component-extensions-with-background-pages'] }],
];
for (const [label, opts] of variants) {
  try {
    const browser = await pw.chromium.launch({ headless: true, executablePath: EXE, ...opts });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
    await page.goto('data:text/html,' + encodeURIComponent('<html><body><' + S + '>window.__D=1;</' + S + '></body></html>'));
    const d = await page.evaluate(() => window.__D);
    await page.evaluate(() => {
      const el = document.createElement('script');
      el.textContent = 'window.__E=1;';
      document.body.appendChild(el);
    });
    const e = await page.evaluate(() => window.__E);
    console.log(label, '-> data:', d, '| append:', e, '| errs:', errs.slice(0, 2));
    await browser.close();
  } catch (err) {
    console.log(label, '-> ERROR', err.message.split('\n')[0].slice(0, 160));
  }
}
