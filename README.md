# RevitExtractor

**[Otwórz Analyzer](https://kopecp.github.io/RevitExtractor/)** — przeglądarka lokalnych eksportów Autodesk Revit Extractor.

## Od RVT do przeglądarki

1. W Revit 2026 przygotuj `index.json` przyciskiem **Eksport setup** w pyRevit.
   [Instrukcja instalacji przycisku](pyRevit/Extractor.extension/RVTExtractor.tab/Setup.panel/README.md).
   Możesz sklonować repo (`git clone --branch online https://github.com/kopecp/RevitExtractor.git`)
   i skopiować cały `ExportSetup.pushbutton` do swojego panelu pyRevit.
2. Zapisz model RVT. Konfiguracja musi pochodzić z tego samego modelu; widoki i ustawienia IFC są związane z modelem.
3. Na stronie wybierz **Eksportuj z Revita 2026 → Pobierz PowerShell**.
   Pobierasz jeden plik `Start-RevitExport-2026.ps1`. Potrzebujesz Windows i zainstalowanego Revita 2026 z `RevitExtractor.exe`; skrypt niczego nie instaluje.
4. Uruchom skrypt przez **Uruchom za pomocą programu PowerShell** albo w folderze pobranego pliku:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-RevitExport-2026.ps1
   ```

   Parametr `ExecutionPolicy` dotyczy tylko tego procesu; nie zmienia zasad Windows na stałe.
5. Wklej ścieżki do `index.json` i `.rvt` albo naciśnij Enter, aby wybrać pliki w oknie.
   Wybierz folder wyników (domyślnie `Dokumenty\RevitExtractor`) i potwierdź eksport.
   Jeśli Revit jest w innym miejscu, skrypt poprosi o jego folder instalacji.
6. Poczekaj na zakończenie. Każdy eksport dostaje osobny folder `export-DATA-ID` z `output`, `logs`, `journals`, kopią konfiguracji, `console.log` i `stderr.log`.
7. W Analyzerze kliknij **Otwórz folder** i wybierz `output` lub jego bezpośredni folder nadrzędny.

Przeglądarka obsługuje SVF 3D, PDF, parametry, tabele SQLite, modele źródłowe i kategorie.
Nie otwiera bezpośrednio `.rvt`. Skrypt uruchamiasz samodzielnie w Windows.
Starszy `extractorScript_v1.ps1` i główny `index.json` to zachowane przykłady z konkretnego projektu;
do nowego modelu użyj własnego indeksu oraz nowego launchera.

## GitHub Pages i dane lokalne

- Użyj aktualnego Chrome lub Edge na komputerze. Strona wymaga HTTPS, service workerów i WebGL.
- Folder jest udostępniany wyłącznie do odczytu. Aplikacja nie wysyła jego plików na GitHub ani do usługi konwersji.
- Pliki są dostępne podczas otwartej sesji. Po odświeżeniu strony wybierz folder ponownie.
- Silnik Autodesk Viewer 7.130.0 ładuje się z CDN Autodesk, więc do uruchomienia 3D potrzebny jest internet. PDF.js i SQLite WASM są częścią strony.
- Duże bazy właściwości i geometria zajmują RAM. Tabele SQLite ładują `model.sdb` do pamięci dopiero przy pierwszym wejściu w tabelę.
- Lokalny Analyzer z Node.js nadal działa: [instrukcja](Analyzer/README.md).

## Aktualizowanie strony

Workflow [pages.yml](.github/workflows/pages.yml) publikuje tylko `Analyzer/dist` po pushu na **`online`**.
Nie publikuje modeli, folderów `test-*`, przykładowego `index.json` ani całego repozytorium.
Workflow sprawdza składnię, wykonuje testy niezależne od prywatnych eksportów i buduje stronę.
PR-y do `online` i `master` są sprawdzane bez publikacji.

W repozytorium wybierz **Settings → Pages → Source: GitHub Actions**.
Środowisko `github-pages` musi dopuszczać branch `online`.
Po późniejszym merge do `master` publikacja nadal następuje z `online`;
aby przełączyć ją na `master`, zmień zarówno `push.branches`, warunek `deploy.if`, jak i regułę środowiska.
Mechanizm opisuje [dokumentacja GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Budowanie lokalne (Node.js 24+):

```powershell
cd Analyzer
npm ci --ignore-scripts --omit=optional
npm run check
npm run test:pages
npm run build:pages
```

Wynik `Analyzer/dist` należy podawać przez HTTP localhost lub HTTPS, również pod ścieżką `/RevitExtractor/`.
Otwieranie HTML przez `file://` nie obsługuje trybu Pages.
`npm test` dodatkowo wykonuje dotychczasowe testy lokalnego serwera, wymagające próbnego eksportu Snowdon.

## Skrypt bez uruchamiania eksportu

Do sprawdzenia własnych ścieżek i konfiguracji:

```powershell
.\Start-RevitExport-2026.ps1 -IndexPath 'D:\Projekt\index.json' -ModelPath 'D:\Projekt\Model.rvt' -OutputParent 'D:\Eksporty' -ValidateOnly
```

Ta opcja nie uruchamia Revita i nie tworzy folderów. Właściwy eksport zawsze pyta o potwierdzenie.
