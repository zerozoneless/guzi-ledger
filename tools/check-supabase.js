/**
 * Supabase 连接自检
 * 用法：node tools/check-supabase.js <项目地址> <anon/publishable key> [房间码]
 *
 * 例：node tools/check-supabase.js https://xxxx.supabase.co sb_publishable_xxx guzi-2026
 *
 * 带房间码时会做一次「写入 → 读回 → 删除」的完整探测（只写一条 __probe__ 记录，用完立即删）。
 */
const URL_ = process.argv[2]
const KEY = process.argv[3]
const ROOM = process.argv[4]

const ok = (m) => console.log('  ✅ ' + m)
const bad = (m) => console.log('  ❌ ' + m)
const info = (m) => console.log('     ' + m)

async function req(path, opts) {
  const options = Object.assign({}, opts)
  options.headers = Object.assign(
    {
      apikey: KEY,
      'Content-Type': 'application/json'
    },
    options.headers || {}
  )
  const res = await fetch(URL_ + path, options)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch (e) {
    /* 非 JSON 响应 */
  }
  return { status: res.status, headers: res.headers, text, json }
}

;(async () => {
  console.log('\n=== 1. 基本信息 ===')
  if (!URL_ || !KEY) {
    bad('用法：node tools/check-supabase.js <项目地址> <key> [房间码]')
    process.exit(2)
  }
  console.log('  地址：' + URL_)
  console.log('  key ：' + KEY.slice(0, 18) + '…（' + KEY.length + ' 字符）')

  if (/supabase\.com\/dashboard/.test(URL_)) {
    bad('这不是项目地址，是控制台页面地址')
    info('应该形如 https://<项目ref>.supabase.co')
    process.exit(1)
  }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(URL_)) {
    bad('地址格式不像 Supabase 项目地址（应为 https://xxxx.supabase.co）')
  } else {
    ok('地址格式正确')
  }

  const keyKind = /^sb_publishable_/.test(KEY)
    ? 'publishable（新版）'
    : /^eyJ/.test(KEY)
      ? 'anon JWT（老版）'
      : '未知格式'
  console.log('  key 类型：' + keyKind)

  console.log('\n=== 2. 读取 customers 表 ===')
  let r
  try {
    // 带上 Origin，才能看到服务器真实的 CORS 回应（浏览器一定会带）
    r = await req('/rest/v1/customers?select=id&limit=1', {
      headers: { Origin: 'http://127.0.0.1:8765' }
    })
  } catch (e) {
    bad('请求失败：' + e.message)
    info('检查网络，或地址是否写错')
    process.exit(1)
  }

  console.log('  HTTP ' + r.status)
  const cors = r.headers.get('access-control-allow-origin')
  if (cors) ok('CORS 已放行（' + cors + '），浏览器可直接访问')
  else bad('没有 CORS 头，浏览器可能被拦截')

  if (r.status === 200) {
    ok('表和权限正常，读到 ' + (Array.isArray(r.json) ? r.json.length : '?') + ' 行')
  } else if (r.status === 404) {
    bad('表不存在 —— SQL 脚本还没执行，或执行失败了')
    info(JSON.stringify(r.json))
  } else if (r.status === 401 || r.status === 403) {
    bad('key 被拒')
    info(JSON.stringify(r.json || r.text))
  } else {
    bad('意外状态码')
    info(r.text.slice(0, 300))
  }

  if (r.status !== 200) process.exit(1)

  console.log('\n=== 3. 读取 txns 表 ===')
  const r2 = await req('/rest/v1/txns?select=id&limit=1')
  if (r2.status === 200) ok('表和权限正常，读到 ' + (r2.json || []).length + ' 行')
  else {
    bad('HTTP ' + r2.status + '：' + r2.text.slice(0, 200))
    process.exit(1)
  }

  if (!ROOM) {
    console.log('\n（没提供房间码，跳过写入测试）\n')
    return
  }

  console.log('\n=== 4. 写入测试（房间码：' + ROOM + '） ===')
  const probeId = '__probe_' + Date.now()
  const probe = {
    id: probeId,
    room: ROOM,
    name: '__probe__',
    note: '',
    created_at: '',
    updated_at: Date.now(),
    deleted: false
  }
  const w = await req('/rest/v1/customers', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([probe])
  })
  console.log('  HTTP ' + w.status)
  if (w.status === 201 || w.status === 200) {
    ok('写入成功 —— 房间码与 RLS 策略一致，同步没问题')

    const chk = await req('/rest/v1/customers?select=id&room=eq.' + encodeURIComponent(ROOM) + '&id=eq.' + probeId)
    if (chk.status === 200 && Array.isArray(chk.json) && chk.json.length === 1) ok('读回成功')
    else bad('写进去了但读不回来，检查 RLS 的 using 条件')

    const d = await req('/rest/v1/customers?id=eq.' + probeId, { method: 'DELETE' })
    if (d.status === 204 || d.status === 200) ok('探测数据已清理')
    else bad('探测数据未能删除，请手动到 Table Editor 删掉 id=' + probeId)
  } else {
    bad('写入被拒 —— 房间码与 SQL 里的 RLS 策略不一致')
    info('SQL 里写的是 room = \'xxx\'，App 里填的必须完全一致（含大小写）')
    info(JSON.stringify(w.json || w.text).slice(0, 300))
  }

  console.log('')
})().catch((e) => {
  console.error('自检失败：', e.message)
  process.exit(1)
})
