import { CHANGELOG } from './changelog.js';

const COOKIE = '__Host-ws_session';
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const INVITE_DAYS = 7;
const TZ = 'Asia/Beirut';
const enc = new TextEncoder();

const TABLES = {
  workers: { fields: ['name', 'phone', 'trade', 'daily_rate', 'active', 'notes'], required: ['name'] },
  sites: { fields: ['name', 'location', 'client', 'active'], required: ['name'] },
  entries: { fields: ['worker_id', 'site_id', 'day', 'status', 'days', 'hours', 'rate', 'note'], required: ['worker_id', 'day'] },
  payments: { fields: ['worker_id', 'paid_on', 'kind', 'amount', 'currency', 'lbp_amount', 'lbp_rate', 'method', 'note'], required: ['worker_id', 'paid_on', 'amount'] },
  adjustments: { fields: ['worker_id', 'day', 'kind', 'amount', 'hours', 'note'], required: ['worker_id', 'day', 'kind', 'amount'] },
  site_txns: { fields: ['site_id', 'day', 'kind', 'category', 'amount', 'currency', 'lbp_amount', 'lbp_rate', 'note'], required: ['site_id', 'day', 'kind', 'amount'] }
};
const BIZ_FIELDS = ['name', 'lbp_rate', 'hours_per_day', 'period', 'week_start', 'lang', 'payday', 'weekly_email', 'overtime_multiplier'];
const BOOL = new Set(['active', 'weekly_email']);
const NUM = new Set(['daily_rate', 'days', 'hours', 'rate', 'amount', 'lbp_amount', 'lbp_rate', 'hours_per_day', 'week_start', 'payday', 'overtime_multiplier']);
const ID_RE = /^[0-9a-f-]{36}$/;
const FOREMAN_BIZ = ['name', 'hours_per_day', 'period', 'week_start', 'lang'];
const FOREMAN_WORKER = ['id', 'name', 'trade', 'phone', 'active'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));

function b64(str) {
  const bytes = enc.encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256);
  return b64u(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function cookieHeader(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function readCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return m ? m[1] : null;
}

async function throttle(env, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT hits, window_start FROM throttle WHERE key = ?').bind(key).first();
  if (!row || now - row.window_start > windowSec) {
    await env.DB.prepare('INSERT INTO throttle (key, hits, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = 1, window_start = excluded.window_start').bind(key, now).run();
    return;
  }
  if (row.hits >= limit) throw new HttpError(429, 'Too many attempts. Try again later.');
  await env.DB.prepare('UPDATE throttle SET hits = hits + 1 WHERE key = ?').bind(key).run();
}

async function readBody(req) {
  if (!(req.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'JSON required');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 512 * 1024) throw new HttpError(413, 'Too large');
  try { return await req.json(); } catch { throw new HttpError(400, 'Bad JSON'); }
}

function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Invalid email');
  return e;
}

function checkPassword(v) {
  const p = String(v || '');
  if (p.length < 10 || p.length > 128) throw new HttpError(400, 'Password must be 10–128 characters');
  return p;
}

async function createSession(env, userId) {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now + SESSION_DAYS * 864e5, now).run();
  return cookieHeader(token, SESSION_DAYS * 86400);
}

async function currentUser(req, env) {
  const token = readCookie(req);
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT s.user_id, s.expires_at, u.email, m.owner_id, m.role
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN members m ON m.user_id = u.id WHERE s.token_hash = ?`)
    .bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.user_id, email: row.email, owner: row.owner_id || row.user_id, role: row.role || 'owner' };
}

function clean(kind, body, partial) {
  const spec = TABLES[kind];
  const out = {};
  for (const f of spec.fields) {
    if (!(f in body)) continue;
    let v = body[f];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (BOOL.has(f)) v = v ? 1 : 0;
      else if (NUM.has(f)) { v = Number(v); if (!Number.isFinite(v)) throw new HttpError(400, `Invalid ${f}`); }
      else if (typeof v !== 'string') throw new HttpError(400, `Invalid ${f}`);
      else v = v.trim();
      if ((f === 'worker_id' || f === 'site_id') && !ID_RE.test(v)) throw new HttpError(400, `Invalid ${f}`);
    }
    out[f] = v;
  }
  if (!partial) for (const f of spec.required) if (out[f] == null) throw new HttpError(400, `Missing ${f}`);
  return out;
}

const pickKeys = (r, keys) => Object.fromEntries(keys.filter(k => k in r).map(k => [k, r[k]]));

function shape(r, user) {
  if (!r) return r;
  if ('active' in r) r.active = !!r.active;
  if ('weekly_email' in r) r.weekly_email = !!r.weekly_email;
  delete r.owner_id;
  if (user?.role === 'foreman' && 'status' in r) { delete r.rate; delete r.amount; }
  return r;
}

function insertRow(env, owner, kind, data, upsertDay) {
  const id = crypto.randomUUID();
  const cols = ['id', 'owner_id', ...Object.keys(data)];
  const vals = [id, owner, ...Object.values(data)];
  let sql = `INSERT INTO ${kind} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  if (upsertDay) {
    const upd = Object.keys(data).filter(k => !['worker_id', 'day'].includes(k)).map(k => `${k} = excluded.${k}`).join(', ');
    sql += ` ON CONFLICT(worker_id, day) DO UPDATE SET ${upd} WHERE ${kind}.owner_id = excluded.owner_id`;
  }
  return env.DB.prepare(sql + ' RETURNING *').bind(...vals);
}

async function workerRates(env, owner, ids) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const { results } = await env.DB.prepare(`SELECT id, daily_rate FROM workers WHERE owner_id = ? AND id IN (${uniq.map(() => '?').join(',')})`).bind(owner, ...uniq).all();
  return new Map(results.map(r => [r.id, r.daily_rate]));
}

async function prepareEntries(env, user, rows) {
  const rates = await workerRates(env, user.owner, rows.map(r => r.worker_id));
  return rows.map(r => {
    if (!rates.has(r.worker_id)) throw new HttpError(400, 'Invalid worker_id');
    if (user.role === 'foreman' || r.rate == null) r.rate = rates.get(r.worker_id);
    return r;
  });
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function sendMail(env, to, subject, text, html, attachments) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, 'Email is not set up');
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'Worksite <onboarding@resend.dev>', to: [to], subject, text, html, attachments })
    });
  } catch {
    throw new HttpError(502, 'Email could not be sent');
  }
  if (!res.ok) { console.error('resend', res.status, await res.text()); throw new HttpError(502, 'Email could not be sent'); }
}

const mailWrap = body => `<div style="font-family:system-ui,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">${body}</div>`;

async function sendRelease(env, rel) {
  const items = rel.items.map(i => i.en);
  const url = env.APP_URL || '';
  const text = `Worksite ${rel.version} is live (${rel.date}).\n\nWhat's new:\n${items.map(i => `- ${i}`).join('\n')}\n\nOpen the app: ${url}\n`;
  const html = mailWrap(`<h2 style="margin:0 0 4px">Worksite ${esc(rel.version)} is live</h2>
<p style="margin:0 0 16px;color:#555">${esc(rel.date)}</p>
<p style="margin:0 0 8px"><b>What's new</b></p>
<ul style="margin:0 0 16px;padding-left:20px">${items.map(i => `<li style="margin-bottom:6px">${esc(i)}</li>`).join('')}</ul>
<p><a href="${esc(url)}" style="display:inline-block;background:#e8890c;color:#1a1000;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open Worksite</a></p>`);
  await sendMail(env, env.ADMIN_EMAIL, `Worksite ${rel.version} – what's new`, text, html);
  await env.DB.prepare("INSERT INTO release_notices (version, sent_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(version) DO UPDATE SET sent_at = excluded.sent_at").bind(rel.version).run();
}

async function notifyLatest(env) {
  const rel = CHANGELOG[0];
  if (!rel || !env.RESEND_API_KEY || !env.ADMIN_EMAIL) return;
  const done = await env.DB.prepare('SELECT 1 FROM release_notices WHERE version = ?').bind(rel.version).first();
  if (!done) await sendRelease(env, rel);
}

function localDate(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

function isoMinus(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function csvOf(rows) {
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

async function ownerData(env, owner) {
  const q = t => env.DB.prepare(`SELECT * FROM ${t} WHERE owner_id = ?`).bind(owner);
  const [biz, workers, sites, entries, payments, adjustments, site_txns] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM business WHERE owner_id = ?').bind(owner), q('workers'), q('sites'), q('entries'), q('payments'), q('adjustments'), q('site_txns')
  ]);
  return { biz: biz.results[0], workers: workers.results, sites: sites.results, entries: entries.results, payments: payments.results, adjustments: adjustments.results, site_txns: site_txns.results };
}

const adjSigned = a => a.kind === 'deduction' ? -a.amount : a.amount;

async function sendWeekly(env, owner, email, today) {
  const d = await ownerData(env, owner);
  const from = isoMinus(today, 6);
  const inWeek = day => day >= from && day <= today;
  const wName = id => d.workers.find(w => w.id === id)?.name || '?';
  const sName = id => d.sites.find(s => s.id === id)?.name || '';
  const rows = d.workers.map(w => {
    const es = d.entries.filter(e => e.worker_id === w.id), ps = d.payments.filter(p => p.worker_id === w.id), as = d.adjustments.filter(a => a.worker_id === w.id);
    const earnedAll = es.reduce((s, e) => s + e.amount, 0) + as.reduce((s, a) => s + adjSigned(a), 0);
    const paidAll = ps.reduce((s, p) => s + p.amount, 0);
    const weekEarned = es.filter(e => inWeek(e.day)).reduce((s, e) => s + e.amount, 0) + as.filter(a => inWeek(a.day)).reduce((s, a) => s + adjSigned(a), 0);
    const weekDays = es.filter(e => inWeek(e.day) && e.status === 'worked').reduce((s, e) => s + e.days, 0);
    return { name: w.name, weekDays, weekEarned, balance: earnedAll - paidAll };
  }).filter(r => r.weekEarned || Math.abs(r.balance) > 0.009).sort((a, b) => b.balance - a.balance);
  const owed = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const weekCost = rows.reduce((s, r) => s + r.weekEarned, 0);

  const csvRows = [['type', 'date', 'worker', 'site', 'kind', 'days', 'hours', 'rate_usd', 'amount_usd', 'currency', 'lbp_amount', 'lbp_rate', 'method', 'note']];
  d.entries.forEach(e => csvRows.push(['work', e.day, wName(e.worker_id), sName(e.site_id), e.status, e.days, e.hours, e.rate, e.amount, 'USD', '', '', '', e.note]));
  d.payments.forEach(p => csvRows.push(['payment', p.paid_on, wName(p.worker_id), '', p.kind, '', '', '', p.amount, p.currency, p.lbp_amount, p.lbp_rate, p.method, p.note]));
  d.adjustments.forEach(a => csvRows.push(['adjustment', a.day, wName(a.worker_id), '', a.kind, '', a.hours, '', adjSigned(a), 'USD', '', '', '', a.note]));
  d.site_txns.forEach(x => csvRows.push(['site', x.day, '', sName(x.site_id), x.kind, '', '', '', x.amount, x.currency, x.lbp_amount, x.lbp_rate, x.category, x.note]));
  const body = csvRows.slice(1).sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  const table = rows.map(r => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(r.name)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${r.weekDays}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${money(r.weekEarned)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${money(r.balance)}</td></tr>`).join('');
  const html = mailWrap(`<h2 style="margin:0 0 4px">Payday – ${esc(d.biz?.name || 'Worksite')}</h2>
<p style="margin:0 0 16px;color:#555">${esc(from)} → ${esc(today)}</p>
<p style="margin:0 0 4px">Labour cost this week: <b>${money(weekCost)}</b></p>
<p style="margin:0 0 16px">Total you still owe: <b>${money(owed)}</b></p>
${rows.length ? `<table style="border-collapse:collapse;font-size:15px"><tr><th style="text-align:left;padding:6px 10px">Worker</th><th style="padding:6px 10px">Days</th><th style="padding:6px 10px">This week</th><th style="padding:6px 10px">Balance</th></tr>${table}</table>` : '<p>No activity this week.</p>'}
<p style="margin:16px 0 0;color:#555">A full backup of your data is attached (CSV).</p>`);
  const text = `Payday – ${d.biz?.name || 'Worksite'} (${from} → ${today})\nLabour cost this week: ${money(weekCost)}\nTotal you still owe: ${money(owed)}\n\n${rows.map(r => `${r.name}: ${r.weekDays} days, ${money(r.weekEarned)} this week, balance ${money(r.balance)}`).join('\n')}\n\nFull backup attached (CSV).`;
  await sendMail(env, email, `Payday ${today} – you owe ${money(owed)}`, text, html, [{ filename: `worksite-backup-${today}.csv`, content: b64(csvOf([csvRows[0], ...body])) }]);
  await env.DB.prepare("INSERT INTO weekly_reports (owner_id, week, sent_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(owner, today).run();
}

async function weeklyReports(env) {
  if (!env.RESEND_API_KEY) return;
  const { iso, dow } = localDate();
  const { results } = await env.DB.prepare(`SELECT b.owner_id, u.email FROM business b JOIN users u ON u.id = b.owner_id
    WHERE b.weekly_email = 1 AND b.payday = ? AND NOT EXISTS (SELECT 1 FROM weekly_reports r WHERE r.owner_id = b.owner_id AND r.week = ?)`).bind(dow, iso).all();
  for (const r of results) {
    const allowed = env.MAIL_ANY === 'true' || (env.ADMIN_EMAIL && r.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());
    if (!allowed) continue;
    try { await sendWeekly(env, r.owner_id, r.email, iso); } catch (err) { console.error('weekly', r.owner_id, err?.message); }
  }
}

const ownerOnly = user => { if (user.role !== 'owner') throw new HttpError(403, 'Not allowed'); };

async function api(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method;

  if (method !== 'GET') {
    const origin = req.headers.get('origin');
    if (!origin || origin !== url.origin) throw new HttpError(403, 'Bad origin');
  }

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';

  if (path === '/api/signup' && method === 'POST') {
    await throttle(env, `signup:${ip}`, 5, 3600);
    const b = await readBody(req);
    const email = cleanEmail(b.email), password = checkPassword(b.password);
    const code = String(b.invite || '').trim();
    let invite = null;
    if (code) {
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) throw new HttpError(400, 'Invalid invite code');
      invite = await env.DB.prepare('SELECT code_hash, owner_id, role, expires_at FROM invites WHERE code_hash = ?').bind(await sha256(code)).first();
      if (!invite || invite.expires_at < Date.now()) throw new HttpError(400, 'Invalid or expired invite code');
    } else if (env.ALLOW_SIGNUP !== 'true') {
      throw new HttpError(403, 'Sign-ups are closed. Ask for an invite code.');
    }
    const salt = randomToken(16);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare('INSERT INTO users (id, email, pw_hash, pw_salt, pw_iter) VALUES (?, ?, ?, ?, ?)')
        .bind(id, email, await pbkdf2(password, salt, PBKDF2_ITER), salt, PBKDF2_ITER).run();
    } catch {
      throw new HttpError(409, 'Account already exists. Sign in instead.');
    }
    if (invite) {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO members (user_id, owner_id, role) VALUES (?, ?, ?)').bind(id, invite.owner_id, invite.role),
        env.DB.prepare('DELETE FROM invites WHERE code_hash = ?').bind(invite.code_hash)
      ]);
    } else {
      await env.DB.prepare("INSERT INTO business (owner_id, lang) VALUES (?, 'ar')").bind(id).run();
    }
    return json({ email }, 201, { 'set-cookie': await createSession(env, id) });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const email = cleanEmail(b.email);
    await throttle(env, `login:${ip}`, 30, 900);
    await throttle(env, `login:${email}`, 8, 900);
    const u = await env.DB.prepare('SELECT id, pw_hash, pw_salt, pw_iter FROM users WHERE email = ?').bind(email).first();
    const hash = await pbkdf2(String(b.password || ''), u?.pw_salt || 'x'.repeat(22), u?.pw_iter || PBKDF2_ITER);
    if (!u || !safeEqual(hash, u.pw_hash)) throw new HttpError(401, 'Wrong email or password');
    await env.DB.prepare('DELETE FROM throttle WHERE key = ?').bind(`login:${email}`).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(u.id, Date.now()).run();
    return json({ email }, 200, { 'set-cookie': await createSession(env, u.id) });
  }

  if (path === '/api/logout' && method === 'POST') {
    const token = readCookie(req);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });
  }

  if (path === '/api/changelog' && method === 'GET') return json(CHANGELOG);
  if (path === '/api/version' && method === 'GET') return json({ build: env.BUILD_ID || 'dev' });

  const user = await currentUser(req, env);
  if (path === '/api/me' && method === 'GET') return json({ user: user && { email: user.email, role: user.role } });
  if (!user) throw new HttpError(401, 'Not signed in');
  const owner = user.owner;

  if (path === '/api/password' && method === 'POST') {
    await throttle(env, `pw:${user.id}`, 5, 3600);
    const b = await readBody(req);
    const u = await env.DB.prepare('SELECT pw_hash, pw_salt, pw_iter FROM users WHERE id = ?').bind(user.id).first();
    if (!safeEqual(await pbkdf2(String(b.current || ''), u.pw_salt, u.pw_iter), u.pw_hash)) throw new HttpError(401, 'Current password is wrong');
    const password = checkPassword(b.password);
    const salt = randomToken(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?').bind(await pbkdf2(password, salt, PBKDF2_ITER), salt, PBKDF2_ITER, user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)
    ]);
    return json({ ok: true }, 200, { 'set-cookie': await createSession(env, user.id) });
  }

  if (path === '/api/data' && method === 'GET') {
    const d = await ownerData(env, owner);
    if (user.role === 'foreman') {
      return json({
        role: 'foreman',
        biz: pickKeys(d.biz || {}, FOREMAN_BIZ),
        workers: d.workers.map(w => shape(pickKeys(w, FOREMAN_WORKER))),
        sites: d.sites.map(s => shape(pickKeys(s, ['id', 'name', 'location', 'active']))),
        entries: d.entries.map(e => shape(e, user)),
        payments: [], adjustments: [], site_txns: []
      });
    }
    return json({
      role: 'owner',
      biz: shape(d.biz) || {},
      workers: d.workers.map(r => shape(r)), sites: d.sites.map(r => shape(r)), entries: d.entries.map(r => shape(r)),
      payments: d.payments.map(r => shape(r)), adjustments: d.adjustments.map(r => shape(r)), site_txns: d.site_txns.map(r => shape(r))
    });
  }

  if (path === '/api/biz' && method === 'PUT') {
    ownerOnly(user);
    const b = await readBody(req);
    const data = {};
    for (const f of BIZ_FIELDS) if (f in b) {
      if (BOOL.has(f)) data[f] = b[f] ? 1 : 0;
      else if (NUM.has(f)) { data[f] = Number(b[f]); if (!Number.isFinite(data[f])) throw new HttpError(400, `Invalid ${f}`); }
      else data[f] = String(b[f] ?? '').trim();
    }
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to save');
    const row = await env.DB.prepare(`UPDATE business SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE owner_id = ? RETURNING *`)
      .bind(...keys.map(k => data[k]), owner).first();
    return json(shape(row));
  }

  if (path === '/api/invites' && method === 'POST') {
    ownerOnly(user);
    await throttle(env, `invite:${user.id}`, 10, 86400);
    const code = randomToken(9);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM invites WHERE owner_id = ? AND expires_at < ?').bind(owner, now),
      env.DB.prepare("INSERT INTO invites (code_hash, owner_id, role, expires_at, created_at) VALUES (?, ?, 'foreman', ?, ?)").bind(await sha256(code), owner, now + INVITE_DAYS * 864e5, now)
    ]);
    return json({ code, expires_at: now + INVITE_DAYS * 864e5 }, 201);
  }

  if (path === '/api/members' && method === 'GET') {
    ownerOnly(user);
    const { results } = await env.DB.prepare('SELECT m.user_id AS id, u.email, m.role, m.created_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.owner_id = ? ORDER BY m.created_at').bind(owner).all();
    return json(results);
  }

  const mm = path.match(/^\/api\/members\/([0-9a-f-]{36})$/);
  if (mm && method === 'DELETE') {
    ownerOnly(user);
    const res = await env.DB.prepare('DELETE FROM users WHERE id = ? AND id IN (SELECT user_id FROM members WHERE owner_id = ?)').bind(mm[1], owner).run();
    if (!res.meta.changes) throw new HttpError(404, 'Not found');
    return json({ ok: true });
  }

  const m = path.match(/^\/api\/(workers|sites|entries|payments|adjustments|site_txns)(?:\/([0-9a-f-]{36}|bulk))?$/);
  if (!m) throw new HttpError(404, 'Not found');
  const [, kind, id] = m;
  if (kind !== 'entries') ownerOnly(user);

  if (method === 'POST' && id === 'bulk') {
    if (kind !== 'entries') throw new HttpError(404, 'Not found');
    const b = await readBody(req);
    if (!Array.isArray(b) || b.length > 500) throw new HttpError(400, 'Bad list');
    if (!b.length) return json([]);
    const rows = await prepareEntries(env, user, b.map(r => clean(kind, r)));
    const res = await env.DB.batch(rows.map(r => insertRow(env, owner, kind, r, true)));
    return json(res.flatMap(r => r.results).map(r => shape(r, user)));
  }

  if (method === 'POST' && !id) {
    let data = clean(kind, await readBody(req));
    if (kind === 'entries') [data] = await prepareEntries(env, user, [data]);
    const row = await insertRow(env, owner, kind, data, kind === 'entries').first();
    if (!row) throw new HttpError(409, 'Conflict');
    return json(shape(row, user), 201);
  }

  if (method === 'PUT' && id && id !== 'bulk') {
    const data = clean(kind, await readBody(req), true);
    if (user.role === 'foreman') delete data.rate;
    if (kind === 'entries' && data.worker_id) await prepareEntries(env, { ...user, role: 'owner' }, [{ ...data, rate: 0 }]);
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to save');
    const row = await env.DB.prepare(`UPDATE ${kind} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND owner_id = ? RETURNING *`)
      .bind(...keys.map(k => data[k]), id, owner).first();
    if (!row) throw new HttpError(404, 'Not found');
    return json(shape(row, user));
  }

  if (method === 'DELETE' && id && id !== 'bulk') {
    const stmts = [];
    if (kind === 'sites') stmts.push(env.DB.prepare('UPDATE entries SET site_id = NULL WHERE site_id = ? AND owner_id = ?').bind(id, owner));
    stmts.push(env.DB.prepare(`DELETE FROM ${kind} WHERE id = ? AND owner_id = ?`).bind(id, owner));
    const res = await env.DB.batch(stmts);
    if (!res.at(-1).meta.changes) throw new HttpError(404, 'Not found');
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 * * *') ctx.waitUntil(weeklyReports(env).catch(err => console.error('weekly', err?.message)));
    else ctx.waitUntil(notifyLatest(env).catch(err => console.error('notify', err?.message)));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      const msg = String(err?.message || '');
      if (/CHECK constraint|FOREIGN KEY|NOT NULL|UNIQUE/i.test(msg)) return json({ error: 'Invalid data' }, 400);
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  }
};
