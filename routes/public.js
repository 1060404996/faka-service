'use strict';
/**
 * 商城对外 API（无需登录）
 */
const express = require('express');
const QRCode = require('qrcode');
const { db, getSetting } = require('../lib/db');
const {
  isMockMode,
  getAlipay,
  buildPayment,
  handlePaidOrder,
  orderCards,
} = require('../lib/payment');

const router = express.Router();

/* ---------- 简易限流：下单接口 ---------- */
const orderRate = new Map();
function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  const now = Date.now();
  const list = (orderRate.get(ip) || []).filter((t) => now - t < 60 * 1000);
  if (list.length >= 20) return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
  list.push(now);
  orderRate.set(ip, list);
  next();
}

/* ---------- 站点信息 ---------- */
router.get('/site', (req, res) => {
  res.json({
    siteName: getSetting('site_name', '发卡商城'),
    siteSubtitle: getSetting('site_subtitle', ''),
    siteNotice: getSetting('site_notice', ''),
    serviceQQ: getSetting('service_qq', ''),
    serviceWechat: getSetting('service_wechat', ''),
    serviceWechatQr: getSetting('service_wechat_qr', ''),
    serviceTg: getSetting('service_tg', ''),
    requireContact: getSetting('require_contact', '1'),
    payMock: isMockMode(),
  });
});

/* ---------- 分类 ---------- */
router.get('/categories', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, icon FROM categories ORDER BY sort ASC, id ASC')
    .all();
  res.json(rows);
});

/* ---------- 商品列表 ---------- */
router.get('/products', (req, res) => {
  const { category_id: cid, keyword = '' } = req.query;
  let sql = `SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM cards k WHERE k.product_id = p.id AND k.status = 0) AS stock
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 1`;
  const params = [];
  if (cid) {
    sql += ' AND p.category_id = ?';
    params.push(Number(cid));
  }
  if (keyword) {
    sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  sql += ' ORDER BY p.sort ASC, p.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

/* ---------- 商品详情 ---------- */
router.get('/products/:id', (req, res) => {
  const row = db
    .prepare(`SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM cards k WHERE k.product_id = p.id AND k.status = 0) AS stock
      FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.status = 1`)
    .get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '商品不存在或已下架' });
  res.json(row);
});

/* ---------- 创建订单 ---------- */
router.post('/orders', rateLimit, async (req, res) => {
  try {
    const { productId, quantity, contact } = req.body || {};
    // 联系方式：后台可设「必填 / 选填」
    if (getSetting('require_contact', '1') === '1' && !String(contact || '').trim()) {
      return res.status(400).json({ error: '请填写联系方式（手机号 / 邮箱 / QQ），便于支付后查询卡密' });
    }
    const qty = Math.max(1, Math.min(50, Math.floor(Number(quantity) || 1)));
    const product = db
      .prepare('SELECT * FROM products WHERE id = ? AND status = 1')
      .get(Number(productId));
    if (!product) return res.status(404).json({ error: '商品不存在或已下架' });

    const stock = db
      .prepare('SELECT COUNT(*) AS n FROM cards WHERE product_id = ? AND status = 0')
      .get(product.id).n;
    if (stock < qty) return res.status(400).json({ error: '库存不足，当前仅剩 ' + stock + ' 件' });

    const total = Math.round(product.price * qty * 100) / 100;
    const orderNo = 'F' + new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14) +
      String(Math.floor(Math.random() * 90) + 10);

    const info = db
      .prepare(
        `INSERT INTO orders(order_no, product_id, product_name, quantity, unit_price, total, contact)
         VALUES(?,?,?,?,?,?,?)`
      )
      .run(orderNo, product.id, product.name, qty, product.price, total, String(contact || '').trim());

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
    const payment = await buildPayment(req, order);
    res.json({ orderNo, ...payment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 订单状态 / 卡密查询（已支付订单需凭联系方式） ---------- */
router.get('/orders/:orderNo', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(String(req.params.orderNo));
  if (!order) return res.status(404).json({ error: '订单不存在' });

  const base = {
    orderNo: order.order_no,
    productName: order.product_name,
    quantity: order.quantity,
    total: order.total,
    status: order.status,
    deliverStatus: order.deliver_status,
    paidAt: order.paid_at,
    createdAt: order.created_at,
  };
  if (order.status === 'PAID') {
    const contact = String(req.query.contact || '').trim();
    if (order.contact && order.contact !== contact) {
      return res.status(403).json({ error: '该订单设置了联系方式，需凭下单时填写的联系方式查询' });
    }
    base.cards = orderCards(order.id).map((c) => c.secret);
  }
  res.json(base);
});

/* ---------- 支付二维码（dataURL，供前端渲染） ---------- */
router.get('/orders/:orderNo/qr', async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(String(req.params.orderNo));
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.status !== 'PENDING') return res.status(400).json({ error: '订单状态不允许生成支付二维码' });
    const { payType, payUrl, qrCode } = await buildPayment(req, order);
    // 手机网站支付：前端直接跳转支付宝，无需二维码
    if (payType === 'wap_pay') {
      return res.json({ payType, dataUrl: '', payUrl });
    }
    // 演示模式下二维码以订单号占位（前端会隐藏二维码区域，仅展示模拟支付按钮）
    const text = payType === 'precreate' ? qrCode : (payUrl || order.order_no);
    const dataUrl = await QRCode.toDataURL(text, { width: 300, margin: 1 });
    res.json({ payType, dataUrl, payUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- 演示模式：模拟支付宝支付成功回调 ---------- */
router.post('/dev/pay/:orderNo', (req, res) => {
  if (!isMockMode()) return res.status(403).json({ error: '当前为正式支付模式，请勿调用模拟接口' });
  const result = handlePaidOrder(String(req.params.orderNo), 'MOCK' + Date.now(), null);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true, shortage: result.shortage });
});

/* ---------- 支付宝异步通知（验签 + 自动发卡） ---------- */
router.post('/alipay/notify', async (req, res) => {
  const params = req.body || {};
  if (isMockMode()) return res.send('success'); // 演示模式下不校验

  try {
    const alipay = getAlipay(req);
    if (!alipay.verify(params)) return res.send('fail');

    const appid = getSetting('alipay_appid', '');
    if (params.app_id !== appid) return res.send('fail');

    const { out_trade_no, trade_no, trade_status, total_amount } = params;
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(trade_status)) return res.send('success');
    const result = handlePaidOrder(out_trade_no, trade_no || '', total_amount);
    if (!result.ok && result.reason !== 'order_status_PAID') {
      console.error('[notify] 处理失败', out_trade_no, result);
      return res.send('fail');
    }
    res.send('success');
  } catch (err) {
    console.error('[notify] 异常', err);
    res.send('fail');
  }
});

/* ---------- 支付宝同步跳转 ---------- */
router.get('/alipay/return', (req, res) => {
  const orderNo = req.query.out_trade_no || '';
  res.redirect('/pay.html?orderNo=' + encodeURIComponent(orderNo));
});

module.exports = router;
