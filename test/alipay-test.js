'use strict';
/**
 * 支付宝 RSA2 签名 / 验签算法自检：
 * 用临时 RSA 密钥对验证 pagePayUrl 可签名、异步通知可验签、金额篡改会被拒绝。
 * 运行：node test/alipay-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { Alipay } = require('../lib/alipay');

function genKeys() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alipay-test-'));
  execSync(`openssl genrsa -out ${dir}/private.pem 2048 2>/dev/null`);
  execSync(`openssl rsa -in ${dir}/private.pem -pubout -out ${dir}/public.pem 2>/dev/null`);
  const privateKey = fs.readFileSync(`${dir}/private.pem`, 'utf8');
  const publicKey = fs.readFileSync(`${dir}/public.pem`, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { privateKey, publicKey };
}

function main() {
  const { privateKey, publicKey } = genKeys();
  const alipay = new Alipay({
    appid: '2021000000000000',
    privateKey,
    alipayPublicKey: publicKey,
    gateway: 'sandbox',
    notifyUrl: 'https://example.com/api/alipay/notify',
    returnUrl: 'https://example.com/api/alipay/return',
  });
  const results = [];
  const check = (name, cond) => { results.push(`${cond ? '✅' : '❌'} ${name}`); if (!cond) process.exitCode = 1; };

  // 1. 电脑网站支付 URL 生成与签名可验证
  const url = alipay.pagePayUrl({ outTradeNo: 'F20261017001', totalAmount: 12.9, subject: '测试商品' });
  const params = Object.fromEntries(new URL(url).searchParams);
  check('pagePayUrl 含 sign', !!params.sign && params.sign_type === 'RSA2' && params.method === 'alipay.trade.page.pay');
  check('pagePayUrl 签名可验', alipay.verify(params));

  // 1.1 手机网站支付 URL 生成与签名可验证
  const wapUrl = alipay.wapPayUrl({ outTradeNo: 'F20261017002', totalAmount: 12.9, subject: '测试商品' });
  const wapParams = Object.fromEntries(new URL(wapUrl).searchParams);
  check('wapPayUrl 含 sign', !!wapParams.sign && wapParams.method === 'alipay.trade.wap.pay');
  check('wapPayUrl 签名可验', alipay.verify(wapParams));
  check('wapPayUrl 含 quit_url', !!wapParams.quit_url);

  // 2. 异步通知验签（模拟支付宝回调）
  const notify = {
    app_id: '2021000000000000',
    notify_type: 'trade_status_sync',
    out_trade_no: 'F20261017001',
    trade_no: '2026101722001400000000000001',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '12.90',
    sign_type: 'RSA2',
  };
  notify.sign = alipay.sign(notify);
  check('异步通知验签通过', alipay.verify(notify));

  // 3. 篡改金额后验签失败
  const tampered = { ...notify, total_amount: '9999.00', sign: notify.sign };
  check('篡改金额验签被拒', !alipay.verify(tampered));

  console.log('\n===== 支付宝算法自检 =====');
  for (const r of results) console.log(r);
}

main();
