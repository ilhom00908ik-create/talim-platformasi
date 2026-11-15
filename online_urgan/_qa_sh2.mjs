const BASE = 'http://127.0.0.1:8011';

export default async function run(page) {
  const out = {};
  await page.goto(`${BASE}/online-urgat/login/`, { waitUntil: 'domcontentloaded' });
  // 1) addScriptTag sahifada ishlaydimi?
  await page.addScriptTag({ content: 'window.__TAG = 1;' });
  out.addScriptTag = await page.evaluate(() => window.__TAG);
  // 2) evaluate ichida <script> qo'shish
  out.appendChildScript = await page.evaluate(() => {
    const s = document.createElement('script'); s.textContent = 'window.__A = 1;';
    document.body.appendChild(s);
    return window.__A === 1;
  });
  // 3) evaluate ichida eval / Function
  out.eval = await page.evaluate(() => { eval('window.__E = 1'); return window.__E; });
  out.newFunction = await page.evaluate(() => { new Function('window.__F = 1')(); return window.__F; });
  // 4) sahifadagi oddiy onclick
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'qa-btn'; b.textContent = 'go'; b.setAttribute('onclick', 'window.__C=1'); document.body.appendChild(b); });
  await page.click('#qa-btn', { timeout: 5000 });
  out.inlineHandler = await page.evaluate(() => window.__C);
  return out;
}
