'use strict';
/**
 * 管理端登录令牌：HMAC 签名 + 过期时间（无状态）
 */
const crypto = require('crypto');
const { getSetting, hashPassword } = require('./db');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function secret() {
  let s = getSetting('server_secret', '');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    const { setSetting } = require('./db');
    setSetting('server_secret', s);
  }
  return s;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest();
}

function issueToken() {
  const payload = JSON.stringify({ sub: 'admin', exp: Date.now() + TOKEN_TTL_MS });
  const payloadB64 = base64url(payload);
  return payloadB64 + '.' + base64url(signPayload(payloadB64));
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (payload.sub !== 'admin' || !payload.exp || payload.exp < Date.now()) return false;
    const expected = base64url(signPayload(payloadB64));
    const actual = sigB64;
    if (expected !== actual) return false;
    return true;
  } catch {
    return false;
  }
}

function login(password) {
  const salt = getSetting('admin_salt', '');
  const hash = getSetting('admin_hash', '');
  if (!salt || !hash) return false;
  if (hashPassword(password, salt) !== hash) return false;
  return issueToken();
}

/** Express 中间件 */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  next();
}

module.exports = { login, issueToken, verifyToken, requireAdmin };
