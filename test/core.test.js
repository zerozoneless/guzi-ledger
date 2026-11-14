/**
 * 核心计算单元测试（简洁版）
 * 运行：node --test test/core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../assets/core.js');

/* ------------------------------------------------------------------ 金额 */

test('parseAmountToCents 接受常见输入', () => {
  assert.equal(C.parseAmountToCents('30'), 3000);
  assert.equal(C.parseAmountToCents('30.5'), 3050);
  assert.equal(C.parseAmountToCents('30.50'), 3050);
  assert.equal(C.parseAmountToCents('¥1,200.00'), 120000);
  assert.equal(C.parseAmountToCents(' 8 '), 800);
  assert.equal(C.parseAmountToCents('+15'), 1500);
  assert.equal(C.parseAmountToCents(30.5), 3050);
  assert.equal(C.parseAmountToCents('0.05'), 5);
});

test('parseAmountToCents 拒绝非法输入', () => {
  assert.equal(C.parseAmountToCents('abc'), null);
  assert.equal(C.parseAmountToCents('1.234'), null);
  assert.equal(C.parseAmountToCents(''), null);
  assert.equal(C.parseAmountToCents('30元'), null);
  assert.equal(C.parseAmountToCents(null), null);
});

test('formatCents 整元不显示小数', () => {
  assert.equal(C.formatCents(3000), '30');
  assert.equal(C.formatCents(3050), '30.5');
  assert.equal(C.formatCents(3005), '30.05');
  assert.equal(C.formatCents(5), '0.05');
  assert.equal(C.formatCents(120000), '1,200');
  assert.equal(C.formatCents(0), '0');
  assert.equal(C.formatCents(-1500), '−15');
});

test('formatSigned 带正负号', () => {
  assert.equal(C.formatSigned(3000), '+30');
  assert.equal(C.formatSigned(-1500), '−15');
  assert.equal(C.formatSigned(0), '0');
});

/* ------------------------------------------------------------------ 时间 */

test('normStamp 归一化各种时间写法', () => {
  assert.equal(C.normStamp('2026-11-13T22:50'), '2026-11-13T22:50');
  assert.equal(C.normStamp('2026-11-13 22:50'), '2026-11-13T22:50');
  assert.equal(C.normStamp('2026-11-13'), '2026-11-13T00:00');
  assert.equal(C.normStamp('2026-1-3T9:05'), '2026-01-03T09:05');
  assert.equal(C.normStamp(''), null);
  assert.equal(C.normStamp('乱写的'), null);
});

test('addDays 跨月跨年', () => {
  assert.equal(C.addDays('2026-11-13', 1), '2026-11-14');
  assert.equal(C.addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2024-02-28', 1), '2024-02-29');
});

test('rangeOf 本月覆盖 30 与 31 天的月份', () => {
  assert.equal(C.rangeOf('month', '2026-11-13T10:00').to, '2026-11-30');
  assert.equal(C.rangeOf('month', '2026-02-10T10:00').to, '2026-02-28');
  assert.equal(C.rangeOf('month', '2024-02-10T10:00').to, '2024-02-29');
  assert.equal(C.rangeOf('year', '2026-11-13T10:00').from, '2026-01-01');
  assert.equal(C.rangeOf('today', '2026-11-13T10:00').from, '2026-11-13');
});

/* ------------------------------------------------------------------ 账目（核心业务） */

function txn(id, at, amount, extra) {
  return Object.assign(
    {
      id,
      customerId: 'c1',
      at,
      createdAt: at,
      kind: amount > 0 ? 'in' : 'out',
      amount,
      note: '',
      operator: '',
      voided: false,
      voidedAt: ''
    },
    extra || {}
  );
}

test('用户给的例子：30 - 15 + 8 = 23', () => {
  const txns = [
    txn('t1', '2026-10-10T20:00', 3000),
    txn('t2', '2026-10-11T21:00', -1500),
    txn('t3', '2026-10-12T22:00', 800)
  ];
  assert.equal(C.balanceOf(txns), 2300);
  assert.equal(C.formatCents(C.balanceOf(txns)), '23');

  const terms = C.termsOf(txns);
  assert.deepEqual(terms.map((t) => t.text), ['+30', '−15', '+8']);
  assert.equal(terms.reduce((s, t) => s + t.amount, 0), 2300);
});

test('作废的记录不计入余额，但仍留在时间轴上', () => {
  const txns = [
    txn('t1', '2026-10-10T20:00', 3000),
    txn('t2', '2026-10-11T21:00', -1500, { voided: true, voidedAt: '2026-10-11T21:05' })
  ];
  assert.equal(C.balanceOf(txns), 3000);

  const groups = C.groupsOf(txns, 'day', '2026-10-12T00:00');
  const items = groups.flatMap((g) => g.items);
  assert.equal(items.length, 2, '作废记录也应在时间轴上出现');
  assert.equal(items.find((i) => i.voided).running, null, '作废记录不显示运行余额');
  assert.equal(items.find((i) => !i.voided).running, 3000);
});

test('summaryOf 按期间统计加钱/减钱', () => {
  const txns = [
    txn('t1', '2026-10-10T20:00', 3000),
    txn('t2', '2026-11-01T21:00', -1500),
    txn('t3', '2026-11-02T22:00', 800),
    txn('t4', '2026-11-03T22:00', -200)
  ];
  const nov = C.summaryOf(txns, C.rangeOf('month', '2026-11-13T00:00'));
  assert.equal(nov.inflow, 800);
  assert.equal(nov.outflow, 1700);
  assert.equal(nov.net, -900);
  assert.equal(nov.count, 3);

  const all = C.summaryOf(txns, null);
  assert.equal(all.inflow, 3800);
  assert.equal(all.outflow, 1700);
  assert.equal(all.net, 2100);
});

test('分组：按日 / 按月 / 按年，且是最新在前', () => {
  const txns = [
    txn('t1', '2026-10-10T20:00', 3000),
    txn('t2', '2026-10-11T21:00', -1500),
    txn('t3', '2026-11-13T09:00', 500)
  ];

  const byDay = C.groupsOf(txns, 'day', '2026-11-13T12:00');
  assert.deepEqual(byDay.map((g) => g.key), ['2026-11-13', '2026-10-11', '2026-10-10']);
  assert.equal(byDay[0].label, '今天');
  assert.equal(byDay[2].ending, 3000);
  assert.equal(byDay[0].ending, 2000);

  assert.deepEqual(C.groupsOf(txns, 'month', '2026-11-13T12:00').map((g) => g.key), ['2026-11', '2026-10']);

  const byYear = C.groupsOf(txns, 'year', '2026-11-13T12:00');
  assert.deepEqual(byYear.map((g) => g.key), ['2026']);
  assert.equal(byYear[0].subtotal, 2000);
});

test('每日对账：期初 + 每日净变动 = 期末', () => {
  const txns = [
    txn('t1', '2026-10-05T20:00', 3000),
    txn('t2', '2026-11-01T21:00', -1500),
    txn('t3', '2026-11-01T22:00', 500),
    txn('t4', '2026-11-03T22:00', -300)
  ];
  const series = C.dailySeries(txns, C.rangeOf('month', '2026-11-13T00:00'));

  assert.equal(series.opening, 3000, '11 月之前只发生了 10-05 的加钱');
  // 只补到今天，不补未来日期（用真实今天推算，避免测试随日期失效）
  const today = C.dayKey(C.nowStamp());
  const expectLast = today < '2026-11-30' ? today : '2026-11-30';
  assert.equal(series.days[0].day, '2026-11-01');
  assert.equal(series.days[series.days.length - 1].day, expectLast);
  assert.ok(series.days.every((d) => d.day <= today), '不应出现未来日期');

  const d1 = series.days.find((d) => d.day === '2026-11-01');
  assert.equal(d1.net, -1000);
  assert.equal(d1.inflow, 500);
  assert.equal(d1.outflow, 1500);
  assert.equal(d1.ending, 2000);

  const d2 = series.days.find((d) => d.day === '2026-11-02');
  assert.equal(d2.net, 0, '没有流水的日期也要出现，净变动为 0');
  assert.equal(d2.ending, 2000);

  assert.equal(series.closing, 1700);
  assert.equal(series.closing, C.balanceOf(txns), '期末余额必须等于总余额');
});

test('每日对账：全年视图只列出有流水的日子', () => {
  const txns = [txn('t1', '2026-03-01T20:00', 3000), txn('t2', '2026-11-01T21:00', -1500)];
  const series = C.dailySeries(txns, C.rangeOf('year', '2026-11-13T00:00'));
  assert.deepEqual(series.days.map((d) => d.day), ['2026-03-01', '2026-11-01']);
  assert.equal(series.opening, 0);
  assert.equal(series.closing, 1500);
});

test('余额可以为负（欠款）', () => {
  const txns = [txn('t1', '2026-10-10T20:00', 1000), txn('t2', '2026-10-11T20:00', -1500)];
  assert.equal(C.balanceOf(txns), -500);
  assert.equal(C.formatSigned(-500), '−5');
  assert.equal(C.formatMoney(-500), '−¥5');
});

/* ------------------------------------------------------------------ 客户与导出 */

test('searchCustomers 命中名称/手机号/备注', () => {
  const customers = [
    { id: 'a', name: '星野', phone: '13800000001', note: '喜欢吧唧' },
    { id: 'b', name: '橘子汽水', phone: '', note: '' }
  ];
  assert.equal(C.searchCustomers(customers, '星').length, 1);
  assert.equal(C.searchCustomers(customers, '1380').length, 1);
  assert.equal(C.searchCustomers(customers, '吧唧').length, 1);
  assert.equal(C.searchCustomers(customers, '').length, 2);
  assert.equal(C.searchCustomers(customers, '不存在').length, 0);
});

test('initialOf 中文取首字、英文取首字母', () => {
  assert.equal(C.initialOf('星野'), '星');
  assert.equal(C.initialOf('Amy'), 'A');
  assert.equal(C.initialOf('  '), '·');
});

test('toCSV 正确转义逗号与引号', () => {
  const csv = C.toCSV([['a', 'b,c'], ['他说"好"', 1]]);
  assert.equal(csv, 'a,"b,c"\r\n"他说""好""",1');
});

test('balanceMap 汇总到每个客户', () => {
  const customers = [{ id: 'a' }, { id: 'b' }];
  const txns = [
    Object.assign(txn('t1', '2026-10-10T20:00', 3000), { customerId: 'a' }),
    Object.assign(txn('t2', '2026-10-11T20:00', -1500), { customerId: 'b' })
  ];
  const map = C.balanceMap(customers, txns);
  assert.equal(map.a, 3000);
  assert.equal(map.b, -1500);
});
