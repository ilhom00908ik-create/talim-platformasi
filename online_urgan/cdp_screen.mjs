import { openRole, sleep } from './cdp_qa.mjs'
import { readFileSync } from 'node:fs'

const SESSIONS = JSON.parse(readFileSync('_qa_sessions.json', 'utf8'))

const LESSON = 32
const show = (label, value) => console.log(label, JSON.stringify(value))

const teacher = await openRole({
  url: `http://127.0.0.1:8011/online-urgat/live/${LESSON}/join/`,
  login: { user: 'qateacher', session: SESSIONS.qateacher },
  camBg: '#1d4ed8',
  camLabel: 'USTOZ KAMERASI',
})

const student = await openRole({
  url: `http://127.0.0.1:8011/online-urgat/live/${LESSON}/join/`,
  login: { user: 'qastudent', session: SESSIONS.qastudent },
  camBg: '#b45309',
  camLabel: 'STUDENT',
})
await sleep(4000)

show('fake status', await teacher.evalJson(
  `({ ready: !!window.__fakeReady, err: window.__fakeError || null, gum: String(navigator.mediaDevices.getUserMedia).slice(0, 60) })`))
show('students seen by teacher', await teacher.evalJson(
  `[...document.querySelectorAll('.people-row .people-name-text')].map(n => n.textContent)`))

// Ekran ulashishni bosish va holatni tekshirish
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const clicked = await teacher.evalJson(`(() => {
    const btn = document.getElementById('shareScreenBtn');
    if (!btn || btn.hidden) return 'hidden';
    btn.click();
    return 'clicked';
  })()`)
  show(`share click #${attempt}`, clicked)
  await sleep(3500)
  const t = await teacher.evalJson(`(() => ({
    stage: document.getElementById('stageView').className,
    screenDim: document.getElementById('screenVideo').videoWidth + 'x' + document.getElementById('screenVideo').videoHeight,
    screenHasSrc: !!document.getElementById('screenVideo').srcObject,
    displayCalls: window.__displayCalls || 0,
    shareText: document.getElementById('shareScreenText').textContent,
    count: document.getElementById('participantCountNum').textContent,
  }))()`)
  show(`teacher #${attempt}`, t)
  if (t.stage.includes('screen-mode')) break
}

await sleep(2500)
show('student', await student.evalJson(`(() => ({
  stage: document.getElementById('stageView').className,
  screenDim: document.getElementById('screenVideo').videoWidth + 'x' + document.getElementById('screenVideo').videoHeight,
  screenHasSrc: !!document.getElementById('screenVideo').srcObject,
  screenTracks: document.getElementById('screenVideo').srcObject
    ? document.getElementById('screenVideo').srcObject.getTracks().map(t => t.kind + ':' + t.readyState) : [],
  screenEmptyHidden: document.getElementById('screenEmpty').hidden,
  chipText: document.getElementById('screenChipText').textContent,
  stripTiles: document.getElementById('stripList').querySelectorAll('.tile').length,
  pipSecondVideo: (() => {
    const p = document.getElementById('pipVideo');
    return p.srcObject ? p.srcObject.getTracks().length : 0;
  })(),
  gridVideos: [...document.querySelectorAll('#videoGrid video')].filter(v => !v.classList.contains('is-hidden')).length,
}))()`))

await student.screenshot('qa_screen_student.png')
await teacher.screenshot('qa_screen_teacher.png')
show('errors', { t: teacher.consoleErrors(), s: student.consoleErrors() })
show('failed', { t: teacher.failedRequests(), s: student.failedRequests() })
process.exit(0)
