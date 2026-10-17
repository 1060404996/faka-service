'use strict';
/**
 * 支付宝开放平台客户端（RSA2 签名 / 验签）
 * 支持：电脑网站支付(alipay.trade.page.pay)、手机网站支付(alipay.trade.wap.pay)、当面付扫码(alipay.trade.precreate)、交易查询、异步通知验签
 * 网关：正式 https://openapi.alipay.com/gateway.do ｜ 沙箱 https://openapi.alipaydev.com/gateway.do
 */
const crypto = require('crypto');

const GATEWAYS = {
  prod: 'https://openapi.alipay.com/gateway.do',
  sandbox: 'https://openapi.alipaydev.com/gateway.do',
};

/** 把可能缺少 PEM 头尾的裸 base64 密钥规范化为标准 PEM（已带头尾则原样返回） */
function normalizePem(data, type) {
  const s = String(data || '').trim();
  if (!s) return s;
  if (s.includes('-----BEGIN')) return s;
  const body = s.replace(/\s+/g, '');
  if (!body) return s;
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`;
}

class Alipay {
  constructor({ appid, privateKey, alipayPublicKey, gateway = 'prod', notifyUrl = '', returnUrl = '' }) {
    privateKey = normalizePem(privateKey, 'PRIVATE KEY');
    alipayPublicKey = normalizePem(alipayPublicKey, 'PUBLIC KEY');
    if (!appid || !privateKey || !alipayPublicKey) {
      throw new Error('支付宝配置不完整：需要 appid、商户私钥、支付宝公钥');
    }
    this.appid = appid;
    this.privateKey = privateKey;
    this.alipayPublicKey = alipayPublicKey;
    this.gateway = GATEWAYS[gateway] || GATEWAYS.prod;
    this.notifyUrl = notifyUrl;
    this.returnUrl = returnUrl;
  }

  /** 拼接待签名串：按 ASCII 升序 key=value&...（值不做 URL 编码；sign 排除，sign_type 参与签名） */
  static buildSignStr(params) {
    return Object.keys(params)
      .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
  }

  /** RSA2(SHA256withRSA) 签名 */
  sign(params) {
    const str = Alipay.buildSignStr(params);
    return crypto.createSign('RSA-SHA256').update(str, 'utf8').sign(this.privateKey, 'base64');
  }

  /** 用支付宝公钥验签 */
  verify(params) {
    const sign = params.sign;
    if (!sign) return false;
    const str = Alipay.buildSignStr(params);
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(str, 'utf8');
    return verifier.verify(this.alipayPublicKey, sign, 'base64');
  }

  /** 组装开放平台请求参数（含签名） */
  buildParams(method, bizContent, extra = {}) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const params = {
      app_id: this.appid,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
      ...extra,
    };
    params.sign = this.sign(params);
    return params;
  }

  /** 生成可访问的支付 URL（电脑网站支付） */
  pagePayUrl({ outTradeNo, totalAmount, subject }) {
    const params = this.buildParams(
      'alipay.trade.page.pay',
      {
        out_trade_no: outTradeNo,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: totalAmount.toFixed(2),
        subject,
      },
      { notify_url: this.notifyUrl, return_url: this.returnUrl }
    );
    return (
      this.gateway +
      '?' +
      Object.keys(params)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&')
    );
  }

  /** 手机网站支付跳转地址（alipay.trade.wap.pay，手机浏览器体验最佳） */
  wapPayUrl({ outTradeNo, totalAmount, subject }) {
    const params = this.buildParams(
      'alipay.trade.wap.pay',
      {
        out_trade_no: outTradeNo,
        product_code: 'QUICK_WAP_WAY',
        total_amount: totalAmount.toFixed(2),
        subject,
      },
      {
        notify_url: this.notifyUrl,
        return_url: this.returnUrl,
        quit_url: this.returnUrl, // 中途取消支付后回跳到收银台
      }
    );
    return (
      this.gateway +
      '?' +
      Object.keys(params)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&')
    );
  }

  /** 当面付预下单，返回二维码内容（alipay.trade.precreate） */
  async precreate({ outTradeNo, totalAmount, subject }) {
    const params = this.buildParams('alipay.trade.precreate', {
      out_trade_no: outTradeNo,
      total_amount: totalAmount.toFixed(2),
      subject,
    }, { notify_url: this.notifyUrl });
    const resp = await fetch(this.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: Object.keys(params)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&'),
    });
    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('支付宝预下单响应解析失败: ' + text.slice(0, 300));
    }
    const biz = json.alipay_trade_precreate_response;
    if (!biz || biz.code !== '10000') {
      throw new Error('支付宝预下单失败: ' + (biz ? `${biz.code} ${biz.msg} ${biz.sub_msg || ''}` : text.slice(0, 300)));
    }
    return biz.qr_code;
  }

  /** 主动查询交易状态（alipay.trade.query） */
  async tradeQuery(outTradeNo) {
    const params = this.buildParams('alipay.trade.query', { out_trade_no: outTradeNo });
    const resp = await fetch(this.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: Object.keys(params)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&'),
    });
    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('交易查询响应解析失败: ' + text.slice(0, 300));
    }
    const biz = json.alipay_trade_query_response;
    if (!biz) throw new Error('交易查询失败: ' + text.slice(0, 300));
    return biz;
  }
}

module.exports = { Alipay };
