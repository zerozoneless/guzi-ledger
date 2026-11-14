/**
 * 云同步测试：用一个本地假的 PostgREST 服务，模拟两台设备共用一本账。
 * 运行：node --test test/cloud.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const C = require('../assets/core.js')
globalThis.HXCore = C

/* ---------------------------------------------------------------- 假的 localStorage */

function makeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => map
  }
}

function makeDevice() {
  globalThis.window = { localStorage: makeStorage(), HXCore: C }
  delete require.cache[require.resolve('../assets/store.js')]
  require('../assets/store.js')
  const DB = globalThis.window.HXStore
  DB.init()
  return DB
}

/* ---------------------------------------------------------------- 假的 PostgREST */

function startMock() {
  const tables = { customers: new Map(), txns: new Map() }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const m = /^\/rest\/v1\/(customers|txns)$/.exec(url.pathname)
    if (!m) {
      res.writeHead(404).end('no such table')
      return
    }
    const table = tables[m[1]]

    if (req.method === 'GET') {
      const roomFilter = url.searchParams.get('room') // "eq.xxx"
      const room = roomFilter ? roomFilter.replace(/^eq\./, '') : null
      const rows = [...table.values()].filter((r) => !room || r.room === room)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(rows))
      return
    }

    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const rows = JSON.parse(body)
          for (const row of rows) table.set(row.id, row)
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end('')
        } catch (e) {
          res.writeHead(400).end('bad json')
        }
      })
      return
    }

    res.writeHead(405).end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        url: `http://127.0.0.1:${port}`,
        tables,
        close: () =>
          new Promise((r) => {
            server.close(r)
            if (server.closeAllConnections) server.closeAllConnections()
          })
      })
    })
  })
}

function cfgOf(mock) {
  return { url: mock.url, key: 'anon-test-key', room: 'ROOM-TEST-1' }
}

/* ---------------------------------------------------------------- 测试 */

test('两台设备通过云端共用一本账', async () => {
  const mock = await startMock()
  const HXCloud = require('../assets/cloud.js')
  const cfg = cfgOf(mock)

  // 设备 A：建客户 + 记一笔
  const A = makeDevice()
  const added = A.addCustomer({ name: '星野' })
  assert.equal(added.ok, true)
  const cid = added.customer.id
  A.addTxn({ customerId: cid, kind: 'in', amount: 3000, at: '2026-10-10T20:00', note: '存入' })
  A.addTxn({ customerId: cid, kind: 'out', amount: 1500, at: '2026-10-11T21:00', note: '抽谷' })

  let r = await HXCloud.syncNow(A, cfg)
  assert.equal(r.pushed, 3, '1 个客户 + 2 笔流水')

  // 设备 B：全新设备，同步后应看到同样的账
  const B = makeDevice()
  await HXCloud.syncNow(B, cfg)
  assert.equal(B.customers().length, 1)
  assert.equal(B.customers()[0].name, '星野')
  const bTxns = B.txnsOf(cid)
  assert.equal(bTxns.length, 2)
  assert.equal(C.balanceOf(bTxns), 1500)

  // 设备 B 再记一笔，A 同步后应该看到
  B.addTxn({ customerId: cid, kind: 'in', amount: 800, at: '2026-10-12T22:00', note: '吧唧卖出' })
  await HXCloud.syncNow(B, cfg)
  await HXCloud.syncNow(A, cfg)

  const aTxns = A.txnsOf(cid)
  assert.equal(aTxns.length, 3)
  assert.equal(C.balanceOf(aTxns), 2300, '30 - 15 + 8 = 23')

  await mock.close()
})

test('删除会同步到另一台设备（墓碑生效）', async () => {
  const mock = await startMock()
  const HXCloud = require('../assets/cloud.js')
  const cfg = cfgOf(mock)

  const A = makeDevice()
  const cid = A.addCustomer({ name: '阿柴' }).customer.id
  A.addTxn({ customerId: cid, kind: 'in', amount: 5000, at: '2026-10-10T20:00' })
  await HXCloud.syncNow(A, cfg)

  const B = makeDevice()
  await HXCloud.syncNow(B, cfg)
  assert.equal(B.customers().length, 1, 'B 同步到了这个客户')

  // A 删除该客户
  A.deleteCustomer(cid)
  assert.equal(A.customers().length, 0)
  await HXCloud.syncNow(A, cfg)

  // B 同步后也应该看不到
  await HXCloud.syncNow(B, cfg)
  assert.equal(B.customers().length, 0, '删除应该同步过去，而不是被 B 又推回来')
  assert.equal(B.txnsOf(cid).length, 0)

  await mock.close()
})

test('同一记录两端都改过，晚改的生效', async () => {
  const mock = await startMock()
  const HXCloud = require('../assets/cloud.js')
  const cfg = cfgOf(mock)

  const A = makeDevice()
  const cid = A.addCustomer({ name: '小满' }).customer.id
  await HXCloud.syncNow(A, cfg)

  const B = makeDevice()
  await HXCloud.syncNow(B, cfg)

  // A 先改名
  A.updateCustomer(cid, { name: '小满（老客）' })
  // B 后改名（时间更晚）
  await new Promise((r) => setTimeout(r, 5))
  B.updateCustomer(cid, { name: '小满（VIP）' })

  await HXCloud.syncNow(A, cfg)
  await HXCloud.syncNow(B, cfg)
  await HXCloud.syncNow(A, cfg)

  assert.equal(A.customer(cid).name, '小满（VIP）')
  assert.equal(B.customer(cid).name, '小满（VIP）')

  await mock.close()
})

test('清空数据会同步为墓碑，不会从别的设备复活', async () => {
  const mock = await startMock()
  const HXCloud = require('../assets/cloud.js')
  const cfg = cfgOf(mock)

  const A = makeDevice()
  const cid = A.addCustomer({ name: '临时' }).customer.id
  A.addTxn({ customerId: cid, kind: 'in', amount: 1000, at: '2026-10-10T20:00' })
  await HXCloud.syncNow(A, cfg)

  const B = makeDevice()
  await HXCloud.syncNow(B, cfg)
  assert.equal(B.customers().length, 1)

  A.clearAll()
  await HXCloud.syncNow(A, cfg)
  await HXCloud.syncNow(B, cfg)

  assert.equal(A.customers().length, 0)
  assert.equal(B.customers().length, 0)
  assert.equal(B.txns().length, 0)

  await mock.close()
})

test('错误的表名/地址会给出可读错误', async () => {
  const HXCloud = require('../assets/cloud.js')
  await assert.rejects(
    () => HXCloud.testConnection({ url: 'http://127.0.0.1:1', key: 'k', room: 'r' }, { fetch: () => Promise.reject(new Error('ECONNREFUSED')) }),
    /ECONNREFUSED/
  )
})
