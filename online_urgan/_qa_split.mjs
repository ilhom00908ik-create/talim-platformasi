/* Skriptning birinchi tashqi resurs — tailwind CDN. U bloklanyaptimi? */
export default async function run(page) {
  const out = {};
  out.scripts = await page.evaluate(() => [...document.scripts].map((s) => ({
    src: s.src || null,
    type: s.type,
    async: s.async,
    defer: s.defer,
    readyState: s.readyState || null,
  })));
  // tailwind CDN javob beradimi?
  out.tailwind = await page.evaluate(async () => {
    try {
      const r = await fetch('https://cdn.tailwindcss.com', { mode: 'no-cors' });
      return 'status ' + r.status + ' type ' + r.type;
    } catch (e) { return 'ERR ' + e.message; }
  });
  // sahifada har qanday inline skript ishlayaptimi (har xil joyda)?
  out.inlineHead = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__HEADTEST = 1;';
    document.head.appendChild(s);
    return window.__HEADTEST === 1;
  });
  out.inlineBody = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__BODYTEST = 1;';
    document.body.appendChild(s);
    return window.__BODYTEST === 1;
  });
  // sahifa JS ishlashi: oddiy event handler
  out.timerWorks = await page.evaluate(async () => {
    let fired = false;
    setTimeout(() => { fired = true; }, 50);
    await new Promise((r) => setTimeout(r, 200));
    return fired;
  });
  return out;
}
