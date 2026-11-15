const enc = new TextEncoder();

export const b64u = buf => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const unb64u = s => {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export async function vapidKeys(env) {
  const row = await env.DB.prepare("SELECT value FROM app_keys WHERE name = 'vapid'").first();
  if (row) return JSON.parse(row.value);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const keys = { jwk, pub };
  await env.DB.prepare("INSERT INTO app_keys (name, value) VALUES ('vapid', ?) ON CONFLICT(name) DO NOTHING").bind(JSON.stringify(keys)).run();
  const saved = await env.DB.prepare("SELECT value FROM app_keys WHERE name = 'vapid'").first();
  return JSON.parse(saved.value);
}

async function vapidAuth(keys, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.pub}`;
}

export async function encrypt(sub, payload, salt = crypto.getRandomValues(new Uint8Array(16)), serverKeys) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const as = serverKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function sendPush(env, userIds, message) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  const { results } = await env.DB.prepare(`SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  if (!results.length) return;
  const keys = await vapidKeys(env);
  const subject = env.ADMIN_EMAIL ? `mailto:${env.ADMIN_EMAIL}` : (env.APP_URL || 'mailto:admin@example.com');
  const payload = JSON.stringify(message);
  await Promise.all(results.map(async s => {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { authorization: await vapidAuth(keys, s.endpoint, subject), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal' },
        body: await encrypt(s, payload)
      });
      if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(s.id).run();
      else if (!res.ok) console.error('push', res.status, await res.text());
    } catch (err) {
      console.error('push', err?.message);
    }
  }));
}
