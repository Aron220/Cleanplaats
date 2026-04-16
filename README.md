# Cleanplaats

Cleanplaats is een browserextensie voor [Marktplaats](https://www.marktplaats.nl/), [2dehands](https://www.2dehands.be/) en [2ememain](https://www.2ememain.be/) die rommel uit zoekresultaten en overzichtspagina's haalt.

Deze versie is herschreven naar **WXT + React + TypeScript**, met dezelfde kernfunctionaliteit en browserondersteuning als de vorige implementatie.

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

## Browserondersteuning

De projectconfiguratie ondersteunt:

- Chromium (Manifest V3)
- Firefox (Manifest V3 buildpad beschikbaar via `--mv3`)

Gecko-instellingen (id/min-version) zijn behouden in de manifest-configuratie.

## Ontwikkeling

### Installeren

```bash
npm install
```

### Development builds

```bash
# Chromium
npm run dev

# Firefox
npm run dev:firefox
```

### Productiebuilds

```bash
# Chromium
npm run build

# Firefox (default target)
npm run build:firefox

# Firefox MV3 expliciet
npm run build:firefox:mv3
```

### Typecheck en tests

```bash
npm run compile
npm run test
```

## Projectstructuur

```text
src/
  entrypoints/      WXT entrypoints (background/content/theme-init)
  content/          Content runtime, services, React panel
  background/       Background services en listeners
  shared/           Types, constants, storage/message utilities
  styles/           Content/panel + dark mode CSS
icons/              Extensie-assets
wxt.config.ts       WXT config + manifest declaratie
```

## Belangrijke modules

- `src/content/services/cleanup.ts`: detecteert en verbergt listings/ads
- `src/content/services/blacklist-inject.ts`: beheer van verborgen verkopers + knoppeninjectie
- `src/content/services/theme.ts`: thema-logica en dark mode synchronisatie
- `src/content/services/notifications.ts`: onboarding, update-popup en toastmeldingen
- `src/content/panel/CleanplaatsPanel.tsx`: React-paneel met hooks/state
- `src/background/`: URL-regels, keepalive en runtime messaging

## Rechten

Cleanplaats gebruikt browserrechten die nodig zijn voor:

- opslag van gebruikersinstellingen
- injecteren van scripts en styles op ondersteunde domeinen
- tab- en navigatie-events voor extensielogica

De actuele permissies en host-permissies staan in de gegenereerde manifest output van WXT op basis van `wxt.config.ts`.

## Bijdragen

Issues en verbeterideeën zijn welkom. Gebruik bij voorkeur GitHub Issues voor:

- bugs
- regressies na markup-wijzigingen op de marktplaatssites
- feature requests
- compatibiliteitsproblemen tussen Chrome en Firefox

## Versie

Huidige versie in deze repository: `2.0.7`

