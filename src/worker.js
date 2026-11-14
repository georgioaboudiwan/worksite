import { CHANGELOG } from './changelog.js';

const COOKIE = '__Host-ws_session';
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const enc = new TextEncoder();

const TABLES = {
  workers: { fields: ['name', 'phone', 'trade', 'daily_rate', 'active', 'notes'], required: ['name'] },
  sites: { fields: ['name', 'location', 'active'], required: ['name'] },
  entries: { fields: ['worker_id', 'site_id', 'day', 'status', 'days', 'hours', 'rate', 'note'], required: ['worker_id', 'day'] },
  payments: { fields: ['worker_id', 'paid_on', 'amount', 'currency', 'lbp_amount', 'lbp_rate', 'method', 'note'], required: ['worker_id', 'paid_on', 'amount'] }
};
const BIZ_FIELDS = ['name', 'lbp_rate', 'hours_per_day', 'period', 'week_start', 'lang'];
const BOOL = new Set(['active']);
const NUM = new Set(['daily_rate', 'days', 'hours', 'rate', 'amount', 'lbp_amount', 'lbp_rate', 'hours_per_day', 'week_start']);
const ID_RE = /^[0-9a-f-]{36}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));

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
  const row = await env.DB.prepare('SELECT s.user_id, s.expires_at, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.user_id, email: row.email };
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

const shape = (kind, r) => {
  if (!r) return r;
  if ('active' in r) r.active = !!r.active;
  delete r.owner_id;
  return r;
};

async function insertRow(env, uid, kind, data, upsertDay) {
  const id = crypto.randomUUID();
  const cols = ['id', 'owner_id', ...Object.keys(data)];
  const vals = [id, uid, ...Object.values(data)];
  let sql = `INSERT INTO ${kind} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  if (upsertDay) {
    const upd = Object.keys(data).filter(k => !['worker_id', 'day'].includes(k)).map(k => `${k} = excluded.${k}`).join(', ');
    sql += ` ON CONFLICT(worker_id, day) DO UPDATE SET ${upd} WHERE ${kind}.owner_id = excluded.owner_id`;
  }
  return env.DB.prepare(sql + ' RETURNING *').bind(...vals);
}

const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function releaseEmail(rel, appUrl) {
  const items = rel.items.map(i => i.en);
  const text = `Worksite ${rel.version} is live (${rel.date}).\n\nWhat's new:\n${items.map(i => `- ${i}`).join('\n')}\n\nOpen the app: ${appUrl}\n`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111">
<h2 style="margin:0 0 4px">Worksite ${esc(rel.version)} is live</h2>
<p style="margin:0 0 16px;color:#555">${esc(rel.date)}</p>
<p style="margin:0 0 8px"><b>What's new</b></p>
<ul style="margin:0 0 16px;padding-left:20px">${items.map(i => `<li style="margin-bottom:6px">${esc(i)}</li>`).join('')}</ul>
<p><a href="${esc(appUrl)}" style="display:inline-block;background:#e8890c;color:#1a1000;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open Worksite</a></p>
</div>`;
  return { subject: `Worksite ${rel.version} – what's new`, text, html };
}

async function sendRelease(env, rel) {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL) throw new HttpError(503, 'Email is not set up');
  const mail = releaseEmail(rel, env.APP_URL || '');
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'Worksite <onboarding@resend.dev>', to: [env.ADMIN_EMAIL], subject: mail.subject, text: mail.text, html: mail.html })
    });
  } catch {
    throw new HttpError(502, 'Email could not be sent');
  }
  if (!res.ok) { console.error('resend', res.status, await res.text()); throw new HttpError(502, 'Email could not be sent'); }
  await env.DB.prepare("INSERT INTO release_notices (version, sent_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(version) DO UPDATE SET sent_at = excluded.sent_at").bind(rel.version).run();
}

async function notifyLatest(env) {
  const rel = CHANGELOG[0];
  if (!rel || !env.RESEND_API_KEY || !env.ADMIN_EMAIL) return;
  const done = await env.DB.prepare('SELECT 1 FROM release_notices WHERE version = ?').bind(rel.version).first();
  if (!done) await sendRelease(env, rel);
}

async function api(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method;

  if (method !== 'GET') {
    const origin = req.headers.get('origin');
    if (!origin || origin !== url.origin) throw new HttpError(403, 'Bad origin');
  }

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';

  if (path === '/api/signup' && method === 'POST') {
    if (env.ALLOW_SIGNUP !== 'true') throw new HttpError(403, 'Sign-ups are closed');
    await throttle(env, `signup:${ip}`, 5, 3600);
    const b = await readBody(req);
    const email = cleanEmail(b.email), password = checkPassword(b.password);
    const salt = randomToken(16);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare('INSERT INTO users (id, email, pw_hash, pw_salt, pw_iter) VALUES (?, ?, ?, ?, ?)')
        .bind(id, email, await pbkdf2(password, salt, PBKDF2_ITER), salt, PBKDF2_ITER).run();
    } catch {
      throw new HttpError(409, 'Account already exists. Sign in instead.');
    }
    await env.DB.prepare("INSERT INTO business (owner_id, lang) VALUES (?, 'ar')").bind(id).run();
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

  const user = await currentUser(req, env);
  if (path === '/api/me' && method === 'GET') return json({ user });
  if (path === '/api/changelog' && method === 'GET') return json(CHANGELOG);
  if (path === '/api/version' && method === 'GET') return json({ build: env.BUILD_ID || 'dev' });
  if (!user) throw new HttpError(401, 'Not signed in');
  const uid = user.id;

  if (path === '/api/password' && method === 'POST') {
    await throttle(env, `pw:${uid}`, 5, 3600);
    const b = await readBody(req);
    const u = await env.DB.prepare('SELECT pw_hash, pw_salt, pw_iter FROM users WHERE id = ?').bind(uid).first();
    if (!safeEqual(await pbkdf2(String(b.current || ''), u.pw_salt, u.pw_iter), u.pw_hash)) throw new HttpError(401, 'Current password is wrong');
    const password = checkPassword(b.password);
    const salt = randomToken(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?').bind(await pbkdf2(password, salt, PBKDF2_ITER), salt, PBKDF2_ITER, uid),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid)
    ]);
    return json({ ok: true }, 200, { 'set-cookie': await createSession(env, uid) });
  }

  if (path === '/api/data' && method === 'GET') {
    const q = t => env.DB.prepare(`SELECT * FROM ${t} WHERE owner_id = ?`).bind(uid);
    const [biz, workers, sites, entries, payments] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM business WHERE owner_id = ?').bind(uid), q('workers'), q('sites'), q('entries'), q('payments')
    ]);
    return json({
      biz: shape('biz', biz.results[0]) || {},
      workers: workers.results.map(r => shape('workers', r)),
      sites: sites.results.map(r => shape('sites', r)),
      entries: entries.results.map(r => shape('entries', r)),
      payments: payments.results.map(r => shape('payments', r))
    });
  }

  if (path === '/api/biz' && method === 'PUT') {
    const b = await readBody(req);
    const data = {};
    for (const f of BIZ_FIELDS) if (f in b) {
      data[f] = NUM.has(f) || f === 'lbp_rate' ? Number(b[f]) : String(b[f] ?? '').trim();
      if (typeof data[f] === 'number' && !Number.isFinite(data[f])) throw new HttpError(400, `Invalid ${f}`);
    }
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to save');
    const row = await env.DB.prepare(`UPDATE business SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE owner_id = ? RETURNING *`)
      .bind(...keys.map(k => data[k]), uid).first();
    return json(shape('biz', row));
  }

  const m = path.match(/^\/api\/(workers|sites|entries|payments)(?:\/([0-9a-f-]{36}|bulk))?$/);
  if (!m) throw new HttpError(404, 'Not found');
  const [, kind, id] = m;

  if (method === 'POST' && id === 'bulk') {
    if (kind !== 'entries') throw new HttpError(404, 'Not found');
    const b = await readBody(req);
    if (!Array.isArray(b) || b.length > 500) throw new HttpError(400, 'Bad list');
    const stmts = await Promise.all(b.map(r => insertRow(env, uid, kind, clean(kind, r), true)));
    if (!stmts.length) return json([]);
    const res = await env.DB.batch(stmts);
    return json(res.flatMap(r => r.results).map(r => shape(kind, r)));
  }

  if (method === 'POST' && !id) {
    const data = clean(kind, await readBody(req));
    const row = await (await insertRow(env, uid, kind, data, kind === 'entries')).first();
    if (!row) throw new HttpError(409, 'Conflict');
    return json(shape(kind, row), 201);
  }

  if (method === 'PUT' && id && id !== 'bulk') {
    const data = clean(kind, await readBody(req), true);
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to save');
    const row = await env.DB.prepare(`UPDATE ${kind} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND owner_id = ? RETURNING *`)
      .bind(...keys.map(k => data[k]), id, uid).first();
    if (!row) throw new HttpError(404, 'Not found');
    return json(shape(kind, row));
  }

  if (method === 'DELETE' && id && id !== 'bulk') {
    const stmts = [];
    if (kind === 'sites') stmts.push(env.DB.prepare('UPDATE entries SET site_id = NULL WHERE site_id = ? AND owner_id = ?').bind(id, uid));
    stmts.push(env.DB.prepare(`DELETE FROM ${kind} WHERE id = ? AND owner_id = ?`).bind(id, uid));
    const res = await env.DB.batch(stmts);
    if (!res.at(-1).meta.changes) throw new HttpError(404, 'Not found');
    return json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(notifyLatest(env).catch(err => console.error('notify', err?.message)));
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
