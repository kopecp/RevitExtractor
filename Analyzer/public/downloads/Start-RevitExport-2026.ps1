#Requires -Version 5.1
<#
One-file interactive launcher for Autodesk Revit Extractor 2026.
Run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-RevitExport-2026.ps1
The execution-policy override applies only to that process.
#>
[CmdletBinding()]
param(
    [string]$IndexPath,
    [string]$ModelPath,
    [string]$OutputParent,
    [string]$RevitDirectory = (Join-Path $env:ProgramFiles 'Autodesk\Revit 2026'),
    [switch]$ValidateOnly,
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$resultCode = 1

function Read-InputFile {
    param([string]$Value, [string]$Label, [string]$Extension)
    while ($true) {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            Write-Host "`n$Label"
            Write-Host 'Wklej pelna sciezke lub nacisnij Enter, aby wybrac plik w oknie.'
            $Value = Read-Host 'Sciezka (Q = anuluj)'
            if ($Value -eq 'Q') { throw 'Anulowano.' }
            if ([string]::IsNullOrWhiteSpace($Value)) {
                Add-Type -AssemblyName System.Windows.Forms
                $dialog = New-Object System.Windows.Forms.OpenFileDialog
                try {
                    $dialog.Title = $Label
                    $dialog.Filter = "$Extension (*$Extension)|*$Extension"
                    $dialog.CheckFileExists = $true
                    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Anulowano wybor pliku.' }
                    $Value = $dialog.FileName
                } finally { $dialog.Dispose() }
            }
        }
        $Value = $Value.Trim().Trim('"')
        if ((Test-Path -LiteralPath $Value -PathType Leaf) -and [IO.Path]::GetExtension($Value) -ieq $Extension) {
            return (Resolve-Path -LiteralPath $Value).ProviderPath
        }
        if ($ValidateOnly) { throw "Nie znaleziono pliku $Extension : $Value" }
        Write-Host "Nie znaleziono pliku $Extension : $Value" -ForegroundColor Yellow
        $Value = ''
    }
}

try {
    Write-Host "`nRevit Extractor 2026 - eksport lokalny" -ForegroundColor Cyan
    Write-Host 'Najpierw zapisz RVT i przygotuj index.json w pyRevit dla tego samego modelu.'
    if ($ValidateOnly -and (!$IndexPath -or !$ModelPath -or !$OutputParent)) { throw 'ValidateOnly wymaga IndexPath, ModelPath i OutputParent.' }
    $IndexPath = Read-InputFile $IndexPath 'Wskaz konfiguracje index.json' '.json'
    $ModelPath = Read-InputFile $ModelPath 'Wskaz zapisany model Revit 2026 (.rvt)' '.rvt'

    $config = Get-Content -LiteralPath $IndexPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$config -or !$config.PSObject.Properties['metadata'] -or !$config.metadata -or
        !$config.metadata.PSObject.Properties['parameters'] -or !$config.metadata.parameters -or
        !$config.metadata.parameters.PSObject.Properties['derivative_type'] -or !$config.metadata.parameters.derivative_type) {
        throw 'Nieprawidlowa konfiguracja: wymagane metadata.parameters.derivative_type. Wygeneruj index.json w pyRevit.'
    }

    $RevitDirectory = $RevitDirectory.Trim().Trim('"')
    $exe = Join-Path $RevitDirectory 'RevitExtractor\RevitExtractor.exe'
    while (!(Test-Path -LiteralPath $exe -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $RevitDirectory 'Revit.exe') -PathType Leaf)) {
        if ($ValidateOnly) { throw "Brak instalacji Revita / Extractora 2026: $RevitDirectory" }
        Write-Host "Nie znaleziono Revita i RevitExtractor w: $RevitDirectory" -ForegroundColor Yellow
        $RevitDirectory = (Read-Host 'Wklej folder instalacji Revit 2026 (Q = anuluj)').Trim().Trim('"')
        if (!$RevitDirectory -or $RevitDirectory -eq 'Q') { throw 'Anulowano.' }
        $exe = Join-Path $RevitDirectory 'RevitExtractor\RevitExtractor.exe'
    }
    $RevitDirectory = (Resolve-Path -LiteralPath $RevitDirectory).ProviderPath
    $exe = Join-Path $RevitDirectory 'RevitExtractor\RevitExtractor.exe'
    $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    if ($version -notmatch '^2026\.') { throw "Ten skrypt obsluguje RevitExtractor 2026. Wykryta wersja: $version" }

    if ([string]::IsNullOrWhiteSpace($OutputParent)) {
        $defaultOutput = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'RevitExtractor'
        $OutputParent = Read-Host "Folder wynikow [Enter = $defaultOutput, Q = anuluj]"
        if ($OutputParent -eq 'Q') { throw 'Anulowano.' }
        if ([string]::IsNullOrWhiteSpace($OutputParent)) { $OutputParent = $defaultOutput }
    }
    $OutputParent = [IO.Path]::GetFullPath($OutputParent.Trim().Trim('"'))
    if ((Test-Path -LiteralPath $OutputParent) -and !(Test-Path -LiteralPath $OutputParent -PathType Container)) { throw 'Miejsce wynikow musi byc folderem.' }
    # Reject quotes/newlines before forming a Windows native-process argument string.
    foreach ($value in @($IndexPath, $ModelPath, $OutputParent, $RevitDirectory)) {
        if ($value -match '["\r\n]') { throw 'Sciezka zawiera niedozwolony znak.' }
    }

    Write-Host "`nKonfiguracja: $IndexPath"
    Write-Host "Model RVT:   $ModelPath"
    Write-Host "Extractor:   $version"
    Write-Host "Wyniki:      $OutputParent (nowy osobny folder dla kazdego uruchomienia)"
    if ($ValidateOnly) {
        Write-Host 'Walidacja OK. Nie uruchomiono eksportu i nie utworzono folderow.' -ForegroundColor Green
        $resultCode = 0
    } elseif ((Read-Host 'Uruchomic eksport? [T/N]') -notin @('T', 'TAK')) {
        Write-Host 'Anulowano. Nie uruchomiono eksportu.'
        $resultCode = 0
    } else {
        $runName = 'export-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
        $runRoot = Join-Path $OutputParent $runName
        $outputDir = Join-Path $runRoot 'output'
        $logDir = Join-Path $runRoot 'logs'
        $journalDir = Join-Path $runRoot 'journals'
        $runIndex = Join-Path $runRoot 'index.json'
        New-Item -ItemType Directory -Path $outputDir,$logDir,$journalDir -Force | Out-Null
        Copy-Item -LiteralPath $IndexPath -Destination $runIndex
        $arguments = @($runIndex, $ModelPath, '-RCEPath', $RevitDirectory, '-LogPath', $logDir, '-journalPath', $journalDir)
        $argumentLine = ($arguments | ForEach-Object { '"' + $_.TrimEnd('\') + '"' }) -join ' '
        Write-Host "`nTrwa eksport. Moze to potrwac wiele minut. Poczekaj na zakonczenie."
        Write-Host "Logi: $runRoot"
        $process = Start-Process -FilePath $exe -ArgumentList $argumentLine -WorkingDirectory $RevitDirectory -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runRoot 'console.log') -RedirectStandardError (Join-Path $runRoot 'stderr.log')
        $resultCode = $process.ExitCode
        Write-Host "Kod zakonczenia: $resultCode"
        if ($resultCode -ne 0) { throw "Extractor zakonczyl sie bledem. Sprawdz console.log, stderr.log, logs i journals w $runRoot" }
        $summary = Select-String -LiteralPath (Join-Path $runRoot 'console.log') -Pattern 'Success Jobs:\s*(\d+), Failed Jobs:\s*(\d+)' | Select-Object -Last 1
        if ($summary -and [int]$summary.Matches[0].Groups[2].Value -gt 0) {
            $resultCode = 1
            throw "Czesc zadan eksportu nie powiodla sie. Sprawdz console.log i logs w $runRoot"
        }
        if (!(Test-Path -LiteralPath (Join-Path $outputDir 'bubble.json') -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $outputDir 'Resource') -PathType Container)) {
            $resultCode = 1
            throw "Brak kompletnej struktury eksportu. Sprawdz logi w $runRoot"
        }
        Write-Host "`nProces zakonczony. Sprawdz w logach statusy poszczegolnych zadan (IFC/PDF/3D)." -ForegroundColor Green
        Write-Host 'Otworz https://kopecp.github.io/RevitExtractor/ i wybierz Otworz folder:'
        Write-Host $outputDir -ForegroundColor Cyan
    }
} catch {
    if ($resultCode -eq 0) { $resultCode = 1 }
    Write-Host "`nBlad: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if (!$NoPause -and !$ValidateOnly) { [void](Read-Host "`nNacisnij Enter, aby zamknac") }
}
exit $resultCode
