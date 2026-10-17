'use strict';
/**
 * SQLite 数据层：建表、默认种子数据、设置读写
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'faka.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🏷️',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  original_price REAL,
  cover TEXT NOT NULL DEFAULT '🎁',
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  stock_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  secret TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_order ON cards(order_id);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  deliver_status TEXT NOT NULL DEFAULT 'ok',
  pay_method TEXT NOT NULL DEFAULT 'alipay',
  trade_no TEXT NOT NULL DEFAULT '',
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
`);

/* ---------- 迁移：为已存在的库补充新列 ---------- */
(function migrate() {
  const prodCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  if (!prodCols.includes('stock_text')) {
    db.exec('ALTER TABLE products ADD COLUMN stock_text TEXT');
  }
})();

/* ---------- settings ---------- */
const getSetting = (key, def = '') => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
};
const setSetting = (key, value) => {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
};

function hashPassword(pw, salt) {
  return crypto.createHmac('sha256', salt).update(String(pw)).digest('hex');
}

/* ---------- 首次运行：默认配置 + 演示数据 ---------- */
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (count > 0) return; // 已有数据，跳过

  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('admin_salt', salt);
  setSetting('admin_hash', hashPassword('admin123', salt)); // 默认密码，请在后台修改
  setSetting('server_secret', crypto.randomBytes(32).toString('hex'));

  setSetting('site_name', '老王发卡');
  setSetting('site_subtitle', '极速 · 安全 · 全自动发卡');
  setSetting('site_notice', '支付成功后卡密将自动发货，请务必保存好订单号，以便随时查询卡密。');
  setSetting('service_qq', '');
  setSetting('service_wechat', '');
  setSetting('service_wechat_qr', '');
  setSetting('service_tg', '');
  setSetting('require_contact', '1'); // 下单联系方式：1=必填，0=选填
  setSetting('pay_mock', '1'); // 默认演示模式：1=模拟支付，0=真实支付宝
  setSetting('alipay_appid', '');
  setSetting('alipay_private_key', '');
  setSetting('alipay_public_key', '');
  setSetting('alipay_gateway', 'prod'); // prod | sandbox
  setSetting('alipay_method', 'page_pay'); // auto(自动识别) | page_pay(电脑网站支付) | precreate(当面付扫码) | wap_pay(手机网站支付)

  // 演示分类
  const cat = db.prepare('INSERT INTO categories(name, icon, sort) VALUES(?,?,?)');
  const c1 = cat.run('游戏充值', '🎮', 1).lastInsertRowid;
  const c2 = cat.run('影音会员', '🎬', 2).lastInsertRowid;
  const c3 = cat.run('云盘工具', '☁️', 3).lastInsertRowid;

  // 演示商品
  const prod = db.prepare(
    'INSERT INTO products(category_id, name, description, price, original_price, cover, status, sort) VALUES(?,?,?,?,?,?,1,?)'
  );
  const p1 = prod.run(c1, 'Steam 钱包充值卡 50 元', '官方渠道代充，秒到账，支持国区。', 52.5, 58, '🎮', 1).lastInsertRowid;
  const p2 = prod.run(c1, '网易游戏通用点卡 100 点', '适用梦幻西游 / 大话西游等，充值即到账。', 9.9, 12, '⚔️', 2).lastInsertRowid;
  const p3 = prod.run(c2, '腾讯视频 VIP 月卡', '官方直充，全端通用，自动续期无忧。', 15.9, 25, '🎬', 1).lastInsertRowid;
  const p4 = prod.run(c2, '网易云音乐黑胶 VIP 月卡', '官方直充，手机 / 电脑全端可用。', 12.9, 18, '🎵', 2).lastInsertRowid;
  const p5 = prod.run(c3, '百度网盘超级会员月卡', '官方渠道直充，容量与特权即刻生效。', 25.0, 30, '☁️', 1).lastInsertRowid;
  const p6 = prod.run(c3, '迅雷超级会员月卡', '官方直充，高速通道立享。', 9.9, 15, '⚡', 3).lastInsertRowid;

  // 演示卡密（DEMO 字样，正式使用请删除后重新导入）
  const card = db.prepare('INSERT INTO cards(product_id, secret) VALUES(?,?)');
  const demoSecrets = {
    [p1]: ['DEMO-STEAM-1001-AAAA', 'DEMO-STEAM-1002-BBBB', 'DEMO-STEAM-1003-CCCC', 'DEMO-STEAM-1004-DDDD', 'DEMO-STEAM-1005-EEEE'],
    [p2]: ['DEMO-WY-2001-1111', 'DEMO-WY-2002-2222', 'DEMO-WY-2003-3333'],
    [p3]: ['DEMO-TXVIP-3001-X1X1', 'DEMO-TXVIP-3002-X2X2', 'DEMO-TXVIP-3003-X3X3'],
    [p4]: ['DEMO-MUSIC-4001-M1M1', 'DEMO-MUSIC-4002-M2M2'],
    [p5]: ['DEMO-BAIDU-5001-B1B1', 'DEMO-BAIDU-5002-B2B2'],
    [p6]: ['DEMO-THUNDER-6001-T1T1'],
  };
  for (const [pid, list] of Object.entries(demoSecrets)) {
    for (const s of list) card.run(Number(pid), s);
  }
}

seedIfEmpty();

module.exports = { db, getSetting, setSetting, hashPassword };
