'use strict';
/**
 * 管理后台 API（需管理员登录）
 */
const express = require('express');
const { db, getSetting, setSetting, hashPassword } = require('../lib/db');
const { login, requireAdmin } = require('../lib/auth');
const { redeliverOrder, refundOrder, orderCards } = require('../lib/payment');

const router = express.Router();

/* ---------- 登录限流 ---------- */
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { times: [], blockedUntil: 0 };
  if (rec.blockedUntil > now) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  rec.times = rec.times.filter((t) => now - t < 10 * 60 * 1000);
  if (rec.times.length >= 8) {
    rec.blockedUntil = now + 10 * 60 * 1000;
    loginAttempts.set(ip, rec);
    return res.status(429).json({ error: '尝试过于频繁，已临时锁定，请 10 分钟后再试' });
  }
  rec.times.push(now);
  loginAttempts.set(ip, rec);
  next();
}

router.post('/login', loginRateLimit, (req, res) => {
  const token = login(String((req.body || {}).password || ''));
  if (!token) return res.status(401).json({ error: '密码错误' });
  res.json({ token });
});

/* ---------- 仪表盘 ---------- */
router.get('/dashboard', requireAdmin, (req, res) => {
  const today = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders
      WHERE status='PAID' AND paid_at >= date('now','localtime')`)
    .get();
  const totalPaid = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders WHERE status='PAID'`)
    .get();
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status='PENDING'`).get().n;
  const shortage = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status='PAID' AND deliver_status='shortage'`).get().n;
  const stock = db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE status=0`).get().n;
  const sold = db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE status=1`).get().n;
  const productCount = db.prepare(`SELECT COUNT(*) AS n FROM products`).get().n;
  const onSale = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE status=1`).get().n;
  const recent = db
    .prepare(`SELECT o.*, (SELECT COUNT(*) FROM cards k WHERE k.order_id=o.id) AS card_count
      FROM orders o ORDER BY o.id DESC LIMIT 8`)
    .all();
  res.json({
    today: { count: today.n, amount: Math.round(today.amount * 100) / 100 },
    totalPaid: { count: totalPaid.n, amount: Math.round(totalPaid.amount * 100) / 100 },
    pending,
    shortage,
    stock,
    sold,
    productCount,
    onSale,
    recent,
  });
});

/* ---------- 分类 ---------- */
router.get('/categories', requireAdmin, (req, res) => {
  const rows = db
    .prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) AS product_count
      FROM categories c ORDER BY c.sort ASC, c.id ASC`)
    .all();
  res.json(rows);
});

router.post('/categories', requireAdmin, (req, res) => {
  const { name, icon = '🏷️', sort = 0 } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '分类名称不能为空' });
  db.prepare('INSERT INTO categories(name, icon, sort) VALUES(?,?,?)').run(String(name).trim(), String(icon), Number(sort) || 0);
  res.json({ ok: true });
});

router.put('/categories/:id', requireAdmin, (req, res) => {
  const { name, icon, sort } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '分类名称不能为空' });
  db.prepare('UPDATE categories SET name=?, icon=?, sort=? WHERE id=?').run(
    String(name).trim(), String(icon || '🏷️'), Number(sort) || 0, Number(req.params.id)
  );
  res.json({ ok: true });
});

router.delete('/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE products SET category_id=NULL WHERE category_id=?').run(id);
  db.prepare('DELETE FROM categories WHERE id=?').run(id);
  res.json({ ok: true });
});

/* ---------- 商品 ---------- */
router.get('/products', requireAdmin, (req, res) => {
  const rows = db
    .prepare(`SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM cards k WHERE k.product_id=p.id AND k.status=0) AS stock,
      (SELECT COUNT(*) FROM cards k WHERE k.product_id=p.id) AS total_cards
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      ORDER BY p.sort ASC, p.id DESC`)
    .all();
  res.json(rows);
});

router.post('/products', requireAdmin, (req, res) => {
  const { name, category_id, description = '', price, original_price, cover = '🎁', status = 1, sort = 0, stock_text } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '商品名称不能为空' });
  const p = Number(price);
  if (isNaN(p) || p < 0) return res.status(400).json({ error: '价格不合法' });
  db.prepare(
    `INSERT INTO products(category_id, name, description, price, original_price, cover, status, sort, stock_text)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(
    category_id ? Number(category_id) : null,
    String(name).trim(),
    String(description || ''),
    p,
    original_price ? Number(original_price) : null,
    String(cover || '🎁'),
    Number(status) === 0 ? 0 : 1,
    Number(sort) || 0,
    stock_text ? String(stock_text).trim() : null
  );
  res.json({ ok: true });
});

router.put('/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!exists) return res.status(404).json({ error: '商品不存在' });
  const { name, category_id, description, price, original_price, cover, status, sort, stock_text } = req.body || {};
  const p = price === undefined ? undefined : Number(price);
  if (p !== undefined && (isNaN(p) || p < 0)) return res.status(400).json({ error: '价格不合法' });
  db.prepare(
    `UPDATE products SET name=?, category_id=?, description=?, price=?, original_price=?, cover=?, status=?, sort=?, stock_text=? WHERE id=?`
  ).run(
    String(name ?? exists.name).trim(),
    category_id !== undefined ? (category_id ? Number(category_id) : null) : exists.category_id,
    description !== undefined ? String(description) : exists.description,
    p !== undefined ? p : exists.price,
    original_price !== undefined ? (original_price ? Number(original_price) : null) : exists.original_price,
    cover !== undefined ? String(cover || '🎁') : exists.cover,
    status !== undefined ? (Number(status) === 0 ? 0 : 1) : exists.status,
    sort !== undefined ? Number(sort) || 0 : exists.sort,
    stock_text !== undefined ? String(stock_text || '').trim() || null : exists.stock_text,
    id
  );
  res.json({ ok: true });
});

router.delete('/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const sold = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE product_id=? AND status=1').get(id).n;
  if (sold > 0) return res.status(400).json({ error: '该商品已有售出卡密，不允许删除（可下架）' });
  db.prepare('DELETE FROM cards WHERE product_id=?').run(id);
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  res.json({ ok: true });
});

router.put('/products/:id/status', requireAdmin, (req, res) => {
  const status = Number((req.body || {}).status) === 0 ? 0 : 1;
  db.prepare('UPDATE products SET status=? WHERE id=?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

/* ---------- 卡密 ---------- */
router.get('/cards', requireAdmin, (req, res) => {
  const { product_id, status, page = 1, page_size = 20 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (product_id) { where += ' AND k.product_id=?'; params.push(Number(product_id)); }
  if (status !== undefined && status !== '') { where += ' AND k.status=?'; params.push(Number(status)); }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM cards k ${where}`).get(...params).n;
  const list = db
    .prepare(`SELECT k.*, p.name AS product_name, o.order_no
      FROM cards k LEFT JOIN products p ON p.id=k.product_id LEFT JOIN orders o ON o.id=k.order_id
      ${where} ORDER BY k.id DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(page_size), (Number(page) - 1) * Number(page_size));
  res.json({ total, page: Number(page), page_size: Number(page_size), list });
});

router.post('/cards/import', requireAdmin, (req, res) => {
  const { product_id, text } = req.body || {};
  const pid = Number(product_id);
  const product = db.prepare('SELECT id FROM products WHERE id=?').get(pid);
  if (!product) return res.status(400).json({ error: '商品不存在' });
  if (!text || !String(text).trim()) return res.status(400).json({ error: '卡密内容不能为空' });

  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: '未解析到有效卡密' });

  const existing = new Set(
    db.prepare('SELECT secret FROM cards WHERE product_id=?').all(pid).map((r) => r.secret)
  );
  const ins = db.prepare('INSERT INTO cards(product_id, secret) VALUES(?,?)');
  const tx = db.transaction(() => {
    let inserted = 0, dup = 0;
    for (const line of lines) {
      if (existing.has(line)) { dup++; continue; }
      ins.run(pid, line);
      existing.add(line);
      inserted++;
    }
    return { inserted, dup };
  });
  const result = tx();
  res.json({ ok: true, ...result, total: lines.length });
});

router.post('/cards/delete', requireAdmin, (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) return res.status(400).json({ error: '未选择卡密' });
  const del = db.prepare('DELETE FROM cards WHERE id=? AND status=0');
  const tx = db.transaction(() => {
    let n = 0;
    for (const id of ids) n += del.run(id).changes;
    return n;
  });
  res.json({ ok: true, deleted: tx() });
});

router.get('/cards/export', requireAdmin, (req, res) => {
  const { product_id } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (product_id) { where += ' AND product_id=?'; params.push(Number(product_id)); }
  const rows = db.prepare(`SELECT id, secret, status, order_id FROM cards ${where} ORDER BY id ASC`).all(...params);
  const csv = '\uFEFFID,卡密,状态,关联订单ID\n' +
    rows.map((r) => [r.id, r.secret, r.status === 0 ? '未售' : '已售', r.order_id || ''].join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cards_${product_id || 'all'}_${Date.now()}.csv"`);
  res.send(csv);
});

/* ---------- 订单 ---------- */
router.get('/orders', requireAdmin, (req, res) => {
  const { status, keyword = '', page = 1, page_size = 20 } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (status && status !== 'ALL') { where += ' AND o.status=?'; params.push(String(status)); }
  if (keyword) {
    where += ' AND (o.order_no LIKE ? OR o.contact LIKE ? OR o.trade_no LIKE ?)';
    const kw = `%${String(keyword).trim()}%`;
    params.push(kw, kw, kw);
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o ${where}`).get(...params).n;
  const list = db
    .prepare(`SELECT o.*, (SELECT COUNT(*) FROM cards k WHERE k.order_id=o.id) AS card_count
      FROM orders o ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(page_size), (Number(page) - 1) * Number(page_size));
  res.json({ total, page: Number(page), page_size: Number(page_size), list });
});

router.get('/orders/:orderNo', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no=?').get(String(req.params.orderNo));
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json({ ...order, cards: orderCards(order.id) });
});

router.post('/orders/:orderNo/deliver', requireAdmin, (req, res) => {
  const result = redeliverOrder(String(req.params.orderNo));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true, ...result });
});

router.post('/orders/:orderNo/refund', requireAdmin, (req, res) => {
  const result = refundOrder(String(req.params.orderNo));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true });
});

/* 删除订单：仅允许删除 未支付 / 已关闭 / 已退款 的订单；已支付订单必须先退款（保护已发卡密） */
function deleteOrderByNo(orderNo) {
  const order = db.prepare('SELECT * FROM orders WHERE order_no=?').get(String(orderNo));
  if (!order) return { ok: false, reason: '订单不存在' };
  if (order.status === 'PAID') return { ok: false, reason: '订单已支付并可能已发货，请先「退款」释放卡密后再删除' };
  const delivered = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE order_id=? AND status=1').get(order.id).n;
  if (delivered > 0) return { ok: false, reason: '该订单已发卡密，请先退款后再删除' };
  db.prepare('DELETE FROM cards WHERE order_id=?').run(order.id);
  db.prepare('DELETE FROM orders WHERE id=?').run(order.id);
  return { ok: true };
}

router.delete('/orders/:orderNo', requireAdmin, (req, res) => {
  const result = deleteOrderByNo(String(req.params.orderNo));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true });
});

router.post('/orders/batch-delete', requireAdmin, (req, res) => {
  const nos = Array.isArray((req.body || {}).nos) ? req.body.nos.map(String).filter(Boolean) : [];
  if (!nos.length) return res.status(400).json({ error: '未选择订单' });
  const results = { ok: 0, skipped: [], reasons: [] };
  const tx = db.transaction(() => {
    for (const no of nos) {
      const r = deleteOrderByNo(no);
      if (r.ok) results.ok++;
      else { results.skipped.push(no); results.reasons.push(no + '：' + r.reason); }
    }
  });
  tx();
  res.json({ ok: true, ...results });
});

/* ---------- 系统设置 ---------- */
const SETTING_KEYS = ['site_name', 'site_subtitle', 'site_notice', 'service_qq',
  'service_wechat', 'service_wechat_qr', 'service_tg', 'require_contact',
  'pay_mock', 'alipay_appid', 'alipay_private_key', 'alipay_public_key', 'alipay_gateway', 'alipay_method'];

router.get('/settings', requireAdmin, (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k, '');
  out.admin_set = !!(getSetting('admin_salt', '') && getSetting('admin_hash', ''));
  res.json(out);
});

router.put('/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  for (const k of SETTING_KEYS) {
    if (body[k] !== undefined) setSetting(k, String(body[k]));
  }
  // 校验关键枚举
  const mock = getSetting('pay_mock', '0');
  if (mock !== '0' && mock !== '1') setSetting('pay_mock', '0');
  const gateway = getSetting('alipay_gateway', 'prod');
  if (!['prod', 'sandbox'].includes(gateway)) setSetting('alipay_gateway', 'prod');
  const method = getSetting('alipay_method', 'page_pay');
  if (!['page_pay', 'precreate', 'wap_pay', 'auto'].includes(method)) setSetting('alipay_method', 'page_pay');
  const reqContact = getSetting('require_contact', '1');
  if (!['0', '1'].includes(reqContact)) setSetting('require_contact', '1');

  const np = body.newPassword;
  if (np) {
    if (String(np).length < 6) return res.status(400).json({ error: '新密码长度至少 6 位' });
    if (np !== body.confirmPassword) return res.status(400).json({ error: '两次输入的密码不一致' });
    const salt = getSetting('admin_salt', '') || require('crypto').randomBytes(16).toString('hex');
    setSetting('admin_salt', salt);
    setSetting('admin_hash', hashPassword(np, salt));
  }
  res.json({ ok: true });
});

module.exports = router;
