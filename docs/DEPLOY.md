# 安记 (Ānjì) — 云端部署指南

本文档说明如何把「安记」从本地原型升级为一个**真正可发布到云端、带账号与云端数据存储**的应用。

---

## 1. 架构总览

```
┌──────────────┐        同源 HTTP /api/*        ┌──────────────────────┐
│  前端 (静态)  │  ───────────────────────────▶  │   Node 后端 (Express) │
│  index.html  │   register / login /           │  - JWT 鉴权           │
│  app.js      │   txns sync / goals            │  - 行级隔离(user_id)  │
│  cloud.js    │                                │  - SQLite (better-   │
│  styles.css  │  ◀───────────────────────────  │    sqlite3, WAL)     │
└──────────────┘   返回 JSON                     └──────────────────────┘
                                                        │
                                                        ▼
                                              data/anjie.db  (持久磁盘)
```

- **前端**：纯原生 JS（无框架、无构建），由后端同源托管，避免 CORS 与跨域存储问题。
- **后端**：`server/` 目录，Express + better-sqlite3。
- **账号**：邮箱 + 密码（bcrypt 哈希），登录后签发 JWT（30 天），后续请求带 `Authorization: Bearer <token>`。
- **数据隔离**：所有查询按 JWT 中的 `user_id` 过滤，等效行级安全——用户 A 永远读不到用户 B 的数据。
- **同步模型**：交易(txns)全量同步，按 `updatedAt` 后写覆盖（last-write-wins），带 `_deleted` 标记即删除；目标(goals)每个用户一份完整文档。

> 前端逻辑（`cloud.js`）在登录后把云端作为权威源：`save()` 时 fire-and-forget 推送到云端；本地 `localStorage` 仍作为离线缓存。未登录时完全本地运行（"仅本地模式"）。

---

## 2. 本地运行 / 自测

```bash
# 1) 安装后端依赖
cd server
npm install

# 2) 配置环境变量（可选，有默认值）
cp .env.example .env
#   编辑 .env：把 JWT_SECRET 改成一段随机长字符串
#   openssl rand -base64 48

# 3) 启动（同时托管前端 + API，默认端口 3000）
npm start
# 浏览器打开 http://localhost:3000
```

冒烟测试（需先启动服务）：

```bash
node /tmp/anjie_smoke.js   # 21 项端到端断言：注册/登录/鉴权/同步/隔离/静态防护
```

---

## 3. 发布到云端（推荐：Render 或 Railway）

> ⚠️ **重要**：此前的 CloudStudio 临时链接是**纯静态托管**，只能跑前端，**无法运行 Node 后端**。
> 要让账号与云端存储真正生效，必须部署到一个**支持 Node.js 运行时 + 持久磁盘**的平台。
> 下面给出两个最省心的选项（免费额度足够个人使用）。

### 选项 A：Render（最简单）

1. 把整个仓库（含 `server/`）推到 GitHub。
2. 打开 https://render.com → **New → Web Service** → 关联仓库。
3. 构建与启动配置：
   - **Runtime**: Node
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `cd server && node index.js`
4. **环境变量**（Render 面板的 Environment 里填）：
   - `PORT` → 留空让 Render 注入（代码已 `process.env.PORT || 3000`）
   - `JWT_SECRET` → 一段随机长字符串（**务必改**，否则任何人可伪造 token）
   - `DATA_DIR` → 例如 `/var/data`（指向 Render 的持久磁盘挂载点）
5. 在 Disk 设置里挂一块 **Persistent Disk**（路径与 `DATA_DIR` 一致），否则容器重启后数据库会丢失。
6. 部署完成后，Render 给一个 `https://anjie-xxx.onrender.com`，直接访问即可使用（PWA 可安装）。

### 选项 B：Railway

1. 推送到 GitHub 后，https://railway.app → **New Project → Deploy from GitHub repo**。
2. Railway 会自动识别 Node；在 **Settings → Deploy** 里把：
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `cd server && node index.js`
3. **Variables** 里加 `JWT_SECRET`、`DATA_DIR`（Railway 提供持久卷，挂载后用其路径）。
4. 生成域名后即可访问。

### 通用注意

- 静态前端由后端同源返回，**无需单独托管前端**。
- 平台都会在请求头注入 `PORT`，`index.js` 已兼容；不要硬编码端口。
- **务必设置强 `JWT_SECRET`**，且不要提交真实 `.env` 到仓库（已加入 `.gitignore` 建议）。

---

## 4. 数据库升级路径（SQLite → PostgreSQL）

当前用 SQLite（单文件、零运维），适合个人/小规模。若要支撑多用户高并发，可平滑迁移到 Postgres：

1. **换驱动**：`npm uninstall better-sqlite3` → `npm install pg`；在 `server/db.js` 改用 `pg` 连接池。
2. **改语句**（要点）：
   - `INSERT ... ON CONFLICT(user_id, client_id) DO UPDATE` → Postgres 语法一致（需先 `CREATE UNIQUE INDEX`）；
   - `INSERT ... ON CONFLICT(user_id) DO UPDATE` → 同理；
   - 占位符 `?` → `$1, $2 ...`；
   - `JSON.stringify` 存储的列可改用 Postgres 原生 `JSONB`，读写更稳。
3. **连接串**：用 `DATABASE_URL` 环境变量；`db.js` 据 `DATABASE_URL` 是否存在自动选择 SQLite / Postgres（推荐做法，本地仍用 SQLite，云端用 Postgres）。
4. **迁移已有数据**：SQLite 数据量小，可在低峰期用一次性脚本导出 JSON 再导入 Postgres；或首版直接全新 Postgres、放弃迁移旧本地库。

> 数据隔离逻辑（`user_id` 过滤）与 API 契约**完全不用改**，只动 `db.js` 与 `api.js` 里的 SQL 语句。

---

## 5. 安全与运维清单

- [ ] 已设置**强随机 `JWT_SECRET`**，且未提交到仓库。
- [ ] 已挂载**持久磁盘**（`DATA_DIR`），避免容器重启丢库。
- [ ] 后端已通过 `.gitignore` 忽略 `server/.env`、`server/data/`。
- [ ] 静态服务已屏蔽 `/server/`、`/node_modules/`、`/.env`（代码已做）。
- [ ] 密码使用 bcrypt 哈希，明文不入库存。
- [ ] 生产环境建议加 HTTPS（Render/Railway 默认提供）。
- [ ] 如需找回密码/邮箱验证，可后续在 `server/auth.js` 扩展。

---

## 6. 文件清单（本次云端化改动）

| 文件 | 作用 |
| --- | --- |
| `server/index.js` | 入口：API + 同源静态托管 + 路径防护 |
| `server/db.js` | SQLite 初始化与建表（users / txns / goals），WAL |
| `server/auth.js` | 注册/登录/me，JWT 签发与鉴权中间件 |
| `server/api.js` | txns 同步、goals 读写（按 user_id 隔离） |
| `server/.env.example` | 环境变量示例（PORT / JWT_SECRET / DATA_DIR） |
| `cloud.js` | 前端云端层：登录态、pull/push、localStorage 缓存 |
| `index.html` | 新增登录/注册屏 `#auth-screen` 与用户条 `#user-bar` |
| `app.js` | `save()` 推送云端、`init()` 鉴权流转、`wireAuth()` 等 |
| `styles.css` | 登录屏与用户条样式 |
