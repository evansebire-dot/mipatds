# Mipa Data Sheets — offline PWA

A mobile-first **Progressive Web App** for searching and viewing Mipa Australia
technical (**TDS**) and safety (**SDS**) data sheets. Type to fuzzy-search ~700
products across all four categories, tap to open the PDF, and download sheets for
**fully offline** use.

Source data: <https://www.mipa.com.au/products/technical-safety-data-sheets>

**Live app:** <https://evansebire-dot.github.io/mipatds/>
**Status / full development notes:** see [DEVELOPMENT.md](DEVELOPMENT.md).

---

## How it works

The Mipa site is static HTML with no API, and the PDFs live on a **third-party
domain** (`mipa-paints.com`) that sends **no CORS headers** — so the browser can't
fetch/cache them cross-origin. The fix:

```
BUILD TIME                          RUNTIME (phone)
scraper/Crawl-Mipa.ps1              app/  (static PWA)
  crawls Category → Group → Product   ├─ fuzzy search over datasheets.json (Fuse.js)
  → app/datasheets.json   (index)     ├─ tap a sheet → opens cached/same-origin PDF
  → app/pdfs/*.pdf        (mirror)    └─ service worker caches shell + PDFs offline
```

Mirroring the PDFs onto our **own origin** means the app loads everything
same-origin: no CORS issues, and the service worker / Cache API can store them for
offline use.

- **~718 products · ~1,240 PDFs · ~300 MB** full mirror.
- Search works offline once the app shell + index are cached (automatic on first load).
- PDFs become offline-available when viewed, or via the **⤓ Offline** panel
  (download **everything** or **per-category** — e.g. just Car Refinishing).

## Project layout

```
scraper/Crawl-Mipa.ps1     PowerShell crawler → datasheets.json + app/pdfs mirror
app/
  index.html  style.css  app.js     the PWA
  sw.js                             service worker (offline cache)
  manifest.webmanifest  icons/      installability
  vendor/fuse.basic.min.js          vendored fuzzy search (no CDN at runtime)
  datasheets.json                   generated search index
  pdfs/                             generated PDF mirror (git-ignored, ~300 MB)
.github/workflows/deploy.yml        weekly re-scrape + deploy to GitHub Pages
```

Zero runtime dependencies and **no build step** — the app is plain static files.

## Build the data (scraper)

Requires PowerShell (Windows `powershell` or cross-platform `pwsh`).

```powershell
# Full build: index + mirror every PDF into app/pdfs (~300 MB, several minutes)
./scraper/Crawl-Mipa.ps1

# Just rebuild the search index, no PDF downloads (fast):
./scraper/Crawl-Mipa.ps1 -IndexOnly

# Limit categories or product count (handy for testing):
./scraper/Crawl-Mipa.ps1 -Categories car-refinishing -MaxProducts 20
```

## Run locally

Service workers require `http://` (not `file://`):

```powershell
cd app
python -m http.server 8080
# open http://localhost:8080 on your phone (same Wi-Fi) or desktop
```

## Deploy

Push to GitHub and enable **Pages → Source: GitHub Actions**. The included
workflow re-scrapes the site (incl. the PDF mirror) and publishes `app/` weekly and
on every push. Any static host works too (Netlify, Vercel, Cloudflare Pages) — just
serve the `app/` folder after running the scraper.

## For admins — adding a sheet that isn't on Mipa's site

New to maintaining this app? Start with the short, non-technical **[Admin guide (ADMIN.md)](ADMIN.md)** —
how the app works, and how to add **and remove** sheets from the GitHub website (no tools).

Two ways to add, both keep the sheet across re-scrapes (stored in `app/manual/`, never overwritten):

- **From GitHub (no tools):** Issues → New issue → **"Add a data sheet (admins)"**, fill the
  form and **drag in the PDF**. Only repo **collaborators**' submissions are applied (identity
  comes from GitHub — manage admins under Settings → Collaborators); the rest are auto-closed.
  The site redeploys automatically. See [DEVELOPMENT.md §5b](DEVELOPMENT.md).
- **Locally:** `./scraper/Add-ManualSheet.ps1 -Pdf '…\Sheet.pdf' -Name '…' -Category '…' -Type TDS`,
  then commit `app/manual`. See [app/manual/README.md](app/manual/README.md).

**Replace or hide an online sheet:** to swap one of Mipa's own sheets for your PDF, paste that
sheet's page link into the add-sheet form's *"Replace an online sheet"* field; to hide one
outright, use the **"Hide or restore an online sheet (admins)"** form. Both are reversible (stored
as overrides in `app/manual/`). Grab a sheet's link from its card in the app (**"Mipa page ↗"**).
See [ADMIN.md](ADMIN.md#replacing-or-hiding-an-online-sheet).

**Sheets that can't be mirrored** (404 on Mipa's server, currently 95) are listed live in the
app (footer → "N sheets unavailable offline") and as a snapshot in
[MISSING-SHEETS.md](MISSING-SHEETS.md) / `.csv`.

## Notes & scope

- Covers the 4 categories on `mipa.com.au`: Car refinishing, Industry, Aerosols,
  Decorative. The externally-hosted Master Products and Rosner lines are out of scope.
- Document types: **SDS** (incl. US-format MSDS) and **TDS** (Product Info); a few
  miscellaneous docs are shown as “Document”.
- This is an **independent viewer** over Mipa's public documents; not affiliated with
  or endorsed by Mipa. PDFs remain © their respective owners.
