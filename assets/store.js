/*!
 * 谷子账本 · 数据层
 * 负责：localStorage 持久化、客户与流水的增删改查、导入导出、示例数据。
 * 所有金额以「分」存储，所有时间以本地 "YYYY-MM-DDTHH:mm" 存储。
 */
(function (root) {
  'use strict';

  var C = root.HXCore;
  var STORAGE_KEY = 'hxsavings.v1';
  var SCHEMA_VERSION = 1;

  var memoryFallback = null; // localStorage 不可用时的兜底
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

  /** 兼容旧数据 / 修复脏字段 */
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
          aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [],
          createdAt: C.normStamp(c.createdAt) || C.nowStamp()
        };
      });

    var knownIds = {};
    s.customers.forEach(function (c) { knownIds[c.id] = true; });

    s.txns = s.txns
      .filter(function (t) {
        return t && t.id && knownIds[t.customerId] && t.at && typeof t.amount === 'number';
      })
      .map(function (t) {
        return {
          id: String(t.id),
          customerId: String(t.customerId),
          at: C.normStamp(t.at),
          createdAt: C.normStamp(t.createdAt) || C.normStamp(t.at),
          kind: C.KINDS[t.kind] ? t.kind : 'adjust',
          amount: Math.round(Number(t.amount) || 0),
          itemName: t.itemName ? String(t.itemName) : '',
          category: t.category ? String(t.category) : '',
          disposition: C.DISPOSITIONS[t.disposition] ? t.disposition : '',
          consignPrice: Math.round(Number(t.consignPrice) || 0),
          saleOf: t.saleOf ? String(t.saleOf) : '',
          operator: t.operator ? String(t.operator) : '',
          note: t.note ? String(t.note) : '',
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
    if (dup && !(payload && payload.allowDuplicate)) {
      return { ok: false, error: '已存在同名客户「' + name + '」，如确需新增请修改名称' };
    }
    var c = {
      id: C.uid('c'),
      name: name,
      phone: String((payload && payload.phone) || '').trim(),
      note: String((payload && payload.note) || '').trim(),
      aliases: [],
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
      if (dup) return { ok: false, error: '已存在同名客户' };
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
   * payload: { customerId, kind, amount(显示为正数的分), at, operator, note,
   *            itemName, category, disposition, consignPrice, saleOf }
   * 内部按 kind 决定符号。
   */
  function addTxn(payload) {
    var p = payload || {};
    if (!customer(p.customerId)) return { ok: false, error: '请选择客户' };

    var kind = C.KINDS[p.kind] ? p.kind : null;
    if (!kind) return { ok: false, error: '未知的记账类型' };

    var magnitude = Math.round(Math.abs(Number(p.amount) || 0));
    if (!magnitude) return { ok: false, error: '请填写金额' };

    var at = C.normStamp(p.at) || C.nowStamp();
    var s = getState();

    var signed;
    if (kind === 'adjust') {
      signed = p.negative ? -magnitude : magnitude;
      if (!signed) return { ok: false, error: '调整金额不能为 0' };
    } else {
      signed = C.KINDS[kind].sign * magnitude;
    }

    var t = {
      id: C.uid('t'),
      customerId: p.customerId,
      at: at,
      createdAt: C.nowStamp(),
      kind: kind,
      amount: signed,
      itemName: String(p.itemName || '').trim(),
      category: String(p.category || '').trim(),
      disposition: C.DISPOSITIONS[p.disposition] ? p.disposition : '',
      consignPrice: Math.round(Number(p.consignPrice) || 0),
      saleOf: p.saleOf ? String(p.saleOf) : '',
      operator: String(p.operator || s.defaults.operator || '').trim(),
      note: String(p.note || '').trim(),
      voided: false,
      voidedAt: ''
    };

    if (kind === 'purchase' && t.disposition === 'consign' && !t.consignPrice) {
      return { ok: false, error: '选择寄售时需要填写寄售价' };
    }
    if (kind === 'purchase' && t.disposition === 'consign' && t.consignPrice < 0) {
      return { ok: false, error: '寄售价不能为负数' };
    }

    s.txns.push(t);
    s.txns.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    save();
    return { ok: true, txn: t };
  }

  function updateTxn(id, patch) {
    var t = txn(id);
    if (!t) return { ok: false, error: '记录不存在' };
    var p = patch || {};

    if (p.amount !== undefined) {
      var magnitude = Math.round(Math.abs(Number(p.amount) || 0));
      if (!magnitude) return { ok: false, error: '请填写金额' };
      if (t.kind === 'adjust') {
        t.amount = (p.negative !== undefined ? !!p.negative : t.amount < 0) ? -magnitude : magnitude;
      } else {
        t.amount = C.KINDS[t.kind].sign * magnitude;
      }
    }
    if (p.at !== undefined) {
      var at = C.normStamp(p.at);
      if (!at) return { ok: false, error: '时间格式不正确' };
      t.at = at;
    }
    if (p.itemName !== undefined) t.itemName = String(p.itemName).trim();
    if (p.category !== undefined) t.category = String(p.category).trim();
    if (p.disposition !== undefined && C.DISPOSITIONS[p.disposition]) t.disposition = p.disposition;
    if (p.consignPrice !== undefined) t.consignPrice = Math.round(Number(p.consignPrice) || 0);
    if (p.operator !== undefined) t.operator = String(p.operator).trim();
    if (p.note !== undefined) t.note = String(p.note).trim();

    if (t.kind === 'purchase' && t.disposition === 'consign' && !t.consignPrice) {
      return { ok: false, error: '选择寄售时需要填写寄售价' };
    }

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
    // 删除售出记录后，对应寄售品自动回到在售状态（由 core.shelfOf 推导，无需额外处理）
    save();
    return { ok: before !== s.txns.length };
  }

  /* ---------------------------------------------------------------- 统计 */

  function stats() {
    var s = getState();
    var live = C.liveTxns(s.txns);
    var balances = C.balanceMap(s.customers, s.txns);
    var total = 0;
    var positive = 0;
    var negative = 0;
    Object.keys(balances).forEach(function (id) {
      var v = balances[id];
      total += v;
      if (v > 0) positive += 1;
      else if (v < 0) negative += 1;
    });
    var bytes = 0;
    try {
      bytes = new Blob([JSON.stringify(s)]).size;
    } catch (e) {
      bytes = JSON.stringify(s).length;
    }
    return {
      customers: s.customers.length,
      txns: s.txns.length,
      liveTxns: live.length,
      voided: s.txns.length - live.length,
      totalBalance: total,
      positive: positive,
      negative: negative,
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
        // 同名客户做名称避让，避免出现两个「小明」
        var sameName = s.customers.some(function (x) { return x.name === c.name; });
        if (sameName) c.name = c.name + '（导入）';
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
      var c = { id: C.uid('c'), name: name, phone: phone || '', note: note || '', aliases: [], createdAt: C.nowStamp() };
      s.customers.push(c);
      return c;
    }
    function push(cust, at, kind, amount, extra) {
      var e = extra || {};
      s.txns.push({
        id: C.uid('t'),
        customerId: cust.id,
        at: at,
        createdAt: at,
        kind: kind,
        amount: amount,
        itemName: e.itemName || '',
        category: e.category || '',
        disposition: e.disposition || '',
        consignPrice: e.consignPrice || 0,
        saleOf: e.saleOf || '',
        operator: e.operator || '小影',
        note: e.note || '',
        voided: false,
        voidedAt: ''
      });
      return s.txns[s.txns.length - 1];
    }

    var xingye = mk('星野', '13800000001', '老客，喜欢吧唧');
    var juzi = mk('橘子汽水', '13800000002', '');
    var achai = mk('阿柴', '', '朋友介绍');
    var baitao = mk('白桃乌龙', '13800000003', '');
    var xiaoman = mk('小满', '', '只买拍立得');

    // 星野：存入 30 → 消费 15（吧唧，寄售 8）→ 售出 8
    push(xingye, day(-33) + 'T20:12', 'deposit', 3000, { note: '微信转账' });
    var p1 = push(xingye, day(-32) + 'T21:05', 'purchase', -1500, {
      itemName: '《星穹》吧唧 · 银狼', category: '吧唧', disposition: 'consign', consignPrice: 800
    });
    push(xingye, day(-31) + 'T22:40', 'sale', 800, {
      itemName: '《星穹》吧唧 · 银狼', category: '吧唧', saleOf: p1.id, note: '直播间卖出'
    });
    push(xingye, day(-12) + 'T20:30', 'deposit', 10000, { note: '支付宝' });
    push(xingye, day(-9) + 'T21:18', 'purchase', -4500, {
      itemName: '《蔚蓝》立牌 · 全套', category: '立牌', disposition: 'consign', consignPrice: 2600
    });

    // 橘子汽水：两笔存入，多笔消费
    push(juzi, day(-28) + 'T19:40', 'deposit', 5000, { note: '首充' });
    push(juzi, day(-21) + 'T20:02', 'purchase', -2200, { itemName: '盲盒 3 抽', category: '吧唧', disposition: 'ship' });
    push(juzi, day(-6) + 'T21:30', 'deposit', 20000, { note: '信用卡' });
    push(juzi, day(-5) + 'T22:10', 'purchase', -6800, {
      itemName: '《原神》拍立得 · 十连', category: '拍立得', disposition: 'consign', consignPrice: 3000
    });
    push(juzi, day(-1) + 'T20:45', 'purchase', -1200, { itemName: '挂件 2 个', category: '挂件', disposition: 'ship' });

    // 阿柴：存入 → 消费 → 退单作废
    push(achai, day(-20) + 'T18:20', 'deposit', 15000, { note: '现金' });
    push(achai, day(-18) + 'T20:00', 'purchase', -3500, { itemName: '毛绒挂件', category: '毛绒', disposition: 'ship' });
    var voided = push(achai, day(-17) + 'T20:00', 'purchase', -9900, { itemName: '误录', category: '其他' });
    voided.voided = true;
    voided.voidedAt = day(-17) + 'T20:05';

    // 白桃乌龙：寄售收入累积
    push(baitao, day(-40) + 'T19:00', 'deposit', 8000);
    var b1 = push(baitao, day(-38) + 'T21:00', 'purchase', -3000, {
      itemName: '《咒术》吧唧 · 五条', category: '吧唧', disposition: 'consign', consignPrice: 1500
    });
    var b2 = push(baitao, day(-30) + 'T21:20', 'purchase', -2600, {
      itemName: '《咒术》立牌', category: '立牌', disposition: 'consign', consignPrice: 1800
    });
    push(baitao, day(-20) + 'T22:00', 'sale', 1500, { itemName: '《咒术》吧唧 · 五条', category: '吧唧', saleOf: b1.id });
    push(baitao, day(-3) + 'T22:10', 'sale', 1800, { itemName: '《咒术》立牌', category: '立牌', saleOf: b2.id });

    // 小满：只有存入和消费，余额快见底
    push(xiaoman, day(-8) + 'T20:30', 'deposit', 3000);
    push(xiaoman, day(-7) + 'T21:00', 'purchase', -2800, { itemName: '拍立得 4 张', category: '拍立得', disposition: 'ship' });
    push(xiaoman, day(-2) + 'T20:15', 'adjust', 500, { note: '活动补差' });

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
