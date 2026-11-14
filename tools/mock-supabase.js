/**
 * 本地假的 Supabase（只实现本项目用到的 PostgREST 子集）
 * 用途：不注册账号也能先试试云同步；也用于自动化测试。
 *
 * 启动：node tools/mock-supabase.js 54321
 * 然后在 App 的「云同步设置」里填：
 *   项目地址：http://127.0.0.1:54321
 *   anon key：随便填，比如 mock
 *   房间码：随便填，比如 guzi
 */
const http = require('node:http')

const port = Number(process.argv[2] || 54321)
const tables = { customers: new Map(), txns: new Map() }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, accept',
  'Access-Control-Max-Age': '86400'
}

function send(res, status, body) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, CORS))
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  const url = new URL(req.url, 'http://localhost')
  const m = /^\/rest\/v1\/(customers|txns)$/.exec(url.pathname)
  if (!m) return send(res, 404, { message: 'no such table' })

  const table = tables[m[1]]

  if (req.method === 'GET') {
    const roomFilter = url.searchParams.get('room')
    const room = roomFilter ? roomFilter.replace(/^eq\./, '') : null
    const rows = [...table.values()].filter((r) => !room || r.room === room)
    return send(res, 200, rows)
  }

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let rows
      try {
        rows = JSON.parse(body || '[]')
      } catch (e) {
        return send(res, 400, { message: 'bad json' })
      }
      rows.forEach((r) => table.set(r.id, r))
      console.log(`[mock] ${m[1]} upsert ${rows.length} 条，共 ${table.size} 条`)
      return send(res, 201, null)
    })
    return
  }

  send(res, 405, { message: 'method not allowed' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`假 Supabase 已启动：http://127.0.0.1:${port}`)
  console.log('在 App 的「云同步设置」里填这个地址，anon key 随便填，房间码自己定。')
})

setInterval(() => {
  const c = tables.customers.size
  const t = tables.txns.size
  if (c || t) console.log(`[mock] 当前云端：${c} 位客户 / ${t} 笔流水`)
}, 30000)
