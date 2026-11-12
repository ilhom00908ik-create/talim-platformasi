export default async function run(page, ui) {
  await page.goto('http://127.0.0.1:8000/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', 't_teacher');
  await page.fill('input[name="password"]', 'StrongPass123');
  await page.fill('input[name="device_key"]', '');
  await page.evaluate(() => document.querySelector('form').submit());
  await page.waitForTimeout(2500);
  const afterLogin = page.url();

  await page.goto('http://127.0.0.1:8000/online-urgat/live/1/join/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const room = await page.evaluate(() => {
    const ids = ['stageView', 'screenVideo', 'remoteVideo', 'screenShareBadge', 'shareScreenBtn', 'muteAllBtn', 'startCallBtn'];
    const html = document.documentElement.outerHTML;
    const roles = html.match(/let userRole = .{0,60}/);
    const stageIdx = html.indexOf('id="stageView"');
    const scriptIdx = html.indexOf('<script>', stageIdx);
    return {
      roleLine: roles ? roles[0] : null,
      controlsBar: html.slice(html.indexOf('class="controls-bar"'), html.indexOf('class="controls-bar"') + 1500),
      hasIds: ids.map((id) => id + '=' + !!document.getElementById(id)),
      stageClass: document.getElementById('stageView')?.className,
      scriptStart: scriptIdx,
      allScripts: Array.from(document.scripts).map((s) => (s.src ? 'src:' + s.src : 'inline:' + s.textContent.length)),
    };
  });
  return { afterLogin, room };
}
