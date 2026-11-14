App({
  globalData: {
    snapshot: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库，才能使用云开发')
      return
    }
    wx.cloud.init({ traceUser: true })
  }
})
