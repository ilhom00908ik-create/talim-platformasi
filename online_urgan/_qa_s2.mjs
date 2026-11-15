export default async function run(page) {
  const href = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/live/"]')].find((x) => /\/join\/$/.test(x.getAttribute('href')));
    return a && a.getAttribute('href');
  });
  if (!href) return { error: 'no live link', links: await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).slice(0, 40)) };
  await page.goto(new URL(href, 'http://127.0.0.1:8012').href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  return {
    href,
    url: page.url(),
    title: await page.title(),
    hasLiveRoom: await page.evaluate(() => !!window.__liveRoom),
    hasScriptTag: await page.evaluate(() => [...document.scripts].some((s) => s.src && s.src.includes('live_room.js'))),
    scriptRan: await page.evaluate(() => !!document.getElementById('toggleMicBtn') && !!window.__liveRoom),
    early: await page.evaluate(() => ({
      cfg: !!document.getElementById('liveRoomConfig'),
      grid: !!document.getElementById('videoGrid'),
      banner: !!document.getElementById('mediaBanner'),
    })),
  };
}
