export default async function run(page, ui) {
  await ui.fill('@e4', 'demo_ustoz');
  await ui.fill('@e5', 'DemoPass123');
  await ui.fill('@e6', '');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { }),
    ui.click('@e7'),
  ]);
  const afterLogin = page.url();

  await page.goto('http://127.0.0.1:8765/online-urgat/live/14/join/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#stageView', { timeout: 30000 });
  await page.waitForTimeout(4000);

  const state = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      stageBg: getComputedStyle(g('stageView')).backgroundColor,
      cssLoaded: [...document.styleSheets].some((s) => (s.href || '').includes('live_room.css')),
      jsLoaded: [...document.scripts].some((s) => (s.src || '').includes('live_room.js')),
      people: [...(g('peopleList')?.querySelectorAll('.people-row') || [])].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
      tiles: g('videoGrid')?.querySelectorAll('.tile').length,
      hintHidden: g('stageHint')?.hidden,
      micText: g('micBtnText')?.textContent,
    };
  });
  await page.screenshot({ path: '_live_teacher_solo.png' });
  return { afterLogin, state };
}
