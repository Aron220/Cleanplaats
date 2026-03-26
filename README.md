# Cleanplaats

Cleanplaats is een browserextensie voor [Marktplaats](https://www.marktplaats.nl/), [2dehands](https://www.2dehands.be/) en [2ememain](https://www.2ememain.be/) die rommel uit zoekresultaten en overzichtspagina's haalt. De extensie helpt gebruikers om sneller door relevante advertenties te bladeren door promotionele, storende en ongewenste listings te verbergen.

Gebouwd voor Chromium-browsers en Firefox, met een modulaire codebase die eenvoudiger te onderhouden en uit te breiden is.

## Wat doet Cleanplaats?

Cleanplaats voegt een compact bedieningspaneel toe aan ondersteunde pagina's en laat gebruikers zelf bepalen wat verborgen wordt.

Belangrijkste functies:

- Verbergt topadvertenties, dagtoppers, bedrijfsadvertenties en promotionele stickers
- Ondersteunt verborgen verkopers en blacklist-termen op basis van advertentietitels
- Bevat een dark mode voor zowel het paneel als de marktplaatsinterface
- Ondersteunt meertalige varianten, inclusief Nederlandse en Franse termen op 2dehands en 2ememain
- Onthoudt voorkeuren zoals filters, sortering, resultaten per pagina en thema-instelling
- Toont onboarding en update-notities bij nieuwe versies

## Ondersteunde websites

- `marktplaats.nl`
- `2dehands.be`
- `2ememain.be`

## Screenshot
in progress

## Installatie voor lokaal gebruik

### Chrome of andere Chromium-browsers

1. Clone deze repository.
2. Open `chrome://extensions`.
3. Zet `Developer mode` aan.
4. Kies `Load unpacked`.
5. Selecteer de rootmap van deze repository.

### Firefox

1. Clone deze repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Kies `Load Temporary Add-on`.
4. Selecteer het bestand [manifest.json](/home/aron/projects/Cleanplaats/manifest.json).

## Ontwikkeling

Deze repository gebruikt geen buildstap. De extensie draait direct op de bestanden in de repo.

Tijdens development werk je meestal zo:

1. Pas bestanden aan in de repo.
2. Herlaad de extensie in de browser.
3. Ververs een ondersteunde pagina op Marktplaats, 2dehands of 2ememain.

Handige controle:

```bash
node --check content/shared.js
node --check content/notifications.js
```

## Projectstructuur

De codebase is opgesplitst per verantwoordelijkheid:

```text
background/         Service worker modules
content/            Content-script modules
icons/              Extensie-assets
background.js       Bootstrap voor background modules
content.js          Bootstrap voor content modules
content.css         Paneel- en UI-styling
dark-mode.css       Dark mode overrides voor ondersteunde sites
theme-init.js       Vroege theme-initialisatie om flash te voorkomen
manifest.json       Browser extension manifest
```

## Belangrijke modules

- `content/cleanup.js`: detecteert en verbergt listings
- `content/blacklist.js`: beheer van blacklist-termen en verborgen verkopers
- `content/theme.js`: thema-logica en dark mode synchronisatie
- `content/notifications.js`: onboarding, update-popup en toastmeldingen
- `content/ui.js`: opbouw van het Cleanplaats-paneel
- `background/`: achtergrondlogica voor lifecycle, messaging en URL-regels

## Rechten

Cleanplaats gebruikt browserrechten die nodig zijn voor:

- opslag van gebruikersinstellingen
- injecteren van scripts en styles op ondersteunde domeinen
- tab- en navigatie-events voor extensielogica

Zie [manifest.json](/home/aron/projects/Cleanplaats/manifest.json) voor de actuele lijst van permissies en host-permissies.

## Roadmap

Mogelijke vervolgstappen:

- extra regressietests voor selector-wijzigingen op de ondersteunde sites
- visuele regression checks voor dark mode
- verdere opschoning van content-script styling en componentstructuur

## Bijdragen

Issues en verbeterideeën zijn welkom. Gebruik bij voorkeur GitHub Issues voor:

- bugs
- regressies na markup-wijzigingen op de marktplaatssites
- feature requests
- compatibiliteitsproblemen tussen Chrome en Firefox

## Versie

Huidige versie in deze repository: `2.0.4`

