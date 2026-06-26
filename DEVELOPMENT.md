# mipa Data Sheets — Development & Status

> Status/handoff document. Read this first when resuming work after the customer
> feedback round. Snapshot taken: **18 Jun 2026** (last deploy), reviewed 23 Jun 2026.

---

## 1. What this is

A mobile-first **Progressive Web App (PWA)** that lets a user search Mipa Australia's
**technical (TDS)** and **safety (SDS)** data sheets and open the PDFs — online or
**fully offline**. Built for phones (installable to the home screen), but works on any
browser.

| | |
|---|---|
| **Live app** | https://evansebire-dot.github.io/mipatds/ |
| **Repository** | https://github.com/evansebire-dot/mipatds |
| **GitHub account** | `evansebire-dot` (evan.sebire@gmail.com) |
| **Hosting** | GitHub Pages, deployed by GitHub Actions |
| **Current version** | v1.0.10 (auto-incremented per deploy) |
| **Service worker cache** | `mipa-shell-v10` |
| **Catalog snapshot** | 17 Jun 2026 — **718 products**, **1,240 unique PDFs** |
| **Mirrored offline** | 1,147 PDFs (~223 MB); **95 are online-only** (404 on Mipa's site — listed in [MISSING-SHEETS.md](MISSING-SHEETS.md)) |
| **Categories** | Car Refinishing, Industry, Aerosols, Decorative |

---

## 2. Architecture

```
BUILD TIME  (PowerShell scraper, run locally or by CI)
  scraper/Crawl-Mipa.ps1
    crawls Mipa's static site 3 levels deep:
      Category page  ──prlnr*──▶  Group page  ──produkt*──▶  Product page  ──▶  PDF links
    outputs:
      app/datasheets.json   the search index (one entry per product, each with its docs)
      app/pdfs/*.pdf        a same-origin MIRROR of every PDF
                                        │  published to GitHub Pages
                                        ▼
RUNTIME  (the PWA on the phone — plain static files, no build step)
  app/index.html · app.js · style.css      single-screen UI
  vendor/fuse.basic.min.js                 fuzzy search (vendored, no CDN)
  sw.js                                    service worker: offline cache + auto-update
  manifest.webmanifest · icons/            installability + branding
```

### Why the PDFs are mirrored
Mipa's PDFs live on a **different domain** (`mipa-paints.com`) that sends **no CORS
headers**, so a browser can't fetch/cache them cross-origin. The scraper downloads
them and serves them from **our own origin**, which makes offline caching reliable.
~93 PDFs return 404 on Mipa's own site, so they can't be mirrored — those are flagged
as "online-only" (see §5).

### Why no build tooling
The dev machine had **no Node.js installed**. So the whole thing is deliberately
**zero-dependency / no-build**: a PowerShell scraper + hand-written static PWA. It runs
anywhere, hosts anywhere, and needs nothing installed.

---

## 3. Repository layout

```
mipatds/
├─ app/                          the PWA (this folder is what gets published)
│  ├─ index.html                 markup + panels (offline, install) + footer + toast
│  ├─ app.js                     search, filters, offline cache, install, auto-update, sync
│  ├─ style.css                  styling (light + dark mode)
│  ├─ sw.js                      service worker (offline cache + self-update)
│  ├─ manifest.webmanifest       PWA manifest (name "mipa", brand colours)
│  ├─ vendor/fuse.basic.min.js   vendored fuzzy-search lib
│  ├─ icons/                     icon.svg, icon-192.png, icon-512.png (mipa + TDS)
│  ├─ datasheets.json            generated search index (committed)
│  ├─ pdfs/                      generated PDF mirror — GIT-IGNORED (~223 MB)
│  └─ version.json               build stamp — GIT-IGNORED (written by CI)
├─ scraper/Crawl-Mipa.ps1        the crawler / mirror builder
├─ .github/workflows/deploy.yml  CI: scrape (when needed) + deploy to Pages
├─ README.md                     short "what is this / how to run"
└─ DEVELOPMENT.md                this file
```

---

## 4. Features

- **Fuzzy search** over product name/group/category (Fuse.js). Handles English and
  German terms (e.g. `härter`, `reiniger`) and product codes (`P 99`).
- **Filters**: category chips + document-type chips (All / SDS / TDS).
- **Open PDFs**: tap a doc badge → opens the mirrored PDF (cached if downloaded). If a
  sheet isn't mirrored, it falls back to the live Mipa link.
- **Offline (⤓ panel)**: download **Everything** or **per-category**. Cached via the
  Cache API; the service worker then serves PDFs cache-first.
- **Install button** (header): native install prompt on Android/desktop; step-by-step
  "Add to Home Screen" sheet on iOS. Hides once installed.
- **Version/catalog footer**: shows app version + release date and the catalog's
  last-updated date + product count.
- **Self-update**: a newly-deployed version installs and the app reloads itself
  automatically (no manual refresh), with an "Updated to vX" toast afterwards. Also
  re-checks on refocus and hourly.
- **Offline auto-sync**: the scopes a user downloaded are remembered; on each online
  launch any **newly-released sheets** in those scopes are fetched in the background.
- **Dark mode** supported (search text/panel pinned for contrast).
- **Manual sheets**: data sheets not published on mipa.com.au can be added under
  `app/manual/` and are merged into the app at runtime — they survive every re-scrape.
  See §5a.

---

## 5. Data & scraper details

- Crawl is 3 levels: category → group (`prlnr*.html`) → product (`produkt*.html`) → PDF
  links on `mipa-paints.com`.
- **Doc-type classification**: URL path `/sdb/` or `/usmsds/` or label "SDS/MSDS" → SDS;
  `/pi/` or "Productinfo/TDS" → TDS; everything else → "Document". (US-format MSDS are
  folded into SDS.)
- **Index shape** (`datasheets.json`): `{ generatedAt, source, categories[], count,
  products: [{ id, name, category, group, source, docs: [{ type, lang, label, file,
  source, size }] }] }`.
- **`size` is the key signal**: a doc with a numeric `size` was mirrored; a doc with
  `size: null` is **online-only** (its PDF 404s on Mipa). The app uses this to exclude
  online-only sheets from offline downloads (so there are no phantom "failures").
- Run the scraper:
  ```powershell
  ./scraper/Crawl-Mipa.ps1            # full: index + mirror all PDFs (~223 MB)
  ./scraper/Crawl-Mipa.ps1 -IndexOnly # just rebuild the index, no downloads
  ./scraper/Crawl-Mipa.ps1 -Categories car-refinishing -MaxProducts 20  # quick test
  ```

### Sheets that can't be mirrored (online-only)
95 documents (17 Jun snapshot) are linked from Mipa's pages but **404 on Mipa's own
server**, so they can't be downloaded. They're listed for the customer in
[MISSING-SHEETS.md](MISSING-SHEETS.md) (human-readable) and `MISSING-SHEETS.csv`
(spreadsheet). Regenerate after any re-scrape with:
```
python scraper/Get-MissingSheets.py   # rewrites MISSING-SHEETS.md + .csv from datasheets.json
```
The list is just every doc in `datasheets.json` whose `size` is `null`. Most have
visibly broken URLs on Mipa's site (double slashes / a stray space) — Mipa would need to
fix those at source; the app self-heals once a re-scrape finds a working file.

---

## 5a. Adding sheets manually (not on mipa.com.au)

Some sheets the customer has are **not published on Mipa's website**. These are kept
separate from the scraped catalog so a re-scrape never loses them:

```
app/manual/
  sheets.json   index entries — same shape as a datasheets.json product, tagged manual:true
  pdfs/         the committed PDF files (NOT the git-ignored app/pdfs mirror)
```

The app fetches `manual/sheets.json` at startup and **concatenates** it onto the scraped
products (`loadManualSheets()` / `mergedCategories()` in `app.js`). Manual sheets are
searchable, filterable, openable and offline-downloadable exactly like scraped ones (they
carry a real `size`, so they're included in the offline panel + auto-sync).

**Add one (recommended):**
```powershell
./scraper/Add-ManualSheet.ps1 -Pdf 'C:\path\Sheet.pdf' -Name 'Product Name' -Category 'Car Refinishing' -Type TDS
# run again with the same -Name/-Category to stack the SDS onto the same card
git add app/manual && git commit -m "Add manual sheet" && git push
```
Adding a sheet is **data only — no `SHELL_CACHE` bump needed** (the app re-fetches
`manual/sheets.json` network-first on every launch). See `app/manual/README.md`.

---

## 5b. Admin "Add a sheet" form + unavailable-sheets report

### Adding sheets from GitHub (no local tools)
Collaborators can add a sheet entirely in the browser — no PowerShell, no clone:

1. Repo → **Issues → New issue → "Add a data sheet (admins)"**.
2. Fill the form, **drag the PDF into the "PDF file" box**, submit.
3. `.github/workflows/add-sheet.yml` runs: it checks the submitter, parses the form,
   downloads the PDF, calls `Add-ManualSheet.ps1`, commits to `app/manual/`, **redeploys
   the site**, then comments and closes the issue.

**Auth model (the important part):** GitHub Pages is static and can't authenticate users,
so identity comes from **GitHub itself**. The workflow only applies a sheet when the issue
author's `author_association` is `OWNER`/`MEMBER`/`COLLABORATOR`; everyone else's issue is
auto-closed with a polite note. **You control "admins" purely by who is a repo
collaborator** (Settings → Collaborators), or a team. No separate login to manage.
- The form is *visible* to anyone (you can't hide an Issues form on a public repo) but only
  *actionable* by collaborators. To also hide it, the repo would need to be private.
- The bot's commit is pushed with `GITHUB_TOKEN`, which deliberately does **not** trigger
  `deploy.yml` — so `add-sheet.yml` runs the Pages deploy steps itself (shares the `pages`
  concurrency group so it can't clash with a normal deploy).
- Form fields are parsed from the rendered issue body by label (`### Product name`, etc.) in
  a pwsh step; the PDF is the `[name.pdf](…user-attachments…)` link GitHub inserts.

### Unavailable-sheets report (in-app)
The list of sheets that can't be downloaded (the 95) is shown **live inside the app** —
footer link **"N sheets unavailable offline →"** opens a panel grouped by category with an
"open online" link each and a **Download CSV** button. It's derived on the fly from every
doc with `size == null`, so it's always current and needs no regeneration or extra files.
The static `MISSING-SHEETS.md` / `.csv` at the repo root are a committed snapshot for
reading on GitHub (regenerate with `python scraper/Get-MissingSheets.py`).

### Versioning note
Both workflows now stamp `version.json` as `1.0.<git commit count>` (needs
`fetch-depth: 0`) instead of the per-workflow run number — so the footer version is
monotonic no matter which workflow deploys (a normal push or an add-sheet run).

---

## 6. Deployment / CI (`.github/workflows/deploy.yml`)

Triggers: **push to main**, **manual** (workflow_dispatch), **weekly cron** (Mon 15:17
UTC). Steps:
1. Checkout.
2. **Restore PDF mirror cache** (`actions/cache`, keyed on `datasheets.json` hash).
3. **Scrape** — only when it's a scheduled/manual run **or** a push with a cold cache.
   A code-only push with a warm cache **skips scraping** and deploys in ~1 min.
4. **Stamp `version.json`** (`1.0.<run_number>`, build time, commit).
5. Configure Pages → upload `app/` → deploy.

**Consequence to remember:** on a normal code push (warm cache) the scraper is skipped,
so the deployed `datasheets.json` is the **committed** one (the 17 Jun local crawl). The
catalog only refreshes from the source when a **scrape actually runs** (scheduled,
manual, or cold cache). PDFs come from the warm cache (also the 17 Jun snapshot).

### Service-worker cache versioning
`sw.js` defines `SHELL_CACHE = 'mipa-shell-vN'`. **Bump N on any change to app shell
files** (html/css/js/icons) so installed apps fetch the new worker and drop the stale
shell. The `mipa-pdfs-v1` (downloaded PDFs) and `mipa-data-v1` caches are preserved
across bumps so users don't re-download offline content.

---

## 7. How to make a change (resume checklist)

1. **Serve locally** (service workers need http, not file://):
   ```powershell
   cd app; python -m http.server 8080
   ```
   Open http://localhost:8080. (For a full local PDF mirror, run the scraper first.)
2. Edit files under `app/`.
3. If you touched shell files, **bump `SHELL_CACHE`** in `app/sw.js`.
4. Commit and push to `main` → CI deploys automatically (fast, cache-hit path).
5. Verify live: hard-refresh the app; check the footer version bumped.

> Auth for pushing: the original classic PAT was used during setup. **It should be
> revoked** (it's broad and was shared in chat). For future pushes, either run
> `gh auth login` in a terminal, or create a **fine-grained token** scoped to just the
> `mipatds` repo (Contents + Workflows: read/write).

---

## 8. Known limitations / things to revisit

- **Weekly auto-scrape works, but GitHub delays the cron.** The Mon 22 Jun `schedule` run
  *did* fire and succeed — but at **22:22 UTC, ~7h after** the `17 15 * * 1` (15:17 UTC)
  schedule. GitHub delays/queues crons set near peak UTC times. It's functioning, just not
  punctual; if a tighter window matters, move it off-peak (e.g. `37 6 * * 1`). You can always
  force an immediate refresh with a **manual run** (Actions tab → "Run workflow").
- **Home-screen icon doesn't auto-update.** App *content* self-updates, but the launcher
  tile icon is captured by the OS at install time — changing the icon needs a **reinstall**
  (platform limitation, iOS & Android).
- **~93 online-only sheets.** Those PDFs 404 on Mipa's own site, so they can't be saved
  offline; they open via the live link when online. Will self-heal if/when Mipa fixes the
  links and a re-scrape runs.
- **Public hosting.** GitHub Pages is public, so the mirrored PDFs are publicly reachable.
  Fine for public data sheets; note it if the customer wants access restricted.
- **Icon label is "TDS"** though the app also has SDS — kept per request. Alternatives
  (TDS/SDS, Data Sheets) are a ~1-min rebuild.
- **Scope = the 4 mipa.com.au categories.** Externally-hosted Master Products and Rosner
  lines are out of scope (different sites/structure).

---

## 9. Change log (commits, newest first)

```
(unpushed) Admin Add-a-sheet GitHub form + Action (collaborator-gated, auto-deploy)
(unpushed) In-app "unavailable offline" report + CSV; monotonic commit-count versioning
(unpushed) Manual-sheets support (app/manual) + MISSING-SHEETS list & generator
d98e7ec  "Updated to vX" toast after an automatic update
8335c04  Auto-update app + auto-sync newly released sheets
8ee1036  Add TDS label to the app icon
30fab74  Offline download skips sheets not in the mirror (no phantom failures)
d517f54  In-app Install button + version/catalog footer
cc97b34  Fix unreadable search text & panel in dark mode
de6b1d7  Authentic lowercase mipa wordmark icon + branding (#004F9E)
ea32efd  Bump service worker shell cache (push the panel fix to installs)
c630183  Fix offline panel never hiding; cache PDF mirror in CI
a725249  Fix scraper output path for Linux CI runners
5020ed5  Initial: scraper + PWA + CI
```

---

## 10. Pending — customer feedback

_(Capture feedback items here on return.)_

- [ ] …
