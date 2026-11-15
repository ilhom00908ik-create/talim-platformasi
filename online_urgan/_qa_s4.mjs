export default async function run(page) {
  const out = {};
  out.protocols = await page.evaluate(() => ({
    secure: window.isSecureContext,
    origin: location.origin,
    pluginTypes: Array.from(navigator.plugins || []).map((p) => p.name),
    jsEnabledHints: {
      hasObjectDefineProperty: typeof Object.defineProperty,
      evalAllowed: (() => { try { return eval('1+1') === 2; } catch (e) { return 'blocked: ' + e.message; } })(),
    },
  }));
  // sahifa HTML da inline skriptni sinash (data: URL)
  const p2 = await page.context().newPage();
  await p2.goto('data:text/html,<html><body><script>document.title="INLINE-OK"</script></body></html>');
  out.dataUrlTitle = await p2.title();
  await p2.close();
  // about:blank da
  await page.goto('about:blank');
  await page.setContent('<html><body><script>document.title="SETCONTENT-OK"</script></body></html>');
  out.setContentTitle = await page.title();
  // sahifa ichida Function bilan skript qo'shish (ishlaydi)
  out.functionWorks = await page.evaluate(() => { try { new Function('window.__F=1')(); return window.__F; } catch (e) { return 'err'; } });
  // javaScriptEnabled sozlamasi
  out.ua = (await page.evaluate(() => navigator.userAgent)).slice(0, 80);
  return out;
}
