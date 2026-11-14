const api = require('../../utils/api')
const C = require('../../utils/core')

Page({
  data: {
    loading: true,
    error: '',
    range: 'month',
    totalText: '¥0',
    netText: '0',
    netTone: '',
    inflowText: '¥0',
    outflowText: '¥0',
    countText: '0 笔',
    rangeLabel: '本月',
    openingText: '0',
    showOpening: false,
    rows: [],
    balances: [],
    balancesTotalText: '¥0'
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

  switchRange(e) {
    this.setData({ range: e.currentTarget.dataset.range })
    this.load()
  },

  apply(snap) {
    const range = C.rangeOf(this.data.range)
    const balances = C.balanceMap(snap.customers, snap.txns)
    let total = 0
    snap.customers.forEach((c) => {
      total += balances[c.id] || 0
    })

    const sum = C.summaryOf(snap.txns, range)
    const series = C.dailySeries(snap.txns, range)

    const rows = series.days.map((d) => ({
      key: d.day,
      label: C.humanDay(d.day, C.yearKey(d.day) !== C.yearKey(C.nowStamp())),
      inflow: d.inflow ? C.formatCents(d.inflow) : '—',
      inflowTone: d.inflow ? 'is-plus' : 'muted',
      outflow: d.outflow ? C.formatCents(d.outflow) : '—',
      outflowTone: d.outflow ? 'is-minus' : 'muted',
      net: d.net ? C.formatSigned(d.net) : '—',
      netTone: d.net > 0 ? 'is-plus' : d.net < 0 ? 'is-minus' : 'muted',
      ending: C.formatCents(d.ending)
    }))

    const ranked = snap.customers
      .slice()
      .sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0))
      .map((c) => {
        const b = balances[c.id] || 0
        return {
          id: c.id,
          name: c.name,
          text: C.formatMoney(b),
          tone: b > 0 ? 'is-plus' : b < 0 ? 'is-minus' : 'is-zero'
        }
      })

    this.setData({
      loading: false,
      error: '',
      totalText: C.formatMoney(total),
      netText: C.formatSigned(sum.net),
      netTone: sum.net > 0 ? 'is-plus' : sum.net < 0 ? 'is-minus' : 'is-zero',
      inflowText: C.formatMoney(sum.inflow),
      outflowText: C.formatMoney(sum.outflow),
      countText: sum.count + ' 笔',
      rangeLabel: range.label,
      openingText: C.formatCents(series.opening),
      showOpening: series.opening !== 0 || range.key !== 'all',
      rows: rows,
      balances: ranked,
      balancesTotalText: C.formatMoney(total)
    })
  },

  openCustomer(e) {
    wx.navigateTo({ url: '/pages/customer/customer?id=' + e.currentTarget.dataset.id })
  }
})
