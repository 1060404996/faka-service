#!/usr/bin/env bash
# ============================================================
#  老王发卡服务 · 一键部署脚本
#  适用：宝塔面板服务器（CentOS 7+ / Ubuntu 20.04+ / Debian 11+）
#
#  用法：
#     cd /www/wwwroot/faka-service && bash deploy.sh
#     或指定目录：bash deploy.sh /www/wwwroot/faka-service
#
#  可选环境变量：
#     PORT=3000       服务端口
#     APP_NAME=名称    pm2 进程名
#     NODE_MAJOR=20   需要安装时的 Node 大版本
#
#  建议以 root 运行（宝塔终端默认即是）；非 root 也能运行，仅开机自启可能受限。
# ============================================================
set -euo pipefail

PORT="${PORT:-3000}"
APP_NAME="${APP_NAME:-faka-service}"
NODE_MAJOR="${NODE_MAJOR:-20}"

log()  { echo -e "\033[36m[部署]\033[0m $*"; }
ok()   { echo -e "\033[32m[完成]\033[0m $*"; }
warn() { echo -e "\033[33m[提示]\033[0m $*"; }
fail() { echo -e "\033[31m[失败]\033[0m $*"; exit 1; }

[ "$(id -u)" = "0" ] || warn "当前非 root 用户，全局安装与开机自启可能受限"

# ---------- 0. 定位项目目录 ----------
PROJECT_DIR="${1:-${PROJECT_DIR:-}}"
if [ -z "$PROJECT_DIR" ]; then PROJECT_DIR="$(pwd)"; fi
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd || echo "$PROJECT_DIR")"

log "项目目录：$PROJECT_DIR"
[ -f "$PROJECT_DIR/server.js" ]   || fail "未找到 server.js，请先 cd 到项目目录，或执行：bash deploy.sh /项目/绝对路径"
[ -f "$PROJECT_DIR/package.json" ] || fail "未找到 package.json，项目文件不完整"
cd "$PROJECT_DIR"

# ---------- 0.5 基础工具 ----------
command -v curl >/dev/null 2>&1 || {
  log "安装 curl ..."
  if command -v apt-get >/dev/null 2>&1; then apt-get install -y curl; fi
  if command -v yum >/dev/null 2>&1; then yum install -y curl; fi
}

# ---------- 1. Node.js（≥18） ----------
need_node() {
  command -v node >/dev/null 2>&1 || return 0
  ver="$(node -v | sed 's/^v//; s/\..*$//')"
  [ "${ver:-0}" -ge 18 ] && return 1 || return 0
}
if need_node; then
  log "未检测到 Node ≥18，正在安装 Node ${NODE_MAJOR} ..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - || fail "NodeSource 源配置失败"
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - || fail "NodeSource 源配置失败"
    yum install -y nodejs
  else
    arch="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/; s/i[3-6]86/x86/')"
    ver="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -1)"
    [ -n "$ver" ] || fail "无法获取 Node 版本号，请手动安装 Node 18+"
    curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/${ver}/node-${ver}-linux-${arch}.tar.xz"
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
    rm -f /tmp/node.tar.xz
  fi
  export PATH="/usr/local/bin:$PATH"
  node -v >/dev/null 2>&1 || fail "Node 安装失败"
fi
ok "Node 版本：$(node -v)  npm：$(npm -v)"

# ---------- 2. 安装依赖（better-sqlite3 编译兜底） ----------
log "安装依赖（npm install）..."
if ! npm install --no-audit --no-fund; then
  warn "首次安装失败，尝试安装编译工具后重试（better-sqlite3 需要）..."
  if command -v apt-get >/dev/null 2>&1; then apt-get install -y build-essential python3 >/dev/null 2>&1 || true; fi
  if command -v yum >/dev/null 2>&1; then yum install -y gcc gcc-c++ make python3 >/dev/null 2>&1 || true; fi
  npm rebuild better-sqlite3 >/dev/null 2>&1 || true
  npm install --no-audit --no-fund || fail "依赖安装失败，请检查网络或查看上方报错"
fi
ok "依赖安装完成"

# ---------- 3. pm2 进程守护 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  log "安装 pm2 ..."
  if ! npm install -g pm2 >/dev/null 2>&1; then
    warn "全局安装受限，改为用户级安装..."
    export NPM_CONFIG_PREFIX="$HOME/.npm-global"
    mkdir -p "$NPM_CONFIG_PREFIX"
    npm install -g pm2 || fail "pm2 安装失败"
    export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
  fi
fi

# 已存在同名实例时先清理，避免端口冲突
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

log "启动服务：$APP_NAME（端口 ${PORT}）..."
PORT="$PORT" pm2 start server.js --name "$APP_NAME" --time || fail "pm2 启动失败，请查看：pm2 logs $APP_NAME"
pm2 save >/dev/null 2>&1 || true

# 开机自启（systemd + root 环境，尽力而为）
if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
  ok "已配置 pm2 开机自启"
fi

# ---------- 4. 健康检查 ----------
log "等待服务就绪（最多 30 秒）..."
ready=0
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/site" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = "1" ] || fail "服务未在 ${PORT} 端口就绪，请查看日志：pm2 logs ${APP_NAME}"

IP="$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null || echo 服务器IP)"

cat <<EOF

============================================================
  部署完成 ✅  服务运行正常
------------------------------------------------------------
  前台商城   http://${IP}:${PORT}/
  管理后台   http://${IP}:${PORT}/admin.html
             默认密码 admin123，登录后请立即在系统设置中修改
  进程管理   pm2 status          查看状态
             pm2 logs ${APP_NAME}  查看日志
             pm2 restart ${APP_NAME} 重启服务
  数据文件   ${PROJECT_DIR}/data/faka.db（备份它 = 备份全部数据）

  下一步（宝塔面板）：
  1) 网站 → Node 项目 → 绑定域名；或添加站点 → 反向代理
     目标地址填 http://127.0.0.1:${PORT}，并在反代配置中加入：
       proxy_set_header X-Forwarded-Proto \$scheme;
  2) 站点设置 → SSL → 申请 Let's Encrypt 证书 → 开启强制 HTTPS
  3) 后台「系统设置 → 支付设置」填入支付宝 AppID / 应用私钥 / 支付宝公钥，
     支付模式切到「正式模式」
  4) 支付宝开放平台 → 应用 → 配置：
       授权回调地址   https://你的域名/api/alipay/return
       异步通知地址   https://你的域名/api/alipay/notify
============================================================
EOF
