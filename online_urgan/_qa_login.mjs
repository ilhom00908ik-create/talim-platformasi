export default async function run(page, ui) {
  await page.goto('http://127.0.0.1:8000/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', 't_teacher');
  await page.fill('input[name="password"]', 'StrongPass123');
  await page.fill('input[name="device_key"]', '');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  return {
    url: page.url(),
    errors: await page.evaluate(() => Array.from(document.querySelectorAll('.text-rose-100')).map((e) => e.textContent.trim())),
    body: (await page.evaluate(() => document.body.innerText)).slice(0, 400),
  };
}
