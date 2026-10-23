# Weryfikacja — 23.10.2026

Środowisko: Windows, Node.js 24.18.0, Autodesk Viewer 7.130.0, PDF.js 6.4.299.

Eksport: `test-333cd21fb42b444282bb5082acb2573d/output` — Snowdon Towers Sample HVAC.

## Wynik

- `npm run check`: poprawna składnia wszystkich modułów serwera i przeglądarki.
- `npm test`: **8/8 testów integracyjnych** zakończonych powodzeniem.
- `npm install`: audyt zależności — 0 zgłoszonych podatności w chwili instalacji.
- Źródłowy `model.sdb` zachował identyczny SHA-256 przed i po testach.

## Sprawdzone w przeglądarce

- Automatyczne otwarcie najnowszego eksportu i ponowne otwarcie przez formularz pełnej ścieżki.
- Renderowanie SVF wraz z 4639 obiektami z geometrią; ścieżki ze spacjami działają.
- Przekrój i powrót do pełnego modelu.
- Obrót pełnego modelu, dopasowanie kadru, ukrycie izolowanego kanału i przywrócenie geometrii.
- Drzewo modelu: otwarcie, widoczna struktura, zamknięcie.
- Kliknięcie geometrii urządzenia `HeatRecoveryUnit [1466747]` wyświetliło parametry rekordu `dbId 6773`.
- Wyszukiwanie `Round Duct` w bazie: 2454 rekordy; wyszukiwanie `1365662`: jeden rekord.
- Wybranie kanału `dbId 3199` w tabeli udostępniło właściwości i akcję izolowania w modelu.
- Przegląd oryginalnej tabeli `_objects_attr`: 2958 rekordów, strony 1–80 i 81–160.
- Pobrano CSV drugiej strony i przeniesiono próbkę do `sample-attributes.csv` (80 rekordów i nagłówek).
- Galeria PDF: wyszukiwanie M101, renderowanie arkusza **M101 - Plan HVAC L1** oraz zmiana powiększenia z dopasowania szerokości na 100%.
- Układ desktopowy sprawdzony przy 1440 × 900.

## Zapisane przykłady

- `sample-model.png` — viewer 3D i inspektor.
- `sample-data.png` — wyszukany element oraz jego właściwości.
- `sample-pdf.png` — wyrenderowany arkusz M101.
- `sample-attributes.csv` — CSV pobrany przez interfejs.

## Zakres weryfikacji

Nie uruchamiano Revita ani ponownego eksportu. Natywny dialog wyboru folderu Windows oraz inne przeglądarki wymagają osobnego sprawdzenia użytkowego; otwieranie folderu przez wklejenie ścieżki jest zweryfikowane. Hosting i całkowicie offline działający viewer 3D nie są częścią tej wersji.
