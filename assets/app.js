/*!
 * 谷子账本 · 界面层（简洁版）
 * 只做一件事：记某个人的钱加了多少、减了多少。
 * hash 路由：#/ 首页 · #/c/<id> 客户详情 · #/report 报表 · #/settings 设置
 */
(function () {
  'use strict';

  var C = window.HXCore;
  var DB = window.HXStore;

  var appEl = document.getElementById('app');
  var toastEl = document.getElementById('toast');

  var ui = {
    search: '',
    sort: 'recent', // recent | balance | name
    group: 'day',   // day | month | year
    range: 'month', // today | month | year | all
    eqExpanded: {}
  };

  /* ================================================================ 图标 */

  var ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M6 16V9"/><path d="M11 16V5"/><path d="M16 16v-5"/><path d="M21 16v-9"/></svg>',
    cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
  };

  /* ================================================================ 云同步 */

  var syncState = { status: 'off', lastAt: 0, error: '', busy: false, timer: null };

  function syncStatusText() {
    if (!DB.syncEnabled()) return '未开启，数据只在这台设备上';
    if (syncState.status === 'syncing') return '同步中…';
    if (syncState.status === 'error') return '同步失败：' + syncState.error;
    if (!syncState.lastAt) return '已开启，等待首次同步';
    var diff = Math.round((Date.now() - syncState.lastAt) / 1000);
    var when = diff < 60 ? '刚刚' : diff < 3600 ? Math.floor(diff / 60) + ' 分钟前' : Math.floor(diff / 3600) + ' 小时前';
    return '已开启 · ' + when + '同步过';
  }

  function scheduleSync() {
    if (!DB.syncEnabled()) return;
    clearTimeout(syncState.timer);
    syncState.timer = setTimeout(function () { doSync({ silent: true }); }, 1500);
  }

  function doSync(opts) {
    var o = opts || {};
    if (!DB.syncEnabled() || syncState.busy) return Promise.resolve(null);
    syncState.busy = true;
    syncState.status = 'syncing';
    if (!o.silent) render({ keepScroll: true });

    return window.HXCloud.syncNow(DB, DB.syncConfig())
      .then(function (r) {
        syncState.status = 'idle';
        syncState.lastAt = Date.now();
        syncState.error = '';
        syncState.busy = false;
        if (!o.silent) toast('已同步：上传 ' + r.pushed + ' 条');
        if (!openDialogEl) render({ keepScroll: true });
        return r;
      })
      .catch(function (e) {
        syncState.status = 'error';
        syncState.error = e.message || '网络异常';
        syncState.busy = false;
        if (!o.silent) toast('同步失败：' + syncState.error, true);
        if (!openDialogEl) render({ keepScroll: true });
        return null;
      });
  }

  function openSyncSheet() {
    var cfg = DB.syncConfig();
    openSheet({
      title: '云同步设置',
      submitLabel: '保存并同步',
      cancelText: '取消',
      body:
        '<div class="notice" style="margin-bottom:14px"><span>☁️</span><span>需要一个 Supabase 免费项目（不用绑卡）。建表用的 SQL 在 README 里，复制粘贴执行一次即可。</span></div>' +
        field('项目地址', textInput('url', cfg.url, 'https://abcdefgh.supabase.co'), { required: true }) +
        field(
          'anon public key',
          '<textarea name="key" placeholder="eyJhbGciOiJIUzI1NiIs...">' + esc(cfg.key) + '</textarea>',
          { required: true, hint: 'Supabase 设置里的 anon key' }
        ) +
        field('房间码', textInput('room', cfg.room, '自己定一个，例如 guzi-2026'), {
          required: true,
          hint: '多人填一样的才是同一本账'
        }),
      onSubmit: function (form) {
        var fd = new FormData(form);
        var next = {
          url: String(fd.get('url') || '').trim(),
          key: String(fd.get('key') || '').trim(),
          room: String(fd.get('room') || '').trim()
        };
        if (!next.url || !next.key || !next.room) return '三项都要填';
        if (!/^https?:\/\//.test(next.url)) return '项目地址要以 https:// 开头';
        DB.setSyncConfig(next);
        HXCloud.testConnection(DB.syncConfig())
          .then(function () {
            toast('连接成功');
            return doSync({});
          })
          .catch(function (e) {
            toast('连接失败：' + e.message, true);
            render({ keepScroll: true });
          });
        return null;
      }
    });
  }

  /* ================================================================ 工具 */

  var esc = C.esc;

  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', !!isError);
    toastEl.classList.add('is-on');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toastEl.classList.remove('is-on');
    }, 2200);
  }

  function money(cents) { return C.formatMoney(cents); }
  function signed(cents) { return C.formatSigned(cents); }
  function balanceClass(v) { return v > 0 ? 'is-plus' : v < 0 ? 'is-minus' : 'is-zero'; }
  function toneClass(v) { return v > 0 ? 'plus' : v < 0 ? 'minus' : 'zero'; }

  function avatarClass(name) {
    var seed = 0;
    for (var i = 0; i < String(name).length; i++) seed += name.charCodeAt(i);
    return 'avatar--g' + ((seed % 5) + 1);
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function parseRoute() {
    var h = String(location.hash || '').replace(/^#/, '');
    var m = /^\/c\/(.+)$/.exec(h);
    if (m) return { view: 'customer', id: decodeURIComponent(m[1]) };
    if (h === '/report') return { view: 'report' };
    if (h === '/settings') return { view: 'settings' };
    return { view: 'home' };
  }

  /* ================================================================ 渲染入口 */

  var lastRouteKey = null;

  function render(opts) {
    var options = opts || {};
    var route = parseRoute();
    var routeKey = route.view + (route.id || '');
    var keepScroll = options.keepScroll && routeKey === lastRouteKey;
    var scrollY = window.scrollY;

    var html;
    if (route.view === 'customer') html = viewCustomer(route.id);
    else if (route.view === 'report') html = viewReport();
    else if (route.view === 'settings') html = viewSettings();
    else html = viewHome();

    appEl.innerHTML = html;
    lastRouteKey = routeKey;

    Array.prototype.forEach.call(appEl.querySelectorAll('.eq-scroll'), function (box) {
      if (box.scrollWidth > box.clientWidth + 2) box.classList.add('is-overflow');
    });

    if (keepScroll) window.scrollTo(0, scrollY);
    else window.scrollTo(0, 0);
  }

  /* ================================================================ 顶栏 / 导航 */

  function topbarBack(title, rightHTML) {
    return (
      '<header class="topbar">' +
      '<button class="back-btn" data-act="back">' + ICON.back + '返回</button>' +
      '<div class="topbar-title" style="text-align:center">' + esc(title) + '</div>' +
      '<div style="width:64px;display:flex;justify-content:flex-end">' + (rightHTML || '') + '</div>' +
      '</header>'
    );
  }

  function bottomNav(active) {
    var items = [
      { key: 'home', label: '客户', href: '#/', icon: ICON.users },
      { key: 'report', label: '报表', href: '#/report', icon: ICON.chart },
      { key: 'settings', label: '设置', href: '#/settings', icon: ICON.cog }
    ];
    return (
      '<nav class="bottom-nav">' +
      items.map(function (it) {
        return (
          '<a class="nav-item' + (active === it.key ? ' is-on' : '') + '" href="' + it.href + '">' +
          it.icon + '<span>' + it.label + '</span></a>'
        );
      }).join('') +
      '</nav>'
    );
  }

  function segButtons(act, current, options) {
    return (
      '<span class="seg">' +
      options.map(function (o) {
        return '<button data-act="' + act + '" data-value="' + o[0] + '" class="' + (current === o[0] ? 'is-on' : '') + '">' + o[1] + '</button>';
      }).join('') +
      '</span>'
    );
  }

  /* ================================================================ 首页 */

  function viewHome() {
    var st = DB.state();
    var customers = DB.customers();
    var txns = DB.txns();
    var balances = C.balanceMap(customers, txns);
    var lastActive = C.lastActivityMap(txns);
    var counts = C.countMap(txns);

    var total = 0;
    customers.forEach(function (c) { total += balances[c.id] || 0; });
    var monthSum = C.summaryOf(txns, C.rangeOf('month'));
    var todaySum = C.summaryOf(txns, C.rangeOf('today'));

    var filtered = sortCustomers(C.searchCustomers(customers, ui.search), balances, lastActive);

    var html = '<div class="shell">';

    html +=
      '<header class="topbar">' +
      '<div class="brand"><span class="brand-mark">谷</span>谷子账本</div>' +
      '<div class="brand-sub">' + esc(st.roomName) + '</div>' +
      '<div class="topbar-spacer"></div>' +
      '<button class="icon-btn" data-act="new-customer" title="添加客户" aria-label="添加客户">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
      '</button>' +
      '</header>';

    html +=
      '<section class="hero">' +
      '<div class="hero-label">合计未兑付余额</div>' +
      '<div class="hero-value num"><span class="unit">' + (total < 0 ? '−¥' : '¥') + '</span>' + C.formatCents(Math.abs(total)) + '</div>' +
      '<div class="hero-meta">' +
      '<span><b>' + customers.length + '</b> 位客户</span>' +
      '<span>本月净变动 <b class="' + (monthSum.net > 0 ? 'up' : monthSum.net < 0 ? 'down' : '') + '">' + signed(monthSum.net) + '</b></span>' +
      '<span>今日 ' + (todaySum.net === 0 ? '无变动' : '<b class="' + (todaySum.net > 0 ? 'up' : 'down') + '">' + signed(todaySum.net) + '</b>') + '</span>' +
      '</div>' +
      '</section>';

    if (shouldWarnBackup()) {
      html +=
        '<div class="search-wrap" style="margin-top:12px"><div class="notice">' +
        '<span>💾</span><span><strong>建议做一次备份。</strong>数据只存在当前浏览器里，清除缓存或换设备会丢失。到「设置」导出备份文件即可。</span>' +
        '</div></div>';
    }

    if (!customers.length) {
      html +=
        '<div class="empty">' +
        '<div class="empty-icon">🗂️</div>' +
        '<h3>还没有客户</h3>' +
        '<p>先加一位客户，之后每笔加钱、减钱都记在这个人名下，余额自动累计。</p>' +
        '<button class="btn btn--primary" data-act="new-customer">添加第一位客户</button>' +
        '<div style="margin-top:10px"><button class="btn btn--ghost btn--sm" data-act="seed-demo">载入示例数据看看效果</button></div>' +
        '</div>';
      html += bottomNav('home') + '</div>';
      return html;
    }

    html +=
      '<div class="search-wrap"><div class="search">' + ICON.search +
      '<input id="search-input" type="search" placeholder="搜索客户名称、手机号或备注" value="' + esc(ui.search) + '" autocomplete="off">' +
      (ui.search ? '<button class="search-clear" data-act="clear-search">清除</button>' : '') +
      '</div></div>';

    html +=
      '<div class="section-head" style="margin-top:16px">' +
      '<span>客户（' + filtered.length + '）</span>' +
      '<span class="sub">' + segButtons('sort', ui.sort, [['recent', '最近'], ['balance', '余额'], ['name', '名称']]) + '</span>' +
      '</div>';

    html += '<div class="cust-list" id="cust-list">' + customerListHTML(filtered, balances, lastActive, counts) + '</div>';

    html += bottomNav('home');
    html += '</div>';
    return html;
  }

  function sortCustomers(list, balances, lastActive) {
    return list.slice().sort(function (a, b) {
      if (ui.sort === 'balance') return (balances[b.id] || 0) - (balances[a.id] || 0);
      if (ui.sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      return String(lastActive[b.id] || '').localeCompare(String(lastActive[a.id] || ''));
    });
  }

  function customerListHTML(list, balances, lastActive, counts) {
    if (!list.length) {
      return (
        '<div class="empty" style="padding:32px 20px">' +
        '<div class="empty-icon">🔍</div>' +
        '<h3>没有匹配的客户</h3><p>换个关键词试试，或清空搜索。</p>' +
        '</div>'
      );
    }
    return list.map(function (c) {
      var bal = balances[c.id] || 0;
      var count = counts[c.id] || 0;
      var last = lastActive[c.id];
      var meta = count ? count + ' 笔 · 最近 ' + C.humanDay(C.dayKey(last), false) : '还没有记过账';
      return (
        '<a class="cust-card" href="#/c/' + encodeURIComponent(c.id) + '">' +
        '<div class="avatar ' + avatarClass(c.name) + '">' + esc(C.initialOf(c.name)) + '</div>' +
        '<div class="cust-main">' +
        '<div class="cust-name">' + esc(c.name) +
        (bal < 0 ? '<span class="badge badge--warn">欠款</span>' : '') +
        '</div>' +
        '<div class="cust-meta">' + esc(meta) + (c.phone ? ' · ' + esc(c.phone) : '') + '</div>' +
        '</div>' +
        '<div class="cust-right">' +
        '<div class="cust-balance num ' + balanceClass(bal) + '">' + money(bal) + '</div>' +
        '</div>' +
        '</a>'
      );
    }).join('');
  }

  /* ================================================================ 客户详情 */

  function viewCustomer(id) {
    var c = DB.customer(id);
    if (!c) {
      return (
        '<div class="shell">' + topbarBack('未找到') +
        '<div class="empty"><div class="empty-icon">🤔</div><h3>客户不存在</h3>' +
        '<p>可能已被删除，返回列表看看。</p>' +
        '<button class="btn btn--primary" data-act="back">返回列表</button></div>' +
        bottomNav('home') + '</div>'
      );
    }

    var txns = DB.txnsOf(id);
    var balance = C.balanceOf(txns);
    var sum = C.summaryOf(txns, null);

    var html = '<div class="shell shell--with-actions">';
    html += topbarBack(c.name, '<button class="icon-btn" data-act="cust-menu" data-id="' + esc(c.id) + '" aria-label="更多">' + ICON.more + '</button>');

    html +=
      '<section class="card cust-hero">' +
      '<div class="cust-hero-top">' +
      '<div class="avatar ' + avatarClass(c.name) + '" style="width:48px;height:48px;border-radius:15px;font-size:18px">' + esc(C.initialOf(c.name)) + '</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div class="cust-hero-name">' + esc(c.name) + '</div>' +
      '<div class="cust-hero-sub">' + esc([c.phone, c.note].filter(Boolean).join(' · ') || '添加于 ' + C.humanDay(C.dayKey(c.createdAt), true)) + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="balance-label">当前余额</div>' +
      '<div class="balance-big ' + balanceClass(balance) + '"><span class="unit">' + (balance < 0 ? '−¥' : '¥') + '</span>' + C.formatCents(Math.abs(balance)) + '</div>' +
      '<dl class="mini-stats">' +
      '<div class="mini-stat"><dt>累计加钱</dt><dd class="plus">' + money(sum.inflow) + '</dd></div>' +
      '<div class="mini-stat"><dt>累计减钱</dt><dd class="minus">' + money(sum.outflow) + '</dd></div>' +
      '<div class="mini-stat"><dt>记账笔数</dt><dd>' + sum.count + '</dd></div>' +
      '</dl>' +
      '</section>';

    html += equationCard(txns, c.id);

    html +=
      '<div class="section-head" style="margin-top:20px">' +
      '<span>账目明细</span>' +
      '<span class="sub">' + segButtons('group', ui.group, [['day', '按日'], ['month', '按月'], ['year', '按年']]) + '</span>' +
      '</div>';

    var groups = C.groupsOf(txns, ui.group, C.nowStamp());
    if (!groups.length) {
      html +=
        '<div class="empty" style="padding:36px 20px">' +
        '<div class="empty-icon">📒</div><h3>还没记过账</h3>' +
        '<p>用下面的「加钱 / 减钱」记第一笔。</p></div>';
    } else {
      html += '<div class="timeline">' + groups.map(groupHTML).join('') + '</div>';
    }

    html +=
      '<div class="action-bar"><div class="action-grid action-grid--2">' +
      '<button class="action-btn action-btn--big action-btn--in" data-act="new-txn" data-kind="in" data-cid="' + esc(c.id) + '">' +
      '<span class="ico">+</span><span>加钱</span></button>' +
      '<button class="action-btn action-btn--big action-btn--out" data-act="new-txn" data-kind="out" data-cid="' + esc(c.id) + '">' +
      '<span class="ico">−</span><span>减钱</span></button>' +
      '</div></div>';

    html += '</div>';
    return html;
  }

  function groupHTML(group) {
    var tone = toneClass(group.subtotal);
    return (
      '<div class="group">' +
      '<div class="group-head">' +
      '<span>' + esc(group.label) + '</span>' +
      '<span class="g-sum ' + tone + '">' + signed(group.subtotal) + '</span>' +
      '<span class="g-end">余额 ' + C.formatCents(group.ending) + '</span>' +
      '</div>' +
      '<div class="tx-list">' + group.items.map(txRowHTML).join('') + '</div>' +
      '</div>'
    );
  }

  function txRowHTML(t) {
    var tone = t.amount > 0 ? 'plus' : t.amount < 0 ? 'minus' : 'zero';
    var metaParts = [];
    var sameYear = C.yearKey(t.at) === C.yearKey(C.nowStamp());
    if (ui.group === 'day') metaParts.push(C.humanTime(t.at));
    else metaParts.push(C.humanDay(C.dayKey(t.at), !sameYear) + ' ' + C.humanTime(t.at));
    if (t.operator) metaParts.push('经手 ' + esc(t.operator));

    return (
      '<button class="tx' + (t.voided ? ' is-void' : '') + '" data-act="edit-txn" data-id="' + esc(t.id) + '">' +
      '<span class="tx-sign ' + tone + '">' + signed(t.amount) + '</span>' +
      '<span class="tx-main">' +
      '<span class="tx-title"><span class="item">' + esc(t.note || (t.amount > 0 ? '加钱' : '减钱')) + '</span>' +
      (t.voided ? ' <span class="badge badge--warn">已作废</span>' : '') +
      '</span>' +
      '<span class="tx-meta">' + metaParts.join('<span class="dot">·</span>') + '</span>' +
      '</span>' +
      '<span class="tx-bal">' + (t.running === null || t.running === undefined ? '' : '<i>余</i>' + C.formatCents(t.running)) + '</span>' +
      '</button>'
    );
  }

  /* ================================================================ 算式卡片 */

  function equationCard(txns, custId) {
    var terms = C.termsOf(txns);
    var total = terms.reduce(function (s, t) { return s + t.amount; }, 0);

    var head =
      '<div class="eq-head">账目算式' +
      '<span class="right">' + terms.length + ' 笔 · ' +
      (terms.length ? C.humanDay(C.dayKey(terms[0].at), false) + ' 起' : '暂无') +
      '</span></div>';

    if (!terms.length) {
      return '<section class="eq-card">' + head +
        '<div class="eq-hint" style="padding-top:2px">每笔加钱、减钱都会出现在这个式子里。</div>' +
        '</section>';
    }

    var LIMIT = 9;
    var expanded = !!ui.eqExpanded[custId];
    var collapsed = !expanded && terms.length > LIMIT;

    var pieces;
    if (collapsed) {
      pieces = terms.slice(0, 4).map(termHTML);
      pieces.push('<span class="eq-gap">⋯ ' + (terms.length - 8) + ' 笔 ⋯</span>');
      pieces = pieces.concat(terms.slice(-4).map(termHTML));
    } else {
      pieces = terms.map(termHTML);
    }

    var hint = collapsed
      ? '<div class="eq-hint">中间省略 ' + (terms.length - 8) + ' 笔 <button data-act="eq-toggle" data-cid="' + esc(custId) + '">展开全部</button></div>'
      : terms.length > LIMIT
        ? '<div class="eq-hint"><button data-act="eq-toggle" data-cid="' + esc(custId) + '">收起</button></div>'
        : '';

    return (
      '<section class="eq-card">' + head +
      '<div class="eq-row">' +
      '<div class="eq-scroll"><div class="eq">' + pieces.join('') + '</div></div>' +
      '<div class="eq-tail">' +
      '<span class="eq-eq">=</span>' +
      '<span class="eq-total num">' + C.formatCents(total) + '</span>' +
      '</div></div>' + hint +
      '</section>'
    );
  }

  function termHTML(t) {
    return '<span class="eq-term ' + (t.amount > 0 ? 'plus' : 'minus') + '">' + t.text + '</span>';
  }

  /* ================================================================ 报表 */

  function viewReport() {
    var customers = DB.customers();
    var txns = DB.txns();
    var balances = C.balanceMap(customers, txns);
    var range = C.rangeOf(ui.range);

    var total = 0;
    customers.forEach(function (c) { total += balances[c.id] || 0; });

    var sum = C.summaryOf(txns, range);
    var series = C.dailySeries(txns, range);

    var html = '<div class="shell">';
    html +=
      '<header class="topbar"><div class="brand"><span class="brand-mark">谷</span>报表</div>' +
      '<div class="topbar-spacer"></div>' +
      '<button class="icon-btn" data-act="export-csv" title="导出流水" aria-label="导出流水">' + ICON.download + '</button>' +
      '</header>';

    html +=
      '<div class="tabs">' +
      [['today', '今日'], ['month', '本月'], ['year', '今年'], ['all', '全部']].map(function (r) {
        return '<button class="tab' + (ui.range === r[0] ? ' is-on' : '') + '" data-act="range" data-value="' + r[0] + '">' + r[1] + '</button>';
      }).join('') +
      '</div>';

    html +=
      '<div class="kpi-grid">' +
      kpi('未兑付余额', money(total), '', customers.length + ' 位客户合计') +
      kpi('期间净变动', signed(sum.net), sum.net > 0 ? 'plus' : sum.net < 0 ? 'minus' : '', range.label + ' · ' + sum.count + ' 笔') +
      kpi('加钱', money(sum.inflow), 'plus', '顾客存进来的') +
      kpi('减钱', money(sum.outflow), 'minus', '扣掉的') +
      '</div>';

    html += '<div class="section-head" style="margin-top:20px"><span>每日对账</span><span class="sub">期末余额 = 期初 + 当日净变动</span></div>';
    html +=
      '<section class="card" style="overflow:hidden">' +
      '<div class="table-scroll"><table class="report-table">' +
      '<thead><tr><th>日期</th><th>加钱</th><th>减钱</th><th>净变动</th><th>期末余额</th></tr></thead>' +
      '<tbody>' +
      (series.opening !== 0 || range.key !== 'all'
        ? '<tr><td class="muted">期初</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">' + C.formatCents(series.opening) + '</td></tr>'
        : '') +
      series.days.map(function (d) {
        return '<tr>' +
          '<td>' + C.humanDay(d.day, C.yearKey(d.day) !== C.yearKey(C.nowStamp())) + '</td>' +
          '<td class="' + (d.inflow ? 'plus' : 'muted') + '">' + (d.inflow ? C.formatCents(d.inflow) : '—') + '</td>' +
          '<td class="' + (d.outflow ? 'minus' : 'muted') + '">' + (d.outflow ? C.formatCents(d.outflow) : '—') + '</td>' +
          '<td class="' + (d.net > 0 ? 'plus' : d.net < 0 ? 'minus' : 'muted') + '">' + (d.net ? signed(d.net) : '—') + '</td>' +
          '<td><b>' + C.formatCents(d.ending) + '</b></td>' +
          '</tr>';
      }).join('') +
      (series.days.length ? '' : '<tr><td colspan="5" class="muted" style="text-align:center;padding:22px">这段时间没有流水</td></tr>') +
      '</tbody></table></div>' +
      '<div class="report-foot"><span>' + esc(range.label) + '合计</span><span>加钱 ' + C.formatCents(sum.inflow) + ' · 减钱 ' + C.formatCents(sum.outflow) + '</span></div>' +
      '</section>';

    var ranked = customers.slice().sort(function (a, b) { return (balances[b.id] || 0) - (balances[a.id] || 0); });
    html += '<div class="section-head" style="margin-top:20px"><span>客户余额</span><span class="sub">合计 ' + money(total) + '</span></div>';
    html +=
      '<section class="card" style="overflow:hidden"><div class="table-scroll"><table class="report-table">' +
      '<thead><tr><th>客户</th><th>余额</th></tr></thead><tbody>' +
      ranked.map(function (c) {
        var b = balances[c.id] || 0;
        return '<tr><td><a href="#/c/' + encodeURIComponent(c.id) + '">' + esc(c.name) + '</a></td>' +
          '<td class="' + (b > 0 ? 'plus' : b < 0 ? 'minus' : 'muted') + '"><b>' + money(b) + '</b></td></tr>';
      }).join('') +
      (ranked.length ? '' : '<tr><td colspan="2" class="muted" style="text-align:center;padding:22px">还没有客户</td></tr>') +
      '</tbody></table></div></section>';

    html += bottomNav('report') + '</div>';
    return html;

    function kpi(label, value, tone, sub) {
      return '<div class="kpi"><div class="kpi-label">' + label + '</div>' +
        '<div class="kpi-value ' + (tone || '') + '">' + value + '</div>' +
        '<div class="kpi-sub">' + sub + '</div></div>';
    }
  }

  /* ================================================================ 设置 */

  function viewSettings() {
    var st = DB.state();
    var s = DB.stats();
    var kb = Math.max(1, Math.round(s.bytes / 1024));

    var html = '<div class="shell">';
    html += '<header class="topbar"><div class="brand"><span class="brand-mark">谷</span>设置</div></header>';

    html +=
      '<div class="section-head"><span>直播间信息</span></div>' +
      '<section class="card">' +
      '<div class="set-row"><div><div class="set-label">直播间名称</div><div class="set-hint">显示在首页顶部</div></div>' +
      '<input type="text" id="set-room" value="' + esc(st.roomName) + '" placeholder="谷子直播间"></div>' +
      '<div class="set-row"><div><div class="set-label">常用经手人</div><div class="set-hint">记账时默认填入</div></div>' +
      '<input type="text" id="set-operator" value="' + esc(st.defaults.operator || '') + '" placeholder="例如：小影"></div>' +
      '</section>';

    html +=
      '<div class="section-head" style="margin-top:20px"><span>数据</span><span class="sub">共 ' + s.customers + ' 位客户 · ' + s.txns + ' 笔流水</span></div>' +
      '<section class="card">' +
      '<div class="set-row"><div><div class="set-label">备份数据</div><div class="set-hint">导出 JSON 文件，换手机或清缓存后可还原</div></div>' +
      '<button type="button" class="btn btn--sm btn--primary" data-act="export-json">导出</button></div>' +
      '<div class="set-row"><div><div class="set-label">恢复数据</div><div class="set-hint">从备份文件导入，可选覆盖或合并</div></div>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-act="import-json">导入</button></div>' +
      '<div class="set-row"><div><div class="set-label">导出流水表</div><div class="set-hint">CSV 格式，可用 Excel / WPS 打开</div></div>' +
      '<button type="button" class="btn btn--sm btn--ghost" data-act="export-csv">导出</button></div>' +
      '</section>';

    html +=
      '<div class="section-head" style="margin-top:20px"><span>云同步</span><span class="sub">多人共用一本账</span></div>' +
      '<section class="card">' +
      '<div class="set-row"><div><div class="set-label">' + (DB.syncEnabled() ? '已开启' : '未开启') + '</div>' +
      '<div class="set-hint">' + esc(syncStatusText()) + '</div></div>' +
      (DB.syncEnabled() ? '<button type="button" class="btn btn--sm btn--ghost" data-act="sync-now">立即同步</button>' : '') +
      '</div>' +
      '<div class="set-row"><div><div class="set-label">' + (DB.syncEnabled() ? '修改配置' : '开启云同步') + '</div>' +
      '<div class="set-hint">数据存到云端，换手机、多人记账都不丢</div></div>' +
      '<button type="button" class="btn btn--sm ' + (DB.syncEnabled() ? 'btn--ghost' : 'btn--primary') + '" data-act="sync-config">' +
      (DB.syncEnabled() ? '修改' : '设置') + '</button></div>' +
      (DB.syncEnabled()
        ? '<div class="set-row"><div><div class="set-label">关闭同步</div><div class="set-hint">只影响这台设备，不会删除云端数据</div></div>' +
          '<button type="button" class="btn btn--sm btn--danger" data-act="sync-off">关闭</button></div>'
        : '') +
      '</section>';

    html +=
      '<div class="section-head" style="margin-top:20px"><span>危险操作</span></div>' +
      '<section class="card">' +
      '<div class="set-row"><div><div class="set-label">清空全部数据</div><div class="set-hint">删除所有客户与流水，不可恢复</div></div>' +
      '<button type="button" class="btn btn--sm btn--danger" data-act="clear-all">清空</button></div>' +
      '</section>';

    html +=
      '<div class="section-head" style="margin-top:20px"><span>关于</span></div>' +
      '<section class="card" style="padding:16px">' +
      '<div class="notice" style="background:var(--paper-2);color:var(--ink-2)">' +
      '<span>📌</span><span><strong>数据保存在本机浏览器。</strong>换设备、换浏览器或清除网站数据都会看不到旧账，请定期用上面的「导出」做备份。' +
      (s.voided ? '<br>当前有 ' + s.voided + ' 笔作废记录，仍留在明细里但不计入余额。' : '') +
      '<br>数据体积约 ' + kb + ' KB。</span>' +
      '</div>' +
      '<div class="hr"></div>' +
      '<div class="row-between small muted"><span>谷子账本 · 简洁版</span><span>v2.0</span></div>' +
      '</section>';

    html += '<input type="file" id="import-file" class="file-input" accept="application/json,.json">';
    html += bottomNav('settings') + '</div>';
    return html;
  }

  /* ================================================================ 弹层基础 */

  var openDialogEl = null;

  function openSheet(opts) {
    closeSheet();
    var dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML =
      '<div class="sheet-inner">' +
      '<div class="sheet-head"><div class="sheet-title">' + esc(opts.title) + '</div>' +
      '<button type="button" class="sheet-close" data-close aria-label="关闭">✕</button></div>' +
      '<div class="sheet-body">' +
      '<form id="sheet-form" novalidate>' +
      '<div class="form-error" id="form-error"></div>' +
      opts.body +
      '<div class="sheet-actions">' +
      (opts.cancelText === false ? '' : '<button type="button" class="btn btn--ghost" data-close>' + esc(opts.cancelText || '取消') + '</button>') +
      '<button type="submit" class="btn ' + (opts.tone || 'btn--primary') + '">' + esc(opts.submitLabel || '保存') + '</button>' +
      '</div>' +
      '</form></div></div>';

    document.body.appendChild(dlg);
    openDialogEl = dlg;

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');

    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) closeSheet();
      var closer = e.target.closest('[data-close]');
      if (closer) closeSheet();
    });
    dlg.addEventListener('cancel', function (e) {
      e.preventDefault();
      closeSheet();
    });

    var form = dlg.querySelector('#sheet-form');
    var errEl = dlg.querySelector('#form-error');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var result = opts.onSubmit(form, dlg);
      if (typeof result === 'string' && result) {
        errEl.textContent = result;
        errEl.classList.add('is-on');
        errEl.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (openDialogEl === dlg) closeSheet();
    });

    if (opts.afterOpen) opts.afterOpen(form, dlg);

    var firstInput = form.querySelector('input[type="text"]');
    if (firstInput) {
      setTimeout(function () { firstInput.focus(); }, 80);
    }
    return dlg;
  }

  function closeSheet() {
    if (!openDialogEl) return;
    try {
      if (typeof openDialogEl.close === 'function') openDialogEl.close();
    } catch (e) {}
    openDialogEl.remove();
    openDialogEl = null;
  }

  /**
   * 应用内确认框（不使用 window.confirm —— 内嵌浏览器里它会被拦截）
   * 返回 Promise<boolean>
   */
  function askConfirm(opts) {
    return new Promise(function (resolve) {
      var dlg = document.createElement('dialog');
      dlg.className = 'sheet sheet--confirm';
      dlg.innerHTML =
        '<div class="sheet-inner confirm-inner">' +
        '<div class="confirm-title">' + esc(opts.title) + '</div>' +
        (opts.message ? '<div class="confirm-msg">' + esc(opts.message) + '</div>' : '') +
        '<div class="confirm-actions">' +
        '<button type="button" class="btn btn--ghost" data-answer="no">取消</button>' +
        '<button type="button" class="btn ' + (opts.danger ? 'btn--minus' : 'btn--primary') + '" data-answer="yes">' + esc(opts.confirmText || '确定') + '</button>' +
        '</div></div>';

      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');

      function finish(answer) {
        try {
          if (typeof dlg.close === 'function') dlg.close();
        } catch (e) {}
        dlg.remove();
        resolve(answer);
      }

      dlg.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-answer]');
        if (btn) finish(btn.dataset.answer === 'yes');
        else if (e.target === dlg) finish(false);
      });
      dlg.addEventListener('cancel', function (e) {
        e.preventDefault();
        finish(false);
      });
    });
  }

  function field(label, inner, opts) {
    var o = opts || {};
    return (
      '<div class="field">' +
      '<div class="field-label"><span>' + esc(label) + '</span>' +
      (o.required ? '<span class="req">*</span>' : '') +
      (o.hint ? '<span class="opt">' + esc(o.hint) + '</span>' : '') +
      '</div>' + inner + '</div>'
    );
  }

  function textInput(name, value, placeholder, extra) {
    return '<input type="text" name="' + name + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" autocomplete="off" ' + (extra || '') + '>';
  }

  function amountField(value, placeholder) {
    return (
      '<div class="amount-field">' +
      '<span class="prefix">¥</span>' +
      '<input type="text" name="amount" inputmode="decimal" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '0') + '" autocomplete="off">' +
      '</div>'
    );
  }

  function datetimeField(value) {
    return '<input type="datetime-local" name="at" value="' + esc(value || C.nowStamp()) + '" step="60">';
  }

  function operatorField(value) {
    var def = DB.state().defaults.operator || '';
    return textInput('operator', value === undefined ? def : value, '谁记的（可不填）');
  }

  /* ================================================================ 记账弹层 */

  function openTxnSheet(opts) {
    var kind = opts.kind; // 'in' | 'out'
    var customerId = opts.customerId;
    var customer = DB.customer(customerId);
    if (!customer) return;

    var editing = opts.txn || null;
    var t = editing || {};
    var isIn = kind === 'in';

    var timeLabel = '现在 ' + C.humanTime(C.nowStamp());
    if (editing) {
      timeLabel = C.humanDay(C.dayKey(t.at), C.yearKey(t.at) !== C.yearKey(C.nowStamp())) + ' ' + C.humanTime(t.at);
    }

    var body =
      field(isIn ? '加多少钱' : '减多少钱', amountField(editing ? C.formatCents(Math.abs(t.amount)) : '', '0'), { required: true }) +
      '<div class="quick-amounts">' +
      [10, 20, 30, 50, 100, 200].map(function (v) {
        return '<button type="button" class="chip" data-quick="' + v + '">' + v + '</button>';
      }).join('') +
      '</div>' +
      field('备注', textInput('note', t.note, '可不填，例如：抽谷 / 寄存卖出'), { hint: '选填' }) +
      '<details class="more"' + (editing ? ' open' : '') + '>' +
      '<summary><span>时间与经手人</span><span class="more-hint">' + esc(timeLabel) + '</span><span class="caret">⌄</span></summary>' +
      field('时间', datetimeField(editing ? t.at : ''), { required: true }) +
      field('经手人', operatorField(t.operator)) +
      '</details>';

    if (editing) {
      body +=
        '<div class="hr"></div>' +
        '<div class="row-between">' +
        '<button type="button" class="btn btn--sm btn--ghost" data-act="toggle-void" data-id="' + esc(t.id) + '">' +
        (t.voided ? '恢复此记录' : '作废此记录') + '</button>' +
        '<button type="button" class="btn btn--sm btn--danger" data-act="delete-txn" data-id="' + esc(t.id) + '">删除</button>' +
        '</div>';
    }

    openSheet({
      title: editing ? '修改记录' : (isIn ? '加一笔' : '减一笔'),
      submitLabel: editing ? '保存' : (isIn ? '确认加钱' : '确认减钱'),
      cancelText: '取消',
      tone: isIn ? 'btn--plus' : 'btn--minus',
      body: body,
      afterOpen: function (form) {
        Array.prototype.forEach.call(form.querySelectorAll('[data-quick]'), function (btn) {
          btn.addEventListener('click', function () {
            var input = form.querySelector('input[name="amount"]');
            if (input) {
              input.value = btn.dataset.quick;
              input.focus();
            }
          });
        });
      },
      onSubmit: function (form) {
        var fd = new FormData(form);
        var cents = C.parseAmountToCents(String(fd.get('amount') || '').trim());
        if (cents === null) return '请输入正确的金额';
        if (!cents) return '金额不能为 0';

        var at = C.normStamp(fd.get('at'));
        if (!at) return '请选择时间';

        var payload = {
          amount: Math.abs(cents),
          at: at,
          note: String(fd.get('note') || '').trim(),
          operator: String(fd.get('operator') || '').trim()
        };

        var result;
        if (editing) {
          result = DB.updateTxn(t.id, payload);
        } else {
          payload.customerId = customerId;
          payload.kind = kind;
          result = DB.addTxn(payload);
        }
        if (!result.ok) return result.error;

        toast(editing ? '已保存' : (isIn ? '已加 ' + C.formatCents(Math.abs(cents)) : '已减 ' + C.formatCents(Math.abs(cents))));
        render({ keepScroll: true });
        return null;
      }
    });
  }

  /* ================================================================ 客户弹层 */

  function openCustomerSheet(customer) {
    var editing = !!customer;
    var c = customer || { name: '', phone: '', note: '' };

    openSheet({
      title: editing ? '编辑客户' : '添加客户',
      submitLabel: editing ? '保存' : '添加',
      cancelText: '取消',
      body:
        field('客户名称', textInput('name', c.name, '昵称、微信名或编号', 'autocapitalize="off"'), { required: true }) +
        field('备注', textInput('note', c.note, '例如：手机号后四位 / 常买什么'), { hint: '选填' }),
      onSubmit: function (form) {
        var fd = new FormData(form);
        var payload = {
          name: String(fd.get('name') || '').trim(),
          note: String(fd.get('note') || '').trim()
        };
        if (!payload.name) return '请填写客户名称';

        if (editing) {
          var r = DB.updateCustomer(c.id, payload);
          if (!r.ok) return r.error;
          toast('已保存');
          render({ keepScroll: true });
        } else {
          var res = DB.addCustomer(payload);
          if (!res.ok) return res.error;
          toast('已添加');
          go('#/c/' + encodeURIComponent(res.customer.id));
        }
        return null;
      }
    });
  }

  function openCustomerMenu(id) {
    var c = DB.customer(id);
    if (!c) return;
    var txns = DB.txnsOf(id);
    var balance = C.balanceOf(txns);

    openSheet({
      title: c.name,
      submitLabel: '编辑资料',
      cancelText: '关闭',
      body:
        '<div class="notice" style="margin-bottom:16px"><span>💰</span><span>当前余额 <strong>' + money(balance) + '</strong>，共 ' + txns.length + ' 笔记录。</span></div>' +
        '<button type="button" class="btn btn--block btn--danger" data-act="delete-customer" data-id="' + esc(c.id) + '">' +
        ICON.trash + ' 删除这位客户</button>' +
        '<div class="field-label" style="margin-top:10px;font-weight:500;color:var(--muted-2)">会连同他的全部记账一起删除，不可恢复。</div>',
      onSubmit: function () {
        closeSheet();
        openCustomerSheet(c);
        return null;
      }
    });
  }

  /* ================================================================ 导入导出 */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 150);
  }

  function stampForFile() {
    return C.nowStamp().replace(/[:T]/g, '-').slice(0, 16);
  }

  function exportJSON() {
    download('谷子账本备份-' + stampForFile() + '.json', DB.exportJSON(), 'application/json');
    DB.setSetting('lastBackupAt', C.nowStamp());
    toast('已导出备份文件');
    render({ keepScroll: true });
  }

  function exportCSV() {
    var customers = DB.customers();
    var txns = C.liveTxns(DB.txns());
    var nameById = {};
    customers.forEach(function (c) { nameById[c.id] = c.name; });

    if (!txns.length) {
      toast('还没有流水可以导出', true);
      return;
    }

    var rows = [['时间', '客户', '类型', '金额', '备注', '经手人', '发生后的余额']];
    var running = {};
    txns.forEach(function (t) {
      running[t.customerId] = (running[t.customerId] || 0) + t.amount;
      rows.push([
        t.at.replace('T', ' '),
        nameById[t.customerId] || '',
        t.amount > 0 ? '加钱' : '减钱',
        C.formatCents(t.amount),
        t.note,
        t.operator,
        C.formatCents(running[t.customerId])
      ]);
    });

    download('谷子账本流水-' + stampForFile() + '.csv', '\ufeff' + C.toCSV(rows), 'text/csv');
    toast('已导出 CSV');
  }

  function pickImportFile() {
    var input = document.getElementById('import-file');
    if (!input) return;
    input.value = '';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var parsed;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          toast('文件不是合法的 JSON', true);
          return;
        }
        var counts = '（' + ((parsed.customers || []).length) + ' 位客户 / ' + ((parsed.txns || []).length) + ' 笔流水）';
        openSheet({
          title: '导入数据',
          submitLabel: '导入',
          cancelText: '取消',
          body:
            '<div class="notice" style="margin-bottom:16px"><span>⚠️</span><span>文件里有 ' + counts + '。<br><strong>合并</strong>会保留现有数据并追加；<strong>覆盖</strong>会清掉当前全部数据。</span></div>' +
            '<input type="hidden" name="mode" value="merge">' +
            '<div class="chips" data-chips="mode">' +
            '<button type="button" class="chip is-on" data-value="merge">合并（保留现有）</button>' +
            '<button type="button" class="chip" data-value="replace">覆盖（清空现有）</button>' +
            '</div>',
          afterOpen: bindChips,
          onSubmit: function (form) {
            var mode = form.querySelector('input[name="mode"]').value || 'merge';
            var r = DB.importJSON(text, mode);
            if (!r.ok) return r.error;
            toast(mode === 'merge' ? '已合并导入' : '已覆盖导入');
            go('#/');
            render();
            return null;
          }
        });
      };
      reader.readAsText(file, 'utf-8');
    };
    input.click();
  }

  function bindChips(form) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-chips]'), function (group) {
      var name = group.getAttribute('data-chips');
      var hidden = form.querySelector('input[name="' + name + '"]');
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip');
        if (!btn) return;
        Array.prototype.forEach.call(group.querySelectorAll('.chip'), function (b) {
          b.classList.toggle('is-on', b === btn);
        });
        if (hidden) hidden.value = btn.dataset.value;
      });
    });
  }

  /* ================================================================ 事件 */

  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-act]');
    if (!target) return;
    var act = target.getAttribute('data-act');
    var id = target.getAttribute('data-id');
    var value = target.getAttribute('data-value');

    switch (act) {
      case 'back':
        if (history.length > 1) history.back();
        else go('#/');
        break;

      case 'new-customer':
        openCustomerSheet(null);
        break;

      case 'cust-menu':
        openCustomerMenu(id);
        break;

      case 'delete-customer':
        var cName = (DB.customer(id) || {}).name || '该客户';
        closeSheet();
        askConfirm({
          title: '删除「' + cName + '」？',
          message: '他的全部记账记录会一起删除，无法恢复。',
          confirmText: '删除',
          danger: true
        }).then(function (yes) {
          if (!yes) return;
          DB.deleteCustomer(id);
          toast('已删除');
          go('#/');
          render();
        });
        break;

      case 'new-txn':
        openTxnSheet({ kind: target.getAttribute('data-kind'), customerId: target.getAttribute('data-cid') });
        break;

      case 'edit-txn':
        var txn = DB.txn(id);
        if (txn) openTxnSheet({ kind: txn.kind, customerId: txn.customerId, txn: txn });
        break;

      case 'toggle-void':
        var cur = DB.txn(id);
        if (!cur) break;
        DB.setVoid(id, !cur.voided);
        toast(cur.voided ? '已恢复' : '已作废');
        closeSheet();
        render({ keepScroll: true });
        break;

      case 'delete-txn':
        askConfirm({
          title: '删除这条记录？',
          message: '删除后无法恢复。如果是记错了金额，也可以先「作废」保留痕迹。',
          confirmText: '删除',
          danger: true
        }).then(function (yes) {
          if (!yes) return;
          DB.deleteTxn(id);
          toast('已删除');
          closeSheet();
          render({ keepScroll: true });
        });
        break;

      case 'eq-toggle':
        ui.eqExpanded[id] = !ui.eqExpanded[id];
        render({ keepScroll: true });
        break;

      case 'group':
        ui.group = value;
        render({ keepScroll: true });
        break;

      case 'sort':
        ui.sort = value;
        render({ keepScroll: true });
        break;

      case 'range':
        ui.range = value;
        render({ keepScroll: true });
        break;

      case 'clear-search':
        ui.search = '';
        var input = document.getElementById('search-input');
        if (input) input.value = '';
        refreshCustomerList();
        break;

      case 'seed-demo':
        askConfirm({
          title: '载入示例数据？',
          message: '会覆盖当前全部数据，仅用于体验界面。',
          confirmText: '载入',
          danger: true
        }).then(function (yes) {
          if (!yes) return;
          DB.seedDemo();
          toast('已载入示例数据');
          go('#/');
          render();
        });
        break;

      case 'export-json':
        exportJSON();
        break;

      case 'export-csv':
        exportCSV();
        break;

      case 'import-json':
        pickImportFile();
        break;

      case 'sync-config':
        openSyncSheet();
        break;

      case 'sync-now':
        doSync({});
        break;

      case 'sync-off':
        askConfirm({
          title: '关闭云同步？',
          message: '这台设备将恢复为只存本机。云端数据不会被删除，之后重新填配置就能连回来。',
          confirmText: '关闭'
        }).then(function (yes) {
          if (!yes) return;
          DB.setSyncConfig({ url: '', key: '', room: '' });
          toast('已关闭同步');
          render({ keepScroll: true });
        });
        break;

      case 'clear-all':
        askConfirm({
          title: '清空全部数据？',
          message: '所有客户和记账记录都会被删除，无法恢复。建议先导出一份备份。',
          confirmText: '继续'
        }).then(function (yes) {
          if (!yes) return;
          return askConfirm({
            title: '再确认一次',
            message: '确定要清空吗？这个操作不可撤销。',
            confirmText: '确定清空',
            danger: true
          }).then(function (yes2) {
            if (!yes2) return;
            DB.clearAll();
            toast('已清空');
            go('#/');
            render();
          });
        });
        break;
    }
  });

  // 搜索：只刷新列表，避免输入框失焦
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || el.id !== 'search-input') return;
    ui.search = el.value;
    refreshCustomerList();
  });

  function refreshCustomerList() {
    var container = document.getElementById('cust-list');
    if (!container) return;
    var customers = DB.customers();
    var txns = DB.txns();
    var balances = C.balanceMap(customers, txns);
    var lastActive = C.lastActivityMap(txns);
    var counts = C.countMap(txns);
    var filtered = sortCustomers(C.searchCustomers(customers, ui.search), balances, lastActive);
    container.innerHTML = customerListHTML(filtered, balances, lastActive, counts);
  }

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.id) return;
    if (el.id === 'set-room') {
      DB.setSetting('roomName', el.value);
      toast('已保存');
    }
    if (el.id === 'set-operator') {
      DB.setSetting('operator', el.value.trim());
      toast('已保存');
    }
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'n' && parseRoute().view === 'home' && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      openCustomerSheet(null);
    }
  });

  window.addEventListener('hashchange', function () {
    render();
  });

  /* ================================================================ 备份提醒 */

  function shouldWarnBackup() {
    var st = DB.state();
    if (!DB.txns().length) return false;
    var last = st.defaults.lastBackupAt;
    if (!last) return true;
    return C.daysBetween(C.dayKey(last), C.dayKey(C.nowStamp())) >= 7;
  }

  /* ================================================================ 启动 */

  DB.init();

  // 任何写操作都自动挂上「稍后同步」
  ['addCustomer', 'updateCustomer', 'deleteCustomer', 'addTxn', 'updateTxn', 'setVoid', 'deleteTxn', 'clearAll', 'seedDemo', 'importJSON'].forEach(function (name) {
    var orig = DB[name];
    DB[name] = function () {
      var res = orig.apply(DB, arguments);
      if (!res || res.ok !== false) scheduleSync();
      return res;
    };
  });

  if (!DB.customers().length && /[?&]demo=1\b/.test(location.search)) {
    DB.seedDemo();
  }

  render();

  // 已配置云同步的话，启动时先拉一次最新的
  if (DB.syncEnabled()) {
    setTimeout(function () { doSync({ silent: true }); }, 100);
  }
})();
