# Drzewo modeli i kategorii — weryfikacja

Data: 23.10.2026. Środowisko: lokalny Node.js 24, Edge przez Playwright, Autodesk Viewer 7.130.0 z oficjalnego CDN. Revit nie był uruchamiany ani wywoływany.

## Wdrożone zachowanie

- Drzewo ma zakładki Kategorie / Modele. Nowa zakładka zawiera model główny, instancje linków oraz ich kategorie, z oczkami na obu poziomach.
- Ustawienia kategorii i ukrycia pojedynczych elementów są zachowywane po wyłączeniu/włączeniu modelu. Kategorie globalne nie omijają wyłączonego modelu.
- Liczniki i częściowa widoczność odpowiadają geometrii aktualnego SVF. Stare drzewo zachowuje rodziny i typy.
- Identyfikacja używa pełnych prefiksów instancji linka. Nazwa i documentId nie są kluczami grupy. Nieustalone przypisania mają własną grupę.
- API przyjmuje zbiór geometrycznych dbId i zwraca tylko ich przypisania. Źródłowe GZIP/SQLite/SVF są wyłącznie odczytywane.

## Testy automatyczne

`npm run check` oraz `npm test`: **20/20** testów, bez pominięć w lokalnym środowisku.

Zakres obejmuje istniejące API, niezmienność SHA-256 źródłowej bazy SQLite, autoryzację i walidację nowego endpointu, identyczne nazwy i documentId, prefiksy instancji, brak AEC, odwołania do niezaładowanych linków, zakres kategorii, zagnieżdżone komponenty, kolejność zagnieżdżonych linków, indywidualne ukrycia, izolację, globalny reset, usuwanie nasłuchów i zaznaczenia zawierające ukryte elementy.

## Testy przeglądarkowe

### Snowdon — widok Cover

Eksport: `test-f5a35b5a55bf40a9a4b14ecd2ca573d7/output`, widok **Cover**.

| Model | Obiekty z geometrią |
| --- | ---: |
| Model główny HVAC | 2 629 |
| Architectural | 7 173 |
| Electrical | 2 702 |
| Facades | 408 |
| Plumbing | 6 404 |
| Site | 88 |
| Structural | 1 237 |
| Razem | **20 641** |

- Każda z **84** grup kategorii została oddzielnie wyłączona; porównano oczekiwaną widoczność każdego dbId z `viewer.isNodeVisible()`. Zero rozbieżności.
- Analogicznie sprawdzono model główny i wszystkie sześć linków. Zero rozbieżności.
- Kliknięcie oczka Walls w linku Facades ukryło 78 obiektów, pozostawiając 20 563 widoczne. Kategorie innych modeli pozostały widoczne.
- Sprawdzono zachowanie wyłączonej kategorii po wyłączeniu/włączeniu całego linka, globalne oczko Walls i częściowe oznaczenie w starej zakładce, globalny reset, ghosting wyłączony oraz brak zmian kamery od samych oczek.
- Po szybkim przełączeniu Towarowa → Snowdon → Cover wszystkie klucze źródeł należały do nowego eksportu, a ustawienia widoczności były zresetowane.
- Konsola przeglądarki bez nieoczekiwanych błędów. Wizualnie sprawdzono obie zakładki; [podgląd](source-models.png).

W najnowszym Snowdon widok **{3D}** ma 4 632 obiekty HVAC i brak geometrii linków. W tym widoku zadeklarowane linki pozostają na liście z nieaktywnymi oczkami. Jest to ograniczenie zawartości wybranego SVF.

### Towarowa — większy model

Eksport: `test-034d1920cf67438fade4857967d700ce/output`, widok **3D ARCHITECTURE**.

**557 200** obiektów: host 457 372, DESIGN 38 369, SUPPORTING BIM 52 688, SUPPORTING DESIGN 8 771. Wszystkie przypisane, brak grupy nieustalonej. Osobny link Coordinates ma zerową geometrię w tym widoku.

Odczyt odpowiedzi nowego API w zmierzonym przebiegu: około **1,06 s**, **3,91 MB** zdekodowanego JSON. Czas obejmuje żądanie i odpowiedź, nie jest pomiarem samej budowy indeksu.

Po ograniczeniu alokacji przy obliczaniu widoczności i scaleniu odświeżeń drzewa zmierzono synchroniczne wykonanie operacji wraz z aktualizacją stanu panelu:

| Operacja | Wyłączenie | Włączenie |
| --- | ---: | ---: |
| SUPPORTING DESIGN, 8 771 obiektów | 118 ms | 105 ms |
| Host, 457 372 obiekty | 264 ms | 246 ms |

Po wyłączeniu porównano widoczność wszystkich 557 200 identyfikatorów ze sceną: zero rozbieżności. Czasy to pojedyncze lokalne próbki, bez czasu pełnego przerysowania GPU i bez deklaracji SLA.

### Eksport bez linków

`test-88664312c8384430a8158d4acdd28700/output`: po wczytaniu widoku drzewko pokazuje wyłącznie model główny `test-model.rvt`, **4 639** obiektów. Pusta lista AEC i brak prefiksów oznaczają brak wyeksportowanych źródeł linkowanych; same pozostałe rekordy odwołań nie są traktowane jako modele.

## Ograniczenia

- Hierarchiczne ścieżki linków i wielokrotne wstawienie tego samego pliku sprawdzono na danych syntetycznych. Próbki rzeczywiste nie zawierały zagnieżdżonej ścieżki instancji; pełny test takiego eksportu pozostaje do wykonania, gdy będzie dostępny.
- Stan oczek jest lokalny dla aktualnie otwartego widoku; nie dodano zapisu presetów.
- Nie wykonywano publikacji, instalacji, commita ani pushowania zmian.
