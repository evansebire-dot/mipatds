'use strict';

/* ------------------------------------------------------------------ *
 *  Mipa Data Sheets — offline-first PWA
 *  Loads datasheets.json, fuzzy-searches products, opens/caches PDFs.
 * ------------------------------------------------------------------ */

const PDF_CACHE = 'mipa-pdfs-v1';        // must match sw.js
const PAGE_SIZE = 60;                    // results rendered per "page"

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
});

/* ---------------------------- boot ---------------------------- */

init().catch((err) => {
  console.error(err);
  els.status.textContent = 'Could not load the data sheet index. Check your connection and reload.';
});

async function init() {
  registerServiceWorker();

  const res = await fetch('datasheets.json', { cache: 'no-cache' });
  const data = await res.json();
  state.products = data.products || [];

  buildFuse();
  buildCategoryChips(data.categories || []);
  await refreshCachedSet();

  wireEvents();
  render();
  setupInstall();
  renderFooter(data);
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
    btn.addEventListener('click', () => downloadScope([...files.keys()], btn, prog, bar));
    els.offlineList.appendChild(row);
  }

  showStorage();
}

async function downloadScope(files, btn, prog, bar) {
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
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
    });
  }
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
  const count = data.count || state.products.length;
  let ver = '', built = '';
  try {
    const v = await (await fetch('version.json', { cache: 'no-cache' })).json();
    if (v.version) ver = 'v' + v.version;
    if (v.builtAt) built = fmtDate(v.builtAt);
  } catch (_) { /* version.json absent (e.g. local dev) — skip software line */ }

  const title = ['mipa Data Sheets', ver].filter(Boolean).join(' ');
  const bits = [];
  if (built) bits.push('released ' + built);
  bits.push('catalog updated ' + catalog);
  bits.push(count + ' products');
  els.appFooter.innerHTML =
    `<div class="ftr-title">${esc(title)}</div><div>${esc(bits.join(' · '))}</div>`;
}

function fmtDate(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
