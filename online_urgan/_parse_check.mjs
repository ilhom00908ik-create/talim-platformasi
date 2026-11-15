import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync('static/live_room.js', 'utf8')
console.log('bytes:', src.length)
try {
  new vm.Script(src, { filename: 'live_room.js' })
  console.log('vm parse: OK')
} catch (e) {
  console.log('vm parse error:', e.message)
  console.log(e.stack.split('\n').slice(0, 6).join('\n'))
}
