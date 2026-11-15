/* JS umuman ishlayaptimi yoki faqat setContent inline skript ishlamayaptimi? */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const S = 'scr' + 'ipt';
const browser = await pw.chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)));

// 1) evaluate
console.log('1) evaluate 1+1 =', await page.evaluate(() => 1 + 1));

// 2) data: URL ichida inline skript
await page.goto('data:text/html,' + encodeURIComponent('<html><body><' + S + '>window.__D=1;</' + S + '></body></html>'));
console.log('2) data URL inline script:', await page.evaluate(() => window.__D));

// 3) setContent dan keyin inline skript
await page.setContent('<html><body><' + S + '>window.__S=1;</' + S + '></body></html>');
console.log('3) setContent inline script:', await page.evaluate(() => window.__S));

// 4) element sifatida qo'lda qo'shish
await page.evaluate(() => {
  const el = document.createElement('script');
  el.textContent = 'window.__E=1;';
  document.body.appendChild(el);
});
console.log('4) element appendChild:', await page.evaluate(() => window.__E));

// 5) addScriptTag
await page.addScriptTag({ content: 'window.__A = 1;' });
console.log('5) addScriptTag:', await page.evaluate(() => window.__A));

// 6) JS qo'shildan sahifadan normal URL
await page.goto('about:blank');
await page.evaluate(() => { window.__B = 2; });
console.log('6) about:blank evaluate:', await page.evaluate(() => window.__B));

// 7) sahifa sarlavhasi / doimiy navigatsiya
await page.goto('data:text/html,<title>t</title>');
console.log('7) title:', await page.title());

await browser.close();
