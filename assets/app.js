/*!
 * 谷子账本 · 界面层
 * 单页应用，hash 路由：#/ 首页 · #/c/<id> 客户详情 · #/report 报表 · #/settings 设置
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
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V8"/><path d="M7 12l5-5 5 5"/><path d="M4 4h16"/></svg>'
  };

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

    // 算式溢出时加渐隐遮罩，提示还能横向滑动
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

    var filtered = C.searchCustomers(customers, ui.search);
    filtered.sort(function (a, b) {
      if (ui.sort === 'balance') return (balances[b.id] || 0) - (balances[a.id] || 0);
      if (ui.sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      return String(lastActive[b.id] || '').localeCompare(String(lastActive[a.id] || ''));
    });

    var staleBackup = shouldWarnBackup();

    var html = '<div class="shell">';

    html +=
      '<header class="topbar">' +
      '<div class="brand"><span class="brand-mark">谷</span>谷子账本</div>' +
      '<div class="brand-sub">' + esc(st.roomName) + '</div>' +
      '<div class="topbar-spacer"></div>' +
      '<button class="icon-btn" data-act="new-customer" title="添加客户">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
      '</button>' +
      '</header>';

    html +=
      '<section class="hero">' +
      '<div class="hero-label">未兑付余额合计</div>' +
      '<div class="hero-value num"><span class="unit">' + (total < 0 ? '−¥' : '¥') + '</span>' + C.formatCents(Math.abs(total)) + '</div>' +
      '<div class="hero-meta">' +
      '<span><b>' + customers.length + '</b> 位客户</span>' +
      '<span>本月净变动 <b class="' + (monthSum.net > 0 ? 'up' : monthSum.net < 0 ? 'down' : '') + '">' + signed(monthSum.net) + '</b></span>' +
      '<span>今日 ' + (todaySum.net === 0 ? '无变动' : '<b class="' + (todaySum.net > 0 ? 'up' : 'down') + '">' + signed(todaySum.net) + '</b>') + '</span>' +
      '</div>' +
      '</section>';

    if (staleBackup) {
      html +=
        '<div class="search-wrap" style="margin-top:12px">' +
        '<div class="notice">' +
        '<span>💾</span><span><strong>建议做一次备份。</strong>数据只存在当前浏览器里，清除缓存或换设备会丢失。到「设置」导出备份文件即可。</span>' +
        '</div></div>';
    }

    if (!customers.length) {
      html +=
        '<div class="empty">' +
        '<div class="empty-icon">🗂️</div>' +
        '<h3>还没有客户</h3>' +
        '<p>先添加第一位客户，之后每笔存入、消费、寄售售出都记在这个人名下，余额会自动累计。</p>' +
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
      '<span class="sub">' +
      segButtons('sort', ui.sort, [
        ['recent', '最近'], ['balance', '余额'], ['name', '名称']
      ]) +
      '</span></div>';

    html += '<div class="cust-list" id="cust-list">' + customerListHTML(filtered, balances, lastActive, counts) + '</div>';

    html += bottomNav('home');
    html += '</div>';
    return html;
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
      var meta = count ? count + ' 笔记录 · 最近 ' + C.humanDay(C.dayKey(last), false) : '还没有记录';
      return (
        '<a class="cust-card" href="#/c/' + encodeURIComponent(c.id) + '">' +
        '<div class="avatar ' + avatarClass(c.name) + '">' + esc(C.initialOf(c.name)) + '</div>' +
        '<div class="cust-main">' +
        '<div class="cust-name">' + esc(c.name) +
        (bal < 0 ? '<span class="badge badge--warn">透支</span>' : '') +
        (bal === 0 && count > 0 ? '<span class="badge">已清零</span>' : '') +
        '</div>' +
        '<div class="cust-meta">' + esc(meta) + (c.phone ? ' · ' + esc(c.phone) : '') + '</div>' +
        '</div>' +
        '<div class="cust-right">' +
        '<div class="cust-balance num ' + balanceClass(bal) + '">' + money(bal) + '</div>' +
        '<div class="cust-tag">' + (bal > 0 ? '可用余额' : bal < 0 ? '需补款' : '—') + '</div>' +
        '</div>' +
        '</a>'
      );
    }).join('');
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
    var shelf = C.shelfOf(txns);

    var html = '<div class="shell shell--with-actions">';
    html += topbarBack(c.name, '<button class="icon-btn" data-act="cust-menu" data-id="' + esc(c.id) + '">' + ICON.more + '</button>');

    // 余额概览
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
      '<div class="mini-stat"><dt>累计存入</dt><dd class="plus">' + money(sum.deposit) + '</dd></div>' +
      '<div class="mini-stat"><dt>累计消费</dt><dd class="minus">' + money(sum.purchase) + '</dd></div>' +
      '<div class="mini-stat"><dt>寄售回款</dt><dd class="plus">' + money(sum.sale) + '</dd></div>' +
      '</dl>' +
      '</section>';

    // 算式
    html += equationCard(txns, c.id);

    // 在售
    if (shelf.length) {
      html +=
        '<section class="card shelf">' +
        '<div class="shelf-head">在售寄售 <span class="count">' + shelf.length + '</span>' +
        '<span style="margin-left:auto;font-size:11.5px;font-weight:500;color:var(--muted)">卖出后自动入账</span></div>' +
        shelf.map(function (item) {
          return (
            '<div class="shelf-item">' +
            '<div class="shelf-item-main">' +
            '<div class="shelf-item-name">' + esc(item.itemName || '未命名谷子') +
            (item.category ? ' <span class="badge">' + esc(item.category) + '</span>' : '') + '</div>' +
            '<div class="shelf-item-meta">' + C.humanDay(C.dayKey(item.at), false) + ' 抽到 · 定价 ' + money(item.price) + '</div>' +
            '</div>' +
            '<span class="shelf-price num">' + money(item.price) + '</span>' +
            '<button class="btn btn--sm btn--primary" data-act="sell" data-id="' + esc(item.id) + '">卖出</button>' +
            '</div>'
          );
        }).join('') +
        '</section>';
    }

    // 时间轴
    html +=
      '<div class="section-head" style="margin-top:20px">' +
      '<span>账目明细</span>' +
      '<span class="sub">' + segButtons('group', ui.group, [['day', '按日'], ['month', '按月'], ['year', '按年']]) + '</span>' +
      '</div>';

    var groups = C.groupsOf(txns, ui.group, C.nowStamp());
    if (!groups.length) {
      html +=
        '<div class="empty" style="padding:36px 20px">' +
        '<div class="empty-icon">📒</div><h3>还没有任何账目</h3>' +
        '<p>下面是记账按钮，先记一笔存入吧。</p></div>';
    } else {
      html += '<div class="timeline">' + groups.map(groupHTML).join('') + '</div>';
    }

    // 底部操作条
    html +=
      '<div class="action-bar"><div class="action-grid">' +
      actionBtn('deposit', '存入', '+', 'plus') +
      actionBtn('purchase', '消费', '−', 'minus') +
      actionBtn('sale', '售出', '¥', 'sale') +
      actionBtn('adjust', '调整', '±', '') +
      '</div></div>';

    html += '</div>';
    return html;

    function actionBtn(kind, label, ico, tone) {
      return (
        '<button class="action-btn" data-tone="' + tone + '" data-act="new-txn" data-kind="' + kind + '" data-cid="' + esc(c.id) + '">' +
        '<span class="ico">' + ico + '</span><span>' + label + '</span></button>'
      );
    }
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
    var tone = t.amount > 0 ? 'plus' : t.amount < 0 ? 'minus' : 'adjust';
    var info = describeTxn(t);
    var metaParts = [];
    var sameYear = C.yearKey(t.at) === C.yearKey(C.nowStamp());
    if (ui.group === 'day') metaParts.push(C.humanTime(t.at));
    else metaParts.push(C.humanDay(C.dayKey(t.at), !sameYear) + ' ' + C.humanTime(t.at));
    if (t.operator) metaParts.push('经手 ' + esc(t.operator));
    if (info.extraNote) metaParts.push(esc(info.extraNote));

    return (
      '<button class="tx' + (t.voided ? ' is-void' : '') + '" data-act="edit-txn" data-id="' + esc(t.id) + '">' +
      '<span class="tx-sign ' + tone + '">' + signed(t.amount) + '</span>' +
      '<span class="tx-main">' +
      '<span class="tx-title">' +
      (info.kindLabel ? '<span class="kind">' + esc(info.kindLabel) + '</span>' : '') +
      '<span class="item">' + esc(info.main) + '</span>' +
      (t.voided ? ' <span class="badge badge--warn">已作废</span>' : '') +
      '</span>' +
      '<span class="tx-meta">' +
      (info.tag ? '<span>' + esc(info.tag) + '</span><span class="dot">·</span>' : '') +
      metaParts.join('<span class="dot">·</span>') +
      '</span>' +
      '</span>' +
      '<span class="tx-bal">' + (t.running === null || t.running === undefined ? '' : '<i>余</i>' + C.formatCents(t.running)) + '</span>' +
      '</button>'
    );
  }

  function describeTxn(t) {
    var kindLabel = (C.KINDS[t.kind] || {}).label || '记录';
    if (t.kind === 'purchase') {
      var bits = [];
      if (t.category) bits.push(t.category);
      if (t.disposition === 'consign') bits.push('寄售 ¥' + C.formatCents(t.consignPrice));
      else if (t.disposition === 'ship') bits.push('寄走');
      return {
        main: t.itemName || '抽谷消费',
        kindLabel: kindLabel,
        tag: bits.join(' · '),
        extraNote: t.note
      };
    }
    if (t.kind === 'sale') {
      return {
        main: t.itemName || '寄售商品',
        kindLabel: '售出',
        tag: '',
        extraNote: t.note
      };
    }
    if (t.kind === 'deposit') {
      return { main: '存入', kindLabel: '', tag: t.note, extraNote: '' };
    }
    return { main: '手动调整', kindLabel: '', tag: t.note, extraNote: '' };
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
        '<div class="eq-hint" style="padding-top:2px">还没有记录，每笔存入 / 消费都会出现在这个式子里。</div>' +
        '</section>';
    }

    var LIMIT = 9;
    var expanded = !!ui.eqExpanded[custId];
    var collapsed = !expanded && terms.length > LIMIT;

    var pieces = [];
    if (collapsed) {
      pieces = terms.slice(0, 4).map(function (t) { return termHTML(t); });
      pieces.push('<span class="eq-gap">⋯ ' + (terms.length - 8) + ' 笔 ⋯</span>');
      pieces = pieces.concat(terms.slice(-4).map(function (t) { return termHTML(t); }));
    } else {
      pieces = terms.map(function (t) { return termHTML(t); });
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
      '</div>' +
      '</div>' +
      hint +
      '</section>'
    );
  }

  function termHTML(t) {
    var cls = t.amount > 0 ? 'plus' : t.amount < 0 ? 'minus' : 'plus';
    return '<span class="eq-term ' + cls + '">' + t.text + '</span>';
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
      '<button class="icon-btn" data-act="export-csv" title="导出流水">' + ICON.download + '</button>' +
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
      kpi('期间净变动', signed(sum.net), sum.net >= 0 ? 'plus' : 'minus', range.label + ' · ' + sum.count + ' 笔') +
      kpi('存入', money(sum.deposit), 'plus', '顾客充值进账') +
      kpi('消费', money(sum.purchase), 'minus', '抽谷扣款') +
      '</div>';

    // 每日对账
    html += '<div class="section-head" style="margin-top:20px"><span>每日对账</span><span class="sub">期末余额 = 期初 + 当日净变动</span></div>';
    html +=
      '<section class="card" style="overflow:hidden">' +
      '<div class="table-scroll"><table class="report-table">' +
      '<thead><tr><th>日期</th><th>存入</th><th>消费</th><th>售出</th><th>净变动</th><th>期末余额</th></tr></thead>' +
      '<tbody>' +
      (series.opening !== 0 || range.key !== 'all'
        ? '<tr><td class="muted">期初</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">' + C.formatCents(series.opening) + '</td></tr>'
        : '') +
      series.days.map(function (d) {
        return '<tr>' +
          '<td>' + C.humanDay(d.day, C.yearKey(d.day) !== C.yearKey(C.nowStamp())) + '</td>' +
          '<td class="' + (d.deposit ? 'plus' : 'muted') + '">' + (d.deposit ? C.formatCents(d.deposit) : '—') + '</td>' +
          '<td class="' + (d.purchase ? 'minus' : 'muted') + '">' + (d.purchase ? C.formatCents(d.purchase) : '—') + '</td>' +
          '<td class="' + (d.sale ? 'plus' : 'muted') + '">' + (d.sale ? C.formatCents(d.sale) : '—') + '</td>' +
          '<td class="' + (d.net > 0 ? 'plus' : d.net < 0 ? 'minus' : 'muted') + '">' + (d.net ? signed(d.net) : '—') + '</td>' +
          '<td><b>' + C.formatCents(d.ending) + '</b></td>' +
          '</tr>';
      }).join('') +
      (series.days.length ? '' : '<tr><td colspan="6" class="muted" style="text-align:center;padding:22px">这段时间没有流水</td></tr>') +
      '</tbody></table></div>' +
      '<div class="report-foot"><span>' + esc(range.label) + '合计</span><span>存入 ' + C.formatCents(sum.deposit) + ' · 消费 ' + C.formatCents(sum.purchase) + ' · 售出 ' + C.formatCents(sum.sale) + '</span></div>' +
      '</section>';

    // 客户余额
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
    html +=
      '<header class="topbar"><div class="brand"><span class="brand-mark">谷</span>设置</div></header>';

    html +=
      '<div class="section-head"><span>直播间信息</span></div>' +
      '<section class="card">' +
      '<div class="set-row"><div><div class="set-label">直播间名称</div><div class="set-hint">显示在首页顶部</div></div>' +
      '<input type="text" id="set-room" value="' + esc(st.roomName) + '" placeholder="谷子直播间"></div>' +
      '<div class="set-row"><div><div class="set-label">常用经手人</div><div class="set-hint">记账时默认填入，可临时修改</div></div>' +
      '<input type="text" id="set-operator" value="' + esc(st.defaults.operator || '') + '" placeholder="例如：小影"></div>' +
      '</section>';

    html +=
      '<div class="section-head" style="margin-top:20px"><span>数据</span><span class="sub">共 ' + s.customers + ' 位客户 · ' + s.txns + ' 笔流水</span></div>' +
      '<section class="card">' +
      '<div class="set-row"><div><div class="set-label">备份数据</div><div class="set-hint">导出 JSON 文件，换手机或清缓存后可还原</div></div>' +
      '<button class="btn btn--sm btn--primary" data-act="export-json">导出</button></div>' +
      '<div class="set-row"><div><div class="set-label">恢复数据</div><div class="set-hint">从备份文件导入，可选择覆盖或合并</div></div>' +
      '<button class="btn btn--sm btn--ghost" data-act="import-json">导入</button></div>' +
      '<div class="set-row"><div><div class="set-label">导出流水表</div><div class="set-hint">CSV 格式，可直接用 Excel / WPS 打开</div></div>' +
      '<button class="btn btn--sm btn--ghost" data-act="export-csv">导出</button></div>' +
      '</section>';

    html +=
      '<div class="section-head" style="margin-top:20px"><span>危险操作</span></div>' +
      '<section class="card">' +
      '<div class="set-row"><div><div class="set-label">清空全部数据</div><div class="set-hint">删除所有客户与流水，不可恢复</div></div>' +
      '<button class="btn btn--sm btn--danger" data-act="clear-all">清空</button></div>' +
      '</section>';

    html +=
      '<div class="section-head" style="margin-top:20px"><span>关于</span></div>' +
      '<section class="card" style="padding:16px">' +
      '<div class="notice" style="background:var(--paper-2);color:var(--ink-2)">' +
      '<span>📌</span><span><strong>数据保存在本机浏览器。</strong>换设备、换浏览器或清除网站数据都会看不到旧账，请定期用上面的「导出」做备份。' +
      (s.voided ? '<br>当前有 ' + s.voided + ' 笔作废记录，仍保留在明细中但不计入余额。' : '') +
      '<br>数据体积约 ' + kb + ' KB。</span>' +
      '</div>' +
      '<div class="hr"></div>' +
      '<div class="row-between small muted"><span>谷子账本 · 直播间储值记账</span><span>v1.0</span></div>' +
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
      '<button type="button" class="sheet-close" data-close>✕</button></div>' +
      '<div class="sheet-body">' +
      '<form id="sheet-form" novalidate>' +
      '<div class="form-error" id="form-error"></div>' +
      opts.body +
      '<div class="sheet-actions">' +
      (opts.cancelText ? '<button type="button" class="btn btn--ghost" data-close>' + esc(opts.cancelText) + '</button>' : '') +
      '<button type="submit" class="btn ' + (opts.tone || 'btn--primary') + '">' + esc(opts.submitLabel || '保存') + '</button>' +
      '</div>' +
      '</form></div></div>';

    document.body.appendChild(dlg);
    openDialogEl = dlg;

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');

    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) closeSheet();
      if (e.target.closest('[data-close]')) closeSheet();
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
        return;
      }
      // onSubmit 里可能已经打开了另一个弹层，不能用引用判断失败
      if (openDialogEl === dlg) closeSheet();
    });

    if (opts.afterOpen) opts.afterOpen(form, dlg);

    var firstInput = form.querySelector('input:not([type=hidden]):not([type=file])');
    if (firstInput && window.matchMedia('(min-width: 640px)').matches) {
      setTimeout(function () { firstInput.focus(); }, 60);
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
    return '<input type="text" name="' + name + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" ' + (extra || '') + '>';
  }

  function amountField(value, placeholder, name) {
    return (
      '<div class="amount-field">' +
      '<span class="prefix">¥</span>' +
      '<input type="text" name="' + (name || 'amount') + '" inputmode="decimal" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '0') + '" autocomplete="off">' +
      '</div>'
    );
  }

  function datetimeField(value) {
    return '<input type="datetime-local" name="at" value="' + esc(value || C.nowStamp()) + '" step="60">';
  }

  function operatorField(value) {
    var def = DB.state().defaults.operator || '';
    return textInput('operator', value === undefined ? def : value, '谁经手的（可不填）');
  }

  function categoryChips(selected) {
    return (
      '<input type="hidden" name="category" value="' + esc(selected || '') + '">' +
      '<div class="chips" data-chips="category">' +
      C.CATEGORIES.map(function (cat) {
        return '<button type="button" class="chip' + (selected === cat ? ' is-on' : '') + '" data-value="' + esc(cat) + '">' + esc(cat) + '</button>';
      }).join('') +
      '</div>'
    );
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
        field('客户名称', textInput('name', c.name, '昵称、微信名或会员号', 'autocapitalize="off"'), { required: true }) +
        field('手机号', textInput('phone', c.phone, '选填', 'inputmode="tel"'), { hint: '选填' }) +
        field('备注', '<textarea name="note" placeholder="选填，例如：喜欢吧唧 / 朋友介绍">' + esc(c.note) + '</textarea>', { hint: '选填' }),
      onSubmit: function (form) {
        var fd = new FormData(form);
        var payload = {
          name: String(fd.get('name') || '').trim(),
          phone: String(fd.get('phone') || '').trim(),
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
          toast('已添加客户');
          go('#/c/' + encodeURIComponent(res.customer.id));
        }
        return null;
      }
    });
  }

  /* ================================================================ 记账弹层 */

  function openTxnSheet(opts) {
    var kind = opts.kind;
    var customerId = opts.customerId;
    var customer = DB.customer(customerId);
    if (!customer) return;

    var editing = opts.txn || null;
    var t = editing || {};

    var titles = {
      deposit: editing ? '编辑存入' : '记一笔存入',
      purchase: editing ? '编辑消费' : '记一笔消费',
      sale: editing ? '编辑售出' : '记一笔寄售售出',
      adjust: editing ? '编辑调整' : '手动调整'
    };
    var tones = { deposit: 'btn--plus', purchase: 'btn--minus', sale: 'btn--primary', adjust: 'btn--primary' };

    var timeLabel = '现在 ' + C.humanTime(C.nowStamp());
    if (editing) {
      timeLabel = C.humanDay(C.dayKey(t.at), C.yearKey(t.at) !== C.yearKey(C.nowStamp())) + ' ' + C.humanTime(t.at);
    }

    // 时间 / 经手人 / 备注默认收起，记账时更快；编辑已有记录时默认展开
    function moreFields(inner) {
      return (
        '<details class="more"' + (editing ? ' open' : '') + '>' +
        '<summary><span>时间与备注</span>' +
        '<span class="more-hint">' + esc(timeLabel) + '</span>' +
        '<span class="caret">⌄</span></summary>' +
        inner +
        '</details>'
      );
    }

    var body = '';

    if (kind === 'deposit') {
      body +=
        field('存入金额', amountField(editing ? C.formatCents(Math.abs(t.amount)) : '', '0.00'), { required: true }) +
        '<div class="quick-amounts">' +
        [50, 100, 200, 500, 1000].map(function (v) {
          return '<button type="button" class="chip" data-quick="' + v + '">' + v + ' 元</button>';
        }).join('') +
        '</div>' +
        moreFields(
          field('来源 / 备注', textInput('note', t.note, '例如：微信转账、支付宝、现金'), { hint: '选填' }) +
          field('时间', datetimeField(editing ? t.at : ''), { required: true }) +
          field('经手人', operatorField(t.operator))
        );
    }

    if (kind === 'purchase') {
      var currentAmount = editing ? C.formatCents(Math.abs(t.amount)) : '';
      body +=
        field('消费金额', amountField(currentAmount, '0.00'), { required: true }) +
        field('商品名称', textInput('itemName', t.itemName, '例如：《星穹》吧唧 · 银狼'), { hint: '选填' }) +
        field('制品类型', categoryChips(t.category), { hint: '选填' }) +
        field('抽到的谷子怎么处理',
          '<input type="hidden" name="disposition" value="' + esc(t.disposition || 'ship') + '">' +
          '<div class="chips" data-chips="disposition">' +
          '<button type="button" class="chip' + (!t.disposition || t.disposition === 'ship' ? ' is-on' : '') + '" data-value="ship">寄走</button>' +
          '<button type="button" class="chip' + (t.disposition === 'consign' ? ' is-on' : '') + '" data-value="consign">寄售</button>' +
          '</div>',
          { hint: '寄售会挂到「在售」' }) +
        '<div id="consign-wrap" style="' + (t.disposition === 'consign' ? '' : 'display:none') + '">' +
        field('寄售定价', amountField(editing && t.consignPrice ? C.formatCents(t.consignPrice) : '', '0', 'consignPrice'), { hint: '卖出后按实际成交价入账' }) +
        '</div>' +
        moreFields(
          field('备注', textInput('note', t.note, '例如：客户指定款'), { hint: '选填' }) +
          field('时间', datetimeField(editing ? t.at : ''), { required: true }) +
          field('经手人', operatorField(t.operator))
        );
    }

    if (kind === 'sale') {
      var shelf = C.shelfOf(DB.txnsOf(customerId));
      var preset = opts.saleOf ? shelf.find(function (s) { return s.id === opts.saleOf; }) : null;

      if (!editing && shelf.length) {
        body +=
          '<div class="field"><div class="field-label"><span>从在售货架选择</span></div>' +
          '<select name="saleOf">' +
          '<option value="">不关联（直接记一笔收入）</option>' +
          shelf.map(function (s) {
            return '<option value="' + esc(s.id) + '" data-price="' + s.price + '" data-name="' + esc(s.itemName) + '" data-category="' + esc(s.category) + '"' +
              (preset && preset.id === s.id ? ' selected' : '') + '>' +
              esc(s.itemName || '未命名谷子') + ' · 定价 ' + C.formatCents(s.price) + '</option>';
          }).join('') +
          '</select></div>';
      }

      body +=
        field('成交金额', amountField(editing ? C.formatCents(Math.abs(t.amount)) : (preset ? C.formatCents(preset.price) : ''), '0.00'), { required: true }) +
        field('商品名称', textInput('itemName', editing ? t.itemName : (preset ? preset.itemName : ''), '卖的哪件谷子'), { hint: '选填' }) +
        moreFields(
          field('备注', textInput('note', t.note, '例如：直播间卖出 / 私聊成交'), { hint: '选填' }) +
          field('时间', datetimeField(editing ? t.at : ''), { required: true }) +
          field('经手人', operatorField(t.operator))
        );

      if (!editing && !shelf.length) {
        body =
          '<div class="notice" style="margin-bottom:15px"><span>ℹ️</span><span>该客户目前没有在售的寄售品。可以直接记一笔寄售收入，也可以先到消费里把商品设为「寄售」。</span></div>' + body;
      }
    }

    if (kind === 'adjust') {
      var isNeg = editing ? t.amount < 0 : false;
      body +=
        field('调整方向',
          '<input type="hidden" name="direction" value="' + (isNeg ? 'minus' : 'plus') + '">' +
          '<div class="chips" data-chips="direction">' +
          '<button type="button" class="chip' + (!isNeg ? ' is-on' : '') + '" data-value="plus">增加余额</button>' +
          '<button type="button" class="chip' + (isNeg ? ' is-on' : '') + '" data-value="minus">减少余额</button>' +
          '</div>') +
        field('金额', amountField(editing ? C.formatCents(Math.abs(t.amount)) : '', '0.00'), { required: true }) +
        field('调整原因', textInput('note', t.note, '例如：活动补差、退单更正'), { required: true }) +
        moreFields(
          field('时间', datetimeField(editing ? t.at : ''), { required: true }) +
          field('经手人', operatorField(t.operator))
        );
    }

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
      title: titles[kind],
      submitLabel: editing ? '保存修改' : '记入账目',
      cancelText: '取消',
      tone: tones[kind],
      body: body,
      afterOpen: function (form) {
        bindChips(form);
        var dispChips = form.querySelector('[data-chips="disposition"]');
        if (dispChips) {
          dispChips.addEventListener('click', function (e) {
            var btn = e.target.closest('.chip');
            if (!btn) return;
            var wrap = form.querySelector('#consign-wrap');
            if (wrap) wrap.style.display = btn.dataset.value === 'consign' ? '' : 'none';
          });
        }
        var saleSel = form.querySelector('select[name="saleOf"]');
        if (saleSel) {
          saleSel.addEventListener('change', function () {
            var opt = saleSel.options[saleSel.selectedIndex];
            if (!opt || !opt.value) return;
            var price = opt.dataset.price;
            var amountInput = form.querySelector('input[name="amount"]');
            var nameInput = form.querySelector('input[name="itemName"]');
            if (amountInput && price) amountInput.value = C.formatCents(+price);
            if (nameInput) nameInput.value = opt.dataset.name || '';
          });
        }
        Array.prototype.forEach.call(form.querySelectorAll('[data-quick]'), function (btn) {
          btn.addEventListener('click', function () {
            var amountInput = form.querySelector('input[name="amount"]');
            if (amountInput) {
              amountInput.value = btn.dataset.quick;
              amountInput.focus();
            }
          });
        });
      },
      onSubmit: function (form) {
        var fd = new FormData(form);
        var amountRaw = String(fd.get('amount') || '').trim();
        var cents = C.parseAmountToCents(amountRaw);
        if (cents === null) return '请输入正确的金额';
        if (!cents) return '金额不能为 0';

        var at = C.normStamp(fd.get('at'));
        if (!at) return '请选择时间';

        var payload = {
          customerId: customerId,
          kind: kind,
          amount: Math.abs(cents),
          at: at,
          note: String(fd.get('note') || '').trim(),
          operator: String(fd.get('operator') || '').trim()
        };

        if (kind === 'purchase') {
          payload.itemName = String(fd.get('itemName') || '').trim();
          payload.category = String(fd.get('category') || '').trim();
          payload.disposition = String(fd.get('disposition') || '');
          if (payload.disposition === 'consign') {
            var cp = C.parseAmountToCents(String(fd.get('consignPrice') || '').trim());
            if (!cp) return '选择寄售时请填写寄售价';
            payload.consignPrice = cp;
          }
        }
        if (kind === 'sale') {
          payload.itemName = String(fd.get('itemName') || '').trim();
          var saleOf = String(fd.get('saleOf') || '');
          if (saleOf) payload.saleOf = saleOf;
        }
        if (kind === 'adjust') {
          payload.negative = String(fd.get('direction') || 'plus') === 'minus';
          if (!payload.note) return '请填写调整原因';
        }

        var result;
        if (editing) {
          delete payload.customerId;
          delete payload.kind;
          result = DB.updateTxn(t.id, payload);
        } else {
          result = DB.addTxn(payload);
        }
        if (!result.ok) return result.error;

        toast(editing ? '已保存修改' : '已记入账目');
        render({ keepScroll: true });
        return null;
      }
    });
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

  /* ================================================================ 客户菜单 */

  function openCustomerMenu(id) {
    var c = DB.customer(id);
    if (!c) return;
    var txns = DB.txnsOf(id);
    var balance = C.balanceOf(txns);

    openSheet({
      title: c.name,
      submitLabel: '编辑资料',
      body:
        '<div class="notice" style="margin-bottom:16px"><span>💰</span><span>当前余额 <strong>' + money(balance) + '</strong>，共 ' + txns.length + ' 笔记录。</span></div>' +
        '<div class="sheet-actions" style="margin-top:0">' +
        '<button type="button" class="btn btn--ghost" data-act="delete-customer" data-id="' + esc(c.id) + '">删除客户</button>' +
        '</div>',
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
    }, 120);
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

    var rows = [['时间', '客户', '类型', '金额', '商品', '制品类型', '处置', '经手人', '备注', '发生后的余额']];
    var balances = C.balanceMap(customers, DB.txns());
    txns.forEach(function (t) {
      rows.push([
        t.at.replace('T', ' '),
        nameById[t.customerId] || '',
        (C.KINDS[t.kind] || {}).label || t.kind,
        C.formatCents(t.amount),
        t.itemName,
        t.category,
        t.disposition === 'consign' ? '寄售 ' + C.formatCents(t.consignPrice) : (C.DISPOSITIONS[t.disposition] || ''),
        t.operator,
        t.note,
        ''
      ]);
    });
    // 逐客户回填「发生后的余额」
    var running = {};
    var idx = 1;
    txns.forEach(function (t) {
      running[t.customerId] = (running[t.customerId] || 0) + t.amount;
      rows[idx][9] = C.formatCents(running[t.customerId]);
      idx += 1;
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
          submitLabel: '覆盖导入',
          cancelText: '取消',
          body:
            '<div class="notice" style="margin-bottom:16px"><span>⚠️</span><span>文件里有 ' + counts + '。<br><strong>覆盖</strong>会清掉当前全部数据；<strong>合并</strong>会保留现有数据并追加。</span></div>' +
            '<div class="chips" data-chips="mode">' +
            '<button type="button" class="chip is-on" data-value="merge">合并（保留现有）</button>' +
            '<button type="button" class="chip" data-value="replace">覆盖（清空现有）</button>' +
            '</div>' +
            '<input type="hidden" name="mode" value="merge">',
          afterOpen: bindChips,
          onSubmit: function (form) {
            var mode = form.querySelector('input[name="mode"]').value || 'merge';
            if (mode === 'replace') {
              if (!window.confirm('确定要用备份文件覆盖当前全部数据吗？此操作不可撤销。')) return '已取消';
            }
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

      case 'edit-customer':
        openCustomerSheet(DB.customer(id));
        break;

      case 'delete-customer':
        if (!window.confirm('确定删除该客户？其全部流水会一并删除，不可恢复。')) break;
        DB.deleteCustomer(id);
        closeSheet();
        toast('已删除客户');
        go('#/');
        render();
        break;

      case 'new-txn':
        openTxnSheet({
          kind: target.getAttribute('data-kind'),
          customerId: target.getAttribute('data-cid')
        });
        break;

      case 'sell':
        openTxnSheet({
          kind: 'sale',
          customerId: parseRoute().id,
          saleOf: id
        });
        break;

      case 'edit-txn':
        var txn = DB.txn(id);
        if (txn) openTxnSheet({ kind: txn.kind, customerId: txn.customerId, txn: txn });
        break;

      case 'toggle-void':
        var cur = DB.txn(id);
        if (!cur) break;
        DB.setVoid(id, !cur.voided);
        toast(cur.voided ? '已恢复该记录' : '已作废该记录');
        closeSheet();
        render({ keepScroll: true });
        break;

      case 'delete-txn':
        if (!window.confirm('确定永久删除这条流水？')) break;
        DB.deleteTxn(id);
        toast('已删除');
        closeSheet();
        render({ keepScroll: true });
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
        if (!window.confirm('载入示例数据用于体验？会覆盖当前全部数据。')) break;
        DB.seedDemo();
        toast('已载入示例数据');
        go('#/');
        render();
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

      case 'clear-all':
        if (!window.confirm('确定清空全部客户和流水？建议先导出备份。')) break;
        if (!window.confirm('再确认一次：此操作不可恢复。')) break;
        DB.clearAll();
        toast('已清空');
        go('#/');
        render();
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
    var filtered = C.searchCustomers(customers, ui.search);
    filtered.sort(function (a, b) {
      if (ui.sort === 'balance') return (balances[b.id] || 0) - (balances[a.id] || 0);
      if (ui.sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      return String(lastActive[b.id] || '').localeCompare(String(lastActive[a.id] || ''));
    });
    container.innerHTML = customerListHTML(filtered, balances, lastActive, counts);
  }

  // 设置页输入
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

  // 键盘快捷键：n 新建客户
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
    if (openDialogEl) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'n' && parseRoute().view === 'home') {
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
    var last = st.defaults.lastBackupAt;
    if (!DB.txns().length) return false;
    if (!last) return true;
    return C.daysBetween(C.dayKey(last), C.dayKey(C.nowStamp())) >= 7;
  }

  /* ================================================================ 启动 */

  DB.init();

  // 首次访问且 ?demo=1 时载入示例
  if (!DB.customers().length && /[?&]demo=1\b/.test(location.search)) {
    DB.seedDemo();
  }

  render();
})();
