/*!
 * 谷子账本 · 云同步层（Supabase REST）
 *
 * 设计要点：
 * - 只用 Supabase 的 REST 接口（不需要 SDK），免费层就够用
 * - 每条记录以 updatedAt（毫秒）做「后写覆盖」
 * - 删除用墓碑（deleted=true），否则别的设备会把删掉的记录又推回来
 * - 配置留空时完全不联网，等同单机版
 *
 * 浏览器挂到 window.HXCloud；Node 下可 require 用于测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.HXCloud = factory(root.HXCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  /* ---------------------------------------------------------------- 行 ↔ 本地记录 */

  function customerToRow(c, room) {
    return {
      id: c.id,
      room: room,
      name: c.name,
      note: c.note || '',
      created_at: c.createdAt || '',
      updated_at: c.updatedAt,
      deleted: !!c.deleted
    };
  }

  function customerFromRow(r) {
    return {
      id: r.id,
      name: r.name,
      phone: '',
      note: r.note || '',
      createdAt: C.normStamp(r.created_at) || C.nowStamp(),
      updatedAt: Math.round(Number(r.updated_at) || 0),
      deleted: !!r.deleted
    };
  }

  function txnToRow(t, room) {
    return {
      id: t.id,
      room: room,
      customer_id: t.customerId,
      kind: t.kind,
      amount: t.amount,
      at: t.at,
      note: t.note || '',
      operator: t.operator || '',
      voided: !!t.voided,
      voided_at: t.voidedAt || '',
      created_at: t.createdAt || '',
      updated_at: t.updatedAt,
      deleted: !!t.deleted
    };
  }

  function txnFromRow(r) {
    return {
      id: r.id,
      customerId: r.customer_id,
      kind: r.kind === 'out' ? 'out' : 'in',
      amount: Math.round(Number(r.amount) || 0),
      at: C.normStamp(r.at) || C.nowStamp(),
      note: r.note || '',
      operator: r.operator || '',
      voided: !!r.voided,
      voidedAt: r.voided_at || '',
      createdAt: C.normStamp(r.created_at) || C.nowStamp(),
      updatedAt: Math.round(Number(r.updated_at) || 0),
      deleted: !!r.deleted
    };
  }

  /* ---------------------------------------------------------------- HTTP 客户端 */

  function createClient(cfg, fetchImpl) {
    var f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('当前环境不支持 fetch');
    var base = String(cfg.url || '').replace(/\/+$/, '');
    if (!base) throw new Error('缺少 Supabase 地址');
    if (!cfg.key) throw new Error('缺少 Supabase anon key');

    var headers = {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      'Content-Type': 'application/json'
    };

    function fail(prefix, res) {
      return res.text().then(function (body) {
        var hint = '';
        if (res.status === 404) hint = '（表不存在？请先在 SQL Editor 里建表）';
        if (res.status === 401 || res.status === 403) hint = '（key 不对，或 RLS 策略没放行）';
        throw new Error(prefix + ' ' + res.status + hint + ' ' + String(body || '').slice(0, 120));
      });
    }

    function pull(table, room) {
      var url = base + '/rest/v1/' + table +
        '?room=eq.' + encodeURIComponent(room) + '&select=*';
      return f(url, { headers: headers, cache: 'no-store' }).then(function (res) {
        if (!res.ok) return fail('拉取失败', res);
        return res.json();
      });
    }

    function push(table, rows) {
      if (!rows || !rows.length) return Promise.resolve(0);
      var url = base + '/rest/v1/' + table + '?on_conflict=id';
      return f(url, {
        method: 'POST',
        headers: Object.assign({}, headers, {
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }),
        body: JSON.stringify(rows)
      }).then(function (res) {
        if (!res.ok) return fail('上传失败', res);
        return rows.length;
      });
    }

    return { pull: pull, push: push, base: base };
  }

  /* ---------------------------------------------------------------- 同步主流程 */

  /**
   * @param DB   数据层（浏览器里是 HXStore）
   * @param cfg  { url, key, room }
   * @param opts { fetch: 自定义 fetch }
   * @returns Promise<{ pushed, pulled, at }>
   */
  function syncNow(DB, cfg, opts) {
    var client = createClient(cfg, opts && opts.fetch);
    var room = cfg.room;

    return Promise.all([client.pull('customers', room), client.pull('txns', room)]).then(function (res) {
      var remoteCustomers = (res[0] || []).map(customerFromRow);
      var remoteTxns = (res[1] || []).map(txnFromRow);

      var pushCustomers = DB.mergeRemote('customers', remoteCustomers);
      var pushTxns = DB.mergeRemote('txns', remoteTxns);

      return Promise.all([
        client.push('customers', pushCustomers.map(function (c) { return customerToRow(c, room); })),
        client.push('txns', pushTxns.map(function (t) { return txnToRow(t, room); }))
      ]).then(function (counts) {
        return {
          pushed: counts[0] + counts[1],
          pulled: remoteCustomers.length + remoteTxns.length,
          at: Date.now()
        };
      });
    });
  }

  /** 只验证配置是否可用（拉一条就够） */
  function testConnection(cfg, opts) {
    var client = createClient(cfg, opts && opts.fetch);
    return client.pull('customers', cfg.room).then(function (rows) {
      return { ok: true, rows: (rows || []).length };
    });
  }

  return {
    createClient: createClient,
    syncNow: syncNow,
    testConnection: testConnection,
    customerToRow: customerToRow,
    customerFromRow: customerFromRow,
    txnToRow: txnToRow,
    txnFromRow: txnFromRow
  };
});
