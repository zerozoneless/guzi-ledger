/**
 * 谷子账本 · 云函数 ledger
 * 小程序端所有读写都通过这里，数据库权限设为「仅管理端可读写」，
 * 因此客户端无法绕过校验；成员之间通过 inviteCode 加入同一个账本。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COL = { members: 'members', customers: 'customers', txns: 'txns', meta: 'meta' }

const ok = (data) => ({ ok: true, data: data === undefined ? null : data })
const err = (message) => ({ ok: false, error: message })

/* ---------------------------------------------------------------- 工具 */

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function nowStamp() {
  // 云函数默认时区是 UTC，这里统一换算成北京时间字符串
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return (
    d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
  )
}

function makeInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉了容易看错的 I O 0 1
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

/** 云函数单次查询上限 1000，这里分页取全量 */
async function fetchAll(name, where) {
  const out = []
  const pageSize = 200
  for (let skip = 0; skip < 20000; skip += pageSize) {
    let q = db.collection(name)
    if (where) q = q.where(where)
    const res = await q.orderBy('createdAt', 'asc').skip(skip).limit(pageSize).get()
    out.push.apply(out, res.data)
    if (res.data.length < pageSize) break
  }
  return out
}

async function getRoom() {
  try {
    const res = await db.collection(COL.meta).doc('room').get()
    return res.data
  } catch (e) {
    return null
  }
}

async function getMember(openid) {
  const res = await db.collection(COL.members).where({ openid }).limit(1).get()
  return res.data[0] || null
}

function publicMember(m) {
  return { openid: m.openid, name: m.name, role: m.role, joinedAt: m.joinedAt }
}

/* ---------------------------------------------------------------- 鉴权类 */

async function handleAuth(action, event, openid) {
  const room = await getRoom()

  if (action === 'me') {
    if (!room) return err('EMPTY')
    const member = await getMember(openid)
    if (!member) return err('NOT_MEMBER')
    const members = await fetchAll(COL.members)
    return ok({
      me: publicMember(member),
      roomName: room.roomName,
      isOwner: member.role === 'owner',
      inviteCode: member.role === 'owner' ? room.inviteCode : '',
      members: members.map(publicMember)
    })
  }

  if (action === 'bootstrap') {
    if (room) return err('ALREADY_EXISTS')
    const inviteCode = makeInviteCode()
    const name = String(event.name || '').trim().slice(0, 20) || '店主'
    await db.collection(COL.meta).add({
      data: { _id: 'room', inviteCode: inviteCode, roomName: '谷子直播间', createdAt: nowStamp() }
    })
    await db.collection(COL.members).add({
      data: { openid: openid, name: name, role: 'owner', joinedAt: nowStamp() }
    })
    return ok({ inviteCode: inviteCode, role: 'owner' })
  }

  if (action === 'join') {
    if (!room) return err('EMPTY')
    const code = String(event.inviteCode || '').trim().toUpperCase()
    if (code !== room.inviteCode) return err('邀请码不对')
    const exists = await getMember(openid)
    if (exists) return ok({ role: exists.role })
    const name = String(event.name || '').trim().slice(0, 20) || '店员'
    await db.collection(COL.members).add({
      data: { openid: openid, name: name, role: 'member', joinedAt: nowStamp() }
    })
    return ok({ role: 'member' })
  }

  return err('未登录')
}

/* ---------------------------------------------------------------- 主流程 */

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || '')

  try {
    if (action === 'me' || action === 'bootstrap' || action === 'join') {
      return await handleAuth(action, event, OPENID)
    }

    const member = await getMember(OPENID)
    if (!member) return err('NOT_MEMBER')
    const operator = member.name
    const isOwner = member.role === 'owner'

    switch (action) {
      /* ---------------- 一次性拉全量（页面首屏/刷新都用它） ---------------- */
      case 'snapshot': {
        const room = await getRoom()
        const memberList = await fetchAll(COL.members)
        const customers = await fetchAll(COL.customers)
        const txns = await fetchAll(COL.txns)
        return ok({
          roomName: (room && room.roomName) || '谷子直播间',
          me: publicMember(member),
          isOwner: isOwner,
          inviteCode: isOwner ? (room && room.inviteCode) || '' : '',
          members: memberList.map(publicMember),
          customers: customers.map((c) => ({
            id: c._id,
            name: c.name,
            note: c.note || '',
            createdAt: c.createdAt
          })),
          txns: txns.map((t) => ({
            id: t._id,
            customerId: t.customerId,
            kind: t.kind,
            amount: t.amount,
            at: t.at,
            note: t.note || '',
            operator: t.operator || '',
            voided: !!t.voided,
            voidedAt: t.voidedAt || '',
            createdAt: t.createdAt
          }))
        })
      }

      /* ---------------- 成员 ---------------- */
      case 'members.rename': {
        const name = String(event.name || '').trim().slice(0, 20)
        if (!name) return err('名字不能为空')
        await db.collection(COL.members).doc(member._id).update({ data: { name: name } })
        return ok({ name: name })
      }

      case 'room.rename': {
        if (!isOwner) return err('只有店长可以改名称')
        const roomName = String(event.roomName || '').trim().slice(0, 20)
        if (!roomName) return err('名称不能为空')
        await db.collection(COL.meta).doc('room').update({ data: { roomName: roomName } })
        return ok({ roomName: roomName })
      }

      /* ---------------- 客户 ---------------- */
      case 'customers.list': {
        const list = await fetchAll(COL.customers)
        return ok(
          list.map((c) => ({
            id: c._id,
            name: c.name,
            note: c.note || '',
            createdAt: c.createdAt
          }))
        )
      }

      case 'customers.add': {
        const name = String(event.name || '').trim().slice(0, 20)
        if (!name) return err('请填写客户名称')
        const dup = await db.collection(COL.customers).where({ name: name }).limit(1).get()
        if (dup.data.length) return err('已有同名客户「' + name + '」，加个后缀区分吧')
        const res = await db.collection(COL.customers).add({
          data: {
            name: name,
            note: String(event.note || '').trim().slice(0, 40),
            createdAt: nowStamp(),
            createdBy: operator
          }
        })
        return ok({ id: res._id })
      }

      case 'customers.update': {
        const id = String(event.id || '')
        if (!id) return err('参数错误')
        const data = {}
        if (event.name !== undefined) {
          const name = String(event.name).trim().slice(0, 20)
          if (!name) return err('名称不能为空')
          data.name = name
        }
        if (event.note !== undefined) data.note = String(event.note).trim().slice(0, 40)
        await db.collection(COL.customers).doc(id).update({ data: data })
        return ok()
      }

      case 'customers.remove': {
        const id = String(event.id || '')
        if (!id) return err('参数错误')
        const r = await db.collection(COL.txns).where({ customerId: id }).remove()
        await db.collection(COL.customers).doc(id).remove()
        return ok({ removedTxns: (r.stats && r.stats.removed) || 0 })
      }

      /* ---------------- 流水 ---------------- */
      case 'txns.list': {
        const list = await fetchAll(COL.txns)
        return ok(
          list.map((t) => ({
            id: t._id,
            customerId: t.customerId,
            kind: t.kind,
            amount: t.amount,
            at: t.at,
            note: t.note || '',
            operator: t.operator || '',
            voided: !!t.voided,
            voidedAt: t.voidedAt || ''
          }))
        )
      }

      case 'txns.add': {
        const customerId = String(event.customerId || '')
        if (!customerId) return err('请选择客户')
        const kind = event.kind === 'out' ? 'out' : 'in'
        const amount = Math.abs(parseInt(event.amount, 10))
        if (!amount) return err('请填写金额')
        if (amount > 100000000) return err('金额太大了')
        const at = STAMP_RE.test(String(event.at || '')) ? String(event.at) : nowStamp()
        const res = await db.collection(COL.txns).add({
          data: {
            customerId: customerId,
            kind: kind,
            amount: kind === 'in' ? amount : -amount,
            at: at,
            note: String(event.note || '').trim().slice(0, 60),
            operator: operator,
            voided: false,
            voidedAt: '',
            createdAt: nowStamp()
          }
        })
        return ok({ id: res._id })
      }

      case 'txns.update': {
        const id = String(event.id || '')
        if (!id) return err('参数错误')
        const data = {}
        if (event.amount !== undefined) {
          const amount = Math.abs(parseInt(event.amount, 10))
          if (!amount) return err('金额不能为空')
          const cur = await db.collection(COL.txns).doc(id).get()
          data.amount = cur.data.kind === 'in' ? amount : -amount
        }
        if (event.at !== undefined) {
          const at = String(event.at)
          if (!STAMP_RE.test(at)) return err('时间格式不正确')
          data.at = at
        }
        if (event.note !== undefined) data.note = String(event.note).trim().slice(0, 60)
        await db.collection(COL.txns).doc(id).update({ data: data })
        return ok()
      }

      case 'txns.void': {
        const id = String(event.id || '')
        if (!id) return err('参数错误')
        const voided = !!event.voided
        await db.collection(COL.txns).doc(id).update({
          data: { voided: voided, voidedAt: voided ? nowStamp() : '' }
        })
        return ok()
      }

      case 'txns.remove': {
        const id = String(event.id || '')
        if (!id) return err('参数错误')
        await db.collection(COL.txns).doc(id).remove()
        return ok()
      }

      /* ---------------- 管理 ---------------- */
      case 'admin.export': {
        const customers = await fetchAll(COL.customers)
        const txns = await fetchAll(COL.txns)
        return ok({ exportedAt: nowStamp(), customers: customers, txns: txns })
      }

      case 'admin.clear': {
        if (!isOwner) return err('只有店长可以清空数据')
        await db.collection(COL.txns).where({ _id: _.exists(true) }).remove()
        await db.collection(COL.customers).where({ _id: _.exists(true) }).remove()
        return ok()
      }

      default:
        return err('未知操作：' + action)
    }
  } catch (e) {
    console.error('[ledger] 出错', action, e)
    return err(e && e.message ? e.message : '服务异常，请重试')
  }
}
