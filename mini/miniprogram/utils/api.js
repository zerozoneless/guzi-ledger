/**
 * 调用云函数 ledger
 * resolve 时返回 data；reject 时抛出带 code 的 Error
 */
function call(action, data) {
  return new Promise(function (resolve, reject) {
    wx.cloud.callFunction({
      name: 'ledger',
      data: Object.assign({ action: action }, data || {}),
      success: function (res) {
        var r = (res && res.result) || {}
        if (r.ok) {
          resolve(r.data)
        } else {
          var e = new Error(r.error || '操作失败')
          e.code = r.error
          reject(e)
        }
      },
      fail: function (e) {
        var err = new Error((e && e.errMsg) || '网络异常，请重试')
        err.code = 'NETWORK'
        reject(err)
      }
    })
  })
}

module.exports = call
