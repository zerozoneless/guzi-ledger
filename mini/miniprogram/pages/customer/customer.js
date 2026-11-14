const api = require('../../utils/api')
const C = require('../../utils/core')

Page({
  data: {
    loading: true,
    error: '',
    id: '',
    name: '',
    note: '',
    initial: '',
    g: 'g1',
    balanceUnit: '¥',
    balanceText: '0',
    tone: 'is-plus',
    inflowText: '0',
    outflowText: '0',
    countText: '0',
    terms: [],
    totalText: '0',
    groups: [],
    mode: 'day',
    sheetShow: false,
    sheetKind: 'in',
    sheetTitle: '加钱',
    amount: '',
    noteInput: '',
    saving: false
  },

  onLoad(query) {
    this.customerId = query.id
    this.setData({ id: query.id })
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh())
  },

  load(done) {
    const that = this
    api('snapshot')
      .then((snap) => {
        that.apply(snap)
        if (done) done()
      })
      .catch((e) => {
        that.setData({ loading: false, error: e.message || '加载失败' })
        if (done) done()
      })
  },

  apply(snap) {
    const customer = snap.customers.filter((c) => c.id === this.customerId)[0]
    if (!customer) {
      this.setData({ loading: false, error: '客户不存在，可能已被删除' })
      return
    }
    const txns = snap.txns.filter((t) => t.customerId === this.customerId)

    const balance = C.balanceOf(txns)
    const sum = C.summaryOf(txns, null)
    const terms = C.termsOf(txns)

    this.setData({
      loading: false,
      error: '',
      name: customer.name,
      note: customer.note || '',
      initial: C.initialOf(customer.name),
      g: 'g' + ((nameSeed(customer.name) % 5) + 1),
      balanceUnit: balance < 0 ? '−¥' : '¥',
      balanceText: C.formatCents(Math.abs(balance)),
      tone: balance > 0 ? 'is-plus' : balance < 0 ? 'is-minus' : 'is-zero',
      inflowText: C.formatMoney(sum.inflow),
      outflowText: C.formatMoney(sum.outflow),
      countText: sum.count + '',
      terms: terms.map((t) => ({
        id: t.id,
        text: t.text,
        tone: t.amount > 0 ? 'plus' : 'minus'
      })),
      totalText: C.formatCents(balance),
      groups: this.buildGroups(txns)
    })

    wx.setNavigationBarTitle({ title: customer.name })
  },

  buildGroups(txns) {
    const groups = C.groupsOf(txns, this.data.mode, C.nowStamp())
    return groups.map((g) => ({
      key: g.key,
      label: g.label,
      subtotalText: C.formatSigned(g.subtotal),
      subtotalTone: g.subtotal > 0 ? 'plus' : g.subtotal < 0 ? 'minus' : 'zero',
      endingText: '余额 ' + C.formatCents(g.ending),
      items: g.items.map((t) => ({
        id: t.id,
        signText: C.formatSigned(t.amount),
        tone: t.amount > 0 ? 'plus' : 'minus',
        title: t.note || (t.amount > 0 ? '加钱' : '减钱'),
        meta: this.metaOf(t),
        runningText: t.running === null || t.running === undefined ? '' : '余 ' + C.formatCents(t.running),
        voided: !!t.voided
      }))
    }))
  },

  metaOf(t) {
    const parts = []
    if (this.data.mode === 'day') parts.push(C.humanTime(t.at))
    else parts.push(C.humanDay(C.dayKey(t.at), false) + ' ' + C.humanTime(t.at))
    if (t.operator) parts.push(t.operator)
    return parts.join(' · ')
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode })
    this.load()
  },

  openSheet(e) {
    const kind = e.currentTarget.dataset.kind
    this.setData({
      sheetShow: true,
      sheetKind: kind,
      sheetTitle: kind === 'in' ? '加一笔' : '减一笔',
      amount: '',
      noteInput: ''
    })
  },

  closeSheet() {
    this.setData({ sheetShow: false })
  },

  onAmount(e) {
    this.setData({ amount: e.detail.value })
  },

  onNote(e) {
    this.setData({ noteInput: e.detail.value })
  },

  quick(e) {
    this.setData({ amount: String(e.currentTarget.dataset.v) })
  },

  save() {
    if (this.data.saving) return
    const cents = C.parseAmountToCents(this.data.amount)
    if (cents === null) return wx.showToast({ title: '请输入正确金额', icon: 'none' })
    if (!cents) return wx.showToast({ title: '金额不能为 0', icon: 'none' })

    const that = this
    this.setData({ saving: true })
    api('txns.add', {
      customerId: this.customerId,
      kind: this.data.sheetKind,
      amount: cents,
      note: this.data.noteInput,
      at: C.nowStamp()
    })
      .then(() => {
        that.setData({ saving: false, sheetShow: false, amount: '', noteInput: '' })
        wx.showToast({ title: that.data.sheetKind === 'in' ? '已加钱' : '已减钱', icon: 'none' })
        that.load()
      })
      .catch((e) => {
        that.setData({ saving: false })
        wx.showToast({ title: e.message, icon: 'none' })
      })
  },

  tapTxn(e) {
    const id = e.currentTarget.dataset.id
    const voided = e.currentTarget.dataset.voided
    const that = this
    wx.showActionSheet({
      itemList: [voided ? '恢复这条记录' : '作废这条记录', '彻底删除'],
      success(res) {
        if (res.tapIndex === 0) {
          api('txns.void', { id: id, voided: !voided })
            .then(() => that.load())
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '彻底删除这条记录？',
            content: '删除后无法恢复。如果只是记错了，建议用「作废」保留痕迹。',
            confirmColor: '#BE4A36',
            success(r2) {
              if (!r2.confirm) return
              api('txns.remove', { id: id })
                .then(() => that.load())
                .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
            }
          })
        }
      }
    })
  },

  more() {
    const that = this
    wx.showActionSheet({
      itemList: ['修改客户名称', '删除这位客户'],
      success(res) {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '修改名称',
            editable: true,
            content: that.data.name,
            success(r) {
              if (!r.confirm) return
              const name = (r.content || '').trim()
              if (!name) return
              api('customers.update', { id: that.customerId, name: name })
                .then(() => that.load())
                .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
            }
          })
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '删除「' + that.data.name + '」？',
            content: '他的全部记账记录会一起删除，无法恢复。',
            confirmText: '删除',
            confirmColor: '#BE4A36',
            success(r) {
              if (!r.confirm) return
              wx.showLoading({ title: '删除中' })
              api('customers.remove', { id: that.customerId })
                .then(() => {
                  wx.hideLoading()
                  wx.showToast({ title: '已删除', icon: 'none' })
                  setTimeout(() => wx.navigateBack(), 400)
                })
                .catch((err) => {
                  wx.hideLoading()
                  wx.showToast({ title: err.message, icon: 'none' })
                })
            }
          })
        }
      }
    })
  }
})

function nameSeed(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i)
  return n
}
