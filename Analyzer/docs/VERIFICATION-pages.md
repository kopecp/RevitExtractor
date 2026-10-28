# GitHub Pages — weryfikacja 26.10.2026

## Lokalna aplikacja statyczna

Zbudowano `npm run build:pages` i podano `dist` przez zwykły serwer statyczny
pod ścieżką `/RevitExtractor/`, bez API Node.js Analyzera.
Test automatyczny w Microsoft Edge z WebGL, 1600 × 1000, na eksporcie
`test-333cd21fb42b444282bb5082acb2573d/output` (Snowdon Towers Sample HVAC):

- Start strony, instalacja service workera, okno instrukcji i pobranie `Start-RevitExport-2026.ps1`.
- Wybór folderu: 1 widok 3D, 39 PDF-ów, 160 488 rekordów właściwości.
- Zakończone ładowanie SVF: 4639 obiektów z geometrią.
- Wyszukanie `1365662`, wybór `Round Duct [1365662]`, parametry instancji i dziedziczone z typu.
- SQLite `_objects_id`: 1–80 z 160 488 rekordów, baza ładowana przez WASM.
- PDF „L1 - Block 35”: zakończone renderowanie; żądanie bajtów 0–3 zwraca HTTP 206 i `%PDF`.
- Drzewo źródeł: 7 modeli (host i 6 linków), wyłączenie/włączenie oczka modelu.
- Brakujący lokalny plik zwraca 404 bez zapytania do serwera.
- Odświeżenie strony usuwa wybór folderu i pozwala ponownie go wskazać.
- Brak nieobsłużonych błędów JavaScript. Serwer statyczny otrzymał **0** żądań `/local-files/`.
  Żądania danych przechwytywał service worker, który odczytywał pliki z otwartej karty.

Test folderu używał standardowego pola `webkitdirectory`.
Natywne okno `showDirectoryPicker` i systemowe okna wyboru plików PowerShell wymagają ręcznej próby użytkownika.
Przeglądarka pobiera silnik 3D z CDN Autodesk. To nie jest test działania całkowicie offline.

## Testy kodu

- `npm run check`: składnia 18 modułów JavaScript.
- `npm test`: 24/24, w tym dotychczasowe testy serwera, właściwości i widoczności.
- `npm run test:pages`: 15/15 lokalnie; na CI test rzeczywistego Snowdon jest pomijany, gdy brak eksportu.
- `npm run build:pages`: poprawny pakiet statyczny, PDF.js i sql.js WASM z licencjami.
- `git diff --check`: bez błędów.

## Launcher

Sprawdzono parser oraz `-ValidateOnly` w Windows PowerShell 5.1 z rzeczywistą
instalacją `RevitExtractor 2026.7.2.16`, istniejącym RVT i indeksem.
Walidacja zakończyła się kodem 0 bez utworzenia folderu wyników.
Nieistniejący indeks jest odrzucany z kodem różnym od zera.

**Nie uruchamiano nowego eksportu ani Revita.** Rzeczywiste wywołanie Extractora,
interakcja w jego procesie i kompletność wyników nowego modelu pozostają do próby użytkownika.
Launcher zachowuje kolejność argumentów istniejącego skryptu: indeks, RVT,
`-RCEPath`, `-LogPath`, `-journalPath`; wynik trafia do osobnego nowego folderu.

## Wbudowany indeks — 28.10.2026

- Enter przy pytaniu o indeks wybiera wbudowane 2D + 3D + `properties_data.pdb=true`,
  bez `view_unique_ids`, IFC i DWG. `P` wybiera własny plik, `Q` anuluje.
- Rzeczywisty parser `Autodesk.ExtractorUtility.IndexJson` z instalacji Revit 2026
  przyjął dokładny JSON wyciągnięty ze skryptu: `Has2DViewing=True`, `Has3DViewing=True`,
  `GeneratePropertyDB=True`, obie listy wybranych widoków puste, IFC/DWG wyłączone.
- Test launchera w Windows PowerShell 5.1 używa fałszywej instalacji i zastępczej
  funkcji `Start-Process`. Potwierdza zapis domyślnego JSON-a bez BOM przed startem,
  kolejność argumentów, identyczną bajtowo kopię własnego indeksu, walidację obu trybów,
  anulowanie i odrzucanie brakującego/uszkodzonego indeksu oraz sprzecznych parametrów.
  Walidacja i anulowanie nie tworzą folderów wyników.
- `npm test`: 25/25; składnia JS i build Pages poprawne.
- Nie uruchamiano rzeczywistego eksportu. Parser potwierdza profil i brak narzuconej
  listy widoków, nie potwierdza zestawu widoków wybranego dla konkretnego RVT.
