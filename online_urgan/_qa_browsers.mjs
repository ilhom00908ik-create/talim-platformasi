/* Qaysi brauzerda sahifa <script> lari bajariladi? */
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const pw = require('c:/Users/ilhom/.vscode/extensions/danielsanmedium.dscodegpt-3.24.84/standalone/node_modules/patchright');
fs.writeFileSync('_qa_inline_page.html', '<!DOCTYPE html><html><body><script>window.__INLINE=1;</script></body></html>');
const CANDIDATES = [
  ['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
  ['edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
  ['pw-chromium', 'C:/Users/ilhom/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'],
];
for (const [label, exe] of CANDIDATES) {
  if (!fs.existsSync(exe)) { console.log(label, '-> NOT FOUND'); continue; }
  try {
    const browser = await pw.chromium.launch({ headless: true, executablePath: exe });
    const page = await (await browser.newContext()).newPage();
    await page.goto('file:///C:/Users/ilhom/Desktop/talim%20platformasi/online_urgan/_qa_inline_page.html');
    const inline = await page.evaluate(() => window.__INLINE);
    await page.goto('data:text/html,<p>x</p>');
    await page.addScriptTag({ content: 'window.__A=1;' });
    const added = await page.evaluate(() => window.__A);
    console.log(label, '->', inline === 1 ? 'JS OK' : 'JS DISABLED', '| addScriptTag:', added);
    await browser.close();
  } catch (e) {
    console.log(label, '-> ERROR', e.message.split('\n')[0].slice(0, 140));
  }
}
