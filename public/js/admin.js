'use strict';
/* 管理后台逻辑：仪表盘 / 商品 / 卡密 / 订单 / 设置 */
(function () {
  const { $, $$, esc, fmtMoney, api, getToken, setToken, icon, toast, openModal, countUp, emptyState } = window.Faka;

  const state = { siteName: '老王发卡', view: 'dashboard', categories: [] };

  /* ================= 初始化 ================= */
  init();

  async function init() {
    $('#view').addEventListener('click', onViewClick); // 全局委托，仅绑定一次（避免重复监听导致多弹窗/重复提交）
    $('#loginLogo').innerHTML = icon('bolt', 20);
    $('#appLogo').innerHTML = icon('bolt', 18);
    $('#logoutBtn .ic').innerHTML = icon('logout', 18);
    $('#topLogout').innerHTML = icon('logout', 15) + '退出';
    $('#menuBtn').innerHTML = icon('cart', 15) + '菜单';
    $('#loginBtn').innerHTML = icon('shield', 19) + '登 录';
    document.querySelectorAll('.nav-item[data-view] .ic').forEach((el, i) => {
      const icons = ['chart', 'tag', 'cards', 'box', 'gear'];
      el.innerHTML = icon(icons[i], 19);
    });
    document.querySelectorAll('.sidebar-foot .nav-item .ic').forEach((el) => { el.innerHTML = icon('store', 18); });

    const site = await api('/api/site');
    if (site.body.siteName) {
      state.siteName = site.body.siteName;
      $('#loginSiteName').textContent = site.body.siteName;
      $('#appSiteName').textContent = site.body.siteName;
      document.title = site.body.siteName + ' · 管理后台';
    }

    if (getToken()) {
      showApp();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    $('#loginView').style.display = 'flex';
    $('#appView').style.display = 'none';
    setTimeout(() => $('#loginPass').focus(), 100);
  }

  function showApp() {
    $('#loginView').style.display = 'none';
    $('#appView').style.display = 'block';
    switchView('dashboard');
  }

  function logout() {
    localStorage.removeItem('faka_admin_token');
    toast('已退出登录', 'warn');
    showLogin();
  }

  /* ================= 登录 ================= */
  async function doLogin() {
    const pass = $('#loginPass').value;
    if (!pass) return toast('请输入密码', 'warn');
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.innerHTML = icon('clock', 19) + '登录中…';
    const res = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pass }), token: '' });
    btn.disabled = false;
    btn.innerHTML = icon('shield', 19) + '登 录';
    if (res.status !== 200) return toast(res.body.error || '登录失败', 'error');
    setToken(res.body.token);
    $('#loginPass').value = '';
    toast('欢迎回来', 'success');
    showApp();
  }
  $('#loginBtn').addEventListener('click', doLogin);
  $('#loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  /* ================= 导航 ================= */
  function switchView(v) {
    state.view = v;
    $$('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $('#sidebar').classList.remove('open');
    $('#sbBackdrop').style.display = 'none';
    const titles = {
      dashboard: ['仪表盘', '经营数据总览'],
      products: ['商品管理', '维护在售商品与分类'],
      cards: ['卡密管理', '批量导入与库存维护'],
      orders: ['订单管理', '订单查询、补发与退款'],
      settings: ['系统设置', '站点信息、支付宝对接与安全'],
    };
    $('#pageTitle').textContent = titles[v][0];
    $('#pageSub').textContent = titles[v][1];
    $('#view').innerHTML = '';
    renderView(v);
  }
  $$('.nav-item[data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('#logoutBtn').addEventListener('click', logout);
  $('#topLogout').addEventListener('click', logout);
  $('#menuBtn').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#sbBackdrop').style.display = $('#sidebar').classList.contains('open') ? 'block' : 'none'; });
  $('#sbBackdrop').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#sbBackdrop').style.display = 'none'; });

  async function renderView(v) {
    try {
      await VIEWS[v]();
      bindToolbar(v);
    } catch (err) {
      $('#view').innerHTML = `<div class="panel glass">${emptyState('加载失败：' + err.message, 'alert')}</div>`;
    }
  }

  function bindToolbar(v) {
    if (v === 'products') bindProductToolbar();
    if (v === 'cards') bindCardsToolbar();
    if (v === 'orders') bindOrdersToolbar();
  }

  /* ================= 仪表盘 ================= */
  const VIEWS = {
    async dashboard() {
      const d = (await api('/api/admin/dashboard')).body;
      const cards = [
        stat('今日订单', d.today.count, 'box', 'rgba(34,211,238,.14)', 'var(--cyan)'),
        stat('今日营收', '¥' + fmtMoney(d.today.amount), 'chart', 'rgba(52,211,153,.14)', 'var(--green)'),
        stat('待支付订单', d.pending, 'clock', 'rgba(251,191,36,.14)', 'var(--amber)'),
        stat('待补发订单', d.shortage, 'alert', 'rgba(248,113,113,.14)', 'var(--red)'),
        stat('卡密库存', d.stock, 'cards', 'rgba(56,189,248,.14)', 'var(--sky)'),
        stat('已售卡密', d.sold, 'tag', 'rgba(45,212,191,.14)', 'var(--teal)'),
      ].join('');
      const recent = d.recent.length ? `
        <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>订单号</th><th>商品</th><th>数量</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>${d.recent.map((o) => `
            <tr>
              <td class="mono">${esc(o.order_no)}</td>
              <td style="max-width:220px">${esc(o.product_name)}</td>
              <td>${o.quantity}</td>
              <td class="num">¥${fmtMoney(o.total)}</td>
              <td>${orderTag(o)}</td>
              <td class="small muted">${esc(o.created_at)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>` : `<div class="panel-head">${emptyState('暂无订单', 'box')}</div>`;
      $('#view').innerHTML = `
        <div class="stats">${cards}</div>
        ${d.shortage > 0 ? `
        <div class="panel glass" style="border-color:rgba(248,113,113,.35);margin-bottom:24px">
          <div class="panel-head">
            <div class="panel-title" style="color:#fca5a5">${icon('alert', 20)}有 ${d.shortage} 笔订单缺货待补发</div>
            <a class="btn btn-ghost btn-sm" href="#" data-goto="orders">去处理</a>
          </div>
        </div>` : ''}
        <div class="panel glass">
          <div class="panel-head">
            <div class="panel-title">${icon('clock', 19)}最近订单</div>
            <a class="btn btn-ghost btn-sm" href="#" data-goto="orders">查看全部</a>
          </div>
          ${recent}
        </div>`;
      $$('.stat-value').forEach((el, i) => {
        const raw = [d.today.count, d.today.amount, d.pending, d.shortage, d.stock, d.sold][i];
        if (raw !== undefined) countUp(el, raw, { decimals: 0 });
      });
      $$('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); switchView(a.dataset.goto); }));
    },

    /* ================= 商品管理 ================= */
    async products() {
      const [prods, cats] = await Promise.all([
        api('/api/admin/products'),
        api('/api/admin/categories'),
      ]);
      state.categories = cats.body;
      const rows = prods.body;
      $('#view').innerHTML = `
        <div class="panel glass">
          <div class="panel-head">
            <div class="panel-title">${icon('tag', 19)}商品列表（${rows.length}）</div>
            <div class="panel-tools">
              <button class="btn btn-ghost btn-sm" id="btnCats">${icon('cards', 16)}分类管理</button>
              <button class="btn btn-primary btn-sm" id="btnAdd">${icon('plus', 16)}新增商品</button>
            </div>
          </div>
          <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>封面</th><th>商品名称</th><th>分类</th><th>价格</th><th>库存</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${rows.map((p) => `
              <tr>
                <td>${iconHTML(p.cover || '🎁', 40, 'cell-cover')}</td>
                <td style="max-width:260px"><b>${esc(p.name)}</b><div class="small muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.description || '')}</div></td>
                <td>${esc(p.category_name || '未分类')}</td>
                <td class="num">¥${fmtMoney(p.price)}</td>
                <td class="num">${p.stock_text && p.stock_text.trim() ? `${esc(p.stock_text.trim())}<span class="small muted"> (${p.stock})</span>` : p.stock}<span class="small muted"> / ${p.total_cards}</span></td>
                <td>${p.status === 1 ? '<span class="tag tag-green">在售</span>' : '<span class="tag tag-gray">已下架</span>'}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">${icon('edit', 14)}编辑</button>
                    <button class="btn btn-ghost btn-sm" data-act="cards" data-id="${p.id}">${icon('cards', 14)}卡密</button>
                    <button class="btn btn-ghost btn-sm" data-act="toggle" data-id="${p.id}">${p.status === 1 ? '下架' : '上架'}</button>
                    <button class="btn btn-danger btn-sm" data-act="del" data-id="${p.id}">${icon('trash', 14)}删除</button>
                  </div>
                </td>
              </tr>`).join('') || `<tr class="tbl-empty"><td colspan="7">${emptyState('暂无商品，点击右上角新增', 'tag')}</td></tr>`}
            </tbody>
          </table>
          </div>
        </div>`;
    },

    /* ================= 卡密管理 ================= */
    async cards() {
      state.cardsState = Object.assign({ productId: '', status: '', page: 1, pageSize: 20 }, state.cardsState || {});
      $('#view').innerHTML = `
        <div class="panel glass">
          <div class="panel-head">
            <div class="panel-title">${icon('box', 19)}卡密库</div>
            <div class="panel-tools">
              <select class="select" id="cardsProduct" style="width:190px"><option value="">全部商品</option></select>
              <select class="select" id="cardsStatus" style="width:120px">
                <option value="">全部状态</option>
                <option value="0">未售</option>
                <option value="1">已售</option>
              </select>
              <button class="btn btn-ghost btn-sm" id="btnImport">${icon('plus', 15)}导入卡密</button>
              <a class="btn btn-ghost btn-sm" id="btnExport" href="#">${icon('download', 15)}导出</a>
              <button class="btn btn-danger btn-sm" id="btnDelCards">${icon('trash', 15)}删除选中</button>
            </div>
          </div>
          <div id="cardsTable"></div>
        </div>`;
      await renderCardsTable();
    },

    /* ================= 订单管理 ================= */
    async orders() {
      state.ordersState = Object.assign({ status: 'ALL', keyword: '', page: 1, pageSize: 20 }, state.ordersState || {});
      $('#view').innerHTML = `
        <div class="panel glass">
          <div class="panel-head">
            <div class="filter-pills" id="orderPills">
              ${['ALL', 'PENDING', 'PAID', 'REFUNDED'].map((s) =>
                `<button class="pill${state.ordersState.status === s ? ' active' : ''}" data-s="${s}">${{ ALL: '全部', PENDING: '待支付', PAID: '已支付', REFUNDED: '已退款' }[s]}</button>`).join('')}
            </div>
            <div class="panel-tools">
              <button class="btn btn-danger btn-sm" id="btnOrderDel">${icon('trash', 15)}删除选中</button>
              <input class="input" id="orderKeyword" placeholder="订单号 / 联系方式 / 交易号" value="${esc(state.ordersState.keyword)}" style="width:240px">
              <button class="btn btn-ghost btn-sm" id="btnOrderSearch">${icon('search', 15)}搜索</button>
            </div>
          </div>
          <div id="ordersTable"></div>
        </div>`;
      await renderOrdersTable();
    },

    /* ================= 系统设置 ================= */
    async settings() {
      const s = (await api('/api/admin/settings')).body;
      $('#view').innerHTML = `
        <form class="settings-form" style="max-width:720px">
          <div class="panel glass">
            <div class="panel-head open" data-panel-toggle><div class="panel-title">${icon('store', 19)}站点信息</div><span class="panel-arrow">${icon('chevron', 16)}</span></div>
            <div class="panel-body open"><div style="padding:22px">
              <div class="field"><label>站点名称</label><input class="input" name="site_name" value="${esc(s.site_name)}" maxlength="30"></div>
              <div class="field"><label>站点副标题</label><input class="input" name="site_subtitle" value="${esc(s.site_subtitle)}" maxlength="60"></div>
              <div class="field"><label>公告</label><textarea class="textarea" name="site_notice" style="min-height:80px;font-family:var(--font)">${esc(s.site_notice)}</textarea></div>
              <div class="field">
                <label>下单联系方式</label>
                <select class="select" name="require_contact">
                  <option value="1" ${s.require_contact !== '0' ? 'selected' : ''}>必填（买家下单时必须填写，便于查询卡密）</option>
                  <option value="0" ${s.require_contact === '0' ? 'selected' : ''}>选填（不强制填写）</option>
                </select>
              </div>
            </div></div>
          </div>

          <div class="panel glass">
            <div class="panel-head" data-panel-toggle><div class="panel-title">${icon('qq', 19)}客服设置</div><span class="panel-arrow">${icon('chevron', 16)}</span></div>
            <div class="panel-body"><div style="padding:22px">
              <div class="warn-box" style="border-color:rgba(56,189,248,.28);background:rgba(56,189,248,.07);color:#7dd3fc;margin-bottom:16px">
                <span>${icon('alert', 18)}</span>
                <span>前台导航栏将显示「客服」入口，弹窗中展示已填写的联系方式。留空的渠道不会显示。</span>
              </div>
              <div class="field"><label>QQ 号（点击弹窗内按钮跳转 QQ 临时会话并复制号码）</label><input class="input" name="service_qq" value="${esc(s.service_qq)}" maxlength="20" placeholder="如 123456789"></div>
              <div class="field"><label>微信号（前台点击复制微信号）</label><input class="input" name="service_wechat" value="${esc(s.service_wechat)}" maxlength="40" placeholder="如 lw_service"></div>
              <div class="field"><label>微信二维码图片 URL（前台弹窗展示扫码，特效与站点一致）</label><input class="input" name="service_wechat_qr" value="${esc(s.service_wechat_qr)}" maxlength="300" placeholder="https://图片地址.png（可选，填了显示扫码）"></div>
              <div class="field"><label>Telegram 用户名（点击跳转 t.me/用户名）</label><input class="input" name="service_tg" value="${esc(s.service_tg)}" maxlength="40" placeholder="如 lw_support"></div>
            </div></div>
          </div>

          <div class="panel glass">
            <div class="panel-head" data-panel-toggle><div class="panel-title">${icon('shield', 19)}支付设置 · 支付宝对接</div><span class="panel-arrow">${icon('chevron', 16)}</span></div>
            <div class="panel-body"><div style="padding:22px">
              <div class="field">
                <label>支付模式</label>
                <select class="select" name="pay_mock">
                  <option value="1" ${s.pay_mock === '1' ? 'selected' : ''}>演示模式（模拟支付，用于测试）</option>
                  <option value="0" ${s.pay_mock === '0' ? 'selected' : ''}>正式模式（真实支付宝收款）</option>
                </select>
              </div>
              <div class="field">
                <label>支付方式</label>
                <select class="select" name="alipay_method">
                  <option value="auto" ${s.alipay_method === 'auto' ? 'selected' : ''}>自动识别（电脑→电脑网站支付，手机→手机网站支付）</option>
                  <option value="page_pay" ${s.alipay_method === 'page_pay' ? 'selected' : ''}>电脑网站支付（扫码 / 跳转通用）</option>
                  <option value="precreate" ${s.alipay_method === 'precreate' ? 'selected' : ''}>当面付扫码（需开通当面付产品）</option>
                  <option value="wap_pay" ${s.alipay_method === 'wap_pay' ? 'selected' : ''}>手机网站支付（手机浏览器体验最佳，需开通手机网站支付产品）</option>
                </select>
              </div>
              <div class="field">
                <label>网关环境</label>
                <select class="select" name="alipay_gateway">
                  <option value="prod" ${s.alipay_gateway === 'prod' ? 'selected' : ''}>正式环境</option>
                  <option value="sandbox" ${s.alipay_gateway === 'sandbox' ? 'selected' : ''}>沙箱环境（测试）</option>
                </select>
              </div>
              <div class="field"><label>应用 AppID</label><input class="input" name="alipay_appid" value="${esc(s.alipay_appid)}" placeholder="支付宝开放平台创建应用后获取"></div>
              <div class="field"><label>应用私钥（商户 RSA2 私钥）</label><textarea class="textarea" name="alipay_private_key" style="min-height:130px" placeholder="-----BEGIN PRIVATE KEY-----">${esc(s.alipay_private_key)}</textarea></div>
              <div class="field"><label>支付宝公钥（开放平台「支付宝公钥」）</label><textarea class="textarea" name="alipay_public_key" style="min-height:130px" placeholder="-----BEGIN PUBLIC KEY-----">${esc(s.alipay_public_key)}</textarea></div>
              <div class="warn-box" style="border-color:rgba(56,189,248,.28);background:rgba(56,189,248,.07);color:#7dd3fc;margin-top:6px">
                <span>${icon('alert', 18)}</span>
                <span>支付宝官方接口需<b>企业或个体工商户资质</b>：前往开放平台创建「网页/移动应用」、配置 RSA2 密钥、开通电脑网站支付 / 手机网站支付 / 当面付产品，并把异步通知地址设为 <b class="mono">http(s)://你的域名/api/alipay/notify</b>。个体无资质时可先用演示模式跑通流程。</span>
              </div>
            </div></div>
          </div>

          <div class="panel glass">
            <div class="panel-head" data-panel-toggle><div class="panel-title">${icon('gear', 19)}安全</div><span class="panel-arrow">${icon('chevron', 16)}</span></div>
            <div class="panel-body"><div style="padding:22px">
              <div class="field"><label>新密码（留空则不修改）</label><input class="input" name="newPassword" type="password" placeholder="至少 6 位" autocomplete="new-password"></div>
              <div class="field"><label>确认新密码</label><input class="input" name="confirmPassword" type="password" placeholder="再次输入新密码" autocomplete="new-password"></div>
            </div></div>
          </div>

          <button class="btn btn-primary btn-lg" id="btnSaveSettings">${icon('check', 19)}保存全部设置</button>
        </form>`;
    },
  };

  function stat(label, value, iconName, bg, color) {
    return `<div class="stat-card" style="--sc:${bg};--sc2:${color}">
      <div class="stat-icon">${icon(iconName, 21)}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-value">${esc(value)}</div>
    </div>`;
  }

  const STATUS_MAP = { PENDING: ['待支付', 'tag-amber'], PAID: ['已支付', 'tag-green'], REFUNDED: ['已退款', 'tag-red'], CLOSED: ['已关闭', 'tag-gray'] };
  function orderTag(o) {
    const [t, c] = STATUS_MAP[o.status] || [o.status, 'tag-gray'];
    return `<span class="tag ${c}">${t}</span>${o.deliver_status === 'shortage' ? ' <span class="tag tag-red">缺货</span>' : ''}`;
  }

  /* emoji 或图片 URL 的统一渲染：http(s) 开头按图片处理，否则按 emoji 文本 */
  function iconHTML(v, size = 18, cls = '') {
    const s = String(v || '').trim();
    if (/^https?:\/\//i.test(s)) {
      return `<img class="icon-url ${cls}" src="${esc(s)}" alt="" style="width:${size}px;height:${size}px;border-radius:6px;object-fit:cover;flex:none">`;
    }
    return `<span style="flex:none;font-size:${size}px;line-height:1">${esc(s)}</span>`;
  }

  /* ================= 商品：工具栏与操作 ================= */
  function bindProductToolbar() {
    $('#btnAdd').addEventListener('click', () => openProductModal());
    $('#btnCats').addEventListener('click', openCatsModal);
  }

  async function handleProductActs(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const act = btn.dataset.act;
    if (act === 'edit') {
      const list = (await api('/api/admin/products')).body;
      openProductModal(list.find((p) => p.id === id));
    } else if (act === 'cards') {
      switchView('cards');
      state.cardsState.productId = id;
      await renderCardsTable();
    } else if (act === 'toggle') {
      const p = (await api('/api/admin/products')).body.find((x) => x.id === id);
      const res = await api(`/api/admin/products/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: p.status === 1 ? 0 : 1 }) });
      if (res.status === 200) { toast('已更新', 'success'); renderView('products'); }
      else toast(res.body.error || '操作失败', 'error');
    } else if (act === 'del') {
      if (!confirm('确定删除该商品及其未售卡密？已售卡密存在时不允许删除。')) return;
      const res = await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      if (res.status === 200) { toast('已删除', 'success'); renderView('products'); }
      else toast(res.body.error || '删除失败', 'error');
    }
  }

  function openProductModal(p) {
    const isEdit = !!p;
    const overlay = openModal(`
      <div class="modal-title">${isEdit ? '编辑商品' : '新增商品'}</div>
      <div class="modal-sub">${isEdit ? '修改商品信息，保存后立即生效' : '创建后需在「卡密管理」中导入卡密才能售卖'}</div>
      <div class="field"><label>商品名称 *</label><input class="input" id="f_name" value="${esc(p?.name || '')}" maxlength="60"></div>
      <div class="field"><label>分类</label><select class="select" id="f_cat">
        <option value="">未分类</option>
        ${state.categories.map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><label>售价（元）*</label><input class="input" id="f_price" type="number" step="0.01" min="0" value="${p?.price ?? ''}" placeholder="0.00"></div>
        <div class="field"><label>划线原价（元）</label><input class="input" id="f_orig" type="number" step="0.01" min="0" value="${p?.original_price ?? ''}" placeholder="选填"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><label>封面（emoji 或图片 URL）</label><input class="input" id="f_cover" value="${esc(p?.cover || '🎁')}" maxlength="300" placeholder="🎁 或 https://图片地址.png"></div>
        <div class="field"><label>排序（越小越靠前）</label><input class="input" id="f_sort" type="number" value="${p?.sort ?? 0}"></div>
      </div>
      <div class="field"><label>描述</label><textarea class="textarea" id="f_desc" style="min-height:70px;font-family:var(--font)">${esc(p?.description || '')}</textarea></div>
      <div class="field">
        <label>库存显示方式</label>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="radio" name="f_stockmode" value="real" ${!p?.stock_text ? 'checked' : ''}> 实时显示数量</label>
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="radio" name="f_stockmode" value="text" ${p?.stock_text ? 'checked' : ''}> 自定义文案</label>
          <input class="input" id="f_stocktext" placeholder="如：库存充足 / 库存一般 / 库存少量" maxlength="30" value="${esc(p?.stock_text || '')}" style="flex:1;min-width:200px" ${p?.stock_text ? '' : 'disabled'}>
        </div>
        <div class="small muted" style="margin-top:6px">自定义文案会显示在前台商品卡片上；售罄时仍显示「已售罄」。</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary btn-lg btn-block" id="f_save">${isEdit ? '保存修改' : '创建商品'}</button>
      </div>`);
    const stockRadio = () => $('input[name="f_stockmode"]:checked', overlay)?.value;
    const syncStockText = () => { $('#f_stocktext', overlay).disabled = stockRadio() !== 'text'; };
    $$('input[name="f_stockmode"]', overlay).forEach((r) => r.addEventListener('change', syncStockText));
    $('#f_save', overlay).addEventListener('click', async () => {
      const body = {
        name: $('#f_name', overlay).value.trim(),
        category_id: $('#f_cat', overlay).value || null,
        price: $('#f_price', overlay).value,
        original_price: $('#f_orig', overlay).value || null,
        cover: $('#f_cover', overlay).value.trim() || '🎁',
        sort: $('#f_sort', overlay).value,
        description: $('#f_desc', overlay).value,
        stock_text: stockRadio() === 'text' ? $('#f_stocktext', overlay).value.trim() : '',
      };
      if (!body.name) return toast('请填写商品名称', 'warn');
      const res = await api(isEdit ? `/api/admin/products/${p.id}` : '/api/admin/products', {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      if (res.status === 200) { overlay._close(); toast(isEdit ? '已保存' : '已创建', 'success'); renderView('products'); }
      else toast(res.body.error || '保存失败', 'error');
    });
  }

  async function openCatsModal() {
    const cats = (await api('/api/admin/categories')).body;
    const overlay = openModal(`
      <div class="modal-title">分类管理</div>
      <div class="modal-sub">删除分类不会删除商品，商品将变为「未分类」</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px">
        <input class="input" id="c_name" placeholder="分类名称" maxlength="20">
        <input class="input" id="c_icon" placeholder="图标：emoji 或图片URL" maxlength="300" style="text-align:center">
      </div>
      <button class="btn btn-primary btn-sm" id="c_add">${icon('plus', 15)}新增分类</button>
      <div class="divider"></div>
      <div id="c_list">${cats.map((c) => `
        <div class="card-item" style="margin-bottom:8px">
          ${iconHTML(c.icon, 20)}
          <span style="flex:1">${esc(c.name)}<span class="small muted">（${c.product_count} 个商品）</span></span>
          <button class="btn btn-ghost btn-sm" data-cdel="${c.id}">${icon('trash', 14)}</button>
        </div>`).join('') || emptyState('暂无分类', 'tag')}
      </div>`);
    $('#c_add', overlay).addEventListener('click', async () => {
      const name = $('#c_name', overlay).value.trim();
      if (!name) return toast('请输入分类名称', 'warn');
      const res = await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name, icon: $('#c_icon', overlay).value.trim() || '🏷️' }) });
      if (res.status === 200) { overlay._close(); toast('已新增', 'success'); openCatsModal(); }
      else toast(res.body.error || '操作失败', 'error');
    });
    $$('[data-cdel]', overlay).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('确定删除该分类？')) return;
      const res = await api(`/api/admin/categories/${b.dataset.cdel}`, { method: 'DELETE' });
      if (res.status === 200) { overlay._close(); toast('已删除', 'success'); openCatsModal(); }
    }));
  }

  /* ================= 卡密：表格与操作 ================= */
  async function loadProductsOptions() {
    if (!state.productsCache) state.productsCache = (await api('/api/admin/products')).body;
    return state.productsCache;
  }

  async function renderCardsTable() {
    const prods = await loadProductsOptions();
    const sel = $('#cardsProduct');
    if (sel) {
      sel.innerHTML = `<option value="">全部商品</option>` + prods.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
      sel.value = state.cardsState.productId;
      $('#cardsStatus').value = state.cardsState.status;
    }
    const q = new URLSearchParams({ page: state.cardsState.page, page_size: state.cardsState.pageSize });
    if (state.cardsState.productId) q.set('product_id', state.cardsState.productId);
    if (state.cardsState.status !== '') q.set('status', state.cardsState.status);
    const d = (await api('/api/admin/cards?' + q)).body;
    const totalPages = Math.max(1, Math.ceil(d.total / d.page_size));
    $('#cardsTable').innerHTML = `
      <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th style="width:40px"><input type="checkbox" id="ckAll"></th><th>ID</th><th>卡密</th><th>商品</th><th>状态</th><th>关联订单</th><th>导入时间</th></tr></thead>
        <tbody>${d.list.map((c) => `
          <tr>
            <td><input type="checkbox" class="ck" value="${c.id}"></td>
            <td class="mono muted">${c.id}</td>
            <td class="mono" style="max-width:340px;word-break:break-all">${esc(c.secret)}</td>
            <td style="max-width:160px">${esc(c.product_name || '-')}</td>
            <td>${c.status === 0 ? '<span class="tag tag-cyan">未售</span>' : '<span class="tag tag-green">已售</span>'}</td>
            <td class="mono small">${c.order_no ? esc(c.order_no) : '<span class="muted">-</span>'}</td>
            <td class="small muted">${esc(c.created_at)}</td>
          </tr>`).join('') || `<tr class="tbl-empty"><td colspan="7">${emptyState('暂无卡密，点击「导入卡密」批量添加', 'box')}</td></tr>`}
        </tbody>
      </table>
      </div>
      <div class="pager">
        <span>共 <b>${d.total}</b> 条 · 第 ${d.page}/${totalPages} 页</span>
        <div class="pager-btns">
          <button class="btn btn-ghost btn-sm" data-cp="prev" ${d.page <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="btn btn-ghost btn-sm" data-cp="next" ${d.page >= totalPages ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    $('#ckAll').addEventListener('change', (e) => $$('.ck', $('#cardsTable')).forEach((c) => { c.checked = e.target.checked; }));
    $$('[data-cp]', $('#cardsTable')).forEach((b) => b.addEventListener('click', () => {
      state.cardsState.page += b.dataset.cp === 'next' ? 1 : -1;
      state.cardsState.page = Math.max(1, Math.min(totalPages, state.cardsState.page));
      renderCardsTable();
    }));
  }

  function bindCardsToolbar() {
    $('#cardsProduct').addEventListener('change', (e) => { state.cardsState.productId = e.target.value; state.cardsState.page = 1; renderCardsTable(); });
    $('#cardsStatus').addEventListener('change', (e) => { state.cardsState.status = e.target.value; state.cardsState.page = 1; renderCardsTable(); });
    $('#btnExport').addEventListener('click', (e) => {
      e.preventDefault();
      const pid = state.cardsState.productId;
      const token = getToken();
      fetch(`/api/admin/cards/export${pid ? '?product_id=' + pid : ''}`, { headers: { Authorization: 'Bearer ' + token } })
        .then((r) => {
          if (!r.ok) throw new Error('导出失败');
          return r.blob();
        })
        .then((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'cards_export.csv';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('已导出 CSV', 'success');
        })
        .catch((err) => toast(err.message, 'error'));
    });
    $('#btnImport').addEventListener('click', () => {
      const overlay = openModal(`
        <div class="modal-title">批量导入卡密</div>
        <div class="modal-sub">一行一张卡密，自动去除空白与重复项</div>
        <div class="field"><label>导入到商品</label><select class="select" id="impProduct">
          ${(state.productsCache || []).map((p) => `<option value="${p.id}" ${p.id === state.cardsState.productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>卡密内容（每行一条）</label>
          <textarea class="textarea" id="impText" placeholder="CARD-XXXX-XXXX&#10;CARD-YYYY-YYYY&#10;..." style="min-height:160px"></textarea>
        </div>
        <button class="btn btn-primary btn-lg btn-block" id="impBtn">开始导入</button>`);
      $('#impBtn', overlay).addEventListener('click', async () => {
        const res = await api('/api/admin/cards/import', {
          method: 'POST',
          body: JSON.stringify({ product_id: Number($('#impProduct', overlay).value), text: $('#impText', overlay).value }),
        });
        if (res.status !== 200) return toast(res.body.error || '导入失败', 'error');
        overlay._close();
        toast(`成功导入 ${res.body.inserted} 条${res.body.dup ? '，跳过重复 ' + res.body.dup + ' 条' : ''}`, 'success');
        state.cardsState.page = 1;
        renderCardsTable();
      });
    });
    $('#btnDelCards').addEventListener('click', async () => {
      const ids = $$('.ck:checked', $('#cardsTable')).map((c) => c.value);
      if (!ids.length) return toast('请先勾选要删除的卡密', 'warn');
      if (!confirm(`确定删除选中的 ${ids.length} 条未售卡密？`)) return;
      const res = await api('/api/admin/cards/delete', { method: 'POST', body: JSON.stringify({ ids }) });
      if (res.status === 200) { toast(`已删除 ${res.body.deleted} 条`, 'success'); renderCardsTable(); }
      else toast(res.body.error || '删除失败', 'error');
    });
  }

  /* ================= 订单：表格与操作 ================= */
  async function renderOrdersTable() {
    const q = new URLSearchParams({ page: state.ordersState.page, page_size: state.ordersState.pageSize, status: state.ordersState.status });
    if (state.ordersState.keyword) q.set('keyword', state.ordersState.keyword);
    const d = (await api('/api/admin/orders?' + q)).body;
    const totalPages = Math.max(1, Math.ceil(d.total / d.page_size));
    $('#ordersTable').innerHTML = `
      <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th style="width:40px"><input type="checkbox" id="oCheckAll"></th><th>订单号</th><th>商品</th><th>数量</th><th>金额</th><th>联系方式</th><th>状态</th><th>支付时间</th><th>操作</th></tr></thead>
        <tbody>${d.list.map((o) => `
          <tr>
            <td><input type="checkbox" class="o-check" value="${esc(o.order_no)}"></td>
            <td class="mono" style="white-space:nowrap">${esc(o.order_no)}</td>
            <td style="max-width:200px">${esc(o.product_name)}</td>
            <td>${o.quantity}</td>
            <td class="num">¥${fmtMoney(o.total)}</td>
            <td class="small">${esc(o.contact || '-')}</td>
            <td>${orderTag(o)}</td>
            <td class="small muted">${esc(o.paid_at || '-')}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-ghost btn-sm" data-oact="view" data-no="${esc(o.order_no)}">${icon('eye', 14)}详情</button>
                ${o.status === 'PAID' && o.deliver_status === 'shortage'
                  ? `<button class="btn btn-ghost btn-sm" data-oact="deliver" data-no="${esc(o.order_no)}">补发</button>` : ''}
                ${o.status === 'PAID'
                  ? `<button class="btn btn-danger btn-sm" data-oact="refund" data-no="${esc(o.order_no)}">退款</button>` : ''}
                <button class="btn btn-danger btn-sm" data-oact="del" data-no="${esc(o.order_no)}">${icon('trash', 13)}删除</button>
              </div>
            </td>
          </tr>`).join('') || `<tr class="tbl-empty"><td colspan="9">${emptyState('暂无符合条件的订单', 'box')}</td></tr>`}
        </tbody>
      </table>
      </div>
      <div class="pager">
        <span>共 <b>${d.total}</b> 条 · 第 ${d.page}/${totalPages} 页</span>
        <div class="pager-btns">
          <button class="btn btn-ghost btn-sm" data-op="prev" ${d.page <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="btn btn-ghost btn-sm" data-op="next" ${d.page >= totalPages ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    const ckAll = $('#oCheckAll', $('#ordersTable'));
    if (ckAll) ckAll.addEventListener('change', (e) => $$('.o-check', $('#ordersTable')).forEach((c) => { c.checked = e.target.checked; }));
    $$('[data-op]', $('#ordersTable')).forEach((b) => b.addEventListener('click', () => {
      state.ordersState.page += b.dataset.op === 'next' ? 1 : -1;
      state.ordersState.page = Math.max(1, Math.min(totalPages, state.ordersState.page));
      renderOrdersTable();
    }));
  }

  function bindOrdersToolbar() {
    $('#orderPills').addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      state.ordersState.status = pill.dataset.s;
      state.ordersState.page = 1;
      $$('.pill', $('#orderPills')).forEach((p) => p.classList.toggle('active', p === pill));
      renderOrdersTable();
    });
    $('#btnOrderSearch').addEventListener('click', () => {
      state.ordersState.keyword = $('#orderKeyword').value.trim();
      state.ordersState.page = 1;
      renderOrdersTable();
    });
    $('#orderKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnOrderSearch').click(); });
    $('#btnOrderDel').addEventListener('click', async () => {
      const nos = $$('.o-check:checked', $('#ordersTable')).map((c) => c.value);
      if (!nos.length) return toast('请先勾选要删除的订单', 'warn');
      if (!confirm(`确定删除选中的 ${nos.length} 笔订单？已支付的订单需先退款，无法直接删除。`)) return;
      const res = await api('/api/admin/orders/batch-delete', { method: 'POST', body: JSON.stringify({ nos }) });
      if (res.status === 200) {
        if (res.body.ok) toast(`已删除 ${res.body.ok} 笔`, 'success');
        if (res.body.skipped.length) toast(`跳过 ${res.body.skipped.length} 笔：` + res.body.reasons.slice(0, 2).join('；'), 'warn');
        renderOrdersTable();
      } else toast(res.body.error || '删除失败', 'error');
    });
  }

  async function handleOrderActs(e) {
    const btn = e.target.closest('[data-oact]');
    if (!btn) return;
    const no = btn.dataset.no;
    if (btn.dataset.oact === 'del') {
      if (!confirm('确定删除该订单？已支付的订单需先退款，无法直接删除。')) return;
      const r = await api(`/api/admin/orders/${encodeURIComponent(no)}`, { method: 'DELETE' });
      if (r.status === 200) { toast('已删除', 'success'); renderOrdersTable(); }
      else toast(r.body.error || '删除失败', 'error');
      return;
    }
    if (btn.dataset.oact === 'view') {
      const d = (await api(`/api/admin/orders/${no}`)).body;
      const overlay = openModal(`
        <div class="modal-title">订单详情 <span class="tag tag-cyan mono" style="margin-left:6px">${esc(d.order_no)}</span></div>
        <div class="modal-sub">下单于 ${esc(d.created_at)}</div>
        <div class="result-line"><span>商品</span><b>${esc(d.product_name)}</b></div>
        <div class="result-line"><span>数量 / 单价</span><b>${d.quantity} × ¥${fmtMoney(d.unit_price)}</b></div>
        <div class="result-line"><span>实付金额</span><b>¥${fmtMoney(d.total)}</b></div>
        <div class="result-line"><span>联系方式</span><b>${esc(d.contact || '-')}</b></div>
        <div class="result-line"><span>状态</span><b>${orderTag(d)}</b></div>
        <div class="result-line"><span>支付宝交易号</span><b class="mono small">${esc(d.trade_no || '-')}</b></div>
        <div class="result-line"><span>支付时间</span><b>${esc(d.paid_at || '-')}</b></div>
        ${d.cards && d.cards.length ? `
          <div class="cards-title" style="margin-top:16px">已发卡密（${d.cards.length} 张）</div>
          ${d.cards.map((c) => `
            <div class="card-item">
              <span class="card-secret">${esc(c.secret)}</span>
              <button class="btn btn-ghost btn-sm ccopy" data-secret="${esc(c.secret)}">${icon('copy', 15)}复制</button>
            </div>`).join('')}` : ''}
        <div class="modal-actions mt16">
          ${d.status === 'PAID' && d.deliver_status === 'shortage' ? `<button class="btn btn-primary" id="odDeliver">补发卡密</button>` : ''}
          ${d.status === 'PAID' ? `<button class="btn btn-danger" id="odRefund">标记退款并释放卡密</button>` : ''}
          ${d.status !== 'PAID' ? `<button class="btn btn-danger" id="odDelete">${icon('trash', 15)}删除订单</button>` : ''}
        </div>`);
      $$('.ccopy', overlay).forEach((b) => b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.secret).then(() => toast('已复制', 'success')).catch(() => {});
      }));
      const dl = $('#odDeliver', overlay);
      if (dl) dl.addEventListener('click', async () => {
        const r = await api(`/api/admin/orders/${no}/deliver`, { method: 'POST' });
        if (r.status === 200) { overlay._close(); toast('补发成功', 'success'); renderOrdersTable(); }
        else toast(r.body.error || '补发失败', 'error');
      });
      const rf = $('#odRefund', overlay);
      if (rf) rf.addEventListener('click', async () => {
        if (!confirm('确认退款？该订单已发的卡密将退回库存。')) return;
        const r = await api(`/api/admin/orders/${no}/refund`, { method: 'POST' });
        if (r.status === 200) { overlay._close(); toast('已退款并释放卡密', 'success'); renderOrdersTable(); }
        else toast(r.body.error || '退款失败', 'error');
      });
      const od = $('#odDelete', overlay);
      if (od) od.addEventListener('click', async () => {
        if (!confirm('确定删除该订单？')) return;
        const r = await api(`/api/admin/orders/${encodeURIComponent(no)}`, { method: 'DELETE' });
        if (r.status === 200) { overlay._close(); toast('已删除', 'success'); renderOrdersTable(); }
        else toast(r.body.error || '删除失败', 'error');
      });
    } else if (btn.dataset.oact === 'deliver') {
      const r = await api(`/api/admin/orders/${no}/deliver`, { method: 'POST' });
      if (r.status === 200) { toast(r.body.done ? '补发完成' : '已补发部分，仍需补货', 'success'); renderOrdersTable(); }
      else toast(r.body.error || '补发失败', 'error');
    } else if (btn.dataset.oact === 'refund') {
      if (!confirm('确认退款？该订单已发的卡密将退回库存。')) return;
      const r = await api(`/api/admin/orders/${no}/refund`, { method: 'POST' });
      if (r.status === 200) { toast('已退款并释放卡密', 'success'); renderOrdersTable(); }
      else toast(r.body.error || '退款失败', 'error');
    }
  }

  /* ================= 设置保存 ================= */
  async function handleSettingsClick(e) {
    if (!e.target.closest('#btnSaveSettings')) return;
    const form = $('.settings-form');
    if (!form) return;
    const data = {};
    $$('[name]', form).forEach((el) => { data[el.name] = el.value; });
    const btn = $('#btnSaveSettings');
    btn.disabled = true;
    btn.innerHTML = icon('clock', 19) + '保存中…';
    const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(data) });
    btn.disabled = false;
    btn.innerHTML = icon('check', 19) + '保存全部设置';
    if (res.status === 200) {
      toast('设置已保存', 'success');
      if (data.site_name) {
        state.siteName = data.site_name;
        $('#appSiteName').textContent = data.site_name;
        document.title = data.site_name + ' · 管理后台';
      }
    } else {
      toast(res.body.error || '保存失败', 'error');
    }
  }

  /* #view 全局点击分发（唯一入口，仅绑定一次） */
  async function onViewClick(e) {
    const pt = e.target.closest('[data-panel-toggle]');
    if (pt) {
      pt.classList.toggle('open');
      const body = pt.parentElement.querySelector('.panel-body');
      if (body) body.classList.toggle('open');
      return;
    }
    if (e.target.closest('[data-act]')) return handleProductActs(e);
    if (e.target.closest('[data-oact]')) return handleOrderActs(e);
    if (e.target.closest('#btnSaveSettings')) return handleSettingsClick(e);
  }
})();
