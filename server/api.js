// 数据同步 API：交易(txns) / 目标(goals)。所有查询按 JWT 中的 user_id 隔离（等效行级安全）。
const express = require('express');
const db = require('./db');
const { authMiddleware } = require('./auth');

const router = express.Router();
router.use(authMiddleware);

// 交易：全量读取
router.get('/txns', (req, res) => {
  const rows = db.prepare('SELECT payload FROM txns WHERE user_id = ?').all(req.userId);
  res.json({ items: rows.map(function (r) { return JSON.parse(r.payload); }) });
});

// 交易：全量同步（last-write-wins，按 updatedAt 覆盖；带 _deleted 标记则删除）
router.post('/txns/sync', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const now = Date.now();
  const upsert = db.prepare(
    'INSERT INTO txns (user_id, client_id, payload, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(user_id, client_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
  );
  const del = db.prepare('DELETE FROM txns WHERE user_id = ? AND client_id = ?');
  const tx = db.transaction(function () {
    items.forEach(function (it) {
      if (!it || !it.id) return;
      if (it._deleted) { del.run(req.userId, String(it.id)); return; }
      upsert.run(req.userId, String(it.id), JSON.stringify(it), it.updatedAt || now);
    });
  });
  tx();
  res.json({ ok: true, serverTime: now });
});

// 目标：单文档读取（每个用户一份 {targets, monthlyGoal}）
router.get('/goals', (req, res) => {
  const row = db.prepare('SELECT payload FROM goals WHERE user_id = ?').get(req.userId);
  res.json(row ? JSON.parse(row.payload) : { targets: [], monthlyGoal: null });
});

// 目标：保存（持久化完整 payload：targets / monthlyGoal / catTags / rules）
router.post('/goals', (req, res) => {
  const payload = JSON.stringify(req.body || {});
  db.prepare(
    'INSERT INTO goals (user_id, payload, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
  ).run(req.userId, payload, Date.now());
  res.json({ ok: true });
});

module.exports = router;
