/*!
 * 谷子账本 · 核心计算层（简洁版）
 * 只记一件事：某位顾客的余额加了多少、减了多少。
 * 纯函数，不依赖 DOM。浏览器挂到 window.HXCore，Node 下可 require 用于单元测试。
 *
 * 金额一律用「分」(整数) 存储与计算，避免浮点误差。
 * 时间一律用本地字符串 "YYYY-MM-DDTHH:mm" 存储，避免时区漂移。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HXCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */

  // 只有两种流水：加钱、减钱。amount 带符号存储（加为正、减为负）。
  var KINDS = {
    in: { key: 'in', label: '加钱', short: '加', sign: 1 },
    out: { key: 'out', label: '减钱', short: '减', sign: -1 }
  };

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ---------------------------------------------------------------- 基础工具 */

  function uid(prefix) {
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '_' + t + r;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, function (ch) {
      return ESCAPES[ch];
    });
  }

  /* ---------------------------------------------------------------- 时间 */

  /** 把任意可解析的时间整理成 "YYYY-MM-DDTHH:mm" */
  function normStamp(value) {
    if (!value) return null;
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      return (
        value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate()) +
        'T' + pad2(value.getHours()) + ':' + pad2(value.getMinutes())
      );
    }
    var s = String(value).trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(s);
    if (m) {
      return (
        m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) +
        'T' + pad2(m[4] === undefined ? 0 : +m[4]) + ':' + pad2(m[5] === undefined ? 0 : +m[5])
      );
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) return normStamp(d);
    return null;
  }

  function nowStamp(now) {
    return normStamp(now || new Date());
  }

  function parseStamp(stamp) {
    var s = normStamp(stamp);
    if (!s) return new Date(NaN);
    return new Date(
      +s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10),
      +s.slice(11, 13), +s.slice(14, 16), 0, 0
    );
  }

  function dayKey(stamp) {
    if (!stamp) return '';
    return String(stamp).slice(0, 10);
  }

  function monthKey(stamp) {
    return dayKey(stamp).slice(0, 7);
  }

  function yearKey(stamp) {
    return dayKey(stamp).slice(0, 4);
  }

  function weekdayCN(stamp) {
    var d = parseStamp(stamp);
    return isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
  }

  /** "11月13日" / "2026年11月13日" */
  function humanDay(key, withYear) {
    if (!key) return '';
    var y = key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10);
    return (withYear ? y + '年' : '') + m + '月' + d + '日';
  }

  function humanMonth(key) {
    if (!key) return '';
    return key.slice(0, 4) + '年' + (+key.slice(5, 7)) + '月';
  }

  function humanTime(stamp) {
    var s = normStamp(stamp);
    return s ? s.slice(11, 16) : '';
  }

  /** 相对今天："今天" / "昨天" / "11月13日 周四" */
  function relativeDayLabel(key, todayStamp) {
    var today = dayKey(todayStamp || nowStamp());
    if (key === today) return '今天';
    if (key === addDays(today, -1)) return '昨天';
    return humanDay(key, yearKey(key) !== yearKey(today)) + ' ' + weekdayCN(key + 'T00:00');
  }

  function addDays(key, delta) {
    var d = new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function daysBetween(fromKey, toKey) {
    var a = parseStamp(fromKey + 'T00:00');
    var b = parseStamp(toKey + 'T00:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b - a) / 86400000);
  }

  /* ---------------------------------------------------------------- 金额 */

  /** "30" / "30.5" / "¥1,200.00" → 分；非法返回 null */
  function parseAmountToCents(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') {
      return isFinite(input) ? Math.round(input * 100) : null;
    }
    var s = String(input).trim().replace(/[¥￥,\s]/g, '');
    if (!s) return null;
    s = s.replace(/^[+＋]/, '');
    s = s.replace(/^[−–—]/, '-');
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(parseFloat(s) * 100);
  }

  /** 分 → "1,200" / "12.5" / "0.05"（整元不显示小数） */
  function formatCents(cents) {
    var n = Math.round(Number(cents) || 0);
    var neg = n < 0;
    var abs = Math.abs(n);
    var yuan = Math.floor(abs / 100);
    var fen = abs % 100;
    var out = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (fen) out += '.' + (fen % 10 === 0 ? String(fen / 10) : pad2(fen));
    return (neg ? '−' : '') + out;
  }

  /** 分 → "¥1,200" */
  function formatMoney(cents) {
    var n = Math.round(Number(cents) || 0);
    return (n < 0 ? '−¥' : '¥') + formatCents(Math.abs(n));
  }

  /** 分 → "+30" / "−15" / "0" */
  function formatSigned(cents) {
    var n = Math.round(Number(cents) || 0);
    if (n === 0) return '0';
    return (n > 0 ? '+' : '−') + formatCents(Math.abs(n));
  }

  /* ---------------------------------------------------------------- 流水 */

  function isLive(txn) {
    return !!txn && !txn.voided;
  }

  function byTimeAsc(a, b) {
    if (a.at === b.at) return a.createdAt < b.createdAt ? -1 : 1;
    return a.at < b.at ? -1 : 1;
  }

  /** 有效流水，按时间正序 */
  function liveTxns(txns) {
    return (txns || []).filter(isLive).slice().sort(byTimeAsc);
  }

  function balanceOf(txns) {
    return (txns || []).reduce(function (sum, t) {
      return sum + (isLive(t) ? (Number(t.amount) || 0) : 0);
    }, 0);
  }

  /** 算式项：时间正序的有效流水 */
  function termsOf(txns) {
    return liveTxns(txns).map(function (t) {
      return {
        id: t.id,
        amount: Number(t.amount) || 0,
        text: formatSigned(Number(t.amount) || 0),
        at: t.at
      };
    });
  }

  /**
   * 期间汇总
   * range: { from, to } 天键，或 null 表示全部
   */
  function summaryOf(txns, range) {
    var out = { inflow: 0, outflow: 0, net: 0, count: 0 };
    liveTxns(txns).forEach(function (t) {
      if (!inRange(t, range)) return;
      var amt = Number(t.amount) || 0;
      out.count += 1;
      out.net += amt;
      if (amt > 0) out.inflow += amt;
      else out.outflow += Math.abs(amt);
    });
    return out;
  }

  function inRange(txn, range) {
    if (!range) return true;
    var key = dayKey(txn.at);
    if (range.from && key < range.from) return false;
    if (range.to && key > range.to) return false;
    return true;
  }

  /**
   * 期间范围
   * key: 'today' | 'week' | 'month' | 'year' | 'all'
   */
  function rangeOf(key, nowSt) {
    var today = dayKey(nowSt || nowStamp());
    var y = +today.slice(0, 4), m = +today.slice(5, 7);
    if (key === 'today') return { from: today, to: today, key: key, label: '今日' };
    if (key === 'week') {
      var d = parseStamp(today + 'T00:00').getDay();
      var back = d === 0 ? 6 : d - 1; // 以周一为一周起点
      return { from: addDays(today, -back), to: today, key: key, label: '本周' };
    }
    if (key === 'month') {
      var lastDay = new Date(y, m, 0).getDate();
      return {
        from: today.slice(0, 8) + '01',
        to: today.slice(0, 8) + pad2(lastDay),
        key: key,
        label: '本月'
      };
    }
    if (key === 'year') return { from: y + '-01-01', to: y + '-12-31', key: key, label: '今年' };
    return { from: null, to: null, key: 'all', label: '全部' };
  }

  /* ---------------------------------------------------------------- 分组 */

  function keyOfMode(stamp, mode) {
    if (mode === 'year') return yearKey(stamp);
    if (mode === 'month') return monthKey(stamp);
    return dayKey(stamp);
  }

  function groupLabel(key, mode, todayStamp) {
    if (mode === 'year') return key + '年';
    if (mode === 'month') return humanMonth(key);
    return relativeDayLabel(key, todayStamp);
  }

  /**
   * 时间轴分组（倒序：最新在前）
   * 作废记录也保留在时间轴上（灰色显示）但不参与金额计算。
   */
  function groupsOf(txns, mode, todayStamp) {
    var all = (txns || []).slice().sort(byTimeAsc);
    var running = 0;
    var map = new Map();
    all.forEach(function (t) {
      var isVoid = !!t.voided;
      if (!isVoid) running += Number(t.amount) || 0;
      var key = keyOfMode(t.at, mode);
      if (!map.has(key)) {
        map.set(key, { key: key, label: groupLabel(key, mode, todayStamp), items: [], subtotal: 0, ending: 0 });
      }
      var g = map.get(key);
      g.items.push(Object.assign({}, t, { running: isVoid ? null : running }));
      if (!isVoid) {
        g.subtotal += Number(t.amount) || 0;
        g.ending = running;
      }
    });
    var list = [];
    map.forEach(function (g) { list.push(g); });
    list.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
    list.forEach(function (g) { g.items.reverse(); });
    return list;
  }

  /* ---------------------------------------------------------------- 每日对账 */

  /**
   * 按日汇总「全部客户」的期初/发生/期末余额，用于每天核对账目
   */
  function dailySeries(txns, range) {
    var live = liveTxns(txns);
    var opening = 0;
    var buckets = {};
    live.forEach(function (t) {
      var key = dayKey(t.at);
      if (range && range.from && key < range.from) {
        opening += Number(t.amount) || 0;
        return;
      }
      if (range && range.to && key > range.to) return;
      if (!buckets[key]) buckets[key] = { day: key, inflow: 0, outflow: 0, net: 0, count: 0 };
      var b = buckets[key];
      var amt = Number(t.amount) || 0;
      b.count += 1;
      b.net += amt;
      if (amt > 0) b.inflow += amt;
      else b.outflow += Math.abs(amt);
    });

    var days = [];
    var today = dayKey(nowStamp());
    // 今日 / 本周 / 本月要把没流水的日子补出来，方便逐日对账；
    // 今年 / 全部只列出真正有流水的日子，避免几百行空白。
    var shouldFill = range && range.key !== 'year' && range.key !== 'all';
    var fillTo = range && range.to ? (range.to < today ? range.to : today) : null;

    if (shouldFill && range.from && fillTo) {
      var cursor = range.from;
      var guard = 0;
      while (cursor <= fillTo && guard < 800) {
        days.push(buildDayRow(cursor, buckets[cursor]));
        cursor = addDays(cursor, 1);
        guard += 1;
      }
    } else {
      Object.keys(buckets).sort().forEach(function (k) {
        days.push(buildDayRow(k, buckets[k]));
      });
    }

    var running = opening;
    days.forEach(function (row) {
      running += row.net;
      row.ending = running;
    });
    return { opening: opening, days: days, closing: running };
  }

  function buildDayRow(key, b) {
    b = b || {};
    return {
      day: key,
      inflow: b.inflow || 0,
      outflow: b.outflow || 0,
      net: b.net || 0,
      count: b.count || 0,
      ending: 0
    };
  }

  /* ---------------------------------------------------------------- 导出 */

  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(rows) {
    return rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
  }

  /* ---------------------------------------------------------------- 客户 */

  function searchCustomers(customers, keyword) {
    var kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return customers.slice();
    return customers.filter(function (c) {
      var hay = [c.name, c.phone, c.note].join(' ').toLowerCase();
      return hay.indexOf(kw) !== -1;
    });
  }

  function balanceMap(customers, txns) {
    var map = {};
    (customers || []).forEach(function (c) { map[c.id] = 0; });
    liveTxns(txns).forEach(function (t) {
      if (map[t.customerId] === undefined) map[t.customerId] = 0;
      map[t.customerId] += Number(t.amount) || 0;
    });
    return map;
  }

  function lastActivityMap(txns) {
    var map = {};
    liveTxns(txns).forEach(function (t) {
      if (!map[t.customerId] || t.at > map[t.customerId]) map[t.customerId] = t.at;
    });
    return map;
  }

  function countMap(txns) {
    var map = {};
    liveTxns(txns).forEach(function (t) {
      map[t.customerId] = (map[t.customerId] || 0) + 1;
    });
    return map;
  }

  /** 头像显示：中文取首字，英文取首字母 */
  function initialOf(name) {
    var s = String(name || '').trim();
    if (!s) return '·';
    var first = s.charAt(0);
    if (/[a-z]/.test(first)) return first.toUpperCase();
    return first;
  }

  return {
    KINDS: KINDS,
    uid: uid,
    esc: esc,
    normStamp: normStamp,
    nowStamp: nowStamp,
    parseStamp: parseStamp,
    dayKey: dayKey,
    monthKey: monthKey,
    yearKey: yearKey,
    weekdayCN: weekdayCN,
    humanDay: humanDay,
    humanMonth: humanMonth,
    humanTime: humanTime,
    relativeDayLabel: relativeDayLabel,
    addDays: addDays,
    daysBetween: daysBetween,
    parseAmountToCents: parseAmountToCents,
    formatCents: formatCents,
    formatMoney: formatMoney,
    formatSigned: formatSigned,
    isLive: isLive,
    liveTxns: liveTxns,
    balanceOf: balanceOf,
    termsOf: termsOf,
    summaryOf: summaryOf,
    inRange: inRange,
    rangeOf: rangeOf,
    keyOfMode: keyOfMode,
    groupLabel: groupLabel,
    groupsOf: groupsOf,
    dailySeries: dailySeries,
    toCSV: toCSV,
    csvCell: csvCell,
    searchCustomers: searchCustomers,
    balanceMap: balanceMap,
    lastActivityMap: lastActivityMap,
    countMap: countMap,
    initialOf: initialOf
  };
});
