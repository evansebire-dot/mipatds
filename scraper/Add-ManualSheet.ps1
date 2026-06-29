<#
.SYNOPSIS
    Add a data sheet that is NOT published on mipa.com.au to the app.

.DESCRIPTION
    Manually-added sheets live alongside the scraped catalog but are kept in their own
    files so a re-scrape never touches them:
        app/manual/sheets.json   index entries (merged into the app at runtime)
        app/manual/pdfs/*.pdf    the committed PDF files (NOT the git-ignored mirror)

    This script copies your PDF into app/manual/pdfs, records its size, and appends (or
    extends) an entry in app/manual/sheets.json. Commit + push and it deploys like any
    other change. To add both an SDS and a TDS for the same product, run it twice with
    the same -Name and -Category; the second doc is added to the same product card.

.EXAMPLE
    # A technical data sheet supplied by the customer (not on Mipa's website):
    ./scraper/Add-ManualSheet.ps1 -Pdf 'C:\sheets\SpecialClear_TDS.pdf' `
        -Name 'Mipa Special Clear 2K' -Category 'Car Refinishing' -Type TDS

.EXAMPLE
    # Add the safety sheet for the same product onto the same card:
    ./scraper/Add-ManualSheet.ps1 -Pdf 'C:\sheets\SpecialClear_SDS.pdf' `
        -Name 'Mipa Special Clear 2K' -Category 'Car Refinishing' -Type SDS

.EXAMPLE
    # Replace an online sheet with your own PDF: the app hides the scraped sheet at the
    # given Mipa page link and shows this one instead. Remove the entry to go back online.
    ./scraper/Add-ManualSheet.ps1 -Pdf 'C:\sheets\NewClear_TDS.pdf' -Name 'Mipa 2K-Klarlack CPE' `
        -Category 'Car Refinishing' -Type TDS `
        -Replaces 'https://www.mipa.com.au/products/.../produkt100124.html'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Pdf,                 # path to the local PDF to add
    [Parameter(Mandatory)] [string] $Name,                # product name (shown on the card)
    [string] $Category = 'Car Refinishing',               # one of the app's categories (or a new one)
    [string] $Group    = 'Manual additions',              # sub-heading under the name
    [ValidateSet('SDS','TDS','Other')] [string] $Type = 'TDS',
    [string] $Lang     = 'EN',                             # language tag shown when not EN/GB
    [string] $Label    = '',                               # optional custom badge label
    [string] $SourceUrl = '',                              # optional external link (fallback if file missing)
    [string] $Replaces  = ''                               # mipa.com.au page link this sheet replaces (hides the online one)
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Pdf)) { throw "PDF not found: $Pdf" }

$appDir    = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '..') 'app'))
$manualDir = Join-Path $appDir 'manual'
$pdfDir    = Join-Path $manualDir 'pdfs'
$jsonPath  = Join-Path $manualDir 'sheets.json'
New-Item -ItemType Directory -Force -Path $pdfDir | Out-Null

# --- copy the PDF in under a safe, unique filename ----------------------------
$base = [System.IO.Path]::GetFileNameWithoutExtension($Pdf)
$safe = ($base -replace '[^\w.\-]', '_')
if (-not $safe) { $safe = 'sheet' }
$fname = "$safe.pdf"
$dest  = Join-Path $pdfDir $fname
$i = 2
while ((Test-Path -LiteralPath $dest) -and
       ((Get-FileHash -LiteralPath $dest).Hash -ne (Get-FileHash -LiteralPath $Pdf).Hash)) {
    $fname = "${safe}_$i.pdf"; $dest = Join-Path $pdfDir $fname; $i++
}
Copy-Item -LiteralPath $Pdf -Destination $dest -Force
$size = (Get-Item -LiteralPath $dest).Length

# --- load (or initialise) the manual index ------------------------------------
if (Test-Path -LiteralPath $jsonPath) {
    $doc = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
} else {
    $doc = [pscustomobject]@{ note = 'Manually-added sheets, merged at runtime.'; products = @() }
}
# normalise products to a mutable list
$products = @()
if ($doc.products) { $products = @($doc.products) }

$newDoc = [pscustomobject]@{
    type   = $Type
    lang   = $Lang
    label  = ($(if ($Label) { $Label } else { $Type }))
    file   = "manual/pdfs/$fname"
    source = $SourceUrl
    size   = $size
}

# add the doc to an existing product (same name + category), else create one
$existing = $products | Where-Object { $_.name -eq $Name -and $_.category -eq $Category } | Select-Object -First 1
if ($existing) {
    $existing.docs = @($existing.docs) + $newDoc
    if ($Replaces) { $existing | Add-Member -NotePropertyName replaces -NotePropertyValue $Replaces -Force }
    Write-Host "Updated existing product '$Name' (+$Type)" -ForegroundColor Green
} else {
    # next free m<N> id
    $nums = $products | ForEach-Object { if ($_.id -match '^m(\d+)$') { [int]$Matches[1] } }
    $next = 1; if ($nums) { $next = ([int]($nums | Measure-Object -Maximum).Maximum) + 1 }
    $prod = [ordered]@{
        id       = "m$next"
        name     = $Name
        category = $Category
        group    = $Group
        source   = $SourceUrl
        manual   = $true
    }
    if ($Replaces) { $prod.replaces = $Replaces }   # hide the online sheet at this link
    $prod.docs = @($newDoc)
    $products += [pscustomobject]$prod
    Write-Host "Added new product '$Name' as m$next ($Type)" -ForegroundColor Green
}

$out = [ordered]@{
    note     = 'Manually-added data sheets (not on mipa.com.au). Merged into the app at runtime; never overwritten by the scraper. Maintain with scraper/Add-ManualSheet.ps1.'
    products = $products
}
$out | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

Write-Host ""
Write-Host "  PDF   -> app/manual/pdfs/$fname  ($([Math]::Round($size/1KB,1)) KB)"
Write-Host "  Index -> app/manual/sheets.json  ($($products.Count) manual product(s))"
Write-Host ""
Write-Host "Next: git add app/manual && git commit && git push   (deploys automatically)" -ForegroundColor Cyan
