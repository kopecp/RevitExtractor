# Analyzer — widoczność modeli i kategorii

Data: 23.10.2026. Status: wdrożono po akceptacji. Poniżej zachowano plan i ustalenia analizy; aktualne wyniki: [VERIFICATION-models.md](VERIFICATION-models.md).

## 1. Uzgodniony sposób obsługi

Przycisk **Drzewo** udostępnia dwa widoki: **Kategorie** oraz **Modele**. Nowy widok ma strukturę **model → kategorie tego modelu**. Na obu poziomach znajduje się oczko sterujące widocznością.

Przykład układu, bez deklarowania obecności konkretnych kategorii w danym widoku 3D:

```text
Drzewo       [ Kategorie ] [ Modele ]

▼ Model główny — SnowdonHVAC.rvt                       [oko]
    Kanały                                            [oko]
    Kształtki kanałów                                 [oko]
    Urządzenia mechaniczne                            [oko]
▼ Snowdon Towers Sample Architectural.rvt              [oko]
    Ściany                                            [oko]
    Stropy                                            [oko]
    Drzwi                                             [oko]
▶ Snowdon Towers Sample Structural.rvt                 [oko]
▶ Snowdon Towers Sample Facades.rvt                    [oko]
▶ Snowdon Towers Sample Plumbing.rvt                   [oko]
▶ Snowdon Towers Sample Electrical.rvt                 [oko]
▶ Snowdon Towers Sample Site.rvt                       [oko]
```

Nazwy kategorii w implementacji pochodzą z eksportu; powyższy przykład jest poglądowy, nie oznacza dodawania tłumaczeń kategorii.

- Oczko modelu ukrywa/pokazuje wszystkie jego elementy w aktualnym widoku 3D.
- Oczko kategorii działa wyłącznie we wskazanym modelu. Wyłączenie ścian w linku architektury nie ukrywa ścian modelu głównego ani innego linka.
- Wyłączenie modelu zachowuje ustawienia jego kategorii. Po ponownym włączeniu modelu wcześniej wyłączone kategorie pozostają wyłączone.
- Rozwijanie wiersza i kliknięcie oczka są oddzielnymi czynnościami. Nie zaznaczamy masowo elementów ani nie zmieniamy kamery przy przełączaniu oczka.
- Stan częściowej widoczności ma odrębne oznaczenie oraz opis dostępny po najechaniu i dla czytnika ekranu. Ukrycie pojedynczego elementu również może powodować stan częściowy.
- Kliknięcie oczka włączonego, częściowo widocznego modelu wyłącza model. Ponowne włączenie przywraca jego zapisane ustawienia kategorii i pojedynczych elementów.
- Przy wyłączonym modelu kategorie zachowują swoje ustawienia; ich przygaszenie i opis wskazują, że widoczność blokuje model nadrzędny. Zmiana ustawienia kategorii nie włącza automatycznie modelu.
- W drzewku nie dodajemy akcji **Tylko ten**, **Izoluj** ani kolejnego **Pokaż wszystko**. Istniejący globalny przycisk aplikacji nadal resetuje widoczność i musi aktualizować oba widoki drzewa.
- „Wyłączenie” oznacza całkowite ukrycie geometrii. Regulacja przezroczystości modelu nie jest częścią tego zakresu.
- W pierwszej wersji zakładka Modele kończy się na kategoriach; dalsze poziomy rodzin, typów i instancji nie są potrzebne do tej funkcji.

## 2. Co potwierdzono w aktualnych plikach

Analiza objęła kod Analyzera i odczyt istniejących eksportów. Nie uruchamiano Revita ani nie zmieniano plików eksportu.

### Eksport SnowdonHVAC

Ścieżka: `test-f1c34a6483774b0aa039c23a4f37cd8f/output`.

- `Resource/AECModelData.json` zawiera sześć wpisów `linkedDocuments` z `instanceId` oraz `documentId`.
- W `objects_ids.json.gz` elementy linków mają identyfikatory w postaci `instanceId/UniqueIdElementu`.
- Występuje sześć różnych prefiksów linków. Każdy odpowiada wpisowi `linkedDocuments`; nie znaleziono nieznanego prefiksu.
- Rekord instancji linka pozwala odczytać nazwę pliku z `Type Name` i z nazwy rekordu nadrzędnego. Przykładowo instancja architektury ma `dbId=2961`, a konstrukcji `dbId=3158`.
- Dla czterech wybranych rekordów, obejmujących instancje linków i rekordy z ich prefiksami, potwierdzono zgodność identyfikatorów GZIP z niezależnym odczytem `model.sdb` w trybie `readOnly`.

| Link | Rekordy z prefiksem instancji w bazie |
| --- | ---: |
| Architectural | 33 425 |
| Structural | 8 162 |
| Facades | 4 723 |
| Plumbing | 17 929 |
| Electrical | 11 317 |
| Site | 5 201 |

Są to liczby rekordów właściwości, **nie liczby elementów z geometrią**. Baza zawiera również dane niewidoczne w aktualnym SVF, typy i rekordy pomocnicze. Liczniki drzewa trzeba obliczyć osobno z geometrii aktualnego widoku.

### Eksport Towarowej

Ścieżka: `test-45c1906f53414a94b39d7d7ada66e7c9/output`.

- Baza identyfikatorów zawiera 1 191 147 pozycji poza pozycją zerową; wykryto cztery prefiksy instancji linków, wszystkie zgodne z `linkedDocuments`.
- Rozpoznane pliki: `2213_Budynek_A1_Architektura_Coordinates.rvt`, `26_9000 AFI TOWAROWA A1_2026_central_DESIGN.rvt`, `26_9000 AFI TOWAROWA A1_2026_central_SUPPORTING DESIGN.rvt`, `26_9000 AFI TOWAROWA A1_2026_central_SUPPORTING BIM.rvt`.
- Trzy ostatnie mają ten sam `documentId=0d50a726-866d-4cd1-9dd2-ba3b25a9be91`, ale różne `instanceId` i nazwy plików. Dlatego `documentId` nie może samodzielnie identyfikować grupy modelu.

### Eksport bez linków

W `test-88664312c8384430a8158d4acdd28700/output` lista `linkedDocuments` jest pusta i nie ma prefiksów linków w identyfikatorach. Jest to istniejąca próbka do sprawdzenia wariantu z samym modelem głównym.

### Istotne miejsca w kodzie

- `Analyzer/lib/properties.mjs`: indeksuje `externalId`, `parent`, `typeId` i kategorię; używa dziedziczenia kategorii. Nie indeksuje jeszcze źródłowego modelu.
- `Analyzer/public/viewer.js`: zbiera `geometryIds` z fragmentów w `GEOMETRY_LOADED_EVENT`; to właściwy zakres dla operacji widoczności i liczników.
- `ModelViewer.tree()`: otwiera standardowe rozszerzenie `Autodesk.ModelStructure`, czyli obecne drzewo nie jest własnym komponentem Analyzera.
- `hide()`, `isolate()`, `select(..., true)` i `reset()` bezpośrednio zmieniają widoczność. Nowa funkcja musi współpracować także z nimi i z natywnymi kontrolkami Autodesk.
- Hierarchia `parent` oraz dziedziczenie `typeId` łączą rekordy z różnych źródeł. Sama kategoria ani nazwa gałęzi nie wystarczają do rozpoznania modelu.

## 3. Rozpoznawanie modelu i kategorii

1. Odczytać katalog instancji z `AECModelData.linkedDocuments` oraz odpowiadające rekordy właściwości. Klucz grupy to identyfikator eksportu i pełna ścieżka instancji linka. Nazwa pliku jest etykietą, a `documentId` informacją pomocniczą.
2. Przypisywać elementy przez zweryfikowany prefiks `externalId`, z granicą segmentu `/`. Nie opierać przypisania na `ElementId`, samej nazwie pliku, zakresie numerów `dbId` ani odziedziczonej kategorii.
3. Każde wstawienie linka ma własny wiersz. Gdy nazwy są jednakowe, pokazać dodatkowo identyfikator instancji. Nie scalać linków na podstawie wspólnej nazwy lub `documentId`.
4. Elementy modelu głównego rozpoznawać w zbiorze rzeczywistych elementów geometrii z poprawnym identyfikatorem bez ścieżki linka. Nie oznaczać automatycznie wszystkich nieprefiksowanych rekordów bazy jako geometrii hosta.
5. Rekordy z nieznanym prefiksem, brakującym identyfikatorem lub sprzecznym przypisaniem trafiają do widocznej grupy **Nieustalone źródło**. Brak metadanych nie może spowodować ukrycia elementów ani przypisania nieznanego linka do hosta.
6. Przy braku AEC spróbować potwierdzić instancję przez jej rekord i kategorię identyfikowaną `CategoryId=-2001352`. Nie wymagać angielskiej etykiety `RVT Links`. Bez potwierdzenia zastosować grupę nieustaloną.
7. W obrębie każdej grupy modelu podzielić jej geometrię według kategorii. Preferować numeryczny `CategoryId`, gdy jest dostępny; w pozostałych przypadkach użyć kategorii z obecnego indeksu. Nazwę pobierać z eksportu, brak kategorii prezentować jawnie.
8. Klucz ustawienia kategorii jest złożony: **model + kategoria**. Przykładowo `link-A/ściany` i `link-B/ściany` mają osobne ustawienia.
9. Nie skracać ścieżek przy linkach zagnieżdżonych. W badanych próbkach prefiksy mają jeden poziom; zagnieżdżenia wymagają osobnego testu. Niejednoznacznej ścieżki nie przypisywać na podstawie samej nazwy.

## 4. Widoczność i współpraca z istniejącymi narzędziami

Jedna warstwa sterowania widocznością przechowuje osobno:

- włączenie modelu,
- włączenie kategorii w tym modelu,
- indywidualne ukrycia elementów i aktualną izolację, wykonywane już istniejącymi narzędziami.

Element jest widoczny, gdy pozwalają na to wszystkie odpowiednie ustawienia. Wyłączenie poziomu nadrzędnego nie kasuje ustawień poziomu podrzędnego.

- Nowe oczka i istniejące przyciski Analyzera korzystają ze wspólnej warstwy sterowania.
- Działania natywnego drzewa Autodesk oraz menu kontekstowego są uwzględniane przez zdarzenia widoczności. Obsługa musi odróżniać zdarzenia użytkownika od zdarzeń wywołanych własnym przeliczeniem, aby uniknąć pętli.
- Zakładka Kategorie nadal steruje kategoriami globalnie; jej polecenie kategorii aktualizuje odpowiednie ustawienia we wszystkich grupach modeli. Nie włącza przy tym modelu wyłączonego jego własnym oczkiem. Zakładka Modele ogranicza działanie kategorii do jednego źródła.
- Zmiany wykonywane na dalszych poziomach starego drzewa, np. rodzinach i pojedynczych elementach, zachowują swój zakres i odzwierciedlają się jako częściowa widoczność w nowym drzewie.
- Zwykłe `Zbliż` lub izolacja nie powinny omijać wyłączonego modelu albo jego kategorii. Dla elementu z zablokowanym poziomem nadrzędnym interfejs wskazuje przyczynę braku widoczności; nie włącza po cichu całego linka.
- Istniejące globalne **Pokaż wszystko** usuwa ukrycia i izolację oraz włącza modele i ich kategorie, zachowując pozostałe dotychczasowe zachowanie przycisku.
- Wyłączone elementy mają zniknąć całkowicie; należy jawnie ustalić obsługę ghostingu. Preferowane jest publiczne `setGhosting(false)` i operacje na zbiorach `dbId`, z testem w używanym SDK 7.130.0. Nie zakładać, że domyślne `hide()` usuwa również półprzezroczysty obraz elementów.
- Nie wystarczy odczyt `getHiddenNodes()`: trzeba uwzględnić izolację i ukrycie przodków w drzewie. Weryfikować wynik na elementach geometrii, np. przez `isNodeVisible()`.

## 5. Zakres implementacji po akceptacji

### Etap A — indeks źródeł i kategorii

- Dodać moduł indeksowania źródeł, korzystający z obecnego `PropertyStore`, bez drugiego wczytywania wszystkich plików właściwości.
- Rozszerzyć API o katalog modeli oraz zwarte przypisania numerycznych `dbId` do źródeł i kategorii. Nie przesyłać pełnych parametrów każdego elementu na potrzeby drzewa.
- Po wczytaniu geometrii przeciąć przypisania z `geometryIds`. Model/kategoria z zerową liczbą elementów w widoku nie ma aktywnego oczka; model może pozostać na liście z opisem „Brak geometrii w tym widoku”.
- Węzły pomocnicze bez geometrii nie są elementami liczników. Liczniki, jeśli zostaną pokazane, odnoszą się do geometrii bieżącego widoku.

### Etap B — drzewo Modele

- Dodać zakładki Kategorie / Modele w obszarze drzewa oraz własną, lekką zawartość Modele z rozwijanymi kategoriami i oczkami.
- Zachować istniejącą obsługę kategorii, rodzin i typów. Integrację panelu oprzeć na rozszerzeniu `Autodesk.ModelStructure` i własnym komponencie, bez podmieniania kodu SDK lub manipulowania jego wewnętrznym DOM.
- Na początku wdrożenia sprawdzić integrację panelu w SDK 7.130.0. Dokumentacja Autodesk pokazuje punkt rozszerzenia `setModelStructurePanel`; zgodność własnych zakładek z aktualnym panelem wymaga krótkiej próby technicznej.
- Zapewnić obsługę klawiatury, opisy oczek, czytelne długie nazwy plików oraz rozróżnienie modelu głównego od linków.
- Nie dodawać osobnego filtrowania tabeli Dane, eksportu CSV według modelu ani panelu przezroczystości.

### Etap C — sterowanie i cykl życia

- Wydzielić stan widoczności oraz adapter do Viewera; uwzględnić reguły z punktu 4.
- Przeliczać zbiory na podstawie gotowych indeksów. Kliknięcie oczka nie skanuje ponownie całej bazy właściwości i nie wykonuje żądania dla każdego elementu.
- Operacje przekazywać do SDK zbiorczo; aktualizacje ikon po serii zdarzeń scalać. Nie budować tysięcy wierszy elementów, skoro UI potrzebuje modeli i kategorii.
- Przy zmianie eksportu/widoku usuwać stare nasłuchy i mapowania oraz odrzucać spóźnione wyniki przez identyfikator ładowania.
- Pierwsza wersja przechowuje ustawienia w pamięci aktualnie otwartego widoku. Zmiana widoku lub eksportu resetuje je; zapis presetów między sesjami jest poza zakresem.

Przewidywane pliki: nowe moduły źródeł i widoczności, `lib/properties.mjs`, `server.mjs`, `public/viewer.js`, `public/app.js`, `public/index.html`, `public/style.css`, testy i README. Nie jest potrzebna zmiana eksportera ani formatów plików źródłowych.

## 6. Weryfikacja i kryteria odbioru

1. **Poprawne źródła:** na Snowdon rozpoznać model główny i sześć linków; na Towarowej cztery odrębne linki, również trzy mające wspólny `documentId`; na próbce bez linków tylko model główny.
2. **Pokrycie geometrii:** każdy `dbId` z geometrią ma dokładnie jedną grupę źródła i jedną kategorię albo jawny brak rozpoznania. Suma grup nie gubi i nie dubluje geometrii. Oddzielnie policzyć nieustalone przypadki.
3. **Oczko modelu:** wyłączenie usuwa całą jego geometrię bez ghostingu i bez zmiany pozostałych modeli. Włączenie odtwarza stan jego kategorii.
4. **Oczko kategorii:** znaleźć kategorię obecną w co najmniej dwóch modelach; wyłączyć ją tylko w jednym i potwierdzić, że drugi pozostaje widoczny.
5. **Zachowanie ustawień:** wyłączyć kategorię, wyłączyć model, włączyć model — kategoria nadal wyłączona. Analogicznie sprawdzić pojedynczy ukryty element.
6. **Dwie zakładki:** zmiana lokalna pokazuje częściowy stan kategorii globalnej; globalna zmiana kategorii aktualizuje jej ustawienia we wszystkich modelach, pozostawiając wyłączone modele wyłączone.
7. **Istniejące narzędzia:** ukrycie/izolacja elementu, dalsze poziomy drzewa Autodesk, menu kontekstowe, wybór z tabeli, przybliżenie i globalny reset nie rozjeżdżają ikon ze sceną. Przywrócenie wszystkiego włącza oba poziomy drzewa.
8. **Nietypowe dane:** testy dla identycznych nazw plików, dwóch wstawień tego samego linka, wspólnego `documentId`, błędnego lub brakującego AEC, brakującej kategorii, zagnieżdżonej ścieżki i nierozpoznanego identyfikatora. Dla przypadków nieobecnych w próbkach zastosować małe syntetyczne dane, a zagnieżdżenia dodatkowo sprawdzić na rzeczywistym eksporcie, gdy będzie dostępny.
9. **Zmiana widoku:** szybkie przełączanie eksportów nie przenosi masek ani spóźnionych odpowiedzi do nowego modelu; rekordy bez geometrii nie powodują pozornie działających przełączników.
10. **Wydajność:** zmierzyć budowę indeksu, wielkość danych API, pamięć i reakcję na oczko na Towarowej. Nie wyciągać wniosków o wydajności dużego eksportu wyłącznie z małej próbki Snowdon.
11. **Kontrola końcowa:** `npm run check`, odpowiednie testy indeksowania i stanów widoczności, istniejące testy integracyjne, a następnie przeglądarka z kompletnie wczytaną geometrią. Sprawdzić konsolę oraz brak zmian w źródłowych plikach eksportu.

## 7. Granica obecnej weryfikacji

Poniższy opis dotyczy etapu analizy przed akceptacją. Implementacja korzysta z gałęzi kategorii rzeczywistego drzewa Viewera (z kategorią właściwości jako wariantem zapasowym), aby poprawnie obejmować zagnieżdżone części elementów. Panel jest rozszerzony przez `setModelStructurePanel`; lokalny delegat renderowania odzwierciedla częściową widoczność w starym drzewie. Nie zmieniono plików SDK. Wyniki wdrożenia i ograniczenia są zapisane w osobnym raporcie weryfikacji.

Potwierdzono strukturę danych, zgodność prefiksów z instancjami linków w dwóch eksportach z linkami, wariant bez linków, nazwy linków, kolizję `documentId` i miejsca integracji w kodzie. Istnieją podstawy do wdrożenia funkcji na obecnych eksportach bez uruchamiania Revita.

Nie zaimplementowano nowego indeksu, masek widoczności ani interfejsu. Nie przeprowadzono jeszcze próby nowej funkcji w przeglądarce, pełnego przypisania fragmentów SVF do grup ani pomiarów przełączania. Dlatego dane o liczbie rekordów nie są potwierdzeniem liczby widocznych elementów, a zachowanie SDK z nowymi zakładkami pozostaje testem etapu wdrożenia.

Źródła integracji:

- Autodesk: [rozszerzanie panelu drzewa przez Autodesk.ModelStructure](https://aps.autodesk.com/blog/viewer-selection-highlighting).
- Autodesk: [dostosowywanie ModelStructurePanel](https://aps.autodesk.com/blog/customizing-modelstructurepanel-behavior-forge-viewer).
- Autodesk: [ukrywanie a ghosting](https://aps.autodesk.com/blog/hidding-completely-viewer-nodes-no-ghosting). Starszy artykuł służy do identyfikacji pułapki; użycie wewnętrznego `visibilityManager` z jego przykładu nie jest założeniem tego planu.
