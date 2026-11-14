const api = require('../../utils/api')
const C = require('../../utils/core')

function hashSeed(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i)
  return n
}

Page({
  data: {
    loading: true,
    error: '',
    needJoin: false,
    joinCode: '',
    query: '',
    roomName: '',
    totalUnit: '¥',
    totalText: '0',
    countText: '',
    monthNetText: '0',
    monthNetTone: '',
    list: [],
    filtered: []
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh())
  },

  load(done) {
    this.setData({ loading: true, error: '' })
    api('snapshot')
      .then((snap) => {
        this.applySnapshot(snap)
        if (done) done()
      })
      .catch((e) => {
        if (e.code === 'EMPTY') {
          // 第一个进入的人自动成为店长
          api('bootstrap', { name: '店长' })
            .then(() => this.load(done))
            .catch((e2) => this.setData({ loading: false, error: '初始化失败：' + e2.message }))
          return
        }
        if (e.code === 'NOT_MEMBER') {
          this.setData({ loading: false, needJoin: true })
          if (done) done()
          return
        }
        this.setData({ loading: false, error: e.message || '加载失败' })
        if (done) done()
      })
  },

  applySnapshot(snap) {
    getApp().globalData.snapshot = snap

    const balances = C.balanceMap(snap.customers, snap.txns)
    const lastActive = C.lastActivityMap(snap.txns)
    const counts = C.countMap(snap.txns)

    let total = 0
    const list = snap.customers.map((c) => {
      const bal = balances[c.id] || 0
      total += bal
      const count = counts[c.id] || 0
      const last = lastActive[c.id]
      const meta = count
        ? count + ' 笔 · 最近 ' + C.humanDay(C.dayKey(last), false) + (c.note ? ' · ' + c.note : '')
        : c.note || '还没记过账'
      return {
        id: c.id,
        name: c.name,
        initial: C.initialOf(c.name),
        g: 'g' + ((hashSeed(c.name) % 5) + 1),
        balance: C.formatCents(bal),
        tone: bal > 0 ? 'is-plus' : bal < 0 ? 'is-minus' : 'is-zero',
        meta: meta,
        owed: bal < 0
      }
    })

    list.sort((a, b) => {
      const la = lastActive[a.id] || ''
      const lb = lastActive[b.id] || ''
      if (la === lb) return 0
      return la < lb ? 1 : -1
    })

    const monthSum = C.summaryOf(snap.txns, C.rangeOf('month'))

    this._all = list
    this.setData({
      loading: false,
      needJoin: false,
      roomName: snap.roomName,
      totalUnit: total < 0 ? '−¥' : '¥',
      totalText: C.formatCents(Math.abs(total)),
      countText: snap.customers.length + ' 位客户',
      monthNetText: C.formatSigned(monthSum.net),
      monthNetTone: monthSum.net > 0 ? 'up' : monthSum.net < 0 ? 'down' : ''
    })
    this.filter()
  },

  filter() {
    const q = (this.data.query || '').trim().toLowerCase()
    const all = this._all || []
    const filtered = q
      ? all.filter((c) => (c.name + ' ' + c.meta).toLowerCase().indexOf(q) !== -1)
      : all
    this.setData({ filtered: filtered })
  },

  onQuery(e) {
    this.data.query = e.detail.value
    this.filter()
  },

  clearQuery() {
    this.setData({ query: '' })
    this._all && this.filter()
  },

  openCustomer(e) {
    wx.navigateTo({ url: '/pages/customer/customer?id=' + e.currentTarget.dataset.id })
  },

  addCustomer() {
    const that = this
    wx.showModal({
      title: '添加客户',
      editable: true,
      placeholderText: '客户昵称，例如：小满',
      success(res) {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        if (!name) return wx.showToast({ title: '名称不能为空', icon: 'none' })
        wx.showLoading({ title: '添加中' })
        api('customers.add', { name: name })
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已添加', icon: 'success' })
            that.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: err.message, icon: 'none' })
          })
      }
    })
  },

  onJoinInput(e) {
    this.setData({ joinCode: e.detail.value.toUpperCase() })
  },

  join() {
    const code = (this.data.joinCode || '').trim().toUpperCase()
    if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' })
    const that = this
    wx.showLoading({ title: '加入中' })
    api('join', { inviteCode: code, name: '店员' })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已加入', icon: 'success' })
        that.load()
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message, icon: 'none' })
      })
  }
})
