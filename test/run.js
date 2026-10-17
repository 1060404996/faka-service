'use strict';
/**
 * 端到端 API 测试（模拟支付模式）：
 * 站点信息 → 商品列表 → 创建订单 → 模拟支付 → 自动发卡 → 卡密查询 → 后台登录/导入/仪表盘
 */
const app = require('../server');

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  const check = (name, cond, extra = '') => {
    results.push(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '  ' + extra}`);
    if (!cond) process.exitCode = 1;
  };

  try {
    const j = async (path, opts = {}) => {
      const { token, ...rest } = opts;
      const res = await fetch(base + path, {
        ...rest,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    };

    // 站点信息
    const site = await j('/api/site');
    check('站点信息返回', site.status === 200 && !!site.body.siteName, JSON.stringify(site.body).slice(0, 80));

    // 商品列表（选择库存充足的商品，保证测试与数据库当前状态无关）
    const products = await j('/api/products');
    check('商品列表返回', products.status === 200 && products.body.length >= 1);
    const candidates = products.body.filter((p) => p.stock >= 2);
    check('存在库存 ≥ 2 的商品', candidates.length >= 1);
    const pid = candidates[0].id;
    const stockBefore = candidates[0].stock;
    check('演示库存 > 0', stockBefore > 0, `stock=${stockBefore}`);

    // 创建订单（买 2 件）
    const order = await j('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ productId: pid, quantity: 2, contact: 'test@example.com' }),
    });
    check('创建订单成功', order.status === 200 && order.body.orderNo, JSON.stringify(order.body).slice(0, 120));
    const orderNo = order.body.orderNo;

    // 未支付时查不到卡密
    const before = await j(`/api/orders/${orderNo}`);
    check('未支付订单不含卡密', before.body.status === 'PENDING' && !before.body.cards);

    // 模拟支付
    const pay = await j(`/api/dev/pay/${orderNo}`, { method: 'POST' });
    check('模拟支付成功', pay.status === 200 && pay.body.ok === true, JSON.stringify(pay.body));

    // 已支付后可凭联系方式查卡密
    const after = await j(`/api/orders/${orderNo}?contact=test@example.com`);
    check('支付后自动发货 2 张卡密', after.body.status === 'PAID' && after.body.cards && after.body.cards.length === 2,
      JSON.stringify(after.body));

    // 错误联系方式被拒
    const denied = await j(`/api/orders/${orderNo}?contact=wrong`);
    check('错误联系方式被拒绝', denied.status === 403);

    // 重复支付幂等
    const again = await j(`/api/dev/pay/${orderNo}`, { method: 'POST' });
    check('重复支付幂等', again.status === 200 && again.body.ok === true);

    // 库存扣减
    const products2 = await j('/api/products');
    const p2 = products2.body.find((p) => p.id === pid);
    check('库存扣减 2 件', p2.stock === stockBefore - 2, `stock=${p2.stock}`);

    // 管理登录
    const badLogin = await j('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
    check('错误密码被拒', badLogin.status === 401);
    const login = await j('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'admin123' }) });
    check('管理员登录成功', login.status === 200 && !!login.body.token);
    const token = login.body.token;

    // 未带 token 访问后台被拒
    const noAuth = await j('/api/admin/dashboard');
    check('后台接口鉴权生效', noAuth.status === 401);

    // 仪表盘
    const dash = await j('/api/admin/dashboard', { token });
    check('仪表盘统计返回', dash.status === 200 && dash.body.today.count >= 1, JSON.stringify(dash.body).slice(0, 120));

    // 批量导入卡密（使用时间戳唯一卡密，与库内既有数据解耦）
    const stamp = Date.now();
    const importRes = await j('/api/admin/cards/import', {
      method: 'POST', token,
      body: JSON.stringify({ product_id: pid, text: `T-${stamp}-A\nT-${stamp}-B\nT-${stamp}-A\n\n  ` }),
    });
    check('批量导入（去重）', importRes.status === 200 && importRes.body.inserted === 2 && importRes.body.dup === 1,
      JSON.stringify(importRes.body));

    // 导入后库存 = 原库存 -2(已售) +2(导入)
    const afterImport = await j('/api/products');
    const stockAfterImport = afterImport.body.find((p) => p.id === pid).stock;
    check('导入后库存正确', stockAfterImport === stockBefore, `stock=${stockAfterImport}`);

    // 自定义库存文案（stock_text）：单字段 PUT 走 exists 兜底，同时回归验证 NOT NULL 修复
    const setText = await j(`/api/admin/products/${pid}`, {
      method: 'PUT', token,
      body: JSON.stringify({ stock_text: '库存充足' }),
    });
    check('设置自定义库存文案', setText.status === 200, JSON.stringify(setText.body));
    const withText = (await j('/api/products')).body.find((p) => p.id === pid);
    check('前台返回自定义库存文案', withText.stock_text === '库存充足', JSON.stringify(withText.stock_text));
    const clearText = await j(`/api/admin/products/${pid}`, {
      method: 'PUT', token,
      body: JSON.stringify({ stock_text: '' }),
    });
    check('清空自定义库存文案', clearText.status === 200);
    const cleared = (await j('/api/products')).body.find((p) => p.id === pid);
    check('清空后前台无自定义文案', !cleared.stock_text, JSON.stringify(cleared.stock_text));

    // 订单后台可见卡密
    const orderDetail = await j(`/api/admin/orders/${orderNo}`, { token });
    check('后台订单详情含卡密', orderDetail.status === 200 && orderDetail.body.cards.length === 2);

    // 退款释放卡密
    const refund = await j(`/api/admin/orders/${orderNo}/refund`, { method: 'POST', token });
    check('退款成功', refund.status === 200 && refund.body.ok === true);
    const afterRefund = await j(`/api/orders/${orderNo}?contact=test@example.com`);
    check('退款后订单状态 REFUNDED', afterRefund.body.status === 'REFUNDED');
    const products3 = await j('/api/products');
    const p3 = products3.body.find((p) => p.id === pid);
    check('退款后库存恢复', p3.stock === stockAfterImport + 2, `stock=${p3.stock}`);
  } catch (err) {
    results.push('❌ 测试异常: ' + err.stack);
    process.exitCode = 1;
  } finally {
    server.close();
  }

  console.log('\n===== 端到端测试结果 =====');
  for (const r of results) console.log(r);
}

main();
