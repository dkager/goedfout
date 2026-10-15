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
| `content.example.json` | Voorbeeldinhoud | Ja (niet gevoelig) |
| `content.json` | **Jouw echte inhoud, onversleuteld** | **Nee** (staat in `.gitignore`) |
| `content.enc.json` | Versleutelde inhoud, wordt door de motor geladen | Ja |
| `tools/encrypt.js` | Versleutelscript (Node.js 20 of nieuwer) | Ja |

## Werkwijze

```bash
# 1. Begin met de voorbeeldinhoud en pas die aan
cp content.example.json content.json

# 2. Versleutelen (vraagt twee keer om het wachtwoord)
node tools/encrypt.js

# 3. Lokaal bekijken
npx serve .                # of: npm run serve
#    → http://localhost:3000
#    → http://localhost:3000/?plain  laadt content.json zonder wachtwoord (alleen op localhost)

# 4. Publiceren: commit en push alleen de versleutelde versie
git add content.enc.json && git commit -m "Inhoud bijgewerkt" && git push
```

Controleren wat er in een versleuteld bestand staat: `node tools/encrypt.js --decrypt content.enc.json`.

In CI kan het wachtwoord via een omgevingsvariabele: `PRESENTATIE_WACHTWOORD=... node tools/encrypt.js`.

**Wachtwoord:** versleutel de inhoud met een lang, geheim wachtwoord (16+ tekens). Zet het wachtwoord nergens in de repository (niet in de README, code, commitberichten of scripts), maar deel het buiten Git om.

## Inhoud (`content.json`)

```json
{
  "title": "Lean in de praktijk",
  "agreements": ["Telefoons op stil", "Vragen mogen altijd"],
  "goals": [
    { "id": "verspilling", "text": "Verspilling herkennen" },
    { "id": "start", "text": "Morgen een eerste stap zetten" }
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
              { "type": "check", "goal": "verspilling" }
            ]
          ]
        }
      ]
    }
  ]
}
```

- `title`: titel van de presentatie. Staat op het startscherm onder "WELKOM" en in het browsertabblad (beide pas na het ontsleutelen).
- `agreements`: werkafspraken. Standaard verborgen; met de knop **Werkafspraken** in de bedieningsbalk (of de toets W) verschijnen ze over het hele whiteboard heen. Zonder `agreements` is er geen knop.
- `goals`: de doelen van de presentatie, **hooguit 4**. Ze staan de hele presentatie bovenaan het whiteboard, elk met een leeg aankruisvakje. Elk doel heeft een `id` (een kort, uniek woord, waarmee je het afvinkt) en een `text`. Zonder `goals` is er geen doelenstrook en krijgt het kanbanbord die ruimte.
- `topics`: de onderwerpen, in volgorde. Elk onderwerp is één geeltje.
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

Eigenschappen van een `keyword` (allemaal optioneel):

- `color`: markerkleur: `blue`, `red`, `black`, `green`, `yellow`, `orange`, `purple` of `pink`. Zonder `color` is het blauw. Alle kleuren zijn donker genoeg om goed leesbaar te zijn op het papier (contrast minstens 4,5:1); geel en oranje zien er daarom uit als okergele en donkeroranje marker.
- `indent`: `0`, `1` of `2`: hoe ver het steekwoord inspringt. Het opsommingsteken verschilt per niveau: rode stip, kleinere rode stip, rood streepje.
- `numbered`: `true` voor een nummer in plaats van het opsommingsteken. De nummers telt de presentatie zelf: opeenvolgende genummerde steekwoorden op hetzelfde niveau tellen door (ook over klikken heen); een steekwoord zonder nummer op dat niveau, of een dat minder ver inspringt, laat de telling daarna weer bij 1 beginnen. Dieper ingesprongen steekwoorden onderbreken de telling niet.
- `gap`: `"space"` voor witruimte of `"line"` voor een dikke blauwe lijn **boven** dit steekwoord.

Regels:

- Een step heeft hooguit één `question`. De vraag staat er zolang die klik de laatste is, en verdwijnt bij de volgende klik weer.
- Een afgevinkt doel blijft afgevinkt, ook op latere vellen en onderwerpen. Blader je terug tot vóór de klik met de `check`, dan is het vakje weer leeg. Een `check` met een onbekende `goal`, een dubbele of ontbrekende `id`, of een vijfde doel geeft een melding en wordt overgeslagen.
- Per klik klinkt elk geluid hooguit één keer (één belletje, ook bij meerdere tips).
- Een onbekend type, een item zonder tekst, een lege step of een ongeldige eigenschap geeft een melding en wordt overgeslagen of krijgt de standaardwaarde. `tools/encrypt.js` meldt dit al bij het versleutelen, en de motor geeft een waarschuwing in de console. Beide gebruiken dezelfde controle uit `js/content.js`.
- Een vel zonder titel, of iets wat geen vel is, is een **fout**: `tools/encrypt.js` weigert dan te versleutelen en noemt welk vel het is. Met `?plain` toont de presentatie zo'n vel wel (met een lege titel en een foutmelding in de console), zodat je kunt doorwerken.

Nieuwe soorten items toevoegen: zie `ITEM_TYPES` in `js/content.js` en de functies `keywordsAt`, `tipsAt`, `questionAt` en `checkedGoalsAt` in `js/app.js`. Voor de bewerkmodus ook de tekstnotatie in `js/sheet-text.js` (`stepsToText` en `textToSteps`).

## Bediening

| Actie | Toetsen |
|---|---|
| Volgende klik | → ↓ spatie PageDown (presenter stick) |
| Vorige klik | ← ↑ PageUp Backspace |
| Eerste / laatste inhoud | Home / End (niet naar het start- of afsluitscherm) |
| Beginnen | Volgende op het startscherm (de knop heet dan **Start ›**) |
| Naar het afsluitscherm | Volgende op de laatste inhoud (de knop heet dan **Einde ›**) |
| Volledig scherm | F |
| Werkafspraken tonen / verbergen | W of de knop **Werkafspraken** (Esc verbergt ze ook) |
| Naar een onderwerp | Klik op een geeltje |
| Tip toevoegen | **+** (Shift+=) of klik op **+** op de Tips-flip-over, typ, Enter (Esc = annuleren); niet in de bewerkmodus |
| Vellen als PDF | Knop **Vellen opslaan als PDF** op het afsluitscherm, of Ctrl+P |
| Vel bewerken (bewerkmodus) | **E**, klik op de rechter flip-over of **Vel bewerken**; opslaan Ctrl+Enter, annuleren Esc |
| Werkafspraken bewerken (bewerkmodus) | eerst W (in beeld), dan **A**, klik op de werkafspraken of **Werkafspraken bewerken**; opslaan Ctrl+Enter, annuleren Esc |

Na het inloggen opent de presentatie op een donker startscherm met "WELKOM". Daar werken alleen **Start** (knop, pijl rechts of spatie) en volledig scherm (F); vorige, Home/End en tip toevoegen doen niets. Terug vanaf de eerste inhoud brengt je weer op het startscherm.

**Tips tijdens de presentatie:** een tip die je met het plusje toevoegt, komt als gewoon item met `"user": true` in de huidige klik (heb je op dit vel nog niets geklikt, dan wordt het een nieuwe eerste klik). Hij krijgt een rood plusje. Blader je terug tot vóór die klik, dan verdwijnt hij; vooruit verschijnt hij weer. Toegevoegde tips staan alleen in het geheugen; bewaar ze via het afsluitscherm, dan verschijnen ze na opnieuw laden bij dezelfde klik.

**Bewerken (`?edit`):** zet `?edit` in de adresbalk (bijvoorbeeld `http://localhost:3000/?edit`). De bewerkmodus werkt altijd met de versleutelde inhoud en het wachtwoord: `?plain` en `?edit` gaan niet samen, en met allebei in de adresbalk krijg je de gewone bewerkmodus. In de bedieningsbalk staan dan een geel label "✎ Bewerken" en de knop **Vel bewerken**. Je bewerkt een vel in één keer, als tekst: klik ergens op de rechter flip-over, op **Vel bewerken** of druk op **E**. Over het vel verschijnt dan één groot tekstvak met alle klikken van het vel, de focus erin.

**Titel van een vel:** die staat niet in het tekstvak. Klik op de titel bovenaan het vel (of ga er met Tab naartoe en druk op Enter): de titel wordt een invoerveld op dezelfde plek. **Enter** of wegklikken slaat op, **Esc** annuleert. Een vel heeft altijd een titel: leeg opslaan geldt als annuleren.

- **Opslaan** (of Ctrl+Enter) verwerkt alles in één keer; daarna is het hele vel in beeld. **Annuleren** (of Esc) gooit alle wijzigingen weg. Wegklikken doet niets, en zolang het tekstvak open is kun je niet bladeren: de pijlen en de geeltjes zijn dan uitgeschakeld en de bladertoetsen doen niets.
- Eén item per regel. Onder het tekstvak staat dezelfde uitleg kort samengevat; die is algemeen en noemt niets uit de inhoud van de presentatie (dus ook niet de ids van de doelen):

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
| `+id` | vinkt het doel met die id af (hoofdletters maken niet uit) |
| elke andere regel | steekwoord met bullet |

- Wat na `*`, `-`, `•` of een nummer staat is gewone tekst: `* ? geen vraag` is een steekwoord. Een onbekende kleur of doel-id blijft gewoon tekst; een geldig kleurlabel wordt overal weggehaald (ook uit een vraag of tip), dus `[rood]` kun je niet letterlijk als tekst gebruiken.
- Een regel met alleen codes en geen tekst, zoals `* [rood]`, `?`, `!`, `1.` of `+`, wordt overgeslagen.
- Onzichtbare tekens aan het begin en eind van een regel (zero-width space, BOM, richtingstekens, zacht afbreekstreepje) tellen niet mee; een regel met alleen zulke tekens is een lege regel. Een losse `\r` en de Unicode-regelscheidingen U+2028 en U+2029 (soms meegeplakt uit Word of een pdf) zijn een nieuwe regel.
- Ruimte en lijnen gelden alleen vóór een steekwoord: vóór een vraag, tip, doel of klik en bovenaan het vel vervallen ze. Meerdere lege regels, lijnen of klikken achter elkaar tellen als één (een lijn wint van witruimte); een klik aan het begin of eind telt niet.
- Kleur en inspringen op een vraag, tip of doel worden genegeerd. Tips worden bij opslaan altijd gewone tips (zonder `"user": true`): in de bewerkmodus presenteer je niet.
- **Tips** bewerk en voeg je alleen zo toe, via het vel waar ze bij horen. Het plusje op de Tips-flip-over is in de bewerkmodus weg, en een klik op een tip links geeft een melding op welk vel die tip staat.
- Onderdelen die je niet verandert, blijven precies wat ze waren; op het afsluitscherm tellen alleen echte wijzigingen mee (ook een gewijzigde veltitel).
- Doelen zelf (de tekst in de strook), de namen van de geeltjes en de titel van de presentatie zijn (nog) niet in de bewerkmodus te bewerken; die zet je in de JSON.

**Werkafspraken bewerken:** zet de werkafspraken in beeld (W of de knop **Werkafspraken**; in de bewerkmodus kan dat ook als er nog geen afspraken zijn). Zolang ze in beeld zijn, staat in de bedieningsbalk de knop **Werkafspraken bewerken** (sneltoets **A**); klikken op de werkafspraken zelf werkt ook. Over het whiteboard verschijnt dan hetzelfde soort tekstvak als bij een vel, met één werkafspraak per regel en dezelfde knoppen en toetsen (Opslaan of Ctrl+Enter, Annuleren of Esc).

- Een `-`, `*`, `•` of `1.` aan het begin van een regel valt weg, zodat je een lijstje uit een mail of document kunt plakken. Lege regels en regels zonder tekst vallen ook weg.
- Hoe langer de lijst, hoe kleiner de letters, zodat alles op het bord past (vanaf ongeveer 8 afspraken; tot zo'n 16 korte afspraken blijft het goed leesbaar).
- Gewijzigde werkafspraken gaan mee in de download op het afsluitscherm ("Je hebt de werkafspraken gewijzigd").
- De bewerkmodus is stil: het belletje, de vraagtoon, het papiergeritsel, het schrijfgeluid en de geluidjes van de geeltjes klinken niet.
- Wijzigingen staan alleen in het geheugen en zijn weg na herladen. Bewaar ze via het afsluitscherm.

**Afsluitscherm en wijzigingen bewaren:** na de laatste inhoud volgt een donker afsluitscherm met "EINDE". Daar wordt gecontroleerd of de inhoud is gewijzigd. Zo ja, dan staat er groot een knop **Download content.json**, met daaronder hoeveel items je hebt toegevoegd, bewerkt en verwijderd. In de download zijn alleen de titel en de steps van gewijzigde vellen vervangen; al het andere blijft precies zoals het was (ongeldige items in een gewijzigd vel, die de presentatie al oversloeg, vallen daarbij weg). Let op: dit bestand is **onversleuteld**. Zet het in de projectmap, versleutel het opnieuw (`node tools/encrypt.js`) en verwijder de download daarna.

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

Klik je op het plusje of druk je op de plustoets, dan verschijnt onder de tips een invoerregel: een gestippelde lijn met de grijze tekst "Nieuwe tip…".

### Midden: het whiteboard

Een groot, wit whiteboard met een glanzende aluminium rand en een lichte lichtweerkaatsing schuin over het bord. Onder het bord hangt een grijze pennenbak met drie whiteboardstiften die er liggen: elke stift heeft een witte huls met een gekleurd etiket en een gekleurde dop, in blauw, rood en zwart. De zwarte ligt iets scheef.

Het bord bestaat uit drie delen, van boven naar beneden.

**Bovenaan de doelen** (als die in de inhoud staan): hooguit vier regels in zwart handschrift, in twee kolommen, zonder kop en zonder lijnen. Voor elk doel staat een met de hand getekend zwart vierkant vakje, iets scheef. Aan het begin zijn alle vakjes leeg. Wordt een doel bereikt, dan wordt er in groene marker een vinkje in het vakje gezet: eerst een korte streek naar beneden, dan een lange omhoog, die net buiten het vakje uitsteekt.

**Daaronder het kanbanbord**, het grootste deel van het bord. Drie kolommen, gescheiden door met de hand getrokken zwarte lijnen, met elk een kop in markerletters en een streep eronder: "To do" in blauw, "Doing" in rood en "Done" in groen. In de kolommen hangen gele plakbriefjes (geeltjes), elk iets scheef geplakt, met in zwart handschrift de naam van een onderwerp. Elk geeltje is één onderwerp van de presentatie. Aan het begin hangen ze allemaal in To do, behalve het eerste onderwerp, dat in Doing hangt. Het onderwerp dat nu besproken wordt hangt altijd in Doing; afgeronde onderwerpen hangen in Done. Bij het laatste onderwerp hangen alle andere geeltjes in Done. Hoe meer onderwerpen, hoe kleiner de geeltjes, zodat ze altijd in één kolom passen.

**Onderaan de vraagzone**, een strook over de hele breedte, gescheiden van het kanbanbord door een grijze stippellijn. Meestal is die strook leeg. Bij een vraag aan de zaal staat daar links een rood omcirkeld vraagteken en rechts daarvan de vraag in blauwe markerletters (zie hieronder).

**De werkafspraken** zijn standaard niet te zien. Met de knop "Werkafspraken" in de bedieningsbalk (of de toets W) verschijnen ze over het hele bord heen: het bord wordt bijna helemaal wit, met alleen een heel vage schim van het kanbanbord erachter. Daarop staat een grote kop "Werkafspraken" in rode markerletters, iets scheef, met daaronder de afspraken onder elkaar in groot zwart handschrift, elk met een blauw vinkje ervoor. Ze blijven staan tijdens het bladeren, tot je ze met de knop, W of Esc weer verbergt.

### Rechts: de flip-over met steekwoorden

Dezelfde soort flip-over als links. Bovenaan elk vel staat de titel van dat vel in blauwe markerletters (hoofdletters, iets scheef), met daaronder een dikke blauwe lijn over de hele breedte van het vel. Een lange titel loopt over twee regels. De titel staat er altijd, ook als er nog geen steekwoorden zijn. Onder de lijn verschijnen de steekwoorden van het huidige vel, onder elkaar, in handschrift, elk met een rode stip ervoor. Een steekwoord kan ook inspringen, één of twee niveaus; dan is het opsommingsteken een kleinere rode stip of een kort rood streepje. In plaats van een stip kan er een rood nummer staan (1., 2., 3., …), bijvoorbeeld bij een genummerde reeks die een woord erboven uitlegt. Tussen steekwoorden kan een stukje witruimte staan, of een dikke blauwe lijn over de breedte van het vel, zoals de lijn onder de titel. Standaard is het handschrift blauw, maar een steekwoord kan ook in een andere markerkleur staan: rood, zwart, groen, okergeel, donkeroranje, paars of roze. Alle kleuren zijn donker en goed leesbaar op het lichte papier. De regels staan om en om een heel klein beetje scheef, zoals echt handschrift. Elk vel begint met alleen de titel en vult zich per klik. Bij een nieuw vel slaat het oude vel om: het klapt naar boven weg en er komt een nieuw vel tevoorschijn, met alleen de nieuwe titel erop. Ga je terug, dan klapt het vorige vel, met zijn titel, weer naar beneden.

### Wat er per inhoudstype gebeurt

Elke klik laat één of meer items verschijnen. Bij meer items tegelijk worden ze kort na elkaar geschreven, in volgorde. Er zijn vier soorten items, elk met een eigen plek, beeld en geluid:

- **Steekwoord** (`keyword`): verschijnt rechts op de flip-over, onderaan de lijst, in blauw of in de opgegeven markerkleur, eventueel ingesprongen, genummerd of met witruimte of een lijn erboven. De tekst wordt van links naar rechts "geschreven". Geen geluid. Een schermlezer leest de kleur niet voor.
- **Tip** (`tip`): verschijnt links op de flip-over, onderaan de lijst, ook van links naar rechts geschreven. Er klinkt een hoog belletje, als een klein klokje; bij meerdere tips in één klik klinkt het één keer.
- **Vraag** (`question`): verschijnt in de vraagzone onderaan het whiteboard. Eerst springt links een rood omcirkeld vraagteken in beeld, daarna wordt rechts daarvan de vraag in blauwe markerletters geschreven, iets scheef. Een lange vraag krijgt kleinere letters, zodat hij altijd in de zone past. Er klinkt een korte toon die snel omhoog glijdt. Bij de volgende klik vervaagt de vraag weer en is de zone leeg. Het kanbanbord blijft tijdens een vraag gewoon zichtbaar.
- **Doel afvinken** (`check`): in het vakje bij het doel bovenaan het whiteboard wordt een groen vinkje getekend, in twee streken. Tegelijk klinkt een kort schrijfgeluidje: een stift die een vinkje zet, in twee streken, met het schurende, licht haperende geluid van een stiftpunt op het bord en een heel zacht piepje. Het klinkt elke keer net iets anders. Het vinkje blijft staan.

Verder:

- **Nieuw vel:** het vel rechts slaat om, met een kort geritsel van papier.
- **Nieuw onderwerp:** niet alles tegelijk, maar rustig na elkaar (samen ongeveer 2 seconden). Eerst slaat het vel rechts om, met geritsel. Als het vel bijna om is, wordt het geeltje van het vorige onderwerp opgepakt: je hoort een kort, knisperend geluidje, als plakband dat loslaat, het geeltje wordt iets groter en krijgt een grote schaduw, alsof het van het bord wordt getild. Het maakt een boogje naar Done en wordt daar even aangedrukt, met een korte, doffe tik. Beide geluidjes zijn ongeveer even luid als het geritsel en ook op laptopspeakers goed te horen. Na een korte pauze gebeurt hetzelfde met het geeltje van het nieuwe onderwerp, van To do naar Doing; pas als dat is opgetild, schuiven de andere geeltjes in To do op om het gat te dichten. Terugbladeren gaat op dezelfde manier, de andere kant op.
- **Geluiden overlappen nooit.** Klinken er bij één klik meer geluiden (bijvoorbeeld bij een sprong met End), dan komen ze na elkaar: eerst het geritsel, dan de vraagtoon, dan het belletje, dan het schrijfgeluid (het vinkje wordt getekend op het moment dat dat klinkt). De geluidjes van de geeltjes vallen weg als er op dat moment al iets anders klinkt.
- De animaties spelen altijd, ook als in het besturingssysteem "minder beweging" (in Windows: Animatie-effecten uit) is ingesteld. Dit prototype houdt daar bewust geen rekening mee.

### De bedieningsbalk

Rechtsonder in beeld staat een kleine, afgeronde, donkergrijze balk die half doorzichtig is. Hij verschijnt als je de muis beweegt en verdwijnt na twee seconden weer. Van links naar rechts staan erin: een pijl naar links (vorige), de voortgang (bijvoorbeeld "2 / 6", of "Einde" op het afsluitscherm), een pijl naar rechts (volgende), de vetgedrukte knop "Werkafspraken" (om de werkafspraken te tonen of te verbergen) en een knop voor volledig scherm. Bij de laatste inhoud verandert de pijl naar rechts in de vetgedrukte tekst "Einde" met een pijltje: die knop gaat naar het afsluitscherm. Op het startscherm staat op die plek op dezelfde manier "Start" met een pijltje. De balk blijft staan zolang de muis erboven is of een knop erin de focus heeft. In de bewerkmodus komen er achteraan nog twee dingen bij: een geel label "✎ Bewerken" en de vetgedrukte knop "Vel bewerken". Zolang de werkafspraken in beeld zijn, staat daarachter nog de vetgedrukte knop "Werkafspraken bewerken". Die opent hetzelfde lichtcrème vlak met tekstvak, uitleg en knoppen als bij een vel, maar dan over het hele whiteboard, met in het tekstvak één werkafspraak per regel.

In de bewerkmodus krijgt de rechter flip-over bij aanwijzen een blauwe rand. Bewerk je een vel, dan ligt er over het hele vel een lichtcrème vlak met een blauwe rand. Daarin staat bovenaan een groot wit tekstvak in een gewoon, vast-breed lettertype (geen handschrift), met alle klikken van het vel als tekst (zonder de titel). Daaronder staat in kleine grijze letters de korte uitleg van de notatie, met de tekens in blauw. Helemaal onderaan staan rechts twee knoppen: "Annuleren" (wit met een grijze rand) en "Opslaan" (blauw met witte letters). De titel van het vel krijgt bij aanwijzen een heel lichtblauwe achtergrond; klik je erop, dan wordt hij een lichtgeel invoerveld met dezelfde blauwe markerletters en een gestippelde blauwe lijn eronder. Een melding, bijvoorbeeld na een klik op een tip, verschijnt even midden onderin beeld, boven de bedieningsbalk, als witte tekst op een donkergrijs, afgerond vlak, en verdwijnt na zes seconden.

### Het startscherm

Na het inloggen zie je eerst een startscherm in donkere modus, in dezelfde kleuren als het afsluitscherm: bijna zwart, met in het midden een heel zachte, iets lichtere gloed. Midden in beeld staat in grote, vette, bijna witte hoofdletters met veel ruimte tussen de letters het woord "WELKOM". Daaronder staat, kleiner en in lichtgrijze gewone letters, de titel van de presentatie (bijvoorbeeld "Lean in de praktijk"); een lange titel loopt over twee regels. Het whiteboard en de flip-overs zijn nog niet te zien.

Rechtsonder staat de bedieningsbalk, altijd zichtbaar, donkergrijs met een lichtere rand. Daarin: de pijl naar links (uitgeschakeld en gedimd), het woord "Welkom", de vetgedrukte knop "Start" met een pijltje, de knop "Werkafspraken" (uitgeschakeld en gedimd) en de knop voor volledig scherm. Met Start verdwijnt het donkere scherm en verschijnt de vergaderruimte met het whiteboard.

### Het afsluitscherm

Na de laatste inhoud volgt een afsluitscherm in donkere modus. Het hele beeld is dan bijna zwart, met in het midden een heel zachte, iets lichtere gloed. Midden in beeld staat in grote, vette, bijna witte hoofdletters met veel ruimte tussen de letters het woord "EINDE". Het whiteboard en de flip-overs zijn niet meer te zien.

Is de inhoud tijdens de presentatie gewijzigd (tips toegevoegd, of in de bewerkmodus een vel aangepast), dan staat onder "EINDE" een grote, afgeronde, felgroene knop met donkere tekst: een pijl naar beneden en "Download content.json". Daaronder staat in lichtgrijze tekst wat er gewijzigd is (bijvoorbeeld "Je hebt 2 onderdelen toegevoegd en 1 onderdeel bewerkt") en dat het bestand onversleuteld is. Zonder wijzigingen ontbreekt die knop en de tekst eronder.

Tussen "EINDE" en de downloadknop staat altijd een tweede grote, afgeronde knop, maar niet gevuld: een felgroene rand op de donkere achtergrond, met bijna witte tekst "Vellen opslaan als PDF" en daarvoor een klein groen printer-icoontje (lijntekening). Daaronder staat in lichtgrijze tekst: "Alle vellen en de tips, elk op een A4. Kies in het afdrukvenster ‘Opslaan als PDF’."

De PDF zelf: elke pagina is wit, staand A4. Bovenaan staat links in kleine, vette, gewone letters de titel van de presentatie en rechts de datum (bijvoorbeeld "11 oktober 2026"), met een dunne grijze lijn eronder. Daaronder, bijna over de hele pagina, staat het vel: een wit vlak met een dun beige randje, met precies dezelfde markerletters, kleuren, stippen en nummers als op de flip-over. De eerste pagina is het tipsvel ("Tips" in groene markerletters, de tips met groene sterretjes of rode plusjes), daarna volgen de vellen van rechts in volgorde. Onderaan elke pagina staat, kleiner en grijs, links het onderwerp (bijvoorbeeld "Onderwerp: Theorie", of "Alle tips uit de presentatie") en rechts het paginanummer ("Pagina 2 van 11"), met een dunne lijn erboven. Op een vel met weinig tekst blijft de onderkant van het vel leeg.

De bedieningsbalk blijft op het afsluitscherm altijd zichtbaar, rechtsonder, nu donkergrijs met een lichtere rand zodat hij goed loskomt van de achtergrond. De pijl naar rechts en de knop "Werkafspraken" zijn daar uitgeschakeld en gedimd; met de pijl naar links ga je terug naar de laatste inhoud.

### Het wachtwoordscherm

Voordat de presentatie opent, zie je op dezelfde beige achtergrond een witte kaart in het midden van het scherm. Daarop staat de titel "Presentatie" in blauwe markerletters, de zin "Voer het wachtwoord in om de presentatie te openen.", een invoerveld voor het wachtwoord en een blauwe knop "Openen". Bij een fout wachtwoord verschijnt daaronder in rood "Onjuist wachtwoord." Na het juiste wachtwoord volgt het startscherm.

### Wat een schermlezer meekrijgt

Eerlijk gezegd is de presentatie vooral visueel. Wat er nu is:

- De drie delen hebben een naam: "Tips", "Whiteboard" en "Steekwoorden". De bedieningsbalk heet "Bediening".
- De knop "Werkafspraken" meldt of de werkafspraken aan of uit staan, en dat de sneltoets W is. Als ze zichtbaar zijn, vormen ze een gebied met de naam "Werkafspraken"; als ze verborgen zijn, leest een schermlezer ze niet voor.
- De geeltjes zijn knoppen. Ze lezen hun onderwerp voor en hebben als beschrijving "Ga naar:" gevolgd door het onderwerp.
- Een vraag wordt automatisch voorgelezen zodra hij verschijnt (de vraagzone is een voorleesregio).
- Een nieuwe tip wordt ook automatisch voorgelezen, als "Tip:" gevolgd door de tekst. Dat gebeurt alleen voor de tips van de klik die je net doet; bij terugbladeren of een sprong naar een ander onderwerp (via een geeltje) wordt niets voorgelezen. Een tip die je zelf toevoegt, wordt bevestigd met "Tip toegevoegd:" en de tekst.
- De doelen vormen een lijst met de naam "Doelen". Achter elk doel staat voor een schermlezer "(nog niet afgevinkt)" of "(afgevinkt)". Het afvinken zelf wordt niet automatisch voorgelezen; het schrijfgeluidje geeft het aan.
- De titel van het vel rechts is een kop; daarmee kun je in een schermlezer per vel navigeren. Ook "Tips" links en de kolomkoppen "To do", "Doing" en "Done" zijn koppen.
- Het startscherm heet "Welkom" en het afsluitscherm "Einde"; de knoppen daar lezen "Vellen opslaan als PDF" (met de uitleg eronder als beschrijving) en "Download content.json" voor.
- Op het start- en afsluitscherm is de inhoud van de presentatie (whiteboard en flip-overs) volledig weg: een schermlezer leest er niets van voor, en met Tab of zoeken is er niets van te bereiken. Alleen "WELKOM" of "EINDE", de knoppen van het afsluitscherm en de bedieningsbalk zijn er dan.
- De PDF is een gewone afdruk van tekst: de tekst is te selecteren en te doorzoeken, en wordt in de volgorde van de vellen gelezen. Kleuren, inspringen en lijnen staan er alleen als opmaak in. De afdrukversie zelf staat op het scherm verborgen en is voor een schermlezer onzichtbaar.
- De foutmelding bij een fout wachtwoord wordt automatisch voorgelezen.
- De knop met het plusje heet "Tip toevoegen" en de invoerregel heet "Nieuwe tip".
- Navigeren kan volledig met het toetsenbord (zie Bediening). De geluiden geven aan wat er verschijnt: belletje voor een tip, geritsel voor een nieuw vel, opgaande toon voor een vraag, schrijfgeluid voor een afgevinkt doel, en bij een nieuw onderwerp twee keer "oppakken en vastplakken" voor de geeltjes die verhuizen.

In de bewerkmodus is "Vel bewerken" een echte knop met als sneltoets E; "Werkafspraken bewerken" ook, met als sneltoets A (alleen aanwezig zolang de werkafspraken in beeld zijn). Het tekstvak van de werkafspraken heet "Werkafspraken, één per regel" en ligt in een groep "Werkafspraken bewerken"; verder werkt het als dat van een vel. Het tekstvak heet "Klikken van het vel als tekst" en heeft de korte uitleg van de notatie als beschrijving; het ligt in een groep "Vel bewerken:" gevolgd door de titel, en krijgt direct de focus, zodat een schermlezer het meteen aankondigt. Daarna volgen de knoppen "Annuleren" en "Opslaan"; Esc en Ctrl+Enter werken ook. Na opslaan of annuleren gaat de focus terug naar waar hij was (bijvoorbeeld de knop "Vel bewerken"). De melding na een klik op een tip wordt automatisch voorgelezen. De rechter flip-over zelf is alleen met de muis aan te klikken; met het toetsenbord gebruik je E of de knop. De titel van het vel (een kop) is in de bewerkmodus ook met Tab te bereiken en heeft als tooltip "Titel bewerken (klik of Enter)"; Enter maakt er een invoerveld "Titel van het vel" van, met de focus erin. Na Enter of Esc gaat de focus terug naar de titel.

Wat er nog niet is:

- Nieuwe steekwoorden, het verschuiven van geeltjes en de voortgang ("2 / 6") worden niet automatisch voorgelezen.
- De knoppen vorige en volgende in de bedieningsbalk zijn pijlen met alleen een beschrijving als tooltip, geen echte naam. "Start", "Einde", "Werkafspraken", "Volledig scherm" (het kadertje), "Vel bewerken" en "Werkafspraken bewerken" hebben wel een echte naam; die met een sneltoets (W, F, E en A) melden die sneltoets ook aan een schermlezer.
- Een aantal dingen bestaat alleen in de opmaak en wordt dus niet als tekst doorgegeven: het rode plusteken bij een tijdens de presentatie toegevoegde tip, de kleuren, het inspringen en de lijnen tussen steekwoorden. De nummers bij genummerde steekwoorden komen ook uit de opmaak; of een schermlezer die voorleest, verschilt per schermlezer.

## Goed om te weten

- **Hoeveel past er?** Lettergroottes passen zich automatisch aan, maar dit blijft goed leesbaar: hooguit 4 korte doelen (liefst op één regel), tot ongeveer 12 onderwerpen (daarboven worden de geeltjes klein), zo'n 15 korte tips in totaal en ongeveer 10 steekwoorden per vel (de titel neemt bovenaan ook ruimte in; houd hem kort, liefst één of twee regels). Past een flip-over zelfs met de kleinste letters niet meer, dan meldt de console dat (handig tijdens het voorbereiden met `?plain`). Lange losse woorden op een geeltje worden kleiner dan korte.
- **Nooit `content.json` committen.** De git-geschiedenis bewaart alles, ook als je het later verwijdert.
- **Eén gedeeld wachtwoord.** Na een wachtwoordwissel blijven oude versies in de git-geschiedenis te ontsleutelen met het oude wachtwoord.
- **Lettertypen** komen van Google Fonts (Caveat en Permanent Marker). Wil je dat bezoekers niets naar Google sturen, host ze dan zelf in een map `fonts/` en vervang de `<link>` in `index.html` door `@font-face`-regels.
- **De motor gebruikt de Web Crypto API.** Die werkt alleen via HTTPS of `localhost`; GitHub Pages gebruikt standaard HTTPS. Een bestand dat je direct opent (`file://`) werkt niet, omdat de browser de inhoud dan niet mag laden.
- **Nog niet gebouwd:** PDF-export en sprekersnotities.
