'use strict';
/* 收银台逻辑：二维码加载、状态轮询、成功展示卡密 */
(function () {
  const { $, esc, fmtMoney, api, icon, toast, copyText } = window.Faka;
  const params = new URLSearchParams(location.search);
  const orderNo = params.get('orderNo') || '';
  let pollTimer = null;
  let payType = '';

  /* ---------- 静态图标 ---------- */
  $('#logoIcon').innerHTML = icon('bolt', 22);
  $('#navQuery').innerHTML = icon('qr', 16) + '查询卡密';
  $('#refreshBtn').innerHTML = icon('refresh', 17) + '我已支付';
  $('#jumpBtn').innerHTML = icon('store', 17) + '无法扫码？点击跳转支付';
  $('#mockWarnIcon').innerHTML = icon('alert', 18);
  $('#warnIcon').innerHTML = icon('alert', 18);
  document.querySelectorAll('.step .ic')[0].innerHTML = icon('check', 16);
  document.querySelectorAll('.step .ic')[1].innerHTML = icon('clock', 16);
  document.querySelectorAll('.step .ic')[2].innerHTML = icon('box', 16);
  $('#successView .success-ring .ic').innerHTML = icon('check', 46);

  async function init() {
    if (!orderNo) { showClosed('缺少订单号参数'); return; }
    $('#orderNo').textContent = '订单号 ' + orderNo;
    // 站点信息
    const site = await api('/api/site');
    if (site.body.siteName) {
      $('#siteName').textContent = site.body.siteName;
      document.title = '收银台 · ' + site.body.siteName;
    }
    await refreshOrder();
    pollTimer = setInterval(refreshOrder, 2500);
  }

  async function refreshOrder() {
    const contact = savedContact();
    const res = await api(`/api/orders/${encodeURIComponent(orderNo)}${contact ? '?contact=' + encodeURIComponent(contact) : ''}`);
    if (res.status !== 200) return;

    const o = res.body;
    $('#payAmount').textContent = fmtMoney(o.total);

    if (o.status === 'PAID') {
      clearInterval(pollTimer);
      renderSuccess(o);
    } else if (o.status === 'REFUNDED' || o.status === 'CLOSED') {
      clearInterval(pollTimer);
      showClosed('该订单已' + (o.status === 'REFUNDED' ? '退款' : '关闭'));
    } else if (o.status === 'PENDING') {
      $('#steps').className = 'steps s1';
      setStep(2, true);
      await ensureQr();
    }
  }

  async function ensureQr() {
    if ($('#qrImg').src) return;
    try {
      const res = await api(`/api/orders/${encodeURIComponent(orderNo)}/qr`);
      if (res.status !== 200) {
        $('#qrFrame').style.display = 'none';
        $('#qrTip').textContent = res.body.error || '二维码生成失败';
        return;
      }
      payType = res.body.payType;
      if (payType === 'mock') {
        $('#qrFrame').style.display = 'none';
        $('#qrTip').textContent = '演示模式：无需真实扫码，点击下方按钮模拟支付';
        $('#mockBox').style.display = 'block';
      } else if (payType === 'wap_pay') {
        // 手机网站支付：直接跳转支付宝（手机端拉起支付宝APP / 网页收银台），跳转失败可用备用按钮
        $('#qrFrame').style.display = 'none';
        $('#qrTip').textContent = '正在跳转支付宝完成支付…';
        $('#jumpBtn').style.display = 'inline-flex';
        if (res.body.payUrl) window.location.href = res.body.payUrl;
      } else if (payType === 'page_pay') {
        $('#jumpBtn').style.display = 'inline-flex';
        $('#qrTip').textContent = '请使用「支付宝」扫一扫，或点击右侧按钮在浏览器中完成支付';
        $('#qrImg').src = res.body.dataUrl;
      } else {
        $('#qrImg').src = res.body.dataUrl;
        $('#qrTip').textContent = '请使用「支付宝」扫一扫完成支付';
      }
    } catch {
      $('#qrTip').textContent = '二维码加载失败，请点击「我已支付」重试';
    }
  }

  /* ---------- 步骤条 ---------- */
  function setStep(n, on) {
    const st = $('[data-s="' + n + '"]');
    if (!st) return;
    st.classList.toggle('on', !!on);
    st.classList.toggle('done', !on);
  }

  /* ---------- 成功视图 ---------- */
  function renderSuccess(o) {
    $('#payCard').style.display = 'none';
    $('#steps').className = 'steps s2';
    setStep(2, false); setStep(3, true);
    $('#successView').style.display = 'block';
    $('#warnOrderNo').textContent = o.orderNo;
    $('#cardCount').textContent = o.quantity;

    const shortageHtml = o.deliverStatus === 'shortage'
      ? `<div class="warn-box mt16"><span>${icon('alert', 18)}</span><span>订单已支付，但<b>部分卡密库存不足暂未发出</b>，补货后将自动补发，或联系客服处理。</span></div>`
      : '';

    if (o.cards && o.cards.length) {
      renderCards(o.cards);
      if (shortageHtml) $('#cardsList').insertAdjacentHTML('beforeend', shortageHtml);
    } else if (shortageHtml) {
      $('#cardsList').innerHTML = shortageHtml;
    } else {
      $('#contactAsk').style.display = 'block';
      $('#contactBtn').addEventListener('click', async () => {
        const c = $('#contactInput').value.trim();
        if (!c) return toast('请输入联系方式', 'warn');
        const res = await api(`/api/orders/${encodeURIComponent(orderNo)}?contact=${encodeURIComponent(c)}`);
        if (res.status === 403) return toast(res.body.error || '联系方式不匹配', 'error');
        if (res.body.cards) { renderCards(res.body.cards); $('#contactAsk').style.display = 'none'; }
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderCards(cards) {
    $('#cardsList').innerHTML = cards.map((c, i) => `
      <div class="card-item reveal in">
        <span class="tag tag-cyan" style="flex:none">#${i + 1}</span>
        <span class="card-secret">${esc(c)}</span>
        <button class="btn btn-ghost btn-sm copy-btn" data-secret="${esc(c)}">${icon('copy', 15)}复制</button>
      </div>`).join('');
    $$('.copy-btn', $('#cardsList')).forEach((b) => {
      b.addEventListener('click', () => copyText(b.dataset.secret, '卡密已复制，请妥善保存'));
    });
  }

  function showClosed(msg) {
    clearInterval(pollTimer);
    $('#payCard').style.display = 'none';
    $('#steps').style.display = 'none';
    $('#closedView').style.display = 'block';
    $('#closedView .empty p').textContent = msg;
  }

  /* ---------- 联系方式存取 ---------- */
  function savedContact() {
    try {
      const raw = sessionStorage.getItem('faka_contact') || '';
      const [no, contact] = raw.split('::');
      return no === orderNo ? contact : '';
    } catch { return ''; }
  }

  /* ---------- 事件 ---------- */
  $('#refreshBtn').addEventListener('click', () => {
    $('#qrImg').src = ''; // 触发重新拉取
    refreshOrder();
  });
  $('#jumpBtn').addEventListener('click', async () => {
    const res = await api(`/api/orders/${encodeURIComponent(orderNo)}/qr`);
    if ((res.body.payType === 'page_pay' || res.body.payType === 'wap_pay') && res.body.payUrl) {
      window.open(res.body.payUrl, '_blank');
      return;
    }
    toast('当前支付方式暂不支持跳转', 'warn');
  });
  $('#mockBtn').addEventListener('click', async () => {
    const res = await api(`/api/dev/pay/${encodeURIComponent(orderNo)}`, { method: 'POST' });
    if (res.status !== 200) return toast(res.body.error || '模拟支付失败', 'error');
    toast('模拟支付成功，正在发货…', 'success');
    refreshOrder();
  });

  init();
})();
