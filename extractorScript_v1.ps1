$revitDir = 'C:\Program Files\Autodesk\Revit 2026'
$exe = Join-Path $revitDir 'RevitExtractor\RevitExtractor.exe'
$sourceModel = 'C:\Users\Piotr.Kopec\source\CDL\pyRevit\SampleModels\SnowdonHVAC.rvt'
$indexTemplate = Join-Path $PSScriptRoot 'index.json'

if (-not (Test-Path -LiteralPath $indexTemplate -PathType Leaf)) {
    throw "Brak pliku indeksu: $indexTemplate"
}

$testRoot = Join-Path 'C:\Users\Piotr.Kopec\source\RevitExtractor' `
    ('test-' + [guid]::NewGuid().ToString('N'))

$outputDir = Join-Path $testRoot 'output'
$indexPath = Join-Path $testRoot 'index.json'
$logDir = Join-Path $testRoot 'logs'
$journalDir = Join-Path $testRoot 'journals'

New-Item -ItemType Directory -Path $testRoot,$outputDir,$logDir,$journalDir |
    Out-Null
Copy-Item -LiteralPath $indexTemplate -Destination $indexPath

& $exe $indexPath $sourceModel `
    -RCEPath $revitDir `
    -LogPath $logDir `
    -journalPath $journalDir `
    2>&1 | Tee-Object -FilePath (Join-Path $testRoot 'console.log')

$extractorExitCode = $LASTEXITCODE
"Exit code: $extractorExitCode"

Get-ChildItem -LiteralPath $outputDir -Recurse -File |
    Select-Object FullName,Length
