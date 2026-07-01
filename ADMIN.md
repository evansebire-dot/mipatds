# Admin guide — Mipa Data Sheets

A short, practical guide for whoever maintains the app. No coding needed for the
day-to-day tasks here — everything can be done from the GitHub website.

- **Live app:** <https://evansebire-dot.github.io/mipatds/>
- **Repo:** the GitHub project that holds this app.
- For deeper technical detail see [DEVELOPMENT.md](DEVELOPMENT.md); for the full
  feature overview see [README.md](README.md).

---

## How the app works (the 60-second version)

- It's a **search-and-view app for Mipa's TDS/SDS data sheets** that runs in a web
  browser and can be "installed" on a phone. It also works **offline** once a sheet
  has been opened or downloaded.
- A **scraper runs every week** on GitHub. It visits mipa.com.au, rebuilds the list
  of ~700 products, mirrors their PDFs, and republishes the app automatically. So
  **anything new on Mipa's website shows up on its own** within a week — you don't
  have to do anything for those.
- A small number of sheets (currently ~95) are **listed on Mipa's site but the PDF
  link is broken**, so they can't be mirrored. The app shows these under the footer
  link *"N sheets unavailable offline"*; a snapshot is in
  [MISSING-SHEETS.md](MISSING-SHEETS.md).
- For sheets **not on Mipa's website at all** (e.g. supplied directly by the
  customer), an admin can **add them by hand**. These live in a separate
  `app/manual/` area that the weekly scraper **never overwrites**, so your manual
  additions are safe across re-scrapes.
- An admin can also **replace** one of Mipa's own online sheets with a better PDF, or
  **hide** one that's wrong — both fully reversible. See *Replacing or hiding an
  online sheet* below.

**Who is an admin?** Anyone added to the repo under **Settings → Collaborators**.
Only collaborators can add, replace, or hide sheets via the forms (GitHub checks who
you are when you submit). Everyone else can still use the app — they just can't change
it.

---

## Adding a new PDF

### Option A — from GitHub, no tools (recommended)

1. In the repo, go to the **Issues** tab → **New issue**.
2. Choose **"Add a data sheet (admins)"**.
3. Fill in the **Product name**, pick a **Category** and **Document type**
   (TDS = technical, SDS = safety), and **drag the PDF into the "PDF file" box**.
4. **Submit.** A robot does the rest: it checks you're a collaborator, files the
   PDF, and republishes the app. Within a minute it comments **✅ Added…** and
   closes the issue. Reopen the app to see the new sheet.

If you're *not* a collaborator, the robot politely closes the issue without adding
anything — nothing breaks.

> To put **both** a TDS and an SDS on the same product card, submit the form twice
> with the **exact same Product name and Category**, once per PDF.

### Option B — locally with the script (for developers)

```powershell
./scraper/Add-ManualSheet.ps1 -Pdf 'C:\path\to\Sheet.pdf' `
    -Name 'Mipa Special Clear 2K' -Category 'Car Refinishing' -Type TDS
git add app/manual
git commit -m "Add manual sheet: Mipa Special Clear 2K"
git push        # deploys automatically
```

See [app/manual/README.md](app/manual/README.md) for all options.

---

## Removing a sheet later

The common case: **you added a sheet by hand, and later Mipa publishes it on their
website too.** The next weekly scrape picks up Mipa's copy automatically, so now the
app shows **two** of the same thing — the scraped one and your manual one. Delete
your manual copy and the scraped one remains.

This works because manual sheets are the only ones an admin "owns" — they live in
`app/manual/`. (The scraped catalogue is rebuilt from scratch every week, so it
isn't edited by hand; see the note at the bottom.)

### Remove a manual sheet — from GitHub, no tools

1. In the repo, open the file **`app/manual/sheets.json`**.
2. Click the **pencil (Edit)** icon.
3. Find the product block with the matching `"name"` and **delete that whole block**
   — everything from its opening `{` to its closing `}` (and the trailing comma if
   it isn't the last one). It looks like this:

   ```json
   {
     "id": "m1",
     "name": "Mipa Special Clear 2K",
     "category": "Car Refinishing",
     "group": "Manual additions",
     "manual": true,
     "docs": [
       { "type": "TDS", "lang": "EN", "label": "TDS",
         "file": "manual/pdfs/SpecialClear.pdf", "source": "", "size": 254310 }
     ]
   }
   ```

   To remove **only one document** (say the TDS) but keep the product, delete just
   that one `{ … }` inside the `"docs": [ … ]` list instead.
4. **Commit** the change (to `main`). The app redeploys automatically.
5. *(Optional tidy-up)* Open `app/manual/pdfs/`, click the now-unused PDF (the file
   named in the `"file"` line you removed), and delete it the same way. The app
   works fine either way — this just keeps the folder clean.

If you remove the **last** manual sheet, `"products"` should simply read `[]`:

```json
{ "note": "…", "products": [] }
```

### Remove a manual sheet — locally

Edit `app/manual/sheets.json` (remove the product block), optionally delete the PDF
from `app/manual/pdfs/`, then:

```powershell
git add app/manual
git commit -m "Remove manual sheet: Mipa Special Clear 2K"
git push        # deploys automatically
```

---

## Replacing or hiding an online sheet

Sometimes one of Mipa's own (online) sheets is wrong, out of date, or you have a
better PDF. You can **replace** it with your own PDF, or **hide** it entirely — and
**undo either later**. Nothing is deleted; these are reversible overrides that the
weekly scrape leaves alone.

> **First, grab the sheet's link.** Open the app, find the sheet, and on its card
> tap/click **"Mipa page ↗"** → copy the link. (Right-click → *Copy link* on a
> computer; long-press → *Copy* on a phone.) That link is how you point at the exact
> online sheet.

### Replace an online sheet with your own PDF

Use the normal **"Add a data sheet (admins)"** form, and in the new field
**"Replace an online sheet (optional)"** paste that sheet's link. The app then hides
Mipa's version and shows your PDF in its place. The robot replies confirming which
online sheet it hid.

**To go back to the online version:** remove your manual sheet (see *Removing a sheet
later* above). The moment your sheet is gone, Mipa's original reappears on its own.

*(Developers: the local script takes the same option —
`./scraper/Add-ManualSheet.ps1 … -Replaces 'https://www.mipa.com.au/…/produkt100400.html'`.)*

### Hide an online sheet (no replacement)

Use the **"Hide or restore an online sheet (admins)"** form: Issues → New issue →
choose **Hide it**, paste the sheet's link, submit. It disappears from the app's
search and menus within a minute.

**To bring it back:** submit the same form with **Restore it (un-hide)** and the same
link. (Or edit `app/manual/overrides.json` and remove the line — see below.)

### How it works under the hood

Both live in `app/manual/overrides.json` (a hide list) and the manual sheet's
`replaces` field — committed files the scraper never touches. To edit by hand, open
`app/manual/overrides.json` and add/remove a link in the `"hidden"` list:

```json
{ "note": "…",
  "hidden": [
    "https://www.mipa.com.au/products/…/produkt100400.html"
  ] }
```

---

## A note on the scraped (automatic) sheets

The ~700 sheets that come from Mipa's website are **regenerated from scratch every
week**, so you **can't hand-edit the contents of one in place** — the next scrape
overwrites it. What you *can* do is **replace** it with your own PDF or **hide** it
using the overrides above; those are kept separately and survive every re-scrape. And
if Mipa removes a sheet, the next scrape drops it automatically.

---

## Seeing how many people use it (usage stats)

By default the app collects **nothing** — no analytics, no accounts — so there's no way to
know how many people use or installed it. You can switch on **anonymous** usage counts in
about two minutes:

1. Create a free account at **goatcounter.com** and pick a code (e.g. `mipatds`); that gives
   you a dashboard at `https://mipatds.goatcounter.com`.
2. In `app/app.js` set `const ANALYTICS_CODE = 'mipatds';` (your code) and commit — or just
   send me the code and I'll set it. The app redeploys and starts counting.

What the dashboard then shows:

- **Opens** — each time the app is opened.
- **Active installs** (`run-standalone`) — launches from an installed home-screen icon. This is
  the best "how many people installed it" number because it works on **iPhone too**.
- **Installs** (`app-installed`) — the browser's install event (Android/desktop only; iPhone
  doesn't send one).
- Rough **country** and trends over time.

**What it does *not* collect:** no names, no **emails**, no cookies, no cross-site tracking —
only counts (which is why no "accept cookies" banner is needed). A browser can't hand a website
a visitor's email, so you can only ever see *how many*, never *who*. To turn it back off, set
`ANALYTICS_CODE` to `''`.

---

## Quick reference

| I want to…                                  | Do this                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Add a sheet not on Mipa's site              | Issues → **Add a data sheet (admins)** → fill form, drag PDF, submit     |
| Add a second doc to the same product        | Submit the form again with the **same name + category**                 |
| Remove a sheet I added manually             | Edit `app/manual/sheets.json`, delete its block, commit                 |
| Replace an online sheet with my PDF         | Add-sheet form → paste the sheet's link in **"Replace an online sheet"** |
| Undo a replace (go back to online)          | Remove the manual sheet — the online one returns by itself              |
| Hide an online sheet                        | Issues → **Hide or restore an online sheet** → *Hide it* + paste link    |
| Un-hide a sheet I hid                       | Same form → *Restore it*, or remove the line from `overrides.json`      |
| Get a sheet's link                          | In the app, on its card tap **"Mipa page ↗"** → copy link               |
| Decide who can add/hide sheets              | Repo **Settings → Collaborators**                                       |
| See how many people use / installed it      | Turn on anonymous stats — set `ANALYTICS_CODE` in `app/app.js` (2 min)  |
| See sheets that can't be downloaded offline | App footer → *"N sheets unavailable offline"*, or `MISSING-SHEETS.md`   |
| Pick up new sheets Mipa just published      | Nothing — the weekly scrape does it (or run **Actions → Run workflow**) |
