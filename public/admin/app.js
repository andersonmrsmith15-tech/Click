'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `${Number(n || 0).toLocaleString('uz-UZ', { maximumFractionDigits: 2 }).replace(/,/g, ' ')} so'm`;
  const dt = (s) => (s ? new Date(s).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const fmtCard = (n) => (/^\d{16}$/.test(n) ? n.replace(/(\d{4})(?=\d)/g, '$1 ') : n);
  const badge = (s) => `<span class="badge b-${esc(s)}">${esc(LABELS[s] || s)}</span>`;
  const LABELS = { active: 'Faol', blocked: 'Bloklangan', topup: "To'ldirish", debit: "To'lov", refund: 'Qaytarish', withdraw: 'Yechish' };

  let KEY = sessionStorage.getItem('adminKey') || '';
  let merchants = [];

  // ---------- API ----------
  async function api(method, path, body) {
    const res = await fetch('/api/v1/admin' + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error("Admin kalit noto'g'ri"); }
    if (!res.ok || data.ok === false) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data;
  }

  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  const fail = (e) => toast(e.message, true);

  // ---------- Auth ----------
  function logout() {
    KEY = ''; sessionStorage.removeItem('adminKey');
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    KEY = $('#loginKey').value.trim();
    try {
      await api('GET', '/stats');
      sessionStorage.setItem('adminKey', KEY);
      $('#loginErr').textContent = '';
      start();
    } catch (err) { $('#loginErr').textContent = err.message; $('#login').classList.remove('hidden'); }
  });
  $('#logout').addEventListener('click', logout);

  // ---------- Router ----------
  const views = { dashboard: loadDashboard, cards: loadCards, payments: loadPayments, merchants: loadMerchants };
  function route() {
    const v = (location.hash.slice(1) || 'dashboard');
    const view = views[v] ? v : 'dashboard';
    $$('[data-page]').forEach((s) => s.classList.toggle('hidden', s.dataset.page !== view));
    $$('[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    views[view]().catch(fail);
  }
  window.addEventListener('hashchange', route);
  $$('[data-refresh]').forEach((b) => b.addEventListener('click', route));

  async function start() {
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    await refreshMerchants().catch(fail);
    route();
  }

  async function refreshMerchants() {
    merchants = (await api('GET', '/merchants')).merchants;
    for (const sel of ['#cardMerchant', '#payMerchant']) {
      const el = $(sel); const cur = el.value;
      el.innerHTML = '<option value="">Barcha merchantlar</option>' +
        merchants.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      el.value = cur;
    }
  }

  // ---------- Dashboard ----------
  async function loadDashboard() {
    const [{ stats: s }, { payments }] = await Promise.all([api('GET', '/stats'), api('GET', '/payments?limit=10')]);
    const tile = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    $('#stats').innerHTML =
      tile('Kartalar', s.cards.total, `${s.cards.active} faol · ${s.cards.blocked} bloklangan`) +
      tile('Kartalardagi jami balans', money(s.cards.total_balance)) +
      tile("Muvaffaqiyatli to'lovlar", s.payments.completed, `jami ${money(s.payments.volume)}`) +
      tile('Bugun', money(s.today.volume), `${s.today.count} ta to'lov`) +
      tile('Kutilmoqda / Xato', `${s.payments.pending} / ${s.payments.failed}`, `${s.payments.refunded} ta qaytarilgan`) +
      tile('Merchantlar', s.merchants);
    renderPayments($('#recentPayments'), payments);
  }

  // ---------- Cards ----------
  let cardTimer;
  ['#cardSearch', '#cardStatus', '#cardMerchant'].forEach((s) =>
    $(s).addEventListener('input', () => { clearTimeout(cardTimer); cardTimer = setTimeout(() => loadCards().catch(fail), 250); }));

  async function loadCards() {
    const qs = new URLSearchParams({ q: $('#cardSearch').value, status: $('#cardStatus').value, merchant_id: $('#cardMerchant').value });
    const { cards, total } = await api('GET', '/cards?' + qs);
    const t = $('#cardsTable');
    t.innerHTML = `<thead><tr><th>Karta raqami</th><th>Muddat</th><th>Egasi</th><th>Telefon</th><th class="num">Balans</th><th>Holat</th><th>Merchant</th><th>Qo'shilgan</th></tr></thead><tbody>` +
      (cards.length ? cards.map((c) => `<tr class="click" data-token="${esc(c.card_token)}">
        <td class="mono">${esc(fmtCard(c.card_number))}</td><td>${esc(c.expiry)}</td><td>${esc(c.holder_name || '—')}</td>
        <td>${esc(c.phone || '—')}</td><td class="num">${money(c.balance)}</td><td>${badge(c.status)}</td>
        <td>${esc(c.merchant_name || 'Admin')}</td><td>${dt(c.created_at)}</td></tr>`).join('')
        : `<tr><td colspan="8" class="empty">Kartalar topilmadi</td></tr>`) + '</tbody>';
    $$('tr[data-token]', t).forEach((tr) => tr.addEventListener('click', () => openCard(tr.dataset.token).catch(fail)));
    $('#cardsTotal').textContent = `Jami: ${total} ta karta`;
  }

  const randomCard = () => (Math.random() < 0.5 ? '8600' : '9860') + Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  function defaultExpiry() { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String((d.getFullYear() + 4) % 100).padStart(2, '0')}`; }

  $('#newCardBtn').addEventListener('click', () => {
    openModal(`<h2>Yangi fake karta</h2>
      <form class="form" id="cardForm">
        <label>Karta raqami (16 raqam)
          <div class="inline"><input name="card_number" required maxlength="19" placeholder="8600 1234 5678 9012" class="mono">
          <button type="button" class="btn" id="genCard">🎲</button></div></label>
        <div class="row">
          <label>Amal qilish muddati (MM/YY)<input name="expiry" required placeholder="12/29" value="${defaultExpiry()}"></label>
          <label>Boshlang'ich balans (so'm)<input name="balance" type="number" min="0" step="0.01" value="1000000"></label>
        </div>
        <div class="row">
          <label>Karta egasi<input name="holder_name" placeholder="ALI VALIYEV"></label>
          <label>Telefon<input name="phone" placeholder="+998901234567"></label>
        </div>
        <label>Merchant (egasi)
          <select name="merchant_id"><option value="">— Admin (hech qaysi merchantga tegishli emas) —</option>
          ${merchants.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>
        <p class="muted" style="margin:0">Merchantga biriktirilgan kartani o'sha merchant API orqali ko'ra va to'ldira oladi. Har qanday karta bilan raqam+muddat orqali to'lash mumkin.</p>
        <button class="btn primary">Kartani yaratish</button>
      </form>`);
    const f = $('#cardForm');
    f.card_number.value = randomCard();
    $('#genCard').onclick = () => { f.card_number.value = randomCard(); };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      body.balance = Number(body.balance || 0);
      try {
        const { card } = await api('POST', '/cards', body);
        toast('Karta yaratildi');
        await loadCards();
        openCard(card.card_token);
      } catch (err) { fail(err); }
    });
  });

  async function openCard(token) {
    const { card: c, transactions } = await api('GET', '/cards/' + encodeURIComponent(token));
    openModal(`
      <h2>Karta ma'lumotlari</h2>
      <div class="detail-grid">
        <div style="display:grid;gap:14px">
          <div class="bank-card ${c.status === 'blocked' ? 'blocked' : ''}">
            <div class="bc-row"><b>Fake Click Pay</b><span>${c.status === 'blocked' ? '🔒 Bloklangan' : 'UZS'}</span></div>
            <div><div class="bc-num">${esc(fmtCard(c.card_number))}</div></div>
            <div class="bc-row"><div><div style="opacity:.75;font-size:11px">BALANS</div><div class="bc-bal">${money(c.balance)}</div></div>
              <div style="text-align:right"><div style="opacity:.75;font-size:11px">MUDDAT</div>${esc(c.expiry)}</div></div>
            <div class="bc-row"><span>${esc(c.holder_name || 'NOMSIZ')}</span></div>
          </div>
          <dl class="kv">
            <dt>Token</dt><dd class="mono">${esc(c.card_token)}</dd>
            <dt>Telefon</dt><dd>${esc(c.phone || '—')}</dd>
            <dt>Merchant</dt><dd>${esc(c.merchant_name || 'Admin')}</dd>
            <dt>Qo'shilgan</dt><dd>${dt(c.created_at)}</dd>
          </dl>
        </div>
        <div style="display:grid;gap:14px">
          <form class="panel" id="balForm">
            <b>Balansni o'zgartirish</b>
            <input name="amount" type="number" min="0.01" step="0.01" placeholder="Summa (so'm)" required>
            <div class="inline">
              <button class="btn ok" name="action" value="topup">+ To'ldirish</button>
              <button class="btn danger" name="action" value="withdraw">− Yechish</button>
            </div>
          </form>
          <form class="panel" id="editForm">
            <b>Tahrirlash</b>
            <div class="row">
              <input name="holder_name" placeholder="Karta egasi" value="${esc(c.holder_name || '')}">
              <input name="phone" placeholder="Telefon" value="${esc(c.phone || '')}">
            </div>
            <div class="row"><input name="expiry" placeholder="MM/YY" value="${esc(c.expiry)}"><button class="btn">Saqlash</button></div>
          </form>
          <div class="inline">
            ${c.status === 'active'
              ? '<button class="btn danger" id="toggleBlock">🔒 Bloklash</button>'
              : '<button class="btn ok" id="toggleBlock">🔓 Blokdan chiqarish</button>'}
            <button class="btn danger" id="delCard">O'chirish</button>
          </div>
        </div>
      </div>
      <h2>Harakatlar tarixi</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Sana</th><th>Turi</th><th class="num">Summa</th><th class="num">Qoldiq</th><th>To'lov</th></tr></thead>
        <tbody>${transactions.length ? transactions.map((t) => `<tr><td>${dt(t.created_at)}</td><td>${badge(t.type)}</td>
          <td class="num ${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : '−'}${money(Math.abs(t.amount))}</td>
          <td class="num">${money(t.balance_after)}</td><td class="mono">${esc(t.payment_id || '—')}</td></tr>`).join('')
          : '<tr><td colspan="5" class="empty">Harakatlar yo\'q</td></tr>'}</tbody></table></div>`);

    const after = async (msg) => { toast(msg); await Promise.all([openCard(token), loadCards()]); };
    const bf = $('#balForm');
    bf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = e.submitter?.value || 'topup';
      try { await api('POST', `/cards/${token}/balance`, { action, amount: Number(bf.amount.value) }); await after(action === 'topup' ? "Balans to'ldirildi" : 'Mablag\' yechildi'); } catch (err) { fail(err); }
    });
    const ef = $('#editForm');
    ef.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('PATCH', `/cards/${token}`, Object.fromEntries(new FormData(ef))); await after('Saqlandi'); } catch (err) { fail(err); }
    });
    $('#toggleBlock').onclick = async () => {
      try { await api('PATCH', `/cards/${token}`, { status: c.status === 'active' ? 'blocked' : 'active' }); await after(c.status === 'active' ? 'Karta bloklandi' : 'Karta faollashtirildi'); } catch (err) { fail(err); }
    };
    $('#delCard').onclick = async () => {
      if (!confirm(`${fmtCard(c.card_number)} kartasini o'chirasizmi?`)) return;
      try { await api('DELETE', `/cards/${token}`); closeModal(); toast("Karta o'chirildi"); loadCards(); } catch (err) { fail(err); }
    };
  }

  // ---------- Payments ----------
  let payTimer;
  ['#paySearch', '#payStatus', '#payMerchant'].forEach((s) =>
    $(s).addEventListener('input', () => { clearTimeout(payTimer); payTimer = setTimeout(() => loadPayments().catch(fail), 250); }));

  async function loadPayments() {
    const qs = new URLSearchParams({ q: $('#paySearch').value, status: $('#payStatus').value, merchant_id: $('#payMerchant').value });
    renderPayments($('#paymentsTable'), (await api('GET', '/payments?' + qs)).payments);
  }

  function renderPayments(t, rows) {
    t.innerHTML = `<thead><tr><th>Sana</th><th>Payment ID</th><th>Order ID</th><th>Karta</th><th class="num">Summa</th><th>Holat</th><th>Merchant</th><th>Izoh</th></tr></thead><tbody>` +
      (rows.length ? rows.map((p) => `<tr class="click" data-token="${esc(p.card_token)}">
        <td>${dt(p.created_at)}</td><td class="mono">${esc(p.payment_id)}</td><td>${esc(p.order_id || '—')}</td>
        <td class="mono">${esc(p.card_number)}</td><td class="num">${money(p.amount)}</td>
        <td>${badge(p.status)}${p.error_code ? ` <span class="muted">${esc(p.error_code)}</span>` : ''}</td>
        <td>${esc(p.merchant_name)}</td><td>${esc(p.description || '')}</td></tr>`).join('')
        : `<tr><td colspan="8" class="empty">To'lovlar hali yo'q</td></tr>`) + '</tbody>';
    $$('tr[data-token]', t).forEach((tr) => tr.addEventListener('click', () => openCard(tr.dataset.token).catch(fail)));
  }

  // ---------- Merchants ----------
  async function loadMerchants() {
    await refreshMerchants();
    const t = $('#merchantsTable');
    t.innerHTML = `<thead><tr><th>Nomi</th><th>ID</th><th>API kalit</th><th>Webhook URL</th><th class="num">Kartalar</th><th class="num">To'lovlar</th><th class="num">Aylanma</th><th></th></tr></thead><tbody>` +
      (merchants.length ? merchants.map((m) => `<tr>
        <td><b>${esc(m.name)}</b></td><td class="mono">${esc(m.id)}</td><td class="mono">${esc(m.api_key_prefix)}…</td>
        <td>${esc(m.webhook_url || '—')}</td><td class="num">${m.cards_count}</td><td class="num">${m.payments_count}</td>
        <td class="num">${money(m.volume)}</td>
        <td><button class="btn small" data-edit="${esc(m.id)}">Tahrirlash</button> <button class="btn small danger" data-rotate="${esc(m.id)}">Kalitni yangilash</button></td></tr>`).join('')
        : `<tr><td colspan="8" class="empty">Merchantlar yo'q</td></tr>`) + '</tbody>';
    $$('[data-edit]', t).forEach((b) => b.onclick = () => editMerchant(merchants.find((m) => m.id === b.dataset.edit)));
    $$('[data-rotate]', t).forEach((b) => b.onclick = async () => {
      const m = merchants.find((x) => x.id === b.dataset.rotate);
      if (!confirm(`"${m.name}" uchun yangi API kalit yaratilsinmi? Eski kalit darhol ishlamay qoladi.`)) return;
      try { const r = await api('POST', `/merchants/${m.id}/rotate-key`); showKeys(m.name, r.api_key, r.webhook_secret); loadMerchants(); } catch (err) { fail(err); }
    });
  }

  function editMerchant(m) {
    openModal(`<h2>Merchantni tahrirlash</h2>
      <form class="form" id="mForm">
        <label>Nomi<input name="name" required value="${esc(m.name)}"></label>
        <label>Webhook URL<input name="webhook_url" placeholder="https://..." value="${esc(m.webhook_url || '')}"></label>
        <button class="btn primary">Saqlash</button>
      </form>`);
    $('#mForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('PATCH', `/merchants/${m.id}`, Object.fromEntries(new FormData(e.target))); closeModal(); toast('Saqlandi'); loadMerchants(); } catch (err) { fail(err); }
    });
  }

  $('#newMerchantBtn').addEventListener('click', () => {
    openModal(`<h2>Yangi merchant</h2>
      <form class="form" id="mForm">
        <label>Nomi (loyiha nomi)<input name="name" required placeholder="Mening do'konim"></label>
        <label>Webhook URL (ixtiyoriy)<input name="webhook_url" placeholder="http://localhost:3000/clickpay/webhook"></label>
        <button class="btn primary">Yaratish</button>
      </form>`);
    $('#mForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { merchant } = await api('POST', '/merchants', Object.fromEntries(new FormData(e.target)));
        showKeys(merchant.name, merchant.api_key, merchant.webhook_secret);
        loadMerchants();
      } catch (err) { fail(err); }
    });
  });

  function showKeys(name, apiKey, secret) {
    const row = (label, v) => `<label>${label}<div class="secret"><span class="mono">${esc(v)}</span><button type="button" class="btn small" data-copy="${esc(v)}">Nusxa</button></div></label>`;
    openModal(`<h2>${esc(name)} — kalitlar</h2>
      <div class="form">
        <div class="warnbox">⚠️ API kalitni hozir saqlab qo'ying — u boshqa ko'rsatilmaydi.</div>
        ${row('API kalit (X-API-Key)', apiKey)}
        ${row('Webhook secret', secret)}
      </div>`);
    $$('[data-copy]').forEach((b) => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Nusxa olindi')));
  }

  // ---------- Modal ----------
  function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
  $('.modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---------- Boot ----------
  if (KEY) api('GET', '/stats').then(start).catch(logout); else logout();
})();
