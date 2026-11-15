import { openRole, sleep } from './cdp_qa.mjs'
import { readFileSync } from 'node:fs'

const SESSIONS = JSON.parse(readFileSync('_qa_sessions.json', 'utf8'))
const LESSON = 32

const pcDump = `(async () => {
  const lr = window.__liveRoom;
  if (!lr) return { error: 'no liveRoom' };
  const out = [];
  for (const [id, entry] of lr.peers) {
    const stats = await entry.pc.getStats();
    const tracks = [];
    stats.forEach((s) => {
      if (s.type === 'outbound-rtp' || s.type === 'inbound-rtp') {
        tracks.push({ dir: s.type, kind: s.kind, frames: s.framesEncoded ?? s.framesDecoded, bytes: s.bytesSent ?? s.bytesReceived });
      }
    });
    out.push({
      id,
      signaling: entry.pc.signalingState,
      ice: entry.pc.iceConnectionState,
      conn: entry.pc.connectionState,
      senders: entry.pc.getSenders().map((s) => s.track ? s.track.kind + ':' + s.track.readyState + ':' + (s.track.label || '').slice(0, 18) : 'none'),
      battle: tracks,
      remoteScreen: !!entry.remoteScreenTrack,
    });
  }
  return out;
})()`

const teacher = await openRole({
  url: `http://127.0.0.1:8011/online-urgat/live/${LESSON}/join/`,
  login: { user: 'qateacher', session: SESSIONS.qateacher },
  camBg: '#1d4ed8', camLabel: 'USTOZ KAMERASI',
})
const student = await openRole({
  url: `http://127.0.0.1:8011/online-urgat/live/${LESSON}/join/`,
  login: { user: 'qastudent', session: SESSIONS.qastudent },
  camBg: '#b45309', camLabel: 'STUDENT',
})
await sleep(4500)

console.log('BEFORE peers (teacher):', JSON.stringify(await teacher.evalJson(pcDump)))
console.log('BEFORE peers (student):', JSON.stringify(await student.evalJson(pcDump)))

await teacher.evalJson(`document.getElementById('shareScreenBtn').click()`)
await sleep(1200)
console.log('AFTER1.2s teachersenders:', JSON.stringify(await teacher.evalJson(pcDump)))
await sleep(4000)
console.log('AFTER5s (teacher):', JSON.stringify(await teacher.evalJson(pcDump)))
console.log('AFTER5s (student):', JSON.stringify(await student.evalJson(pcDump)))
console.log('student dom:', JSON.stringify(await student.evalJson(`(() => ({
  stage: document.getElementById('stageView').className,
  screenDim: document.getElementById('screenVideo').videoWidth + 'x' + document.getElementById('screenVideo').videoHeight,
  screenTracks: document.getElementById('screenVideo').srcObject ? document.getElementById('screenVideo').srcObject.getTracks().length : 0,
  stripTiles: document.getElementById('stripList').querySelectorAll('.tile').length,
}))()`)))

await teacher.screenshot('qa_screen_teacher.png')
await student.screenshot('qa_screen_student.png')
console.log('errors', teacher.consoleErrors(), student.consoleErrors())
process.exit(0)
