'use strict';
/**
 * 支付与自动发卡业务层：
 * - 依据配置实例化支付宝客户端
 * - 支付成功后的自动发货（事务内锁定并分配卡密）
 */
const { db, getSetting } = require('./db');
const { Alipay } = require('./alipay');

function isMockMode() {
  return getSetting('pay_mock', '0') === '1';
}

/** 站点完整地址（用于拼 notify_url / return_url） */
function siteBase(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}

/** 移动端 UA 判断（用于自动识别支付方式） */
function isMobileUA(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  return /mobile|android|iphone|ipad|ipod|windows phone/i.test(ua);
}

function getAlipay(req) {
  return new Alipay({
    appid: getSetting('alipay_appid', ''),
    privateKey: getSetting('alipay_private_key', ''),
    alipayPublicKey: getSetting('alipay_public_key', ''),
    gateway: getSetting('alipay_gateway', 'prod'),
    notifyUrl: siteBase(req) + '/api/alipay/notify',
    returnUrl: siteBase(req) + '/api/alipay/return',
  });
}

/** 为订单生成支付参数（mock / page_pay / precreate） */
async function buildPayment(req, order) {
  if (isMockMode()) {
    return { payType: 'mock', payUrl: '', qrCode: '' };
  }
  const alipay = getAlipay(req);
  const method = getSetting('alipay_method', 'page_pay');
  const subject = `${getSetting('site_name', '发卡商城')} · ${order.product_name} ×${order.quantity}`;
  if (method === 'precreate') {
    const qrCode = await alipay.precreate({
      outTradeNo: order.order_no,
      totalAmount: order.total,
      subject,
    });
    return { payType: 'precreate', payUrl: '', qrCode };
  }
  // 自动识别：电脑 → 电脑网站支付；手机/平板 → 手机网站支付
  const realMethod = method === 'auto' ? (isMobileUA(req) ? 'wap_pay' : 'page_pay') : method;
  if (realMethod === 'wap_pay') {
    const payUrl = alipay.wapPayUrl({
      outTradeNo: order.order_no,
      totalAmount: order.total,
      subject,
    });
    return { payType: 'wap_pay', payUrl, qrCode: '' };
  }
  const payUrl = alipay.pagePayUrl({
    outTradeNo: order.order_no,
    totalAmount: order.total,
    subject,
  });
  return { payType: 'page_pay', payUrl, qrCode: '' };
}

/**
 * 支付成功处理：事务内给订单分配卡密并标记已支付。
 * 库存不足时照常收款但标记 deliver_status='shortage'，由后台补发。
 * 返回 { ok, shortage }
 */
function handlePaidOrder(orderNo, tradeNo, paidAmount) {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (order.status === 'PAID') return { ok: true, already: true };
  if (order.status !== 'PENDING') return { ok: false, reason: 'order_status_' + order.status };

  if (paidAmount !== undefined && paidAmount !== null) {
    const diff = Math.abs(Number(paidAmount) - Number(order.total));
    if (diff > 0.01) return { ok: false, reason: 'amount_mismatch' };
  }

  const tx = db.transaction(() => {
    const cards = db
      .prepare('SELECT id FROM cards WHERE product_id = ? AND status = 0 ORDER BY id LIMIT ?')
      .all(order.product_id, order.quantity);
    const upd = db.prepare('UPDATE cards SET status = 1, order_id = ? WHERE id = ?');
    for (const c of cards) upd.run(order.id, c.id);

    const delivered = cards.length;
    const shortage = delivered < order.quantity;
    db.prepare(
      `UPDATE orders SET status='PAID', deliver_status=?, trade_no=?, paid_at=datetime('now','localtime') WHERE order_no=?`
    ).run(shortage ? 'shortage' : 'ok', tradeNo || '', orderNo);
    return { delivered, shortage };
  });
  return { ok: true, ...tx() };
}

/** 后台补发：把剩余未分配的卡密补给 shortage 订单 */
function redeliverOrder(orderNo) {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (order.status !== 'PAID' || order.deliver_status !== 'shortage') {
    return { ok: false, reason: '订单无需补发（仅已支付且缺货的订单可补发）' };
  }
  const tx = db.transaction(() => {
    const delivered = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE order_id = ?').get(order.id).n;
    const need = order.quantity - delivered;
    const cards = db
      .prepare('SELECT id FROM cards WHERE product_id = ? AND status = 0 ORDER BY id LIMIT ?')
      .all(order.product_id, need);
    const upd = db.prepare('UPDATE cards SET status = 1, order_id = ? WHERE id = ?');
    for (const c of cards) upd.run(order.id, c.id);
    if (delivered + cards.length >= order.quantity) {
      db.prepare(`UPDATE orders SET deliver_status='ok' WHERE order_no=?`).run(orderNo);
      return { ok: true, added: cards.length, done: true };
    }
    return { ok: true, added: cards.length, done: false };
  });
  return tx();
}

/** 退款：标记退款并释放已分配卡密 */
function refundOrder(orderNo) {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (order.status !== 'PAID') return { ok: false, reason: '仅已支付订单可退款' };
  const tx = db.transaction(() => {
    db.prepare('UPDATE cards SET status = 0, order_id = NULL WHERE order_id = ?').run(order.id);
    db.prepare("UPDATE orders SET status='REFUNDED', deliver_status='ok' WHERE order_no=?").run(orderNo);
  });
  tx();
  return { ok: true };
}

/** 订单关联的卡密（后台可见全文） */
function orderCards(orderId) {
  return db.prepare('SELECT id, secret, status FROM cards WHERE order_id = ? ORDER BY id').all(orderId);
}

module.exports = {
  isMockMode,
  getAlipay,
  buildPayment,
  handlePaidOrder,
  redeliverOrder,
  refundOrder,
  orderCards,
};
