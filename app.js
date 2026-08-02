/* ============================================================
   安记 MVP v0.2 — Prototype
   纯前端、零依赖。数据存 localStorage（当前 session 持久）。
   仅实现三个核心页面：Home / Quick Log / Insight。
   规则分类，无 AI；无登录/支付/社交/投资；Goal 仅作可选展示，不造假进度。
   ============================================================ */

/* ---------- 分类规则（Rule-based） ---------- */
var CATEGORIES = [
  { key: 'food',      label: '餐饮', color: '#F2994A', keywords: ['餐','饭','外卖','咖啡','奶茶','美团','饿了么','星巴克','肯德基','麦当劳','食堂','小吃','火锅','烧烤','面包','饮料','餐厅','菜'] },
  { key: 'transport', label: '交通', color: '#2D9CDB', keywords: ['地铁','公交','打车','滴滴','加油','高铁','机票','停车','网约车','出租车','火车','车站'] },
  { key: 'shopping',  label: '购物', color: '#9B51E0', keywords: ['淘宝','京东','拼多多','超市','商场','服装','网购','天猫','便利店','买','商城'] },
  { key: 'home',      label: '居家', color: '#27AE60', keywords: ['房租','物业','水电','燃气','家居','清洁','维修','宽带','物业'] },
  { key: 'fun',       label: '娱乐', color: '#EB5757', keywords: ['电影','游戏','视频','会员','演出','健身','ktv','唱','旅游','景点','游乐'] },
  { key: 'medical',   label: '医疗', color: '#56CCF2', keywords: ['医院','药店','诊所','体检','医疗','药'] },
  { key: 'study',     label: '学习', color: '#BB6BD9', keywords: ['书','课程','培训','网课','学习','教育'] }
];
var DEFAULT_CAT = { key: 'other', label: '其他', color: '#9AA0A6', keywords: [] };

function classify(note) {
  var n = (note || '').toLowerCase();
  for (var i = 0; i < CATEGORIES.length; i++) {
    var cat = CATEGORIES[i];
    for (var j = 0; j < cat.keywords.length; j++) {
      if (n.indexOf(cat.keywords[j].toLowerCase()) !== -1) return cat;
    }
  }
  return DEFAULT_CAT;
}
function catByKey(key) {
  for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === key) return CATEGORIES[i];
  return DEFAULT_CAT;
}

/* ---------- 时间工具 ---------- */
function monthKey(d) {
  var y = d.getFullYear();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  return y + '-' + m;
}
function lastMonths(n) {
  var arr = [];
  var now = new Date();
  for (var i = n - 1; i >= 0; i--) {
    arr.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return arr;
}
function fmtDate(ts) {
  var d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function fmtMoney(n) {
  return '¥' + (Math.round(n * 100) / 100).toLocaleString('zh-CN');
}

/* ---------- 聚合（纯函数，可测） ---------- */
function sumByMonth(txns) {
  var map = {};
  for (var i = 0; i < txns.length; i++) {
    var k = monthKey(new Date(txns[i].createdAt));
    map[k] = (map[k] || 0) + txns[i].amount;
  }
  return map;
}
function sumByCategory(txns, mKey) {
  var map = {};
  for (var i = 0; i < txns.length; i++) {
    if (mKey && monthKey(new Date(txns[i].createdAt)) !== mKey) continue;
    var c = txns[i].category;
    map[c] = (map[c] || 0) + txns[i].amount;
  }
  return map;
}

/* ---------- 规则生成一句非评判式总结 ---------- */
function buildReview(txns) {
  if (!txns.length) return '记录几笔后，这里会生成一句非评判式的理解。';
  var mk = monthKey(new Date());
  var thisMonth = txns.filter(function (t) { return monthKey(new Date(t.createdAt)) === mk; });
  if (!thisMonth.length) return '这个月还没记录，随时记一笔就好。';
  var byCat = sumByCategory(thisMonth, mk);
  var entries = Object.keys(byCat).map(function (k) { return { key: k, v: byCat[k] }; });
  entries.sort(function (a, b) { return b.v - a.v; });
  var top = entries[0];
  var topLabel = catByKey(top.key).label;
  var total = entries.reduce(function (s, e) { return s + e.v; }, 0);
  var pct = Math.round((top.v / total) * 100);
  return '本月你在「' + topLabel + '」上花了 ' + fmtMoney(top.v) + '，占支出的 ' + pct +
    '%，是最大的支出方向。看清这一点，下一步怎么调整，由你决定。';
}

/* Node 测试导出（浏览器中忽略） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classify, catByKey, monthKey, lastMonths, sumByMonth, sumByCategory, buildReview, CATEGORIES, DEFAULT_CAT };
}

/* ============================================================
   以下为浏览器运行部分
   ============================================================ */
if (typeof window !== 'undefined') {
  // 版本化存储：发布新版时升级 VERSION 并清理旧版本数据，确保交付版不带历史测试数据
  var VERSION = 'v2';
  var STORAGE_TXN = 'anjie_txn_' + VERSION;
  var STORAGE_GOAL = 'anjie_goal_' + VERSION;
  // 聚合式复盘的意义标签（Iteration 06）：用户对「已聚合的消费群组」判断其含义，而非逐笔打标
  var AGG_TAGS = ['必需品','娱乐','放松','学习','一次性需求','社交','投资','其他'];

  /* ---------- 匿名埋点（仅交互事件，不含金额/备注等隐私） ---------- */
  var ANALYTICS_KEY = 'anjie_events_' + VERSION;
  var SESSION_KEY = 'anjie_sid_' + VERSION;

  // 发布重置：清除上一版本遗留数据（幂等，可重复执行，不影响当前版本）
  function clearLegacyData() {
    ['anjie_txn_v1', 'anjie_goal_v1', 'anjie_events_v1', 'anjie_sid_v1'].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }
  function getSessionId() {
    var sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }
  var SESSION_ID = getSessionId();
  function track(event, props) {
    try {
      var arr = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]');
      var rec = { ts: Date.now(), sid: SESSION_ID, event: event };
      if (props) for (var k in props) if (props.hasOwnProperty(k)) rec[k] = props[k];
      arr.push(rec);
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(arr));
      if (typeof renderDebug === 'function' && $('debug-panel') && !$('debug-panel').hidden) renderDebug();
    } catch (e) { /* 埋点失败不影响主流程 */ }
  }

  // 月度储蓄目标模型：
  //   targets: 已有目标名列表（可复用）
  //   monthlyGoal: 当前月份设定 { monthKey, targetName, goalAmount, income, confirmedAmount, closed }
  // 注：每笔记账不关联目标；收入与计入目标的金额均由用户月末主动确认，系统不自动把结余计入目标。
  // catTags: 按月存储已聚合群组的意义标签 { '2026-07': { food: '必需品' } }
  // rules: 用户自定义的可校正提醒规则 [{ id, category, type:'mom'|'cap', threshold, enabled }]
  var state = { txns: [], targets: [], monthlyGoal: null, catTags: {}, rules: [], amountStr: '', note: '', catKey: 'other', manualCat: false, logOpenAt: 0 };

  // 「我的记录」管理区模块状态（增量：查找 / 修改 / 删除）
  // recordsFilter：列表实时筛选条件；editId/editCatKey：编辑弹窗当前态；pendingDeleteId：删除确认待定项（闭包式暂存，不污染全局）
  var recordsFilter = { keyword: '', catKey: 'all', from: '', to: '' };
  var editId = null;
  var editCatKey = 'other';
  var pendingDeleteId = null;

  async function load() {
    clearLegacyData(); // 首次打开新版时清除旧版本测试数据，保证交付态为空白起点
    // 本地数据库（IndexedDB，兜底 localStorage）是本地操作的权威存储
    try { await LocalDB.migrateFromLocalStorage(); } catch (e) { /* 迁移失败不影响后续加载 */ }
    try { state.txns = await LocalDB.getAllTxns(); } catch (e) { state.txns = []; }
    try {
      var g = await LocalDB.getGoals();
      // 兼容旧结构 {name,amount,...}：忽略，不自动恢复为月度目标
      if (g && typeof g === 'object' && !g.name) {
        state.targets = Array.isArray(g.targets) ? g.targets : [];
        state.monthlyGoal = g.monthlyGoal || null;
        state.catTags = (g.catTags && typeof g.catTags === 'object') ? g.catTags : {};
        state.rules = Array.isArray(g.rules) ? g.rules : [];
      } else {
        state.targets = []; state.monthlyGoal = null; state.catTags = {}; state.rules = [];
      }
    } catch (e) { state.targets = []; state.monthlyGoal = null; }
  }
  function save() {
    var goalObj = { targets: state.targets, monthlyGoal: state.monthlyGoal, catTags: state.catTags, rules: state.rules };
    // 本地数据库（IndexedDB，失败自动降级 localStorage）——本地操作的权威存储
    if (typeof LocalDB !== 'undefined') {
      LocalDB.putTxns(state.txns).catch(function () {});
      LocalDB.saveGoals(goalObj).catch(function () {});
    }
    // 登录后增量推送到云端（fire-and-forget，但失败要给用户可见提示，避免"静默不落库"）
    if (typeof Cloud !== 'undefined' && Cloud.isLoggedIn()) {
      Cloud.pushTxns(state.txns)
        .then(function () { setSyncStatus(true); })
        .catch(function (e) {
          setSyncStatus(false, e && e.message);
          if (e && /登录已失效/.test(e.message || '')) { toast('⚠️ 登录已失效，请重新登录'); updateUserBar(); showAuth(true); }
          else { toast('⚠️ 云端同步失败，已存本地：' + (e && e.message || '')); }
        });
      Cloud.pushGoals(goalObj).catch(function () {});
    }
  }

  function $(id) { return document.getElementById(id); }

  /* ---------- 导航 ---------- */
  function navigate(view) {
    track('view', { view: view });
    ['home', 'log', 'insight'].forEach(function (v) {
      $('view-' + v).hidden = (v !== view);
    });
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.style.color = (b.getAttribute('data-view') === view) ? 'var(--accent)' : 'var(--sub)';
    });
    if (view === 'home') renderHome();
    if (view === 'insight') renderInsight();
    if (view === 'log') resetLog();
    window.scrollTo(0, 0);
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 1400);
  }

  /* ---------- Home ---------- */
  function renderHome() {
    var mk = monthKey(new Date());
    var byMonth = sumByMonth(state.txns);
    var thisTotal = byMonth[mk] || 0;

    $('home-month-total').textContent = fmtMoney(thisTotal);

    // 环比
    var months = lastMonths(2);
    var lastTotal = byMonth[months[0]] || 0;
    var delta = $('home-month-delta');
    if (lastTotal > 0) {
      var diff = thisTotal - lastTotal;
      var sign = diff >= 0 ? '比上月多 ' : '比上月少 ';
      delta.textContent = sign + fmtMoney(Math.abs(diff));
    } else {
      delta.textContent = '首次记录，暂无环比';
    }

    // 最近记录
    renderRecent('home-recent', state.txns.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 5));
    $('home-recent-empty').hidden = state.txns.length > 0;

    // 可选目标模块
    renderGoalCard();
  }

  function renderBars(containerId, byCat, total) {
    var c = $(containerId);
    c.innerHTML = '';
    var entries = Object.keys(byCat).map(function (k) { return { key: k, v: byCat[k] }; });
    entries.sort(function (a, b) { return b.v - a.v; });
    if (!entries.length) return;
    entries.forEach(function (e) {
      var cat = catByKey(e.key);
      var pct = total > 0 ? (e.v / total * 100) : 0;
      var row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML =
        '<span class="bar-label">' + cat.label + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + cat.color + '"></span></span>' +
        '<span class="bar-val">' + fmtMoney(e.v) + '</span>';
      c.appendChild(row);
    });
  }

  function renderTrend(containerId, byMonth) {
    var c = $(containerId);
    c.innerHTML = '';
    var months = lastMonths(6);
    var max = 0;
    months.forEach(function (m) { if (byMonth[m] > max) max = byMonth[m]; });
    months.forEach(function (m) {
      var v = byMonth[m] || 0;
      var col = document.createElement('div');
      col.className = 'trend-col';
      var h = max > 0 ? Math.max(2, v / max * 100) : 2;
      col.innerHTML =
        '<span class="trend-val">' + (v > 0 ? Math.round(v) : '') + '</span>' +
        '<span class="trend-bar ' + (v > 0 ? 'has' : '') + '" style="height:' + h + '%"></span>' +
        '<span class="trend-month">' + m.slice(5) + '月</span>';
      c.appendChild(col);
    });
  }

  function renderRecent(containerId, list) {
    var c = $(containerId);
    c.innerHTML = '';
    list.forEach(function (t) {
      var cat = catByKey(t.category);
      var row = document.createElement('div');
      row.className = 'recent-row';
      row.innerHTML =
        '<div class="recent-left">' +
          '<span class="recent-dot" style="background:' + cat.color + '"></span>' +
          '<div><div class="recent-note">' + escapeHtml(t.note || cat.label) + '</div>' +
          '<div class="recent-cat">' + cat.label + ' · ' + fmtDate(t.createdAt) + '</div></div>' +
        '</div>' +
        '<div class="recent-amt">' + fmtMoney(t.amount) + '</div>';
      c.appendChild(row);
    });
  }

  function renderGoalCard() {
    var card = $('home-goal-card');
    var title = $('home-goal-title');
    var body = $('home-goal-body');
    var addBtn = $('home-add-goal');
    var mg = state.monthlyGoal;
    var isThisMonth = mg && mg.monthKey === monthKey(new Date());
    if (!mg || !isThisMonth) {
      // 本月无目标：显示轻量入口，不显示空白进度条（遵守第6点）
      card.hidden = false;
      if (title) title.hidden = true;
      if (addBtn) addBtn.hidden = false;
      body.innerHTML =
        '<p class="goal-empty-hint">有一件想完成的事吗？</p>' +
        '<button class="goal-light" id="goal-add-light" type="button">＋ 设置本月目标</button>';
      $('goal-add-light').onclick = showGoalForm;
      return;
    }
    // 本月目标已设定：首页只显示名称/目标/备注；进度详情在「理解 → 目标」中查看，不重复
    if (title) title.hidden = false;
    if (addBtn) addBtn.hidden = true;
    card.hidden = false;
    var monthLabel = parseInt(mg.monthKey.split('-')[1], 10) + ' 月';
    body.innerHTML =
      '<div class="goal-detail">' +
        '<div class="goal-name">' + escapeHtml(mg.targetName) + '</div>' +
        (mg.remark ? '<div class="goal-remark">' + escapeHtml(mg.remark) + '</div>' : '') +
        '<div class="goal-line"><span class="goal-k">' + monthLabel + '目标</span><span class="goal-v">' + fmtMoney(mg.goalAmount) + '</span></div>' +
      '</div>' +
      '<button class="goal-add" id="goal-clear" type="button">移除</button>';
    $('goal-clear').onclick = function () {
      state.monthlyGoal = null; save(); renderGoalCard();
      if ($('goal-review-body')) renderGoalReview();
    };
  }

  // 首页右上角「＋目标」表单（月初）：目标名称 / 本月预计收入(可选) / 本月目标金额 / 备注(可选)；可选复用已有目标名
  // suggested：被「提高/降低目标」调用时带入的建议金额
  function showGoalForm(suggested) {
    var card = $('home-goal-card');
    var body = $('home-goal-body');
    card.hidden = false;
    var mg = state.monthlyGoal;
    var isThisMonth = mg && mg.monthKey === monthKey(new Date());
    var curName = isThisMonth ? mg.targetName : '';
    var curIncome = (isThisMonth && typeof mg.income === 'number') ? mg.income : '';
    var curAmt = suggested ? Math.round(suggested * 100) / 100 : (isThisMonth ? mg.goalAmount : '');
    var curRemark = isThisMonth ? (mg.remark || '') : '';
    var chips = state.targets.length
      ? '<div class="goal-target-chips">' + state.targets.map(function (n) {
          return '<button type="button" class="cat-chip goal-target-chip" data-name="' + escapeHtml(n) + '">' + escapeHtml(n) + '</button>';
        }).join('') + '</div>'
      : '';
    body.innerHTML =
      '<p class="goal-form-hint">本月想为哪件事存下多少？</p>' +
      '<input class="goal-add-input" id="goal-name" placeholder="目标名称，如「旅行基金」" maxlength="20" value="' + escapeHtml(curName) + '" />' +
      chips +
      '<input class="goal-add-input" id="goal-income" type="number" min="0" step="0.01" placeholder="本月预计收入（可选），如 8000" value="' + curIncome + '" />' +
      '<input class="goal-add-input" id="goal-amount" type="number" min="0" step="0.01" placeholder="本月目标金额，如 1500" value="' + curAmt + '" />' +
      '<input class="goal-add-input" id="goal-remark" placeholder="备注（可选），如「去日本旅行」" maxlength="40" value="' + escapeHtml(curRemark) + '" />' +
      '<div class="goal-form-actions">' +
        '<button class="goal-add" id="goal-save" type="button">保存</button>' +
        '<button class="goal-cancel" id="goal-cancel" type="button">取消</button>' +
      '</div>';
    Array.prototype.forEach.call(body.querySelectorAll('.goal-target-chip'), function (b) {
      b.onclick = function () { $('goal-name').value = b.getAttribute('data-name'); };
    });
    $('goal-save').onclick = function () {
      var name = $('goal-name').value.trim();
      var amtRaw = $('goal-amount').value.trim();
      var incRaw = $('goal-income').value.trim();
      var remark = $('goal-remark').value.trim();
      if (!name) { toast('先取个名字吧'); return; }
      if (!amtRaw || isNaN(parseFloat(amtRaw)) || parseFloat(amtRaw) <= 0) { toast('填一下本月目标金额'); return; }
      var amt = Math.round(parseFloat(amtRaw) * 100) / 100;
      var income = (incRaw !== '' && !isNaN(parseFloat(incRaw))) ? Math.round(parseFloat(incRaw) * 100) / 100 : null;
      var preserveConfirmed = (isThisMonth && typeof mg.confirmedAmount === 'number') ? mg.confirmedAmount : null;
      var preserveClosed = isThisMonth ? !!mg.closed : false;
      if (state.targets.indexOf(name) === -1) state.targets.push(name);
      state.monthlyGoal = {
        monthKey: monthKey(new Date()),
        targetName: name,
        goalAmount: amt,
        income: income,
        confirmedAmount: preserveConfirmed,
        closed: preserveClosed,
        remark: remark
      };
      save();
      renderGoalCard();
      toast('本月目标已设定：' + name + ' ' + fmtMoney(amt));
    };
    $('goal-cancel').onclick = function () { renderGoalCard(); };
  }

  // 由月末弹窗「提高/降低目标」调用：回到首页表单并预填建议金额
  function adjustGoal(suggested) {
    navigate('home');
    showGoalForm(suggested);
  }

  /* ---------- Quick Log ---------- */
  function resetLog() {
    state.amountStr = '';
    state.note = '';
    state.catKey = 'other';
    state.manualCat = false;
    state.logOpenAt = Date.now();
    track('log_open');
    $('log-amount').textContent = '0';
    $('log-note').value = '';
    updateCatSuggest();
    buildKeypad();
    buildCatList();
    renderRecords(); // 进入记一笔页时同步刷新「我的记录」列表
  }

  function updateCatSuggest() {
    var cat = catByKey(state.catKey);
    var btn = $('log-cat');
    btn.textContent = cat.label;
    btn.style.borderColor = cat.color;
    btn.style.color = cat.color;
  }

  function buildCatList() {
    var c = $('log-cat-list');
    c.innerHTML = '';
    CATEGORIES.concat([DEFAULT_CAT]).forEach(function (cat) {
      var b = document.createElement('button');
      b.className = 'cat-chip' + (cat.key === state.catKey ? ' selected' : '');
      b.type = 'button';
      b.textContent = cat.label;
      b.onclick = function () { state.catKey = cat.key; state.manualCat = true; track('cat_manual_select', { categoryKey: cat.key }); updateCatSuggest(); buildCatList(); };
      c.appendChild(b);
    });
  }

  function buildKeypad() {
    var keys = ['1','2','3','4','5','6','7','8','9','.','0','⌫'];
    var c = $('log-keypad');
    c.innerHTML = '';
    keys.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'key' + (k === '⌫' ? ' key-fn' : '');
      b.textContent = k;
      b.onclick = function () { pressKey(k); };
      c.appendChild(b);
    });
  }

  function pressKey(k) {
    if (k === '⌫') {
      state.amountStr = state.amountStr.slice(0, -1);
    } else if (k === '.') {
      if (state.amountStr.indexOf('.') === -1 && state.amountStr.length > 0) state.amountStr += '.';
    } else {
      if (state.amountStr === '0') state.amountStr = '';
      if (state.amountStr.replace('.', '').length >= 9) return; // 防溢出
      if (state.amountStr.indexOf('.') !== -1 && state.amountStr.split('.')[1].length >= 2) return; // 两位小数
      state.amountStr += k;
    }
    if (state.amountStr === '') state.amountStr = '0';
    $('log-amount').textContent = state.amountStr;
  }

  function submitLog() {
    var amount = parseFloat(state.amountStr);
    if (!amount || amount <= 0) { toast('先输入金额'); return; }
    var note = $('log-note').value.trim();
    var dur = state.logOpenAt ? (Date.now() - state.logOpenAt) : 0;
    var src = state.manualCat ? 'manual' : (state.catKey !== 'other' ? 'auto' : 'default');
    track('log_submit', { duration_ms: dur, categoryKey: state.catKey, categorySource: src, hasNote: note.length > 0 });
    // 直接使用用户最终选定的分类（state.catKey 已随备注自动建议或手动选择保持同步）。
    // 此处不再用 classify(note) 二次覆盖，否则备注为空时会把手动选择强制改回「其他」。
    state.txns.push({
      id: 't' + Date.now() + Math.floor(Math.random() * 1000),
      amount: Math.round(amount * 100) / 100,
      note: note,
      category: state.catKey,
      createdAt: Date.now(),
      whyTag: null,
      goalId: null
    });
    save();
    toast('记好了');
    navigate('home'); // 完成即回到 Home（验收 A）
  }

  /* ---------- 我的记录：查找 / 修改 / 删除（增量） ---------- */

  // 内存过滤（不依赖 localdb 新 API）：关键词匹配 note + amount 字符串包含；分类；起止日期按 createdAt 时间戳区间；结果按 createdAt 倒序
  function queryTxns(filter) {
    var kw = (filter.keyword || '').trim().toLowerCase();
    var cat = filter.catKey || 'all';
    var from = filter.from ? new Date(filter.from + 'T00:00:00').getTime() : null;
    var to = filter.to ? new Date(filter.to + 'T23:59:59.999').getTime() : null;
    var res = state.txns.filter(function (t) {
      if (kw) {
        var note = (t.note || '').toLowerCase();
        var amt = String(t.amount);
        if (note.indexOf(kw) === -1 && amt.indexOf(kw) === -1) return false;
      }
      if (cat !== 'all' && t.category !== cat) return false;
      if (from !== null && t.createdAt < from) return false;
      if (to !== null && t.createdAt > to) return false;
      return true;
    });
    res.sort(function (a, b) { return b.createdAt - a.createdAt; });
    return res;
  }

  // 渲染「我的记录」列表：金额 + 分类 chip（dot+label） + 备注截断 + 时间 + 编辑/删除按钮；空结果显示中性提示
  function renderRecords() {
    var list = $('records-list');
    var empty = $('records-empty');
    if (!list || !empty) return;
    var res = queryTxns(recordsFilter);
    list.innerHTML = '';
    if (!res.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    res.forEach(function (t) {
      var cat = catByKey(t.category);
      var noteText = t.note ? t.note : cat.label;
      // 备注截断（最多 24 字符），截断后再 escapeHtml，杜绝 XSS
      var display = noteText.length > 24 ? noteText.slice(0, 24) + '…' : noteText;
      var row = document.createElement('div');
      row.className = 'records-row';
      row.innerHTML =
        '<div class="records-left">' +
          '<span class="records-dot" style="background:' + cat.color + '"></span>' +
          '<div class="records-info">' +
            '<div class="records-note">' + escapeHtml(display) + '</div>' +
            '<div class="records-cat">' + escapeHtml(cat.label) + ' · ' + fmtDate(t.createdAt) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="records-amt">' + fmtMoney(t.amount) + '</div>' +
        '<div class="records-actions">' +
          '<button class="records-btn" type="button" data-edit="' + t.id + '">编辑</button>' +
          '<button class="records-btn del" type="button" data-del="' + t.id + '">删除</button>' +
        '</div>';
      list.appendChild(row);
    });
    // 行内按钮事件绑定（编辑直接开弹窗；删除先开温和确认弹窗）
    Array.prototype.forEach.call(list.querySelectorAll('[data-edit]'), function (b) {
      b.onclick = function () { beginEdit(b.getAttribute('data-edit')); };
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-del]'), function (b) {
      b.onclick = function () { openConfirm(b.getAttribute('data-del')); };
    });
  }

  /* ---------- 编辑 ---------- */
  function beginEdit(id) {
    var t = null;
    for (var i = 0; i < state.txns.length; i++) if (state.txns[i].id === id) { t = state.txns[i]; break; }
    if (!t) return;
    editId = id;
    editCatKey = t.category || 'other';
    $('edit-amount').value = t.amount;
    $('edit-note').value = t.note || '';
    buildEditCatList();
    $('edit-modal').hidden = false;
    track('record_edit_open', { categoryKey: editCatKey });
  }

  // 编辑弹窗分类选择：复用 CATEGORIES.concat([DEFAULT_CAT]) 渲染 chip，点击设 editCatKey 并高亮当前
  function buildEditCatList() {
    var c = $('edit-cat-list');
    if (!c) return;
    c.innerHTML = '';
    CATEGORIES.concat([DEFAULT_CAT]).forEach(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip' + (cat.key === editCatKey ? ' selected' : '');
      b.textContent = cat.label;
      b.onclick = function () { editCatKey = cat.key; buildEditCatList(); };
      c.appendChild(b);
    });
  }

  function saveEdit() {
    if (!editId) return;
    var amtRaw = $('edit-amount').value.trim();
    var amt = Math.round(parseFloat(amtRaw) * 100) / 100;
    if (!amtRaw || isNaN(amt) || amt <= 0) { toast('先填一下金额'); return; }
    var note = $('edit-note').value.trim();
    var t = null;
    for (var i = 0; i < state.txns.length; i++) if (state.txns[i].id === editId) { t = state.txns[i]; break; }
    if (!t) { $('edit-modal').hidden = true; editId = null; return; }
    // 编辑 = 改 state.txns 中该对象 + 设 updatedAt（云端 last-write-wins 依据），再统一 save()
    t.amount = amt;
    t.note = note;
    t.category = editCatKey;
    t.updatedAt = Date.now();
    save();
    $('edit-modal').hidden = true;
    editId = null;
    renderRecords();
    toast('已更新');
    track('record_edit_save', { categoryKey: editCatKey });
  }

  /* ---------- 删除（路线 B：本地移除 + 单独推 tombstone） ---------- */
  function deleteTxn(id) {
    var copy = null;
    for (var i = 0; i < state.txns.length; i++) if (state.txns[i].id === id) { copy = Object.assign({}, state.txns[i]); break; }
    if (!copy) return null;
    // （1）从内存真值移除 → 本地聚合（总额/分类/Insight/Home）天然不再计入
    state.txns = state.txns.filter(function (t) { return t.id !== id; });
    // （2）save()：整批重写 IndexedDB（已删干净）+ 登录态整批 pushTxns(剩余项，不含被删)
    save();
    // （3）单独推送 tombstone 给云端做逻辑删除（_deleted 仅存在于云端载荷，绝不写回 state.txns/IndexedDB）
    if (typeof Cloud !== 'undefined' && Cloud.isLoggedIn()) {
      Cloud.pushTxns([{ id: id, _deleted: true, updatedAt: Date.now() }]).catch(function () {});
    }
    return copy; // 供撤销还原
  }

  function confirmDelete(id) {
    var copy = deleteTxn(id);
    if (!copy) return;
    renderRecords(); // 该条自然从列表消失
    showUndoToast('已删除', function () { undoDelete(copy); });
    track('record_delete', { id: id });
  }

  function undoDelete(copy) {
    if (!copy) return;
    // 撤销 = 把原对象（无 _deleted）重新 push 回 state.txns 并 save()，云端因 last-write-wins（新 updatedAt）自愈
    state.txns.push(copy);
    save();
    renderRecords();
    toast('已恢复');
    track('record_undo', { id: copy.id });
  }

  /* ---------- 删除确认弹窗 ---------- */
  function openConfirm(id) {
    pendingDeleteId = id;
    $('confirm-modal').hidden = false;
  }
  function closeConfirm() {
    pendingDeleteId = null;
    $('confirm-modal').hidden = true;
  }

  /* ---------- 撤销 toast（独立，5s 窗口） ---------- */
  function showUndoToast(msg, onUndo) {
    var el = $('undo-toast');
    if (!el) return;
    var txt = el.querySelector('.undo-toast-text');
    var btn = el.querySelector('.undo-toast-btn');
    if (txt) txt.textContent = msg;
    el.hidden = false;
    if (btn) {
      btn.onclick = function () {
        el.hidden = true;
        clearTimeout(showUndoToast._t);
        onUndo(); // 用户主动撤销：立即还原
      };
    }
    clearTimeout(showUndoToast._t);
    // 5s 后自动隐藏，超窗则撤销不可用（fire-and-forget，不阻断本地）
    showUndoToast._t = setTimeout(function () { el.hidden = true; }, 5000);
  }

  /* ---------- Insight ---------- */
  function renderInsight() {
    var mk = monthKey(new Date());
    var byCat = sumByCategory(state.txns, mk);
    var total = Object.keys(byCat).reduce(function (s, k) { return s + byCat[k]; }, 0);
    renderBars('insight-cat-bars', byCat, total);
    $('insight-cat-empty').hidden = Object.keys(byCat).length > 0;

    // 与上月对比（基础，仅展示变化）
    var months = lastMonths(2);
    var byMonth = sumByMonth(state.txns);
    var thisM = byMonth[months[1]] || 0;
    var lastM = byMonth[months[0]] || 0;
    var mom = $('insight-mom');
    mom.innerHTML = '<div class="mom-row"><span class="mom-cat">总支出</span>' +
      '<span class="mom-val">' + fmtMoney(lastM) + ' → ' + fmtMoney(thisM) + '</span></div>';

    $('review-text').textContent = buildReview(state.txns);
    renderTrend('insight-trend', byMonth);
    renderGoalReview();
    renderAggregatedReview();
  }

  // 月度回顾（Insight → 目标 tab）：收入/支出/结余/目标/确认计入/完成率
  function renderGoalReview() {
    var el = $('goal-review-body');
    if (!el) return;
    var mk = monthKey(new Date());
    var mg = state.monthlyGoal;
    var isThisMonth = mg && mg.monthKey === mk;
    if (!mg || !isThisMonth) {
      el.innerHTML = '<div class="card review-card"><p class="subtle">还没有设定本月目标。月初可以在首页「＋目标」开始，不强制。</p></div>';
      return;
    }
    var spent = (sumByMonth(state.txns)[mk]) || 0;
    var monthLabel = parseInt(mk.split('-')[1], 10) + ' 月';
    var income = (typeof mg.income === 'number') ? mg.income : null;
    var confirmed = (typeof mg.confirmedAmount === 'number') ? mg.confirmedAmount : null;
    var balance = (income !== null) ? (income - spent) : null;
    var pct = (typeof mg.confirmedAmount === 'number' && mg.goalAmount > 0) ? (mg.confirmedAmount / mg.goalAmount * 100) : null;

    var html = '<div class="card review-card">';
    html += '<div class="card-title">' + monthLabel + ' ' + escapeHtml(mg.targetName) + ' · 月度回顾</div>';
    html += '<div class="goal-review-row"><span>本月支出</span><span>' + fmtMoney(spent) + '</span></div>';
    html += '<div class="goal-input-row"><label>本月实际收入</label><input id="goal-review-income" type="number" min="0" step="0.01" placeholder="如 8000" value="' + (income !== null ? income : '') + '" /></div>';
    html += '<div class="goal-review-row"><span>本月结余</span><span>' + (balance !== null ? fmtMoney(balance) : '—') + '</span></div>';
    html += '<div class="goal-review-row"><span>' + monthLabel + '目标金额</span><span>' + fmtMoney(mg.goalAmount) + '</span></div>';
    // 用户主动确认计入金额，系统不自动把结余计入
    html += '<div class="goal-input-row"><label>实际计入「' + escapeHtml(mg.targetName) + '」</label><input id="goal-confirmed" type="number" min="0" step="0.01" placeholder="主动填写，不自动计入" value="' + (confirmed !== null ? confirmed : '') + '" /></div>';
    if (confirmed !== null) {
      html += '<div class="goal-progress"><div class="goal-progress-bar" style="width:' + Math.min(100, pct).toFixed(1) + '%"></div></div>';
      html += '<div class="goal-progress-text">完成率 ' + pct.toFixed(1) + '%（' + fmtMoney(mg.confirmedAmount) + ' / ' + fmtMoney(mg.goalAmount) + '）</div>';
    }
    html += '<div class="goal-form-actions">';
    html += '<button class="goal-add" id="goal-confirm" type="button">确认</button>';
    html += (mg.closed ? '<button class="goal-cancel" id="goal-adjust-open" type="button">调整下月目标</button>' : '');
    html += '</div>';
    html += '</div>';
    el.innerHTML = html;

    $('goal-confirm').onclick = function () {
      var incRaw = $('goal-review-income').value.trim();
      var conRaw = $('goal-confirmed').value.trim();
      if (incRaw === '' || isNaN(parseFloat(incRaw))) { toast('先填一下本月收入'); return; }
      if (conRaw === '' || isNaN(parseFloat(conRaw)) || parseFloat(conRaw) < 0) { toast('请主动填写计入目标的金额'); return; }
      mg.income = Math.round(parseFloat(incRaw) * 100) / 100;
      mg.confirmedAmount = Math.round(parseFloat(conRaw) * 100) / 100;
      mg.closed = true;
      save();
      renderGoalReview();
      showAdjustModal(mg);
    };
    var adjBtn = $('goal-adjust-open');
    if (adjBtn) adjBtn.onclick = function () { showAdjustModal(mg); };
  }

  // 月末温和调整弹窗（不评判、不催促）：保持 / 提高 / 降低 / 暂不设置 四选一
  function showAdjustModal(mg) {
    var modal = $('goal-modal');
    if (!modal) return;
    var con = (typeof mg.confirmedAmount === 'number') ? mg.confirmedAmount : 0;
    $('goal-modal-text').textContent =
      '这个月，你原本计划为' + mg.targetName + '留下 ' + fmtMoney(mg.goalAmount) +
      '，实际计入目标 ' + fmtMoney(con) + '。\n下个月想继续保持这个目标吗？';
    $('modal-keep').textContent = '保持 ' + fmtMoney(mg.goalAmount);
    modal.hidden = false;
    $('modal-keep').onclick = function () { modal.hidden = true; toast('目标已保留'); };
    $('modal-up').onclick = function () { modal.hidden = true; adjustGoal(mg.goalAmount * 1.1); };
    $('modal-down').onclick = function () { modal.hidden = true; adjustGoal(mg.goalAmount * 0.9); };
    $('modal-none').onclick = function () {
      modal.hidden = true;
      state.monthlyGoal = null; save();
      renderGoalCard();
      renderGoalReview();
      toast('已暂时不设目标');
    };
  }

  /* ---------- 聚合式复盘（Iteration 06：系统聚合，用户判断） ---------- */
  function aggregateMonth(txns, mk) {
    var map = {};
    for (var i = 0; i < txns.length; i++) {
      if (monthKey(new Date(txns[i].createdAt)) !== mk) continue;
      var c = txns[i].category;
      if (!map[c]) map[c] = { count: 0, amount: 0 };
      map[c].count++;
      map[c].amount += txns[i].amount;
    }
    return map;
  }
  // 环比：返回 { catKey: { count, amount, prev, changePct } }；changePct 为 null 表示上月无该类别（本月新出现）
  function momCompare(txns, mk) {
    var lmKey = lastMonths(2)[0];
    var thisM = aggregateMonth(txns, mk);
    var lastM = aggregateMonth(txns, lmKey);
    var out = {};
    Object.keys(thisM).forEach(function (k) {
      var cur = thisM[k].amount;
      var prev = lastM[k] ? lastM[k].amount : 0;
      var changePct = prev > 0 ? (cur - prev) / prev * 100 : null;
      out[k] = { count: thisM[k].count, amount: cur, prev: prev, changePct: changePct };
    });
    return out;
  }
  // 连续 3 个月增长（安记主动发现模式）
  function threeMonthGrowth(txns, catKey) {
    var ms = lastMonths(3);
    var sums = ms.map(function (m) { var a = aggregateMonth(txns, m)[catKey]; return a ? a.amount : 0; });
    return sums[0] > 0 && sums[1] > sums[0] && sums[2] > sums[1];
  }

  function renderAggregatedReview() {
    var mk = monthKey(new Date());
    var mom = momCompare(state.txns, mk);
    var tagsForMonth = state.catTags[mk] || {};

    // 1) 聚合群组 + 意义标签选择（用户对群组判断，而非逐笔）
    var gc = $('agg-groups');
    if (gc) {
      var keys = Object.keys(mom).sort(function (a, b) { return mom[b].amount - mom[a].amount; });
      if (!keys.length) {
        gc.innerHTML = '<div class="empty-hint">这个月还没有记录，去「记一笔」试试。</div>';
      } else {
        gc.innerHTML = '';
        keys.forEach(function (k) {
          var cat = catByKey(k);
          var info = mom[k];
          var sel = tagsForMonth[k];
          var tagHtml = AGG_TAGS.map(function (t) {
            return '<span class="agg-tag' + (sel === t ? ' selected' : '') + '" data-cat="' + k + '" data-t="' + t + '">' + t + '</span>';
          }).join('');
          var row = document.createElement('div');
          row.className = 'agg-group';
          row.innerHTML =
            '<div class="agg-group-head"><span class="agg-group-label">' + cat.label + '</span>' +
            '<span class="agg-group-val">' + info.count + ' 笔 / ' + fmtMoney(info.amount) + '</span></div>' +
            '<div class="agg-tags">' + tagHtml + '</div>';
          gc.appendChild(row);
        });
        gc.querySelectorAll('.agg-tag').forEach(function (tg) {
          tg.onclick = function () {
            var ck = tg.getAttribute('data-cat');
            var tt = tg.getAttribute('data-t');
            if (!state.catTags[mk]) state.catTags[mk] = {};
            if (state.catTags[mk][ck] === tt) delete state.catTags[mk][ck];
            else state.catTags[mk][ck] = tt;
            save();
            renderAggregatedReview();
            toast('已记录这段消费的意义');
          };
        });
      }
    }

    // 2) 值得关注的变化（环比跳动 / 新方向 / 连续增长 / 用户规则触发）
    var nc = $('agg-notable');
    if (nc) {
      var items = [];
      Object.keys(mom).forEach(function (k) {
        var info = mom[k];
        var cat = catByKey(k);
        if (info.changePct === null) {
          items.push('<div class="agg-notable-item"><span class="agg-notable-cat">' + cat.label + '</span>本月新出现的消费方向，' + info.count + ' 笔 / ' + fmtMoney(info.amount) + '。</div>');
        } else if (Math.abs(info.changePct) >= 30) {
          var dir = info.changePct >= 0 ? '增加' : '减少';
          items.push('<div class="agg-notable-item"><span class="agg-notable-cat">' + cat.label + '</span>比上月' + dir + ' ' + Math.abs(Math.round(info.changePct)) + '%。</div>');
        }
        if (threeMonthGrowth(state.txns, k)) {
          items.push('<div class="agg-notable-item"><span class="agg-notable-cat">' + cat.label + '</span>已连续 3 个月增长，安记注意到这个趋势。</div>');
        }
      });
      state.rules.forEach(function (r) {
        var val = ruleValue(r);
        if (val && ruleTriggered(r, val)) {
          var cat = catByKey(r.category);
          var desc = r.type === 'mom'
            ? (cat.label + ' 比上月增加 ' + Math.round(val.pct) + '%，达到你关注的 ' + r.threshold + '%')
            : (cat.label + ' 本月 ' + fmtMoney(val.amount) + '，达到你关注的 ' + fmtMoney(r.threshold));
          items.push('<div class="agg-notable-item agg-reminder"><span class="agg-notable-cat">安记注意到</span>' + desc + '。要加入关注吗？</div>');
        }
      });
      if (!items.length) {
        nc.innerHTML = '';
        if ($('agg-notable-empty')) $('agg-notable-empty').hidden = false;
      } else {
        if ($('agg-notable-empty')) $('agg-notable-empty').hidden = true;
        nc.innerHTML = items.join('');
      }
    }

    // 3) 可校正提醒规则（用户定义，安记只整理）
    renderRules();
  }

  function ruleValue(r) {
    var mk = monthKey(new Date());
    var cur = aggregateMonth(state.txns, mk)[r.category];
    var amount = cur ? cur.amount : 0;
    if (r.type === 'cap') return { amount: amount };
    var lmKey = lastMonths(2)[0];
    var prev = aggregateMonth(state.txns, lmKey)[r.category];
    var prevAmt = prev ? prev.amount : 0;
    var pct = prevAmt > 0 ? (amount - prevAmt) / prevAmt * 100 : null;
    return { amount: amount, pct: pct };
  }
  function ruleTriggered(r, val) {
    if (r.type === 'cap') return val.amount >= r.threshold;
    if (r.type === 'mom') return val.pct !== null && val.pct >= r.threshold;
    return false;
  }

  function renderRules() {
    var rc = $('agg-rules');
    if (!rc) return;
    if (!state.rules.length) {
      rc.innerHTML = '<div class="empty-hint">还没有规则。下面加一条，安记就会在变化时温和提醒你。</div>';
    } else {
      rc.innerHTML = '';
      state.rules.forEach(function (r) {
        var cat = catByKey(r.category);
        var desc = r.type === 'mom'
          ? (cat.label + ' 比上月增加 ≥ ' + r.threshold + '%')
          : (cat.label + ' 单月 ≥ ' + fmtMoney(r.threshold));
        var row = document.createElement('div');
        row.className = 'rule-row';
        row.innerHTML = '<span class="rule-desc">' + desc + '</span>';
        var del = document.createElement('button');
        del.className = 'rule-del'; del.type = 'button'; del.textContent = '移除';
        del.onclick = function () {
          state.rules = state.rules.filter(function (x) { return x.id !== r.id; });
          save(); renderRules(); renderAggregatedReview();
        };
        row.appendChild(del);
        rc.appendChild(row);
      });
    }
    var fc = $('agg-rule-form');
    if (!fc) return;
    var catOpts = CATEGORIES.concat([DEFAULT_CAT]).map(function (c) {
      return '<option value="' + c.key + '">' + c.label + '</option>';
    }).join('');
    fc.innerHTML =
      '<div class="rule-form-row">' +
        '<select id="rule-cat" class="rule-select">' + catOpts + '</select>' +
        '<select id="rule-type" class="rule-select">' +
          '<option value="mom">比上月增加 ≥</option>' +
          '<option value="cap">单月 ≥</option>' +
        '</select>' +
        '<input id="rule-th" class="rule-input" type="number" min="0" step="0.01" placeholder="阈值" />' +
        '<button id="rule-add" class="goal-add" type="button">添加</button>' +
      '</div>';
    $('rule-add').onclick = function () {
      var cat = $('rule-cat').value;
      var type = $('rule-type').value;
      var thRaw = $('rule-th').value.trim();
      if (thRaw === '' || isNaN(parseFloat(thRaw)) || parseFloat(thRaw) <= 0) { toast('填一下阈值'); return; }
      state.rules.push({ id: 'r' + Date.now() + Math.floor(Math.random() * 1000), category: cat, type: type, threshold: Math.round(parseFloat(thRaw) * 100) / 100, enabled: true });
      save(); renderRules(); renderAggregatedReview(); toast('规则已添加');
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ---------- 绑定 ---------- */
  function renderDebug() {
    var raw = '[]';
    try { raw = localStorage.getItem(ANALYTICS_KEY) || '[]'; } catch (e) {}
    var el = $('debug-text'); if (el) el.value = raw;
    var sum = $('debug-summary'); if (!sum) return;
    try {
      var arr = JSON.parse(raw);
      var submits = arr.filter(function (e) { return e.event === 'log_submit'; });
      var durs = submits.map(function (e) { return e.duration_ms || 0; }).sort(function (a, b) { return a - b; });
      var median = durs.length ? (durs.length % 2 ? durs[(durs.length - 1) / 2] : Math.round((durs[durs.length / 2 - 1] + durs[durs.length / 2]) / 2)) : 0;
      var avg = durs.length ? Math.round(durs.reduce(function (s, x) { return s + x; }, 0) / durs.length) : 0;
      var srcCount = {};
      submits.forEach(function (e) { var s = e.categorySource || 'unknown'; srcCount[s] = (srcCount[s] || 0) + 1; });
      var srcStr = Object.keys(srcCount).map(function (k) { return k + ':' + srcCount[k]; }).join('  ');
      var views = {}; arr.forEach(function (e) { if (e.event === 'view') { views[e.view] = (views[e.view] || 0) + 1; } });
      sum.value = '事件总数: ' + arr.length +
        '\n记录提交: ' + submits.length +
        '\n耗时 中位/平均(ms): ' + median + ' / ' + avg +
        '\n分类来源(manual/auto/default): ' + (srcStr || '—') +
        '\n页面浏览: ' + JSON.stringify(views);
    } catch (e) { sum.value = '汇总失败'; }
  }
  function initDebug() {
    if (location.search.indexOf('debug') === -1) return;
    var p = $('debug-panel'); if (!p) return;
    p.hidden = false; renderDebug();
    $('debug-refresh').onclick = renderDebug;
    $('debug-copy').onclick = function () {
      var t = $('debug-text').value;
      if (navigator.clipboard) navigator.clipboard.writeText(t);
      toast('已复制');
    };
    $('debug-download').onclick = function () {
      var blob = new Blob([$('debug-text').value], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'anjie-events-' + SESSION_ID + '.json'; a.click();
    };
    $('debug-clear').onclick = function () { localStorage.removeItem(ANALYTICS_KEY); renderDebug(); toast('已清空'); };
  }

  /* ---------- 账号界面 ---------- */
  function showAuth(show) {
    var screen = $('auth-screen');
    if (screen) screen.hidden = !show;
    if ($('app')) $('app').hidden = show;
  }
  function updateUserBar() {
    var bar = $('user-bar');
    if (!bar) return;
    if (typeof Cloud !== 'undefined' && Cloud.isLoggedIn()) {
      bar.hidden = false;
      var em = (typeof Cloud.getEmail === 'function' && Cloud.getEmail()) || '';
      $('user-email').textContent = em ? ('账户：' + em) : '已登录';
    } else {
      bar.hidden = true;
      setSyncStatus(null);
    }
  }
  // 顶栏常驻的云端同步状态指示：让用户一眼看到记账是否真的上云
  function setSyncStatus(ok, msg) {
    var el = $('sync-status');
    if (!el) return;
    if (ok === null) { el.textContent = ''; el.className = 'sync-status'; return; }
    var t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (ok) { el.textContent = '☁ 已同步 ' + t; el.className = 'sync-status ok'; }
    else { el.textContent = '☁ 同步失败: ' + (msg || ''); el.className = 'sync-status err'; }
  }
  // 把云端数据并入本地 state（云端为空账户时，把本地数据先上传，避免丢失）
  function seedFromCloud(data) {
    var cloudEmpty = (!data.txns || data.txns.length === 0) &&
      !(data.goals && (data.goals.monthlyGoal || (data.goals.targets && data.goals.targets.length)));
    if (cloudEmpty) {
      // 本地优先：上传当前本地数据
      Cloud.pushTxns(state.txns).catch(function () {});
      Cloud.pushGoals({ targets: state.targets, monthlyGoal: state.monthlyGoal, catTags: state.catTags, rules: state.rules }).catch(function () {});
    } else {
      state.txns = data.txns || [];
      state.targets = (data.goals && data.goals.targets) || [];
      state.monthlyGoal = (data.goals && data.goals.monthlyGoal) || null;
      state.catTags = (data.goals && data.goals.catTags) || {};
      state.rules = (data.goals && data.goals.rules) || [];
      save();
    }
  }
  function afterLogin() {
    showAuth(false);
    updateUserBar();
    Cloud.pull().then(function (data) {
      seedFromCloud(data);
      renderHome();
      renderInsight();
      setSyncStatus(true);
      toast('已同步云端数据');
    }).catch(function () {
      setSyncStatus(false, '拉取失败');
      renderHome();
      renderInsight();
      toast('云端拉取失败，使用本地数据');
    });
  }
  function wireAuth() {
    var primary = $('auth-primary');
    var toggle = $('auth-toggle');
    var skip = $('auth-skip');
    var emailEl = $('auth-email');
    var pwdEl = $('auth-password');
    var errEl = $('auth-error');
    var mode = 'login';
    function setErr(msg) { if (errEl) { errEl.textContent = msg || ''; errEl.hidden = !msg; } }
    function refreshMode() {
      if (primary) primary.textContent = (mode === 'login' ? '登录' : '注册');
      if (toggle) toggle.textContent = (mode === 'login' ? '还没有账号？注册一个' : '已有账号？去登录');
    }
    if (toggle) toggle.onclick = function () { mode = (mode === 'login' ? 'register' : 'login'); refreshMode(); setErr(''); };
    if (skip) skip.onclick = function () { showAuth(false); Cloud && Cloud.isLoggedIn() && Cloud.logout(); updateUserBar(); renderHome(); renderInsight(); toast('仅本地模式：数据不会上传'); };
    if (primary) primary.onclick = function () {
      var email = (emailEl && emailEl.value || '').trim();
      var pwd = (pwdEl && pwdEl.value) || '';
      if (!email || !pwd) { setErr('请填写邮箱和密码'); return; }
      var p = (mode === 'login') ? Cloud.login(email, pwd) : Cloud.register(email, pwd);
      p.then(function () { afterLogin(); }).catch(function (e) { setErr(e.message || '操作失败'); });
    };
    // 回车提交
    [emailEl, pwdEl].forEach(function (el) {
      if (el) el.onkeydown = function (e) { if (e.key === 'Enter') primary && primary.click(); };
    });
    refreshMode();
  }

  async function init() {
    try { await load(); } catch (e) {}
    track('app_open');
    wireAuth();
    if (typeof Cloud !== 'undefined' && Cloud.isLoggedIn()) {
      // 已登录：拉取云端数据后再渲染
      afterLogin();
    } else {
      showAuth(true);
      // 主动检测云端后端是否可达；不可达时给出温和提示，避免用户盲目登录后撞上 "<!DOCTYPE" 解析错误
      if (typeof Cloud !== 'undefined' && Cloud.checkBackend) {
        Cloud.checkBackend().then(function (reachable) {
          if (!reachable) {
            var ne = $('auth-backend-notice');
            if (ne) {
              ne.textContent = '⚠️ 当前环境未连接到云端后端，登录与同步暂不可用。你可以先点下方「仅本地使用」在本地记账，数据会安全存在本机浏览器。';
              ne.hidden = false;
            }
          }
        }).catch(function () {});
      }
    }
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.onclick = function () { navigate(b.getAttribute('data-view')); };
    });
    $('log-submit').onclick = submitLog;
    // 「我的记录」：筛选实时生效（输入即过滤，无需搜索按钮）
    var rk = $('records-keyword');
    if (rk) rk.oninput = function () { recordsFilter.keyword = this.value; renderRecords(); };
    var rcf = $('records-cat-filter');
    if (rcf) rcf.onchange = function () { recordsFilter.catKey = this.value; renderRecords(); };
    var rfrom = $('records-from');
    if (rfrom) rfrom.onchange = function () { recordsFilter.from = this.value; renderRecords(); };
    var rto = $('records-to');
    if (rto) rto.onchange = function () { recordsFilter.to = this.value; renderRecords(); };
    // 动态填充分类下拉：「全部」 + 各分类 label
    var rsel = $('records-cat-filter');
    if (rsel) {
      rsel.innerHTML = '';
      var optAll = document.createElement('option');
      optAll.value = 'all'; optAll.textContent = '全部';
      rsel.appendChild(optAll);
      CATEGORIES.concat([DEFAULT_CAT]).forEach(function (cat) {
        var o = document.createElement('option');
        o.value = cat.key; o.textContent = cat.label;
        rsel.appendChild(o);
      });
    }
    // 编辑弹窗：保存 / 取消
    var editSave = $('edit-save');
    if (editSave) editSave.onclick = saveEdit;
    var editCancel = $('edit-cancel');
    if (editCancel) editCancel.onclick = function () { $('edit-modal').hidden = true; editId = null; };
    // 删除确认弹窗：移除 / 取消（确认时取暂存的 pendingDeleteId）
    var confirmRemove = $('confirm-remove');
    if (confirmRemove) confirmRemove.onclick = function () {
      var id = pendingDeleteId;
      closeConfirm();
      if (id) confirmDelete(id);
    };
    var confirmCancel = $('confirm-cancel');
    if (confirmCancel) confirmCancel.onclick = closeConfirm;
    var addGoalBtn = $('home-add-goal');
    if (addGoalBtn) addGoalBtn.onclick = showGoalForm;
    $('log-note').oninput = function () {
      state.note = this.value;
      // 备注变化时实时给出分类建议；但用户手动选过分类后，手动选择优先级更高，不再被自动分类覆盖。
      if (state.manualCat) return;
      var cat = classify(this.value);
      state.catKey = cat.key;
      updateCatSuggest();
      buildCatList();
    };
    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () {
        var active = t.getAttribute('data-tab');
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(function (p) {
          p.hidden = (p.id !== 'tab-' + active);
        });
        if (active === 'goal') { renderGoalReview(); track('view', { view: 'goal' }); }
        if (active === 'why') { renderAggregatedReview(); track('view', { view: 'review-agg' }); }
      };
    });
    var logoutBtn = $('user-logout');
    if (logoutBtn) logoutBtn.onclick = function () {
      if (typeof Cloud !== 'undefined') Cloud.logout();
      updateUserBar();
      showAuth(true);
      toast('已退出登录');
    };
    navigate('home');
    initDebug();
  }

  document.addEventListener('DOMContentLoaded', init);
}
