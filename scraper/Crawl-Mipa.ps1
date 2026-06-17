<#
.SYNOPSIS
    Crawls the Mipa Australia Technical & Safety Data Sheets site and builds a
    flat search index (datasheets.json) plus a local mirror of every PDF.

.DESCRIPTION
    The site is a 3-level static HTML tree:
      Category page            -> anchors containing 'prlnr'   (product groups)
      Group page (prlnr*.html) -> anchors containing 'produkt' (products)
      Product page             -> anchors ending in '.pdf'     (SDS / TDS docs)

    PDFs are hosted cross-origin on mipa-paints.com. To make the PWA fully
    offline-capable without CORS problems, this script downloads every PDF and
    stores it same-origin under <OutDir>/pdfs, then records local paths in the
    index.

.EXAMPLE
    # Build the index only (fast, no PDF downloads) to gauge scale:
    ./Crawl-Mipa.ps1 -IndexOnly

    # Full build incl. PDF mirror:
    ./Crawl-Mipa.ps1
#>
[CmdletBinding()]
param(
    [string]   $OutDir     = (Join-Path (Join-Path $PSScriptRoot '..') 'app'),
    [string[]] $Categories = @('car-refinishing','industry','aerosols','decorative'),
    [switch]   $IndexOnly,                 # skip PDF downloads
    [int]      $DelayMs     = 150,         # politeness delay between HTTP requests
    [int]      $MaxProducts = 0            # 0 = no limit (for testing small runs)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference     = 'SilentlyContinue'
$BaseUrl  = 'https://www.mipa.com.au'
$RootPath = '/products/technical-safety-data-sheets'

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$PdfDir = Join-Path $OutDir 'pdfs'
New-Item -ItemType Directory -Force -Path $PdfDir | Out-Null

# --- helpers ---------------------------------------------------------------

function Get-Html {
    param([string]$Url)
    for ($try = 1; $try -le 3; $try++) {
        try {
            Start-Sleep -Milliseconds $DelayMs
            return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30).Content
        } catch {
            Write-Warning "  fetch failed ($try/3) $Url : $($_.Exception.Message)"
            if ($try -eq 3) { return $null }
            Start-Sleep -Milliseconds (500 * $try)
        }
    }
}

# Returns objects with Href (absolute) and Text (visible label) for every <a> in $Html.
function Get-Anchors {
    param([string]$Html, [string]$PageUrl)
    if (-not $Html) { return @() }
    $rx = [regex]'(?is)<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>(.*?)</a>'
    foreach ($m in $rx.Matches($Html)) {
        $href = $m.Groups[1].Value.Trim()
        $text = ($m.Groups[2].Value -replace '(?s)<[^>]+>', ' ' -replace '\s+', ' ').Trim()
        $text = [System.Net.WebUtility]::HtmlDecode($text)
        if (-not $href -or $href -like '#*' -or $href -like 'mailto:*' -or $href -like 'javascript:*') { continue }
        # absolutize
        if    ($href -match '^https?://') { $abs = $href }
        elseif($href.StartsWith('//'))    { $abs = 'https:' + $href }
        elseif($href.StartsWith('/'))     { $abs = $BaseUrl + $href }
        else {
            $baseDir = $PageUrl.Substring(0, $PageUrl.LastIndexOf('/') + 1)
            $abs = $baseDir + $href
        }
        [pscustomobject]@{ Href = $abs; Text = $text }
    }
}

function Get-DocType {
    param([string]$Url, [string]$Label)
    # US-format MSDS are safety data sheets too (just a regional variant)
    if ($Url -match '/sdb/' -or $Url -match '/usmsds/' -or $Label -match '(?i)\b(SDS|MSDS)\b|safety') { return 'SDS' }
    if ($Url -match '/pi/'  -or $Label -match '(?i)product\s*info|\bTDS\b|\bPI\b')                     { return 'TDS' }
    return 'Other'
}

function Get-Lang {
    param([string]$Url)
    if ($Url -match '_USA\.pdf$' -or $Url -match '/usmsds/') { return 'US' }
    if ($Url -match '_([A-Z]{2})\.pdf$') { return $Matches[1] }
    if ($Url -match '/([a-z]{2})/')      { return $Matches[1].ToUpper() }
    return 'EN'
}

# --- crawl -----------------------------------------------------------------

$documents   = New-Object System.Collections.Generic.List[object]
$seenPdf     = @{}    # pdf url -> local file name (dedupe downloads)
$productCount = 0
$stats = [ordered]@{}

foreach ($cat in $Categories) {
    $catUrl  = "$BaseUrl$RootPath/$cat"
    $catName = (Get-Culture).TextInfo.ToTitleCase(($cat -replace '-', ' '))
    Write-Host "`n=== Category: $catName ===" -ForegroundColor Cyan
    $stats[$catName] = 0

    $catHtml  = Get-Html $catUrl
    $groups   = Get-Anchors $catHtml $catUrl | Where-Object { $_.Href -match '/prlnr\d' } |
                Sort-Object Href -Unique

    foreach ($g in $groups) {
        $groupName = $g.Text
        Write-Host "  Group: $groupName" -ForegroundColor DarkCyan
        $grpHtml = Get-Html $g.Href
        $anchors = Get-Anchors $grpHtml $g.Href

        # leaf products under this group
        $products = $anchors | Where-Object { $_.Href -match '/produkt[\w-]*\.html' } | Sort-Object Href -Unique

        # collect (productName, productPageUrl) pairs; if a group has no sub-products
        # but links PDFs directly, treat the group itself as the product.
        $targets = @()
        if ($products) {
            foreach ($p in $products) { $targets += [pscustomobject]@{ Name = $p.Text; Url = $p.Href } }
        } else {
            $targets += [pscustomobject]@{ Name = $groupName; Url = $g.Href }
        }

        foreach ($t in $targets) {
            if ($MaxProducts -gt 0 -and $productCount -ge $MaxProducts) { break }
            $productCount++

            # reuse already-fetched group html when product == group
            $pHtml = if ($t.Url -eq $g.Href) { $grpHtml } else { Get-Html $t.Url }
            $pdfs  = Get-Anchors $pHtml $t.Url | Where-Object { $_.Href -match '\.pdf($|\?)' } | Sort-Object Href -Unique
            if (-not $pdfs) { continue }

            $docs = New-Object System.Collections.Generic.List[object]
            foreach ($pdf in $pdfs) {
                $type = Get-DocType $pdf.Href $pdf.Text
                $lang = Get-Lang   $pdf.Href

                # local mirror file name (dedupe identical urls)
                if (-not $seenPdf.ContainsKey($pdf.Href)) {
                    $fname = ($pdf.Href -split '/')[-1] -replace '[^\w.\-]', '_'
                    # avoid name collisions between different urls
                    if (Test-Path (Join-Path $PdfDir $fname)) {
                        $existingFor = ($seenPdf.GetEnumerator() | Where-Object { $_.Value -eq $fname }).Key
                        if ($existingFor -and $existingFor -ne $pdf.Href) {
                            $h = [Math]::Abs($pdf.Href.GetHashCode()).ToString('x')
                            $fname = "${h}_$fname"
                        }
                    }
                    $seenPdf[$pdf.Href] = $fname
                }
                $localName = $seenPdf[$pdf.Href]

                $size = $null
                if (-not $IndexOnly) {
                    $dest = Join-Path $PdfDir $localName
                    if (-not (Test-Path $dest)) {
                        try {
                            Start-Sleep -Milliseconds $DelayMs
                            Invoke-WebRequest -Uri $pdf.Href -OutFile $dest -UseBasicParsing -TimeoutSec 60
                        } catch { Write-Warning "    PDF download failed: $($pdf.Href)" }
                    }
                    if (Test-Path $dest) { $size = (Get-Item $dest).Length }
                }

                $docs.Add([pscustomobject]@{
                    type   = $type
                    lang   = $lang
                    label  = $pdf.Text
                    file   = "pdfs/$localName"
                    source = $pdf.Href
                    size   = $size
                })
            }

            $documents.Add([pscustomobject]@{
                id       = 'p{0}' -f $productCount
                name     = $t.Name
                category = $catName
                group    = $groupName
                source   = $t.Url
                docs     = $docs
            })
            $stats[$catName]++
            Write-Host ("    + {0}  ({1} doc{2})" -f $t.Name, $docs.Count, ($(if($docs.Count -ne 1){'s'}else{''})))
        }
    }
}

# --- write index -----------------------------------------------------------

$index = [ordered]@{
    generatedAt = (Get-Date).ToString('s')
    source      = "$BaseUrl$RootPath"
    categories  = @($Categories | ForEach-Object { (Get-Culture).TextInfo.ToTitleCase(($_ -replace '-', ' ')) })
    count       = $documents.Count
    products    = $documents
}
$jsonPath = Join-Path $OutDir 'datasheets.json'
$index | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding UTF8

Write-Host "`n================ SUMMARY ================" -ForegroundColor Green
foreach ($k in $stats.Keys) { Write-Host ("  {0,-18} {1} products" -f $k, $stats[$k]) }
Write-Host ("  {0,-18} {1} products, {2} unique PDFs" -f 'TOTAL', $documents.Count, $seenPdf.Count) -ForegroundColor Green
Write-Host "  index -> $jsonPath"
if (-not $IndexOnly) {
    $mb = [Math]::Round(((Get-ChildItem $PdfDir -File | Measure-Object Length -Sum).Sum / 1MB), 1)
    Write-Host "  pdfs  -> $PdfDir  (${mb} MB)"
}
