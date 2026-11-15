import { t, setLang, getLang } from './i18n.js';
import { createStore } from './store.js';
import { h, today, toDate, addDays, range, shift, daysIn, round2, csv } from './util.js';

const root = document.getElementById('app');
const S = { store: null, data: null, role: 'owner', changelog: [], members: null, view: 'dashboard', period: 'week', anchor: today(), workerId: null, siteId: null, brush: '', q: '' };

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usd = n => (n < 0 ? '-$' : '$') + nf.format(Math.abs(round2(n)));
const lbp = n => nf0.format(Math.round(n * S.data.biz.lbp_rate)) + ' LBP';
const lbpRaw = n => nf0.format(Math.round(n)) + ' LBP';
const daysTxt = n => nf.format(round2(n));
const round3 = n => Math.round(n * 1000) / 1000;
const SITE_COLORS = ['#e8890c', '#1f6fd1', '#1f8a57', '#b43ca6', '#c6382a', '#0f8b8d', '#7a5af5', '#8a6d1f'];

const isForeman = () => S.role === 'foreman';
const workerById = id => S.data.workers.find(w => w.id === id);
const siteById = id => S.data.sites.find(s => s.id === id);
const siteColor = id => { const i = S.data.sites.findIndex(s => s.id === id); return i < 0 ? 'var(--line)' : SITE_COLORS[i % SITE_COLORS.length]; };
const activeWorkers = () => S.data.workers.filter(w => w.active).sort((a, b) => a.name.localeCompare(b.name));
const activeSites = () => S.data.sites.filter(s => s.active);
const inRange = (d, r) => d >= r.start && d <= r.end;
const curRange = () => range(S.period, S.anchor, S.data.biz.week_start);
const worked = e => e.status === 'worked';
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const adjSigned = a => a.kind === 'deduction' ? -a.amount : a.amount;
const dayLabel = d => { const dt = toDate(d); return `${t('weekdays')[dt.getDay()]} ${dt.getDate()} ${t('months')[dt.getMonth()]}`; };

function stats(workerId, r) {
  const own = x => (!workerId || x.worker_id === workerId);
  const es = S.data.entries.filter(e => own(e) && (!r || inRange(e.day, r)));
  const ps = S.data.payments.filter(p => own(p) && (!r || inRange(p.paid_on, r)));
  const as = S.data.adjustments.filter(a => own(a) && (!r || inRange(a.day, r)));
  const earned = sum(es, e => e.amount) + sum(as, adjSigned);
  const paid = sum(ps, p => p.amount);
  const advances = sum(ps.filter(p => p.kind === 'advance'), p => p.amount);
  return { days: sum(es.filter(worked), e => e.days), earned, paid, advances, left: earned - paid, entries: es, payments: ps, adjustments: as };
}
const balance = id => stats(id).left;

function siteStats(siteId, r) {
  const es = S.data.entries.filter(e => e.site_id === siteId && (!r || inRange(e.day, r)));
  const tx = S.data.site_txns.filter(x => x.site_id === siteId && (!r || inRange(x.day, r)));
  const labor = sum(es, e => e.amount);
  const expenses = sum(tx.filter(x => x.kind === 'expense'), x => x.amount);
  const income = sum(tx.filter(x => x.kind === 'income'), x => x.amount);
  return { labor, expenses, income, profit: income - labor - expenses, entries: es, txns: tx };
}

function toast(msg, bad) {
  const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

function fail(err) {
  console.error(err);
  const msg = err?.message && err.message.length < 140 ? err.message : t('error');
  toast(msg, true);
}

function icon(name) {
  const paths = {
    dashboard: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z',
    planner: 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm-2 8h14v10H5zm2 2v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2z',
    workers: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z',
    sites: 'M12 3 2 9v2h20V9zm-8 10v6H2v2h20v-2h-2v-6h-2v6h-3v-6h-2v6H9v-6H7v6H6v-6z',
    payments: 'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm2 2v2h16V8zm0 6v4h16v-4zm2 1h5v2H6z',
    settings: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.9a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
    left: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z',
    right: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
    back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
    edit: 'M3 17.2V21h3.8L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z',
    phone: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.2.2 2.4.6 3.6a1 1 0 0 1-.3 1z',
    copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11z',
    check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
    chat: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm-4 7h8v2H8zm0 4h5v2H8z',
    money: 'M3 6h18v12H3zm2 2v8h14V8zm7 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
    helmet: 'M12 3a8 8 0 0 0-8 8v3H2v3h20v-3h-2v-3a8 8 0 0 0-6-7.7V7h-2V3.1A8 8 0 0 0 12 3zm-2 .3V7H8V4.4a8 8 0 0 1 2-1.1z'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', paths[name]);
  svg.append(p);
  return svg;
}

function periodLabel() {
  const r = curRange();
  const M = t('months');
  const s = toDate(r.start), e = toDate(r.end);
  if (S.period === 'day') return dayLabel(r.start);
  if (S.period === 'month') return `${M[s.getMonth()]} ${s.getFullYear()}`;
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${M[s.getMonth()]}`
    : `${s.getDate()} ${M[s.getMonth()]} – ${e.getDate()} ${M[e.getMonth()]}`;
}

function periodBar() {
  const seg = h('div', { class: 'seg', role: 'tablist' },
    ['day', 'week', 'month'].map(p => h('button', {
      class: S.period === p ? 'on' : '', role: 'tab', 'aria-selected': String(S.period === p),
      onclick: () => { S.period = p; S.scrollToday = true; render(); }
    }, t(p))));
  const r = curRange();
  const isNow = inRange(today(), r);
  return h('div', { class: 'periodbar' }, seg,
    h('div', { class: 'pnav' },
      h('button', { class: 'icon-btn flip', 'aria-label': 'previous', onclick: () => { S.anchor = shift(S.period, S.anchor, -1); render(); } }, icon('left')),
      h('span', { class: 'plabel' }, periodLabel()),
      h('button', { class: 'icon-btn flip', 'aria-label': 'next', onclick: () => { S.anchor = shift(S.period, S.anchor, 1); render(); } }, icon('right')),
      !isNow && h('button', { class: 'chip', onclick: () => { S.anchor = today(); S.scrollToday = true; render(); } }, t('today'))));
}

function kpi(label, value, sub, tone) {
  return h('div', { class: 'kpi ' + (tone || '') }, h('span', { class: 'kl' }, label), h('strong', { class: 'kv' }, value), sub && h('span', { class: 'ks' }, sub));
}

function empty(msg, action) {
  return h('div', { class: 'empty' }, icon('helmet'), h('p', null, msg), action);
}

function dot(color) {
  return h('i', { class: 'sdot', style: { background: color } });
}

function fab(label, fn) {
  return h('button', { class: 'fab', 'aria-label': label, title: label, onclick: fn }, icon('plus'));
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint && h('small', { class: 'muted' }, hint));
}

function segPick(options, value, onPick) {
  const seg = h('div', { class: 'seg wrap' });
  const draw = v => seg.replaceChildren(...options.map(([k, l]) => h('button', { type: 'button', class: v === k ? 'on' : '', onclick: () => { draw(k); onPick(k); } }, l)));
  draw(value);
  return seg;
}

function paydayCard() {
  if (toDate(today()).getDay() !== Number(S.data.biz.payday)) return null;
  const due = activeWorkers().map(w => ({ w, bal: balance(w.id) })).filter(x => x.bal > 0.009).sort((a, b) => b.bal - a.bal);
  if (!due.length) return null;
  const total = sum(due, x => x.bal);
  return h('div', { class: 'card payday' },
    h('div', { class: 'card-h' }, h('h3', null, t('paydayToday')), h('b', null, usd(total))),
    h('p', { class: 'muted' }, t('paydayOwe', { amount: usd(total), n: due.length })),
    h('ul', { class: 'plist' }, due.map(({ w, bal }) => h('li', null,
      h('span', { class: 'pl-main', onclick: () => openWorker(w.id) }, h('b', null, w.name), h('small', { class: 'muted' }, lbp(bal))),
      h('b', { class: 'hot-t' }, usd(bal)),
      h('button', { class: 'btn sm', onclick: () => editPayment({ worker_id: w.id, amount: round2(bal) }) }, t('pay'))))));
}

function viewDashboard() {
  const r = curRange();
  const st = stats(null, r);
  const owed = sum(S.data.workers, w => Math.max(0, balance(w.id)));
  const td = S.data.entries.filter(e => e.day === today());
  const onSite = td.filter(e => e.status !== 'absent').length;
  const workedToday = td.filter(worked).length;

  const kpis = h('div', { class: 'kpis' },
    kpi(t('earned'), usd(st.earned), lbp(st.earned)),
    kpi(t('paid'), usd(st.paid), st.advances ? `${t('advances')}: ${usd(st.advances)}` : lbp(st.paid), 'good'),
    kpi(st.left >= 0 ? t('left') : t('advance'), usd(Math.abs(st.left)), lbp(Math.abs(st.left)), st.left > 0 ? 'warn' : 'good'),
    kpi(t('owed'), usd(owed), t('owedHint'), owed > 0 ? 'hot' : ''));

  const strip = h('div', { class: 'card today' },
    h('div', null, h('span', { class: 'kl' }, t('onSite')), h('strong', { class: 'big' }, `${onSite}`, h('small', null, ` / ${activeWorkers().length}`))),
    h('div', { class: 'dots' }, activeWorkers().map(w => {
      const e = td.find(x => x.worker_id === w.id);
      const el = h('span', { class: 'dot ' + (!e ? 'none' : e.status), title: [w.name, siteById(e?.site_id)?.name].filter(Boolean).join(' · ') }, w.name.slice(0, 1));
      if (e?.site_id && e.status !== 'absent') el.style.boxShadow = `0 0 0 3px ${siteColor(e.site_id)}`;
      return el;
    })),
    h('button', { class: 'btn ghost sm', onclick: () => { S.view = 'planner'; S.period = 'day'; S.anchor = today(); render(); } }, `${workedToday} ${t('worked')} →`));

  let bars;
  if (S.period === 'day') {
    bars = st.entries.filter(worked).map(e => ({ label: workerById(e.worker_id)?.name || '?', v: e.amount }));
  } else {
    bars = daysIn(r.start, r.end).map(d => {
      const dt = toDate(d);
      return { label: S.period === 'week' ? t('weekdays')[dt.getDay()] : String(dt.getDate()), v: sum(st.entries.filter(e => e.day === d), e => e.amount), today: d === today() };
    });
  }
  const max = Math.max(1, ...bars.map(b => b.v));
  const chart = h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', null, t('laborCost')), h('span', { class: 'muted' }, usd(sum(st.entries, e => e.amount)))),
    bars.length ? h('div', { class: 'chart ' + S.period },
      bars.map(b => h('div', { class: 'bar' + (b.today ? ' now' : ''), title: `${b.label}: ${usd(b.v)}` },
        h('span', { class: 'bv' }, b.v ? nf0.format(b.v) : ''),
        h('span', { class: 'track' }, h('span', { class: 'bf', style: { height: `${(b.v / max) * 100}%` } })),
        h('span', { class: 'bl' }, b.label)))) : empty(t('noData')));

  const rows = activeWorkers().map(w => ({ w, s: stats(w.id, r), bal: balance(w.id) }))
    .filter(x => x.s.entries.length || x.s.payments.length || x.s.adjustments.length || Math.abs(x.bal) > 0.009);
  const table = h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', null, t('byWorker'))),
    rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, t('worker')), h('th', { class: 'n' }, t('days')), h('th', { class: 'n' }, t('earned')),
        h('th', { class: 'n' }, t('paid')), h('th', { class: 'n' }, t('left')), h('th', { class: 'n' }, t('balance')))),
      h('tbody', null, rows.map(({ w, s, bal }) => h('tr', { class: 'link', tabindex: '0', onclick: () => openWorker(w.id), onkeydown: ev => ev.key === 'Enter' && openWorker(w.id) },
        h('td', null, h('b', null, w.name), h('small', { class: 'muted block' }, w.trade || '')),
        h('td', { class: 'n' }, daysTxt(s.days)),
        h('td', { class: 'n' }, usd(s.earned)),
        h('td', { class: 'n good-t' }, usd(s.paid)),
        h('td', { class: 'n ' + (s.left > 0 ? 'warn-t' : '') }, usd(s.left)),
        h('td', { class: 'n ' + (bal > 0 ? 'hot-t' : bal < 0 ? 'good-t' : '') }, usd(bal))))),
      h('tfoot', null, h('tr', null, h('td', null, t('total')), h('td', { class: 'n' }, daysTxt(st.days)), h('td', { class: 'n' }, usd(st.earned)),
        h('td', { class: 'n' }, usd(st.paid)), h('td', { class: 'n' }, usd(st.left)), h('td', { class: 'n' }, usd(owed))))))
      : empty(S.data.workers.length ? t('noData') : t('noWorkers'), !S.data.workers.length && h('button', { class: 'btn', onclick: () => editWorker() }, t('addWorker'))));

  const bySite = new Map();
  st.entries.filter(worked).forEach(e => bySite.set(e.site_id || '', (bySite.get(e.site_id || '') || 0) + e.amount));
  const siteRows = [...bySite.entries()].sort((a, b) => b[1] - a[1]);
  const smax = Math.max(1, ...siteRows.map(x => x[1]));
  const sites = h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', null, t('bySite'))),
    siteRows.length ? h('ul', { class: 'hbars' }, siteRows.map(([id, v]) => h('li', { class: id ? 'link' : '', onclick: () => id && openSite(id) },
      h('div', { class: 'hb-t' }, h('span', null, id && dot(siteColor(id)), siteById(id)?.name || t('noSite')), h('b', null, usd(v))),
      h('div', { class: 'hb' }, h('span', { style: { width: `${(v / smax) * 100}%`, background: id ? siteColor(id) : 'var(--muted)' } }))))) : empty(t('noData')));

  return h('div', { class: 'view' }, paydayCard(), periodBar(), kpis, strip, h('div', { class: 'grid2' }, chart, sites), table,
    fab(t('addPayment'), () => editPayment()));
}

function cellCode(e) {
  if (!e) return { txt: '', cls: '' };
  if (e.status === 'planned') return { txt: '•', cls: 'planned' };
  if (e.status === 'absent') return { txt: '✕', cls: 'absent' };
  if (e.hours != null) return { txt: nf.format(e.hours) + t('hoursShort'), cls: 'worked part' };
  if (Number(e.days) === 1) return { txt: '1', cls: 'worked' };
  if (Number(e.days) === 0.5) return { txt: '½', cls: 'worked part' };
  return { txt: nf.format(e.days), cls: 'worked part' };
}

function entryLabel(e) {
  if (e.status !== 'worked') return t(e.status);
  if (e.hours != null) return `${nf.format(e.hours)} ${t('hours').toLowerCase()}`;
  if (Number(e.days) === 1) return t('full');
  if (Number(e.days) === 0.5) return t('half');
  return `${nf.format(e.days)} ${t('days').toLowerCase()}`;
}

function lastSite(workerId, before) {
  const e = S.data.entries.filter(x => x.worker_id === workerId && x.site_id && x.day <= before).sort((a, b) => b.day.localeCompare(a.day))[0];
  return e?.site_id || activeSites()[0]?.id || null;
}

async function quickSet(w, day, kind, extra = {}) {
  const ex = S.data.entries.find(e => e.worker_id === w.id && e.day === day);
  if (kind === 'clear') { if (ex) await removeRow('entries', ex.id); return; }
  const hpd = Number(S.data.biz.hours_per_day);
  const map = {
    full: { status: 'worked', days: 1, hours: null },
    half: { status: 'worked', days: 0.5, hours: null },
    hours: { status: 'worked', days: round3(extra.hours / hpd), hours: extra.hours },
    planned: { status: 'planned', days: 0, hours: null },
    absent: { status: 'absent', days: 0, hours: null }
  };
  const row = { id: ex?.id, worker_id: w.id, day, site_id: extra.site_id !== undefined ? extra.site_id : ex?.site_id ?? lastSite(w.id, day), note: ex?.note ?? null, ...map[kind] };
  if (!isForeman()) row.rate = ex?.rate ?? w.daily_rate;
  await saveRow('entries', row, true);
}

function viewPlanner() {
  const ws = activeWorkers();
  if (!ws.length) return h('div', { class: 'view' }, periodBar(), empty(t('noWorkers'), !isForeman() && h('button', { class: 'btn', onclick: () => editWorker() }, t('addWorker'))));
  return h('div', { class: 'view' }, periodBar(), siteLegend(), S.period === 'day' ? plannerDay(ws) : plannerGrid(ws));
}

function siteLegend() {
  const sites = activeSites();
  if (!sites.length) return null;
  return h('div', { class: 'brushbar' },
    h('span', { class: 'muted' }, t('assignSite')),
    h('div', { class: 'brushes' },
      h('button', { class: 'brush' + (!S.brush ? ' on' : ''), onclick: () => { S.brush = ''; render(); } }, t('none')),
      sites.map(s => {
        const b = h('button', { class: 'brush' + (S.brush === s.id ? ' on' : ''), onclick: () => { S.brush = S.brush === s.id ? '' : s.id; render(); } }, dot(siteColor(s.id)), s.name);
        if (S.brush === s.id) b.style.borderColor = siteColor(s.id);
        return b;
      })),
    S.brush && h('small', { class: 'muted block' }, t('assignHint')));
}

async function paint(w, day) {
  const e = S.data.entries.find(x => x.worker_id === w.id && x.day === day);
  try {
    if (!e) await quickSet(w, day, 'planned', { site_id: S.brush });
    else if (e.site_id !== S.brush) await saveRow('entries', { ...e, site_id: S.brush }, true);
    else return editEntry(w, day);
    render();
  } catch (err) { fail(err); }
}

function plannerDay(ws) {
  const day = S.anchor;
  const des = S.data.entries.filter(e => e.day === day);
  const planned = des.filter(e => e.status === 'planned');
  const fm = isForeman();
  return h('div', null,
    h('div', { class: 'toolbar' },
      !fm ? h('span', { class: 'muted' }, `${t('laborCost')}: `, h('b', null, usd(sum(des, e => e.amount)))) : h('span'),
      planned.length > 0 && h('button', { class: 'btn sm', onclick: () => bulkMark(planned) }, icon('check'), ` ${t('markWorked')} (${planned.length})`)),
    h('div', { class: 'daylist' }, ws.map(w => {
      const e = des.find(x => x.worker_id === w.id);
      const cur = !e ? 'none' : e.status === 'worked' ? (e.hours != null ? 'hours' : Number(e.days) === 1 ? 'full' : Number(e.days) === 0.5 ? 'half' : 'hours') : e.status;
      const opts = [['full', t('full')], ['half', t('half')], ['hours', t('hours')], ['absent', t('absent')]];
      const siteSel = siteSelect(e?.site_id ?? lastSite(w.id, day));
      siteSel.addEventListener('change', async () => {
        try {
          if (e) await saveRow('entries', { ...e, site_id: siteSel.value || null }, true);
          else await quickSet(w, day, 'planned', { site_id: siteSel.value || null });
          render();
        } catch (err) { fail(err); }
      });
      const card = h('div', { class: 'daycard ' + cur },
        h('div', { class: 'dc-top' },
          h('div', { class: 'who', onclick: () => !fm && openWorker(w.id) }, h('span', { class: 'av' }, w.name.slice(0, 1)),
            h('div', null, h('b', null, w.name), h('small', { class: 'muted block' }, fm ? (w.trade || '') : `${w.trade || ''} · ${usd(w.daily_rate)}${t('perDay')}`))),
          h('b', { class: 'dc-amt' }, !fm && e && e.amount ? usd(e.amount) : cur === 'planned' ? t('planned') : '')),
        h('div', { class: 'dc-row' },
          h('div', { class: 'seg small wrap' }, opts.map(([k, label]) => h('button', {
            class: cur === k ? 'on ' + k : '', onclick: async () => {
              try {
                if (k === 'hours') return askHours(w, day, e);
                await quickSet(w, day, cur === k ? 'planned' : k);
                render();
              } catch (err) { fail(err); }
            }
          }, k === 'hours' && cur === 'hours' && e ? `${nf.format(e.hours ?? e.days * S.data.biz.hours_per_day)}${t('hoursShort')}` : label))),
          h('div', { class: 'dc-tools' }, siteSel,
            h('button', { class: 'icon-btn', 'aria-label': t('edit'), onclick: () => editEntry(w, day) }, icon('edit')))));
      if (e?.site_id) card.style.borderInlineStartColor = siteColor(e.site_id);
      return card;
    })));
}

function siteSelect(value) {
  const s = h('select', { class: 'site-sel', 'aria-label': t('site') },
    h('option', { value: '' }, `— ${t('noSite')}`),
    S.data.sites.filter(x => x.active || x.id === value).map(x => h('option', { value: x.id }, x.name)));
  s.value = value || '';
  return s;
}

function askHours(w, day, e) {
  const input = h('input', { type: 'number', name: 'hours', inputmode: 'decimal', min: '0.25', max: '24', step: 'any', required: true, value: e?.hours ?? '' });
  const form = h('form', { class: 'form' }, field(t('hours'), input), h('p', { class: 'muted' }, `${t('hoursPerDay')}: ${S.data.biz.hours_per_day}`));
  sheet(`${w.name} · ${t('hours')}`, form, async () => {
    const hrs = Number(input.value);
    if (!(hrs > 0 && hrs <= 24)) throw new Error(t('hours'));
    await quickSet(w, day, 'hours', { hours: hrs });
  });
  setTimeout(() => input.focus(), 50);
}

async function bulkMark(list) {
  try {
    const rows = list.map(e => ({ ...e, status: 'worked', days: 1, hours: null }));
    if (isForeman()) rows.forEach(r => delete r.rate);
    const saved = await S.store.saveMany('entries', rows);
    merge('entries', saved);
    toast(t('marked', { n: saved.length }));
    render();
  } catch (err) { fail(err); }
}

function plannerGrid(ws) {
  const r = curRange();
  const days = daysIn(r.start, r.end);
  const fm = isForeman();
  const byKey = new Map(S.data.entries.filter(e => inRange(e.day, r)).map(e => [e.worker_id + e.day, e]));
  const head = h('tr', null, h('th', { class: 'sticky' }, t('worker')),
    days.map(d => {
      const dt = toDate(d);
      return h('th', { class: 'dh' + (d === today() ? ' now' : '') + (dt.getDay() === 0 ? ' sun' : '') },
        h('button', { class: 'dh-btn', onclick: () => { S.period = 'day'; S.anchor = d; render(); } },
          h('small', null, t('weekdays')[dt.getDay()]), h('span', null, dt.getDate())));
    }),
    h('th', { class: 'n' }, t('days')), !fm && h('th', { class: 'n' }, t('earned')));
  const body = ws.map(w => {
    let dsum = 0, asum = 0;
    const cells = days.map(d => {
      const e = byKey.get(w.id + d);
      if (e && worked(e)) { dsum += Number(e.days); asum += Number(e.amount || 0); }
      const c = cellCode(e);
      const site = e?.site_id ? siteById(e.site_id) : null;
      const btn = h('button', { class: 'cb ' + c.cls + (site ? ' has-site' : ''), title: site?.name || '', 'aria-label': `${w.name} ${d}`, onclick: () => S.brush ? paint(w, d) : editEntry(w, d) },
        c.txt, site && h('i', { class: 'sd' }, site.name.slice(0, 3)));
      if (site) btn.style.setProperty('--site', siteColor(site.id));
      return h('td', { class: 'cell ' + (d === today() ? 'now' : '') }, btn);
    });
    return h('tr', null, h('th', { class: 'sticky wname', onclick: () => !fm && openWorker(w.id) }, w.name),
      cells, h('td', { class: 'n' }, daysTxt(dsum)), !fm && h('td', { class: 'n' }, usd(asum)));
  });
  const all = [...byKey.values()];
  const totals = h('tr', { class: 'tot' }, h('th', { class: 'sticky' }, t('total')),
    days.map(d => {
      const v = fm ? all.filter(e => e.day === d && worked(e)).length : sum(all.filter(e => e.day === d), e => e.amount);
      return h('td', { class: 'n tiny' }, v ? nf0.format(v) : '');
    }),
    h('td', { class: 'n' }, daysTxt(sum(all.filter(worked), e => e.days))),
    !fm && h('td', { class: 'n' }, usd(sum(all, e => e.amount))));

  const planned = all.filter(e => e.status === 'planned' && e.day <= today());
  return h('div', null,
    h('div', { class: 'toolbar' },
      h('div', { class: 'legend' },
        h('span', null, h('i', { class: 'lg worked' }), t('full')), h('span', null, h('i', { class: 'lg part' }), `${t('half')} / ${t('hours')}`),
        h('span', null, h('i', { class: 'lg planned' }), t('planned')), h('span', null, h('i', { class: 'lg absent' }), t('absent'))),
      h('div', { class: 'tb-actions' },
        S.period === 'week' && h('button', { class: 'btn ghost sm', onclick: () => copyLastWeek(r) }, icon('copy'), ' ', t('copyLastWeek')),
        planned.length > 0 && h('button', { class: 'btn sm', onclick: () => bulkMark(planned) }, icon('check'), ` ${t('markWorked')} (${planned.length})`))),
    h('div', { class: 'grid-wrap ' + S.period }, h('table', { class: 'plan' }, h('thead', null, head), h('tbody', null, body, totals))));
}

async function copyLastWeek(r) {
  try {
    const prev = { start: addDays(r.start, -7), end: addDays(r.end, -7) };
    const exist = new Set(S.data.entries.filter(e => inRange(e.day, r)).map(e => e.worker_id + e.day));
    const rows = S.data.entries.filter(e => inRange(e.day, prev) && e.status !== 'absent')
      .map(e => ({ worker_id: e.worker_id, site_id: e.site_id, day: addDays(e.day, 7), status: 'planned', days: 0, hours: null, note: null }))
      .filter(e => workerById(e.worker_id)?.active && !exist.has(e.worker_id + e.day));
    const saved = await S.store.saveMany('entries', rows);
    merge('entries', saved);
    toast(t('copied', { n: saved.length }));
    render();
  } catch (err) { fail(err); }
}

function editEntry(w, day) {
  const e = S.data.entries.find(x => x.worker_id === w.id && x.day === day);
  const fm = isForeman();
  const hpd = Number(S.data.biz.hours_per_day);
  let mode = !e ? 'full' : e.status !== 'worked' ? e.status : e.hours != null ? 'hours' : Number(e.days) === 1 ? 'full' : Number(e.days) === 0.5 ? 'half' : 'custom';
  const hoursIn = h('input', { type: 'number', name: 'hours', inputmode: 'decimal', min: '0.25', max: '24', step: 'any', value: e?.hours ?? '' });
  const fracIn = h('input', { type: 'number', name: 'days', inputmode: 'decimal', min: '0.05', max: '2', step: 'any', value: mode === 'custom' ? e.days : '' });
  const rateIn = h('input', { type: 'number', name: 'rate', inputmode: 'decimal', min: '0', step: 'any', required: !fm, value: e?.rate ?? w.daily_rate ?? '' });
  const noteIn = h('input', { type: 'text', name: 'note', maxlength: '500', value: e?.note ?? '' });
  const site = siteSelect(e?.site_id ?? lastSite(w.id, day));
  const preview = h('p', { class: 'preview' });
  const hoursF = field(t('hours'), hoursIn), fracF = field(t('fraction'), fracIn);
  const modes = [['full', t('full')], ['half', t('half')], ['hours', t('hours')], ['custom', t('custom')], ['planned', t('planned')], ['absent', t('absent')]];
  const seg = h('div', { class: 'seg wrap' });
  const calc = () => round3(mode === 'full' ? 1 : mode === 'half' ? 0.5 : mode === 'hours' ? (Number(hoursIn.value) || 0) / hpd : mode === 'custom' ? Number(fracIn.value) || 0 : 0);
  const refresh = () => {
    seg.replaceChildren(...modes.map(([k, l]) => h('button', { type: 'button', class: mode === k ? 'on ' + k : '', onclick: () => { mode = k; refresh(); } }, l)));
    hoursF.hidden = mode !== 'hours';
    fracF.hidden = mode !== 'custom';
    const d = calc();
    preview.textContent = fm || ['planned', 'absent'].includes(mode) ? '' : `${daysTxt(d)} × ${usd(Number(rateIn.value) || 0)} = ${usd(d * (Number(rateIn.value) || 0))}`;
  };
  [hoursIn, fracIn, rateIn].forEach(i => i.addEventListener('input', refresh));
  refresh();
  const form = h('form', { class: 'form' }, seg, hoursF, fracF, field(t('site'), site), !fm && field(t('rate'), rateIn), field(t('note'), noteIn), preview);
  sheet(`${w.name} · ${dayLabel(day)}`, form, async () => {
    const d = calc();
    const work = !['planned', 'absent'].includes(mode);
    if (work && !(d > 0 && d <= 2)) throw new Error(t('fraction'));
    const row = {
      id: e?.id, worker_id: w.id, day, site_id: site.value || null,
      status: work ? 'worked' : mode, days: work ? d : 0, hours: mode === 'hours' ? Number(hoursIn.value) : null, note: noteIn.value.trim() || null
    };
    if (!fm) row.rate = Number(rateIn.value);
    await saveRow('entries', row);
  }, e && (() => removeRow('entries', e.id)));
}

function viewWorkers() {
  const fm = isForeman();
  const q = S.q.trim().toLowerCase();
  const list = [...S.data.workers].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name))
    .filter(w => !q || w.name.toLowerCase().includes(q) || (w.trade || '').toLowerCase().includes(q));
  const search = h('input', { type: 'search', class: 'search', placeholder: t('search'), value: S.q, 'aria-label': t('search') });
  search.addEventListener('input', () => { S.q = search.value; const pos = search.selectionStart; render(); const n = root.querySelector('.search'); n.focus(); n.setSelectionRange(pos, pos); });
  return h('div', { class: 'view' },
    S.data.workers.length > 5 && search,
    list.length ? h('div', { class: 'wlist' }, list.map(w => {
      if (fm) {
        const tel = (w.phone || '').replace(/[^\d+]/g, '');
        return h(tel ? 'a' : 'div', { class: 'wcard' + (w.active ? '' : ' off'), href: tel ? 'tel:' + tel : null },
          h('span', { class: 'av' }, w.name.slice(0, 1)), h('span', { class: 'wc-main' }, h('b', null, w.name), h('small', { class: 'muted' }, w.trade || '')), tel && icon('phone'));
      }
      const bal = balance(w.id);
      return h('button', { class: 'wcard' + (w.active ? '' : ' off'), onclick: () => openWorker(w.id) },
        h('span', { class: 'av' }, w.name.slice(0, 1)),
        h('span', { class: 'wc-main' }, h('b', null, w.name), h('small', { class: 'muted' }, [w.trade, `${usd(w.daily_rate)}${t('perDay')}`, !w.active && t('inactive')].filter(Boolean).join(' · '))),
        h('span', { class: 'wc-bal ' + (bal > 0.009 ? 'hot-t' : bal < -0.009 ? 'good-t' : 'muted') }, h('small', null, bal < -0.009 ? t('credit') : t('balance')), usd(Math.abs(bal))));
    })) : empty(t('noWorkers')),
    !fm && fab(t('addWorker'), () => editWorker()));
}

function openWorker(id) { S.view = 'worker'; S.workerId = id; render(); window.scrollTo(0, 0); }

function waPhone(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('961')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return d.length >= 7 && d.length <= 8 ? '961' + d : d;
}

function sendStatement(w) {
  const r = curRange();
  const st = stats(w.id, r);
  const bal = balance(w.id);
  const lines = [
    t('stmtHi', { name: w.name }),
    t('stmtFor', { period: periodLabel() }),
    `${t('stmtDays')}: ${daysTxt(st.days)}`,
    `${t('stmtEarned')}: ${usd(st.earned)}`,
    `${t('stmtPaid')}: ${usd(st.paid)}`,
    `${t('stmtLeft')}: ${usd(st.left)}`,
    '',
    `${t('stmtTotal')}: ${usd(bal)} (${lbp(bal)})`,
    S.data.biz.name ? `— ${S.data.biz.name}` : ''
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim();
  const phone = waPhone(w.phone);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines)}`, '_blank', 'noopener');
}

function viewWorker() {
  const w = workerById(S.workerId);
  if (!w) { S.view = 'workers'; return viewWorkers(); }
  const r = curRange();
  const st = stats(w.id, r);
  const bal = balance(w.id);
  const all = stats(w.id);
  const hist = [
    ...all.entries.filter(e => e.status !== 'planned').map(e => ({ d: e.day, kind: 'e', e })),
    ...all.payments.map(p => ({ d: p.paid_on, kind: 'p', p })),
    ...all.adjustments.map(a => ({ d: a.day, kind: 'a', a }))
  ].sort((a, b) => b.d.localeCompare(a.d) || (a.kind === 'p' ? -1 : 1)).slice(0, 100);
  const tel = (w.phone || '').replace(/[^\d+]/g, '');
  return h('div', { class: 'view' },
    h('div', { class: 'whead' },
      h('button', { class: 'icon-btn flip', 'aria-label': 'back', onclick: () => { S.view = 'workers'; render(); } }, icon('back')),
      h('span', { class: 'av lg' }, w.name.slice(0, 1)),
      h('div', { class: 'wh-main' }, h('h2', null, w.name), h('small', { class: 'muted' }, [w.trade, `${usd(w.daily_rate)}${t('perDay')}`].filter(Boolean).join(' · '))),
      tel && h('a', { class: 'icon-btn', href: 'tel:' + tel, 'aria-label': t('phone') }, icon('phone')),
      h('button', { class: 'icon-btn', 'aria-label': t('editWorker'), onclick: () => editWorker(w) }, icon('edit'))),
    h('div', { class: 'card balcard ' + (bal > 0.009 ? 'hot' : 'good') },
      h('div', null, h('span', { class: 'kl' }, bal < -0.009 ? t('advance') : t('balance')), h('strong', { class: 'big' }, usd(Math.abs(bal))), h('small', { class: 'muted block' }, lbp(Math.abs(bal)))),
      bal > 0.009 && h('button', { class: 'btn', onclick: () => editPayment({ worker_id: w.id, amount: round2(bal) }) }, t('payBalance'))),
    h('div', { class: 'actionrow' },
      h('button', { class: 'btn ghost sm wa', onclick: () => sendStatement(w) }, icon('chat'), ' ', t('whatsapp')),
      h('button', { class: 'btn ghost sm', onclick: () => editPayment({ worker_id: w.id, kind: 'advance' }) }, icon('money'), ' ', t('giveAdvance')),
      h('button', { class: 'btn ghost sm', onclick: () => editAdjustment({ worker_id: w.id }) }, icon('plus'), ' ', t('adjust'))),
    periodBar(),
    h('div', { class: 'kpis' },
      kpi(t('days'), daysTxt(st.days)), kpi(t('earned'), usd(st.earned)),
      kpi(t('paid'), usd(st.paid), st.advances ? `${t('advances')}: ${usd(st.advances)}` : null, 'good'),
      kpi(st.left >= 0 ? t('left') : t('advance'), usd(Math.abs(st.left)), null, st.left > 0 ? 'warn' : 'good')),
    h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, t('history'))),
      hist.length ? h('ul', { class: 'hist' }, hist.map(x => {
        const dl = dayLabel(x.d);
        if (x.kind === 'p') return h('li', { class: 'pay', onclick: () => editPayment(x.p) },
          h('span', null, dl), h('span', { class: 'muted' }, [x.p.kind === 'advance' ? t('advanceKind') : t('pay'), t(x.p.method), x.p.currency === 'LBP' && lbpRaw(x.p.lbp_amount)].filter(Boolean).join(' · ')), h('b', { class: 'good-t' }, '−' + usd(x.p.amount)));
        if (x.kind === 'a') return h('li', { class: 'adj', onclick: () => editAdjustment(x.a) },
          h('span', null, dl), h('span', { class: 'muted' }, [t(x.a.kind), x.a.hours && `${nf.format(x.a.hours)}${t('hoursShort')}`, x.a.note].filter(Boolean).join(' · ')), h('b', { class: x.a.kind === 'deduction' ? 'hot-t' : '' }, (x.a.kind === 'deduction' ? '−' : '+') + usd(x.a.amount)));
        const li = h('li', { onclick: () => editEntry(w, x.e.day) },
          h('span', null, dl), h('span', { class: 'muted' }, siteById(x.e.site_id) && dot(siteColor(x.e.site_id)), [entryLabel(x.e), siteById(x.e.site_id)?.name].filter(Boolean).join(' · ')),
          h('b', null, x.e.amount ? '+' + usd(x.e.amount) : ''));
        return li;
      })) : empty(t('noData'))),
    fab(t('addPayment'), () => editPayment({ worker_id: w.id })));
}

function editWorker(w = {}) {
  const f = {
    name: h('input', { name: 'name', required: true, maxlength: '120', autocomplete: 'off', value: w.name || '' }),
    trade: h('input', { name: 'trade', maxlength: '60', placeholder: t('tradeHint'), value: w.trade || '' }),
    daily_rate: h('input', { name: 'daily_rate', type: 'number', inputmode: 'decimal', min: '0', step: 'any', required: true, value: w.daily_rate ?? '' }),
    phone: h('input', { name: 'phone', type: 'tel', maxlength: '40', autocomplete: 'off', value: w.phone || '' }),
    notes: h('textarea', { name: 'notes', maxlength: '1000', rows: '2' }, w.notes || ''),
    active: h('input', { name: 'active', type: 'checkbox', checked: w.active !== false })
  };
  const form = h('form', { class: 'form' },
    field(t('name'), f.name), field(t('trade'), f.trade), field(`${t('rate')} (USD)`, f.daily_rate), field(t('phone'), f.phone), field(t('notes'), f.notes),
    h('label', { class: 'check' }, f.active, h('span', null, t('active'))));
  sheet(w.id ? t('editWorker') : t('addWorker'), form, async () => {
    const saved = await saveRow('workers', {
      id: w.id, name: f.name.value.trim(), trade: f.trade.value.trim() || null, daily_rate: Number(f.daily_rate.value),
      phone: f.phone.value.trim() || null, notes: f.notes.value.trim() || null, active: f.active.checked
    });
    if (!w.id) openWorker(saved.id);
  }, w.id && (async () => { await removeRow('workers', w.id); S.view = 'workers'; }));
  setTimeout(() => f.name.focus(), 50);
}

function moneyInputs(initial) {
  let cur = initial.currency || 'USD';
  const amt = h('input', { name: 'amount', type: 'number', inputmode: 'decimal', min: '0', step: 'any', required: true, value: cur === 'LBP' ? initial.lbp_amount ?? '' : initial.amount ?? '' });
  const rate = h('input', { name: 'lbp_rate', type: 'number', inputmode: 'numeric', min: '1', step: '1', value: initial.lbp_rate ?? S.data.biz.lbp_rate });
  const rateF = field(t('lbpRate'), rate);
  const amtF = field(t('amount'), amt);
  const hint = h('p', { class: 'preview' });
  const seg = h('div', { class: 'seg' });
  let extra = () => '';
  const refresh = () => {
    seg.replaceChildren(...['USD', 'LBP'].map(c => h('button', { type: 'button', class: cur === c ? 'on' : '', onclick: () => {
      if (cur !== c && amt.value) amt.value = c === 'LBP' ? Math.round(Number(amt.value) * Number(rate.value)) : round2(Number(amt.value) / Number(rate.value));
      cur = c; refresh();
    } }, c)));
    rateF.hidden = cur !== 'LBP';
    amtF.firstChild.textContent = `${t('amount')} (${cur})`;
    const v = Number(amt.value) || 0;
    hint.textContent = (cur === 'LBP' ? `= ${usd(v / (Number(rate.value) || 1))}` : v ? `= ${lbp(v)}` : '') + extra();
  };
  [amt, rate].forEach(i => i.addEventListener('input', refresh));
  return {
    nodes: [seg, amtF, rateF, hint], refresh, setExtra: fn => { extra = fn; },
    value() {
      const v = Number(amt.value), r = Number(rate.value);
      if (!(v > 0)) throw new Error(t('amount'));
      if (cur === 'LBP' && !(r > 0)) throw new Error(t('lbpRate'));
      return { currency: cur, amount: cur === 'USD' ? round2(v) : round2(v / r), lbp_amount: cur === 'LBP' ? Math.round(v) : null, lbp_rate: cur === 'LBP' ? Math.round(r) : null };
    }
  };
}

function editPayment(p = {}) {
  const ws = S.data.workers.filter(w => w.active || w.id === p.worker_id);
  let kind = p.kind || 'wage';
  const wsel = h('select', { name: 'worker_id', required: true }, h('option', { value: '' }, '—'), ws.map(w => h('option', { value: w.id }, w.name)));
  wsel.value = p.worker_id || '';
  const mi = moneyInputs(p);
  const date = h('input', { name: 'paid_on', type: 'date', required: true, value: p.paid_on || today() });
  const method = h('select', { name: 'method' }, ['cash', 'transfer', 'whish', 'omt', 'other'].map(m => h('option', { value: m }, t(m))));
  method.value = p.method || 'cash';
  const note = h('input', { name: 'note', maxlength: '500', value: p.note || '' });
  mi.setExtra(() => {
    const wid = wsel.value;
    if (!wid) return '';
    return `  ·  ${t('balance')}: ${usd(balance(wid) + (p.id && p.worker_id === wid ? Number(p.amount) : 0))}`;
  });
  wsel.addEventListener('change', mi.refresh);
  mi.refresh();
  const kindSeg = segPick([['wage', t('wage')], ['advance', t('advanceKind')]], kind, k => { kind = k; });
  const form = h('form', { class: 'form' }, field(t('worker'), wsel), kindSeg, ...mi.nodes, field(t('date'), date), field(t('method'), method), field(t('note'), note));
  sheet(p.id ? t('editPayment') : kind === 'advance' ? t('giveAdvance') : t('addPayment'), form, async () => {
    await saveRow('payments', { id: p.id, worker_id: wsel.value, kind, paid_on: date.value, method: method.value, note: note.value.trim() || null, ...mi.value() });
  }, p.id && (() => removeRow('payments', p.id)));
}

function editAdjustment(a = {}) {
  const w = workerById(a.worker_id);
  if (!w) return;
  let kind = a.kind || 'bonus';
  const hourly = Number(w.daily_rate) / Number(S.data.biz.hours_per_day);
  const mult = Number(S.data.biz.overtime_multiplier || 1.5);
  const hours = h('input', { type: 'number', inputmode: 'decimal', min: '0.25', max: '24', step: 'any', value: a.hours ?? '' });
  const amount = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', required: true, value: a.amount ?? '' });
  const date = h('input', { type: 'date', required: true, value: a.day || today() });
  const note = h('input', { maxlength: '500', value: a.note || '' });
  const hoursF = field(`${t('hours')} (${usd(hourly)} × ${mult})`, hours);
  const sync = () => {
    hoursF.hidden = kind !== 'overtime';
    if (kind === 'overtime' && hours.value) amount.value = round2(Number(hours.value) * hourly * mult);
  };
  hours.addEventListener('input', sync);
  const seg = segPick([['bonus', t('bonus')], ['overtime', t('overtime')], ['deduction', t('deduction')]], kind, k => { kind = k; sync(); });
  sync();
  const form = h('form', { class: 'form' }, seg, hoursF, field(`${t('amount')} (USD)`, amount), field(t('date'), date), field(t('note'), note));
  sheet(`${w.name} · ${t('adjust')}`, form, async () => {
    const v = Number(amount.value);
    if (!(v > 0)) throw new Error(t('amount'));
    await saveRow('adjustments', { id: a.id, worker_id: w.id, day: date.value, kind, amount: round2(v), hours: kind === 'overtime' && hours.value ? Number(hours.value) : null, note: note.value.trim() || null });
  }, a.id && (() => removeRow('adjustments', a.id)));
}

function viewPayments() {
  const r = curRange();
  const ps = S.data.payments.filter(p => inRange(p.paid_on, r)).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  const groups = new Map();
  ps.forEach(p => { if (!groups.has(p.paid_on)) groups.set(p.paid_on, []); groups.get(p.paid_on).push(p); });
  const st = stats(null, r);
  return h('div', { class: 'view' }, periodBar(),
    h('div', { class: 'kpis three' }, kpi(t('paid'), usd(st.paid), st.advances ? `${t('advances')}: ${usd(st.advances)}` : lbp(st.paid), 'good'), kpi(t('earned'), usd(st.earned)),
      kpi(st.left >= 0 ? t('left') : t('advance'), usd(Math.abs(st.left)), null, st.left > 0 ? 'warn' : 'good')),
    ps.length ? [...groups.entries()].map(([d, list]) => h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', null, dayLabel(d)), h('b', null, usd(sum(list, p => p.amount)))),
      h('ul', { class: 'plist' }, list.map(p => h('li', { onclick: () => editPayment(p) },
        h('span', { class: 'av sm' }, (workerById(p.worker_id)?.name || '?').slice(0, 1)),
        h('span', { class: 'pl-main' }, h('b', null, workerById(p.worker_id)?.name || '?'), h('small', { class: 'muted' }, [p.kind === 'advance' && t('advanceKind'), t(p.method), p.note].filter(Boolean).join(' · '))),
        h('span', { class: 'pl-amt' }, h('b', null, usd(p.amount)), p.currency === 'LBP' && h('small', { class: 'muted block' }, lbpRaw(p.lbp_amount)))))))) : empty(t('noData')),
    fab(t('addPayment'), () => editPayment()));
}

function viewSites() {
  const r = curRange();
  const list = [...S.data.sites].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  const td = S.data.entries.filter(e => e.day === today() && e.status !== 'absent');
  return h('div', { class: 'view' }, periodBar(),
    list.length ? h('div', { class: 'wlist' }, list.map(s => {
      const st = siteStats(s.id, r);
      const here = td.filter(e => e.site_id === s.id).length;
      const card = h('button', { class: 'sitecard' + (s.active ? '' : ' off'), onclick: () => openSite(s.id) },
        h('div', { class: 'sc-top' }, dot(siteColor(s.id)), h('b', null, s.name), h('span', { class: 'chip sm' }, `${here} ${t('onSiteToday')}`)),
        h('small', { class: 'muted' }, [s.client, s.location, !s.active && t('inactive')].filter(Boolean).join(' · ') || ' '),
        h('div', { class: 'sc-nums' },
          h('span', null, h('small', null, t('labor')), usd(st.labor)),
          h('span', null, h('small', null, t('expenses')), usd(st.expenses)),
          h('span', null, h('small', null, t('income')), usd(st.income)),
          h('span', { class: st.profit >= 0 ? 'good-t' : 'hot-t' }, h('small', null, t('profit')), usd(st.profit))));
      card.style.borderInlineStartColor = siteColor(s.id);
      return card;
    })) : empty(t('noSites'), h('button', { class: 'btn', onclick: () => editSite() }, t('addSite'))),
    fab(t('addSite'), () => editSite()));
}

function openSite(id) { S.view = 'site'; S.siteId = id; render(); window.scrollTo(0, 0); }

function viewSite() {
  const s = siteById(S.siteId);
  if (!s) { S.view = 'sites'; return viewSites(); }
  const r = curRange();
  const st = siteStats(s.id, r);
  const allSt = siteStats(s.id);
  const td = S.data.entries.filter(e => e.day === today() && e.site_id === s.id && e.status !== 'absent');
  const byWorker = new Map();
  st.entries.filter(worked).forEach(e => {
    const x = byWorker.get(e.worker_id) || { days: 0, cost: 0 };
    x.days += Number(e.days); x.cost += Number(e.amount);
    byWorker.set(e.worker_id, x);
  });
  const txns = [...allSt.txns].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 100);
  return h('div', { class: 'view' },
    h('div', { class: 'whead' },
      h('button', { class: 'icon-btn flip', 'aria-label': 'back', onclick: () => { S.view = 'sites'; render(); } }, icon('back')),
      h('span', { class: 'av lg', style: { background: siteColor(s.id), color: '#fff' } }, s.name.slice(0, 1)),
      h('div', { class: 'wh-main' }, h('h2', null, s.name), h('small', { class: 'muted' }, [s.client, s.location].filter(Boolean).join(' · '))),
      h('button', { class: 'icon-btn', 'aria-label': t('edit'), onclick: () => editSite(s) }, icon('edit'))),
    h('div', { class: 'card balcard ' + (allSt.profit >= 0 ? 'good' : 'hot') },
      h('div', null, h('span', { class: 'kl' }, `${t('profit')} · ${t('allTime')}`), h('strong', { class: 'big' }, usd(allSt.profit)),
        h('small', { class: 'muted block' }, `${t('income')} ${usd(allSt.income)} − ${t('labor')} ${usd(allSt.labor)} − ${t('expenses')} ${usd(allSt.expenses)}`))),
    h('div', { class: 'actionrow' },
      h('button', { class: 'btn ghost sm', onclick: () => editSiteTxn({ site_id: s.id, kind: 'expense' }) }, icon('plus'), ' ', t('addExpense')),
      h('button', { class: 'btn ghost sm', onclick: () => editSiteTxn({ site_id: s.id, kind: 'income' }) }, icon('money'), ' ', t('addIncome')),
      h('button', { class: 'btn ghost sm', onclick: () => { S.view = 'planner'; S.period = 'week'; S.anchor = today(); S.brush = s.id; S.scrollToday = true; render(); } }, icon('planner'), ' ', t('assignSite'))),
    periodBar(),
    h('div', { class: 'kpis' },
      kpi(t('income'), usd(st.income), null, 'good'), kpi(t('labor'), usd(st.labor)),
      kpi(t('expenses'), usd(st.expenses), null, 'warn'), kpi(t('profit'), usd(st.profit), null, st.profit >= 0 ? 'good' : 'hot')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, t('workedHere')), h('span', { class: 'chip sm' }, `${td.length} ${t('onSiteToday')}`)),
        byWorker.size ? h('ul', { class: 'plist' }, [...byWorker.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([wid, x]) => h('li', { onclick: () => openWorker(wid) },
          h('span', { class: 'pl-main' }, h('b', null, workerById(wid)?.name || '?'), h('small', { class: 'muted' }, `${daysTxt(x.days)} ${t('days')}`)), h('b', null, usd(x.cost))))) : empty(t('noData'))),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, `${t('expenses')} / ${t('income')}`)),
        txns.length ? h('ul', { class: 'plist' }, txns.map(x => h('li', { onclick: () => editSiteTxn(x) },
          h('span', { class: 'pl-main' }, h('b', null, x.kind === 'income' ? t('income') : (x.category ? (t(x.category) !== x.category ? t(x.category) : x.category) : t('expenses'))), h('small', { class: 'muted' }, [dayLabel(x.day), x.note].filter(Boolean).join(' · '))),
          h('span', { class: 'pl-amt' }, h('b', { class: x.kind === 'income' ? 'good-t' : '' }, (x.kind === 'income' ? '+' : '−') + usd(x.amount)), x.currency === 'LBP' && h('small', { class: 'muted block' }, lbpRaw(x.lbp_amount)))))) : empty(t('noData')))),
    fab(t('addExpense'), () => editSiteTxn({ site_id: s.id, kind: 'expense' })));
}

function editSite(s = {}) {
  const name = h('input', { name: 'name', required: true, maxlength: '120', value: s.name || '' });
  const client = h('input', { name: 'client', maxlength: '120', value: s.client || '' });
  const loc = h('input', { name: 'location', maxlength: '200', value: s.location || '' });
  const active = h('input', { type: 'checkbox', checked: s.active !== false });
  sheet(s.id ? t('siteDetail') : t('addSite'), h('form', { class: 'form' }, field(t('name'), name), field(t('client'), client), field(t('location'), loc), h('label', { class: 'check' }, active, h('span', null, t('active')))),
    async () => {
      const saved = await saveRow('sites', { id: s.id, name: name.value.trim(), client: client.value.trim() || null, location: loc.value.trim() || null, active: active.checked });
      if (!s.id) openSite(saved.id);
    },
    s.id && (async () => { await removeRow('sites', s.id); S.view = 'sites'; }));
}

function editSiteTxn(x = {}) {
  let kind = x.kind || 'expense';
  const cats = ['materials', 'equipment', 'transport', 'food', 'other'];
  const cat = h('select', null, cats.map(c => h('option', { value: c }, t(c))));
  cat.value = cats.includes(x.category) ? x.category : 'materials';
  const catF = field(t('category'), cat);
  const mi = moneyInputs(x);
  mi.refresh();
  const date = h('input', { type: 'date', required: true, value: x.day || today() });
  const note = h('input', { maxlength: '500', value: x.note || '' });
  const seg = segPick([['expense', t('expenses')], ['income', t('income')]], kind, k => { kind = k; catF.hidden = k !== 'expense'; });
  catF.hidden = kind !== 'expense';
  const form = h('form', { class: 'form' }, seg, catF, ...mi.nodes, field(t('date'), date), field(t('note'), note));
  sheet(x.id ? t('editTxn') : kind === 'income' ? t('addIncome') : t('addExpense'), form, async () => {
    await saveRow('site_txns', { id: x.id, site_id: x.site_id, kind, category: kind === 'expense' ? cat.value : null, day: date.value, note: note.value.trim() || null, ...mi.value() });
  }, x.id && (() => removeRow('site_txns', x.id)));
}

function teamCard() {
  if (S.store.demo) return null;
  if (S.members === null) {
    S.members = [];
    S.store.members().then(m => { S.members = m; if (S.view === 'settings') render(); }).catch(() => {});
  }
  return h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', null, t('team')), h('button', { class: 'btn ghost sm', onclick: makeInvite }, icon('plus'), ' ', t('inviteForeman'))),
    S.members.length ? h('ul', { class: 'plist' }, S.members.map(m => h('li', null,
      h('span', { class: 'pl-main' }, h('b', null, m.email), h('small', { class: 'muted' }, t('foreman'))),
      h('button', { class: 'btn danger ghost sm', onclick: async () => {
        if (!confirm(t('confirmDelete'))) return;
        try { await S.store.removeMember(m.id); S.members = S.members.filter(x => x.id !== m.id); toast(t('deleted')); render(); } catch (err) { fail(err); }
      } }, t('removeMember'))))) : h('p', { class: 'muted' }, t('noMembers')));
}

async function makeInvite() {
  try {
    const { code } = await S.store.invite();
    const link = `${location.origin}/?invite=${encodeURIComponent(code)}`;
    const codeEl = h('div', { class: 'invite-code' }, code);
    const box = h('form', { class: 'form' }, h('p', { class: 'muted' }, t('inviteNote')), codeEl,
      h('div', { class: 'actionrow' },
        h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => { try { await navigator.clipboard.writeText(link); toast(t('copiedOk')); } catch { fail(new Error(t('error'))); } } }, icon('copy'), ' ', t('copy')),
        navigator.share && h('button', { type: 'button', class: 'btn ghost sm', onclick: () => navigator.share({ title: t('app'), text: `${t('inviteCode')}: ${code}`, url: link }).catch(() => {}) }, t('share'))));
    sheet(t('inviteForeman'), box, async () => {});
  } catch (err) { fail(err); }
}

function viewSettings() {
  const fm = isForeman();
  const ts = h('select', { name: 'ts', onchange: () => { applyTextSize(ts.value); try { localStorage.setItem('worksite_ts', ts.value); } catch {} } },
    h('option', { value: '' }, t('tsNormal')), h('option', { value: 'l' }, t('tsLarge')), h('option', { value: 'xl' }, t('tsXLarge')));
  try { ts.value = localStorage.getItem('worksite_ts') || ''; } catch {}
  const acct = h('div', { class: 'card stack' },
    S.store.demo && h('p', { class: 'banner' }, t('demo')),
    !fm && h('button', { class: 'btn ghost', onclick: exportCsv }, t('exportCsv')),
    !S.store.demo && h('button', { class: 'btn ghost', onclick: changePassword }, t('changePassword')),
    h('button', { class: 'btn danger ghost', onclick: async () => { await S.store.signOut(); try { localStorage.removeItem('worksite_mode'); } catch {} location.reload(); } }, t('signOut')));
  const lk = getLang() === 'ar' ? 'ar' : 'en';
  const news = S.changelog.length > 0 && h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h3', null, t('whatsNew')), h('span', { class: 'muted' }, `${t('version')} ${S.changelog[0].version}`)),
    h('ul', { class: 'news' }, S.changelog[0].items.map(i => h('li', null, i[lk] || i.en))));
  if (fm) return h('div', { class: 'view narrow' }, h('div', { class: 'card form' }, field(t('textSize'), ts)), news, acct);

  const b = S.data.biz;
  const name = h('input', { name: 'name', maxlength: '120', value: b.name || '' });
  const lang = h('select', { name: 'lang' }, h('option', { value: 'en' }, 'English'), h('option', { value: 'ar' }, 'العربية'));
  lang.value = b.lang;
  const period = h('select', { name: 'period' }, ['day', 'week', 'month'].map(p => h('option', { value: p }, t(p))));
  period.value = b.period;
  const ws = h('select', { name: 'week_start' }, [1, 6, 0].map(d => h('option', { value: String(d) }, t('weekdays')[d])));
  ws.value = String(b.week_start);
  const payday = h('select', { name: 'payday' }, [6, 5, 0, 1, 2, 3, 4].map(d => h('option', { value: String(d) }, t('weekdays')[d])));
  payday.value = String(b.payday ?? 6);
  const hpd = h('input', { name: 'hours_per_day', type: 'number', min: '1', max: '24', step: 'any', inputmode: 'decimal', value: b.hours_per_day });
  const rate = h('input', { name: 'lbp_rate', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: b.lbp_rate });
  const ot = h('input', { name: 'overtime_multiplier', type: 'number', min: '1', max: '3', step: 'any', inputmode: 'decimal', value: b.overtime_multiplier ?? 1.5 });
  const weekly = h('input', { type: 'checkbox', checked: !!b.weekly_email });
  const form = h('form', { class: 'form card', onsubmit: async ev => {
    ev.preventDefault();
    try {
      S.data.biz = await S.store.saveBiz({
        name: name.value.trim(), lang: lang.value, period: period.value, week_start: Number(ws.value), hours_per_day: Number(hpd.value),
        lbp_rate: Number(rate.value), payday: Number(payday.value), overtime_multiplier: Number(ot.value), weekly_email: weekly.checked
      });
      normalize();
      setLang(S.data.biz.lang);
      toast(t('saved'));
      render();
    } catch (err) { fail(err); }
  } },
    field(t('business'), name), h('div', { class: 'row2' }, field(t('language'), lang), field(t('textSize'), ts)),
    h('div', { class: 'row2' }, field(t('defaultPeriod'), period), field(t('weekStart'), ws)),
    h('div', { class: 'row2' }, field(t('payday'), payday), field(t('hoursPerDay'), hpd)),
    h('div', { class: 'row2' }, field(t('lbpRate'), rate), field(t('otMultiplier'), ot)),
    !S.store.demo && h('label', { class: 'check' }, weekly, h('span', null, t('weeklyEmail'))),
    h('button', { class: 'btn', type: 'submit' }, t('save')));
  return h('div', { class: 'view narrow' }, form, teamCard(), news, acct);
}

function exportCsv() {
  const wName = id => workerById(id)?.name;
  const sName = id => siteById(id)?.name;
  const rows = [['type', 'date', 'worker', 'site', 'kind', 'days', 'hours', 'rate_usd', 'amount_usd', 'currency', 'lbp_amount', 'lbp_rate', 'method', 'note']];
  S.data.entries.forEach(e => rows.push(['work', e.day, wName(e.worker_id), sName(e.site_id), e.status, e.days, e.hours, e.rate, e.amount, 'USD', '', '', '', e.note]));
  S.data.payments.forEach(p => rows.push(['payment', p.paid_on, wName(p.worker_id), '', p.kind, '', '', '', p.amount, p.currency, p.lbp_amount, p.lbp_rate, p.method, p.note]));
  S.data.adjustments.forEach(a => rows.push(['adjustment', a.day, wName(a.worker_id), '', a.kind, '', a.hours, '', adjSigned(a), 'USD', '', '', '', a.note]));
  S.data.site_txns.forEach(x => rows.push(['site', x.day, '', sName(x.site_id), x.kind, '', '', '', x.amount, x.currency, x.lbp_amount, x.lbp_rate, x.category, x.note]));
  rows.splice(1, rows.length, ...rows.slice(1).sort((a, b) => a[1].localeCompare(b[1])));
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `worksite-${today()}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sheet(title, form, onSave, onDelete) {
  const close = () => { wrap.classList.remove('show'); document.removeEventListener('keydown', esc); setTimeout(() => { wrap.remove(); if (updatePending) checkUpdate(); }, 200); };
  const esc = ev => ev.key === 'Escape' && close();
  const saveBtn = h('button', { class: 'btn', type: 'submit' }, t('save'));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    saveBtn.disabled = true;
    try { await onSave(); close(); render(); } catch (err) { fail(err); } finally { saveBtn.disabled = false; }
  });
  form.append(h('div', { class: 'actions' },
    onDelete && h('button', { class: 'btn danger ghost', type: 'button', onclick: async () => {
      if (!confirm(t('confirmDelete'))) return;
      try { await onDelete(); toast(t('deleted')); close(); render(); } catch (err) { fail(err); }
    } }, t('delete')),
    h('span', { class: 'sp' }),
    h('button', { class: 'btn ghost', type: 'button', onclick: close }, t('cancel')), saveBtn));
  const wrap = h('div', { class: 'overlay', onclick: ev => ev.target === wrap && close() },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'grab' }), h('h2', null, title), form));
  document.body.append(wrap);
  document.addEventListener('keydown', esc);
  requestAnimationFrame(() => wrap.classList.add('show'));
}

const NUM_FIELDS = ['days', 'hours', 'rate', 'amount', 'daily_rate', 'lbp_amount', 'lbp_rate'];
const numify = r => { NUM_FIELDS.forEach(f => { if (r[f] != null) r[f] = Number(r[f]); }); return r; };

function merge(kind, rows) {
  const list = S.data[kind];
  rows.forEach(r => { numify(r); const i = list.findIndex(x => x.id === r.id); if (i >= 0) list[i] = r; else list.push(r); });
}

async function saveRow(kind, row, quiet) {
  const saved = await S.store.save(kind, row);
  merge(kind, [saved]);
  if (!quiet) toast(t('saved'));
  return saved;
}

async function removeRow(kind, id) {
  await S.store.remove(kind, id);
  S.data[kind] = S.data[kind].filter(r => r.id !== id);
  if (kind === 'workers') ['entries', 'payments', 'adjustments'].forEach(k => { S.data[k] = S.data[k].filter(x => x.worker_id !== id); });
  if (kind === 'sites') {
    S.data.entries.forEach(e => { if (e.site_id === id) e.site_id = null; });
    S.data.site_txns = S.data.site_txns.filter(x => x.site_id !== id);
    if (S.brush === id) S.brush = '';
  }
}

function normalize() {
  ['entries', 'payments', 'workers', 'adjustments', 'site_txns'].forEach(k => { S.data[k] = (S.data[k] || []).map(numify); });
  ['lbp_rate', 'hours_per_day', 'week_start', 'payday', 'overtime_multiplier'].forEach(f => { if (S.data.biz[f] != null) S.data.biz[f] = Number(S.data.biz[f]); });
}

function landing() {
  S.anchor = today();
  if (isForeman()) { S.view = 'planner'; S.period = 'day'; }
  else { S.view = 'dashboard'; S.period = S.data.biz.period || 'week'; }
}

function applyTextSize(v) {
  document.documentElement.classList.remove('ts-l', 'ts-xl');
  if (v === 'l' || v === 'xl') document.documentElement.classList.add('ts-' + v);
}

const tabs = () => isForeman() ? ['planner', 'workers'] : ['dashboard', 'planner', 'workers', 'sites', 'payments'];
const parentTab = { worker: 'workers', site: 'sites' };

function go(k) {
  const list = tabs();
  const from = list.indexOf(parentTab[S.view] || S.view), to = list.indexOf(k);
  if (!S.slide && from >= 0 && to >= 0 && from !== to) S.slide = to > from ? 'next' : 'prev';
  S.view = k; S.q = '';
  if (k === 'planner') { S.period = isForeman() ? 'day' : 'week'; S.anchor = today(); S.scrollToday = true; }
  else if (k === 'dashboard' || k === 'payments' || k === 'sites') S.period = S.data.biz.period || 'week';
  render(); window.scrollTo(0, 0);
}

function render() {
  const views = { dashboard: viewDashboard, planner: viewPlanner, workers: viewWorkers, worker: viewWorker, sites: viewSites, site: viewSite, payments: viewPayments, settings: viewSettings };
  if (isForeman() && !['planner', 'workers', 'settings'].includes(S.view)) S.view = 'planner';
  const active = parentTab[S.view] || S.view;
  const navBtn = k => h('button', { class: active === k ? 'on' : '', 'aria-current': active === k ? 'page' : null, onclick: () => go(k) }, icon(k), h('span', null, t(k === 'sites' ? 'sitesTab' : k)));
  const title = t(active === 'sites' ? 'sitesTab' : active);
  const view = views[S.view]();
  if (S.slide) { view.classList.add('from-' + S.slide); S.slide = null; }

  root.replaceChildren(
    h('div', { class: 'shell' },
      h('aside', { class: 'side' },
        h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('helmet')), h('div', null, h('b', null, t('app')), h('small', null, S.data.biz.name || ''))),
        h('nav', null, [...tabs(), 'settings'].map(navBtn)),
        S.store.demo && h('p', { class: 'banner sm' }, t('demo'))),
      h('main', null,
        h('header', { class: 'top' },
          h('span', { class: 'logo sm' }, icon('helmet')),
          h('div', { class: 'top-t' }, h('h1', null, title), h('small', { class: 'muted' }, S.data.biz.name || t('app'))),
          h('button', { class: 'icon-btn gear' + (S.view === 'settings' ? ' on' : ''), 'aria-label': t('settings'), onclick: () => go('settings') }, icon('settings'))),
        view)));
  drawNav(active);
  if (S.scrollToday && S.view === 'planner') {
    S.scrollToday = false;
    requestAnimationFrame(() => root.querySelector('.grid-wrap .dh.now')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
}

const $dock = h('nav', { class: 'dock', 'aria-label': 'Main' });
const $lens = h('span', { class: 'lens', 'aria-hidden': 'true' });
document.body.append($dock);
let navList = [];
let drag = null;
let dragEnd = 0;
const isRtl = () => document.documentElement.dir === 'rtl';

function drawNav(active) {
  navList = active === null ? [] : tabs();
  document.body.classList.toggle('has-nav', navList.length > 0);
  if (!navList.length) { $dock.replaceChildren(); return; }
  const idx = navList.indexOf(active);
  $dock.style.setProperty('--n', String(navList.length));
  $dock.replaceChildren($lens, ...navList.map(k => h('button', {
    type: 'button', class: 'tab' + (active === k ? ' on' : ''), 'aria-current': active === k ? 'page' : null, onclick: () => go(k)
  }, icon(k), h('span', null, t(k === 'sites' ? 'sitesTab' : k)))));
  requestAnimationFrame(() => {
    $lens.style.opacity = idx < 0 ? '0' : '1';
    if (idx >= 0) $lens.style.transform = `translateX(${(isRtl() ? -idx : idx) * 100}%)`;
  });
}

function dragIndex(d) {
  const near = Math.round(d.pos / d.w);
  return isRtl() ? d.n - 1 - near : near;
}

function dragStop() {
  $dock.classList.remove('dragging');
  $dock.querySelectorAll('.tab').forEach(el => el.classList.remove('over'));
  drag = null;
}

$dock.addEventListener('pointerdown', ev => {
  if (!navList.length || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  const r = $dock.getBoundingClientRect();
  drag = { id: ev.pointerId, x0: ev.clientX, left: r.left + 6, w: (r.width - 12) / navList.length, n: navList.length, moved: false, pos: 0 };
});

$dock.addEventListener('pointermove', ev => {
  if (!drag || ev.pointerId !== drag.id) return;
  if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 8) return;
  if (!drag.moved) {
    drag.moved = true;
    try { $dock.setPointerCapture(ev.pointerId); } catch {}
    $dock.classList.add('dragging');
    $lens.style.opacity = '1';
  }
  const max = (drag.n - 1) * drag.w;
  drag.pos = Math.max(0, Math.min(max, ev.clientX - drag.left - drag.w / 2));
  $lens.style.transform = `translateX(${isRtl() ? drag.pos - max : drag.pos}px)`;
  const i = dragIndex(drag);
  $dock.querySelectorAll('.tab').forEach((el, j) => el.classList.toggle('over', j === i));
});

function dragDone(ev) {
  if (!drag || ev.pointerId !== drag.id) return;
  const d = drag;
  dragStop();
  if (!d.moved) return;
  dragEnd = Date.now();
  const target = navList[dragIndex(d)];
  if (ev.type === 'pointerup' && target && target !== (parentTab[S.view] || S.view)) {
    if (navigator.vibrate) navigator.vibrate(8);
    go(target);
  } else drawNav(parentTab[S.view] || S.view);
}

$dock.addEventListener('pointerup', dragDone);
$dock.addEventListener('pointercancel', dragDone);
$dock.addEventListener('click', ev => { if (Date.now() - dragEnd < 400) { ev.stopPropagation(); ev.preventDefault(); } }, true);

function authScreen(msg) {
  drawNav(null);
  const params = new URLSearchParams(location.search);
  const invited = params.get('invite') || '';
  if (invited) history.replaceState(null, '', location.pathname);
  let mode = invited ? 'up' : 'in';
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', maxlength: '254' });
  const pw = h('input', { type: 'password', name: 'password', required: true, minlength: '10', maxlength: '128', autocomplete: 'current-password' });
  const code = h('input', { name: 'invite', maxlength: '40', autocomplete: 'off', value: invited });
  const codeF = field(t('haveInvite'), code);
  const info = h('p', { class: 'info' }, msg || '');
  const submit = h('button', { class: 'btn wide', type: 'submit' });
  const toggle = h('button', { class: 'link-btn', type: 'button' });
  const draw = () => {
    submit.textContent = mode === 'in' ? t('signIn') : t('signUp');
    toggle.textContent = mode === 'in' ? t('noAccount') : t('haveAccount');
    pw.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
    codeF.hidden = mode === 'in';
  };
  toggle.onclick = () => { mode = mode === 'in' ? 'up' : 'in'; draw(); };
  const form = h('form', { class: 'form', onsubmit: async ev => {
    ev.preventDefault();
    submit.disabled = true;
    try {
      if (mode === 'in') { await S.store.signIn(email.value.trim(), pw.value); await boot(); }
      else { const r = await S.store.signUp(email.value.trim(), pw.value, code.value.trim()); if (r.session) await boot(); else { info.textContent = t('checkEmail'); mode = 'in'; draw(); } }
    } catch (err) { fail(err); } finally { submit.disabled = false; }
  } }, field(t('email'), email), field(t('password'), pw, t('pwRule')), codeF, submit, h('div', { class: 'auth-links' }, toggle), info);
  draw();
  const langBtn = h('button', { class: 'chip', onclick: () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); try { localStorage.setItem('worksite_lang', getLang()); } catch {} authScreen(); } }, getLang() === 'ar' ? 'English' : 'العربية');
  root.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'auth-card' }, h('div', { class: 'auth-top' }, h('span', { class: 'logo lg' }, icon('helmet')), langBtn),
      h('h1', null, t('app')), h('p', { class: 'muted' }, t('tagline')), form,
      !invited && h('button', { class: 'btn ghost wide', onclick: async () => { try { localStorage.setItem('worksite_mode', 'demo'); } catch {} S.store = createStore(true); await boot(); } }, t('tryDemo')))));
}

function changePassword() {
  const cur = h('input', { type: 'password', required: true, maxlength: '128', autocomplete: 'current-password' });
  const pw = h('input', { type: 'password', required: true, minlength: '10', maxlength: '128', autocomplete: 'new-password' });
  sheet(t('changePassword'), h('form', { class: 'form' }, field(t('currentPassword'), cur), field(t('newPassword'), pw, t('pwRule'))),
    async () => { await S.store.changePassword(cur.value, pw.value); toast(t('saved')); });
}

async function boot() {
  const s = await S.store.session();
  if (!s) return authScreen();
  S.data = await S.store.load();
  S.role = S.data.role === 'foreman' ? 'foreman' : 'owner';
  S.data.biz = S.data.biz || {};
  normalize();
  S.members = null;
  S.store.changelog().then(c => { S.changelog = Array.isArray(c) ? c : []; if (S.view === 'settings') render(); }).catch(() => {});
  setLang(S.data.biz.lang || getLang());
  landing();
  render();
}

async function start() {
  let mode = null;
  try { mode = localStorage.getItem('worksite_mode'); setLang(localStorage.getItem('worksite_lang') || 'ar'); applyTextSize(localStorage.getItem('worksite_ts')); } catch {}
  S.store = createStore(mode === 'demo' && !new URLSearchParams(location.search).get('invite'));
  S.store.onAuth((ev) => {
    if (ev === 'SIGNED_OUT' && S.data) { S.data = null; authScreen(t('sessionExpired')); }
  });
  try { await boot(); } catch (err) { fail(err); authScreen(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}

let swipe = null;
root.addEventListener('touchstart', ev => {
  swipe = null;
  if (!S.data || ev.touches.length !== 1 || document.querySelector('.overlay')) return;
  if (ev.target.closest('.grid-wrap, .tbl-wrap, .brushes, .chart, input, select, textarea, .auth')) return;
  swipe = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, t: Date.now() };
}, { passive: true });
root.addEventListener('touchend', ev => {
  if (!swipe) return;
  const p = ev.changedTouches[0];
  const dx = p.clientX - swipe.x, dy = p.clientY - swipe.y, dt = Date.now() - swipe.t;
  swipe = null;
  if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || dt > 700) return;
  const forward = document.documentElement.dir === 'rtl' ? dx > 0 : dx < 0;
  const list = tabs();
  if (parentTab[S.view] || S.view === 'settings') {
    if (!forward) { S.slide = 'prev'; S.view = parentTab[S.view] || list[0]; render(); window.scrollTo(0, 0); }
    return;
  }
  const i = list.indexOf(S.view);
  const j = i + (forward ? 1 : -1);
  if (i < 0 || j < 0 || j >= list.length) return;
  go(list[j]);
}, { passive: true });

let loadedBuild = null;
let updatePending = false;

async function checkUpdate() {
  let build;
  try {
    const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    ({ build } = await res.json());
  } catch { return; }
  if (!loadedBuild) { loadedBuild = build; return; }
  if (build === loadedBuild) return;
  if (document.querySelector('.overlay')) { updatePending = true; return; }
  try { sessionStorage.setItem('worksite_updated', '1'); } catch {}
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  location.reload();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
window.addEventListener('focus', checkUpdate);
setInterval(checkUpdate, 5 * 60 * 1000);
checkUpdate();
try { if (sessionStorage.getItem('worksite_updated')) { sessionStorage.removeItem('worksite_updated'); setTimeout(() => toast(t('appUpdated')), 600); } } catch {}

window.addEventListener('offline', () => toast(t('offline'), true));
start();
