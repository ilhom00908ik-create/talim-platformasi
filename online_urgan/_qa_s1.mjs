export default async function run(page, ui) {
  await page.fill('input[name="username"]', 'qaapproved');
  await page.fill('input[name="password"]', 'QaTest!2345');
  await page.click('form button[type="submit"]');
  await page.waitForTimeout(4000);
  return { url: page.url(), title: await page.title() };
}
