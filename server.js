'use strict';
/**
 * 发卡服务系统入口
 * 启动：node server.js   （环境变量 PORT 可改端口，默认 3000）
 */
const path = require('path');
const express = require('express');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 商城 API
app.use('/api', publicRoutes);
// 管理 API
app.use('/api/admin', adminRoutes);

// 静态前端
app.use(express.static(path.join(__dirname, 'public')));

// 统一错误兜底
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ 发卡服务已启动：http://localhost:${PORT}`);
    console.log(`   商城首页   http://localhost:${PORT}/`);
    console.log(`   管理后台   http://localhost:${PORT}/admin.html`);
  });
}

module.exports = app;
