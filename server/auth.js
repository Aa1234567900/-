// 账号系统：邮箱/密码注册登录 + JWT 签发与鉴权中间件
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '30d';

function sign(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// 鉴权中间件：校验 Bearer Token，把用户 id 挂到 req.userId
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已失效' });
  }
}

router.post('/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: '该邮箱已注册' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(email, hash, Date.now());
  const token = sign(info.lastInsertRowid);
  res.json({ token, user: { id: info.lastInsertRowid, email } });
});

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  const token = sign(row.id);
  res.json({ token, user: { id: row.id, email: row.email } });
});

router.get('/me', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.userId);
  if (!row) return res.status(401).json({ error: '未登录' });
  res.json({ user: { id: row.id, email: row.email } });
});

module.exports = { router, authMiddleware, sign };
