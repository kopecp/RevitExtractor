# Eksport setup — przycisk pyRevit

Generator `index.json` dla natywnego Autodesk Revit Extractor 2026. Czyta widoki
aktywnego projektu RVT i zapisuje konfigurację w miejscu wybranym przez użytkownika.
Nie uruchamia Extractora, nie kopiuje modeli i nie wykonuje transakcji w Revicie.

## Dodanie przycisku

Skopiuj **cały** folder `ExportSetup.pushbutton` do wybranego katalogu `*.panel`
w swojej aktywnej rozszerzalnej strukturze pyRevit, np.:

```text
TwojeNarzedzia.extension/
  TwojaZakladka.tab/
    Eksport.panel/
      ExportSetup.pushbutton/
        bundle.yaml
        script.py
        extractor_config.py
        extractor_model.py
        extractor_ui.py
        ui.xaml
```

Następnie użyj Reload pyRevit. Przycisk wymaga projektu w Revit 2026+ oraz silnika
IronPython pyRevit (bez znacznika `#! python3`). Kod jest zgodny z IronPython 2.7.
Pliki przycisku są samodzielne: nie odwołują się do repozytorium po instalacji.
Nie rejestrujemy automatycznie rozszerzenia ani nie zmieniamy konfiguracji pyRevit.

## Użycie

1. Otwórz projekt RVT, który później ma przetwarzać Extractor.
2. Kliknij **Eksport setup**. Domyślnie włączone są 2D, 3D i SQLite.
3. Dla każdej grupy wybierz **Domyślny zakres Extractora** albo **Tylko zaznaczone**.
4. W trybie zaznaczania możesz filtrować typ, szukać po nazwie, numerze arkusza
   lub ElementId oraz zaznaczać/odznaczać wszystkie aktualnie widoczne pozycje.
   Zaznaczenia ukryte przez filtr pozostają zaznaczone i są uwzględniane w eksporcie.
5. Opcje zaawansowane zawierają dane AEC, opis dokumentu, master views, topologię,
   rozszerzone właściwości, F2D oraz dodatkowe formaty DWG i IFC.
6. Sprawdź zakładkę **Podgląd index.json** i kliknij **Zapisz index.json**.

Obecny `extractorScript_v1.ps1` w repozytorium czyta `index.json` leżący obok skryptu.
Aby z niego skorzystać, zapisz konfigurację właśnie tam. Generator nie zmienia
zmiennej `$sourceModel` w PowerShell: musi wskazywać ten sam model, z którego
pochodzą wybrane widoki. Nowe/zmienione widoki muszą być zapisane w RVT przed
późniejszym uruchomieniem Extractora; konfigurator sam modelu nie zapisuje.

## Znaczenie ustawień

- **Domyślny zakres** nie oznacza wszystkich widoków. Nie zapisuje listy ID;
  wybór pozostaje po stronie Extractora (np. zapisanych zestawów publikacji).
- **Tylko zaznaczone** zapisuje `view_unique_ids`. Arkusze i widoki 2D trafiają
  do wspólnej listy `2dviewing`; 3D ma osobną listę. Pusty wybór blokuje zapis.
- Wyłączenie 2D/3D usuwa odpowiednią gałąź. Wpisanie `false` zamiast gałęzi
  nie jest prawidłowym sposobem wyłączenia widoków w tym natywnym parserze.
- SQLite jest zawsze zapisane jawnie jako `properties_data.pdb`.
- Domyślne opcje zaawansowane są pomijane, więc niezmieniony preset daje taki
  sam minimalny indeks jak wcześniejsza konfiguracja 2D + 3D + SQLite.
- Ustawienia zaawansowane 3D są zapisywane tylko, gdy włączone jest 3D;
  F2D tylko przy 2D, a rozszerzone właściwości tylko przy SQLite.
- DWG/IFC włącza `export.to`. Szczegółowe ustawienia tych formatów nie są
  edytowane. Dostępność i zakres wyników zależą od natywnego eksportera.
- Brak szablonów widoków, arkuszy zastępczych, niedrukowalnych widoków oraz
  samodzielnych zestawień. Widoki z modeli podlinkowanych nie są listowane.

Celowo nie wystawiamy `xref`, `xrefMap`, opcji AIM/chmurowych ani
`force_full_export` (nie dotyczy lokalnej bazy SQLite w tej wersji parsera).
To opcje innych trybów przetwarzania; `xrefMap` może dodatkowo przenosić pliki.
Odnajdywanie linków w zwykłej próbie pozostaje zadaniem Extractora.

## Walidacja

```powershell
python -B -m unittest discover -s .\pyRevit\tests -v
```

Sprawdzono 14 testów konfiguracji, kompilację wszystkich modułów w IronPython 2.7,
inicjalizację i układ WPF, wiązanie checkboxów z zaznaczeniami, zachowanie wyboru
przy filtrowaniu, reset oraz zapis i zastępowanie pliku UTF-8. Test okna działał
poza Revitem, z zastępczym środowiskiem aplikacji i przykładową listą widoków.

Parser Autodesk poprawnie odczytał siedem konfiguracji: domyślną, wybrane 2D,
wybrane 3D, bez bazy, samą bazę, opcje zaawansowane oraz same dodatkowe formaty.
Walidacja parserem potwierdza odczyt opcji, ale nie pełny eksport. Pierwsze
uruchomienie przycisku w pyRevit, rzeczywiste listowanie modelu i eksport
nowych kombinacji (szczególnie bez SQLite, F2D, DWG/IFC) wymagają próby w Revicie.

Źródła: lokalny parser `Autodesk.ExtractorUtility.IndexJson` z instalacji Revit
2026.7.2.16 oraz [API formularzy pyRevit](https://docs.pyrevitlabs.io/reference/pyrevit/forms/_ipy/).
