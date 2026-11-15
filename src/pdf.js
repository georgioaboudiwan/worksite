import puppeteer from '@cloudflare/puppeteer';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PRICE = /(\$\s?\d[\d,.]*|\d[\d,.]*\s?\$)/;
const rich = text => String(text || '').split(PRICE).map((p, i) => i % 2 ? `<b class="pr">${esc(p)}</b>` : esc(p)).join('');
const hasArabic = s => /[؀-ۿ]/.test(s || '');
const KINDS = ['numbered', 'notes', 'text', 'kpis', 'table'];

const str = (v, max = 2000) => String(v ?? '').slice(0, max);
const strList = (a, maxLen, maxItems) => (Array.isArray(a) ? a.slice(0, maxItems) : []).map(x => str(x, maxLen));

export function cleanPdf(body) {
  const c = body?.content && typeof body.content === 'object' ? body.content : {};
  const hd = c.header && typeof c.header === 'object' ? c.header : {};
  const sections = (Array.isArray(c.sections) ? c.sections.slice(0, 60) : []).map(s => {
    const kind = KINDS.includes(s?.kind) ? s.kind : 'numbered';
    const out = { title: str(s?.title, 200), kind };
    if (kind === 'kpis') out.items = (Array.isArray(s.items) ? s.items.slice(0, 8) : []).map(k => strList(k, 80, 3));
    else if (kind === 'table') {
      out.head = strList(s.head, 80, 8);
      out.rows = (Array.isArray(s.rows) ? s.rows.slice(0, 1000) : []).map(r => strList(r, 300, 8));
      out.foot = Array.isArray(s.foot) ? strList(s.foot, 80, 8) : null;
      out.num = (Array.isArray(s.num) ? s.num.slice(0, 8) : []).map(Number).filter(Number.isInteger);
      out.empty = str(s.empty, 80);
    } else out.items = (Array.isArray(s?.items) ? s.items.slice(0, 200) : []).map(i => ({ text: str(i?.text) }));
    return out;
  });
  return {
    title: str(body?.title, 160).trim() || 'Yawmiyyeh',
    content: { header: { company: str(hd.company, 160), subtitle: str(hd.subtitle, 240), phones: str(hd.phones, 120), website: str(hd.website, 120) }, meta: str(c.meta, 200), sections }
  };
}

function section(s) {
  const cls = i => s.num?.includes(i) ? ' class="n"' : '';
  let body;
  if (s.kind === 'notes') body = `<ul class="pd-notes">${s.items.filter(i => i.text.trim()).map(i => `<li>${rich(i.text)}</li>`).join('')}</ul>`;
  else if (s.kind === 'text') body = `<div class="pd-text">${s.items.filter(i => i.text.trim()).map(i => `<p>${rich(i.text)}</p>`).join('')}</div>`;
  else if (s.kind === 'kpis') body = `<div class="pd-kpis">${s.items.map(([l, v, tone]) => `<div class="pd-kpi ${esc(tone)}"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div>`;
  else if (s.kind === 'table') body = s.rows.length
    ? `<table class="pd-table"><thead><tr>${s.head.map((c, i) => `<th${cls(i)}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r => `<tr>${r.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>${s.foot ? `<tfoot><tr>${s.foot.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr></tfoot>` : ''}</table>`
    : `<p class="pd-empty">${esc(s.empty || '—')}</p>`;
  else body = `<ol class="pd-num">${s.items.filter(i => i.text.trim()).map((i, n) => `<li><span class="n">${n + 1}</span><span class="t">${rich(i.text)}</span></li>`).join('')}</ol>`;
  return `<section class="pd-sec">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${body}</section>`;
}

export function docHtml({ title, content }, css) {
  const hd = content.header;
  const rtl = hasArabic([hd.company, hd.subtitle, ...content.sections.map(s => s.title)].join(' '));
  const foot = [hd.website, hd.phones, hd.company].filter(Boolean).map(esc).join('  •  ');
  return `<!DOCTYPE html><html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${css}
@page { size: A4; margin: 12mm 12mm 14mm; }
html, body { margin: 0; background: #fff; }
.pdoc { max-width: none; font-size: 12.5pt; }
</style></head><body><article class="pdoc">
<header class="pd-head">${hd.company ? `<h1>${esc(hd.company)}</h1>` : ''}${hd.subtitle ? `<p class="pd-sub">${esc(hd.subtitle)}</p>` : ''}${hd.phones ? `<p class="pd-ph">☎  ${esc(hd.phones)}</p>` : ''}${hd.website ? `<p class="pd-web">${esc(hd.website)}</p>` : ''}</header>
${content.meta ? `<p class="pd-meta">${esc(content.meta)}</p>` : ''}
${content.sections.map(section).join('')}
${foot ? `<footer class="pd-foot">${foot}</footer>` : ''}
</article></body></html>`;
}

async function inlineCss(env) {
  let css = await (await env.ASSETS.fetch(new Request('https://assets/pdoc.css'))).text();
  const urls = [...new Set([...css.matchAll(/url\((fonts\/[a-z0-9-]+\.woff2)\)/g)].map(m => m[1]))];
  for (const u of urls) {
    const buf = new Uint8Array(await (await env.ASSETS.fetch(new Request(`https://assets/${u}`))).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    css = css.split(`url(${u})`).join(`url(data:font/woff2;base64,${btoa(bin)})`);
  }
  return css;
}

export async function renderPdf(env, doc) {
  const html = docHtml(doc, await inlineCss(env));
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', r => (r.url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready').catch(() => {});
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
