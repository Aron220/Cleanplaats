# Cleanplaats in Safari (macOS)

Safari draait dezelfde extensie als Chrome en Firefox, maar laadt haar alleen uit een Mac-app. Deze map maakt die app op je eigen Mac, uit de bestanden in deze repo. Aan de extensie zelf verandert niets: Chrome en Firefox merken niet dat deze map bestaat, en `package.py` neemt haar niet mee in de zip voor de winkels.

## Wat je nodig hebt

- macOS met Safari 18.4 of nieuwer
- Xcode (gratis, App Store), één keer geopend zodat de onderdelen geïnstalleerd zijn
- een Apple ID in Xcode voor het ondertekenen. Een gewoon, gratis Apple ID is genoeg; het betaalde ontwikkelaarsprogramma is niet nodig

Het Apple ID stel je eenmalig in via Xcode > Settings > Accounts: klik op "+", log in, kies je account, daarna "Manage Certificates..." > "+" > "Apple Development".

## Installeren

```bash
git clone https://github.com/Aron220/Cleanplaats.git
cd Cleanplaats
safari/build.sh
```

Het script bouwt de app, ondertekent haar met je eigen certificaat, zet `Cleanplaats.app` in `/Applications` en opent haar één keer, zodat Safari de extensie kent. Daarna:

1. Safari > Instellingen > Extensies: vink Cleanplaats aan.
2. Open marktplaats.nl, klik op het Cleanplaats-icoon in de werkbalk en geef de extensie altijd toegang tot die website. Doe hetzelfde op 2dehands.be en 2ememain.be als je die gebruikt.
3. Ververs de pagina.

Zonder stap 2 doet de extensie niets: Safari geeft een extensie pas toegang tot een site nadat je dat zelf hebt toegestaan.

## Bijwerken

```bash
safari/build.sh --update
```

Dat haalt de nieuwste versie van Cleanplaats op en bouwt de app opnieuw. Je instellingen, verborgen verkopers en blacklist blijven staan. Safari werkt een zelfgebouwde extensie niet uit zichzelf bij, dus een nieuwe versie van Cleanplaats komt pas in Safari als je dit draait.

Werk je vanuit een fork, voeg dan deze repo toe als `upstream` (`git remote add upstream https://github.com/Aron220/Cleanplaats.git`); `--update` haalt de code dan daar vandaan.

## Eerst proberen zonder Xcode

Safari 26 en nieuwer kan een extensiemap tijdelijk laden, zonder app eromheen:

```bash
safari/build.sh --stage-only
```

Zet daarna in Safari > Instellingen > Geavanceerd de functies voor webontwikkelaars aan, kies bij de ontwikkelaarsinstellingen "Add Temporary Extension..." en selecteer `safari/build/extension`. De extensie verdwijnt weer als je Safari sluit. Handig om te kijken of alles werkt; voor dagelijks gebruik is de app hierboven bedoeld.

## Wat in Safari anders is

`stage.py` zet een kopie van de extensie klaar in `safari/build/extension` en past daarin alleen het manifest aan:

| Verschil | Waarom |
| --- | --- |
| Recht `declarativeNetRequestWithHostAccess` erbij | Safari voert een redirect-regel alleen uit voor een extensie met dat recht. De instelling "resultaten per pagina" is zo'n regel. |
| Achtergrond als pagina (`background.scripts`), niet als service worker | Hetzelfde pad als in Firefox, waar de keep-alive voor geschreven is. Een service worker laat zich in Safari bovendien slecht inspecteren. |
| Drie scripts uit `extension/` erbij | Safari kent `webNavigation.onHistoryStateUpdated` niet. Zonder vervanger worden de standaardsortering en het aantal resultaten per pagina niet opnieuw in de URL gezet zodra de site zonder herladen naar een andere zoekopdracht gaat. Twee scripts melden dat moment vanaf de pagina; `background.js` geeft het in de achtergrond door aan de bestaande listener. |
| Blokkeerregels één voor één bijwerken, en nakijken | Safari vergelijkt `removeRuleIds` met een lijst in het geheugen die pas even na het opstarten gevuld is. Een update bij het opstarten verwijdert daardoor niets en strandt op "do not have unique IDs", omdat de regels van de vorige keer nog zijn opgeslagen. `background.js` voert updates na elkaar uit, kijkt met `getDynamicRules()` of ze echt zijn opgeslagen en probeert het anders kort daarna opnieuw. |
| `scroll-guard.js` als content script | Marktplaats zet de pagina op slot zolang de fotoviewer open is, met één regel in de eigen stylesheet: `html:has(> body.ReactModal__Body--open .hz-Modal) { overflow: hidden }`. In Safari bleef dat slot na het sluiten van de viewer soms staan, en dan scrolt de pagina niet meer tot je herlaadt. Het script haalt een slot weg waar geen venster meer bij hoort, en blijft eraf zolang er wel een venster open is. |
| `browser_specific_settings` alleen voor Safari, ondergrens 18.4 | 18.4 is de eerste versie die `initiatorDomains` in blokkeerregels kent. Daarzonder zouden de regels op elke site gelden in plaats van alleen op Marktplaats, 2dehands en 2ememain. |

Welke bestanden meegaan bepaalt `collect()` in `package.py`, dezelfde lijst als voor de winkels. Een nieuw bestand in `content/` of `background/` gaat dus vanzelf mee naar Safari.

Wat niet is aangepast: de link "Schrijf een review" wijst in Safari naar de Chrome Web Store, en er is geen versie voor iPhone of iPad.

## Bestanden

```text
build.sh            Zet klaar, maakt het Xcode-project, bouwt, ondertekent en installeert
stage.py            Maakt de extensiemap voor Safari (en zet de bundle-id's in het project gelijk)
extension/          De scripts die alleen in Safari meegaan
build/              Wat het script maakt; staat niet in git
```

Het Xcode-project in `build/xcode` komt uit Apple's `safari-web-extension-converter` en wordt bij elke build opnieuw gemaakt. Er valt niets in te bewaren.

## Als het niet werkt

- **De extensie staat niet in Safari's lijst.** Open `/Applications/Cleanplaats.app` één keer en kijk opnieuw.
- **Cleanplaats staat na een herstart van Safari weer uit.** Dan is de app niet ondertekend (gebouwd met `--unsigned`). Stel het Apple ID in Xcode in en draai `safari/build.sh` opnieuw.
- **Na ongeveer een jaar valt de extensie uit.** Een gratis certificaat is ongeveer een jaar geldig. Maak in Xcode een nieuw "Apple Development"-certificaat en draai `safari/build.sh` opnieuw.
- **De build mislukt.** Het script toont het eind van `safari/build/xcodebuild.log`. Meestal is Xcode nog nooit geopend (licentie en onderdelen), of is het Apple ID uitgelogd.
- **De pagina ziet er hetzelfde uit als zonder extensie.** Controleer stap 2 hierboven: het icoon in de werkbalk laat zien of de extensie toegang tot de site heeft.
- **Iets werkt anders dan in Chrome of Firefox.** Meld het via [GitHub Issues](https://github.com/Aron220/Cleanplaats/issues) en zet erbij dat het om Safari gaat, met de versie. De achtergrondpagina van de extensie open je in de Web Inspector via het menu Ontwikkel (Develop) > Web Extension Background Content.
