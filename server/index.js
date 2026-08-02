// 服务入口：同时提供 API 与静态前端（同源，避免 CORS 与跨域存储问题）
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const auth = require('./auth');
const api = require('./api');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', function (req, res) { res.json({ ok: true }); });
app.use('/api/auth', auth.router);
app.use('/api', api);

// 静态前端（项目根目录，server 的上一级）
const rootDir = path.join(__dirname, '..');
// 简单防护：禁止通过静态服务读到服务端源码/依赖/环境变量
app.use(function (req, res, next) {
  const p = req.path || '';
  if (p.indexOf('/server/') === 0 || p.indexOf('/node_modules/') === 0 || p.indexOf('/.env') === 0) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(rootDir, { extensions: ['html'] }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('安记 server 已启动：http://localhost:' + PORT);
});
