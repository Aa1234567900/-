# 安记(Ānjì) 增量代码摘要：记账数据「查找 / 修改 / 删除」管理区

> 改动根目录：`/Users/mac/WorkBuddy/2026-07-26-22-39-42/`
> 改动文件（仅 3 个）：`index.html`、`styles.css`、`app.js`
> 不变文件：`localdb.js` / `cloud.js` / `server/api.js`（设计 §1.3 已说明最小改动面原因）
> 实现依据：`incremental-design-records.md`（增量架构设计主文档）+ 类图 / 时序图 / 增量 PRD

---

## 一、IS_PASS 结论

**IS_PASS: YES**

全局一致性审查（T6）通过：
1. **未登录态**编辑/删除仅本地生效，`state.txns` 为干净真相，Home「最近记录」自动不再显示已删项（路线 B 天然满足）。
2. **登录态**删除后 `Cloud.pushTxns` 收到带 `{ id, _deleted: true, updatedAt }` 的 tombstone，云端逻辑删除。
3. **撤销** 5s 窗口内点击「撤销」还原；超窗 `#undo-toast` 自动隐藏，撤销不可用。
4. **聚合 / Home / Insight 完全不受 `_deleted` 影响**——路线 B 下已删项彻底离开 `state.txns`，聚合函数零改动。
5. **筛选实时生效**（input/change 即过滤），空结果显示中性提示「没有找到相关记录」，无报错态。
6. 字段统一用 `category`（非 `catKey`）；XSS 防护 `escapeHtml()` 覆盖所有用户可见文本；唯一持久化入口 `save()`；`_deleted` tombstone 仅存在于云端推送载荷，绝不回写 `state.txns`/IndexedDB。

`node --check app.js` 通过，无语法错误。

---

## 二、各文件改动明细

### 1. `index.html`（T1）
在 `#view-log` 内、`#log-submit` 按钮之后、`</section>` 之前新增 4 个区块，结构严格对齐设计文档「附录：关键 DOM 结构样例」：
- **「我的记录」卡片**：`.card.records-card`，含筛选条
  - `#records-keyword`（搜索备注或金额，`maxlength=40`）
  - `#records-cat-filter`（空 `<select>`，选项由 `init()` 动态填充）
  - `#records-from` / `#records-to`（日期范围，`type=date`）+ 分隔文案「至」
  - `#records-list`（列表挂载点）+ `#records-empty`（空提示，hidden 默认）
- **编辑弹窗 `#edit-modal`**：`.modal` 复用 `.modal-card/.modal-text/.modal-actions`，含 `#edit-amount`、`#edit-note`、`#edit-cat-list`（分类 chip 挂载点）、`#edit-save`/`#edit-cancel`（复用 `.goal-add`/`.goal-cancel`）。
- **删除确认弹窗 `#confirm-modal`**：温和中性文案 `#confirm-text`（"确定要移除这笔记录吗？"）、`#confirm-remove`/`#confirm-cancel`。
- **撤销 toast `#undo-toast`**：`.toast.undo-toast` 复用 `.toast` 视觉，含 `.undo-toast-text` 与「撤销」按钮 `.undo-toast-btn`，**独立 5s 窗口**。

### 2. `styles.css`（T2）
全部复用既有 CSS 变量（`--accent/--line/--sub/--card/--radius/--bg/--accent-soft/--ink`），无新硬色板：
- `.records-card`（基础卡片 + `margin-top:16px` 分隔）
- `.records-filter / .records-filter-row / .records-keyword / .records-select / .records-date / .records-date-sep`
- `.records-list / .records-row / .records-left / .records-dot / .records-info / .records-note / .records-cat / .records-amt / .records-actions / .records-btn / .records-btn.del`（删除按钮中性、无红色告警）
- `#edit-modal .goal-add-input`（加大行距）
- `.undo-toast`（复用 `.toast` 固定定位/背景/圆角/字号/z-index/动效，改为 `display:flex` 横向布局）+ `.undo-toast-text` + `.undo-toast-btn`

### 3. `app.js`（T3–T5）
**新增模块状态（window 块内，紧邻 `state` 声明）**：
```js
var recordsFilter = { keyword: '', catKey: 'all', from: '', to: '' };
var editId = null;
var editCatKey = 'other';
var pendingDeleteId = null; // 删除确认待定 id（闭包式暂存）
```

**新增函数清单（位于 `submitLog()` 之后、`renderInsight()` 之前）**：
| 函数 | 职责 | 与 `save()` / 云端协作 |
|---|---|---|
| `queryTxns(filter)` | 内存过滤：关键词(note+amount 包含) / 分类 / 起止日期(createdAt 时间戳区间)；结果按 createdAt 倒序 | 无 |
| `renderRecords()` | 渲染列表行（金额 + 分类 dot/label + 备注截断 + 时间 + 编辑/删除按钮）；空结果显示 `#records-empty` | 无 |
| `beginEdit(id)` | 取交易 → 填充 `#edit-amount/#edit-note` → `buildEditCatList()` → 显示 `#edit-modal` | 无 |
| `buildEditCatList()` | 复用 `CATEGORIES.concat([DEFAULT_CAT])` 渲染 chip，点击设 `editCatKey` 并高亮 | 无 |
| `saveEdit()` | 写 `amount/note/category=editCatKey/updatedAt` → `save()` → 关弹窗 → `renderRecords()` → `toast('已更新')` | **改 `state.txns` + `save()`**，登录态推全量（含更新项，last-write-wins） |
| `deleteTxn(id)` | 克隆 copy → 从 `state.txns` 移除 → `save()` → 登录态**单独**推 `{id,_deleted:true,updatedAt}` tombstone → 返回 copy | **路线 B**：本地移除 + 单独 tombstone |
| `confirmDelete(id)` | `copy=deleteTxn(id)` → `renderRecords()` → `showUndoToast('已删除', ()=>undoDelete(copy))` | 经 `deleteTxn` |
| `undoDelete(copy)` | `state.txns.push(copy)` → `save()` → `renderRecords()` → `toast('已恢复')` | **还原 + `save()`**，登录态推全量（新 updatedAt > tombstone → 云端自愈） |
| `openConfirm(id)` / `closeConfirm()` | 删除确认弹窗开/关，暂存/清空 `pendingDeleteId` | 无 |
| `showUndoToast(msg, onUndo)` | 显 `#undo-toast`，绑定「撤销」按钮 `onClick=onUndo`，**5s 后自动隐藏**；不依赖 `toast()` | 无 |

**改动既有函数**：
- `resetLog()`：末尾新增 `renderRecords();`（进入记一笔页时同步刷新「我的记录」）。
- `init()`：新增筛选输入绑定（`#records-keyword` input / `#records-cat-filter` change / `#records-from` / `#records-to` change，均实时调 `renderRecords()`）；动态填充 `#records-cat-filter` 选项（"全部" + 各分类 label）；绑定 `#edit-save/#edit-cancel` 与 `#confirm-remove/#confirm-cancel`。

---

## 三、与 `save()` 的协作点（设计 §3.3）

- **编辑**：`saveEdit` 改 `state.txns` 中对象 + 设 `updatedAt` → `save()`（本地整批重写；登录态 `pushTxns(state.txns)` 含更新项，新 `updatedAt` → 云端 last-write-wins）。
- **删除**：`deleteTxn` 从 `state.txns` 移除 → `save()`（本地已删干净 + 登录态推剩余项）→ **再单独** `pushTxns([{id,_deleted:true,updatedAt}])` 传播删除。
- **撤销**：`undoDelete` 把 `copy` 重新 `push` 回 `state.txns` → `save()`（本地重写 + 登录态推全量，含还原项，新 `updatedAt` > tombstone → 云端自愈）。
- **Home/Insight 自动一致**：三者均只读 `state.txns`，路线 B 下已删项彻底离开内存，无需额外联动。

---

## 四、设计硬约束落实核对

1. ✅ 字段名统一 `category`（非 `catKey`）；`queryTxns`/`renderRecords`/`saveEdit` 全部读/写 `t.category`。
2. ✅ 唯一持久化入口 `save()`；任何单条变更先改 `state.txns` 再 `save()`。
3. ✅ 删除走路线 B，tombstone 单独推；未登录时只做本地两步。
4. ✅ `_deleted` 仅存在于 `Cloud.pushTxns([{id,_deleted:true,updatedAt}])` 载荷，绝不写入 `state.txns`/IndexedDB。
5. ✅ XSS：`renderRecords` 中对 `display`(备注) 与 `cat.label` 经 `escapeHtml()`；`id` 为内部生成值，安全。
6. ✅ 复用 `catByKey()/CATEGORIES/DEFAULT_CAT/buildCatList() 思路/fmtDate/fmtMoney/track/save()/Cloud.isLoggedIn()/Cloud.pushTxns`。
7. ✅ 模态复用 `#goal-modal` 同款 `.modal/.modal-card/.modal-actions` 与 `.goal-add`/`.goal-cancel`；编辑弹窗分类 chip 复用 `CATEGORIES.concat([DEFAULT_CAT])`。
8. ✅ 新增独立 `#undo-toast`（带「撤销」按钮 + 5s 计时），未使用固定 1400ms 的 `toast()` 承载撤销。

---

## 五、遗留风险（设计 §8，已知可接受）

1. **撤销与 tombstone 竞态（最终一致）**：若 tombstone 在还原推送之后才到达云端，会再次逻辑删除该条；下次 `save()`/`pull()` 自愈，按已确认决策接受最终一致。
2. **列表超长性能**：v1 纯滚动不分期；若实测 >200 条卡顿，再评估虚拟列表/分页。
3. **编辑弹窗 iOS 键盘遮挡**：依赖现有 `.modal` 居中布局，必要时联调观察是否需 `scrollIntoView`。
4. **登录态下拉取时机**：`afterLogin`/`pull()` 整体覆盖 `state.txns`；若用户在删除推送在途期间触发 `pull()`，云端可能尚未删除而把该项重新拉回（低概率边界，再次删除即可）。
5. **`records-empty` 与"从未记录"**：首启无数据时「我的记录」区显示空提示（当前默认常显，产品可后续决定是否折叠）。
