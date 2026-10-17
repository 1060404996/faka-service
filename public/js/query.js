'use strict';
/* 订单查询逻辑 */
(function () {
  const { $, esc, fmtMoney, api, icon, toast, copyText, emptyState } = window.Faka;

  $('#logoIcon').innerHTML = icon('bolt', 22);
  $('#queryBtn').innerHTML = icon('search', 19) + '查询订单';

  async function query() {
    const orderNo = $('#orderNo').value.trim();
    const contact = $('#contact').value.trim();
    if (!orderNo) return toast('请输入订单号', 'warn');

    const btn = $('#queryBtn');
    btn.disabled = true;
    btn.innerHTML = icon('clock', 19) + '查询中…';
    try {
      const res = await api(`/api/orders/${encodeURIComponent(orderNo)}${contact ? '?contact=' + encodeURIComponent(contact) : ''}`);
      btn.disabled = false;
      btn.innerHTML = icon('search', 19) + '查询订单';
      if (res.status !== 200) {
        $('#result').style.display = 'block';
        $('#result').innerHTML = `<div class="glass-strong query-card" style="text-align:center;color:var(--text-2)">
          ${emptyState(res.body.error || '查询失败', 'alert')}
        </div>`;
        return;
      }
      render(res.body);
    } catch {
      btn.disabled = false;
      btn.innerHTML = icon('search', 19) + '查询订单';
      toast('网络异常，请重试', 'error');
    }
  }

  function render(o) {
    const statusTag = o.status === 'PAID'
      ? '<span class="tag tag-green">已支付 · 已发货</span>'
      : o.status === 'REFUNDED'
        ? '<span class="tag tag-red">已退款</span>'
        : o.status === 'CLOSED'
          ? '<span class="tag tag-gray">已关闭</span>'
          : '<span class="tag tag-amber">待支付</span>';
    const shortage = o.deliverStatus === 'shortage'
      ? '<div class="warn-box mt16"><span>' + icon('alert', 18) + '</span><span>部分卡密库存不足暂未发出，补货后将自动补发，或联系客服处理。</span></div>' : '';

    let cardsHtml = '';
    if (o.cards && o.cards.length) {
      cardsHtml = `<div class="cards-title" style="margin-top:20px"><span class="ic" style="color:var(--green)">${icon('cards', 17)}</span>订单卡密（${o.cards.length} 张）</div>
        ${o.cards.map((c, i) => `
          <div class="card-item">
            <span class="tag tag-cyan" style="flex:none">#${i + 1}</span>
            <span class="card-secret">${esc(c)}</span>
            <button class="btn btn-ghost btn-sm copy-btn" data-secret="${esc(c)}">${icon('copy', 15)}复制</button>
          </div>`).join('')}`;
    } else if (o.status === 'PAID') {
      cardsHtml = `<div class="mt16" style="color:var(--text-3);font-size:13.5px">未返回卡密：若下单时填写了联系方式，请在查询时一并填写。</div>`;
    }

    $('#result').style.display = 'block';
    $('#result').innerHTML = `<div class="glass-strong query-card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <b style="font-size:16px">${esc(o.productName)}</b>${statusTag}
      </div>
      <div class="mt16">
        <div class="result-line"><span>订单号</span><b class="mono">${esc(o.orderNo)}</b></div>
        <div class="result-line"><span>数量</span><b>${o.quantity} 件</b></div>
        <div class="result-line"><span>金额</span><b>¥${fmtMoney(o.total)}</b></div>
        <div class="result-line"><span>下单时间</span><b>${esc(o.createdAt || '-')}</b></div>
        ${o.paidAt ? `<div class="result-line"><span>支付时间</span><b>${esc(o.paidAt)}</b></div>` : ''}
      </div>
      ${cardsHtml}
      ${shortage}
      <div class="pay-actions mt24">
        ${o.status === 'PENDING' ? `<a class="btn btn-primary" href="/pay.html?orderNo=${encodeURIComponent(o.orderNo)}">去支付</a>` : ''}
        <a class="btn btn-ghost" href="/">返回商城</a>
      </div>
    </div>`;
    $$('.copy-btn', $('#result')).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.secret, '卡密已复制，请妥善保存')));
    window.scrollTo({ top: $('#result').offsetTop - 90, behavior: 'smooth' });
  }

  $('#queryBtn').addEventListener('click', query);
  $('#orderNo').addEventListener('keydown', (e) => { if (e.key === 'Enter') query(); });
  $('#contact').addEventListener('keydown', (e) => { if (e.key === 'Enter') query(); });
})();
