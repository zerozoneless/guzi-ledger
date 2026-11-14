/*!
 * 谷子账本 · 数据层（简洁版）
 * 负责：localStorage 持久化、客户与流水的增删改查、导入导出、示例数据。
 * 金额以「分」存储，时间以本地 "YYYY-MM-DDTHH:mm" 存储。
 */
(function (root) {
  'use strict';

  var C = root.HXCore;
  var STORAGE_KEY = 'hxsavings.v1';
  var SCHEMA_VERSION = 2;

  var memoryFallback = null;
  var state = null;

  /* ---------------------------------------------------------------- 持久化 */

  function readRaw() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return memoryFallback ? JSON.stringify(memoryFallback) : null;
    }
  }

  function writeRaw(text) {
    try {
      window.localStorage.setItem(STORAGE_KEY, text);
    } catch (err) {
      memoryFallback = JSON.parse(text);
      console.warn('[谷子账本] localStorage 不可用，数据仅保存在当前页面内存中。', err);
    }
  }

  function blankState() {
    return {
      version: SCHEMA_VERSION,
      roomName: '谷子直播间',
      defaults: { operator: '' },
      customers: [],
      txns: []
    };
  }

  // 老版本（有存入/消费/寄售售出/调整四种类型）迁移成加钱/减钱
  var LEGACY_KIND = { deposit: 'in', sale: 'in', purchase: 'out', adjust: null, in: 'in', out: 'out' };

  function normalize(raw) {
    var s = Object.assign(blankState(), raw || {});
    s.version = SCHEMA_VERSION;
    s.defaults = Object.assign({ operator: '' }, s.defaults || {});
    s.customers = Array.isArray(s.customers) ? s.customers : [];
    s.txns = Array.isArray(s.txns) ? s.txns : [];

    s.customers = s.customers
      .filter(function (c) { return c && c.id && c.name; })
      .map(function (c) {
        return {
          id: String(c.id),
          name: String(c.name),
          phone: c.phone ? String(c.phone) : '',
          note: c.note ? String(c.note) : '',
          createdAt: C.normStamp(c.createdAt) || C.nowStamp()
        };
      });

    var known = {};
    s.customers.forEach(function (c) { known[c.id] = true; });

    s.txns = s.txns
      .filter(function (t) {
        return t && t.id && known[t.customerId] && t.at && typeof t.amount === 'number';
      })
      .map(function (t) {
        var amount = Math.round(Number(t.amount) || 0);
        var kind = LEGACY_KIND[t.kind];
        if (kind === undefined || kind === null) kind = amount > 0 ? 'in' : 'out';
        return {
          id: String(t.id),
          customerId: String(t.customerId),
          at: C.normStamp(t.at),
          createdAt: C.normStamp(t.createdAt) || C.normStamp(t.at),
          kind: kind,
          amount: amount,
          note: t.note ? String(t.note) : (t.itemName ? String(t.itemName) : ''),
          operator: t.operator ? String(t.operator) : '',
          voided: !!t.voided,
          voidedAt: t.voided ? C.normStamp(t.voidedAt) || '' : ''
        };
      })
      .sort(function (a, b) {
        if (a.at === b.at) return a.createdAt < b.createdAt ? -1 : 1;
        return a.at < b.at ? -1 : 1;
      });

    return s;
  }

  function init() {
    var raw = readRaw();
    var parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.error('[谷子账本] 本地数据损坏，已备份到 __broken__ 键。', err);
        try { window.localStorage.setItem(STORAGE_KEY + '__broken__', raw); } catch (e) {}
        parsed = null;
      }
    }
    state = normalize(parsed);
    if (!raw) save();
    return state;
  }

  function getState() {
    if (!state) init();
    return state;
  }

  function save() {
    if (!state) return;
    writeRaw(JSON.stringify(state));
  }

  /* ---------------------------------------------------------------- 设置 */

  function setSetting(key, value) {
    var s = getState();
    if (key === 'roomName') s.roomName = String(value || '').trim() || '谷子直播间';
    else s.defaults[key] = value;
    save();
    return s;
  }

  /* ---------------------------------------------------------------- 客户 */

  function customers() {
    return getState().customers.slice();
  }

  function customer(id) {
    return getState().customers.find(function (c) { return c.id === id; }) || null;
  }

  function addCustomer(payload) {
    var name = String((payload && payload.name) || '').trim();
    if (!name) return { ok: false, error: '请填写客户名称' };
    var s = getState();
    var dup = s.customers.find(function (c) { return c.name === name; });
    if (dup) return { ok: false, error: '已有同名客户「' + name + '」，可以加个后缀区分' };
    var c = {
      id: C.uid('c'),
      name: name,
      phone: String((payload && payload.phone) || '').trim(),
      note: String((payload && payload.note) || '').trim(),
      createdAt: C.nowStamp()
    };
    s.customers.push(c);
    save();
    return { ok: true, customer: c };
  }

  function updateCustomer(id, patch) {
    var c = customer(id);
    if (!c) return { ok: false, error: '客户不存在' };
    if (patch.name !== undefined) {
      var name = String(patch.name).trim();
      if (!name) return { ok: false, error: '名称不能为空' };
      var s = getState();
      var dup = s.customers.find(function (x) { return x.name === name && x.id !== id; });
      if (dup) return { ok: false, error: '已有同名客户' };
      c.name = name;
    }
    if (patch.phone !== undefined) c.phone = String(patch.phone).trim();
    if (patch.note !== undefined) c.note = String(patch.note).trim();
    save();
    return { ok: true, customer: c };
  }

  function deleteCustomer(id) {
    var s = getState();
    var before = s.txns.length;
    s.customers = s.customers.filter(function (c) { return c.id !== id; });
    s.txns = s.txns.filter(function (t) { return t.customerId !== id; });
    save();
    return { ok: true, removed: before - s.txns.length };
  }

  /* ---------------------------------------------------------------- 流水 */

  function txns() {
    return getState().txns.slice();
  }

  function txnsOf(customerId) {
    return getState().txns.filter(function (t) { return t.customerId === customerId; });
  }

  function txn(id) {
    return getState().txns.find(function (t) { return t.id === id; }) || null;
  }

  /**
   * 新增流水
   * payload: { customerId, kind: 'in'|'out', amount: 正数分, at, note, operator }
   */
  function addTxn(payload) {
    var p = payload || {};
    if (!customer(p.customerId)) return { ok: false, error: '请选择客户' };
    if (!C.KINDS[p.kind]) return { ok: false, error: '未知的记账类型' };

    var magnitude = Math.round(Math.abs(Number(p.amount) || 0));
    if (!magnitude) return { ok: false, error: '请填写金额' };

    var t = {
      id: C.uid('t'),
      customerId: p.customerId,
      at: C.normStamp(p.at) || C.nowStamp(),
      createdAt: C.nowStamp(),
      kind: p.kind,
      amount: C.KINDS[p.kind].sign * magnitude,
      note: String(p.note || '').trim(),
      operator: String(p.operator || getState().defaults.operator || '').trim(),
      voided: false,
      voidedAt: ''
    };

    var s = getState();
    s.txns.push(t);
    s.txns.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    save();
    return { ok: true, txn: t };
  }

  function updateTxn(id, patch) {
    var t = txn(id);
    if (!t) return { ok: false, error: '记录不存在' };
    var p = patch || {};

    if (p.kind !== undefined && C.KINDS[p.kind]) t.kind = p.kind;
    if (p.amount !== undefined) {
      var magnitude = Math.round(Math.abs(Number(p.amount) || 0));
      if (!magnitude) return { ok: false, error: '请填写金额' };
      t.amount = C.KINDS[t.kind].sign * magnitude;
    }
    if (p.at !== undefined) {
      var at = C.normStamp(p.at);
      if (!at) return { ok: false, error: '时间格式不正确' };
      t.at = at;
    }
    if (p.note !== undefined) t.note = String(p.note).trim();
    if (p.operator !== undefined) t.operator = String(p.operator).trim();

    save();
    return { ok: true, txn: t };
  }

  function setVoid(id, voided) {
    var t = txn(id);
    if (!t) return { ok: false, error: '记录不存在' };
    t.voided = !!voided;
    t.voidedAt = voided ? C.nowStamp() : '';
    save();
    return { ok: true, txn: t };
  }

  function deleteTxn(id) {
    var s = getState();
    var before = s.txns.length;
    s.txns = s.txns.filter(function (t) { return t.id !== id; });
    save();
    return { ok: before !== s.txns.length };
  }

  /* ---------------------------------------------------------------- 统计 */

  function stats() {
    var s = getState();
    var balances = C.balanceMap(s.customers, s.txns);
    var total = 0;
    Object.keys(balances).forEach(function (id) { total += balances[id]; });
    var bytes = 0;
    try {
      bytes = new Blob([JSON.stringify(s)]).size;
    } catch (e) {
      bytes = JSON.stringify(s).length;
    }
    return {
      customers: s.customers.length,
      txns: s.txns.length,
      liveTxns: C.liveTxns(s.txns).length,
      voided: s.txns.length - C.liveTxns(s.txns).length,
      totalBalance: total,
      bytes: bytes
    };
  }

  /* ---------------------------------------------------------------- 导入导出 */

  function exportData() {
    var s = getState();
    return {
      version: SCHEMA_VERSION,
      app: 'hxsavings',
      exportedAt: C.nowStamp(),
      roomName: s.roomName,
      defaults: s.defaults,
      customers: s.customers,
      txns: s.txns
    };
  }

  function exportJSON() {
    return JSON.stringify(exportData(), null, 2);
  }

  /**
   * mode: 'replace' | 'merge'
   */
  function importJSON(text, mode) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: '不是合法的 JSON 文件' };
    }
    if (!parsed || !Array.isArray(parsed.customers) || !Array.isArray(parsed.txns)) {
      return { ok: false, error: '文件结构不正确（缺少 customers / txns）' };
    }

    var incoming = normalize(parsed);

    if (mode === 'merge') {
      var s = getState();
      var ids = {};
      s.customers.forEach(function (c) { ids[c.id] = true; });
      incoming.customers.forEach(function (c) {
        if (ids[c.id]) return;
        if (s.customers.some(function (x) { return x.name === c.name; })) c.name = c.name + '（导入）';
        s.customers.push(c);
      });
      var txnIds = {};
      s.txns.forEach(function (t) { txnIds[t.id] = true; });
      var known = {};
      s.customers.forEach(function (c) { known[c.id] = true; });
      incoming.txns.forEach(function (t) {
        if (txnIds[t.id] || !known[t.customerId]) return;
        s.txns.push(t);
      });
      s.txns.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      save();
      return { ok: true, mode: 'merge', customers: s.customers.length, txns: s.txns.length };
    }

    state = incoming;
    save();
    return { ok: true, mode: 'replace', customers: state.customers.length, txns: state.txns.length };
  }

  function clearAll() {
    state = blankState();
    save();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- 示例数据 */

  function seedDemo() {
    var s = blankState();
    s.roomName = '谷子直播间（示例）';
    s.defaults.operator = '小影';

    function day(offset) {
      return C.addDays(C.dayKey(C.nowStamp()), offset);
    }
    function mk(name, phone, note) {
      var c = { id: C.uid('c'), name: name, phone: phone || '', note: note || '', createdAt: C.nowStamp() };
      s.customers.push(c);
      return c;
    }
    function push(cust, at, amount, note, operator) {
      s.txns.push({
        id: C.uid('t'),
        customerId: cust.id,
        at: at,
        createdAt: at,
        kind: amount > 0 ? 'in' : 'out',
        amount: amount,
        note: note || '',
        operator: operator || '小影',
        voided: false,
        voidedAt: ''
      });
    }

    var xingye = mk('星野', '13800000001', '老客');
    var juzi = mk('橘子汽水', '13800000002', '');
    var achai = mk('阿柴', '', '朋友介绍');
    var baitao = mk('白桃乌龙', '13800000003', '');
    var xiaoman = mk('小满', '', '');

    push(xingye, day(-33) + 'T20:12', 3000, '微信转账');
    push(xingye, day(-32) + 'T21:05', -1500, '抽谷 · 银狼吧唧');
    push(xingye, day(-31) + 'T22:40', 800, '吧唧卖出');
    push(xingye, day(-12) + 'T20:30', 10000, '支付宝');
    push(xingye, day(-9) + 'T21:18', -4500, '抽谷 · 蔚蓝立牌');

    push(juzi, day(-28) + 'T19:40', 5000, '首充');
    push(juzi, day(-21) + 'T20:02', -2200, '盲盒 3 抽');
    push(juzi, day(-6) + 'T21:30', 20000, '信用卡');
    push(juzi, day(-5) + 'T22:10', -6800, '拍立得十连');
    push(juzi, day(-1) + 'T20:45', -1200, '挂件 2 个');

    push(achai, day(-20) + 'T18:20', 15000, '现金');
    push(achai, day(-18) + 'T20:00', -3500, '毛绒挂件');
    push(achai, day(-17) + 'T20:00', -9900, '录错了');
    var last = s.txns[s.txns.length - 1];
    last.voided = true;
    last.voidedAt = day(-17) + 'T20:05';

    push(baitao, day(-40) + 'T19:00', 8000, '');
    push(baitao, day(-38) + 'T21:00', -3000, '吧唧 五条');
    push(baitao, day(-30) + 'T21:20', -2600, '立牌');
    push(baitao, day(-20) + 'T22:00', 1500, '吧唧卖出');
    push(baitao, day(-3) + 'T22:10', 1800, '立牌卖出');

    push(xiaoman, day(-8) + 'T20:30', 3000, '');
    push(xiaoman, day(-7) + 'T21:00', -2800, '拍立得 4 张');
    push(xiaoman, day(-2) + 'T20:15', 500, '活动补差');

    s.txns.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    state = s;
    save();
    return { ok: true };
  }

  root.HXStore = {
    STORAGE_KEY: STORAGE_KEY,
    init: init,
    state: getState,
    save: save,
    setSetting: setSetting,
    customers: customers,
    customer: customer,
    addCustomer: addCustomer,
    updateCustomer: updateCustomer,
    deleteCustomer: deleteCustomer,
    txns: txns,
    txnsOf: txnsOf,
    txn: txn,
    addTxn: addTxn,
    updateTxn: updateTxn,
    setVoid: setVoid,
    deleteTxn: deleteTxn,
    stats: stats,
    exportData: exportData,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll,
    seedDemo: seedDemo
  };
})(typeof window !== 'undefined' ? window : globalThis);
