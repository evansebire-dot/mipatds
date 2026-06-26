# Manual data sheets

Sheets here are **not published on mipa.com.au** — they're added by hand and merged
into the app on top of the scraped catalog. Unlike the scraped mirror (`app/pdfs/`,
git-ignored, rebuilt by CI), everything in this folder is **committed to git** and is
**never touched by the scraper or a re-scrape**.

```
app/manual/
  sheets.json     index entries (merged into the app at runtime, on top of datasheets.json)
  pdfs/           the actual PDF files (committed)
```

## Add a sheet (recommended)

From the repo root:

```powershell
./scraper/Add-ManualSheet.ps1 -Pdf 'C:\path\to\Sheet.pdf' `
    -Name 'Mipa Special Clear 2K' -Category 'Car Refinishing' -Type TDS
```

Run it again with the **same `-Name` and `-Category`** to add a second document (e.g. the
SDS) onto the same product card. Then:

```powershell
git add app/manual
git commit -m "Add manual sheet: Mipa Special Clear 2K"
git push        # deploys automatically
```

Options: `-Group` (sub-heading, default "Manual additions"), `-Type SDS|TDS|Other`,
`-Lang` (default EN), `-Label` (custom badge text), `-SourceUrl` (external fallback link).

## Add a sheet by hand

1. Copy the PDF into `app/manual/pdfs/`.
2. Add a product entry to `sheets.json` (`size` is the file's byte length — used to include
   it in offline downloads):

```json
{
  "id": "m1",
  "name": "Mipa Special Clear 2K",
  "category": "Car Refinishing",
  "group": "Manual additions",
  "manual": true,
  "docs": [
    { "type": "TDS", "lang": "EN", "label": "TDS", "file": "manual/pdfs/SpecialClear.pdf", "source": "", "size": 254310 }
  ]
}
```

Manual sheets are searchable, filterable, openable and downloadable for offline use just
like scraped ones. No service-worker bump is needed to add a sheet (only the data changes).
