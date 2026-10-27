# Lean-presentatie

Een presentatie in de browser die eruitziet als een whiteboard tussen twee flip-overs:

- **Links:** flip-over met tips. Deze is eerst leeg en vult zich tijdens de presentatie.
- **Midden:** whiteboard met bovenaan de doelen (met aankruisvakjes), daaronder *To do / Doing / Done* (de geeltjes zijn de onderwerpen) en onderaan een zone voor vragen aan de zaal. De werkafspraken verschijnen op verzoek over het bord heen.
- **Rechts:** flip-over met steekwoorden. Elk vel begint met alleen zijn titel en vult zich per klik.

Alles draait in de browser: geen server, geen build-stap, geen afhankelijkheden. De inhoud staat versleuteld in `content.enc.json` en wordt pas na invoer van het wachtwoord in de browser ontsleuteld (PBKDF2-SHA256 met 600.000 iteraties, AES-256-GCM, via de Web Crypto API).

## Bestanden

| Bestand | Wat | In git? |
|---|---|---|
| `index.html`, `css/`, `js/` | De motor | Ja |
| `fonts/` | Lettertypen met hun licenties | Ja |
| `img/` | Afbeeldingen voor op het whiteboard, **versleuteld**: `naam.enc.png` of `naam.enc.jpg` (kleine letters), met dezelfde sleutel als `content.enc.json` | Alleen `*.enc.png` en `*.enc.jpg` |
| `img/naam.png`, `img/naam.jpg` | Een afbeelding onversleuteld: een nieuwe die nog niet versleuteld is, of teruggezet door `--decrypt` | **Nee** (staat in `.gitignore`) |
| `img_demo/` | De afbeeldingen van de demo, onversleuteld (openbaar, net als `content.example.json`) | Ja |
| `js/zip.js` | Zip-bestanden maken (voor de export) en lezen | Ja |
| `content.example.json` | Voorbeeldinhoud | Ja (niet gevoelig) |
| `content.json` | Onversleutelde inhoud, alleen als tussenstap om met de hand te bewerken (zie hieronder) | **Nee** (staat in `.gitignore`) |
| `content.enc.json` | **De inhoud**, versleuteld. Dit is altijd de huidige versie: de motor laadt hem en de export op het afsluitscherm vervangt hem | Ja |
| `tools/encrypt.js` | Versleutelscript (Node.js 20 of nieuwer) | Ja |

## Werkwijze

`content.enc.json` (met de versleutelde afbeeldingen in `img/`) is altijd de huidige inhoud. Je bewerkt hem in de browser (`?edit`) en exporteert hem versleuteld op het afsluitscherm, als zip; uitgepakt over de projectmap heen vervangt die `content.enc.json` en de afbeeldingen. Er is geen onversleutelde export.

```bash
# Eén keer: beginnen met de voorbeeldinhoud (en de voorbeeldafbeeldingen)
cp content.example.json content.json
mkdir -p img && cp img_demo/* img/
node tools/encrypt.js            # vraagt twee keer om het wachtwoord → content.enc.json en img/*.enc.png
rm content.json img/*.png img/*.jpg   # niet meer nodig (de .enc-bestanden blijven): vanaf nu is content.enc.json de inhoud

# Bekijken en bewerken
npx serve .                      # of: npm run serve
#    → http://localhost:3000        de presentatie (met wachtwoord)
#    → http://localhost:3000/?edit  bewerken; op het afsluitscherm versleuteld exporteren
#    → http://localhost:3000/?demo  de demo: content.example.json, zonder wachtwoord

# Na een export: de zip (presentatie-JJJJ-MM-DD.zip) uitpakken over de projectmap heen, dan publiceren
git add content.enc.json img && git commit -m "Inhoud bijgewerkt" && git push
```

Liever met de hand in de JSON werken? Ontsleutel dan eerst naar `content.json` (dat zet ook de afbeeldingen onversleuteld terug in `img/`), bewerk die, versleutel opnieuw (inhoud én alle afbeeldingen die de inhoud gebruikt) en verwijder de onversleutelde bestanden weer:

```bash
node tools/encrypt.js --decrypt content.enc.json > content.json
node tools/encrypt.js
rm content.json img/*.png img/*.jpg
```

**Een nieuwe afbeelding:** upload hem in de bewerkmodus met de knop **Afbeeldingen** (zie hieronder), of zet `kat.png` (of `.jpg`) onversleuteld in `img/` (Git negeert hem); gebruik dan `@kat …` in de bewerkmodus. De bewerkmodus valt terug op het onversleutelde bestand zolang er geen `img/kat.enc.png` is; de export versleutelt hem mee. Daarna kan `img/kat.png` weg. De presentatie zelf (zonder `?edit`) laadt nooit onversleutelde afbeeldingen: een vergeten afbeelding valt dus meteen op ("niet gevonden"), in plaats van onversleuteld online te staan. Een afbeelding die je niet meer gebruikt, komt niet in de export; het oude `.enc`-bestand verwijder je zelf.

Controleren wat er in een versleuteld bestand staat: `node tools/encrypt.js --decrypt content.enc.json`.

In CI kan het wachtwoord via een omgevingsvariabele: `PRESENTATIE_WACHTWOORD=... node tools/encrypt.js`.

**Demo (`?demo`):** de link **Demo bekijken** op het loginscherm opent `?demo`: de voorbeeldinhoud uit `content.example.json` met de afbeeldingen uit `img_demo/`, zonder wachtwoord. Die staat al onversleuteld in de repository, dus de demo maakt niets openbaar wat dat nog niet was; hij laadt nooit een ander bestand. De demo is altijd de gewone live-modus, met in de bedieningsbalk een geel label "Demo": met `?demo` in de adresbalk telt `?edit` niet, en in de bewerkmodus staat de link niet op het loginscherm. Tips toevoegen en de PDF werken zoals altijd, maar exporteren kan in de demo niet: op het afsluitscherm staat alleen de PDF-knop, en de browser waarschuwt bij sluiten ook niet (er valt niets te bewaren).

**Wachtwoord:** versleutel de inhoud met een lang, geheim wachtwoord (16+ tekens). Zet het wachtwoord nergens in de repository (niet in de README, code, commitberichten of scripts), maar deel het buiten Git om.

## Inhoud (de JSON)

```json
{
  "title": "Lean in de praktijk",
  "agreements": ["Telefoons op stil", "Vragen mogen altijd"],
  "goals": [
    { "id": "doel1", "text": "Verspilling herkennen" },
    { "id": "doel2", "text": "Morgen een eerste stap zetten" }
  ],
  "topics": [
    {
      "sticky": "De 8 verspillingen",
      "sheets": [
        {
          "title": "Acht soorten verspilling",
          "steps": [
            [
              { "type": "question", "text": "Welke verspilling zie jij het vaakst?" }
            ],
            [
              { "type": "keyword", "text": "TIMWOODS" }
            ],
            [
              { "type": "keyword", "text": "Transport", "indent": 1, "numbered": true },
              { "type": "keyword", "text": "Inventory", "indent": 1, "numbered": true },
              { "type": "keyword", "text": "Motion",    "indent": 1, "numbered": true },
              { "type": "keyword", "text": "Waiting",   "indent": 1, "numbered": true }
            ],
            [
              { "type": "keyword", "text": "Begin bij wachten", "gap": "line", "color": "red" },
              { "type": "tip", "text": "Wachten is de makkelijkste om te zien" },
              { "type": "check", "goal": "doel1" }
            ]
          ]
        }
      ]
    }
  ]
}
```

- `title` (**verplicht**): titel van de presentatie. Zonder (of leeg) is een **fout**. Staat op het startscherm onder "WELKOM" en in het browsertabblad (beide pas na het ontsleutelen).
- `agreements`: werkafspraken. Standaard verborgen; met de knop **Werkafspraken** in de bedieningsbalk (of de toets W) verschijnen ze over het hele whiteboard heen. Zonder `agreements` is er geen knop.
- `goals`: de doelen van de presentatie, **hooguit 4**. Ze staan de hele presentatie bovenaan het whiteboard, elk met een leeg aankruisvakje. Elk doel heeft een `id` en een `text`. De ids liggen vast: `doel1`, `doel2`, `doel3` en `doel4`, op volgorde en zonder gaten (twee doelen zijn dus altijd `doel1` en `doel2`); hoofdletters maken niet uit. De id bepaalt het vak in de strook: `doel1` linksboven, `doel2` rechtsboven, `doel3` linksonder, `doel4` rechtsonder. De tekst is hooguit **100 tekens**: dan passen vier doelen nog, met kleinere letters, leesbaar op een laptopscherm van 1920×1080. Zonder `goals` is er geen doelenstrook en krijgt het kanbanbord die ruimte.
- `topics`: de onderwerpen, in volgorde. Elk onderwerp is één geeltje. **Hooguit 6**: gemeten op 1920×1080 passen er dan 2 geeltjes naast elkaar met letters van zo’n 24–26px op het scherm; vanaf 7 worden het er 3 per rij en de letters 14px of kleiner. Meer geeft een waarschuwing (geen fout).
- `sheets`: de vellen op de rechter flip-over. Elk vel heeft:
  - `title` (**verplicht**): de titel bovenaan het vel, in blauwe markerletters met een blauwe lijn eronder. De titel staat er altijd, ook als het vel verder nog leeg is.
  - `steps`: de klikken van het vel, in volgorde. **Elke step is één klik** en is een lijst van één of meer items, die bij die klik tegelijk verschijnen (kort na elkaar "geschreven"). Na de laatste step volgt bij de volgende klik een nieuw vel (met omslaggeluid) of een nieuw onderwerp.

### Items

| `type` | Waar | Eigenschappen naast `text` |
|---|---|---|
| `keyword` | Rechts op het vel, onder de titel | `color`, `indent`, `numbered`, `gap` (zie hieronder) |
| `tip` | Links, onderaan de lijst met tips; met een belletje | `user`: `true` als de tip tijdens de presentatie is toegevoegd (rood plusje in plaats van een ster). Dat zet de presentatie zelf; opslaan in de bewerkmodus maakt er weer een gewone tip van. |
| `question` | In de vraagzone onderaan het whiteboard; met een opgaande toon | — |
| `check` | Vinkt een doel af: in het vakje bij dat doel wordt een groen vinkje getekend, met een schrijfgeluidje | `goal`: de `id` van het doel (geen `text`) |
| `pin` | Hangt een afbeelding op het whiteboard: een vel papier met twee magneten (zie "Afbeelding op het whiteboard" hieronder) | `image`: de naam, zonder extensie (**verplicht**); `text`: beschrijving voor schermlezers, niet in beeld (**verplicht**); `paper`: `"A3"` (alleen liggend), `"A4"` of `"A5"`; zonder `paper` kiest de app zelf (zie hieronder) |
| `unpin` | Haalt de afbeelding weer van het whiteboard | — |

Eigenschappen van een `keyword` (allemaal optioneel):

- `color`: markerkleur: `blue`, `red`, `black`, `green`, `yellow`, `orange`, `purple` of `pink`. Zonder `color` is het blauw. Alle kleuren zijn donker genoeg om goed leesbaar te zijn op het papier (contrast minstens 4,5:1); geel en oranje zien er daarom uit als okergele en donkeroranje marker.
- `indent`: `0`, `1` of `2`: hoe ver het steekwoord inspringt. Het opsommingsteken verschilt per niveau: rode stip, kleinere rode stip, rood streepje.
- `numbered`: `true` voor een nummer in plaats van het opsommingsteken. De nummers telt de presentatie zelf: opeenvolgende genummerde steekwoorden op hetzelfde niveau tellen door (ook over klikken heen); een steekwoord zonder nummer op dat niveau, of een dat minder ver inspringt, laat de telling daarna weer bij 1 beginnen. Dieper ingesprongen steekwoorden onderbreken de telling niet.
- `gap`: `"space"` voor witruimte of `"line"` voor een dikke blauwe lijn **boven** dit steekwoord. Niet op het eerste steekwoord van een vel (daar staat niets boven): dat is een **fout**, en de presentatie negeert de `gap` dan.

Regels:

- Een step heeft hooguit één `question`. De vraag staat er zolang die klik de laatste is, en verdwijnt bij de volgende klik weer.
- Een afbeelding (`pin`) blijft hangen, ook op latere vellen en onderwerpen, tot een `unpin` of een volgende `pin` (die vervangt hem; er is geen stapel). Blader je terug tot vóór de klik, dan hangt er weer wat er toen hing. Een step heeft hooguit één `pin` of `unpin`. Ook hier is de controle streng: een ongeldige naam (alleen letters, cijfers, `-` en `_`; hoofdletters worden kleine letters), een ontbrekende beschrijving of een ander `paper` dan A3, A4 of A5 is een **fout**. `tools/encrypt.js` controleert ook of `img/<naam>.png` of `.jpg` bestaat (onversleuteld, om te versleutelen), met precies die schrijfwijze (GitHub Pages onderscheidt hoofdletters); de export in de browser controleert of hij de afbeelding kan laden.
- Een afgevinkt doel blijft afgevinkt, ook op latere vellen en onderwerpen. Blader je terug tot vóór de klik met de `check`, dan is het vakje weer leeg. De controle op doelen is streng: een andere `id` dan `doel1`–`doel4` (of niet op volgorde), een lege of te lange tekst, een vijfde doel, een `check` met een `goal` die geen bestaand doel is, en een doel dat al eerder wordt afgevinkt (in de volgorde van de presentatie; een doel vink je maar één keer af), zijn allemaal **fouten**. `tools/encrypt.js` weigert dan te versleutelen; de presentatie slaat het over en meldt het in de console.
- Elke tekst is één regel: een regeleinde in een tekst (ook in titels, namen van geeltjes, doelen en werkafspraken) wordt bij het inlezen één spatie, met een melding. `tools/encrypt.js` versleutelt de verbeterde tekst.
- Per klik klinkt elk geluid hooguit één keer (één belletje, ook bij meerdere tips).
- Een onbekend type, een item zonder tekst, een lege step of een ongeldige eigenschap geeft een melding en wordt overgeslagen of krijgt de standaardwaarde. `tools/encrypt.js` meldt dit al bij het versleutelen, en de motor geeft een waarschuwing in de console. Beide gebruiken dezelfde controle uit `js/content.js`.
- Een vel zonder titel, of iets wat geen vel is, is een **fout**: `tools/encrypt.js` weigert dan te versleutelen en noemt welk vel het is. De presentatie toont zo'n vel wel (met een lege titel en een foutmelding in de console), zodat je kunt doorwerken; versleuteld exporteren weigert het, net als `tools/encrypt.js`.

Nieuwe soorten items toevoegen: zie `ITEM_TYPES` in `js/content.js` en de functies `keywordsAt`, `tipsAt`, `questionAt`, `checkedGoalsAt` en `pinnedAt` in `js/app.js`. Voor de bewerkmodus ook de tekstnotatie in `js/sheet-text.js` (`stepsToText` en `textToSteps`).

## Bediening

| Actie | Toetsen |
|---|---|
| Volgende klik | → ↓ PageDown (presenter) |
| Vorige klik | ← ↑ PageUp (presenter) |
| Eerste / laatste inhoud | Home / End (niet naar het start- of afsluitscherm) |
| Beginnen | Volgende op het startscherm (de knop heet dan **Start ›**) |
| Naar het afsluitscherm | Volgende op de laatste inhoud (de knop heet dan **Einde ›**) |
| Volledig scherm | F |
| Steekwoord aanwijzen | Klik op een steekwoord op de rechter flip-over (nog eens klikken of Esc: weg); niet in de bewerkmodus |
| Werkafspraken tonen / verbergen | **W** of de knop **Werkafspraken** (Esc verbergt ze ook) |
| Naar een onderwerp | Klik op een geeltje |
| Tip toevoegen | **T** of klik op **+** op de Tips-flip-over, typ, Enter (Esc = annuleren); niet in de bewerkmodus |
| Vellen als PDF | Knop **Vellen opslaan als PDF** op het afsluitscherm, of Ctrl+P |
| Bewerken (bewerkmodus) | Geen eigen sneltoetsen: alles wat je kunt bewerken is een knop. Klik erop, of ga er met **Tab** / **Shift+Tab** naartoe en druk op **Enter** of **spatie** (zoals bij elke knop). In een tekstvak: opslaan Ctrl+Enter, annuleren Esc. In een invoerveld (titel, naam, doel): opslaan Enter, annuleren Esc. |

Na het inloggen opent de presentatie op een donker startscherm met "WELKOM". Daar werken alleen **Start** (knop, pijl rechts, pijl omlaag of PageDown) en volledig scherm (F); vorige, Home/End en tip toevoegen doen niets. Terug vanaf de eerste inhoud brengt je weer op het startscherm.

**Tips tijdens de presentatie:** een tip die je met het plusje toevoegt, komt als gewoon item met `"user": true` in de huidige klik (heb je op dit vel nog niets geklikt, dan wordt het een nieuwe eerste klik). Hij krijgt een rood plusje. Blader je terug tot vóór die klik, dan verdwijnt hij; vooruit verschijnt hij weer. Toegevoegde tips staan alleen in het geheugen; bewaar ze via het afsluitscherm, dan verschijnen ze na opnieuw laden bij dezelfde klik.

**Bewerken (`?edit`):** zet `?edit` in de adresbalk (bijvoorbeeld `http://localhost:3000/?edit`). De bewerkmodus werkt altijd met de versleutelde inhoud en het wachtwoord. In de bedieningsbalk staan dan een geel label "✎ Bewerken" en de knop **Vel bewerken**. Je bewerkt een vel in één keer, als tekst: klik ergens op de rechter flip-over of op **Vel bewerken**. Alles wat je in de bewerkmodus kunt bewerken (titels, het geeltje in Doing, de doelen, de werkafspraken) is een knop: met Tab te bereiken, en Enter of spatie doet hetzelfde als een klik. De app vangt Enter en spatie zelf nergens af. Over het vel verschijnt dan één groot tekstvak met alle klikken van het vel, de focus erin.

**Titel van een vel:** die staat niet in het tekstvak. Klik op de titel bovenaan het vel (of ga er met Tab naartoe en druk op Enter of spatie): de titel wordt een invoerveld op dezelfde plek. **Enter** of wegklikken slaat op, **Esc** annuleert. Een vel heeft altijd een titel: leeg opslaan geldt als annuleren. Het invoerveld neemt hooguit 40 tekens aan (dat is hooguit drie regels; een langere titel drukt de steekwoorden weg). Een langere titel uit de JSON blijft staan; alleen typen stopt bij 40.

**Titel van de presentatie:** werkt precies zo, op het startscherm: klik op de titel onder "WELKOM" (of Tab ernaartoe en Enter of spatie), typ, en druk op Enter of klik weg; Esc annuleert, leeg opslaan ook. De nieuwe titel staat meteen ook in het tabblad en gaat mee in de download ("de titel van de presentatie gewijzigd"). Staat er geen titel in de JSON, dan toont de bewerkmodus "Presentatie" om op te klikken.

**Onderwerpen (geeltjes):** je bewerkt alleen het huidige onderwerp, het geeltje in Doing.

- **Naam wijzigen:** klik op het geeltje in Doing (of ga er met Tab naartoe en druk op Enter of spatie). Het geeltje wordt een invoerveld (hooguit 30 tekens: zo blijven de letters op het geeltje groot genoeg); Enter of wegklikken slaat op, Esc annuleert, leeg opslaan ook. Een klik op een ander geeltje gaat, net als live, naar dat onderwerp.
- **Toevoegen:** "+ Onderwerp" onder het geeltje in Doing. Het nieuwe onderwerp komt na het huidige, met één leeg vel "Nieuw vel"; het huidige onderwerp gaat naar Done en het nieuwe staat in Doing. De naam "Nieuw onderwerp" staat meteen open: typ de naam en druk op Enter. Daarna opent het tekstvak van het nieuwe vel, met de focus erin. **Esc** of een lege naam maakt het toevoegen ongedaan. Bij 6 onderwerpen is de knop uitgeschakeld.
- **Verwijderen:** "Onderwerp verwijderen" verwijdert het huidige onderwerp met al zijn vellen. Staat er iets op, dan vraagt een venster eerst om bevestiging, met het aantal vellen, klikken, tips, afbeeldingen en afgevinkte doelen. Daarna sta je op het laatste vel van het vorige onderwerp (helemaal ingevuld), of bij het eerste onderwerp op het begin van het volgende; dat onderwerp hangt dan in Doing. Er blijft altijd minstens één onderwerp: bij het laatste is de knop uitgeschakeld.
- **Verplaatsen:** links en rechts van het geeltje in Doing staat een kleine ronde pijl. ◀ zet het huidige onderwerp een plek eerder, ▶ een plek later, met al zijn vellen en alles wat erop staat; het geeltje blijft in Doing, en het geeltje waarmee het van plek wisselt gaat van Done naar To do (◀) of andersom (▶). ◀ werkt niet bij het eerste onderwerp, ▶ niet bij het laatste.
- Toegevoegde, verwijderde en hernoemde en verplaatste onderwerpen gaan mee in de export op het afsluitscherm.

**Vellen toevoegen en verwijderen:** met de knoppen **Vel toevoegen** en **Vel verwijderen** in de bedieningsbalk.

- **Toevoegen:** er komt een nieuw, leeg vel direct na het huidige vel, bij hetzelfde onderwerp, en de presentatie gaat ernaartoe. De titel staat meteen open als invoerveld, met "Nieuw vel" geselecteerd: typ de titel en druk op Enter (of klik weg). Daarna opent meteen het tekstvak van het vel, met de focus erin. **Esc** of een lege titel maakt het toevoegen ongedaan: het vel verdwijnt en je staat weer waar je was.
- **Verwijderen:** het huidige vel verdwijnt. Staat er iets op, dan vraagt een venster eerst om bevestiging, met het aantal klikken, tips, afbeeldingen en afgevinkte doelen; die verdwijnen mee. Daarna sta je op het vorige vel van hetzelfde onderwerp (helemaal ingevuld), of op het volgende als het het eerste was. Is het het enige vel van zijn onderwerp, dan verdwijnt het onderwerp ook; daarom vraagt het venster dan altijd om bevestiging (ook bij een leeg vel) en zegt het dat erbij. Daarna sta je waar je ook na "Onderwerp verwijderen" staat. Alleen het enige vel van de hele presentatie kan niet weg: de knop is dan uitgeschakeld.
- **Verplaatsen:** links en rechts van de titel van het vel, in de marge, staat een kleine ronde pijl. ◀ zet het vel een plek eerder, ▶ een plek later, met alles wat erop staat (steekwoorden, vragen, tips en afvinkmomenten). Aan het begin of eind van een onderwerp gaat het vel, na een bevestiging, naar het vorige onderwerp (als laatste vel) of het volgende (als eerste vel). Verplaats je zo het enige vel van een onderwerp, dan verdwijnt dat (lege) onderwerp; de bevestiging zegt dat erbij. Voor het eerste en laatste vel van de presentatie werkt de pijl naar buiten niet. Je blijft op hetzelfde vel en dezelfde klik; een korte melding zegt waar het vel nu staat.
- Toegevoegde, verwijderde en verplaatste vellen gaan mee in de export op het afsluitscherm ("1 vel toegevoegd", "1 vel verwijderd", "de volgorde van de vellen gewijzigd").

- **Opslaan** (of Ctrl+Enter) verwerkt alles in één keer; daarna is het hele vel in beeld. **Annuleren** (of Esc) gooit alle wijzigingen weg. Wegklikken doet niets, en zolang het tekstvak open is kun je niet bladeren: de pijlen en de geeltjes zijn dan uitgeschakeld en de bladertoetsen doen niets.
- Eén item per regel. Onder het tekstvak staat dezelfde uitleg kort samengevat; die is algemeen en noemt niets uit de inhoud van de presentatie:

| Regel | Wordt |
|---|---|
| `* tekst`, `- tekst` of `• tekst` | steekwoord met bullet; welke bullet volgt uit het inspringen |
| `1. tekst` (elk getal vanaf 1) | genummerd steekwoord; de presentatie nummert zelf, het getal telt niet |
| 2 spaties ervoor / 4 of meer | 1× / 2× inspringen (een tab telt als 2 spaties) |
| `[red]` of `[rood]`, waar dan ook op de regel | kleur van het steekwoord: `blue`, `red`, `black`, `green`, `yellow`, `orange`, `purple`, `pink`. De Nederlandse namen (`blauw`, `rood`, `zwart`, `groen`, `geel`, `oranje`, `paars`, `roze`) werken ook; hoofdletters maken niet uit. Het eerste kleurlabel telt; alle kleurlabels verdwijnen uit de tekst. Het tekstvak en de uitleg eronder gebruiken de Engelse namen. |
| lege regel | witruimte boven het volgende steekwoord |
| `---` (3 of meer) | lijn boven het volgende steekwoord |
| `->`, `-->` of `→` | nieuwe klik |
| `? tekst` | vraag op het whiteboard; een tweede vraag in dezelfde klik begint vanzelf een nieuwe klik |
| `! tekst` | tip op de linker flip-over |
| `+doel1` t/m `+doel4` | vinkt dat doel af (hoofdletters maken niet uit); een doel dat er niet is, blijft gewone tekst. Een doel vink je maar één keer af: wordt het al op een ander vel (of eerder op dit vel) afgevinkt, dan valt het bij opslaan weg, met een melding waar het al staat |
| `@naam beschrijving` | hangt afbeelding `naam` (zie hierboven: `img/naam.enc.png`, `.enc.jpg`, of nog onversleuteld `img/naam.png`) op het whiteboard, in een formaat dat de app kiest (zie "Een afbeelding" hieronder). De beschrijving is verplicht en alleen voor schermlezers. `@naam [A3] beschrijving`, `[A4]` of `[A5]` (direct na de naam; hoofdletters maken niet uit): dat formaat. Een tweede afbeelding in dezelfde klik begint vanzelf een nieuwe klik. Zonder geldige naam of beschrijving slaat **Opslaan** niet op, maar meldt het wat er mist (het tekstvak blijft open) |
| `@-` | haalt de afbeelding weg |
| elke andere regel | steekwoord met bullet |

- Wat na `*`, `-`, `•` of een nummer staat is gewone tekst: `* ? geen vraag` is een steekwoord. Een onbekende kleur of doel-id blijft gewoon tekst; een geldig kleurlabel wordt overal weggehaald (ook uit een vraag of tip), dus `[rood]` kun je niet letterlijk als tekst gebruiken.
- Een regel met alleen codes en geen tekst, zoals `* [rood]`, `?`, `!`, `1.` of `+`, wordt overgeslagen.
- Onzichtbare tekens aan het begin en eind van een regel (zero-width space, BOM, richtingstekens, zacht afbreekstreepje) tellen niet mee; een regel met alleen zulke tekens is een lege regel. Een losse `\r` en de Unicode-regelscheidingen U+2028 en U+2029 (soms meegeplakt uit Word of een pdf) zijn een nieuwe regel.
- Ruimte en lijnen gelden alleen vóór een steekwoord: vóór een vraag, tip, doel, afbeelding of klik en bovenaan het vel vervallen ze. Meerdere lege regels, lijnen of klikken achter elkaar tellen als één (een lijn wint van witruimte); een klik aan het begin of eind telt niet.
- Kleur en inspringen op een vraag, tip of doel worden genegeerd. Tips worden bij opslaan altijd gewone tips (zonder `"user": true`): in de bewerkmodus presenteer je niet.
- **Afbeeldingen** upload je met de knop **Afbeeldingen** in de bedieningsbalk, of zet je zelf onversleuteld in `img/` (de export versleutelt ze). Een kleurlabel in de beschrijving van een afbeelding blijft gewoon tekst. Hangt er een afbeelding, dan is die in de bewerkmodus doorzichtig en klik je er dwars doorheen, zodat de doelen en geeltjes eronder te bewerken blijven.

**Afbeeldingen (bewerkmodus):** de knop **Afbeeldingen** in de bedieningsbalk opent een venster met miniaturen: alle geüploade afbeeldingen en alle namen die de inhoud ophangt. Een naam waarvan het bestand ontbreekt of niet te ontsleutelen is, staat er ook, met een grijs vlak en "ontbreekt", zodat je hem kunt vervangen of verwijderen. Onder elke miniatuur staan de code (`@naam`), of hij geüpload is, hoe vaak hij wordt opgehangen en de afmetingen in pixels.

- **Klik op een miniatuur** kopieert de code (`@naam` en een spatie), om in het tekstvak van een vel te plakken.
- **Afbeelding uploaden** (PNG of JPG, ook meerdere tegelijk): de naam komt uit de bestandsnaam, in kleine letters, zonder accenten, met een streepje voor spaties en andere tekens ("Mijn Kat.PNG" wordt `@mijn-kat`). Bestaat die naam al, dan vraagt een venster **Vervangen** of **Annuleren** (de focus staat op Annuleren). Een upload staat alleen in het geheugen, is meteen te gebruiken en gaat bij de export versleuteld mee, als de inhoud hem gebruikt. Er is geen grens aan de grootte.
- **Verwijderen** (onder elke miniatuur, na een vraag): de afbeelding verdwijnt uit de lijst, en elk ophangen ervan uit de inhoud. Een klik die daardoor leeg wordt, valt weg. Het weghalen (`@-`) dat daarna niets meer doet, blijft staan tot de export: die laat elk weghalen weg waarbij het whiteboard al leeg is. Een versleuteld bestand in de projectmap verwijder je zelf.
- Uploads en vervangingen tellen als wijziging: het afsluitscherm toont dan de exportknop ("afbeeldingen geüpload of vervangen"), en de browser waarschuwt bij sluiten tot je hebt geëxporteerd.
- **Tips** bewerk en voeg je alleen zo toe, via het vel waar ze bij horen. Het plusje op de Tips-flip-over is in de bewerkmodus weg, en een klik op een tip links geeft een melding op welk vel die tip staat.
- Onderdelen die je niet verandert, blijven precies wat ze waren; op het afsluitscherm tellen alleen echte wijzigingen mee (ook een gewijzigde veltitel).

**Doelen bewerken:** de doelen staan altijd bovenaan het whiteboard. Klik op de tekst van een doel (of ga er met Tab naartoe en druk op Enter of spatie): die wordt een invoerveld op dezelfde plek. **Enter** of wegklikken slaat op, **Esc** annuleert. Bij aanwijzen, focus en bewerken staat linksboven bij het doel klein zijn code (`+doel2`): die typ je in een vel om het doel af te vinken.

- **Toevoegen** kan alleen op het eerstvolgende lege vak: daar staat "+ Doel toevoegen". Bij vier doelen is er geen leeg vak meer.
- **Verwijderen:** maak de tekst leeg en sla op. Wordt het doel ergens afgevinkt, dan vraagt een venster eerst of het echt weg moet, met de vellen waar dat gebeurt; die afvinkmomenten verdwijnen mee (en een klik die daardoor leeg wordt ook). De doelen erna schuiven een vak op: verwijder je `doel2`, dan wordt `doel3` het nieuwe `doel2` en `doel4` het nieuwe `doel3`, ook in alle vellen.
- Een doel is hooguit 100 tekens. Hoe meer tekst, hoe kleiner de letters van de strook, zodat het kanbanbord niet wegschuift.
- Gewijzigde doelen gaan mee in de export op het afsluitscherm ("de doelen gewijzigd").

**Werkafspraken bewerken:** zet de werkafspraken in beeld (W of de knop **Werkafspraken**; in de bewerkmodus kan dat ook als er nog geen afspraken zijn). Zolang ze in beeld zijn, staat in de bedieningsbalk de knop **Werkafspraken bewerken** ; klikken op de werkafspraken zelf werkt ook, en de kop "Werkafspraken" is een knop die je met Tab bereikt. Over het whiteboard verschijnt dan hetzelfde soort tekstvak als bij een vel, met één werkafspraak per regel en dezelfde knoppen en toetsen (Opslaan of Ctrl+Enter, Annuleren of Esc).

- Een `-`, `*`, `•` of `1.` aan het begin van een regel valt weg, zodat je een lijstje uit een mail of document kunt plakken. Lege regels en regels zonder tekst vallen ook weg.
- Hoe langer de lijst, hoe kleiner de letters, zodat alles op het bord past (vanaf ongeveer 8 afspraken; tot zo'n 16 korte afspraken blijft het goed leesbaar).
- Gewijzigde werkafspraken gaan mee in de export op het afsluitscherm ("Je hebt de werkafspraken gewijzigd").
- De bewerkmodus is stil: het belletje, de vraagtoon, het papiergeritsel, het schrijfgeluid en de geluidjes van de geeltjes klinken niet.
- Wijzigingen staan alleen in het geheugen en zijn weg na herladen. Bewaar ze via het afsluitscherm.

**Afsluitscherm en wijzigingen bewaren:** na de laatste inhoud volgt een donker afsluitscherm met "EINDE". Daar wordt gecontroleerd of de inhoud is gewijzigd. Zo ja, dan staat er groot een knop **Versleuteld exporteren**, met daaronder hoeveel items je hebt toegevoegd, bewerkt en verwijderd (niet in de demo). In de export komen alle vellen (titels, klikken en volgorde, ook toegevoegde en verwijderde vellen) uit wat er nu in de presentatie staat; de rest blijft precies zoals het was (onderdelen die de presentatie al oversloeg omdat ze ongeldig waren, vallen weg).

**Versleuteld exporteren:** de knop opent een venster met twee wachtwoordvakken onder elkaar. Zijn er geüploade afbeeldingen die de inhoud niet gebruikt, dan staat er een waarschuwing dat die niet meegaan. **Exporteren** kan pas als beide gevuld en precies gelijk zijn; zijn ze verschillend, dan staat dat eronder. Is het wachtwoord korter dan 16 tekens, dan staat er een waarschuwing, maar exporteren mag. Eerst laat de export elk weghalen van een afbeelding weg waarbij het whiteboard al leeg is (een klik die daardoor leeg wordt, valt weg). Daarna gebeurt precies wat `tools/encrypt.js` doet: dezelfde controle (bij fouten wordt er niets geëxporteerd en staan de fouten in het venster, ook een afbeelding die niet bestaat), versleutelen (de inhoud en elke afbeelding die de inhoud gebruikt, met één sleutel), ter controle weer ontsleutelen, en de browser downloadt **presentatie-JJJJ-MM-DD.zip** met daarin `content.enc.json` en `img/naam.enc.png` (of `.enc.jpg`) per afbeelding. Pak die uit over de projectmap heen; de oude bestanden worden vervangen. Het wachtwoord mag een ander zijn dan waarmee je inlogde; de app controleert dat niet, dus onthoud welk wachtwoord bij de nieuwe versie hoort. Esc of **Annuleren** sluit het venster zonder iets te doen. Versleutelen duurt een halve seconde; zolang staat er "Bezig…" op de knop.

**Waarschuwing bij sluiten:** zolang er wijzigingen zijn (ook geüploade afbeeldingen) die nog niet via het afsluitscherm zijn geëxporteerd (tips die tijdens de presentatie zijn toegevoegd, of iets uit de bewerkmodus), of er nog een tekstvak of invoerveld openstaat (ook een half getypte tip), vraagt de browser bij sluiten of herladen of je de pagina echt wilt verlaten. Dat is de standaardvraag van de browser; een eigen tekst kan daar niet in. Browsers stellen die vraag alleen als je op de pagina hebt geklikt of getypt. Na de export is de waarschuwing weg, tot er weer iets verandert. De PDF telt niet als export. In de demo is er geen waarschuwing.

**Vellen als PDF:** op het afsluitscherm staat altijd de knop **Vellen opslaan als PDF**. Die opent het afdrukvenster van de browser; kies daar "Opslaan als PDF" als printer. De PDF bevat:

- eerst één pagina met alle tips (ook de tips die tijdens de presentatie zijn toegevoegd);
- daarna elk vel van de rechter flip-over met zijn volledige inhoud, zoals het eruitziet vlak voordat het omslaat (de vellen zonder steekwoorden met alleen hun titel);
- op elke pagina bovenaan de titel van de presentatie en de datum van vandaag, en onderaan het onderwerp (de naam van het geeltje) en "Pagina 3 van 11".

Het whiteboard (geeltjes, doelen, vragen en werkafspraken) staat er niet in. Elke pagina is A4 staand. De vellen hebben dezelfde opmaak als op de flip-over (handschrift, kleuren, nummers, inspringen, lijnen), op wit papier met een dun randje. Een vel is op papier breder dan op het scherm, dus regels breken minder vaak af; de letters zijn even groot als op de flip-over en worden alleen kleiner als een vel vol is. Past een vel echt niet (bijvoorbeeld door veel toegevoegde tips), dan gaan de laatste regels naar een volgende pagina met "(vervolg)" achter de titel. De voorgestelde bestandsnaam is de titel met "vellen" en de datum. Ctrl+P (of afdrukken via het menu van de browser) geeft op elk moment dezelfde PDF, ook midden in de presentatie. De inhoud komt uit het geheugen: wijzigingen uit de bewerkmodus staan er ook in. Bewaar ze daarnaast via de download, anders zijn ze na herladen weg.

De positie staat in de adresbalk (`#v3-2` = vel 3, 2 klikken). Na herladen en opnieuw inloggen kom je op dezelfde plek uit. Bij beweging van de muis verschijnt rechtsonder een kleine bedieningsbalk.

## Wat er in beeld is

Deze sectie beschrijft in woorden hoe de presentatie eruitziet en wat er gebeurt, voor wie het scherm niet (goed) kan zien.

### Het geheel

Het scherm toont een vergaderruimte, recht van voren gezien. De achtergrond is een effen, warm beige muur. Onderaan loopt een smalle strook vloer in een iets donkerder beige. Tegen de muur staan drie dingen naast elkaar: links een flip-over, in het midden een groot whiteboard, en rechts nog een flip-over. Alles is getekend in een rustige, realistische stijl met zachte schaduwen. De teksten zien eruit als handschrift: met markerstift geschreven koppen in blokletters, en lijstjes in een losser, schuin handschrift.

Het beeld schaalt mee met het browservenster en vult altijd de breedte of de hoogte. In een breed venster vallen de poten van de flip-overs onderaan deels buiten beeld; muur en vloer lopen dan aan de zijkanten door, zonder randen of zwarte balken.

### Links: de flip-over met tips

Een staande flip-over: bovenaan een donkergrijze klem met twee ronde, metalen draaiknoppen, die een blok papier vasthoudt. Je ziet het voorste vel, lichtcrème; onderaan het vel zijn de randen van de vellen eronder te zien, als dunne lijntjes van een stapel papier. Onder het blok staan drie dunne donkergrijze metalen poten. Linksboven op het vel staat in groene markerletters, iets scheef, het woord "Tips". Rechtsboven op het vel staat een kleine ronde knop: een groene cirkel met een plusteken erin, half doorzichtig tot je er met de muis overheen gaat. Daarmee voeg je zelf een tip toe. In de bewerkmodus ontbreekt dit plusje; een klik op een tip geeft dan een korte melding op welk vel die tip te bewerken is.

Het vel begint leeg. Tijdens de presentatie verschijnen er tips onder elkaar, in zwart handschrift, elk met een groen sterretje ervoor. Tips die tijdens de presentatie zijn toegevoegd (`"user": true`), krijgen een rood plusteken in plaats van een sterretje. Tips blijven staan en de lijst groeit; als het vel vol raakt, worden alle letters kleiner zodat alles blijft passen.

Klik je op het plusje of druk je op T, dan verschijnt onder de tips een invoerregel: een gestippelde lijn met de grijze tekst "Nieuwe tip…".

### Midden: het whiteboard

Een groot, wit whiteboard met een glanzende aluminium rand en een lichte lichtweerkaatsing schuin over het bord. Onder het bord hangt een grijze pennenbak met drie whiteboardstiften die er liggen: elke stift heeft een witte huls met een gekleurd etiket en een gekleurde dop, in blauw, rood en zwart. De zwarte ligt iets scheef.

Het bord bestaat uit drie delen, van boven naar beneden.

**Bovenaan de doelen** (als die in de inhoud staan): hooguit vier doelen in zwart handschrift, in twee kolommen en twee rijen (het eerste linksboven, het tweede rechtsboven, dan linksonder en rechtsonder), zonder kop en zonder lijnen. Lange doelen lopen over twee of drie regels; dan worden de letters van de hele strook iets kleiner. Voor elk doel staat een met de hand getekend zwart vierkant vakje, iets scheef. Aan het begin zijn alle vakjes leeg. Wordt een doel bereikt, dan wordt er in groene marker een vinkje in het vakje gezet: eerst een korte streek naar beneden, dan een lange omhoog, die net buiten het vakje uitsteekt. In de bewerkmodus krijgt de tekst van een doel bij aanwijzen een heel lichtblauwe achtergrond, en verschijnt linksboven, half boven het vakje, een klein wit labeltje met grijze letters met de code van het doel (bijvoorbeeld "+doel2"). Zijn er minder dan vier doelen, dan staat op het eerstvolgende vak een vaag gestippeld vakje met in lichtgrijs handschrift "+ Doel toevoegen". Bewerk je een doel, dan wordt de tekst een lichtgeel invoerveld in hetzelfde handschrift, met een gestippelde blauwe lijn eronder.

**Daaronder het kanbanbord**, het grootste deel van het bord. Drie kolommen, gescheiden door met de hand getrokken zwarte lijnen, met elk een kop in markerletters en een streep eronder: "To do" in blauw, "Doing" in rood en "Done" in groen. In de kolommen hangen gele plakbriefjes (geeltjes), elk iets scheef geplakt, met in zwart handschrift de naam van een onderwerp. Elk geeltje is één onderwerp van de presentatie. Aan het begin hangen ze allemaal in To do, behalve het eerste onderwerp, dat in Doing hangt. Het onderwerp dat nu besproken wordt hangt altijd in Doing; afgeronde onderwerpen hangen in Done. Bij het laatste onderwerp hangen alle andere geeltjes in Done. Hoe meer onderwerpen, hoe kleiner de geeltjes, zodat ze altijd in één kolom passen. In de bewerkmodus staat links en rechts van het geeltje in Doing een klein lichtblauw rondje met een pijltje naar links en naar rechts, en net zo in de linker- en rechtermarge van het vel, naast de titel. Onderaan in de kolom Doing staan twee regels in vaag grijs handschrift: "+ Onderwerp" en "Onderwerp verwijderen" (die laatste nog vager als er maar één onderwerp is). Klik je op het geeltje in Doing, dan wordt het een lichtgeel invoerveld van dezelfde grootte, met de naam in hetzelfde handschrift en een gestippelde blauwe lijn eronder.

**Onderaan de vraagzone**, een strook over de hele breedte, gescheiden van het kanbanbord door een grijze stippellijn. Meestal is die strook leeg. Bij een vraag aan de zaal staat daar links een rood omcirkeld vraagteken en rechts daarvan de vraag in blauwe markerletters (zie hieronder).

**De werkafspraken** zijn standaard niet te zien. Met de knop "Werkafspraken" in de bedieningsbalk (of de toets W) verschijnen ze over het hele bord heen: het bord wordt bijna helemaal wit, met alleen een heel vage schim van het kanbanbord erachter. Daarop staat een grote kop "Werkafspraken" in rode markerletters, iets scheef, met daaronder de afspraken onder elkaar in groot zwart handschrift, elk met een blauw vinkje ervoor. Ze blijven staan tijdens het bladeren, tot je ze met de knop, W of Esc weer verbergt.

**Een afbeelding** (als de inhoud er een ophangt) hangt als een vel papier over de doelen en het kanbanbord, nooit over de vraagzone. Het vel is lichtgebroken wit met een smalle witte rand rond de afbeelding, met een zachte schaduw eronder, en hangt een fractie scheef (elke afbeelding net anders, tussen −1,6° en 1,6°). Halverwege over de bovenrand zitten links en rechts twee ronde, glanzende magneten: links blauw, rechts rood, met een lichtvlekje en een eigen schaduw. Het papier is op schaal: A4 is altijd even groot, staand of liggend (staand past de lange zijde precies in de hoogte boven de vraagzone, ongeveer 470 bij 332 op een podium van 1600 bij 900); A3 is A4 maal √2 (665 bij 470) en bestaat alleen liggend: dan dekt het vel bijna het hele bord boven de vraagzone; A5 is A4 gedeeld door √2. Staand of liggend volgt uit de afbeelding: breder dan hoog is liggend. Zonder formaat in de inhoud kiest de app het grootste waarop de afbeelding nog scherp is: liggend en minstens 1600 pixels breed wordt A3, een lange zijde van minstens 1000 pixels A4, kleiner A5. Een staande afbeelding met `[A3]` wordt A4 staand, met een waarschuwing in de console. De afbeelding staat gecentreerd op het papier en past er precies op, zonder te vervormen. Wat eronder hangt, blijft gewoon bestaan en schuift zoals altijd; het is alleen afgedekt. De werkafspraken komen er wel overheen. Ontbreekt het bestand of lukt het ontsleutelen niet, dan hangt er een leeg vel met in grijs wat er mis is (bijvoorbeeld "Afbeelding "kat" niet gevonden: img/kat.enc.png of img/kat.enc.jpg"), zodat je het tijdens het voorbereiden ziet.

### Rechts: de flip-over met steekwoorden

Dezelfde soort flip-over als links. Bovenaan elk vel staat de titel van dat vel in blauwe markerletters (hoofdletters, iets scheef), met daaronder een dikke blauwe lijn over de hele breedte van het vel. Een lange titel loopt over twee regels. De titel staat er altijd, ook als er nog geen steekwoorden zijn. Onder de lijn verschijnen de steekwoorden van het huidige vel, onder elkaar, in handschrift, elk met een rode stip ervoor. Een steekwoord kan ook inspringen, één of twee niveaus; dan is het opsommingsteken een kleinere rode stip of een kort rood streepje. In plaats van een stip kan er een rood nummer staan (1., 2., 3., …), bijvoorbeeld bij een genummerde reeks die een woord erboven uitlegt. Tussen steekwoorden kan een stukje witruimte staan, of een dikke blauwe lijn over de breedte van het vel, zoals de lijn onder de titel. Standaard is het handschrift blauw, maar een steekwoord kan ook in een andere markerkleur staan: rood, zwart, groen, okergeel, donkeroranje, paars of roze. Alle kleuren zijn donker en goed leesbaar op het lichte papier. De regels staan om en om een heel klein beetje scheef, zoals echt handschrift. Elk vel begint met alleen de titel en vult zich per klik. Klik je (live) op een steekwoord, dan schuift van links een gesloten blauwe whiteboardstift in beeld, groter dan die in de pennenbak, iets schuin, met de dop vlak voor de stip of het nummer van die regel; hij tikt één keer tegen het papier, met een doffe tik. Nog eens klikken op hetzelfde steekwoord of Esc laat hem snel en zonder geluid terugschuiven; een ander steekwoord aanklikken verplaatst hem. Bij elke klik vooruit of terug, een ander vel of een ander formaat van het venster is hij meteen weg. Bij een nieuw vel slaat het oude vel om: het klapt naar boven weg en er komt een nieuw vel tevoorschijn, met alleen de nieuwe titel erop. Ga je terug, dan klapt het vorige vel, met zijn titel, weer naar beneden.

### Wat er per inhoudstype gebeurt

Elke klik laat één of meer items verschijnen. Bij meer items tegelijk worden ze kort na elkaar geschreven, in volgorde. Er zijn zes soorten items, elk met een eigen plek, beeld en geluid:

- **Steekwoord** (`keyword`): verschijnt rechts op de flip-over, onderaan de lijst, in blauw of in de opgegeven markerkleur, eventueel ingesprongen, genummerd of met witruimte of een lijn erboven. De tekst wordt van links naar rechts "geschreven". Geen geluid. Een schermlezer leest de kleur niet voor.
- **Tip** (`tip`): verschijnt links op de flip-over, onderaan de lijst, ook van links naar rechts geschreven. Er klinkt een hoog belletje, als een klein klokje; bij meerdere tips in één klik klinkt het één keer.
- **Vraag** (`question`): verschijnt in de vraagzone onderaan het whiteboard. Eerst springt links een rood omcirkeld vraagteken in beeld, daarna wordt rechts daarvan de vraag in blauwe markerletters geschreven, iets scheef. Een lange vraag krijgt kleinere letters, zodat hij altijd in de zone past. Er klinkt een korte toon die snel omhoog glijdt. Bij de volgende klik vervaagt de vraag weer en is de zone leeg. Het kanbanbord blijft tijdens een vraag gewoon zichtbaar.
- **Doel afvinken** (`check`): in het vakje bij het doel bovenaan het whiteboard wordt een groen vinkje getekend, in twee streken. Tegelijk klinkt een kort schrijfgeluidje: een stift die een vinkje zet, in twee streken, met het schurende, licht haperende geluid van een stiftpunt op het bord en een heel zacht piepje. Het klinkt elke keer net iets anders. Het vinkje blijft staan.
- **Afbeelding ophangen** (`pin`): een vel papier komt met een korte beweging tegen het whiteboard, licht scheef, en daarna klikken links- en rechtsboven twee ronde magneten erop (een blauwe en een rode), een voor een. Je hoort een zacht papiergeluid en twee korte, metalige klikjes met een felle aanzet en een lage plof eronder, gelijk met de magneten. Hangt er al een afbeelding, dan verdwijnt die tegelijk: de nieuwe vervangt hem.
- **Afbeelding weghalen** (`unpin`): eerst gaan de magneten eraf, een voor een, dan zakt het vel een stukje en verdwijnt. Het geluid is subtiel: twee heel zachte tikjes en een nauwelijks hoorbare zwiep van papier. Daarna is het whiteboard weer precies zoals het hoort.

Verder:

- **Nieuw vel:** het vel rechts slaat om, met een kort geritsel van papier.
- **Nieuw onderwerp:** niet alles tegelijk, maar rustig na elkaar (samen ongeveer 2 seconden). Eerst slaat het vel rechts om, met geritsel. Als het vel bijna om is, wordt het geeltje van het vorige onderwerp opgepakt: je hoort een kort, knisperend geluidje, als plakband dat loslaat, het geeltje wordt iets groter en krijgt een grote schaduw, alsof het van het bord wordt getild. Het maakt een boogje naar Done en wordt daar even aangedrukt, met een korte, doffe tik. Beide geluidjes zijn ongeveer even luid als het geritsel en ook op laptopspeakers goed te horen. Na een korte pauze gebeurt hetzelfde met het geeltje van het nieuwe onderwerp, van To do naar Doing; pas als dat is opgetild, schuiven de andere geeltjes in To do op om het gat te dichten. Terugbladeren gaat op dezelfde manier, de andere kant op.
- **Geluiden overlappen nooit.** Klinken er bij één klik meer geluiden (bijvoorbeeld bij een sprong met End), dan komen ze na elkaar: eerst het geritsel, dan de vraagtoon, dan het belletje, dan het schrijfgeluid (het vinkje wordt getekend op het moment dat dat klinkt). De geluidjes van de geeltjes vallen weg als er op dat moment al iets anders klinkt.
- De animaties spelen altijd, ook als in het besturingssysteem "minder beweging" (in Windows: Animatie-effecten uit) is ingesteld. Dit prototype houdt daar bewust geen rekening mee.

### De bedieningsbalk

Rechtsonder in beeld staat een kleine, afgeronde, donkergrijze balk die half doorzichtig is. Hij verschijnt als je de muis beweegt en verdwijnt na twee seconden weer. Van links naar rechts staan erin: een pijl naar links (vorige), de voortgang (bijvoorbeeld "2 / 6", of "Einde" op het afsluitscherm), een pijl naar rechts (volgende), de vetgedrukte knop "Werkafspraken" (om de werkafspraken te tonen of te verbergen) en een knop voor volledig scherm. Bij de laatste inhoud verandert de pijl naar rechts in de vetgedrukte tekst "Einde" met een pijltje: die knop gaat naar het afsluitscherm. Op het startscherm staat op die plek op dezelfde manier "Start" met een pijltje. De balk blijft staan zolang de muis erboven is of een knop erin de focus heeft. In de bewerkmodus komen er achteraan nog twee dingen bij: een geel label "✎ Bewerken" en de vetgedrukte knoppen "Vel bewerken", "Vel toevoegen" en "Vel verwijderen" ("Vel verwijderen" is gedimd als het huidige vel het enige vel van zijn onderwerp is). Zolang de werkafspraken in beeld zijn, staat daarachter nog de vetgedrukte knop "Werkafspraken bewerken". Die opent hetzelfde lichtcrème vlak met tekstvak, uitleg en knoppen als bij een vel, maar dan over het hele whiteboard, met in het tekstvak één werkafspraak per regel.

In de bewerkmodus krijgt de rechter flip-over bij aanwijzen een blauwe rand. Bewerk je een vel, dan ligt er over het hele vel een lichtcrème vlak met een blauwe rand. Daarin staat bovenaan een groot wit tekstvak in een gewoon, vast-breed lettertype (geen handschrift), met alle klikken van het vel als tekst (zonder de titel). Daaronder staat in kleine grijze letters de korte uitleg van de notatie, met de tekens in blauw. Helemaal onderaan staan rechts twee knoppen: "Annuleren" (wit met een grijze rand) en "Opslaan" (blauw met witte letters). De titel van het vel krijgt bij aanwijzen een heel lichtblauwe achtergrond; klik je erop, dan wordt hij een lichtgeel invoerveld met dezelfde blauwe markerletters en een gestippelde blauwe lijn eronder. Een melding, bijvoorbeeld na een klik op een tip, verschijnt even midden onderin beeld, boven de bedieningsbalk, als witte tekst op een donkergrijs, afgerond vlak, en verdwijnt na zes seconden.

### Het startscherm

Na het inloggen zie je eerst een startscherm in donkere modus, in dezelfde kleuren als het afsluitscherm: bijna zwart, met in het midden een heel zachte, iets lichtere gloed. Midden in beeld staat in grote, vette, bijna witte hoofdletters met veel ruimte tussen de letters het woord "WELKOM". Daaronder staat, kleiner en in lichtgrijze gewone letters, de titel van de presentatie (bijvoorbeeld "Lean in de praktijk"); een lange titel loopt over twee regels. Het whiteboard en de flip-overs zijn nog niet te zien. In de bewerkmodus krijgt de titel bij aanwijzen een heel licht oplichtende achtergrond; klik je erop, dan wordt hij een invoerveld op dezelfde plek, even breed als de titel, met een iets lichtere achtergrond, dezelfde lichtgrijze letters en een gestippelde lijn eronder die groen wordt zolang je typt.

Rechtsonder staat de bedieningsbalk, altijd zichtbaar, donkergrijs met een lichtere rand. Daarin: de pijl naar links (uitgeschakeld en gedimd), het woord "Welkom", de vetgedrukte knop "Start" met een pijltje, de knop "Werkafspraken" (uitgeschakeld en gedimd) en de knop voor volledig scherm. Met Start verdwijnt het donkere scherm en verschijnt de vergaderruimte met het whiteboard.

### Het afsluitscherm

Na de laatste inhoud volgt een afsluitscherm in donkere modus. Het hele beeld is dan bijna zwart, met in het midden een heel zachte, iets lichtere gloed. Midden in beeld staat in grote, vette, bijna witte hoofdletters met veel ruimte tussen de letters het woord "EINDE". Het whiteboard en de flip-overs zijn niet meer te zien.

Is de inhoud tijdens de presentatie gewijzigd (tips toegevoegd, of in de bewerkmodus een vel aangepast), dan staat onder "EINDE" een grote, afgeronde, felgroene knop met donkere tekst: een pijl naar beneden en "Versleuteld exporteren". Daaronder staat in lichtgrijze tekst wat er gewijzigd is (bijvoorbeeld "Je hebt 2 onderdelen toegevoegd en 1 onderdeel bewerkt") en dat je de zip uitpakt over de projectmap heen; na een export staat er bijvoorbeeld "Geëxporteerd als presentatie-2026-10-27.zip (gecontroleerd): content.enc.json en 2 afbeeldingen in img/". Zonder wijzigingen, en in de demo, ontbreekt die knop en de tekst eronder.

Het exportvenster ligt midden over het afsluitscherm, dat erachter donkerder wordt. Het is een donkere kaart met afgeronde hoeken en een dun lichtgrijs randje: bovenaan vet "Versleuteld exporteren", daaronder in grijs dat je hier het wachtwoord voor de nieuwe content.enc.json kiest, dan de vakken "Wachtwoord" en "Wachtwoord herhalen" (donker, met een groene rand als je erin typt), een regel voor meldingen (grijs, of zachtrood bij fouten) en rechtsonder de knoppen "Annuleren" (alleen een lichte rand) en "Exporteren" (felgroen, gedimd zolang hij nog niet kan).

Tussen "EINDE" en de exportknop staat altijd een tweede grote, afgeronde knop, maar niet gevuld: een felgroene rand op de donkere achtergrond, met bijna witte tekst "Vellen opslaan als PDF" en daarvoor een klein groen printer-icoontje (lijntekening). Daaronder staat in lichtgrijze tekst: "Alle vellen en de tips, elk op een A4. Kies in het afdrukvenster ‘Opslaan als PDF’."

De PDF zelf: elke pagina is wit, staand A4. Bovenaan staat links in kleine, vette, gewone letters de titel van de presentatie en rechts de datum (bijvoorbeeld "11 oktober 2026"), met een dunne grijze lijn eronder. Daaronder, bijna over de hele pagina, staat het vel: een wit vlak met een dun beige randje, met precies dezelfde markerletters, kleuren, stippen en nummers als op de flip-over. De eerste pagina is het tipsvel ("Tips" in groene markerletters, de tips met groene sterretjes of rode plusjes), daarna volgen de vellen van rechts in volgorde. Onderaan elke pagina staat, kleiner en grijs, links het onderwerp (bijvoorbeeld "Onderwerp: Theorie", of "Alle tips uit de presentatie") en rechts het paginanummer ("Pagina 2 van 11"), met een dunne lijn erboven. Op een vel met weinig tekst blijft de onderkant van het vel leeg.

De bedieningsbalk blijft op het afsluitscherm altijd zichtbaar, rechtsonder, nu donkergrijs met een lichtere rand zodat hij goed loskomt van de achtergrond. De pijl naar rechts en de knop "Werkafspraken" zijn daar uitgeschakeld en gedimd; met de pijl naar links ga je terug naar de laatste inhoud.

### Het wachtwoordscherm

Voordat de presentatie opent, zie je een donker scherm, net als het start- en afsluitscherm: bijna zwart met in het midden een iets lichtere gloed. Midden op het scherm staat een donkere kaart met afgeronde hoeken en een dun lichtgrijs randje. Daarop staat de titel "PRESENTATIE" in grote, vette, bijna witte hoofdletters met ruime letterafstand, de zin "Voer het wachtwoord in om de presentatie te openen." in grijs, een donker invoerveld voor het wachtwoord en een felgroene knop "Openen" met donkere tekst. Bij een fout wachtwoord verschijnt daaronder in zachtrood "Onjuist wachtwoord." Onderaan de kaart staat de link "Demo bekijken", vormgegeven als een rustigere knop: alleen een felgroene rand met bijna witte tekst (niet in de bewerkmodus). Na het juiste wachtwoord volgt het startscherm.

### Wat een schermlezer meekrijgt

Eerlijk gezegd is de presentatie vooral visueel. Wat er nu is:

- De drie delen hebben een naam: "Tips", "Whiteboard" en "Steekwoorden". De bedieningsbalk heet "Bediening".
- De knop "Werkafspraken" meldt of de werkafspraken aan of uit staan, en dat de sneltoets W is. Als ze zichtbaar zijn, vormen ze een gebied met de naam "Werkafspraken"; als ze verborgen zijn, leest een schermlezer ze niet voor.
- De geeltjes zijn knoppen. Ze lezen hun onderwerp voor en hebben als beschrijving "Ga naar:" gevolgd door het onderwerp.
- Een vraag wordt automatisch voorgelezen zodra hij verschijnt (de vraagzone is een voorleesregio).
- Een afbeelding die wordt opgehangen, wordt voorgelezen als "Afbeelding:" gevolgd door de beschrijving; die beschrijving is ook de alt-tekst van de afbeelding. Het weghalen wordt niet voorgelezen.
- Een nieuwe tip wordt ook automatisch voorgelezen, als "Tip:" gevolgd door de tekst. Dat gebeurt alleen voor de tips van de klik die je net doet; bij terugbladeren of een sprong naar een ander onderwerp (via een geeltje) wordt niets voorgelezen. Een tip die je zelf toevoegt, wordt bevestigd met "Tip toegevoegd:" en de tekst.
- Een aangewezen steekwoord (klik op een steekwoord, live) krijgt voor een schermlezer "(x)" vóór de tekst, net als een afgevinkt doel. Het aanwijzen zelf wordt niet voorgelezen. De stift zelf is voor schermlezers onzichtbaar. Aanwijzen kan (nog) alleen met de muis.
- De doelen vormen een lijst met de naam "Doelen". Vóór een afgevinkt doel staat voor een schermlezer "(x)"; een doel dat nog niet is afgevinkt, heeft geen label. Het afvinken zelf wordt niet automatisch voorgelezen; het schrijfgeluidje geeft het aan. In de bewerkmodus is de tekst van elk doel een knop (naam: de tekst, beschrijving: de code, bijvoorbeeld "+doel2") die je met Tab bereikt en met Enter of spatie bewerkt; het invoerveld heet "Tekst van het doel" (of "Nieuw doel") en heeft de code als beschrijving. "+ Doel toevoegen" is een echte knop. Bij verwijderen vraagt een gewoon dialoogvenster van de browser om bevestiging.
- De titel van het vel rechts is een kop; daarmee kun je in een schermlezer per vel navigeren. Ook "Tips" links en de kolomkoppen "To do", "Doing" en "Done" zijn koppen.
- Het startscherm heet "Welkom" en het afsluitscherm "Einde"; de knoppen daar lezen "Vellen opslaan als PDF" (met de uitleg eronder als beschrijving) en "Versleuteld exporteren" voor. Het exportvenster is een echt dialoogvenster ("Versleuteld exporteren", met de uitleg als beschrijving): de focus gaat naar het eerste wachtwoordvak, de rest van de pagina is zolang niet bereikbaar, de melding onder de vakken wordt voorgelezen, en na sluiten gaat de focus terug naar de knop.
- Op het start- en afsluitscherm is de inhoud van de presentatie (whiteboard en flip-overs) volledig weg: een schermlezer leest er niets van voor, en met Tab of zoeken is er niets van te bereiken. Alleen "WELKOM" of "EINDE", de knoppen van het afsluitscherm en de bedieningsbalk zijn er dan.
- De PDF is een gewone afdruk van tekst: de tekst is te selecteren en te doorzoeken, en wordt in de volgorde van de vellen gelezen. Kleuren, inspringen en lijnen staan er alleen als opmaak in. De afdrukversie zelf staat op het scherm verborgen en is voor een schermlezer onzichtbaar.
- De foutmelding bij een fout wachtwoord wordt automatisch voorgelezen.
- De knop met het plusje heet "Tip toevoegen" en de invoerregel heet "Nieuwe tip".
- Navigeren kan volledig met het toetsenbord (zie Bediening). De geluiden geven aan wat er verschijnt: belletje voor een tip, geritsel voor een nieuw vel, opgaande toon voor een vraag, schrijfgeluid voor een afgevinkt doel, en bij een nieuw onderwerp twee keer "oppakken en vastplakken" voor de geeltjes die verhuizen.

In de bewerkmodus is alles wat je kunt bewerken een echte knop, in de gewone tabvolgorde (Tab en Shift+Tab; de app vangt Tab, Enter en spatie niet af): de doelteksten, de geeltjes met in Doing de pijlen "Onderwerp eerder" en "Onderwerp later" ervoor en erna, "+ Onderwerp" en "Onderwerp verwijderen", de kop "Werkafspraken" (als die in beeld zijn), de titel van het vel met de pijlen "Vel eerder" ervoor en "Vel later" erna, en in de bedieningsbalk "Vel bewerken", "Vel toevoegen", "Vel verwijderen", "Werkafspraken bewerken" en "Afbeeldingen". De titel van de presentatie op het startscherm is ook zo'n knop. Enter of spatie op zo'n knop doet hetzelfde als een klik. Het geeltje in Doing heeft als beschrijving "Naam van dit onderwerp wijzigen", de titels "Titel bewerken". Uitgeschakelde knoppen leggen in hun tooltip uit waarom (bijvoorbeeld "Er passen hooguit 6 onderwerpen" of "Het enige vel van de presentatie kan niet weg"). Een invoerveld op zijn plek heet "Titel van het vel", "Titel van de presentatie", "Naam van het onderwerp", "Tekst van het doel" of "Nieuw doel", krijgt direct de focus, en na Enter of Esc gaat de focus terug naar de knop. Het tekstvak van een vel heet "Klikken van het vel als tekst" (in een groep "Vel bewerken:" gevolgd door de titel), dat van de werkafspraken "Werkafspraken, één per regel" (in een groep "Werkafspraken bewerken"); beide hebben de korte uitleg van de notatie als beschrijving, krijgen direct de focus, en hebben daarna de knoppen "Annuleren" en "Opslaan", die hun sneltoets Esc en Ctrl+Enter ook voor een schermlezer noemen. Na "Vel toevoegen" krijgt eerst het invoerveld "Titel van het vel" de focus en daarna het tekstvak. Bij verwijderen vraagt een gewoon dialoogvenster van de browser om bevestiging. De melding na een klik op een tip wordt automatisch voorgelezen. Het venster Afbeeldingen is een echt dialoogvenster: elke miniatuur is een knop met de code als naam ("@kat"), met daarachter een knop "Afbeelding kat verwijderen"; de melding onderin ("Gekopieerd: @kat") wordt voorgelezen. De vraag Vervangen/Verwijderen is ook een dialoogvenster, met de focus op Annuleren.

Wat er nog niet is:

- Nieuwe steekwoorden, het verschuiven van geeltjes en de voortgang ("2 / 6") worden niet automatisch voorgelezen.
- De knoppen vorige en volgende in de bedieningsbalk zijn pijlen met alleen een beschrijving als tooltip, geen echte naam. "Start", "Einde", "Werkafspraken", "Volledig scherm" (het kadertje), "Vel bewerken", "Vel toevoegen", "Vel verwijderen", "Werkafspraken bewerken", "+ Onderwerp" en "Onderwerp verwijderen" hebben wel een echte naam; die met een sneltoets (W, F, en T voor de plusknop van de tips; de bewerkmodus heeft geen eigen sneltoetsen) melden die sneltoets ook aan een schermlezer.
- Een aantal dingen bestaat alleen in de opmaak en wordt dus niet als tekst doorgegeven: het rode plusteken bij een tijdens de presentatie toegevoegde tip, de kleuren, het inspringen en de lijnen tussen steekwoorden. De nummers bij genummerde steekwoorden komen ook uit de opmaak; of een schermlezer die voorleest, verschilt per schermlezer.

## Goed om te weten

- **Hoeveel past er?** Lettergroottes passen zich automatisch aan, maar dit blijft goed leesbaar: hooguit 4 doelen van hooguit 100 tekens (korter leest prettiger), hooguit 6 onderwerpen (daarboven worden de geeltjes te klein), zo'n 15 korte tips in totaal en ongeveer 10 steekwoorden per vel (de titel neemt bovenaan ook ruimte in; houd hem kort, liefst één of twee regels). Past een flip-over zelfs met de kleinste letters niet meer, dan meldt de console dat (handig tijdens het voorbereiden). Lange losse woorden op een geeltje worden kleiner dan korte.
- **Nooit `content.json` committen.** De git-geschiedenis bewaart alles, ook als je het later verwijdert.
- **Eén gedeeld wachtwoord.** Na een wachtwoordwissel blijven oude versies in de git-geschiedenis te ontsleutelen met het oude wachtwoord.
- **Lettertypen** (Caveat en Permanent Marker) staan zelf gehost in `fonts/`, met hun licentie (SIL Open Font License 1.1 en Apache License 2.0). De presentatie werkt dus ook zonder internet (lokaal via `npx serve .`), en bezoekers sturen niets naar Google. Alleen de tekens van Latin en Latin Extended zitten erin; andere schriften vallen terug op een standaardletter.
- **De motor gebruikt de Web Crypto API.** Die werkt alleen via HTTPS of `localhost`; GitHub Pages gebruikt standaard HTTPS. Een bestand dat je direct opent (`file://`) werkt niet, omdat de browser de inhoud dan niet mag laden.
- **Nog niet gebouwd:** PDF-export en sprekersnotities.
