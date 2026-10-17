'use strict';
/* 商城首页逻辑 */
(function () {
  const { $, $$, esc, fmtMoney, api, icon, toast, openModal, bindReveal, emptyState } = window.Faka;

  let categories = [];
  let products = [];
  let activeCat = 0; // 0 = 全部
  let site = {}; // 站点配置（含客服、联系方式必填等）

  /* emoji 或图片 URL 统一渲染 */
  function iconHTML(v, size = 18) {
    const s = String(v || '').trim();
    if (/^https?:\/\//i.test(s)) return `<img src="${esc(s)}" alt="" style="width:${size}px;height:${size}px;border-radius:6px;object-fit:cover;flex:none">`;
    return `<span style="font-size:${size}px;line-height:1">${esc(s)}</span>`;
  }

  /* ---------- 初始化 ---------- */
  init();

  async function init() {
    bindStaticUI();
    try {
      const [s, cats, prods] = await Promise.all([api('/api/site'), api('/api/categories'), api('/api/products')]);
      site = s.body;
      applySite(site);
      categories = cats.body;
      products = prods.body;
      renderChips();
      renderGrid();
      bindReveal();
    } catch {
      toast('加载失败，请检查服务是否已启动', 'error');
    }
  }

  /* ---------- 静态文案 / 图标注入 ---------- */
  function bindStaticUI() {
    $('#logoIcon').innerHTML = icon('bolt', 22);
    $('#footLogo').innerHTML = icon('bolt', 16);
    $('#searchIcon').innerHTML = icon('search', 17);
    $('#navQuery').innerHTML = icon('qr', 16) + '查询卡密';
    $$('.nav-links a[href="/admin.html"]')[0].innerHTML = icon('shield', 16) + '管理后台';
    $('#navSupport').innerHTML = icon('qq', 16) + '<span>客服</span>';
    $('#ctaBuy').innerHTML = icon('cart', 20) + '立即选购';
    $$('.hero-cta a.btn-ghost')[0].innerHTML = icon('qr', 19) + '查询卡密';
  }

  /* ---------- 站点信息 ---------- */
  function applySite(s) {
    if (!s) return;
    if (s.siteName) {
      $('#siteName').textContent = s.siteName;
      $('#footName').textContent = s.siteName;
      document.title = s.siteName + ' - 自动发卡';
    }
    $('#subtitle').textContent = s.siteSubtitle || '海量虚拟商品 · 支付宝官方支付 · 全自动发货';
    $('#footSub').textContent = s.siteSubtitle || '';
    if (s.siteNotice) {
      const n = $('#notice');
      n.style.display = 'flex';
      n.innerHTML = icon('alert', 18) + '<span>' + esc(s.siteNotice) + '</span>';
    }
    // 客服入口：任一渠道有值即显示
    const hasSupport = !!(s.serviceQQ || s.serviceWechat || s.serviceWechatQr || s.serviceTg);
    const sp = $('#navSupport');
    if (hasSupport) {
      sp.style.display = 'inline-flex';
      sp.addEventListener('click', (e) => { e.preventDefault(); openSupportModal(s); });
    }
    $('#heroStats').innerHTML = [
      `<div class="stat-chip">${icon('zap', 17)}<span>全自动 <b>秒级发货</b></span></div>`,
      `<div class="stat-chip">${icon('shield', 17)}<span>官方支付 <b>安全可靠</b></span></div>`,
      `<div class="stat-chip">${icon('clock', 17)}<span>24 小时 <b>自助查询</b></span></div>`,
      `<div class="stat-chip">${icon('box', 17)}<span>售后保障 <b>放心购买</b></span></div>`,
    ].join('');
  }

  /* ---------- 客服面板 ---------- */
  function openSupportModal(s) {
    const items = [];
    if (s.serviceQQ) {
      items.push(`
        <a class="support-item" data-act="qq" href="https://wpa.qq.com/msgrd?v=3&uin=${encodeURIComponent(s.serviceQQ)}&site=qq&menu=yes" target="_blank" rel="noopener">
          <span class="support-ic support-qq">${icon('qq', 24)}</span>
          <span class="support-info"><b>QQ 客服</b><small>${esc(s.serviceQQ)} · 点击跳转，同时自动复制号码</small></span>
          <span class="support-arrow">${icon('store', 16)}</span>
        </a>`);
    }
    if (s.serviceWechat || s.serviceWechatQr) {
      items.push(`
        <button class="support-item" data-act="wechat">
          <span class="support-ic support-wx">${icon('qq', 24)}</span>
          <span class="support-info"><b>微信客服</b><small>${s.serviceWechatQr ? '点击查看二维码扫码添加' : '点击复制微信号：' + esc(s.serviceWechat || '')}</small></span>
          <span class="support-arrow">${icon('store', 16)}</span>
        </button>`);
    }
    if (s.serviceTg) {
      items.push(`
        <a class="support-item" data-act="tg" href="https://t.me/${encodeURIComponent(String(s.serviceTg).replace(/^@/, ''))}" target="_blank" rel="noopener">
          <span class="support-ic support-tg">${icon('store', 24)}</span>
          <span class="support-info"><b>Telegram</b><small>@${esc(String(s.serviceTg).replace(/^@/, ''))} · 点击跳转对话</small></span>
          <span class="support-arrow">${icon('store', 16)}</span>
        </button>`);
    }
    if (!items.length) return;
    const overlay = openModal(`
      <div class="modal-title">联系客服</div>
      <div class="modal-sub">工作时间秒回 · 请优先选择您常用的方式</div>
      <div class="support-list">${items.join('')}</div>`);
    const wx = $('[data-act="wechat"]', overlay);
    if (wx) wx.addEventListener('click', () => {
      if (s.serviceWechatQr) {
        openModal(`
          <div class="modal-title">微信客服</div>
          <div class="modal-sub">打开微信扫一扫，添加客服</div>
          <div class="qr-card">
            <div class="qr-scanline"></div>
            <img src="${esc(s.serviceWechatQr)}" alt="微信二维码">
          </div>
          ${s.serviceWechat ? `<p class="qr-tip">或添加微信号：<b>${esc(s.serviceWechat)}</b></p>` : ''}
          <button class="btn btn-ghost btn-block mt16" data-copy-wx>${icon('copy', 16)}复制微信号</button>`);
        const cb = $('[data-copy-wx]', overlay);
        if (cb) cb.addEventListener('click', () => copyText(s.serviceWechat || '', '微信号已复制'));
      } else {
        copyText(s.serviceWechat || '', '微信号已复制');
      }
    });
  }

  /* ---------- 分类 ---------- */
  function renderChips() {
    const chips = $('#chips');
    const all = document.createElement('button');
    all.className = 'pill' + (activeCat === 0 ? ' active' : '');
    all.textContent = '全部商品';
    all.dataset.cat = '0';
    chips.appendChild(all);
    categories.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'pill' + (activeCat === c.id ? ' active' : '');
      b.innerHTML = iconHTML(c.icon, 15) + ' ' + esc(c.name);
      b.dataset.cat = c.id;
      chips.appendChild(b);
    });
    chips.addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      activeCat = Number(pill.dataset.cat);
      $$('.pill', chips).forEach((p) => p.classList.toggle('active', p === pill));
      renderGrid();
    });
  }

  /* ---------- 商品网格 ---------- */
  const COVERS = [
    ['#0e7490', '#164e63'], ['#0369a1', '#1e3a8a'], ['#0891b2', '#155e75'],
    ['#0d9488', '#134e4a'], ['#0284c7', '#1d4ed8'], ['#1d4ed8', '#0b3f8f'],
  ];
  const coverOf = (id) => COVERS[Math.abs(id) % COVERS.length];
  /* 封面：URL 渲染为图片，否则 emoji */
  const coverHTML = (v) => {
    const s = String(v || '').trim();
    if (/^https?:\/\//i.test(s)) return `<img class="p-cover-img" src="${esc(s)}" alt="">`;
    return `<span class="emoji">${esc(s || '🎁')}</span>`;
  };

  function renderGrid() {
    const kw = $('#searchInput').value.trim();
    let list = products.filter((p) => activeCat === 0 || p.category_id === activeCat);
    if (kw) list = list.filter((p) => (p.name + p.description).toLowerCase().includes(kw.toLowerCase()));

    const grid = $('#grid');
    if (!list.length) {
      grid.innerHTML = emptyState('暂无符合条件的商品');
      return;
    }
    grid.innerHTML = list.map((p) => {
      const [c1, c2] = coverOf(p.id);
      const soldOut = p.stock <= 0;
      const low = p.stock > 0 && p.stock <= 5;
      const customText = (p.stock_text || '').trim();
      const stockLabel = soldOut ? '已售罄' : (customText ? customText : '库存 ' + p.stock);
      const lowCls = (!customText && low && !soldOut) ? 'low' : '';
      const stIcon = soldOut ? 'alert' : ((!customText && low) ? 'alert' : 'box');
      return `<article class="p-card reveal" data-id="${p.id}">
        <div class="p-cover" style="--c1:${c1};--c2:${c2}">${coverHTML(p.cover)}</div>
        <div class="p-body">
          <h3 class="p-name">${esc(p.name)}</h3>
          <p class="p-desc">${esc(p.description || '暂无描述')}</p>
          <div class="p-meta">
            <span class="price"><small>¥</small>${fmtMoney(p.price)}${p.original_price ? `<span class="orig">¥${fmtMoney(p.original_price)}</span>` : ''}</span>
            <span class="stock-tip ${lowCls}${customText ? ' custom' : ''}">${icon(stIcon, 14)}${esc(stockLabel)}</span>
          </div>
          <button class="btn btn-primary btn-block buy-btn" ${soldOut ? 'disabled' : ''}>${soldOut ? '已售罄' : '立即购买'}</button>
        </div>
        ${soldOut ? '<div class="p-soldout"><span>SOLD OUT</span></div>' : ''}
      </article>`;
    }).join('');

    grid.querySelectorAll('.buy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.p-card');
        const p = products.find((x) => x.id === Number(card.dataset.id));
        if (p) openBuyModal(p);
      });
    });
    bindReveal(grid);
  }

  $('#searchInput').addEventListener('input', () => renderGrid());

  /* ---------- 购买弹窗 ---------- */
  function openBuyModal(p) {
    const stock = p.stock;
    const [c1, c2] = coverOf(p.id);
    const reqContact = String(site.requireContact || '1') === '1';
    let qty = 1;
    const overlay = openModal(`
      <div class="modal-title">确认购买</div>
      <div class="modal-sub">支付成功后将自动发货到订单</div>
      <div class="buy-summary">
        <div class="buy-cover" style="--c1:${c1};--c2:${c2}">${coverHTML(p.cover)}</div>
        <div class="buy-info">
          <div class="n">${esc(p.name)}</div>
          <div class="d">${esc(p.description || '')}</div>
        </div>
      </div>
      <div class="qty-row">
        <span class="qty-label">购买数量</span>
        <div class="qty-stepper">
          <button class="qty-btn" id="qMinus" title="减少">${icon('minus', 16)}</button>
          <span class="qty-val" id="qVal">1</span>
          <button class="qty-btn" id="qPlus" title="增加">${icon('plus', 16)}</button>
        </div>
      </div>
      <div class="field">
        <label>联系方式<span class="req-mark">${reqContact ? '必填' : '选填'}</span><span class="req-hint">，用于支付后查询卡密</span></label>
        <input class="input" id="buyContact" placeholder="手机号 / 邮箱 / QQ，支付后凭此查询卡密" maxlength="64">
      </div>
      <div class="total-line">
        <span class="l">应付金额</span>
        <span class="v"><small>¥</small><span id="buyTotal">${fmtMoney(p.price)}</span></span>
      </div>
      <button class="btn btn-primary btn-lg btn-block buy-submit" id="buySubmit">${icon('bolt', 19)}提交订单并支付</button>
    `);

    const val = $('#qVal', overlay);
    const total = $('#buyTotal', overlay);
    const refresh = () => {
      val.textContent = qty;
      $('#qMinus', overlay).disabled = qty <= 1;
      $('#qPlus', overlay).disabled = qty >= Math.min(50, stock);
      total.textContent = fmtMoney(p.price * qty);
    };
    $('#qMinus', overlay).addEventListener('click', () => { if (qty > 1) { qty--; refresh(); } });
    $('#qPlus', overlay).addEventListener('click', () => { if (qty < Math.min(50, stock)) { qty++; refresh(); } });
    refresh();

    $('#buySubmit', overlay).addEventListener('click', async (e) => {
      const contact = $('#buyContact', overlay).value.trim();
      if (reqContact && !contact) {
        toast('请填写联系方式，便于支付后查询卡密', 'warn');
        return;
      }
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = icon('clock', 19) + '正在创建订单…';
      try {
        const res = await api('/api/orders', {
          method: 'POST',
          body: JSON.stringify({ productId: p.id, quantity: qty, contact }),
        });
        if (res.status !== 200) {
          toast(res.body.error || '下单失败', 'error');
          btn.disabled = false;
          btn.innerHTML = icon('bolt', 19) + '提交订单并支付';
          return;
        }
        sessionStorage.setItem('faka_contact', res.body.orderNo + '::' + contact);
        overlay._close();
        location.href = '/pay.html?orderNo=' + encodeURIComponent(res.body.orderNo);
      } catch {
        toast('网络异常，请重试', 'error');
        btn.disabled = false;
        btn.innerHTML = icon('bolt', 19) + '提交订单并支付';
      }
    });
  }

  /* ---------- 导航滚动效果 ---------- */
  const nav = $('#nav');
  window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 10), { passive: true });
})();
