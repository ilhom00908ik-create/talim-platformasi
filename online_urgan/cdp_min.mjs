const PORT = 9333
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const n = ++id
  pending.set(n, { resolve, reject })
  ws.send(JSON.stringify({ id: n, method, params, sessionId }))
})

const ctx = await send('Target.createBrowserContext', {})
const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx.browserContextId })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

try {
  const r1 = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__x = 1;', runImmediately: true }, sessionId)
  console.log('addScript ok:', JSON.stringify(r1))
} catch (e) { console.log('addScript err:', e.message) }

try {
  const r2 = await send('Page.enable', {}, sessionId)
  console.log('Page.enable ok')
} catch (e) { console.log('Page.enable err:', e.message) }

await send('Page.navigate', { url: 'http://127.0.0.1:8011/online-urgat/login/' }, sessionId)
await new Promise((r) => setTimeout(r, 2000))
const ev = await send('Runtime.evaluate', { expression: 'JSON.stringify({x: window.__x, url: location.href})', returnByValue: true }, sessionId)
console.log('eval:', ev.result.value)
process.exit(0)
