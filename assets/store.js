/*!
 * 谷子账本 · 数据层（简洁版 + 云同步支持）
 * - 每条记录带 updatedAt（毫秒），用于多设备合并
 * - 删除采用「墓碑」：deleted=true 保留记录，同步后其他设备才知道要删
 * - 金额以「分」存储，时间以本地 "YYYY-MM-DDTHH:mm" 存储
 */
(function (root) {
  'use strict';

  var C = root.HXCore;
  var STORAGE_KEY = 'hxsavings.v1';
  var SCHEMA_VERSION = 3;

  var memoryFallback = null;
  var state = null;

  // 一次性取到 storage 引用（之后不再依赖 window，便于测试与多实例）
  var storage = null;
  try {
    storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (e) {
    storage = null;
  }

  /* ---------------------------------------------------------------- 持久化 */

  function readRaw() {
    try {
      return storage ? storage.getItem(STORAGE_KEY) : (memoryFallback ? JSON.stringify(memoryFallback) : null);
    } catch (err) {
      return memoryFallback ? JSON.stringify(memoryFallback) : null;
    }
  }

  function writeRaw(text) {
    try {
      if (storage) storage.setItem(STORAGE_KEY, text);
      else memoryFallback = JSON.parse(text);
    } catch (err) {
      memoryFallback = JSON.parse(text);
      console.warn('[谷子账本] 本地存储不可用，数据仅保存在当前页面内存中。', err);
    }
  }

  function blankState() {
    return {
      version: SCHEMA_VERSION,
      roomName: '谷子直播间',
      defaults: { operator: '' },
      sync: { url: '', key: '', room: '' },
      customers: [],
      txns: []
    };
  }

  // 老版本类型迁移：存入/寄售售出→加钱，消费→减钱
  var LEGACY_KIND = { deposit: 'in', sale: 'in', purchase: 'out', adjust: null, in: 'in', out: 'out' };

  function ms(value, fallback) {
    var n = Number(value);
    if (isFinite(n) && n > 0) return Math.round(n);
    return fallback || 0;
  }

  function normalize(raw) {
    var s = Object.assign(blankState(), raw || {});
    s.version = SCHEMA_VERSION;
    s.defaults = Object.assign({ operator: '' }, s.defaults || {});
    s.sync = Object.assign({ url: '', key: '', room: '' }, s.sync || {});
    s.customers = Array.isArray(s.customers) ? s.customers : [];
    s.txns = Array.isArray(s.txns) ? s.txns : [];

    var now = Date.now();

    s.customers = s.customers
      .filter(function (c) { return c && c.id && c.name; })
      .map(function (c) {
        return {
          id: String(c.id),
          name: String(c.name),
          phone: c.phone ? String(c.phone) : '',
          note: c.note ? String(c.note) : '',
          createdAt: C.normStamp(c.createdAt) || C.nowStamp(),
          updatedAt: ms(c.updatedAt, now),
          deleted: !!c.deleted
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
          voidedAt: t.voided ? C.normStamp(t.voidedAt) || '' : '',
          updatedAt: ms(t.updatedAt, now),
          deleted: !!t.deleted
        };
      })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });

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

  /** 单调递增的版本戳，避免同一毫秒多次修改 */
  var lastStamp = 0;
  function nextStamp() {
    var t = Date.now();
    if (t <= lastStamp) t = lastStamp + 1;
    lastStamp = t;
    return t;
  }

  /* ---------------------------------------------------------------- 设置 */

  function setSetting(key, value) {
    var s = getState();
    if (key === 'roomName') s.roomName = String(value || '').trim() || '谷子直播间';
    else s.defaults[key] = value;
    save();
    return s;
  }

  function syncConfig() {
    return Object.assign({}, getState().sync);
  }

  function setSyncConfig(cfg) {
    var s = getState();
    s.sync = {
      url: String((cfg && cfg.url) || '').trim().replace(/\/+$/, ''),
      key: String((cfg && cfg.key) || '').trim(),
      room: String((cfg && cfg.room) || '').trim()
    };
    save();
    return s.sync;
  }

  function syncEnabled() {
    var c = getState().sync;
    return !!(c.url && c.key && c.room);
  }

  /* ---------------------------------------------------------------- 客户 */

  function allCustomers() {
    return getState().customers.slice();
  }

  function customers() {
    return getState().customers.filter(function (c) { return !c.deleted; });
  }

  function customer(id) {
    return getState().customers.find(function (c) { return c.id === id && !c.deleted; }) || null;
  }

  function addCustomer(payload) {
    var name = String((payload && payload.name) || '').trim();
    if (!name) return { ok: false, error: '请填写客户名称' };
    var s = getState();
    var dup = s.customers.find(function (c) { return !c.deleted && c.name === name; });
    if (dup) return { ok: false, error: '已有同名客户「' + name + '」，可以加个后缀区分' };
    var c = {
      id: C.uid('c'),
      name: name,
      phone: '',
      note: String((payload && payload.note) || '').trim(),
      createdAt: C.nowStamp(),
      updatedAt: nextStamp(),
      deleted: false
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
      var dup = s.customers.find(function (x) { return x.name === name && x.id !== id && !x.deleted; });
      if (dup) return { ok: false, error: '已有同名客户' };
      c.name = name;
    }
    if (patch.note !== undefined) c.note = String(patch.note).trim();
    c.updatedAt = nextStamp();
    save();
    return { ok: true, customer: c };
  }

  function deleteCustomer(id) {
    var s = getState();
    var stamp = nextStamp();
    var removed = 0;
    s.customers.forEach(function (c) {
      if (c.id === id) {
        c.deleted = true;
        c.updatedAt = stamp;
      }
    });
    s.txns.forEach(function (t) {
      if (t.customerId === id && !t.deleted) {
        t.deleted = true;
        t.updatedAt = stamp;
        removed += 1;
      }
    });
    save();
    return { ok: true, removed: removed };
  }

  /* ---------------------------------------------------------------- 流水 */

  function allTxns() {
    return getState().txns.slice();
  }

  function txns() {
    return getState().txns.filter(function (t) { return !t.deleted; });
  }

  function txnsOf(customerId) {
    return getState().txns.filter(function (t) { return t.customerId === customerId && !t.deleted; });
  }

  function txn(id) {
    return getState().txns.find(function (t) { return t.id === id && !t.deleted; }) || null;
  }

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
      voidedAt: '',
      updatedAt: nextStamp(),
      deleted: false
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

    t.updatedAt = nextStamp();
    save();
    return { ok: true, txn: t };
  }

  function setVoid(id, voided) {
    var t = txn(id);
    if (!t) return { ok: false, error: '记录不存在' };
    t.voided = !!voided;
    t.voidedAt = voided ? C.nowStamp() : '';
    t.updatedAt = nextStamp();
    save();
    return { ok: true, txn: t };
  }

  function deleteTxn(id) {
    var t = getState().txns.find(function (x) { return x.id === id; });
    if (!t) return { ok: false };
    t.deleted = true;
    t.updatedAt = nextStamp();
    save();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- 统计 */

  function stats() {
    var s = getState();
    var live = C.liveTxns(txns());
    var balances = C.balanceMap(customers(), txns());
    var total = 0;
    Object.keys(balances).forEach(function (id) { total += balances[id]; });
    var bytes = 0;
    try {
      bytes = new Blob([JSON.stringify(s)]).size;
    } catch (e) {
      bytes = JSON.stringify(s).length;
    }
    return {
      customers: customers().length,
      txns: txns().length,
      voided: txns().length - live.length,
      totalBalance: total,
      bytes: bytes,
      pendingDeletes: s.customers.filter(function (c) { return c.deleted; }).length +
        s.txns.filter(function (t) { return t.deleted; }).length
    };
  }

  /* ---------------------------------------------------------------- 云同步合并 */

  /**
   * 把远端记录合并进本地。
   * remoteRows: [{...local形状, updatedAt, deleted}]
   * 返回需要回推到远端的本地记录
   */
  function mergeRemote(kind, remoteRows) {
    var s = getState();
    var list = kind === 'customers' ? s.customers : s.txns;
    var byId = {};
    list.forEach(function (r) { byId[r.id] = r; });

    var toPush = [];
    var changed = false;
    var seen = {};

    (remoteRows || []).forEach(function (row) {
      if (!row || !row.id) return;
      seen[row.id] = true;
      var local = byId[row.id];
      var remoteStamp = ms(row.updatedAt, 0);

      if (!local) {
        // 远端新增
        list.push(row);
        byId[row.id] = row;
        changed = true;
        return;
      }
      if (remoteStamp > local.updatedAt) {
        // 远端更新，覆盖本地
        Object.keys(row).forEach(function (k) { local[k] = row[k]; });
        changed = true;
      } else if (local.updatedAt > remoteStamp) {
        toPush.push(local);
      }
    });

    // 本地有、远端没有 → 需要推送
    list.forEach(function (local) {
      if (!seen[local.id]) toPush.push(local);
    });

    if (changed) {
      s.txns.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      save();
    }
    return toPush;
  }

  /** 云端全部记录（含墓碑），供同步使用 */
  function exportForSync() {
    var s = getState();
    return {
      customers: s.customers.map(function (c) {
        return {
          id: c.id,
          name: c.name,
          note: c.note,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          deleted: !!c.deleted
        };
      }),
      txns: s.txns.map(function (t) {
        return {
          id: t.id,
          customerId: t.customerId,
          kind: t.kind,
          amount: t.amount,
          at: t.at,
          note: t.note,
          operator: t.operator,
          voided: !!t.voided,
          voidedAt: t.voidedAt,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          deleted: !!t.deleted
        };
      })
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
      customers: s.customers.filter(function (c) { return !c.deleted; }),
      txns: s.txns.filter(function (t) { return !t.deleted; })
    };
  }

  function exportJSON() {
    return JSON.stringify(exportData(), null, 2);
  }

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
    var stamp = nextStamp();
    incoming.customers.forEach(function (c) { c.updatedAt = stamp; });
    incoming.txns.forEach(function (t) { t.updatedAt = stamp; });

    if (mode === 'merge') {
      var s = getState();
      var ids = {};
      s.customers.forEach(function (c) { ids[c.id] = true; });
      incoming.customers.forEach(function (c) {
        if (ids[c.id]) return;
        if (s.customers.some(function (x) { return !x.deleted && x.name === c.name; })) c.name = c.name + '（导入）';
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

    var sync = getState().sync;
    state = incoming;
    state.sync = sync;
    save();
    return { ok: true, mode: 'replace', customers: state.customers.length, txns: state.txns.length };
  }

  function clearAll() {
    var s = getState();
    var stamp = nextStamp();
    s.customers.forEach(function (c) { c.deleted = true; c.updatedAt = stamp; });
    s.txns.forEach(function (t) { t.deleted = true; t.updatedAt = stamp; });
    save();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- 示例数据 */

  function seedDemo() {
    var s = blankState();
    s.sync = (state && state.sync) || { url: '', key: '', room: '' };
    s.roomName = '谷子直播间（示例）';
    s.defaults.operator = '小影';

    function day(offset) {
      return C.addDays(C.dayKey(C.nowStamp()), offset);
    }
    function mk(name, note) {
      var c = {
        id: C.uid('c'),
        name: name,
        phone: '',
        note: note || '',
        createdAt: C.nowStamp(),
        updatedAt: nextStamp(),
        deleted: false
      };
      s.customers.push(c);
      return c;
    }
    function push(cust, at, amount, note) {
      s.txns.push({
        id: C.uid('t'),
        customerId: cust.id,
        at: at,
        createdAt: at,
        kind: amount > 0 ? 'in' : 'out',
        amount: amount,
        note: note || '',
        operator: '小影',
        voided: false,
        voidedAt: '',
        updatedAt: nextStamp(),
        deleted: false
      });
    }

    var xingye = mk('星野', '老客');
    var juzi = mk('橘子汽水');
    var achai = mk('阿柴', '朋友介绍');
    var baitao = mk('白桃乌龙');
    var xiaoman = mk('小满');

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
    push(baitao, day(-40) + 'T19:00', 8000, '');
    push(baitao, day(-38) + 'T21:00', -3000, '吧唧 五条');
    push(baitao, day(-20) + 'T22:00', 1500, '吧唧卖出');
    push(xiaoman, day(-8) + 'T20:30', 3000, '');
    push(xiaoman, day(-7) + 'T21:00', -2800, '拍立得 4 张');

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
    syncConfig: syncConfig,
    setSyncConfig: setSyncConfig,
    syncEnabled: syncEnabled,
    customers: customers,
    allCustomers: allCustomers,
    customer: customer,
    addCustomer: addCustomer,
    updateCustomer: updateCustomer,
    deleteCustomer: deleteCustomer,
    txns: txns,
    allTxns: allTxns,
    txnsOf: txnsOf,
    txn: txn,
    addTxn: addTxn,
    updateTxn: updateTxn,
    setVoid: setVoid,
    deleteTxn: deleteTxn,
    stats: stats,
    mergeRemote: mergeRemote,
    exportForSync: exportForSync,
    exportData: exportData,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll,
    seedDemo: seedDemo
  };
})(typeof window !== 'undefined' ? window : globalThis);
