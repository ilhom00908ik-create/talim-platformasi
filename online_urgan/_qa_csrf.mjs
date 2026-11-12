export default async function run(page, ui) {
  const res = await page.evaluate(async () => {
    const form = document.querySelector('form');
    const csrfInput = form.querySelector('input[name="csrfmiddlewaretoken"]');
    const cookie = document.cookie;
    const status = await fetch('/login/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        csrfmiddlewaretoken: csrfInput ? csrfInput.value : '',
        username: 't_teacher',
        password: 'StrongPass123',
        device_key: '',
      }),
      redirect: 'manual',
    }).then((r) => r.status).catch((e) => String(e));
    return { hasCsrfInput: !!csrfInput, cookie: cookie.slice(0, 200), status };
  });
  return res;
}
