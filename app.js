'use strict';
// Учёт финансов. Всё хранится в localStorage этого устройства.
// Пишется без новейших возможностей JS/CSS, чтобы работало на iOS 15 (iPhone 7).

const KEY = 'finance.v1';
const DEFAULT_CATS = {
  exp: ['Еда', 'Кафе', 'Транспорт', 'Дом', 'Связь', 'Здоровье', 'Одежда', 'Развлечения', 'Подарки', 'Другое'],
  inc: ['Зарплата', 'Подработка', 'Подарок', 'Другое'],
};
const ICONS = {
  'Еда': '🛒', 'Кафе': '☕', 'Транспорт': '🚌', 'Дом': '🏠', 'Связь': '📱', 'Здоровье': '💊',
  'Одежда': '👕', 'Развлечения': '🎮', 'Подарки': '🎁', 'Другое': '📦',
  'Зарплата': '💼', 'Подработка': '🛠️', 'Подарок': '🎁',
};
const COLORS = ['#1f8a5b', '#3b7dd8', '#e0912f', '#c8452f', '#8c5ad1', '#2aa3a3', '#d65c9b', '#7a8c2b', '#b07945', '#6f7571'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const AUTO_MONTHS = 12;  // срок для целей без даты и плана
const CURRENCIES = { RUB: '₽', USD: '$', EUR: '€' };
const DAY_MS = 864e5;
const MONTH_DAYS = 30.44;

const $ = (id) => document.getElementById(id);

// ---------- Данные ----------
// ops:   { id, type: 'exp'|'inc', amount, cat, note, date, ts, useful: true|false (только у расходов) }
// goals: { id, name, target, plan, deadline, initial (уже было, не из баланса),
//          deposits: [{ id, amount (+ положили / − взяли), date, ts }] }

function defaults() {
  return {
    ops: [], budgets: {}, goals: [], cats: JSON.parse(JSON.stringify(DEFAULT_CATS)),
    currency: 'RUB', reminderSeen: '',
  };
}

function migrate(s) {
  if (!CURRENCIES[s.currency]) {
    s.currency = s.currency === '$' ? 'USD' : s.currency === '€' ? 'EUR' : 'RUB';
  }
  // У каждой цели должна быть точная сумма в месяц: без даты и плана ставим срок сами
  s.goals.forEach((g) => {
    if (!g.deadline && !g.plan) { g.deadline = inMonths(AUTO_MONTHS); g.autoDeadline = true; }
  });
  if (s.reminderSeen && s.reminderSeen.length !== 7) s.reminderSeen = '';  // раньше хранилась дата
  return s;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Array.isArray(saved.ops)) return migrate(Object.assign(defaults(), saved));
  } catch (e) { /* пусто или повреждено — начинаем заново */ }
  return defaults();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    toast('Не удалось сохранить данные');
  }
}

let state = load();
let statsMonth = monthKey(today());
let editing = null;      // id редактируемой операции
let sheetType = 'exp';
let sheetCat = null;
let sheetUseful = null;  // нужная (true) / лишняя (false) трата
let addingCat = false;   // показывать поле ввода новой категории
let editingGoal = null;  // id редактируемой цели
let moneyGoal = null;    // id цели, которую пополняем
let moneyDir = 1;        // 1 — положить, -1 — взять

// ---------- Утилиты ----------

function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return iso(new Date()); }
function monthKey(date) { return date.slice(0, 7); }
function shiftMonth(key, delta) {
  const parts = key.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1 + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
function daysBetween(from, to) { return (new Date(to) - new Date(from)) / DAY_MS; }
function money(n) {
  const num = Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const sign = n < 0 ? '−' : '';
  const sym = CURRENCIES[state.currency];
  // $ и € пишутся перед суммой, ₽ — после
  return state.currency === 'RUB' ? sign + num + ' ' + sym : sign + sym + num;
}
function parseAmount(s) {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
function amountText(n) { return n ? String(n).replace('.', ',') : ''; }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function icon(cat) { return ICONS[cat] || '🏷️'; }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function pct(part, whole) { return whole ? Math.round((part / whole) * 100) : 0; }

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function longDate(date) {
  const p = date.split('-').map(Number);
  const year = p[0] !== new Date().getFullYear() ? ' ' + p[0] : '';
  return p[2] + ' ' + MONTHS_GEN[p[1] - 1] + year;
}

function dayTitle(date) {
  if (date === today()) return 'Сегодня';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (date === iso(y)) return 'Вчера';
  return longDate(date);
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ---------- Подсчёты ----------

function depositsSum(g) {
  return g.deposits.reduce((s, d) => s + d.amount, 0);
}
function goalSaved(g) {
  return (g.initial || 0) + depositsSum(g);
}
function totalSaved() {
  return state.goals.reduce((s, g) => s + goalSaved(g), 0);
}
// Баланс: доходы − расходы − то, что переложено в копилку (старые накопления не считаются).
function freeBalance() {
  let bal = 0;
  state.ops.forEach((op) => { bal += op.type === 'inc' ? op.amount : -op.amount; });
  state.goals.forEach((g) => { bal -= depositsSum(g); });
  return bal;
}

function monthTotals(key) {
  const t = { inc: 0, exp: 0, byCat: {}, useful: 0, waste: 0, unmarked: 0, saved: 0 };
  state.ops.forEach((op) => {
    if (monthKey(op.date) !== key) return;
    if (op.type === 'inc') { t.inc += op.amount; return; }
    t.exp += op.amount;
    t.byCat[op.cat] = (t.byCat[op.cat] || 0) + op.amount;
    if (op.useful === true) t.useful += op.amount;
    else if (op.useful === false) t.waste += op.amount;
    else t.unmarked += op.amount;
  });
  state.goals.forEach((g) => g.deposits.forEach((d) => {
    if (monthKey(d.date) === key) t.saved += d.amount;
  }));
  return t;
}

// Прогноз по цели: сколько осталось, когда накопится, сколько откладывать к сроку.
function goalInfo(g) {
  const saved = goalSaved(g);
  const left = Math.max(0, g.target - saved);
  const info = { saved: saved, left: left, pct: Math.min(100, pct(saved, g.target)), lines: [] };
  if (!left) {
    info.lines.push('🎉 Цель достигнута!');
    return info;
  }

  let rate = 0, how = '';
  if (g.plan) {
    rate = g.plan;
    how = 'по плану';
  } else if (depositsSum(g) > 0) {
    const first = g.deposits.reduce((m, d) => (d.date < m ? d.date : m), g.deposits[0].date);
    rate = depositsSum(g) / Math.max(1, daysBetween(first, today()) / MONTH_DAYS);
    how = 'в среднем';
  }
  if (rate > 0) {
    const months = Math.ceil(left / rate);
    const when = new Date();
    when.setDate(1);  // чтобы 31 октября + 4 мес. не превратилось в май
    when.setMonth(when.getMonth() + months);
    info.lines.push('⏳ Накопится через ' + months + ' ' + plural(months, 'месяц', 'месяца', 'месяцев') +
      ', в ' + MONTHS_PREP[when.getMonth()] + ' ' + when.getFullYear() +
      ' <span class="muted">(' + how + ' ' + esc(money(Math.round(rate))) + ' в мес.)</span>');
  } else if (!g.deadline) {
    info.lines.push('<span class="muted">Пополните копилку, задайте дату или план, чтобы увидеть прогноз</span>');
  }

  if (g.deadline) {
    const n = deadlineNeed(left, g.deadline);
    if (!n) {
      info.lines.push('⚠️ Срок ' + longDate(g.deadline) + ' уже прошёл');
    } else {
      const late = rate > 0 && rate < n.month;
      info.need = '<div class="need">💰 Чтобы успеть к ' + longDate(g.deadline) + ', откладывайте' +
        '<div class="need-big">' + esc(money(n.month)) + ' в месяц</div>' +
        '<div class="muted">≈ ' + esc(money(n.week)) + ' в неделю' +
        (g.autoDeadline ? ' · срок я поставил сам, его можно изменить' : '') + '</div>' +
        (late ? '<div class="exp">Сейчас откладываете меньше и не успеваете</div>' : '') + '</div>';
    }
  }
  return info;
}

// Сколько откладывать, чтобы собрать left к дате: в месяц и в неделю.
function deadlineNeed(left, deadline) {
  const days = daysBetween(today(), deadline);
  if (days <= 0) return null;
  return {
    month: Math.ceil(left / monthsUntil(deadline)),
    week: Math.ceil(left / Math.max(1, Math.ceil(days / 7))),
  };
}

// Дата через n месяцев — срок для целей, у которых нет ни даты, ни плана.
function inMonths(n) {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth() + n, d.getDate()));
}

function monthsUntil(date) {
  return Math.max(1, Math.round(daysBetween(today(), date) / MONTH_DAYS));
}

// План на текущий месяц: сколько класть в каждую цель (по сроку или по плану)
// и сколько из этого ещё не отложено. Цели без срока и плана получают остаток при распределении.
function monthPlan() {
  const key = monthKey(today());
  const items = state.goals.map((g) => {
    const thisMonth = g.deposits.reduce((s, d) => s + (monthKey(d.date) === key ? d.amount : 0), 0);
    const leftAtStart = Math.max(0, g.target - goalSaved(g) + thisMonth);
    let need = 0, why = '';
    if (leftAtStart > 0 && g.deadline) {
      need = daysBetween(today(), g.deadline) > 0 ? leftAtStart / monthsUntil(g.deadline) : leftAtStart;
      why = 'к ' + longDate(g.deadline);
    } else if (leftAtStart > 0 && g.plan) {
      need = Math.min(g.plan, leftAtStart);
      why = 'по плану';
    }
    need = Math.ceil(need);
    return {
      g: g, need: need, why: why,
      rest: Math.max(0, need - thisMonth),
      capacity: Math.max(0, g.target - goalSaved(g)),
    };
  });
  return {
    items: items,
    total: items.reduce((s, i) => s + i.need, 0),
    rest: items.reduce((s, i) => s + i.rest, 0),
  };
}


// Раскладывает сумму по целям: сначала то, что нужно по срокам и планам,
// остаток — пропорционально тому, сколько каждой цели не хватает.
function distribute(sum, plan) {
  const items = plan.items.filter((i) => i.capacity > 0);
  const want = items.map((i) => Math.min(i.rest, i.capacity));
  const wantTotal = want.reduce((a, b) => a + b, 0);
  const alloc = want.map((w) => (wantTotal <= sum ? w : (sum * w) / wantTotal));
  let left = sum - alloc.reduce((a, b) => a + b, 0);
  const cap = items.map((i, k) => i.capacity - alloc[k]);
  const capTotal = cap.reduce((a, b) => a + b, 0);
  if (left > 0 && capTotal > 0) {
    const share = Math.min(left, capTotal);
    cap.forEach((c, k) => { alloc[k] += (share * c) / capTotal; });
    left -= share;
  }
  // до целых рублей, не теряя ни рубля из суммы
  const placed = Math.round(sum - left);
  const parts = alloc.map(Math.floor);
  let extra = placed - parts.reduce((a, b) => a + b, 0);
  const order = alloc.map((a, k) => k).sort((x, y) => (alloc[y] % 1) - (alloc[x] % 1));
  for (let n = 0; extra > 0 && n < order.length; n++, extra--) parts[order[n]]++;
  return {
    parts: items.map((i, k) => ({ g: i.g, amount: parts[k] })).filter((p) => p.amount > 0),
    placed: placed,
    leftover: Math.round((sum - placed) * 100) / 100,
  };
}

// ---------- Отрисовка ----------

function renderHeader() {
  const bal = freeBalance();
  const piggy = totalSaved();
  $('balance').textContent = money(bal);
  $('balance').className = 'balance' + (bal < 0 ? ' exp' : '');
  const t = monthTotals(monthKey(today()));
  $('mInc').textContent = '↑ ' + money(t.inc);
  $('mExp').textContent = '↓ ' + money(t.exp);
  $('piggyLine').textContent = piggy > 0 ? '🐷 ' + money(piggy) : '';
}

// Лента: операции и движения по копилке вперемешку, по датам.
function feed() {
  const items = state.ops.map((op) => ({ kind: 'op', op: op, date: op.date, ts: op.ts }));
  state.goals.forEach((g) => g.deposits.forEach((d) => {
    items.push({ kind: 'dep', goal: g, dep: d, date: d.date, ts: d.ts });
  }));
  return items.sort((a, b) => (a.date === b.date ? b.ts - a.ts : a.date < b.date ? 1 : -1));
}

function opRow(op) {
  const sign = op.type === 'inc' ? '+' : '−';
  let mark = '', tag = '';
  if (op.type === 'exp' && op.useful === true) { mark = ' good'; tag = '<span class="tag good">нужная</span>'; }
  if (op.type === 'exp' && op.useful === false) { mark = ' bad'; tag = '<span class="tag bad">лишняя</span>'; }
  const sub = [tag, op.note ? esc(op.note) : ''].filter(Boolean).join(' ');
  return '<button type="button" class="op" data-id="' + op.id + '">' +
    '<span class="op-icon' + mark + '">' + icon(op.cat) + '</span>' +
    '<span class="op-main"><div class="op-cat">' + esc(op.cat) + '</div>' +
    (sub ? '<div class="op-note">' + sub + '</div>' : '') + '</span>' +
    '<span class="op-sum ' + op.type + '">' + sign + money(op.amount) + '</span></button>';
}

function depRow(g, d) {
  const put = d.amount > 0;
  return '<button type="button" class="op" data-goal="' + g.id + '">' +
    '<span class="op-icon">🐷</span>' +
    '<span class="op-main"><div class="op-cat">' + (put ? 'В копилку' : 'Из копилки') + '</div>' +
    '<div class="op-note">' + esc(g.name) + '</div></span>' +
    '<span class="op-sum save">' + (put ? '−' : '+') + money(Math.abs(d.amount)) + '</span></button>';
}

function renderHome() {
  const items = feed().slice(0, 300);
  if (!items.length) {
    $('opsList').innerHTML = '<div class="empty"><b>Пока пусто</b>Нажмите «+», чтобы записать первый доход или расход.</div>';
    return;
  }
  let html = '';
  let current = null;
  items.forEach((it) => {
    if (it.date !== current) {
      if (current) html += '</div>';
      current = it.date;
      html += '<div class="day">' + dayTitle(it.date) + '</div><div class="card list">';
    }
    html += it.kind === 'op' ? opRow(it.op) : depRow(it.goal, it.dep);
  });
  html += '</div>';
  $('opsList').innerHTML = html;
}

function donutSvg(entries, total) {
  const r = 70, c = 2 * Math.PI * r;
  let offset = 0;
  let rings = '';
  if (!entries.length) {
    rings = '<circle cx="100" cy="100" r="' + r + '" fill="none" style="stroke:var(--chip)" stroke-width="26"/>';
  }
  entries.forEach((e, i) => {
    const len = (e[1] / total) * c;
    rings += '<circle cx="100" cy="100" r="' + r + '" fill="none" stroke="' + COLORS[i % COLORS.length] +
      '" stroke-width="26" stroke-dasharray="' + len + ' ' + (c - len) + '" stroke-dashoffset="' + (-offset) +
      '" transform="rotate(-90 100 100)"/>';
    offset += len;
  });
  return '<svg viewBox="0 0 200 200" role="img" aria-label="Расходы по категориям">' + rings +
    '<text x="100" y="98" text-anchor="middle" class="donut-total">' + esc(money(total)) + '</text>' +
    '<text x="100" y="118" text-anchor="middle" class="donut-label">расходы</text></svg>';
}

function renderUseful(t) {
  if (!t.exp && !t.saved) { $('usefulCard').innerHTML = ''; return; }
  const marked = t.useful + t.waste;
  let html = '<div class="card"><div class="card-title">Контроль покупок</div>';
  if (marked) {
    const u = pct(t.useful, marked), w = 100 - u;
    html += '<div class="split"><i class="good-bg" style="width:' + u + '%"></i><i class="bad-bg" style="width:' + w + '%"></i></div>' +
      '<div class="split-legend"><span><span class="good">👍 Нужные</span><br><b>' + money(t.useful) + '</b> <span class="muted">' + u + '%</span></span>' +
      '<span class="right"><span class="bad">👎 Лишние</span><br><b>' + money(t.waste) + '</b> <span class="muted">' + w + '%</span></span></div>';
    if (t.waste) html += '<p class="note">Лишние траты за месяц: <b class="bad">' + money(t.waste) + '</b>. Эти деньги могли бы пойти в копилку 🐷</p>';
  } else {
    html += '<p class="note muted">Отмечайте расходы как «нужные» или «лишние», и здесь появится статистика.</p>';
  }
  if (t.unmarked) html += '<p class="note muted">Без отметки: ' + money(t.unmarked) + '</p>';
  if (t.saved) html += '<p class="note">🐷 Отложено в копилку: <b class="save">' + money(t.saved) + '</b></p>';
  $('usefulCard').innerHTML = html + '</div>';
}

function renderStats() {
  const p = statsMonth.split('-').map(Number);
  $('statsTitle').textContent = MONTHS[p[1] - 1] + ' ' + p[0];
  $('nextM').style.visibility = statsMonth >= monthKey(today()) ? 'hidden' : 'visible';
  const t = monthTotals(statsMonth);
  $('sInc').textContent = money(t.inc);
  $('sExp').textContent = money(t.exp);
  renderUseful(t);
  const entries = Object.keys(t.byCat).map((k) => [k, t.byCat[k]]).sort((a, b) => b[1] - a[1]);
  $('donut').innerHTML = donutSvg(entries, t.exp);
  if (!entries.length) {
    $('catList').innerHTML = '<div class="cat-row muted">Расходов в этом месяце нет</div>';
    return;
  }
  $('catList').innerHTML = entries.map((e, i) => {
    const share = pct(e[1], t.exp);
    const color = COLORS[i % COLORS.length];
    return '<div class="cat-row"><div class="cat-head"><span><i class="dot" style="background:' + color + '"></i>' +
      icon(e[0]) + ' ' + esc(e[0]) + '</span><span>' + money(e[1]) + ' <span class="muted">' + share + '%</span></span></div>' +
      '<div class="bar"><i style="width:' + share + '%;background:' + color + '"></i></div></div>';
  }).join('');
}

function renderGoals() {
  if (!state.goals.length) {
    $('goalsList').innerHTML = '<div class="empty"><b>🐷 Копилка пуста</b>Создайте цель: на что копите и сколько нужно. ' +
      'Приложение посчитает, когда сумма накопится.</div>';
    return;
  }
  let html = '<div class="card piggy-total"><small>Всего в копилке</small><b class="save">' + money(totalSaved()) + '</b></div>' +
    planCard();
  state.goals.forEach((g) => {
    const info = goalInfo(g);
    html += '<div class="card goal' + (info.left ? '' : ' done') + '">' +
      '<div class="goal-head"><b>' + esc(g.name) + '</b><button type="button" class="link" data-edit="' + g.id + '">Изменить</button></div>' +
      '<div class="goal-sum"><b>' + money(info.saved) + '</b> <span class="muted">из ' + money(g.target) + '</span></div>' +
      '<div class="bar big"><i style="width:' + info.pct + '%"></i></div>' +
      '<small class="muted">' + info.pct + '%' + (info.left ? ' · осталось накопить ' + money(info.left) : '') + '</small>' +
      (info.need || '') +
      '<div class="goal-lines">' + info.lines.map((l) => '<div>' + l + '</div>').join('') + '</div>' +
      '<div class="goal-actions">' +
      '<button type="button" class="primary" data-dep="' + g.id + '">+ Пополнить</button>' +
      '<button type="button" class="secondary" data-wd="' + g.id + '">− Взять</button></div></div>';
  });
  $('goalsList').innerHTML = html;
}

function planCard() {
  const plan = monthPlan();
  const month = MONTHS_PREP[new Date().getMonth()];
  let html = '<div class="card"><div class="card-title">📅 План на месяц</div>';
  if (plan.total) {
    html += plan.items.filter((i) => i.need).map((i) =>
        '<div class="plan-row muted"><span>' + esc(i.g.name) + ' · ' + i.why + '</span><span>' + money(i.need) + '</span></div>'
      ).join('') +
      '<div class="plan-row"><span>Всего в месяц</span><b>' + money(plan.total) + '</b></div>' +
      '<div class="plan-row"><span>Осталось отложить в ' + month + '</span><b class="save">' + money(plan.rest) + '</b></div>';
  }
  html += '<p class="note muted">Свободно на балансе: ' + money(freeBalance()) + '</p>' +
    '<button type="button" class="primary wide-btn dist-btn" data-dist="1">' +
    (plan.rest ? 'Отложить ' + money(plan.rest) : 'Отложить ещё, я распределю') + '</button>' +
    '<a class="cal-link" href="reminders.ics" target="_blank" rel="noopener">🔔 Напоминание в Календарь (раз в месяц)</a>';
  return html + '</div>';
}

function renderReminder() {
  const key = monthKey(today());
  const plan = monthPlan();
  if (!plan.rest || state.reminderSeen === key) {
    $('reminder').innerHTML = '';
    return;
  }
  $('reminder').innerHTML = '<div class="card reminder"><b>🐷 В ' + MONTHS_PREP[new Date().getMonth()] +
    ' отложите ' + money(plan.rest) + '</b>' +
    '<div class="muted">Сумму я посчитал по вашим целям и срокам и сам распределю её. Отложить можно в любой день.</div>' +
    '<div class="goal-actions"><button type="button" class="primary" data-remind="go">Отложить</button>' +
    '<button type="button" class="secondary" data-remind="later">Скрыть</button></div></div>';
}

function renderBudgets() {
  const spent = monthTotals(monthKey(today())).byCat;
  const cats = Object.keys(state.budgets);
  $('budgetList').innerHTML = cats.length ? cats.map((cat) => {
    const limit = state.budgets[cat];
    const s = spent[cat] || 0;
    const cls = s > limit ? ' over' : s > limit * 0.8 ? ' warn' : '';
    const left = limit - s;
    return '<button type="button" class="card budget' + cls + '" data-cat="' + esc(cat) + '">' +
      '<div class="cat-head"><span>' + icon(cat) + ' ' + esc(cat) + '</span><span>' + money(s) + ' из ' + money(limit) + '</span></div>' +
      '<div class="bar"><i style="width:' + Math.min(100, pct(s, limit)) + '%"></i></div>' +
      '<small>' + (left >= 0 ? 'Осталось ' + money(left) : 'Перерасход ' + money(-left)) + '</small></button>';
  }).join('') : '<p class="hint">Задайте месячный лимит на категорию, и приложение предупредит, когда он подходит к концу.</p>';
  $('bCat').innerHTML = state.cats.exp.map((c) => '<option>' + esc(c) + '</option>').join('');
}

function renderAll() {
  renderHeader();
  renderHome();
  renderStats();
  renderGoals();
  renderBudgets();
  renderReminder();
  $('currency').value = state.currency;
}

// ---------- Окна снизу ----------

function openPanel(id, focusId) {
  $('backdrop').classList.add('show');
  $(id).classList.add('show');
  if (focusId) setTimeout(() => $(focusId).focus(), 50);
}

function closePanels() {
  if (document.activeElement) document.activeElement.blur();
  $('backdrop').classList.remove('show');
  document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('show'));
}

// ---------- Операция ----------

function renderSheet() {
  const cats = state.cats[sheetType];
  if (cats.indexOf(sheetCat) < 0) sheetCat = cats[0];
  $('chips').innerHTML = cats.map((c) =>
    '<button type="button" data-cat="' + esc(c) + '"' + (c === sheetCat ? ' class="on"' : '') + '>' + icon(c) + ' ' + esc(c) + '</button>'
  ).join('') + (addingCat
    ? '<input id="newCat" class="chip-input" placeholder="Название" maxlength="20" enterkeyhint="done">'
    : '<button type="button" class="add" data-add="1">+ своя</button>');
  Array.prototype.forEach.call($('typeSeg').children, (b) => b.classList.toggle('on', b.dataset.type === sheetType));
  $('usefulSeg').style.display = sheetType === 'exp' ? '' : 'none';
  Array.prototype.forEach.call($('usefulSeg').children, (b) =>
    b.classList.toggle('on', sheetUseful !== null && (b.dataset.useful === '1') === sheetUseful));
  if (addingCat) $('newCat').focus();
}

function commitNewCat() {
  if (!addingCat) return;
  const name = $('newCat').value.trim();
  addingCat = false;
  if (name) {
    if (state.cats[sheetType].indexOf(name) < 0) {
      state.cats[sheetType].splice(state.cats[sheetType].length - 1, 0, name);  // перед «Другое»
      save();
      renderBudgets();
    }
    sheetCat = name;
  }
  renderSheet();
}

function openSheet(op) {
  editing = op ? op.id : null;
  sheetType = op ? op.type : 'exp';
  sheetCat = op ? op.cat : null;
  sheetUseful = op && typeof op.useful === 'boolean' ? op.useful : null;
  addingCat = false;
  $('amount').value = op ? amountText(op.amount) : '';
  $('note').value = op ? op.note : '';
  $('date').value = op ? op.date : today();
  $('delBtn').style.display = op ? '' : 'none';
  renderSheet();
  openPanel('sheet', op ? null : 'amount');
}

function submitSheet(e) {
  e.preventDefault();
  const amount = parseAmount($('amount').value);
  if (!amount) { toast('Введите сумму'); $('amount').focus(); return; }
  if (sheetType === 'exp' && sheetUseful === null) { toast('Отметьте: нужная это трата или лишняя'); return; }
  const data = { type: sheetType, amount: amount, cat: sheetCat, note: $('note').value.trim(), date: $('date').value || today() };
  if (sheetType === 'exp') data.useful = sheetUseful;
  if (editing) {
    const op = state.ops.find((o) => o.id === editing);
    delete op.useful;
    Object.assign(op, data);
  } else {
    data.id = newId();
    data.ts = Date.now();
    state.ops.push(data);
  }
  save();
  closePanels();
  renderAll();

  let msg = editing ? 'Изменено' : data.type === 'inc' ? 'Доход записан' : data.useful ? '👍 Нужная трата записана' : '👎 Лишняя трата записана';
  const limit = state.budgets[data.cat];
  if (data.type === 'exp' && limit && monthKey(data.date) === monthKey(today())) {
    const s = monthTotals(monthKey(today())).byCat[data.cat] || 0;
    if (s > limit) msg = '⚠️ Лимит на «' + data.cat + '» превышен: ' + money(s) + ' из ' + money(limit);
    else if (s > limit * 0.8) msg = '🟡 Потрачено ' + pct(s, limit) + '% лимита на «' + data.cat + '»';
  }
  toast(msg);
}

// ---------- Копилка ----------

function openGoalSheet(g) {
  editingGoal = g ? g.id : null;
  $('goalSheetTitle').textContent = g ? 'Изменить цель' : 'Новая цель';
  $('gName').value = g ? g.name : '';
  $('gTarget').value = g ? amountText(g.target) : '';
  $('gPlan').value = g ? amountText(g.plan) : '';
  $('gDeadline').value = g && g.deadline ? g.deadline : '';
  $('gInitial').value = g ? amountText(g.initial) : '';
  $('gDel').style.display = g ? '' : 'none';
  renderGoalHistory(g);
  renderGoalCalc();
  openPanel('goalSheet', g ? null : 'gName');
}

// Живой расчёт в окне цели: сколько откладывать, чтобы успеть к дате.
function renderGoalCalc() {
  const target = parseAmount($('gTarget').value);
  const plan = parseAmount($('gPlan').value);
  let deadline = $('gDeadline').value;
  if (!target) {
    $('gCalc').innerHTML = deadline ? '<span class="muted">📐 Укажите сумму, и я посчитаю, сколько откладывать</span>' : '';
    return;
  }
  const g = editingGoal ? state.goals.find((x) => x.id === editingGoal) : null;
  const have = (parseAmount($('gInitial').value) || 0) + (g ? depositsSum(g) : 0);
  const left = Math.max(0, target - have);
  if (!left) { $('gCalc').innerHTML = '🎉 Эта сумма уже накоплена'; return; }
  if (!deadline && plan) {
    const months = Math.ceil(left / plan);
    $('gCalc').innerHTML = '📐 По ' + esc(money(plan)) + ' в месяц накопится за ' + months + ' ' +
      plural(months, 'месяц', 'месяца', 'месяцев');
    return;
  }
  const auto = !deadline;
  if (auto) deadline = inMonths(AUTO_MONTHS);
  const n = deadlineNeed(left, deadline);
  if (!n) { $('gCalc').innerHTML = '<span class="exp">⚠️ Эта дата уже прошла</span>'; return; }
  $('gCalc').innerHTML = (auto ? '📐 Даты нет, поэтому я сам ставлю срок ' + AUTO_MONTHS + ' месяцев (до ' + longDate(deadline) + '). Откладывайте:'
    : '📐 Чтобы накопить ' + esc(money(left)) + ' к ' + longDate(deadline) + ', откладывайте:') +
    '<div class="need-big">' + esc(money(n.month)) + ' в месяц</div>' +
    '<div class="muted">≈ ' + esc(money(n.week)) + ' в неделю</div>';
}

function renderGoalHistory(g) {
  if (!g || !g.deposits.length) { $('gHistory').innerHTML = ''; return; }
  $('gHistory').innerHTML = '<div class="field-label">История пополнений (✕ — удалить ошибочную)</div><div class="history">' +
    g.deposits.slice().sort((a, b) => b.ts - a.ts).map((d) =>
      '<div class="hist-row"><span>' + dayTitle(d.date) + '</span>' +
      '<span class="' + (d.amount > 0 ? 'save' : 'exp') + '">' + (d.amount > 0 ? '+' : '−') + money(Math.abs(d.amount)) + '</span>' +
      '<button type="button" data-del-dep="' + d.id + '" aria-label="Удалить пополнение">✕</button></div>'
    ).join('') + '</div>';
}

function submitGoal(e) {
  e.preventDefault();
  const name = $('gName').value.trim();
  const target = parseAmount($('gTarget').value);
  if (!name) { toast('Напишите, на что копите'); return; }
  if (!target) { toast('Введите сумму цели'); return; }
  const data = {
    name: name, target: target,
    plan: parseAmount($('gPlan').value) || 0,
    deadline: $('gDeadline').value || '',
    initial: parseAmount($('gInitial').value) || 0,
  };
  const old = editingGoal ? state.goals.find((g) => g.id === editingGoal) : null;
  if (!data.deadline && !data.plan) {
    data.deadline = inMonths(AUTO_MONTHS);
    data.autoDeadline = true;
  } else {
    data.autoDeadline = !!(old && old.autoDeadline && old.deadline === data.deadline);
  }
  if (editingGoal) {
    Object.assign(state.goals.find((g) => g.id === editingGoal), data);
  } else {
    data.id = newId();
    data.deposits = [];
    state.goals.push(data);
  }
  save();
  closePanels();
  renderAll();
  toast(editingGoal ? 'Цель изменена' : '🐷 Цель создана');
}

function openMoneySheet(g, dir) {
  moneyGoal = g.id;
  moneyDir = dir;
  $('moneyTitle').textContent = (dir > 0 ? 'Положить в «' : 'Взять из «') + g.name + '»';
  $('mSubmit').textContent = dir > 0 ? 'Положить' : 'Взять';
  $('mAll').style.display = dir > 0 ? 'none' : '';
  $('mInfo').textContent = dir > 0 ? 'Свободно на балансе: ' + money(freeBalance()) : 'В копилке: ' + money(depositsSum(g));
  $('mAmount').value = '';
  openPanel('moneySheet', 'mAmount');
}

function submitMoney(e) {
  e.preventDefault();
  const g = state.goals.find((x) => x.id === moneyGoal);
  const amount = parseAmount($('mAmount').value);
  if (!amount) { toast('Введите сумму'); return; }
  if (moneyDir < 0 && amount > depositsSum(g)) { toast('Можно взять не больше ' + money(depositsSum(g))); return; }
  if (moneyDir > 0 && amount > freeBalance() &&
      !confirm('На балансе только ' + money(freeBalance()) + '. Всё равно положить ' + money(amount) + '?')) return;
  const wasDone = goalSaved(g) >= g.target;
  g.deposits.push({ id: newId(), amount: moneyDir * amount, date: today(), ts: Date.now() });
  save();
  closePanels();
  renderAll();
  if (!wasDone && goalSaved(g) >= g.target) toast('🎉 Цель «' + g.name + '» достигнута!');
  else toast(moneyDir > 0 ? '🐷 Отложено ' + money(amount) : 'Взято ' + money(amount));
}

function openDistSheet(sum) {
  $('dAmount').value = sum ? amountText(sum) : '';
  $('dFree').textContent = 'Свободно на балансе: ' + money(freeBalance());
  renderDistPreview();
  openPanel('distSheet', 'dAmount');
}

function renderDistPreview() {
  const sum = parseAmount($('dAmount').value);
  if (!sum) {
    $('dPreview').innerHTML = '<div class="cat-row muted">Введите сумму, и я разложу её по целям</div>';
    return;
  }
  const r = distribute(sum, monthPlan());
  $('dPreview').innerHTML = r.parts.map((p) =>
    '<div class="cat-row"><div class="cat-head"><span>🐷 ' + esc(p.g.name) + '</span><b>' + money(p.amount) + '</b></div></div>'
  ).join('') + (r.leftover ? '<div class="cat-row muted">Не поместится ' + money(r.leftover) + ': все цели будут накоплены</div>' : '');
}

function submitDist(e) {
  e.preventDefault();
  const sum = parseAmount($('dAmount').value);
  if (!sum) { toast('Введите сумму'); return; }
  const r = distribute(sum, monthPlan());
  if (!r.parts.length) { toast('Все цели уже накоплены 🎉'); return; }
  if (r.placed > freeBalance() &&
      !confirm('На балансе только ' + money(freeBalance()) + '. Всё равно отложить ' + money(r.placed) + '?')) return;
  r.parts.forEach((p) => p.g.deposits.push({ id: newId(), amount: p.amount, date: today(), ts: Date.now() }));
  save();
  closePanels();
  renderAll();
  const n = r.parts.length;
  toast('🐷 Отложено ' + money(r.placed) + ' в ' + n + ' ' + plural(n, 'цель', 'цели', 'целей'));
}

// ---------- Файлы ----------

async function giveFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportCsv() {
  const cell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const num = (n) => String(n).replace('.', ',');
  const rows = [['Дата', 'Тип', 'Сумма', 'Категория', 'Отметка', 'Комментарий']];
  feed().reverse().forEach((it) => {
    if (it.kind === 'op') {
      const op = it.op;
      const mark = op.useful === true ? 'нужная' : op.useful === false ? 'лишняя' : '';
      rows.push([op.date, op.type === 'inc' ? 'Доход' : 'Расход', num(op.amount), op.cat, mark, op.note]);
    } else {
      rows.push([it.date, it.dep.amount > 0 ? 'В копилку' : 'Из копилки', num(Math.abs(it.dep.amount)), 'Копилка', '', it.goal.name]);
    }
  });
  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  giveFile('finance_' + today() + '.csv', csv, 'text/csv');
}

function exportJson() {
  giveFile('finance_backup_' + today() + '.json', JSON.stringify(state, null, 1), 'application/json');
}

function importJson(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.ops)) throw new Error('bad');
      if (!confirm('Заменить текущие данные копией? Операций в копии: ' + data.ops.length)) return;
      state = Object.assign(defaults(), data);
      save();
      renderAll();
      toast('Данные восстановлены');
    } catch (err) {
      toast('Это не файл резервной копии');
    }
  };
  reader.readAsText(file);
}

// ---------- События ----------

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  $('fab').style.display = name === 'settings' || name === 'goals' ? 'none' : '';
  window.scrollTo(0, 0);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showView(b.dataset.view);
});

$('fab').addEventListener('click', () => openSheet(null));
$('backdrop').addEventListener('click', closePanels);
$('sheet').addEventListener('submit', submitSheet);
$('goalSheet').addEventListener('submit', submitGoal);
$('moneySheet').addEventListener('submit', submitMoney);
$('distSheet').addEventListener('submit', submitDist);
$('goalSheet').addEventListener('input', renderGoalCalc);
$('goalSheet').addEventListener('change', renderGoalCalc);
$('dAmount').addEventListener('input', renderDistPreview);

$('mAll').addEventListener('click', () => {
  const g = state.goals.find((x) => x.id === moneyGoal);
  $('mAmount').value = amountText(depositsSum(g));
});

$('reminder').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.remind === 'go') {
    openDistSheet(monthPlan().rest);
  } else {
    state.reminderSeen = monthKey(today());
    save();
    renderReminder();
  }
});

$('gHistory').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del-dep]');
  if (!b) return;
  const g = state.goals.find((x) => x.id === editingGoal);
  const d = g.deposits.find((x) => x.id === b.dataset.delDep);
  if (!confirm('Удалить пополнение ' + money(Math.abs(d.amount)) + '? Баланс пересчитается.')) return;
  g.deposits = g.deposits.filter((x) => x !== d);
  save();
  renderGoalHistory(g);
  renderAll();
});

$('typeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  sheetType = b.dataset.type;
  renderSheet();
});

$('usefulSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  sheetUseful = b.dataset.useful === '1';
  renderSheet();
});

$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.add) addingCat = true;
  else sheetCat = b.dataset.cat;
  renderSheet();
});

$('chips').addEventListener('keydown', (e) => {
  if (e.target.id === 'newCat' && e.key === 'Enter') {
    e.preventDefault();  // не отправлять форму
    commitNewCat();
  }
});
$('chips').addEventListener('focusout', (e) => {
  if (e.target.id === 'newCat') commitNewCat();
});

$('delBtn').addEventListener('click', () => {
  if (!confirm('Удалить операцию?')) return;
  state.ops = state.ops.filter((o) => o.id !== editing);
  save();
  closePanels();
  renderAll();
  toast('Удалено');
});

$('opsList').addEventListener('click', (e) => {
  const b = e.target.closest('.op');
  if (!b) return;
  if (b.dataset.goal) showView('goals');
  else openSheet(state.ops.find((o) => o.id === b.dataset.id));
});

$('newGoal').addEventListener('click', () => openGoalSheet(null));

$('goalsList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.dist) { openDistSheet(monthPlan().rest); return; }
  const id = b.dataset.edit || b.dataset.dep || b.dataset.wd;
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  if (b.dataset.edit) openGoalSheet(g);
  else if (b.dataset.dep) openMoneySheet(g, 1);
  else if (depositsSum(g) <= 0) toast('Из баланса сюда пока ничего не откладывали');
  else openMoneySheet(g, -1);
});

$('gDel').addEventListener('click', () => {
  const g = state.goals.find((x) => x.id === editingGoal);
  const saved = goalSaved(g);
  const extra = saved > 0 ? '\nОтложенные ' + money(saved) + ' вернутся в баланс.' : '';
  if (!confirm('Удалить цель «' + g.name + '»?' + extra)) return;
  state.goals = state.goals.filter((x) => x.id !== editingGoal);
  save();
  closePanels();
  renderAll();
  toast('Цель удалена');
});

$('prevM').addEventListener('click', () => { statsMonth = shiftMonth(statsMonth, -1); renderStats(); });
$('nextM').addEventListener('click', () => { statsMonth = shiftMonth(statsMonth, 1); renderStats(); });

$('budgetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseAmount($('bAmount').value);
  if (!amount) { toast('Введите сумму лимита'); return; }
  state.budgets[$('bCat').value] = amount;
  $('bAmount').value = '';
  $('bAmount').blur();
  save();
  renderAll();
  toast('Лимит сохранён');
});

$('budgetList').addEventListener('click', (e) => {
  const b = e.target.closest('.budget');
  if (!b) return;
  const cat = b.dataset.cat;
  if (confirm('Убрать лимит на «' + cat + '»?')) {
    delete state.budgets[cat];
    save();
    renderBudgets();
  }
});

$('currency').addEventListener('change', (e) => {
  state.currency = e.target.value;
  save();
  renderAll();
});

$('exportCsv').addEventListener('click', exportCsv);
$('exportJson').addEventListener('click', exportJson);
$('importJson').addEventListener('change', importJson);

$('clearAll').addEventListener('click', () => {
  if (!confirm('Удалить ВСЕ операции, цели и лимиты? Это нельзя отменить.')) return;
  if (!confirm('Точно? Сначала лучше сохранить резервную копию.')) return;
  state = defaults();
  save();
  renderAll();
  toast('Все данные удалены');
});

renderAll();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
