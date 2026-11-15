import { openRole, sleep } from './cdp_qa.mjs'

const LESSON = 32
const OUT = { errors: [] }

function log(obj) { console.log(JSON.stringify(obj, null, 2)) }

// 1) USTOZ
const teacher = await openRole({
  url: `http://127.0.0.1:8011/online-urgat/live/${LESSON}/join/`,
  login: { user: 'qateacher', pass: 'QaTest!2345' },
  camBg: '#1d4ed8',
  camLabel: 'USTOZ KAMERASI',
  screenshot: 'qa_1_teacher_grid.png',
})

console.log('=== TEACHER (grid) ===')
log(teacher.state)

// 2) O'QUVCHI (alohida brauzer konteksti → alohida login)
const student = await openRole({
  url: `http://127.0.0.1:8011/online-urgat/live/${LESSON}/join/`,
  login: { user: 'qastudent', pass: 'QaTest!2345' },
  camBg: '#b45309',
  camLabel: 'OQUVCHI 1',
})

console.log('=== STUDENT ===')
log(student.state)

await sleep(2500)

// Tarqatilgan holat: ikkisi bir-birini ko'rishi
console.log('=== TEACHER after student joined ===')
log(await teacher.evalJson(`(() => ({
  participants: document.getElementById('participantCountNum').textContent,
  people: [...document.querySelectorAll('.people-row .people-name-text')].map(n => n.textContent),
  gridTiles: document.getElementById('videoGrid').querySelectorAll('.tile').length,
  gridLabels: [...document.querySelectorAll('#videoGrid .tile__name')].map(n => n.textContent),
  gridVideos: [...document.querySelectorAll('#videoGrid video')].filter(v => !v.classList.contains('is-hidden')).length,
  speaking: !document.getElementById('speakingChip').hidden,
  speakingName: document.getElementById('speakingName').textContent,
  meters: [...document.querySelectorAll('#videoGrid .meter__fill')].map(m => m.style.width),
}))()`))

console.log('=== STUDENT sees teacher ===')
log(await student.evalJson(`(() => ({
  participants: document.getElementById('participantCountNum').textContent,
  people: [...document.querySelectorAll('.people-row .people-name-text')].map(n => n.textContent),
  pipVisible: !document.getElementById('pipVideo').classList.contains('is-hidden'),
  pipDim: document.getElementById('pipVideo').videoWidth + 'x' + document.getElementById('pipVideo').videoHeight,
  pipLabel: document.getElementById('pipName').textContent,
  gridTiles: document.getElementById('videoGrid').querySelectorAll('.tile').length,
  videoErrors: [...document.querySelectorAll('video')].filter(v => v.error).map(v => v.error.code),
}))()`))

await student.screenshot('qa_2_student_grid.png')

// 3) Ustoz ekran ulashadi
await teacher.click('Ekranni uzatish')
await sleep(3500)

console.log('=== TEACHER (screen mode) ===')
log(await teacher.evalJson(`(() => ({
  stageClass: document.getElementById('stageView').className,
  screenChip: !document.getElementById('screenChip').hidden,
  screenText: document.getElementById('screenChipText').textContent,
  screenDim: document.getElementById('screenVideo').videoWidth + 'x' + document.getElementById('screenVideo').videoHeight,
  screenEmptyHidden: document.getElementById('screenEmpty').hidden,
  stripTiles: document.getElementById('stripList').querySelectorAll('.tile').length,
  pipVisible: !document.getElementById('pipVideo').classList.contains('is-hidden'),
  displayCalls: window.__displayCalls || 0,
}))()`))
await teacher.screenshot('qa_3_teacher_screen.png')

console.log('=== STUDENT (screen mode) ===')
log(await student.evalJson(`(() => ({
  stageClass: document.getElementById('stageView').className,
  screenChip: !document.getElementById('screenChip').hidden,
  screenText: document.getElementById('screenChipText').textContent,
  screenDim: document.getElementById('screenVideo').videoWidth + 'x' + document.getElementById('screenVideo').videoHeight,
  screenEmptyHidden: document.getElementById('screenEmpty').hidden,
  stripTiles: document.getElementById('stripList').querySelectorAll('.tile').length,
  pipVisible: !document.getElementById('pipVideo').classList.contains('is-hidden'),
  pipDim: document.getElementById('pipVideo').videoWidth + 'x' + document.getElementById('pipVideo').videoHeight,
}))()`))
await student.screenshot('qa_4_student_screen.png')

console.log('=== CONSOLE ERRORS ===')
log({ teacher: teacher.consoleErrors(), student: student.consoleErrors() })
console.log('=== FAILED REQUESTS ===')
log({ teacher: teacher.failedRequests(), student: student.failedRequests() })

await student.close()
await teacher.close()
