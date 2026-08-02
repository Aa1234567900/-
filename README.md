# 安记 (Ānjì) — 温和记账 App

> 一个低记录成本、非评判式的个人记账 PWA：帮助你**理解自己的消费行为**，而不是强迫节省。

「安记」的核心理念是：用户能看到"花了多少钱"，却不一定理解"钱为什么花、是否值得"。本产品把重点放在 **理解 → 自主选择 → 心安理得**，而非提醒 → 批判 → 被迫节省。纯静态前端、可离线、可"安装"到手机/电脑桌面，数据默认只存在本机。

## 功能列表

### 三大核心页面

| 页面 | 作用 | 关键约束 |
| --- | --- | --- |
| **消费 (Home)** | 本月支出、可选「目标」模块（本月收入/支出/当前储蓄/完成率）、最近记录；右上角「＋目标」可设目标（名称/金额/备注） | 不显示超支警告、不使用羞耻/焦虑语言 |
| **记一笔 (Quick Log)** | 数字键盘输入金额 → 可选备注触发规则分类 → 一键完成 | 不出现 Why Tag、不使用 AI；目标 3–5 秒完成 |
| **理解 (Insight)** | 趋势（分类/环比/近6月）、聚合式复盘（系统聚合消费群组、用户判断意义标签）、规则生成一句非评判式总结、目标月度回顾 | 不使用 LLM、不做复杂预测 |

### ✨ 本次新增：「我的记录」管理区（记一笔页下半部）

- **查找**：按关键词（备注）、分类、日期范围组合筛选记账记录
- **编辑**：就地修改金额 / 备注 / 分类
- **删除**：二次确认 + **5 秒撤销**（撤销期内可一键恢复）
- **云同步**：登录态下自动同步云端——`_deleted` 墓碑标记删除、`updatedAt` 末写胜出（LWW）解决多设备冲突
- 质量保障：增量流程文档齐备（PRD / 设计 / 代码摘要 / QA 报告，见 [`docs/incremental/`](docs/incremental/)），jsdom 端到端测试 **12/12 通过**

### 其他能力

- **PWA**：可安装到主屏幕/桌面，独立窗口运行，离线可打开（Service Worker 缓存应用壳）
- **双模式运行**：仅本地模式（IndexedDB，不上传）/ 云端账号模式（登录后多设备同步，本地仍为权威存储 + 离线缓存）
- **规则分类**：Rule-based 关键词匹配；「聚合式复盘」由本地规则实现，未接入 LLM
- **匿名埋点（可选）**：URL 加 `?debug=1` 显示测试数据导出面板，不记录金额/备注等隐私字段

## 技术栈

- **前端**：纯静态 HTML + CSS + 原生 JavaScript（无框架、无构建步骤）
- **本地存储**：IndexedDB（零依赖封装 [`localdb.js`](localdb.js)，不支持时自动降级 `localStorage`）
- **PWA**：`manifest.webmanifest` + `sw.js`（应用壳缓存）+ `icons/` 三套图标
- **后端（可选）**：Node.js + Express + SQLite（better-sqlite3），JWT 账号认证，见 [`server/`](server/) 与 [`docs/DEPLOY.md`](docs/DEPLOY.md)
- **测试**：jsdom 端到端测试（真实 DOM、模拟用户交互，`node:assert` 断言，无测试框架）

## 项目结构

```
anjie-app/
├── index.html                  # 单页应用入口（三大页面 + 我的记录管理区）
├── app.js                      # 前端主逻辑（记账/目标/理解/我的记录/云同步调度）
├── styles.css                  # 全部样式
├── localdb.js                  # 本地存储封装（IndexedDB 优先，降级 localStorage）
├── cloud.js                    # 云同步客户端（登录/拉取/推送，_deleted 墓碑 + updatedAt 末写胜出）
├── sw.js                       # Service Worker（应用壳缓存，离线可用）
├── manifest.webmanifest        # PWA 应用清单
├── .nojekyll                   # GitHub Pages：关闭 Jekyll 处理
├── icons/                      # PWA 图标（192 / 512 / maskable 三套 PNG）
├── docs/                       # 产品与部署文档
│   ├── PRD.md / DEPLOY.md / …  # 基线文档
│   └── incremental/            # 本次「我的记录」增量流程文档
│       ├── incremental-prd-records.md
│       ├── incremental-design-records.md
│       ├── incremental-code-summary.md
│       ├── incremental-qa-report.md
│       ├── class-diagram.mermaid
│       └── sequence-diagram.mermaid
├── test/
│   └── incremental-records.test.js   # 「我的记录」jsdom 端到端测试（12/12 通过）
└── server/                     # 可选云端后端（账号 + 同步）
    ├── index.js                # 入口：静态托管前端 + 挂载 API（同源）
    ├── api.js                  # 数据同步 API
    ├── auth.js                 # 注册 / 登录 / JWT
    ├── db.js                   # SQLite 初始化
    ├── package.json
    └── .env.example            # 环境变量示例（复制为 .env 后修改）
```

## 快速开始

### 方式一：纯本地（最简单，无需后端）

直接用浏览器打开 `index.html` 即可。数据只存本机（IndexedDB），刷新/重启/离线都不丢。

> ⚠️ `file://` 协议下 PWA 安装与离线缓存不启用（Service Worker 需要 `http(s)`），记账等核心功能不受影响。

### 方式二：本地静态服务（无需后端，可体验 PWA）

```bash
npx serve .
# 浏览器访问终端提示的地址（默认 http://localhost:3000）
```

### 方式三：带云端后端（账号 + 多设备同步）

```bash
cd server
npm install
cp .env.example .env   # 然后编辑 .env，务必修改 JWT_SECRET
npm start
# 浏览器访问 http://localhost:3000 （前端与 API 同源托管）
```

## 运行测试

「我的记录」管理区的 jsdom 端到端测试（查找 / 编辑 / 删除+撤销 / 云同步，共 12 例）：

```bash
# 任选其一提供 jsdom：
npm i -D jsdom          # 方式 A：本地安装 devDependency
# 或
NODE_PATH=/path/to/node_modules node test/incremental-records.test.js   # 方式 B：指向已有 jsdom

node test/incremental-records.test.js
# 输出 12/12 PASS 即通过
```

## 部署

### GitHub Pages（纯静态，仅本地模式）

仓库已包含 `.nojekyll`（关闭 Jekyll 处理，保证下划线开头路径与 PWA 文件原样发布）。推送后：仓库 **Settings → Pages → Source** 选择分支与根目录即可。前端为纯静态，GitHub Pages 上自动以「仅本地模式」运行（数据存浏览器 IndexedDB）。

### 云端后端（账号 + 同步）

GitHub Pages 等纯静态托管**无法运行 Node 后端**。需要账号与云端持久化时，请部署到支持 Node 运行时 + 持久磁盘的平台（推荐 Render / Railway），务必设置 `JWT_SECRET` 并挂载数据盘，详见 **[`docs/DEPLOY.md`](docs/DEPLOY.md)**。

## 数据说明

- 本地数据由 [`localdb.js`](localdb.js) 统一管理：优先 IndexedDB（库名 `anjie_local_db`，仓库 `txns` / `goals`），不支持时自动降级 `localStorage`，并内置一次性历史数据迁移（幂等）。
- **仅本地模式**：数据只存本机，不上传。
- **云端账号模式**：登录后按账号隔离同步；本地仍以 IndexedDB 为权威存储与离线缓存；删除以 `_deleted` 墓碑同步、冲突按 `updatedAt` 末写胜出。

## 产品原则（不可突破）

非评判 · 低摩擦 · 目标导向 · 用户自主权。

不实现：支付 / 社交 / 贷款 / 投资 / 预算报警 / 理财推销 / AI 基础记账 / 自动把结余计入目标。

## License

[MIT](LICENSE) © 2026 Anjie Contributors

---

*本项目为 MVP Prototype，用于验证「用户是否愿意以极低成本记录消费，并逐渐理解自己的消费行为」。*
