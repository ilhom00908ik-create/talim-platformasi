"""Chrome ichki holati spiegeli: sahifa JS bajarish nega to'xtagan?
playwright `chromium.launch` bilan `--dump-dom` kabi oddiy sinov."""
import subprocess
import tempfile
import os

html = os.path.join(tempfile.gettempdir(), 'qa_inline.html')
with open(html, 'w', encoding='utf-8') as f:
    f.write('<html><body><script>document.title = "JS-RAN";</script><p>after</p></body></html>')

chrome = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
profile = os.path.join(tempfile.gettempdir(), 'qa-profile-dump')
for extra in ([], ['--disable-extensions'], ['--enable-features=AllowLegacyExtensionManifests']):
    cmd = [chrome, '--headless=new', f'--user-data-dir={profile}', '--no-first-run', '--disable-gpu',
           '--dump-dom', 'file:///' + html.replace('\\', '/')] + extra
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        dom = (out.stdout or '').strip()
        print('args:', extra, '| rc:', out.returncode)
        print('  dom head:', dom[:160].replace('\n', ' '))
        print('  stderr:', (out.stderr or '')[:300].replace('\n', ' '))
    except Exception as exc:  # noqa: BLE001
        print('args:', extra, 'ERR', exc)
