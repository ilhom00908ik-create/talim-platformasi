/* Lokal HTTP sahifada inline skript bajariladimi? (data: o'rniga http) */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
const fs = require('fs');
fs.writeFileSync('_qa_inline_page.html', '<!DOCTYPE html><html><body><script>window.__INLINE = 1;</script><button onclick="window.__CLICK=1">b</button></body></html>');
const browser = await pw.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext()).newPage();
// file:// orqali
await page.goto('file:///C:/Users/ilhom/Desktop/talim%20platformasi/online_urgan/_qa_inline_page.html');
console.log('file:// inline ->', await page.evaluate(() => window.__INLINE));
// http:// orqali (dev server 8011 o'chiq bo'lishi mumkin — 8000 ni sinaymiz)
for (const url of ['http://127.0.0.1:8011/online-urgat/login/', 'http://localhost:8011/online-urgat/login/']) {
  try {
    await page.goto(url, { timeout: 5000 });
    console.log(url, '-> status ok, inline test:');
    await page.evaluate(() => {
      const el = document.createElement('script');
      el.textContent = 'window.__H=1;';
      document.body.appendChild(el);
    });
    console.log('   append:', await page.evaluate(() => window.__H));
  } catch (e) { console.log(url, '-> ERR', e.message.split('\n')[0].slice(0, 100)); }
}
await browser.close();
