'use strict';

/* ------------------------------------------------------------------ *
 *  Mipa Data Sheets — offline-first PWA
 *  Loads datasheets.json, fuzzy-searches products, opens/caches PDFs.
 * ------------------------------------------------------------------ */

const PDF_CACHE = 'mipa-pdfs-v1';        // must match sw.js
const PAGE_SIZE = 60;                    // results rendered per "page"

// Optional, privacy-friendly usage counts (opens / installs / active installed users).
// Set this to your GoatCounter site code (e.g. 'mipatds' for https://mipatds.goatcounter.com)
// to switch analytics ON. Leave '' to keep it fully OFF — no script is loaded and nothing is
// sent. Anonymous only: GoatCounter uses no cookies and stores no personal data (no emails).
const ANALYTICS_CODE = 'mipatds';

const state = {
  products: [],
  fuse: null,
  category: 'all',
  docType: 'all',
  query: '',
  shown: PAGE_SIZE,
  cachedFiles: new Set(),
};

const $ = (sel) => document.querySelector(sel);
const els = {
  search: $('#search'),
  clear: $('#clearSearch'),
  catFilter: $('#catFilter'),
  typeFilter: $('#typeFilter'),
  results: $('#results'),
  status: $('#statusLine'),
  showMore: $('#showMore'),
  empty: $('#empty'),
  offlineBtn: $('#offlineBtn'),
  offlinePanel: $('#offlinePanel'),
  offlineList: $('#offlineList'),
  storageInfo: $('#storageInfo'),
  closePanel: $('#closePanel'),
  installBtn: $('#installBtn'),
  installPanel: $('#installPanel'),
  closeInstall: $('#closeInstall'),
  installSteps: $('#installSteps'),
  appFooter: $('#appFooter'),
  unavailablePanel: $('#unavailablePanel'),
  unavailableList: $('#unavailableList'),
  unavailableCount: $('#unavailableCount'),
  closeUnavailable: $('#closeUnavailable'),
  unavailableCsv: $('#unavailableCsv'),
};

// Capture the browser's install prompt (Android/desktop Chrome) for the Install button.
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isStandalone()) els.installBtn.hidden = false;
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  els.installBtn.hidden = true;
  els.installPanel.hidden = true;
  track('app-installed', 'App installed');   // Android/desktop only (iOS fires no install event)
});

/* ---------------------------- boot ---------------------------- */

init().catch((err) => {
  console.error(err);
  els.status.textContent = 'Could not load the data sheet index. Check your connection and reload.';
});

async function init() {
  registerServiceWorker();
  loadAnalytics();

  const res = await fetch('datasheets.json', { cache: 'no-cache' });
  const data = await res.json();
  state.products = data.products || [];

  // Merge in any manually-added sheets (products not published on mipa.com.au).
  // These live in manual/sheets.json + manual/pdfs/ and survive every re-scrape.
  const manual = await loadManualSheets();
  const overrides = await loadOverrides();

  // Replace / hide: drop any scraped sheet an admin has hidden, or that a manual sheet
  // stands in for (its `replaces` link). Fully reversible — remove the override and the
  // online sheet reappears on the next load. Matched on the stable Mipa page link.
  const suppress = buildSuppressSet(manual, overrides);
  if (suppress.size) state.products = state.products.filter((p) => !isSuppressed(p, suppress));
  if (manual.length) state.products = state.products.concat(manual);

  buildFuse();
  buildCategoryChips(mergedCategories(data.categories || [], manual));
  await refreshCachedSet();

  wireEvents();
  render();
  setupInstall();
  renderFooter(data);
  autoSyncOffline(); // background: pull any newly-released sheets into a saved offline copy
}

// Load manually-added sheets (optional file). Tolerates absence/parse errors so the
// app still works with no manual additions. Each entry is tagged manual:true.
async function loadManualSheets() {
  try {
    const res = await fetch('manual/sheets.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.products || []).map((p) => ({ ...p, manual: true }));
  } catch (_) {
    return []; // no manual file, or invalid JSON — ignore quietly
  }
}

// Admin overrides (optional file): scraped sheets to hide from the app entirely.
// Each entry is a Mipa page link (preferred) or an exact product name. Tolerates absence.
async function loadOverrides() {
  try {
    const res = await fetch('manual/overrides.json', { cache: 'no-cache' });
    if (!res.ok) return { hidden: [] };
    const data = await res.json();
    const h = data.hidden;                                   // tolerate a single value not wrapped in an array
    return { hidden: Array.isArray(h) ? h : (h ? [h] : []) };
  } catch (_) {
    return { hidden: [] };
  }
}

// Normalise a key for matching: links compare regardless of http/https, a leading
// "www." or a trailing slash; names compare case-insensitively.
function normKey(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

// Keys to suppress = every manual sheet's `replaces` link + every hidden entry.
function buildSuppressSet(manual, overrides) {
  const set = new Set();
  for (const p of manual) if (p.replaces) set.add(normKey(p.replaces));
  for (const h of (overrides.hidden || [])) if (h) set.add(normKey(h));
  return set;
}

// A scraped product is suppressed if its page link (preferred) or its name matches.
function isSuppressed(p, set) {
  return set.has(normKey(p.source)) || set.has(normKey(p.name));
}

// Category chips = scraped categories + any new category introduced by a manual sheet.
function mergedCategories(base, manual) {
  const out = [...base];
  for (const p of manual) {
    if (p.category && !out.includes(p.category)) out.push(p.category);
  }
  return out;
}

function buildFuse() {
  state.fuse = new Fuse(state.products, {
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'group', weight: 0.2 },
      { name: 'category', weight: 0.1 },
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

function buildCategoryChips(categories) {
  const all = ['all', ...categories];
  els.catFilter.innerHTML = '';
  for (const c of all) {
    const btn = document.createElement('button');
    btn.className = 'chip' + (c === 'all' ? ' active' : '');
    btn.dataset.cat = c;
    btn.textContent = c === 'all' ? 'All categories' : c;
    els.catFilter.appendChild(btn);
  }
}

/* ---------------------------- events ---------------------------- */

function wireEvents() {
  let t;
  els.search.addEventListener('input', () => {
    clearTimeout(t);
    els.clear.hidden = !els.search.value;
    t = setTimeout(() => {
      state.query = els.search.value.trim();
      state.shown = PAGE_SIZE;
      render();
    }, 120);
  });
  els.clear.addEventListener('click', () => {
    els.search.value = '';
    els.clear.hidden = true;
    state.query = '';
    state.shown = PAGE_SIZE;
    render();
    els.search.focus();
  });

  els.catFilter.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    setActive(els.catFilter, btn);
    state.category = btn.dataset.cat;
    state.shown = PAGE_SIZE;
    render();
  });
  els.typeFilter.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    setActive(els.typeFilter, btn);
    state.docType = btn.dataset.type;
    state.shown = PAGE_SIZE;
    render();
  });

  els.showMore.addEventListener('click', () => {
    state.shown += PAGE_SIZE;
    render();
  });

  els.offlineBtn.addEventListener('click', openOfflinePanel);
  els.closePanel.addEventListener('click', () => (els.offlinePanel.hidden = true));
  els.offlinePanel.addEventListener('click', (e) => {
    if (e.target === els.offlinePanel) els.offlinePanel.hidden = true;
  });

  els.installBtn.addEventListener('click', onInstallClick);
  els.closeInstall.addEventListener('click', () => (els.installPanel.hidden = true));
  els.installPanel.addEventListener('click', (e) => {
    if (e.target === els.installPanel) els.installPanel.hidden = true;
  });

  els.closeUnavailable.addEventListener('click', () => (els.unavailablePanel.hidden = true));
  els.unavailablePanel.addEventListener('click', (e) => {
    if (e.target === els.unavailablePanel) els.unavailablePanel.hidden = true;
  });
  els.unavailableCsv.addEventListener('click', downloadUnavailableCsv);
  // footer link is injected by renderFooter(); catch its clicks here via delegation
  els.appFooter.addEventListener('click', (e) => {
    if (e.target.closest('#unavailLink')) openUnavailablePanel();
  });
}

function setActive(container, btn) {
  container.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
}

/* ---------------------------- filtering ---------------------------- */

function currentMatches() {
  let list;
  if (state.query) {
    list = state.fuse.search(state.query).map((r) => r.item);
  } else {
    list = state.products;
  }
  if (state.category !== 'all') {
    list = list.filter((p) => p.category === state.category);
  }
  if (state.docType !== 'all') {
    list = list.filter((p) => p.docs.some((d) => d.type === state.docType));
  }
  return list;
}

/* ---------------------------- render ---------------------------- */

function render() {
  const matches = currentMatches();
  const total = matches.length;
  const slice = matches.slice(0, state.shown);

  els.results.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const p of slice) frag.appendChild(renderCard(p));
  els.results.appendChild(frag);

  els.empty.hidden = total !== 0;
  els.showMore.hidden = total <= state.shown;
  els.status.textContent = total === 0
    ? ''
    : `${total} product${total === 1 ? '' : 's'}${state.query ? ' matched' : ''}` +
      (total > slice.length ? ` · showing ${slice.length}` : '');
}

function renderCard(p) {
  const li = document.createElement('li');
  li.className = 'card';

  const h3 = document.createElement('h3');
  h3.innerHTML = highlight(p.name, state.query);
  li.appendChild(h3);

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.innerHTML = `${esc(p.category)}<span class="dot">•</span>${esc(p.group)}`;
  // Link to the official Mipa product page. Doubles as the stable link an admin pastes
  // into the "replace/hide an online sheet" forms (right-click / long-press → copy link).
  if (p.source) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.textContent = '•';
    const src = document.createElement('a');
    src.className = 'src-link';
    src.href = p.source;
    src.target = '_blank';
    src.rel = 'noopener';
    src.textContent = 'Mipa page ↗';
    meta.append(dot, src);
  }
  li.appendChild(meta);

  const row = document.createElement('div');
  row.className = 'doc-row';
  const wantType = state.docType;
  const docs = p.docs
    .filter((d) => wantType === 'all' || d.type === wantType)
    .sort((a, b) => order(a.type) - order(b.type));

  for (const d of docs) row.appendChild(renderDoc(d));
  li.appendChild(row);
  return li;
}

function renderDoc(d) {
  const a = document.createElement('a');
  a.className = 'doc ' + d.type;
  a.href = d.file;
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.source = d.source;
  const langTag = d.lang && d.lang !== 'EN' && d.lang !== 'GB' ? ` <small>${esc(d.lang)}</small>` : '';
  const cached = state.cachedFiles.has(new URL(d.file, location.href).pathname);
  a.innerHTML = `${typeLabel(d.type)}${langTag}${cached ? ' <span class="cached" title="Saved offline">●</span>' : ''}`;

  // If the same-origin mirror is missing (e.g. not yet published), fall back to the source.
  a.addEventListener('click', async (e) => {
    if (state.cachedFiles.has(new URL(d.file, location.href).pathname)) return; // cached → let it open
    try {
      const head = await fetch(d.file, { method: 'HEAD' });
      if (!head.ok) { e.preventDefault(); window.open(d.source, '_blank', 'noopener'); }
    } catch (_) {
      e.preventDefault();
      window.open(d.source, '_blank', 'noopener');
    }
  });
  return a;
}

function typeLabel(t) {
  if (t === 'SDS') return 'SDS <small>Safety</small>';
  if (t === 'TDS') return 'TDS <small>Technical</small>';
  return 'Document';
}
function order(t) { return t === 'SDS' ? 0 : t === 'TDS' ? 1 : 2; }

/* ---------------------------- offline ---------------------------- */

function uniqueFiles(predicate) {
  const map = new Map(); // file -> size  (only docs actually mirrored; size is null when
  for (const p of state.products) {        // the PDF was missing/broken on Mipa's source)
    if (predicate && !predicate(p)) continue;
    for (const d of p.docs) {
      if (!d.size) continue;               // no local copy to download → online-only, skip
      if (!map.has(d.file)) map.set(d.file, d.size);
    }
  }
  return map;
}

async function refreshCachedSet() {
  state.cachedFiles = new Set();
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(PDF_CACHE);
    const keys = await cache.keys();
    for (const req of keys) state.cachedFiles.add(new URL(req.url).pathname);
  } catch (_) {}
}

async function openOfflinePanel() {
  els.offlinePanel.hidden = false;
  await refreshCachedSet();

  const categories = [...new Set(state.products.map((p) => p.category))];
  const scopes = [
    { key: 'all', name: 'Everything', sub: 'All categories', pred: null },
    ...categories.map((c) => ({ key: c, name: c, sub: null, pred: (p) => p.category === c })),
  ];

  els.offlineList.innerHTML = '';
  for (const s of scopes) {
    const files = uniqueFiles(s.pred);
    const total = files.size;
    let bytes = 0, known = 0;
    for (const sz of files.values()) { if (sz) { bytes += sz; known++; } }
    let cached = 0;
    for (const f of files.keys()) if (state.cachedFiles.has(new URL(f, location.href).pathname)) cached++;

    const sizeTxt = known
      ? `~${fmtMB(bytes * total / Math.max(known, 1))}`   // extrapolate if some sizes unknown
      : `${total} files`;
    const allCached = cached === total && total > 0;

    const row = document.createElement('div');
    row.className = 'ol-row';
    row.innerHTML = `
      <div class="ol-top">
        <div>
          <div class="ol-name">${esc(s.name)}</div>
          <div class="ol-sub">${s.sub ? esc(s.sub) + ' · ' : ''}${total} sheets · ${sizeTxt}${cached ? ` · ${cached} saved` : ''}</div>
        </div>
        <button class="ol-btn${allCached ? ' done' : ''}">${allCached ? '✓ Saved' : 'Download'}</button>
      </div>
      <div class="progress"><i></i></div>`;
    const btn = row.querySelector('.ol-btn');
    const prog = row.querySelector('.progress');
    const bar = row.querySelector('.progress > i');
    btn.addEventListener('click', () => downloadScope([...files.keys()], btn, prog, bar, s.key));
    els.offlineList.appendChild(row);
  }

  showStorage();
}

async function downloadScope(files, btn, prog, bar, scopeKey) {
  if (scopeKey) rememberOfflineScope(scopeKey); // keep this scope synced on future launches
  btn.disabled = true;
  btn.textContent = 'Downloading…';
  prog.classList.add('show');

  const cache = await caches.open(PDF_CACHE);
  let done = 0, failed = 0;
  const queue = files.slice();
  const CONCURRENCY = 6;

  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      try {
        if (await cache.match(file)) {
          state.cachedFiles.add(new URL(file, location.href).pathname);
        } else {
          const resp = await fetch(file);
          if (resp.ok) {
            await cache.put(file, resp);
            state.cachedFiles.add(new URL(file, location.href).pathname);
          } else if (resp.status !== 404) {
            failed++;                 // real error; a 404 just means it isn't in the mirror
          }
        }
      } catch (_) { failed++; }       // network error — retryable
      done++;
      bar.style.width = `${Math.round((done / files.length) * 100)}%`;
      btn.textContent = `Downloading… ${done}/${files.length}`;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  showStorage();
  render();                 // refresh the cached dots on doc buttons
  await openOfflinePanel(); // rebuild rows so the "saved" counts and button states are accurate
}

async function showStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    els.storageInfo.textContent = `Using ${fmtMB(usage)} of ${fmtMB(quota)} device storage.`;
    if (navigator.storage.persist) navigator.storage.persist();
  } catch (_) {}
}

/* ----- keep a saved offline copy current ----- */
// Remember which scopes the user downloaded; on each online launch, quietly fetch any
// newly-released sheets in those scopes so the offline copy stays up to date by itself.

function rememberOfflineScope(key) {
  const set = new Set(getOfflineScopes());
  set.add(key);
  try { localStorage.setItem('offlineScopes', JSON.stringify([...set])); } catch (_) {}
}
function getOfflineScopes() {
  try { return JSON.parse(localStorage.getItem('offlineScopes') || '[]'); } catch (_) { return []; }
}
function scopePredicate(key) {
  return key === 'all' ? null : (p) => p.category === key;
}

async function autoSyncOffline() {
  if (!navigator.onLine || !('caches' in window)) return;
  const scopes = getOfflineScopes();
  if (!scopes.length) return;                       // user never opted into offline → do nothing

  await refreshCachedSet();
  const wanted = new Set();
  for (const key of scopes) for (const f of uniqueFiles(scopePredicate(key)).keys()) wanted.add(f);
  const missing = [...wanted].filter((f) => !state.cachedFiles.has(new URL(f, location.href).pathname));
  if (!missing.length) return;                      // already up to date

  showToast(`Updating offline sheets… (${missing.length} new)`);
  const cache = await caches.open(PDF_CACHE);
  let added = 0;
  const queue = missing.slice();
  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      try {
        const resp = await fetch(file);
        if (resp.ok) {
          await cache.put(file, resp);
          state.cachedFiles.add(new URL(file, location.href).pathname);
          added++;
        }
      } catch (_) { /* offline again / transient — try next launch */ }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (added) { render(); showToast(`Offline sheets updated · +${added} new`); }
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ----------------- report: sheets unavailable offline ----------------- */
// Derived live from the same index the app already has: any doc whose PDF could not be
// mirrored (size is null → 404 on Mipa's server). Always current, no extra files.

function unavailableDocs() {
  const rows = [];
  for (const p of state.products) {
    for (const d of p.docs) {
      if (d.size == null) {
        rows.push({ category: p.category, group: p.group, name: p.name,
                    type: d.type, lang: d.lang || '', source: d.source || '' });
      }
    }
  }
  rows.sort((a, b) =>
    a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  return rows;
}

function openUnavailablePanel() {
  const rows = unavailableDocs();
  els.unavailableCount.textContent = `Currently ${rows.length}.`;
  els.unavailableList.innerHTML = '';
  if (!rows.length) {
    els.unavailableList.innerHTML = '<p class="muted">Every sheet is available — nothing missing.</p>';
    els.unavailablePanel.hidden = false;
    return;
  }
  let lastCat = null;
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    if (r.category !== lastCat) {
      lastCat = r.category;
      const h = document.createElement('div');
      h.className = 'unavail-cat';
      h.textContent = r.category;
      frag.appendChild(h);
    }
    const item = document.createElement('div');
    item.className = 'unavail-item';
    const tag = r.lang && r.lang !== 'EN' && r.lang !== 'GB' ? ` ${esc(r.lang)}` : '';
    const link = r.source
      ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">open online ↗</a>`
      : '';
    item.innerHTML =
      `<span class="ua-name">${esc(r.name)}</span>` +
      `<span class="ua-meta">${esc(r.type)}${tag}${link ? ' · ' + link : ''}</span>`;
    frag.appendChild(item);
  }
  els.unavailableList.appendChild(frag);
  els.unavailablePanel.hidden = false;
}

function downloadUnavailableCsv() {
  const rows = unavailableDocs();
  const head = ['Category', 'Group', 'Product', 'Type', 'Lang', 'URL'];
  const csv = [head, ...rows.map((r) => [r.category, r.group, r.name, r.type, r.lang, r.source])]
    .map((cols) => cols.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mipa-sheets-unavailable.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------------------------- helpers ---------------------------- */

function fmtMB(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return (mb >= 10 ? Math.round(mb) : mb.toFixed(1)) + ' MB';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(text, q) {
  if (!q) return esc(text);
  const terms = q.split(/\s+/).filter((t) => t.length >= 2).map(escapeRe);
  if (!terms.length) return esc(text);
  let out = esc(text);
  for (const term of terms) {
    out = out.replace(new RegExp('(' + term + ')', 'ig'), '<mark>$1</mark>');
  }
  return out;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------------------------- PWA plumbing ---------------------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Auto-update: when a freshly-deployed service worker takes control, reload so the
  // new app version is shown — no manual refresh needed. Skip the very first install
  // (no previous controller) so first-time visitors don't get an extra reload.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    try { sessionStorage.setItem('justUpdated', '1'); } catch (_) {} // toast after the reload
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update();
      // Re-check for a new version when the app is reopened/refocused, and hourly.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      setInterval(() => reg.update(), 60 * 60 * 1000);
    }).catch((e) => console.warn('SW registration failed', e));
  });
}

/* ---------------------------- usage analytics (optional, anonymous) ---------------------------- */
// Privacy-first counts via GoatCounter: no cookies, no personal data, no consent banner needed.
// Completely inert unless ANALYTICS_CODE is set. The script is cross-origin, so the service
// worker ignores it (its fetch handler returns early for other origins). What gets counted:
//   • page open          — GoatCounter logs this automatically on load  ("opens")
//   • run-standalone     — every launch from an installed icon           ("active installs", all OSes)
//   • app-installed      — the browser's install event                   (Android/desktop only)

function loadAnalytics() {
  if (!ANALYTICS_CODE) return;                       // analytics off → load nothing, send nothing
  window.goatcounter = window.goatcounter || {};
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', `https://${ANALYTICS_CODE}.goatcounter.com/count`);
  s.addEventListener('load', () => {                 // once loaded, log installed-app launches
    if (isStandalone()) track('run-standalone', 'Launched as installed app');
  });
  document.head.appendChild(s);
}

// Record a named event. No-op when analytics is off or not yet loaded; never throws.
function track(path, title) {
  try {
    if (ANALYTICS_CODE && window.goatcounter && window.goatcounter.count) {
      window.goatcounter.count({ path, title: title || path, event: true });
    }
  } catch (_) { /* analytics must never break the app */ }
}

/* ---------------------------- install ---------------------------- */

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

function setupInstall() {
  // Hide the button only when already running as an installed app.
  els.installBtn.hidden = isStandalone();
}

async function onInstallClick() {
  if (deferredPrompt) {                 // Android / desktop Chrome: native prompt
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice && choice.outcome === 'accepted') els.installBtn.hidden = true;
    return;
  }
  showInstallInstructions();            // iOS / no native prompt: step-by-step
}

function showInstallInstructions() {
  const steps = isIos()
    ? [
        'Make sure you are using <b>Safari</b>.',
        'Tap the <b>Share</b> button — the square with an up arrow.',
        'Scroll down and tap <b>Add to Home Screen</b>.',
        'Tap <b>Add</b>. The <b>mipa</b> icon appears on your home screen.',
      ]
    : [
        'Open the browser <b>menu</b> (⋮, top-right).',
        'Tap <b>Install app</b> (or <b>Add to Home screen</b>).',
        'Confirm <b>Install</b>. The <b>mipa</b> icon appears on your device.',
      ];
  els.installSteps.innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
  els.installPanel.hidden = false;
}

/* ---------------------------- about / version footer ---------------------------- */

async function renderFooter(data) {
  const catalog = data.generatedAt ? fmtDate(data.generatedAt) : '—';
  const count = state.products.length; // includes any manually-added sheets
  let ver = '', built = '';
  try {
    const v = await (await fetch('version.json', { cache: 'no-cache' })).json();
    if (v.version) ver = 'v' + v.version;
    if (v.builtAt) built = fmtDate(v.builtAt);
  } catch (_) { /* version.json absent (e.g. local dev) — skip software line */ }

  // If we just auto-updated to a new service worker, let the user know.
  try {
    if (sessionStorage.getItem('justUpdated')) {
      sessionStorage.removeItem('justUpdated');
      showToast(ver ? `Updated to ${ver}` : 'App updated to the latest version');
    }
  } catch (_) {}

  const title = ['mipa Data Sheets', ver].filter(Boolean).join(' ');
  const bits = [];
  if (built) bits.push('released ' + built);
  bits.push('catalog updated ' + catalog);
  bits.push(count + ' products');

  const unavailable = unavailableDocs().length;
  const reportLink = unavailable
    ? `<div><button id="unavailLink" class="link-btn">${unavailable} sheet${unavailable === 1 ? '' : 's'} unavailable offline →</button></div>`
    : '';
  // Transparency note — only shown when anonymous analytics is actually enabled.
  const privacyNote = ANALYTICS_CODE
    ? `<div class="ftr-note">Anonymous usage stats only — no cookies, no personal data.</div>`
    : '';
  els.appFooter.innerHTML =
    `<div class="ftr-title">${esc(title)}</div><div>${esc(bits.join(' · '))}</div>${reportLink}${privacyNote}`;
}

function fmtDate(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
