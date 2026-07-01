'use strict';

/* ---------- Pomocnicze ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      n.addEventListener(k.slice(2), v);
      // iOS Safari nie odpala 'click' na zwykłych elementach bez cursor:pointer.
      if (k === 'onclick') { n.style.cursor = 'pointer'; n.style.touchAction = 'manipulation'; }
    } else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
};

const PLN = (n) =>
  (Number(n) || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const ACCOUNT_TYPES = {
  checking: 'Konto',
  cash: 'Gotówka',
  credit: 'Karta kredytowa',
  savings: 'Oszczędności',
};

async function api(path, opts = {}) {
  const hasBody = opts.body != null;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    // Content-Type tylko gdy jest treść — inaczej Fastify odrzuca puste DELETE/POST z 400.
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('401');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Błąd serwera');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------- Modal ---------- */
let _modalOnClose = null;
function openModal(title, bodyNode, onClose = null) {
  _modalOnClose = onClose;
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  body.appendChild(bodyNode);
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  const cb = _modalOnClose;
  _modalOnClose = null;
  if (cb) cb();
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]')) closeModal();
});

// Własne okno potwierdzenia (natywny confirm() bywa blokowany w PWA na iOS).
function confirmAction(message, okText = 'Usuń') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const body = el('div', {},
      el('p', { style: 'margin:0 0 18px;font-size:15px;line-height:1.4' }, message),
      el('button', { class: 'btn-primary', style: 'background:var(--red)', onclick: () => { finish(true); closeModal(); } }, okText),
      el('button', { class: 'btn-ghost', style: 'margin-top:10px', onclick: () => { finish(false); closeModal(); } }, 'Anuluj'),
    );
    openModal('Potwierdź', body, () => finish(false));
  });
}

/* ---------- Stan ---------- */
const state = {
  tab: 'dashboard',
  month: thisMonth(),
  categories: [],
  accounts: [],
};

async function refreshLookups() {
  [state.categories, state.accounts] = await Promise.all([
    api('/categories'),
    api('/accounts'),
  ]);
}
const expenseCats = () => state.categories.filter((c) => c.kind === 'expense');
const incomeCats = () => state.categories.filter((c) => c.kind === 'income');

/* ---------- Auth ---------- */
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

// Podpowiedz ostatni login.
try {
  const last = localStorage.getItem('budzet_user');
  if (last) { $('#login-username').value = last; setTimeout(() => $('#login-password').focus(), 100); }
} catch {}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const remember = $('#login-remember').checked;
  try {
    await api('/auth/login', {
      method: 'POST',
      body: { username: $('#login-username').value, password: $('#login-password').value, remember },
    });
    try {
      if (remember) localStorage.setItem('budzet_user', $('#login-username').value.trim());
      else localStorage.removeItem('budzet_user');
    } catch {}
    await boot();
  } catch (err) {
    $('#login-error').textContent = err.message === '401' ? 'Błędny login lub hasło' : err.message;
  }
});

/* ---------- Nawigacja ---------- */
const TITLES = {
  dashboard: 'Pulpit',
  transactions: 'Wydatki',
  shopping: 'Zakupy',
  analytics: 'Analiza',
  settings: 'Konta',
};
const MONTH_TABS = new Set(['transactions', 'analytics']);

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view-title').textContent = TITLES[tab];
  const pill = $('#month-pill');
  if (MONTH_TABS.has(tab)) {
    pill.hidden = false;
    pill.textContent = monthLabel(state.month);
  } else {
    pill.hidden = true;
  }
  render();
}
$('#month-pill').addEventListener('click', () => openMonthPicker());
$('#fab').addEventListener('click', () => openTxnModal());

function openMonthPicker() {
  const wrap = el('div');
  const cur = el('div', { class: 'seg' },
    el('button', { onclick: () => { state.month = shiftMonth(state.month, -1); closeModal(); switchTab(state.tab); } }, '‹ Poprzedni'),
    el('button', { onclick: () => { state.month = thisMonth(); closeModal(); switchTab(state.tab); } }, 'Bieżący'),
    el('button', { onclick: () => { state.month = shiftMonth(state.month, 1); closeModal(); switchTab(state.tab); } }, 'Następny ›'),
  );
  wrap.appendChild(el('p', { class: 'muted', style: 'text-align:center;margin:4px 0 14px;font-size:18px;font-weight:700;color:var(--text)' }, monthLabel(state.month)));
  wrap.appendChild(cur);
  openModal('Wybierz miesiąc', wrap);
}

/* ---------- Render dispatch ---------- */
async function render() {
  const view = $('#view');
  view.innerHTML = '<div class="empty"><div class="big">⏳</div>Ładowanie…</div>';
  try {
    if (state.tab === 'dashboard') await renderDashboard(view);
    else if (state.tab === 'transactions') await renderTransactions(view);
    else if (state.tab === 'shopping') await renderShopping(view);
    else if (state.tab === 'analytics') await renderAnalytics(view);
    else if (state.tab === 'settings') await renderSettings(view);
  } catch (err) {
    if (err.message === '401') return;
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'empty' }, el('div', { class: 'big' }, '⚠️'), err.message));
  }
}

// Opis karty kredytowej: zadłużenie / dostępne / limit.
function creditSub(a) {
  const debt = a.balance < 0 ? -a.balance : 0;
  const parts = [`Zadłużenie ${PLN(debt)}`];
  if (a.available != null) parts.push(`Dostępne ${PLN(a.available)}`);
  if (a.credit_limit != null) parts.push(`Limit ${PLN(a.credit_limit)}`);
  return parts.join(' · ');
}

/* ---------- Wiersz transakcji ---------- */
function txnRow(t) {
  const isTransfer = t.type === 'transfer_in' || t.type === 'transfer_out';
  const isPlus = t.type === 'income' || t.type === 'transfer_in';
  const sign = isPlus ? '+' : '−';
  const onClick = isTransfer
    ? async () => { if (await confirmAction('Usunąć ten przelew? Zniknie z obu kont.')) { await api('/transactions/' + t.id, { method: 'DELETE' }); toast('Usunięto'); render(); } }
    : () => openTxnModal(t);
  return el('div', { class: 'row-item' },
    el('div', { class: 'emoji', style: t.category_color ? `background:${hexA(t.category_color, .16)};` : '' }, t.category_emoji || (isTransfer ? '🔄' : '💸')),
    el('div', { class: 'grow', onclick: onClick },
      el('div', { class: 'title' }, t.category_name || (isTransfer ? 'Przelew' : 'Bez kategorii')),
      el('div', { class: 'sub' }, [t.account_name, t.note, t.occurred_at].filter(Boolean).join(' · ')),
    ),
    el('div', { class: 'amt ' + (isPlus ? 'inc' : 'exp') }, `${sign}${PLN(t.amount)}`),
  );
}
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------- Pulpit ---------- */
async function renderDashboard(view) {
  const [d, budg] = await Promise.all([api('/dashboard'), api('/budgets')]);
  view.innerHTML = '';

  const banner = budgetBanner(budg);
  if (banner) view.appendChild(banner);

  const hero = el('div', { class: 'hero' },
    el('div', { class: 'label' }, 'Suma majątku'),
    el('div', { class: 'amount' }, PLN(d.net_worth)),
    el('div', { class: 'row' },
      el('div', {}, 'Wydatki (mies.)', el('b', {}, PLN(d.month_spent))),
      el('div', {}, 'Wpływy (mies.)', el('b', {}, PLN(d.month_income))),
    ),
  );
  view.appendChild(hero);

  const accCard = el('div', { class: 'card' },
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px' },
      el('h3', { style: 'margin:0' }, 'Konta'),
      d.accounts.length >= 2 ? el('button', { class: 'chip', style: 'padding:6px 12px', onclick: () => openTransfer() }, '⇄ Przelew') : null,
    ),
  );
  if (!d.accounts.length) {
    accCard.appendChild(el('div', { class: 'muted', style: 'font-size:14px' }, 'Brak kont — dodaj je w zakładce „Konta”.'));
  } else {
    d.accounts.forEach((a) => {
      const isCredit = a.type === 'credit';
      accCard.appendChild(el('div', { class: 'acct-tile' },
        el('div', { class: 'grow' },
          el('div', { class: 'title' }, a.name, ' ', el('span', { class: 'badge' }, ACCOUNT_TYPES[a.type] || a.type)),
          isCredit ? el('div', { class: 'sub' }, creditSub(a)) : null,
        ),
        isCredit
          ? el('button', { class: 'chip', style: 'padding:6px 12px', onclick: () => openRepayModal(a) }, 'Spłać')
          : null,
        el('div', { class: 'amt', style: a.balance < 0 ? 'color:var(--red)' : 'color:var(--green)' }, PLN(a.balance)),
      ));
    });
  }
  view.appendChild(accCard);

  const recent = el('div', { class: 'card' }, el('h3', {}, 'Ostatnie transakcje'));
  if (!d.recent.length) recent.appendChild(el('div', { class: 'muted', style: 'font-size:14px' }, 'Jeszcze nic nie ma. Dodaj pierwszy wydatek przyciskiem +.'));
  else { const l = el('div', { class: 'list' }); d.recent.forEach((t) => l.appendChild(txnRow(t))); recent.appendChild(l); }
  view.appendChild(recent);
}

/* ---------- Wydatki ---------- */
async function renderTransactions(view) {
  const txns = await api('/transactions?month=' + state.month);
  view.innerHTML = '';

  const spent = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const inc = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  view.appendChild(el('div', { class: 'card', style: 'display:flex;justify-content:space-around;text-align:center' },
    el('div', {}, el('div', { class: 'muted', style: 'font-size:13px' }, 'Wydatki'), el('div', { class: 'amt exp', style: 'font-size:20px' }, PLN(spent))),
    el('div', {}, el('div', { class: 'muted', style: 'font-size:13px' }, 'Wpływy'), el('div', { class: 'amt inc', style: 'font-size:20px' }, PLN(inc))),
    el('div', {}, el('div', { class: 'muted', style: 'font-size:13px' }, 'Bilans'), el('div', { class: 'amt', style: 'font-size:20px;color:' + (inc - spent >= 0 ? 'var(--green)' : 'var(--red)') }, PLN(inc - spent))),
  ));

  const card = el('div', { class: 'card' });
  if (!txns.length) card.appendChild(el('div', { class: 'empty' }, el('div', { class: 'big' }, '🗓️'), 'Brak transakcji w tym miesiącu.'));
  else { const l = el('div', { class: 'list' }); txns.forEach((t) => l.appendChild(txnRow(t))); card.appendChild(l); }
  view.appendChild(card);
}

// Otwiera okno transakcji od razu w trybie przelewu (wymaga min. 2 kont).
function openTransfer() {
  if (state.accounts.length < 2) { toast('Potrzebujesz min. 2 kont, by zrobić przelew.'); return; }
  openTxnModal(null, 'transfer');
}

/* ---------- Modal transakcji ---------- */
function openTxnModal(existing = null, presetType = null) {
  if (!state.accounts.length) {
    toast('Najpierw dodaj konto w zakładce „Konta”.');
    switchTab('settings');
    return;
  }
  const t = existing || { type: 'expense', amount: '', account_id: state.accounts[0].id, category_id: null, note: '', occurred_at: todayISO() };
  let type = existing ? t.type : (presetType || t.type);
  let catId = t.category_id;

  const amount = el('input', { type: 'text', inputmode: 'decimal', class: 'amount-input', placeholder: '0,00', value: t.amount ? String(t.amount).replace('.', ',') : '' });
  const note = el('input', { type: 'text', placeholder: 'Notatka (opcjonalnie)', value: t.note || '' });
  const date = el('input', { type: 'date', value: t.occurred_at || todayISO() });
  const acct = el('select', {}, ...state.accounts.map((a) => el('option', { value: a.id, ...(a.id === t.account_id ? { selected: true } : {}) }, a.name)));
  const toAcct = el('select', {}, ...state.accounts.map((a) => el('option', { value: a.id, ...(a.type === 'credit' ? { selected: true } : {}) }, a.name)));

  const catWrap = el('div', { class: 'catgrid' });
  const renderCats = () => {
    catWrap.innerHTML = '';
    const cats = type === 'income' ? incomeCats() : expenseCats();
    cats.forEach((c) => {
      catWrap.appendChild(el('button', {
        type: 'button',
        class: 'catgrid-btn' + (c.id === catId ? ' active' : ''),
        onclick: () => { catId = c.id; renderCats(); },
      }, el('span', {}, c.emoji), c.name));
    });
    // zachowaj klasę .active po przebudowie
    catWrap.querySelectorAll('button').forEach((b, i) => { if (cats[i] && cats[i].id === catId) b.classList.add('active'); });
  };

  // Segment Przelew tylko przy nowej transakcji.
  const seg = el('div', { class: 'seg' },
    el('button', { type: 'button', onclick: () => { type = 'expense'; catId = null; segUpd(); } }, 'Wydatek'),
    el('button', { type: 'button', onclick: () => { type = 'income'; catId = null; segUpd(); } }, 'Wpływ'),
    existing ? null : el('button', { type: 'button', onclick: () => { type = 'transfer'; segUpd(); } }, 'Przelew'),
  );
  const catField = el('div', { class: 'field' }, el('label', {}, 'Kategoria'), catWrap);
  const acctLabel = el('label', {}, 'Konto');
  const toField = el('div', {}, el('label', {}, 'Na konto'), toAcct);
  function segUpd() {
    const isT = type === 'transfer';
    [...seg.children].forEach((b) => b && b.classList.remove('active'));
    seg.children[type === 'expense' ? 0 : type === 'income' ? 1 : 2].classList.add('active');
    catField.style.display = isT ? 'none' : '';
    toField.style.display = isT ? '' : 'none';
    acctLabel.textContent = isT ? 'Z konta' : 'Konto';
    if (!isT) renderCats();
  }
  renderCats();

  const save = el('button', { class: 'btn-primary', type: 'button', onclick: async () => {
    const val = parseFloat(String(amount.value).replace(',', '.').replace(/[^\d.]/g, ''));
    if (!val) { toast('Podaj kwotę'); return; }
    try {
      if (type === 'transfer') {
        if (Number(acct.value) === Number(toAcct.value)) { toast('Wybierz dwa różne konta'); return; }
        await api('/transactions/transfer', { method: 'POST', body: { from_account_id: Number(acct.value), to_account_id: Number(toAcct.value), amount: val, note: note.value, occurred_at: date.value } });
        closeModal(); toast('Przelew wykonany'); render();
        return;
      }
      const body = { type, amount: val, account_id: Number(acct.value), category_id: catId, note: note.value, occurred_at: date.value };
      if (existing) await api('/transactions/' + existing.id, { method: 'PATCH', body });
      else await api('/transactions', { method: 'POST', body });
      closeModal();
      toast(existing ? 'Zapisano' : 'Dodano');
      render();
    } catch (e) { toast(e.message); }
  } }, existing ? 'Zapisz' : 'Dodaj');

  const body = el('div', {},
    el('div', { class: 'field' }, seg),
    el('div', { class: 'field' }, amount),
    catField,
    el('div', { class: 'field row2' },
      el('div', {}, acctLabel, acct),
      el('div', {}, el('label', {}, 'Data'), date),
    ),
    toField,
    el('div', { class: 'field' }, el('label', {}, 'Notatka'), note),
    save,
    existing ? el('button', { class: 'btn-danger', type: 'button', style: 'margin-top:10px;width:100%', onclick: async () => {
      if (!(await confirmAction('Usunąć tę transakcję?'))) return;
      await api('/transactions/' + existing.id, { method: 'DELETE' });
      closeModal(); toast('Usunięto'); render();
    } }, 'Usuń') : null,
  );
  segUpd();
  openModal(existing ? 'Edytuj transakcję' : 'Nowa transakcja', body);
  setTimeout(() => amount.focus(), 100);
}

/* ---------- Zakupy ---------- */
async function renderShopping(view) {
  const lists = await api('/shopping-lists');
  view.innerHTML = '';
  view.appendChild(el('button', { class: 'btn-ghost', onclick: () => createShoppingList() }, '+ Nowa lista zakupów'));

  const open = lists.filter((l) => l.status === 'open');
  const done = lists.filter((l) => l.status === 'done');

  if (!open.length && !done.length) {
    view.appendChild(el('div', { class: 'empty' }, el('div', { class: 'big' }, '🛒'), 'Brak list. Utwórz pierwszą i dodaj produkty.'));
  }
  open.forEach((l) => view.appendChild(shoppingCard(l)));
  if (done.length) {
    view.appendChild(el('h3', { class: 'muted', style: 'margin:8px 4px 0' }, 'Zakończone'));
    done.forEach((l) => view.appendChild(shoppingCard(l, true)));
  }
}

function shoppingCard(l, isDone = false) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px' },
    el('div', {}, el('b', { style: 'font-size:16px' }, l.name),
      el('div', { class: 'muted', style: 'font-size:13px' }, `${l.items.length} poz. · ${PLN(l.total)}` + (isDone && l.finished_at ? ` · ✔ ${l.finished_at.slice(0, 10)}` : ''))),
    el('button', { class: 'icon-btn', onclick: async () => { if (await confirmAction('Usunąć listę „' + l.name + '”?')) { await api('/shopping-lists/' + l.id, { method: 'DELETE' }); toast('Usunięto'); render(); } } }, '🗑'),
  ));

  if (!isDone) {
    const itemsBox = el('div', { class: 'list' });
    l.items.forEach((it) => itemsBox.appendChild(shoppingItemRow(l, it)));
    card.appendChild(itemsBox);

    // dodawanie pozycji
    const name = el('input', { type: 'text', placeholder: 'Produkt', style: 'flex:2' });
    const price = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Cena', style: 'flex:1;min-width:0' });
    const addRow = el('form', { class: 'field row2', style: 'margin:12px 0 6px', onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      const p = parseFloat(String(price.value).replace(',', '.'));
      await api('/shopping-lists/' + l.id + '/items', { method: 'POST', body: { name: name.value.trim(), price: isNaN(p) ? null : p } });
      render();
    } },
      el('div', { style: 'flex:2' }, name),
      el('div', { style: 'flex:1' }, price),
      el('button', { class: 'btn-ghost', type: 'submit', style: 'width:auto;flex:0 0 auto;padding:12px 16px' }, '+'),
    );
    card.appendChild(addRow);

    card.appendChild(el('button', { class: 'btn-ghost', style: 'margin-top:6px', onclick: () => openBulkAddModal(l) }, '📋 Wklej paragon / dodaj wiele'));

    card.appendChild(el('button', { class: 'btn-primary', style: 'width:100%;margin-top:8px', onclick: () => finishShopping(l) },
      `Zakończ zakupy → dodaj ${PLN(l.total)}`));
  } else {
    const itemsBox = el('div', { class: 'list' });
    l.items.forEach((it) => itemsBox.appendChild(el('div', { class: 'checkrow done' },
      el('div', { class: 'cname' }, it.name), it.price != null ? el('div', { class: 'cprice' }, PLN(it.price * it.qty)) : null)));
    card.appendChild(itemsBox);
  }
  return card;
}

function shoppingItemRow(l, it) {
  const cb = el('input', { type: 'checkbox', ...(it.checked ? { checked: true } : {}) });
  cb.addEventListener('change', async () => {
    await api(`/shopping-lists/${l.id}/items/${it.id}`, { method: 'PATCH', body: { checked: cb.checked } });
    row.classList.toggle('done', cb.checked);
  });
  const row = el('div', { class: 'checkrow' + (it.checked ? ' done' : '') },
    cb,
    el('div', { class: 'cname' }, it.name),
    it.price != null ? el('div', { class: 'cprice' }, PLN(it.price * it.qty)) : null,
    el('button', { class: 'icon-btn', style: 'font-size:16px', onclick: async () => { await api(`/shopping-lists/${l.id}/items/${it.id}`, { method: 'DELETE' }); render(); } }, '✕'),
  );
  return row;
}

async function createShoppingList() {
  const name = el('input', { type: 'text', placeholder: 'np. Biedronka', value: '' });
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Nazwa listy'), name),
    el('button', { class: 'btn-primary', onclick: async () => {
      await api('/shopping-lists', { method: 'POST', body: { name: name.value.trim() || 'Zakupy' } });
      closeModal(); render();
    } }, 'Utwórz'),
  );
  openModal('Nowa lista zakupów', body);
  setTimeout(() => name.focus(), 100);
}

// Parser wklejonego paragonu / listy. Zwraca [{name, price, qty}]. Heurystyka + podgląd do edycji.
function parseReceipt(text) {
  const SKIP = /(suma|razem|ptu|paragon|fiskaln|niefiskaln|^nip|sprzeda[żz]|got[oó]wk|p[lł]atno|karta|reszta|rozliczenie|sprzedawc|dzi[eę]kuj|zaprasz|^vat|^kwota|wydano|^sklep|biedronka|jeronimo|^jmp|^ul\.|^\d{2}-\d{3}|^tel|^www|^#|^\*+|opust|rabat|do zap[lł]aty|^razem|bon|^nr |kasjer|^data|^godz)/i;
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line.length < 2) continue;
    if (SKIP.test(line)) continue;

    let qty = 1, price = null, cut = line.length;
    const qm = line.match(/(\d+(?:[.,]\d+)?)\s*(?:szt\.?|x|×)\s*(\d+[.,]\d{2})/i);
    const pm = line.match(/(\d+[.,]\d{2})\s*[A-Ga-g]?\s*$/);
    if (qm) { qty = parseFloat(qm[1].replace(',', '.')); price = parseFloat(qm[2].replace(',', '.')); cut = Math.min(cut, qm.index); }
    else if (pm) { price = parseFloat(pm[1].replace(',', '.')); cut = Math.min(cut, pm.index); }

    let name = line.slice(0, cut)
      .replace(/(\d+(?:[.,]\d+)?)\s*(?:szt\.?|x|×)\s*$/i, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/[\s.\-–:•*]+$/, '')
      .trim();
    if (!name || name.length < 2) continue;
    if (/^[\d.,]+$/.test(name)) continue;
    if (qty > 0 && price != null && qty !== 1) price = +(price).toFixed(2);
    out.push({ name, price, qty });
  }
  return out;
}

function openBulkAddModal(list) {
  const ta = el('textarea', { rows: '6', placeholder: 'Mleko 3,2% 1L      4,99\nChleb\nBanany   2 x 3,49   6,98\n…', style: 'width:100%;resize:vertical' });
  const preview = el('div', {});
  const rowsState = [];

  const addBtn = el('button', { class: 'btn-primary', style: 'margin-top:10px', onclick: async () => {
    const items = rowsState.filter((r) => r.cb.checked).map((r) => ({
      name: r.ni.value.trim(),
      price: String(r.pi.value).trim() ? parseFloat(String(r.pi.value).replace(',', '.')) : null,
      qty: r.qty,
    })).filter((i) => i.name);
    if (!items.length) { toast('Zaznacz przynajmniej jedną pozycję'); return; }
    try {
      const res = await api(`/shopping-lists/${list.id}/items/bulk`, { method: 'POST', body: { items } });
      closeModal(); toast(`Dodano ${res.added} poz.`); render();
    } catch (e) { toast(e.message); }
  } }, 'Dodaj zaznaczone');

  const buildPreview = () => {
    const parsed = parseReceipt(ta.value);
    preview.innerHTML = '';
    rowsState.length = 0;
    if (!parsed.length) {
      preview.appendChild(el('div', { class: 'muted', style: 'font-size:13px;padding:6px 0' }, 'Nie wykryto pozycji — wpisz po jednym produkcie w linii.'));
      addBtn.textContent = 'Dodaj zaznaczone';
      return;
    }
    parsed.forEach((p) => {
      const cb = el('input', { type: 'checkbox', checked: true });
      const ni = el('input', { type: 'text', value: p.name, style: 'flex:2;min-width:0' });
      const pi = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'cena', value: p.price != null ? String(p.price).replace('.', ',') : '', style: 'flex:1;min-width:0;max-width:90px;text-align:right' });
      rowsState.push({ cb, ni, pi, qty: p.qty });
      preview.appendChild(el('div', { class: 'checkrow', style: 'gap:8px' },
        cb, el('div', { style: 'flex:2;min-width:0' }, ni), el('div', { style: 'flex:1' }, pi)));
    });
    addBtn.textContent = `Dodaj zaznaczone (${parsed.length})`;
  };
  ta.addEventListener('input', buildPreview);

  // Wgrywanie PDF (e-paragon).
  const fileInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    toast('Wczytuję PDF…');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api('/shopping-lists/parse-pdf', { method: 'POST', body: { data: reader.result } });
        ta.value = res.text;
        buildPreview();
        toast('Wczytano PDF — sprawdź pozycje');
      } catch (e) { toast(e.message); }
      fileInput.value = '';
    };
    reader.onerror = () => toast('Nie udało się wczytać pliku');
    reader.readAsDataURL(file);
  });
  const pdfBtn = el('button', { class: 'btn-ghost', type: 'button', onclick: () => fileInput.click() }, '📄 Wgraj PDF paragonu (Biedronka)');

  const body = el('div', {},
    el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' },
      'Wgraj PDF paragonu albo wklej tekst (po jednym produkcie w linii). Sprawdź i popraw poniżej, potem dodaj. Pozycje trafią na koniec listy — ceny są opcjonalne.'),
    pdfBtn,
    fileInput,
    el('div', { class: 'muted', style: 'font-size:12px;text-align:center;margin:10px 0 6px' }, '— albo wklej ręcznie —'),
    el('div', { class: 'field' }, ta),
    el('div', {}, preview),
    addBtn,
  );
  openModal('Wklej paragon / dodaj wiele', body);
}

function finishShopping(l) {
  if (!state.accounts.length) { toast('Najpierw dodaj konto.'); switchTab('settings'); return; }
  const total = l.items.reduce((s, it) => s + (it.price != null ? it.price * it.qty : 0), 0);
  const amount = el('input', { type: 'text', inputmode: 'decimal', class: 'amount-input', value: total ? total.toFixed(2).replace('.', ',') : '' });
  const acct = el('select', {}, ...state.accounts.map((a) => el('option', { value: a.id }, a.name)));
  const groceries = expenseCats().find((c) => /spożyw/i.test(c.name));
  const cat = el('select', {}, ...expenseCats().map((c) => el('option', { value: c.id, ...(groceries && c.id === groceries.id ? { selected: true } : {}) }, `${c.emoji} ${c.name}`)));

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Kwota zakupów'), amount),
    el('div', { class: 'field' }, el('label', {}, 'Z konta'), acct),
    el('div', { class: 'field' }, el('label', {}, 'Kategoria'), cat),
    el('button', { class: 'btn-primary', onclick: async () => {
      const val = parseFloat(String(amount.value).replace(',', '.'));
      if (!val) { toast('Podaj kwotę'); return; }
      try {
        await api('/shopping-lists/' + l.id + '/finish', { method: 'POST', body: { amount: val, account_id: Number(acct.value), category_id: Number(cat.value) } });
        closeModal(); toast('Dodano do budżetu: ' + PLN(val)); render();
      } catch (e) { toast(e.message); }
    } }, 'Dodaj do budżetu'),
  );
  openModal('Zakończ zakupy', body);
}

/* ---------- Analiza ---------- */
let charts = [];
function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

async function renderAnalytics(view) {
  destroyCharts();
  const [a, budg] = await Promise.all([
    api('/analytics?month=' + state.month),
    api('/budgets?month=' + state.month),
  ]);
  view.innerHTML = '';

  view.appendChild(budgetCard(budg));

  const delta = a.this_month_total - a.prev_month_total;
  const pct = a.prev_month_total ? Math.round((delta / a.prev_month_total) * 100) : null;
  view.appendChild(el('div', { class: 'card', style: 'text-align:center' },
    el('div', { class: 'muted', style: 'font-size:13px' }, 'Wydatki w ' + monthLabel(a.month)),
    el('div', { class: 'amt exp', style: 'font-size:30px;margin:4px 0' }, PLN(a.this_month_total)),
    pct != null
      ? el('div', { class: delta > 0 ? 'delta-up' : 'delta-down', style: 'font-size:14px' },
          `${delta > 0 ? '▲' : '▼'} ${Math.abs(pct)}% wzgl. poprzedniego (${PLN(a.prev_month_total)})`)
      : el('div', { class: 'muted', style: 'font-size:13px' }, 'Brak danych z poprzedniego miesiąca'),
  ));

  // Donut wg kategorii
  if (a.by_category.length) {
    const donutCard = el('div', { class: 'card' }, el('h3', {}, 'Wydatki wg kategorii'));
    const cv = el('canvas', { height: '220' });
    donutCard.appendChild(cv);
    const legend = el('div', { class: 'legend' });
    const totalCat = a.by_category.reduce((s, c) => s + c.total, 0);
    a.by_category.forEach((c) => {
      legend.appendChild(el('div', { class: 'li' },
        el('span', { class: 'dot', style: `background:${c.color}` }),
        el('span', { class: 'grow' }, `${c.emoji} ${c.name}`),
        el('b', {}, PLN(c.total)),
        el('span', { class: 'muted', style: 'margin-left:6px;font-size:12px' }, `${Math.round((c.total / totalCat) * 100)}%`),
      ));
    });
    donutCard.appendChild(legend);
    view.appendChild(donutCard);
    charts.push(new Chart(cv, {
      type: 'doughnut',
      data: { labels: a.by_category.map((c) => c.name), datasets: [{ data: a.by_category.map((c) => c.total), backgroundColor: a.by_category.map((c) => c.color), borderWidth: 0 }] },
      options: { plugins: { legend: { display: false } }, cutout: '62%' },
    }));
  } else {
    view.appendChild(el('div', { class: 'empty' }, el('div', { class: 'big' }, '📊'), 'Brak wydatków w tym miesiącu.'));
  }

  // Trend 6 miesięcy
  const trendCard = el('div', { class: 'card' }, el('h3', {}, 'Trend (6 miesięcy)'));
  const tcv = el('canvas', { height: '200' });
  trendCard.appendChild(tcv);
  view.appendChild(trendCard);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5';
  charts.push(new Chart(tcv, {
    type: 'bar',
    data: {
      labels: a.trend.map((t) => t.month.slice(5)),
      datasets: [{ data: a.trend.map((t) => t.total), backgroundColor: accent, borderRadius: 6 }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => v } } } },
  }));

  // Operacje wewnętrzne (przelewy) — widoczne w raporcie, ale poza wydatkami.
  if (a.transfers && a.transfers.length) {
    const trCard = el('div', { class: 'card' },
      el('h3', { style: 'margin-bottom:4px' }, 'Operacje wewnętrzne'),
      el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:10px' },
        `Przelewy między Twoimi kontami — nie wliczają się do wydatków. Łącznie przeniesione: ${PLN(a.transfers_total)}.`),
    );
    const l = el('div', { class: 'list' });
    a.transfers.forEach((tr) => {
      l.appendChild(el('div', { class: 'row-item' },
        el('div', { class: 'emoji' }, '🔄'),
        el('div', { class: 'grow' },
          el('div', { class: 'title' }, `${tr.from_name || '—'} → ${tr.to_name || '—'}`),
          el('div', { class: 'sub' }, tr.occurred_at),
        ),
        el('div', { class: 'amt' }, PLN(tr.amount)),
      ));
    });
    trCard.appendChild(l);
    view.appendChild(trCard);
  }
}

/* ---------- Limity wydatków ---------- */
function budgetColor(pct) {
  if (pct == null) return 'var(--accent)';
  if (pct > 100) return 'var(--red)';
  if (pct >= 80) return '#f59e0b';
  return 'var(--green)';
}

// Baner na Pulpicie: czerwony przy przekroczeniu, bursztynowy gdy blisko (>=80%).
function budgetBanner(b) {
  if (!b || !b.any) return null;
  const withLimit = b.items.filter((i) => i.limit_amount != null);
  const over = withLimit.filter((i) => i.pct > 100);
  const near = withLimit.filter((i) => i.pct >= 80 && i.pct <= 100);

  const go = () => switchTab('analytics');

  if (over.length) {
    const sumOver = over.reduce((s, i) => s + (i.spent - i.limit_amount), 0);
    const names = over.map((i) => `${i.emoji} ${i.name}`).join(', ');
    return el('div', { class: 'banner warn', onclick: go },
      el('span', { class: 'b-ico' }, '⚠️'),
      el('div', {},
        el('b', {}, over.length > 1 ? 'Przekroczone limity' : 'Przekroczony limit'),
        el('div', {}, `${names} — łącznie ${PLN(sumOver)} ponad limit.`),
      ),
      el('span', { class: 'b-arrow' }, '›'),
    );
  }
  if (near.length) {
    const names = near.map((i) => `${i.emoji} ${i.name} (${i.pct}%)`).join(', ');
    return el('div', { class: 'banner soft', onclick: go },
      el('span', { class: 'b-ico' }, '🟡'),
      el('div', {},
        el('b', {}, 'Blisko limitu'),
        el('div', {}, names),
      ),
      el('span', { class: 'b-arrow' }, '›'),
    );
  }
  return null;
}

function budgetCard(b) {
  const card = el('div', { class: 'card' },
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px' },
      el('h3', { style: 'margin:0' }, 'Limity wydatków'),
      el('button', { class: 'chip', style: 'padding:6px 12px', onclick: () => openBudgetsModal() }, b.any ? 'Ustaw' : '+ Dodaj'),
    ),
  );

  if (!b.any) {
    card.appendChild(el('div', { class: 'muted', style: 'font-size:14px' },
      'Ustaw, ile chcesz wydawać miesięcznie na poszczególne kategorie — zobaczysz pasek postępu i alert przy przekroczeniu.'));
    return card;
  }

  // Pasek ogólny.
  const totalPct = b.total_limit ? Math.round((b.total_spent / b.total_limit) * 100) : 0;
  card.appendChild(el('div', { style: 'margin-bottom:14px' },
    el('div', { style: 'display:flex;justify-content:space-between;font-size:14px;margin-bottom:2px' },
      el('b', {}, 'Razem'), el('span', {}, `${PLN(b.total_spent)} / ${PLN(b.total_limit)}`)),
    el('div', { class: 'bar' }, el('div', { style: `width:${Math.min(100, totalPct)}%;background:${budgetColor(totalPct)}` })),
  ));

  // Per kategoria (tylko te z limitem), posortowane: najpierw najbliższe przekroczenia.
  b.items.filter((i) => i.limit_amount != null)
    .sort((x, y) => (y.pct || 0) - (x.pct || 0))
    .forEach((i) => {
      const over = i.pct > 100;
      card.appendChild(el('div', { style: 'margin-bottom:12px' },
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;font-size:14px;margin-bottom:3px' },
          el('span', {}, `${i.emoji} ${i.name}`),
          el('span', { class: over ? 'delta-up' : 'muted', style: 'font-size:13px' },
            over ? `przekroczono o ${PLN(i.spent - i.limit_amount)}` : `zostało ${PLN(i.remaining)}`),
        ),
        el('div', { class: 'bar' }, el('div', { style: `width:${Math.min(100, i.pct)}%;background:${budgetColor(i.pct)}` })),
        el('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, `${PLN(i.spent)} / ${PLN(i.limit_amount)} (${i.pct}%)`),
      ));
    });
  return card;
}

async function openBudgetsModal() {
  const b = await api('/budgets?month=' + state.month);
  const inputs = new Map();
  const rows = el('div', {});
  b.items.forEach((i) => {
    const inp = el('input', {
      type: 'text', inputmode: 'decimal', placeholder: 'brak limitu', style: 'max-width:120px;text-align:right',
      value: i.limit_amount != null ? String(i.limit_amount).replace('.', ',') : '',
    });
    inputs.set(i.category_id, { inp, orig: i.limit_amount });
    rows.appendChild(el('div', { class: 'acct-tile' },
      el('div', { class: 'grow' }, `${i.emoji} ${i.name}`),
      inp,
      el('span', { class: 'muted', style: 'font-size:13px;margin-left:8px' }, 'zł/mc'),
    ));
  });

  const body = el('div', {},
    el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' },
      'Wpisz miesięczny limit dla kategorii (puste = bez limitu). Limit obowiązuje co miesiąc.'),
    rows,
    el('button', { class: 'btn-primary', style: 'margin-top:8px', onclick: async () => {
      const tasks = [];
      for (const [catId, { inp, orig }] of inputs) {
        const raw = String(inp.value).replace(',', '.').trim();
        const val = raw === '' ? 0 : parseFloat(raw);
        const newVal = !val || val <= 0 ? null : val;
        if (newVal !== orig) {
          tasks.push(api('/budgets', { method: 'PUT', body: { category_id: catId, limit_amount: newVal || 0 } }));
        }
      }
      try { await Promise.all(tasks); closeModal(); toast('Limity zapisane'); render(); }
      catch (e) { toast(e.message); }
    } }, 'Zapisz limity'),
  );
  openModal('Limity wydatków', body);
}

/* ---------- Ustawienia / Konta ---------- */
async function renderSettings(view) {
  await refreshLookups();
  view.innerHTML = '';

  const accCard = el('div', { class: 'card' }, el('h3', {}, 'Konta i karty'));
  state.accounts.forEach((a) => {
    const isCredit = a.type === 'credit';
    accCard.appendChild(el('div', { class: 'acct-tile' },
      el('div', { class: 'grow', onclick: () => openAccountModal(a) },
        el('div', { class: 'title' }, a.name, ' ', el('span', { class: 'badge' }, ACCOUNT_TYPES[a.type] || a.type)),
        el('div', { class: 'sub' }, isCredit ? creditSub(a) : PLN(a.balance))),
      isCredit ? el('button', { class: 'chip', style: 'padding:6px 12px', onclick: () => openRepayModal(a) }, 'Spłać') : null,
      el('button', { class: 'icon-btn', onclick: () => openAccountModal(a) }, '✏️'),
    ));
  });
  accCard.appendChild(el('button', { class: 'btn-ghost', style: 'margin-top:12px', onclick: () => openAccountModal() }, '+ Dodaj konto / kartę'));
  if (state.accounts.length >= 2) {
    accCard.appendChild(el('button', { class: 'btn-ghost', style: 'margin-top:10px', onclick: () => openTransfer() }, '⇄ Przelew między kontami'));
  }
  view.appendChild(accCard);

  const catCard = el('div', { class: 'card' }, el('h3', {}, 'Kategorie'));
  const cgrid = el('div', { class: 'catgrid' });
  state.categories.forEach((c) => cgrid.appendChild(el('button', { type: 'button', onclick: () => openCategoryModal(c) }, el('span', {}, c.emoji), c.name)));
  catCard.appendChild(cgrid);
  catCard.appendChild(el('button', { class: 'btn-ghost', style: 'margin-top:12px', onclick: () => openCategoryModal() }, '+ Dodaj kategorię'));
  view.appendChild(catCard);

  const sec = el('div', { class: 'card' }, el('h3', {}, 'Konto i bezpieczeństwo'));
  sec.appendChild(el('button', { class: 'btn-ghost', onclick: () => openPasswordModal() }, 'Zmień hasło'));
  sec.appendChild(el('button', { class: 'btn-ghost', style: 'margin-top:10px', onclick: async () => { await api('/auth/logout', { method: 'POST' }); showLogin(); } }, 'Wyloguj się'));
  view.appendChild(sec);
}

function openAccountModal(a = null) {
  const name = el('input', { type: 'text', placeholder: 'np. mBank, Gotówka', value: a ? a.name : '' });
  const type = el('select', {}, ...Object.entries(ACCOUNT_TYPES).map(([v, lab]) => el('option', { value: v, ...(a && a.type === v ? { selected: true } : {}) }, lab)));
  // Dla karty kredytowej pole oznacza ZADŁUŻENIE (przechowywane jako ujemne saldo).
  const startCredit = a ? a.type === 'credit' : false;
  const balInit = a ? (startCredit ? -a.opening_balance : a.opening_balance) : '';
  const bal = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: balInit === '' ? '' : String(balInit).replace('.', ',') });
  const balLabel = el('label', {}, '');
  const balHelp = el('div', { class: 'muted', style: 'font-size:12px;margin-top:-4px' }, '');
  const limit = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'np. 5000', value: a && a.credit_limit != null ? String(a.credit_limit).replace('.', ',') : '' });
  const limitField = el('div', { class: 'field' }, el('label', {}, 'Limit karty'), limit);

  const updType = () => {
    const isCredit = type.value === 'credit';
    limitField.style.display = isCredit ? '' : 'none';
    balLabel.textContent = isCredit ? 'Aktualne zadłużenie (ile jesteś dłużny)' : (a ? 'Saldo początkowe' : 'Aktualne saldo');
    balHelp.textContent = isCredit ? 'Np. limit 5000 i wydane 3000 → wpisz 3000. Dostępne policzy się samo.' : '';
  };
  type.addEventListener('change', updType);

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Nazwa'), name),
    el('div', { class: 'field' }, el('label', {}, 'Typ'), type),
    el('div', { class: 'field' }, balLabel, bal, balHelp),
    limitField,
    el('button', { class: 'btn-primary', onclick: async () => {
      if (!name.value.trim()) { toast('Podaj nazwę'); return; }
      const num = parseFloat(String(bal.value).replace(',', '.')) || 0;
      const isCredit = type.value === 'credit';
      const body = {
        name: name.value.trim(), type: type.value,
        opening_balance: isCredit ? -Math.abs(num) : num,  // karta: zadłużenie -> ujemne saldo
        credit_limit: isCredit && limit.value ? parseFloat(String(limit.value).replace(',', '.')) : null,
      };
      if (a) await api('/accounts/' + a.id, { method: 'PATCH', body });
      else await api('/accounts', { method: 'POST', body });
      closeModal(); toast('Zapisano'); render();
    } }, a ? 'Zapisz' : 'Dodaj'),
    a ? el('button', { class: 'btn-danger', style: 'width:100%;margin-top:10px', onclick: async () => {
      if (!(await confirmAction('Usunąć konto? Jeśli ma transakcje, zostanie zarchiwizowane.'))) return;
      await api('/accounts/' + a.id, { method: 'DELETE' }); closeModal(); render();
    } }, 'Usuń konto') : null,
  );
  openModal(a ? 'Edytuj konto' : 'Nowe konto', body);
  updType();
}

// Modal spłaty karty (przelew z wybranego konta na kartę).
function openRepayModal(card) {
  const sources = state.accounts.filter((x) => x.id !== card.id && x.type !== 'credit');
  if (!sources.length) { toast('Najpierw dodaj konto, z którego spłacisz kartę.'); return; }
  const debt = card.balance < 0 ? -card.balance : 0;
  const amount = el('input', { type: 'text', inputmode: 'decimal', class: 'amount-input', value: debt ? debt.toFixed(2).replace('.', ',') : '' });
  const from = el('select', {}, ...sources.map((x) => el('option', { value: x.id }, `${x.name} (${PLN(x.balance)})`)));
  const date = el('input', { type: 'date', value: todayISO() });
  const body = el('div', {},
    el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' }, `Karta „${card.name}” — zadłużenie ${PLN(debt)}, dostępne ${PLN(card.available != null ? card.available : 0)}.`),
    el('div', { class: 'field' }, el('label', {}, 'Kwota spłaty'), amount),
    el('div', { class: 'field' }, el('label', {}, 'Z konta'), from),
    el('div', { class: 'field' }, el('label', {}, 'Data'), date),
    el('button', { class: 'btn-primary', onclick: async () => {
      const val = parseFloat(String(amount.value).replace(',', '.'));
      if (!val) { toast('Podaj kwotę'); return; }
      try {
        await api('/transactions/transfer', { method: 'POST', body: { from_account_id: Number(from.value), to_account_id: card.id, amount: val, occurred_at: date.value, note: 'Spłata karty' } });
        closeModal(); toast('Spłacono: ' + PLN(val)); render();
      } catch (e) { toast(e.message); }
    } }, 'Spłać kartę'),
  );
  openModal('Spłata karty', body);
}

const EMOJIS = [
  // Jedzenie i napoje
  '🛒','🍽️','🍔','🍕','🍜','🥗','🍣','🥐','🍞','🥩','🧀','🍎','🥦','🍺','🍷','☕','🧋','🥤','🍫','🍦','🎂',
  // Transport
  '🚗','⛽','🚕','🚌','🚆','🚲','🛴','✈️','🅿️','🔧',
  // Dom i rachunki
  '🏠','💡','🔥','💧','🚿','🛋️','🧹','🧺','🔌','📶','🛠️','🪑',
  // Zdrowie i uroda
  '💊','🏥','🦷','👓','💇','💄','🧴','🧼','🏋️','🧘','🩺',
  // Zakupy i ubrania
  '👕','👗','👟','👜','⌚','💍','🧢','🕶️','🛍️',
  // Rozrywka i hobby
  '🎬','🎮','🎵','🎧','🎸','📚','🎨','🎟️','🎳','⚽','🎯','🎲','📷','🌱',
  // Technologia i praca
  '📱','💻','🖥️','⌨️','🖨️','📦','✉️','📎','🖊️',
  // Finanse
  '💰','💵','💳','🏦','📈','📉','🪙','🧾','➕','➖',
  // Rodzina, dzieci, zwierzęta
  '🧒','👶','🍼','🐶','🐱','🐾','🎓','🎒',
  // Podróże i prezenty
  '🧳','🏨','🏖️','⛱️','🗺️','🎁','🎉','🌍',
  // Inne
  '🔑','🚬','💸','❓','⭐','❤️','🔖',
];
function openCategoryModal(c = null) {
  const name = el('input', { type: 'text', placeholder: 'Nazwa kategorii', value: c ? c.name : '' });
  let emoji = c ? c.emoji : '📦';
  let kind = c ? c.kind : 'expense';
  const egrid = el('div', { class: 'catgrid' });
  const renderE = () => {
    egrid.innerHTML = '';
    EMOJIS.forEach((e) => egrid.appendChild(el('button', { type: 'button', class: e === emoji ? 'active' : '', onclick: () => { emoji = e; renderE(); } }, el('span', {}, e))));
  };
  renderE();
  const seg = el('div', { class: 'seg' },
    el('button', { type: 'button', class: kind === 'expense' ? 'active' : '', onclick: () => { kind = 'expense'; seg.children[0].classList.add('active'); seg.children[1].classList.remove('active'); } }, 'Wydatek'),
    el('button', { type: 'button', class: kind === 'income' ? 'active' : '', onclick: () => { kind = 'income'; seg.children[1].classList.add('active'); seg.children[0].classList.remove('active'); } }, 'Wpływ'),
  );
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Nazwa'), name),
    el('div', { class: 'field' }, el('label', {}, 'Typ'), seg),
    el('div', { class: 'field' }, el('label', {}, 'Ikona'), egrid),
    el('button', { class: 'btn-primary', onclick: async () => {
      if (!name.value.trim()) { toast('Podaj nazwę'); return; }
      const body = { name: name.value.trim(), emoji, kind };
      if (c) await api('/categories/' + c.id, { method: 'PATCH', body });
      else await api('/categories', { method: 'POST', body });
      closeModal(); render();
    } }, c ? 'Zapisz' : 'Dodaj'),
    c ? el('button', { class: 'btn-danger', style: 'width:100%;margin-top:10px', onclick: async () => {
      if (!(await confirmAction('Ukryć kategorię?', 'Ukryj'))) return;
      await api('/categories/' + c.id, { method: 'DELETE' }); closeModal(); render();
    } }, 'Usuń') : null,
  );
  openModal(c ? 'Edytuj kategorię' : 'Nowa kategoria', body);
}

function openPasswordModal() {
  const cur = el('input', { type: 'password', placeholder: 'Obecne hasło', autocomplete: 'current-password' });
  const nw = el('input', { type: 'password', placeholder: 'Nowe hasło (min. 6 znaków)', autocomplete: 'new-password' });
  const body = el('div', {},
    el('div', { class: 'field' }, cur),
    el('div', { class: 'field' }, nw),
    el('button', { class: 'btn-primary', onclick: async () => {
      try { await api('/auth/change-password', { method: 'POST', body: { current: cur.value, next: nw.value } }); closeModal(); toast('Hasło zmienione'); }
      catch (e) { toast(e.message); }
    } }, 'Zmień hasło'),
  );
  openModal('Zmiana hasła', body);
}

/* ---------- Start ---------- */
async function boot() {
  try {
    await api('/auth/me');
    await refreshLookups();
    showApp();
    switchTab('dashboard');
  } catch (e) {
    if (e.message === '401') showLogin();
    else { showLogin(); }
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
