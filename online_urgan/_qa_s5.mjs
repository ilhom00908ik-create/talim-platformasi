export default async function run(page) {
  // Muayyan sahifani qayta yuklaymiz va skript so'rovlarini kuzatamiz
  const reqs = [];
  page.on('request', (r) => { if (r.url().includes('live_room.js')) reqs.push({ url: r.url(), type: r.resourceType() }); });
  page.on('requestfinished', async (r) => {
    if (!r.url().includes('live_room.js')) return;
    const resp = await r.response();
    reqs.push({ url: r.url(), status: resp && resp.status(), size: resp ? (await resp.body().catch(() => Buffer.alloc(0))).length : null });
  });
  page.on('requestfailed', (r) => { if (r.url().includes('live_room.js')) reqs.push({ url: r.url(), failed: r.failure() && r.failure().errorText }); });
  page.on('pageerror', (e) => reqs.push({ pageerror: e.message.slice(0, 200) }));
  await page.goto('http://127.0.0.1:8012/online-urgat/live/33/join/', { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  return {
    reqs,
    liveRoom: await page.evaluate(() => !!window.__liveRoom),
    inline: await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__X=1;'; document.head.appendChild(s); return window.__X === 1; }),
    srcAttr: await page.evaluate(() => [...document.scripts].map((s) => s.getAttribute('src'))),
    scriptCount: await page.evaluate(() => document.scripts.length),
    bodyLen: await page.evaluate(() => document.body.innerHTML.length),
  };
}
