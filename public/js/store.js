import { addDays, iso, startOf } from './util.js';

const FIELDS = {
  workers: ['name', 'phone', 'trade', 'daily_rate', 'active', 'notes', 'assigned_to'],
  sites: ['name', 'location', 'client', 'active'],
  entries: ['worker_id', 'site_id', 'day', 'status', 'days', 'hours', 'rate', 'note'],
  payments: ['worker_id', 'paid_on', 'kind', 'amount', 'currency', 'lbp_amount', 'lbp_rate', 'method', 'note'],
  adjustments: ['worker_id', 'day', 'kind', 'amount', 'hours', 'note'],
  site_txns: ['site_id', 'day', 'kind', 'category', 'amount', 'currency', 'lbp_amount', 'lbp_rate', 'note']
};
const BIZ_FIELDS = ['name', 'lbp_rate', 'hours_per_day', 'period', 'week_start', 'lang', 'payday', 'weekly_email', 'overtime_multiplier', 'phone', 'website'];
const DEFAULT_BIZ = { name: '', lbp_rate: 89500, hours_per_day: 8, period: 'week', week_start: 1, lang: 'ar', payday: 6, weekly_email: false, overtime_multiplier: 1.5 };

const pick = (row, keys) => Object.fromEntries(keys.filter(k => k in row).map(k => [k, row[k] === '' ? null : row[k]]));
const calcAmount = e => e.status === 'worked' ? Math.round(Number(e.days) * Number(e.rate) * 100) / 100 : 0;

const CACHE_KEY = 'worksite_cache';
const QUEUE_KEY = 'worksite_queue';
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const clearLocal = () => { try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(QUEUE_KEY); } catch {} };

function apiStore() {
  let authCb = null;
  let queue = readJSON(QUEUE_KEY) || [];
  let flushing = false;
  const persist = () => writeJSON(QUEUE_KEY, queue);

  async function call(method, path, body) {
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), path === 'data' ? 20000 : 12000);
    try {
      res = await fetch('/api/' + path, {
        method, credentials: 'same-origin', signal: ctrl.signal, cache: 'no-store',
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch {
      const err = new Error('Network error');
      err.net = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== 'login' && path !== 'password') authCb?.('SIGNED_OUT');
    if (!res.ok) { const err = new Error(data.error || `Error ${res.status}`); err.status = res.status; throw err; }
    return data;
  }

  async function write(method, path, body, local) {
    if (queue.length) { queue.push({ method, path, body }); persist(); return local; }
    try { return await call(method, path, body); }
    catch (err) { if (!err.net) throw err; queue.push({ method, path, body }); persist(); return local; }
  }

  const localRow = (kind, row) => {
    const r = { ...row };
    if (kind === 'entries' && r.rate != null) r.amount = r.status === 'worked' ? Math.round(Number(r.days) * Number(r.rate) * 100) / 100 : 0;
    return r;
  };

  return {
    demo: false,
    onAuth: cb => { authCb = cb; },
    async session() {
      try { return (await call('GET', 'me')).user; }
      catch (err) { if (err.net && readJSON(CACHE_KEY)) return { offline: true }; throw err; }
    },
    signIn: (email, password) => call('POST', 'login', { email, password }),
    signUp: async (email, password, invite) => ({ session: await call('POST', 'signup', { email, password, invite: invite || undefined }) }),
    changePassword: (current, password) => call('POST', 'password', { current, password }),
    signOut: async () => { clearLocal(); queue = []; try { await call('POST', 'logout', {}); } catch {} },
    async load() {
      try { const d = await call('GET', 'data'); writeJSON(CACHE_KEY, d); return d; }
      catch (err) { const c = err.net && readJSON(CACHE_KEY); if (c) return { ...c, offline: true }; throw err; }
    },
    snapshot: data => writeJSON(CACHE_KEY, data),
    pending: () => queue.length,
    async flush() {
      if (flushing || !queue.length) return { done: 0, failed: 0 };
      flushing = true;
      let done = 0, failed = 0;
      try {
        while (queue.length) {
          const op = queue[0];
          try { await call(op.method, op.path, op.body); done++; }
          catch (err) { if (err.net) break; failed++; }
          queue.shift();
          persist();
        }
      } finally { flushing = false; }
      return { done, failed };
    },
    changelog: () => call('GET', 'changelog'),
    invite: role => call('POST', 'invites', { role }),
    join: invite => call('POST', 'join', { invite }),
    leave: () => call('POST', 'leave', {}),
    members: () => call('GET', 'members'),
    removeMember: id => call('DELETE', `members/${id}`),
    saveBiz: row => call('PUT', 'biz', pick(row, BIZ_FIELDS)),
    save(kind, row) {
      const body = pick(row, FIELDS[kind]);
      if (row.id) return write('PUT', `${kind}/${row.id}`, body, localRow(kind, { ...row, ...body }));
      body.id = crypto.randomUUID();
      return write('POST', kind, body, localRow(kind, { ...row, ...body }));
    },
    saveMany(kind, rows) {
      if (!rows.length) return Promise.resolve([]);
      const body = rows.map(r => ({ ...pick(r, FIELDS[kind]), id: r.id || crypto.randomUUID() }));
      return write('POST', `${kind}/bulk`, body, body.map((b, i) => localRow(kind, { ...rows[i], ...b })));
    },
    remove: (kind, id) => write('DELETE', `${kind}/${id}`, undefined, { ok: true, queued: true }),
    removeMany: ids => call('POST', 'entries/remove', { ids }),
    review: (ids, approve) => call('POST', 'entries/review', { ids, approve: !!approve }),
    settle: body => call('POST', 'settle', body),
    logs: before => call('GET', 'admin/logs' + (before ? `?before=${encodeURIComponent(before)}` : '')),
    saveDoc: doc => doc.id ? call('PUT', `docs/${doc.id}`, { title: doc.title, content: doc.content }) : call('POST', 'docs', { title: doc.title, content: doc.content }),
    removeDoc: id => call('DELETE', `docs/${id}`),
    pushKey: () => call('GET', 'push/key'),
    pushSubscribe: sub => call('POST', 'push/subscribe', sub),
    pushUnsubscribe: endpoint => call('POST', 'push/unsubscribe', { endpoint }),
    pushTest: () => call('POST', 'push/test', {})
  };
}

function demoStore() {
  const KEY = 'worksite_demo_v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const write = db => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const uid = () => crypto.randomUUID();
  let db = read() || seed();
  db.biz = { ...DEFAULT_BIZ, ...db.biz };
  ['adjustments', 'site_txns', 'docs'].forEach(k => { db[k] = db[k] || []; });
  write(db);

  function seed() {
    const s = [
      { id: uid(), name: 'Achrafieh Villa', location: 'Achrafieh', active: true },
      { id: uid(), name: 'Jounieh Building', location: 'Jounieh', active: true }
    ];
    const w = [
      ['Hassan', 'Mason', 35], ['Elie', 'Electrician', 40], ['Mohammad', 'Helper', 20],
      ['Georges', 'Carpenter', 38], ['Ali', 'Painter', 28]
    ].map(([name, trade, daily_rate]) => ({ id: uid(), name, trade, daily_rate, phone: '', notes: '', active: true }));
    const entries = [], payments = [];
    const monday = startOf('week', iso(new Date()), 1);
    for (let d = -14; d < 7; d++) {
      const day = addDays(monday, d);
      const dow = new Date(day + 'T00:00').getDay();
      if (dow === 0) continue;
      w.forEach((wk, i) => {
        const future = day > iso(new Date());
        const r = (i * 7 + d * 3 + 20) % 10;
        let status = future ? 'planned' : r === 0 ? 'absent' : 'worked';
        let days = status === 'worked' ? (r === 1 || dow === 6 ? 0.5 : 1) : 0;
        let hours = null;
        if (status === 'worked' && r === 2) { days = 0.75; hours = 6; }
        const e = { id: uid(), worker_id: wk.id, site_id: s[i % 2].id, day, status, days, hours, rate: wk.daily_rate, note: '' };
        e.amount = calcAmount(e);
        entries.push(e);
      });
    }
    w.forEach((wk, i) => {
      payments.push({ id: uid(), worker_id: wk.id, paid_on: addDays(monday, -9), amount: wk.daily_rate * 5, currency: 'USD', method: 'cash', note: '' });
      if (i % 2 === 0) payments.push({ id: uid(), worker_id: wk.id, paid_on: addDays(monday, -2), amount: wk.daily_rate * 4, currency: 'LBP', lbp_amount: wk.daily_rate * 4 * 89500, lbp_rate: 89500, method: 'cash', note: '' });
    });
    return { biz: { ...DEFAULT_BIZ, name: 'Demo Contracting' }, workers: w, sites: s, entries, payments, adjustments: [], site_txns: [] };
  }

  const clone = x => JSON.parse(JSON.stringify(x));
  const upsertLocal = (kind, row) => {
    const list = db[kind];
    let rec = row.id ? list.find(r => r.id === row.id) : null;
    if (kind === 'entries' && !rec) rec = list.find(r => r.worker_id === row.worker_id && r.day === row.day);
    const data = pick(row, FIELDS[kind]);
    if (rec) Object.assign(rec, data); else { rec = { id: uid(), ...data }; list.push(rec); }
    if (kind === 'entries') rec.amount = calcAmount(rec);
    return clone(rec);
  };

  return {
    demo: true,
    onAuth: () => {},
    session: async () => ({ user: { email: 'demo@worksite' } }),
    signOut: async () => { try { localStorage.removeItem(KEY); localStorage.removeItem('worksite_mode'); } catch {} },
    async load() { return { role: 'owner', ...clone(db) }; },
    snapshot: () => {},
    pending: () => 0,
    flush: async () => ({ done: 0, failed: 0 }),
    async saveDoc(doc) {
      const now = new Date().toISOString();
      let d = doc.id && db.docs.find(x => x.id === doc.id);
      if (d) Object.assign(d, { title: doc.title, content: doc.content, updated_at: now });
      else { d = { id: uid(), title: doc.title, content: doc.content, created_at: now, updated_at: now }; db.docs.unshift(d); }
      write(db);
      return clone(d);
    },
    async removeDoc(id) { db.docs = db.docs.filter(d => d.id !== id); write(db); },
    changelog: () => fetch('/api/changelog').then(r => r.ok ? r.json() : []).catch(() => []),
    async saveBiz(row) { db.biz = { ...db.biz, ...pick(row, BIZ_FIELDS) }; write(db); return clone(db.biz); },
    async save(kind, row) { const r = upsertLocal(kind, row); write(db); return r; },
    async saveMany(kind, rows) { const r = rows.map(x => upsertLocal(kind, x)); write(db); return r; },
    async removeMany(ids) { const set = new Set(ids); db.entries = db.entries.filter(e => !set.has(e.id)); write(db); return { deleted: ids, pending: [] }; },
    async review() { return { ids: [], rows: [] }; },
    async settle(b) {
      for (const it of b.items) {
        const pid = uid();
        db.payments.push({ id: pid, worker_id: it.worker_id, paid_on: b.paid_on, kind: 'wage', amount: it.amount, currency: b.currency, lbp_amount: b.currency === 'LBP' ? Math.round(it.amount * b.lbp_rate) : null, lbp_rate: b.currency === 'LBP' ? b.lbp_rate : null, method: b.method, note: b.note, until: b.until });
        db.entries.forEach(e => { if (e.worker_id === it.worker_id && e.day <= b.until && !e.paid_by && e.status === 'worked') e.paid_by = pid; });
        db.adjustments.forEach(a => { if (a.worker_id === it.worker_id && a.day <= b.until && !a.paid_by) a.paid_by = pid; });
      }
      write(db);
      return { ok: true };
    },
    async remove(kind, id) {
      db[kind] = db[kind].filter(r => r.id !== id);
      if (kind === 'workers') ['entries', 'payments', 'adjustments'].forEach(k => { db[k] = db[k].filter(x => x.worker_id !== id); });
      if (kind === 'sites') { db.entries.forEach(e => { if (e.site_id === id) e.site_id = null; }); db.site_txns = db.site_txns.filter(x => x.site_id !== id); }
      write(db);
    }
  };
}

export const createStore = demo => (demo ? demoStore() : apiStore());
