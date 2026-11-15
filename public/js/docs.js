import { h } from './util.js';

const PRICE = /(\$\s?\d[\d,.]*|\d[\d,.]*\s?\$)/;
const hasArabic = s => /[؀-ۿ]/.test(s || '');

export function rich(text) {
  return String(text || '').split(PRICE).map((part, i) => i % 2 ? h('b', { class: 'pr' }, part) : part);
}

export function docDir(content) {
  const hd = content.header || {};
  const sample = [hd.company, hd.subtitle, ...(content.sections || []).map(s => s.title)].join(' ');
  return hasArabic(sample) ? 'rtl' : 'ltr';
}

function section(sec) {
  const items = (sec.items || []).filter(i => String(i.text ?? '').trim() || sec.kind === 'table' || sec.kind === 'kpis');
  let body;
  if (sec.kind === 'notes') body = h('ul', { class: 'pd-notes' }, items.map(i => h('li', null, rich(i.text))));
  else if (sec.kind === 'text') body = h('div', { class: 'pd-text' }, items.map(i => h('p', null, rich(i.text))));
  else if (sec.kind === 'kpis') body = h('div', { class: 'pd-kpis' }, sec.items.map(([label, value, tone]) => h('div', { class: 'pd-kpi ' + (tone || '') }, h('small', null, label), h('b', null, value))));
  else if (sec.kind === 'table') body = sec.rows.length
    ? h('table', { class: 'pd-table' },
      h('thead', null, h('tr', null, sec.head.map((c, i) => h('th', { class: sec.num?.includes(i) ? 'n' : '' }, c)))),
      h('tbody', null, sec.rows.map(r => h('tr', null, r.map((c, i) => h('td', { class: sec.num?.includes(i) ? 'n' : '' }, c))))),
      sec.foot && h('tfoot', null, h('tr', null, sec.foot.map((c, i) => h('td', { class: sec.num?.includes(i) ? 'n' : '' }, c)))))
    : h('p', { class: 'pd-empty' }, sec.empty || '—');
  else body = h('ol', { class: 'pd-num' }, items.map((i, n) => h('li', null, h('span', { class: 'n' }, n + 1), h('span', { class: 't' }, rich(i.text)))));
  return h('section', { class: 'pd-sec' }, sec.title && h('h2', null, sec.title), body);
}

export function renderDoc(content) {
  const hd = content.header || {};
  const foot = [hd.website, hd.phones, hd.company].filter(Boolean).join('  •  ');
  return h('article', { class: 'pdoc', dir: docDir(content), lang: docDir(content) === 'rtl' ? 'ar' : 'en' },
    h('header', { class: 'pd-head' },
      hd.company && h('h1', null, hd.company),
      hd.subtitle && h('p', { class: 'pd-sub' }, hd.subtitle),
      hd.phones && h('p', { class: 'pd-ph' }, '☎  ', hd.phones),
      hd.website && h('p', { class: 'pd-web' }, hd.website)),
    content.meta && h('p', { class: 'pd-meta' }, content.meta),
    (content.sections || []).map(section),
    foot && h('footer', { class: 'pd-foot' }, foot));
}

export function printDoc(content, title) {
  let host = document.getElementById('print-root');
  if (!host) { host = h('div', { id: 'print-root' }); document.body.append(host); }
  host.replaceChildren(renderDoc(content));
  const prev = document.title;
  document.title = String(title || 'Yawmiyyeh').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Yawmiyyeh';
  const done = () => { document.title = prev; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
