import { CHANGELOG } from './changelog.js';
import { sendPush, vapidKeys } from './push.js';
import { cleanPdf, renderPdf } from './pdf.js';

const COOKIE = '__Host-ws_session';
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const INVITE_DAYS = 7;
const TZ = 'Asia/Beirut';
const enc = new TextEncoder();

const TABLES = {
  workers: { fields: ['name', 'phone', 'trade', 'daily_rate', 'active', 'notes', 'assigned_to'], required: ['name'] },
  sites: { fields: ['name', 'location', 'client', 'active'], required: ['name'] },
  entries: { fields: ['worker_id', 'site_id', 'day', 'status', 'days', 'hours', 'rate', 'note'], required: ['worker_id', 'day'] },
  payments: { fields: ['worker_id', 'paid_on', 'kind', 'amount', 'currency', 'lbp_amount', 'lbp_rate', 'method', 'note'], required: ['worker_id', 'paid_on', 'amount'] },
  adjustments: { fields: ['worker_id', 'day', 'kind', 'amount', 'hours', 'note'], required: ['worker_id', 'day', 'kind', 'amount'] },
  site_txns: { fields: ['site_id', 'day', 'kind', 'category', 'amount', 'currency', 'lbp_amount', 'lbp_rate', 'note'], required: ['site_id', 'day', 'kind', 'amount'] }
};
const BIZ_FIELDS = ['name', 'lbp_rate', 'hours_per_day', 'period', 'week_start', 'lang', 'payday', 'weekly_email', 'overtime_multiplier', 'phone', 'website'];
const BOOL = new Set(['active', 'weekly_email']);
const NUM = new Set(['daily_rate', 'days', 'hours', 'rate', 'amount', 'lbp_amount', 'lbp_rate', 'hours_per_day', 'week_start', 'payday', 'overtime_multiplier']);
const ID_RE = /^[0-9a-f-]{36}$/;
const FOREMAN_BIZ = ['name', 'hours_per_day', 'period', 'week_start', 'lang'];
const FOREMAN_WORKER = ['id', 'name', 'trade', 'phone', 'active', 'assigned_to'];
const METHODS = ['cash', 'transfer', 'whish', 'omt', 'other'];
const DATE_RE = /^\d{4}-[01]\d-[0-3]\d$/;
const LOCKED = 'Already paid. Only the administrator can change it.';
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];
const STATUS_AR = { worked: 'حاضر', planned: 'مخطط', absent: 'غائب' };
const STATUS_EN = { worked: 'worked', planned: 'planned', absent: 'absent' };

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
  return { id: row.user_id, email: row.email, owner: row.owner_id || row.user_id, role: row.role || 'owner', primary: !row.owner_id };
}

export function normPhone(v) {
  let d = String(v || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('961') && d.length >= 10) { d = d.slice(3); if (d.length === 7) d = '0' + d; }
  if (d.length < 6 || d.length > 15) throw new HttpError(400, 'Invalid phone number');
  return d;
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
      if ((f === 'worker_id' || f === 'site_id' || f === 'assigned_to') && !ID_RE.test(v)) throw new HttpError(400, `Invalid ${f}`);
    }
    out[f] = v;
  }
  if (kind === 'workers' && 'phone' in out) out.phone = normPhone(out.phone);
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

const isAdmin = (env, user) => !!(user && env.ADMIN_EMAIL && user.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());

function logIt(env, ctx, user, owner, action, kind, rowId, detail, ip) {
  let d = detail == null ? null : JSON.stringify(detail);
  if (d && d.length > 4000) d = d.slice(0, 3990) + '…';
  ctx.waitUntil(env.DB.prepare('INSERT INTO audit (owner_id, user_id, email, action, kind, row_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(owner ?? null, user?.id ?? null, user?.email ?? null, action, kind ?? null, rowId ?? null, d, ip ?? null).run()
    .catch(err => console.error('audit', err?.message)));
}

async function teamOf(env, owner) {
  const [p, m] = await env.DB.batch([
    env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(owner),
    env.DB.prepare('SELECT m.user_id AS id, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.owner_id = ? ORDER BY m.created_at').bind(owner)
  ]);
  return [...p.results.map(r => ({ ...r, role: 'main' })), ...m.results];
}

async function checkAssignee(env, owner, id) {
  if (!id) return;
  const team = await teamOf(env, owner);
  if (!team.some(m => m.id === id)) throw new HttpError(400, 'Invalid assigned_to');
}

const visibleTo = (user, w) => user.role !== 'foreman' || !w.assigned_to || w.assigned_to === user.id;

async function guard(env, user, owner, kind, id, op, admin) {
  const row = await env.DB.prepare(`SELECT * FROM ${kind} WHERE id = ? AND owner_id = ?`).bind(id, owner).first();
  if (!row) throw new HttpError(404, 'Not found');
  if (kind === 'entries' && user.role === 'foreman') {
    const w = await env.DB.prepare('SELECT assigned_to FROM workers WHERE id = ? AND owner_id = ?').bind(row.worker_id, owner).first();
    if (!w || !visibleTo(user, w)) throw new HttpError(403, 'Not allowed');
    if (row.del_by) throw new HttpError(409, 'Waiting for the owner to approve the deletion');
  }
  if (admin) return row;
  if ((kind === 'entries' || kind === 'adjustments') && row.paid_by) throw new HttpError(423, LOCKED);
  if (kind === 'payments' && row.until) throw new HttpError(423, LOCKED);
  if (kind === 'workers' && op === 'delete') {
    const paid = await env.DB.prepare('SELECT 1 FROM entries WHERE worker_id = ? AND owner_id = ? AND paid_by IS NOT NULL LIMIT 1').bind(id, owner).first();
    if (paid) throw new HttpError(423, 'This worker has paid days. Only the administrator can delete them.');
  }
  return row;
}

async function removeEntries(env, user, owner, ids, admin) {
  if (!ids.length) return { deleted: [], pending: [] };
  const q = ids.map(() => '?').join(',');
  if (user.role === 'foreman') {
    const { results } = await env.DB.prepare(`UPDATE entries SET del_by = ?, del_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE owner_id = ? AND id IN (${q}) AND paid_by IS NULL AND del_by IS NULL
      AND worker_id IN (SELECT id FROM workers WHERE owner_id = ? AND (assigned_to IS NULL OR assigned_to = ?)) RETURNING *`)
      .bind(user.id, owner, ...ids, owner, user.id).all();
    return { deleted: [], pending: results };
  }
  const { results } = await env.DB.prepare(`DELETE FROM entries WHERE owner_id = ? AND id IN (${q})${admin ? '' : ' AND paid_by IS NULL'} RETURNING *`).bind(owner, ...ids).all();
  return { deleted: results, pending: [] };
}

function insertRow(env, owner, kind, data, upsertDay, clientId, admin) {
  const id = clientId && ID_RE.test(clientId) ? clientId : crypto.randomUUID();
  const cols = ['id', 'owner_id', ...Object.keys(data)];
  const vals = [id, owner, ...Object.values(data)];
  let sql = `INSERT INTO ${kind} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  if (upsertDay) {
    const upd = Object.keys(data).filter(k => !['worker_id', 'day'].includes(k)).map(k => `${k} = excluded.${k}`).join(', ');
    const where = `${kind}.owner_id = excluded.owner_id${admin ? '' : ` AND ${kind}.paid_by IS NULL`}`;
    sql += ` ON CONFLICT(id) DO UPDATE SET ${upd}, del_by = NULL, del_at = NULL WHERE ${where} AND ${kind}.worker_id = excluded.worker_id AND ${kind}.day = excluded.day`;
    sql += ` ON CONFLICT(worker_id, day) DO UPDATE SET ${upd}, del_by = NULL, del_at = NULL WHERE ${where}`;
  } else sql += ' ON CONFLICT(id) DO NOTHING';
  return env.DB.prepare(sql + ' RETURNING *').bind(...vals);
}

async function workerRates(env, owner, ids) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const { results } = await env.DB.prepare(`SELECT id, daily_rate, assigned_to FROM workers WHERE owner_id = ? AND id IN (${uniq.map(() => '?').join(',')})`).bind(owner, ...uniq).all();
  return new Map(results.map(r => [r.id, r]));
}

async function prepareEntries(env, user, rows) {
  const rates = await workerRates(env, user.owner, rows.map(r => r.worker_id));
  return rows.map(r => {
    const w = rates.get(r.worker_id);
    if (!w) throw new HttpError(400, 'Invalid worker_id');
    if (!visibleTo(user, w)) throw new HttpError(403, 'This worker is assigned to someone else');
    if (user.role === 'foreman' || r.rate == null) r.rate = w.daily_rate;
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
      body: JSON.stringify({ from: env.MAIL_FROM || 'Yawmiyyeh <onboarding@resend.dev>', to: [to], subject, text, html, attachments })
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
  const text = `Yawmiyyeh ${rel.version} is live (${rel.date}).\n\nWhat's new:\n${items.map(i => `- ${i}`).join('\n')}\n\nOpen the app: ${url}\n`;
  const html = mailWrap(`<h2 style="margin:0 0 4px">Yawmiyyeh ${esc(rel.version)} is live</h2>
<p style="margin:0 0 16px;color:#555">${esc(rel.date)}</p>
<p style="margin:0 0 8px"><b>What's new</b></p>
<ul style="margin:0 0 16px;padding-left:20px">${items.map(i => `<li style="margin-bottom:6px">${esc(i)}</li>`).join('')}</ul>
<p><a href="${esc(url)}" style="display:inline-block;background:#e8890c;color:#1a1000;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open Worksite</a></p>`);
  await sendMail(env, env.ADMIN_EMAIL, `Yawmiyyeh ${rel.version} – what's new`, text, html);
  await env.DB.prepare("INSERT INTO release_notices (version, sent_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(version) DO UPDATE SET sent_at = excluded.sent_at").bind(rel.version).run();
}

async function notifyLatest(env) {
  const rel = CHANGELOG[0];
  if (!rel || !env.RESEND_API_KEY || !env.ADMIN_EMAIL) return;
  const done = await env.DB.prepare('SELECT 1 FROM release_notices WHERE version = ?').bind(rel.version).first();
  if (!done) await sendRelease(env, rel);
}

function cleanDoc(body) {
  const str = (v, max) => String(v ?? '').slice(0, max);
  const title = str(body.title, 160).trim();
  if (!title) throw new HttpError(400, 'Missing title');
  const c = body.content && typeof body.content === 'object' ? body.content : {};
  const hd = c.header && typeof c.header === 'object' ? c.header : {};
  const sections = Array.isArray(c.sections) ? c.sections.slice(0, 40) : [];
  const content = {
    header: { company: str(hd.company, 160), subtitle: str(hd.subtitle, 240), phones: str(hd.phones, 120), website: str(hd.website, 120) },
    sections: sections.map(sec => ({
      title: str(sec?.title, 200),
      kind: ['numbered', 'notes', 'text'].includes(sec?.kind) ? sec.kind : 'numbered',
      items: (Array.isArray(sec?.items) ? sec.items.slice(0, 100) : []).map(it => ({ text: str(it?.text, 2000) }))
    }))
  };
  const json = JSON.stringify(content);
  if (json.length > 100000) throw new HttpError(413, 'Document too large');
  return { title, content: json };
}

const docOut = r => r && { id: r.id, title: r.title, content: JSON.parse(r.content), created_at: r.created_at, updated_at: r.updated_at };

async function ownerIds(env, owner) {
  const { results } = await env.DB.prepare("SELECT user_id FROM members WHERE owner_id = ? AND role = 'owner'").bind(owner).all();
  return [owner, ...results.map(r => r.user_id)];
}

async function inviteFor(env, code) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) throw new HttpError(400, 'Invalid invite code');
  const invite = await env.DB.prepare('SELECT code_hash, owner_id, role, expires_at FROM invites WHERE code_hash = ?').bind(await sha256(code)).first();
  if (!invite || invite.expires_at < Date.now()) throw new HttpError(400, 'Invalid or expired invite code');
  return invite;
}

async function notifyAttendance(env, user, rows) {
  const worked = rows.filter(r => r && r.status);
  if (!worked.length) return;
  const biz = await env.DB.prepare('SELECT lang FROM business WHERE owner_id = ?').bind(user.owner).first();
  const ar = (biz?.lang || 'ar') === 'ar';
  const ids = [...new Set(worked.map(r => r.worker_id))];
  const { results: ws } = await env.DB.prepare(`SELECT id, name FROM workers WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(user.owner, ...ids).all();
  const sIds = [...new Set(worked.map(r => r.site_id).filter(Boolean))];
  const ss = sIds.length ? (await env.DB.prepare(`SELECT id, name FROM sites WHERE owner_id = ? AND id IN (${sIds.map(() => '?').join(',')})`).bind(user.owner, ...sIds).all()).results : [];
  const wn = id => ws.find(w => w.id === id)?.name || '?';
  const sn = id => ss.find(x => x.id === id)?.name;
  const label = r => `${wn(r.worker_id)}: ${(ar ? STATUS_AR : STATUS_EN)[r.status] || r.status}${r.status === 'worked' && r.days !== 1 ? ` (${r.days})` : ''}${sn(r.site_id) ? ` · ${sn(r.site_id)}` : ''}`;
  const body = worked.length === 1 ? label(worked[0]) : `${worked.slice(0, 4).map(label).join('\n')}${worked.length > 4 ? `\n+${worked.length - 4}` : ''}`;
  await sendPush(env, await ownerIds(env, user.owner), { title: ar ? `تحديث الحضور من رئيس الورشة (${worked[0].day})` : `Foreman update (${worked[0].day})`, body, url: '/' });
}

async function notifyDeleteRequest(env, user, n) {
  const biz = await env.DB.prepare('SELECT lang FROM business WHERE owner_id = ?').bind(user.owner).first();
  const ar = (biz?.lang || 'ar') === 'ar';
  await sendPush(env, await ownerIds(env, user.owner), ar
    ? { title: 'طلب حذف بانتظار الموافقة', body: `${user.email}: ${n}`, url: '/' }
    : { title: 'Deletion waiting for your approval', body: `${user.email}: ${n}`, url: '/' });
}

async function owedByOwner(env, owner) {
  const r = await env.DB.prepare(`SELECT
    (SELECT COALESCE(SUM(amount),0) FROM entries WHERE owner_id = ?1)
    + (SELECT COALESCE(SUM(CASE WHEN kind = 'deduction' THEN -amount ELSE amount END),0) FROM adjustments WHERE owner_id = ?1)
    - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE owner_id = ?1) AS owed`).bind(owner).first();
  return r?.owed || 0;
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
  const html = mailWrap(`<h2 style="margin:0 0 4px">Payday – ${esc(d.biz?.name || 'Yawmiyyeh')}</h2>
<p style="margin:0 0 16px;color:#555">${esc(from)} → ${esc(today)}</p>
<p style="margin:0 0 4px">Labour cost this week: <b>${money(weekCost)}</b></p>
<p style="margin:0 0 16px">Total you still owe: <b>${money(owed)}</b></p>
${rows.length ? `<table style="border-collapse:collapse;font-size:15px"><tr><th style="text-align:left;padding:6px 10px">Worker</th><th style="padding:6px 10px">Days</th><th style="padding:6px 10px">This week</th><th style="padding:6px 10px">Balance</th></tr>${table}</table>` : '<p>No activity this week.</p>'}
<p style="margin:16px 0 0;color:#555">A full backup of your data is attached (CSV).</p>`);
  const text = `Payday – ${d.biz?.name || 'Yawmiyyeh'} (${from} → ${today})\nLabour cost this week: ${money(weekCost)}\nTotal you still owe: ${money(owed)}\n\n${rows.map(r => `${r.name}: ${r.weekDays} days, ${money(r.weekEarned)} this week, balance ${money(r.balance)}`).join('\n')}\n\nFull backup attached (CSV).`;
  await sendMail(env, email, `Payday ${today} – you owe ${money(owed)}`, text, html, [{ filename: `worksite-backup-${today}.csv`, content: b64(csvOf([csvRows[0], ...body])) }]);
  await env.DB.prepare("INSERT INTO weekly_reports (owner_id, week, sent_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(owner, today).run();
}

async function paydayPush(env) {
  const { iso, dow } = localDate();
  const { results } = await env.DB.prepare(`SELECT b.owner_id, b.lang FROM business b WHERE b.payday = ?
    AND EXISTS (SELECT 1 FROM push_subs p WHERE p.user_id = b.owner_id)
    AND NOT EXISTS (SELECT 1 FROM weekly_reports r WHERE r.owner_id = b.owner_id AND r.week = ?)`).bind(dow, 'push:' + iso).all();
  for (const r of results) {
    const owed = await owedByOwner(env, r.owner_id);
    const ar = (r.lang || 'ar') === 'ar';
    await sendPush(env, await ownerIds(env, r.owner_id), ar
      ? { title: 'اليوم يوم الدفع', body: owed > 0.009 ? `المستحق للعمّال: ${money(owed)}` : 'لا يوجد مبلغ مستحق للعمّال', url: '/' }
      : { title: 'Payday today', body: owed > 0.009 ? `You owe ${money(owed)} to your workers` : 'Nothing owed', url: '/' });
    await env.DB.prepare("INSERT INTO weekly_reports (owner_id, week, sent_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT DO NOTHING").bind(r.owner_id, 'push:' + iso).run();
  }
}

async function weeklyReports(env) {
  await env.DB.prepare("DELETE FROM audit WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-365 days')").run().catch(() => {});
  await paydayPush(env).catch(err => console.error('payday push', err?.message));
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

async function api(req, env, url, ctx) {
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
      invite = await inviteFor(env, code);
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
    logIt(env, ctx, { id, email }, invite?.owner_id || id, 'signup', null, null, invite ? { role: invite.role } : null, ip);
    return json({ email }, 201, { 'set-cookie': await createSession(env, id) });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const email = cleanEmail(b.email);
    await throttle(env, `login:${ip}`, 30, 900);
    await throttle(env, `login:${email}`, 8, 900);
    const u = await env.DB.prepare('SELECT id, pw_hash, pw_salt, pw_iter FROM users WHERE email = ?').bind(email).first();
    const hash = await pbkdf2(String(b.password || ''), u?.pw_salt || 'x'.repeat(22), u?.pw_iter || PBKDF2_ITER);
    if (!u || !safeEqual(hash, u.pw_hash)) { logIt(env, ctx, { id: u?.id, email }, null, 'login_failed', null, null, null, ip); throw new HttpError(401, 'Wrong email or password'); }
    logIt(env, ctx, { id: u.id, email }, null, 'login', null, null, null, ip);
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
  if (path === '/api/me' && method === 'GET') return json({ user: user && { email: user.email, role: user.role, primary: user.primary } });
  if (!user) throw new HttpError(401, 'Not signed in');
  const owner = user.owner;
  const admin = isAdmin(env, user);
  const log = (action, kind, rowId, detail) => logIt(env, ctx, user, owner, action, kind, rowId, detail, ip);

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

  if (path === '/api/push/key' && method === 'GET') return json({ key: (await vapidKeys(env)).pub });

  if (path === '/api/push/subscribe' && method === 'POST') {
    const b = await readBody(req);
    let host;
    try { const u = new URL(String(b.endpoint || '')); if (u.protocol !== 'https:') throw 0; host = u.hostname; } catch { throw new HttpError(400, 'Invalid endpoint'); }
    if (!PUSH_HOSTS.some(re => re.test(host))) throw new HttpError(400, 'Unsupported push service');
    const p256dh = String(b.keys?.p256dh || ''), auth = String(b.keys?.auth || '');
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw new HttpError(400, 'Invalid keys');
    await throttle(env, `pushsub:${user.id}`, 20, 3600);
    await env.DB.prepare(`INSERT INTO push_subs (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).bind(crypto.randomUUID(), user.id, b.endpoint, p256dh, auth).run();
    return json({ ok: true }, 201);
  }

  if (path === '/api/push/unsubscribe' && method === 'POST') {
    const b = await readBody(req);
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(String(b.endpoint || ''), user.id).run();
    return json({ ok: true });
  }

  if (path === '/api/push/test' && method === 'POST') {
    await throttle(env, `pushtest:${user.id}`, 5, 3600);
    await sendPush(env, [user.id], { title: 'Yawmiyyeh', body: '✓', url: '/' });
    return json({ ok: true });
  }

  if (path === '/api/pdf' && method === 'POST') {
    ownerOnly(user);
    if (!env.BROWSER) throw new HttpError(503, 'PDF service is not available');
    await throttle(env, `pdf:${user.id}`, 40, 3600);
    const doc = cleanPdf(await readBody(req));
    let pdf;
    try { pdf = await renderPdf(env, doc); }
    catch (err) { console.error('pdf', err?.message); throw new HttpError(503, /429|limit/i.test(String(err?.message)) ? 'PDF limit reached for today' : 'PDF could not be created'); }
    const name = doc.title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || 'Yawmiyyeh';
    return new Response(pdf, { headers: {
      'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`
    } });
  }

  const dm = path.match(/^\/api\/docs(?:\/([0-9a-f-]{36}))?$/);
  if (dm) {
    ownerOnly(user);
    const id = dm[1];
    if (method === 'POST' && !id) {
      const d = cleanDoc(await readBody(req));
      const row = await env.DB.prepare('INSERT INTO docs (id, owner_id, title, content) VALUES (?, ?, ?, ?) RETURNING *').bind(crypto.randomUUID(), owner, d.title, d.content).first();
      return json(docOut(row), 201);
    }
    if (method === 'PUT' && id) {
      const d = cleanDoc(await readBody(req));
      const row = await env.DB.prepare("UPDATE docs SET title = ?, content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND owner_id = ? RETURNING *").bind(d.title, d.content, id, owner).first();
      if (!row) throw new HttpError(404, 'Not found');
      return json(docOut(row));
    }
    if (method === 'DELETE' && id) {
      const res = await env.DB.prepare('DELETE FROM docs WHERE id = ? AND owner_id = ?').bind(id, owner).run();
      if (!res.meta.changes) throw new HttpError(404, 'Not found');
      return json({ ok: true });
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (path === '/api/data' && method === 'GET') {
    const d = await ownerData(env, owner);
    if (user.role === 'foreman') {
      const ws = d.workers.filter(w => visibleTo(user, w));
      const ids = new Set(ws.map(w => w.id));
      return json({
        role: 'foreman', me: user.id,
        biz: pickKeys(d.biz || {}, FOREMAN_BIZ),
        workers: ws.map(w => shape(pickKeys(w, FOREMAN_WORKER))),
        sites: d.sites.map(s => shape(pickKeys(s, ['id', 'name', 'location', 'active']))),
        entries: d.entries.filter(e => ids.has(e.worker_id)).map(e => shape(e, user)),
        payments: [], adjustments: [], site_txns: []
      });
    }
    return json({
      role: 'owner',
      primary: user.primary, me: user.id, admin,
      team: await teamOf(env, owner),
      biz: shape(d.biz) || {},
      workers: d.workers.map(r => shape(r)), sites: d.sites.map(r => shape(r)), entries: d.entries.map(r => shape(r)),
      payments: d.payments.map(r => shape(r)), adjustments: d.adjustments.map(r => shape(r)), site_txns: d.site_txns.map(r => shape(r)),
      docs: (await env.DB.prepare('SELECT * FROM docs WHERE owner_id = ? ORDER BY updated_at DESC').bind(owner).all()).results.map(docOut)
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
    log('update', 'business', owner, data);
    return json(shape(row));
  }

  if (path === '/api/invites' && method === 'POST') {
    ownerOnly(user);
    const b = await readBody(req);
    const role = b.role === 'owner' ? 'owner' : 'foreman';
    await throttle(env, `invite:${user.id}`, 10, 86400);
    const code = randomToken(9);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM invites WHERE owner_id = ? AND expires_at < ?').bind(owner, now),
      env.DB.prepare('INSERT INTO invites (code_hash, owner_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(await sha256(code), owner, role, now + INVITE_DAYS * 864e5, now)
    ]);
    log('invite', 'members', null, { role });
    return json({ code, role, expires_at: now + INVITE_DAYS * 864e5 }, 201);
  }

  if (path === '/api/members' && method === 'GET') {
    ownerOnly(user);
    const primary = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(owner).first();
    const { results } = await env.DB.prepare('SELECT m.user_id AS id, u.email, m.role, m.created_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.owner_id = ? ORDER BY m.role DESC, m.created_at').bind(owner).all();
    return json({ primary: primary && { id: primary.id, email: primary.email }, me: user.id, members: results });
  }

  const mm = path.match(/^\/api\/members\/([0-9a-f-]{36})$/);
  if (mm && method === 'DELETE') {
    ownerOnly(user);
    if (mm[1] === user.id) throw new HttpError(400, 'Use Leave instead');
    const res = await env.DB.prepare('DELETE FROM members WHERE user_id = ? AND owner_id = ?').bind(mm[1], owner).run();
    if (!res.meta.changes) throw new HttpError(404, 'Not found');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(mm[1]),
      env.DB.prepare("INSERT INTO business (owner_id, lang) VALUES (?, 'ar') ON CONFLICT(owner_id) DO NOTHING").bind(mm[1])
    ]);
    log('remove', 'members', mm[1], null);
    return json({ ok: true });
  }

  if (path === '/api/join' && method === 'POST') {
    await throttle(env, `join:${user.id}`, 10, 3600);
    const b = await readBody(req);
    const invite = await inviteFor(env, String(b.invite || '').trim());
    if (invite.owner_id === user.id) throw new HttpError(400, 'This is your own business');
    if (!user.primary) throw new HttpError(409, 'Leave your current team first');
    const ownTeam = await env.DB.prepare('SELECT 1 FROM members WHERE owner_id = ? LIMIT 1').bind(user.id).first();
    if (ownTeam) throw new HttpError(409, 'Remove the people in your own team first');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO members (user_id, owner_id, role) VALUES (?, ?, ?)').bind(user.id, invite.owner_id, invite.role),
      env.DB.prepare('DELETE FROM invites WHERE code_hash = ?').bind(invite.code_hash)
    ]);
    logIt(env, ctx, user, invite.owner_id, 'join', 'members', user.id, { role: invite.role }, ip);
    return json({ ok: true, role: invite.role });
  }

  if (path === '/api/leave' && method === 'POST') {
    if (user.primary) throw new HttpError(400, 'You are the main owner');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM members WHERE user_id = ?').bind(user.id),
      env.DB.prepare("INSERT INTO business (owner_id, lang) VALUES (?, 'ar') ON CONFLICT(owner_id) DO NOTHING").bind(user.id)
    ]);
    log('leave', 'members', user.id, null);
    return json({ ok: true });
  }

  if (path === '/api/settle' && method === 'POST') {
    ownerOnly(user);
    const b = await readBody(req);
    const until = String(b.until || '');
    const paidOn = b.paid_on ? String(b.paid_on) : localDate().iso;
    if (!DATE_RE.test(until) || !DATE_RE.test(paidOn)) throw new HttpError(400, 'Invalid date');
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > 200) throw new HttpError(400, 'Bad list');
    const pm = METHODS.includes(b.method) ? b.method : 'cash';
    const currency = b.currency === 'LBP' ? 'LBP' : 'USD';
    const rate = Math.round(Number(b.lbp_rate));
    if (currency === 'LBP' && !(rate > 0)) throw new HttpError(400, 'Invalid lbp_rate');
    const note = b.note == null ? null : String(b.note).trim().slice(0, 500) || null;
    const clean2 = items.map(it => {
      const amount = Math.round(Number(it.amount) * 100) / 100;
      if (!ID_RE.test(String(it.worker_id)) || !(amount > 0)) throw new HttpError(400, 'Invalid item');
      return { worker_id: String(it.worker_id), amount };
    });
    if (new Set(clean2.map(i => i.worker_id)).size !== clean2.length) throw new HttpError(400, 'Duplicate worker');
    const known = await workerRates(env, owner, clean2.map(i => i.worker_id));
    if (known.size !== clean2.length) throw new HttpError(400, 'Invalid worker_id');
    const stmts = [];
    const out = [];
    for (const it of clean2) {
      const pid = crypto.randomUUID();
      out.push({ ...it, id: pid });
      stmts.push(
        env.DB.prepare(`INSERT INTO payments (id, owner_id, worker_id, paid_on, kind, amount, currency, lbp_amount, lbp_rate, method, note, until)
          VALUES (?, ?, ?, ?, 'wage', ?, ?, ?, ?, ?, ?, ?)`).bind(pid, owner, it.worker_id, paidOn, it.amount, currency,
          currency === 'LBP' ? Math.round(it.amount * rate) : null, currency === 'LBP' ? rate : null, pm, note, until),
        env.DB.prepare("UPDATE entries SET paid_by = ? WHERE owner_id = ? AND worker_id = ? AND day <= ? AND paid_by IS NULL AND del_by IS NULL AND status = 'worked'").bind(pid, owner, it.worker_id, until),
        env.DB.prepare('UPDATE adjustments SET paid_by = ? WHERE owner_id = ? AND worker_id = ? AND day <= ? AND paid_by IS NULL').bind(pid, owner, it.worker_id, until));
    }
    await env.DB.batch(stmts);
    log('settle', 'payments', null, { until, paid_on: paidOn, currency, method: pm, items: out });
    return json({ ok: true, payments: out.length }, 201);
  }

  if (path === '/api/entries/remove' && method === 'POST') {
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))] : [];
    if (!ids.length || ids.length > 500 || !ids.every(i => ID_RE.test(i))) throw new HttpError(400, 'Bad list');
    const r = await removeEntries(env, user, owner, ids, admin);
    if (r.deleted.length) log('delete', 'entries', null, { rows: r.deleted });
    if (r.pending.length) log('delete_request', 'entries', null, { rows: r.pending });
    if (r.pending.length) ctx.waitUntil(notifyDeleteRequest(env, user, r.pending.length).catch(err => console.error('notify', err?.message)));
    return json({ deleted: r.deleted.map(x => x.id), pending: r.pending.map(x => shape(x, user)), skipped: ids.length - r.deleted.length - r.pending.length });
  }

  if (path === '/api/entries/review' && method === 'POST') {
    ownerOnly(user);
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))] : [];
    if (!ids.length || ids.length > 500 || !ids.every(i => ID_RE.test(i))) throw new HttpError(400, 'Bad list');
    const q = ids.map(() => '?').join(',');
    const sql = b.approve
      ? `DELETE FROM entries WHERE owner_id = ? AND id IN (${q}) AND del_by IS NOT NULL AND paid_by IS NULL RETURNING *`
      : `UPDATE entries SET del_by = NULL, del_at = NULL WHERE owner_id = ? AND id IN (${q}) AND del_by IS NOT NULL RETURNING *`;
    const { results } = await env.DB.prepare(sql).bind(owner, ...ids).all();
    log(b.approve ? 'delete_approved' : 'delete_rejected', 'entries', null, { rows: results });
    return json({ ids: results.map(r => r.id), rows: b.approve ? [] : results.map(r => shape(r)) });
  }

  if (path === '/api/admin/logs' && method === 'GET') {
    if (!admin) throw new HttpError(403, 'Not allowed');
    const before = Number(url.searchParams.get('before')) || 0;
    const { results } = await env.DB.prepare(`SELECT a.id, a.owner_id, a.user_id, a.email, a.action, a.kind, a.row_id, a.detail, a.ip, a.at, b.name AS biz, ou.email AS owner_email
      FROM audit a LEFT JOIN business b ON b.owner_id = a.owner_id LEFT JOIN users ou ON ou.id = a.owner_id
      WHERE (?1 = 0 OR a.id < ?1) ORDER BY a.id DESC LIMIT 100`).bind(before).all();
    const wids = new Set(), sids = new Set();
    const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (o.worker_id) wids.add(o.worker_id); if (o.site_id) sids.add(o.site_id); Object.values(o).forEach(v => typeof v === 'object' && walk(v)); };
    results.forEach(r => { try { r.detail = r.detail ? JSON.parse(r.detail) : null; } catch { } walk(r.detail); });
    const names = {};
    const look = async (t, set) => {
      const list = [...set].filter(x => ID_RE.test(x)).slice(0, 300);
      if (!list.length) return;
      const { results: rs } = await env.DB.prepare(`SELECT id, name FROM ${t} WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).all();
      rs.forEach(x => { names[x.id] = x.name; });
    };
    await look('workers', wids);
    await look('sites', sids);
    const { results: users } = await env.DB.prepare(`SELECT u.id, u.email, u.created_at, COALESCE(m.role, 'main') AS role, COALESCE(m.owner_id, u.id) AS owner_id, b.name AS biz,
      (SELECT COUNT(*) FROM workers w WHERE w.owner_id = u.id) AS workers
      FROM users u LEFT JOIN members m ON m.user_id = u.id LEFT JOIN business b ON b.owner_id = COALESCE(m.owner_id, u.id) ORDER BY u.created_at`).all();
    return json({ logs: results, names, users: before ? undefined : users });
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
    const res = await env.DB.batch(rows.map((r, i) => insertRow(env, owner, kind, r, true, b[i]?.id, admin)));
    const out = res.flatMap(r => r.results);
    log('save_many', 'entries', null, { rows: out.map(r => pickKeys(r, ['id', 'worker_id', 'site_id', 'day', 'status', 'days', 'hours'])) });
    if (user.role === 'foreman') ctx.waitUntil(notifyAttendance(env, user, out).catch(err => console.error('notify', err?.message)));
    return json(out.map(r => shape(r, user)));
  }

  if (method === 'POST' && !id) {
    const body = await readBody(req);
    let data = clean(kind, body);
    if (kind === 'entries') [data] = await prepareEntries(env, user, [data]);
    if (kind === 'workers') await checkAssignee(env, owner, data.assigned_to);
    let row = await insertRow(env, owner, kind, data, kind === 'entries', body.id, admin).first();
    if (!row && body.id && ID_RE.test(body.id)) row = await env.DB.prepare(`SELECT * FROM ${kind} WHERE id = ? AND owner_id = ?`).bind(body.id, owner).first();
    if (!row && kind === 'entries') {
      const ex = await env.DB.prepare('SELECT paid_by FROM entries WHERE owner_id = ? AND worker_id = ? AND day = ?').bind(owner, data.worker_id, data.day).first();
      if (ex?.paid_by) throw new HttpError(423, LOCKED);
    }
    if (!row) throw new HttpError(409, 'Conflict');
    log('create', kind, row.id, data);
    if (kind === 'entries' && user.role === 'foreman') ctx.waitUntil(notifyAttendance(env, user, [row]).catch(err => console.error('notify', err?.message)));
    return json(shape(row, user), 201);
  }

  if (method === 'PUT' && id && id !== 'bulk') {
    const data = clean(kind, await readBody(req), true);
    if (user.role === 'foreman') delete data.rate;
    const before = await guard(env, user, owner, kind, id, 'update', admin);
    if (kind === 'workers' && 'assigned_to' in data) await checkAssignee(env, owner, data.assigned_to);
    if (kind === 'payments' && before.until && admin) delete data.worker_id;
    if (kind === 'entries' && data.worker_id) await prepareEntries(env, user, [{ ...data, rate: 0 }]);
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to save');
    const row = await env.DB.prepare(`UPDATE ${kind} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND owner_id = ? RETURNING *`)
      .bind(...keys.map(k => data[k]), id, owner).first();
    if (!row) throw new HttpError(404, 'Not found');
    log('update', kind, id, { before: pickKeys(before, keys), after: data });
    if (kind === 'entries' && user.role === 'foreman') ctx.waitUntil(notifyAttendance(env, user, [{ ...row }]).catch(err => console.error('notify', err?.message)));
    return json(shape(row, user));
  }

  if (method === 'DELETE' && id && id !== 'bulk') {
    if (kind === 'entries') {
      const r = await removeEntries(env, user, owner, [id], admin);
      if (r.deleted.length) log('delete', 'entries', id, r.deleted[0]);
      else if (r.pending.length) {
        log('delete_request', 'entries', id, r.pending[0]);
        ctx.waitUntil(notifyDeleteRequest(env, user, 1).catch(err => console.error('notify', err?.message)));
        return json({ ok: true, pending: shape(r.pending[0], user) });
      } else await guard(env, user, owner, kind, id, 'delete', admin);
      if (!r.deleted.length) throw new HttpError(404, 'Not found');
      return json({ ok: true });
    }
    const before = await guard(env, user, owner, kind, id, 'delete', admin);
    const stmts = [];
    if (kind === 'payments' && before.until) stmts.push(
      env.DB.prepare('UPDATE entries SET paid_by = NULL WHERE paid_by = ? AND owner_id = ?').bind(id, owner),
      env.DB.prepare('UPDATE adjustments SET paid_by = NULL WHERE paid_by = ? AND owner_id = ?').bind(id, owner));
    if (kind === 'sites') stmts.push(env.DB.prepare('UPDATE entries SET site_id = NULL WHERE site_id = ? AND owner_id = ?').bind(id, owner));
    stmts.push(env.DB.prepare(`DELETE FROM ${kind} WHERE id = ? AND owner_id = ?`).bind(id, owner));
    const res = await env.DB.batch(stmts);
    if (!res.at(-1).meta.changes) throw new HttpError(404, 'Not found');
    log('delete', kind, id, before);
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 6 * * *') ctx.waitUntil(weeklyReports(env).catch(err => console.error('weekly', err?.message)));
    else ctx.waitUntil(notifyLatest(env).catch(err => console.error('notify', err?.message)));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      const msg = String(err?.message || '');
      if (/UNIQUE constraint failed: workers\.owner_id, workers\.phone/i.test(msg)) return json({ error: 'This phone number is already used by another worker' }, 409);
      if (/CHECK constraint|FOREIGN KEY|NOT NULL|UNIQUE/i.test(msg)) return json({ error: 'Invalid data' }, 400);
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  }
};
