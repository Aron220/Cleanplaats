<div align="center">

<img src="public/icons/icon128.png" alt="Cleanplaats" width="96" height="96" />

# Cleanplaats

**Marktplaats, 2dehands en 2ememain — zonder spam, dagtoppers en bedrijfsadvertenties.**

[![Version](https://img.shields.io/badge/version-2.0.7-2563eb?style=flat-square)](./package.json)
[![WXT](https://img.shields.io/badge/built%20with-WXT%200.20-ff7e1d?style=flat-square&logo=googlechrome&logoColor=white)](https://wxt.dev)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=000)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285f4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6e9f18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev)
[![Chrome](https://img.shields.io/badge/Chrome-supported-34a853?style=flat-square&logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
[![Firefox](https://img.shields.io/badge/Firefox-supported-ff7139?style=flat-square&logo=firefoxbrowser&logoColor=white)](https://www.mozilla.org/firefox/)

</div>

---

## Overzicht

Cleanplaats is een browserextensie die overzichtspagina's en advertenties op
[Marktplaats](https://www.marktplaats.nl/), [2dehands](https://www.2dehands.be/)
en [2ememain](https://www.2ememain.be/) opschoont. Topadvertenties, dagtoppers,
bedrijfsadvertenties en promotieblokken worden uit de weg gehaald, en
gebruikers kunnen zelf verkopers en zoektermen verbergen.

Deze codebase is volledig herschreven met **WXT + React 19 + TypeScript**, met
behoud van bestaande functionaliteit, voorkeuren en domeinondersteuning.

## Functies

- **Slimme opschoning** — verbergt topadvertenties, dagtoppers, bedrijfsadvertenties en promotionele stickers.
- **Verkopersbeheer** — verberg specifieke verkopers in één klik, direct vanaf advertentie- of overzichtspagina's.
- **Blacklist op titel** — onderdruk listings op basis van zelfgekozen woorden of frases.
- **Dark mode** — donker thema voor zowel het Cleanplaats-paneel als de Marktplaats-interface, zonder visuele flicker bij het laden.
- **Verkoper-ouderdomswaarschuwing** — krijg een melding bij accounts jonger dan een door jou gekozen periode (dagen, weken, maanden of jaren).
- **Meertalige ondersteuning** — werkt met de Nederlandse en Franse termen op 2dehands en 2ememain.
- **Persistente voorkeuren** — filters, sortering, resultaten per pagina en thema-instellingen worden onthouden.
- **Onboarding & update-notities** — heldere uitleg bij installatie en bij iedere nieuwe versie.

## Ondersteunde sites

| Domein | Land | Taal |
| --- | --- | --- |
| `marktplaats.nl` | NL | Nederlands |
| `2dehands.be` | BE | Nederlands |
| `2ememain.be` | BE | Frans |

## Browserondersteuning

| Browser | Manifest | Status |
| --- | --- | --- |
| Chromium (Chrome, Edge, Brave, Arc, Opera) | MV3 | Ondersteund |
| Firefox (desktop + Android) | MV3 | Ondersteund (`strict_min_version: 121.0`) |

Gecko-instellingen (extensie-id en minimum versie) blijven in de
manifestconfiguratie behouden.

## Aan de slag

### Vereisten

- Node.js 20 of hoger
- npm 10 of hoger

### Installeren

```bash
npm install
```

`postinstall` voert automatisch `wxt prepare` uit en genereert de typings in
`.wxt/`.

### Development

```bash
# Chromium
npm run dev

# Firefox
npm run dev:firefox
```

WXT start een dev-runtime en schrijft de extensie naar `.output/`. Laad die
map als unpacked extension in je browser.

### Productiebuilds

```bash
# Chromium (MV3)
npm run build

# Firefox (MV3)
npm run build:firefox
```

### Distributiezips

```bash
npm run zip
npm run zip:firefox
```

### Quality gates

```bash
npm run compile   # tsc --noEmit
npm run test      # vitest run
```

## Projectstructuur

```text
src/
  entrypoints/      WXT entrypoints (background, main content, theme-init)
  content/          Content runtime, services, React-paneel
    panel/          CleanplaatsPanel.tsx + hooks/state
    services/       cleanup, blacklist-inject, theme, notifications, …
    runtime/        store en bootstrap
    locale/         paneelteksten
    utils/          site- en sorthelpers
  background/       Background services, listeners en messaging
    services/       settings, navigation, hash-url, keepalive, rules
  shared/           Types, constants, storage- en messaging-utilities
  styles/           Content/panel + dark mode CSS
  types/            Asset-typedeclaraties
public/
  icons/            Extensie-assets (gekopieerd naar de build)
tests/              Vitest-suites (background/content/shared)
wxt.config.ts       WXT-config en manifestdeclaratie
vitest.config.ts    Vitest-config
```

## Belangrijke modules

| Module | Verantwoordelijkheid |
| --- | --- |
| `src/content/services/cleanup.ts` | Detecteert en verbergt listings/ads in DOM-mutaties. |
| `src/content/services/blacklist-inject.ts` | Beheert verborgen verkopers en injecteert "verberg verkoper"-knoppen. |
| `src/content/services/blacklist-terms.ts` | Filtert advertenties op zelfgekozen titeltermen. |
| `src/content/services/theme.ts` | Thema-logica en dark-mode-synchronisatie. |
| `src/content/services/notifications.ts` | Onboarding, update-popup en toastmeldingen. |
| `src/content/panel/CleanplaatsPanel.tsx` | React-paneel met hooks, store en tabbladen. |
| `src/background/services/rules.ts` | URL-regels via `declarativeNetRequest`. |
| `src/background/services/keepalive.ts` | Service-worker keepalive via `alarms`. |

## Permissies

Cleanplaats vraagt de volgende browserrechten aan in `wxt.config.ts`:

| Permissie | Reden |
| --- | --- |
| `storage` | Opslag van gebruikersinstellingen, blacklist en thema. |
| `scripting` | Injecteren van content scripts en styles. |
| `tabs` | Reageren op tab-events voor extensielogica. |
| `webNavigation` | Detecteren van navigaties binnen Marktplaats SPA-routes. |
| `declarativeNetRequest` | URL-regels voor netwerkfilters. |
| `alarms` | Service-worker keepalive. |

Host-permissies zijn beperkt tot:

```text
*://*.marktplaats.nl/*
*://*.2dehands.be/*
*://*.2ememain.be/*
```

## Tech stack

- **[WXT](https://wxt.dev) 0.20** — extension framework met first-class MV3-ondersteuning
- **[React](https://react.dev) 19** — UI voor het in-page paneel
- **[TypeScript](https://www.typescriptlang.org) 6** — strikte types in alle entrypoints
- **[Vitest](https://vitest.dev) 4** — unit-tests voor shared utilities en content/background services
- **[@wxt-dev/module-react](https://www.npmjs.com/package/@wxt-dev/module-react)** — React-integratie binnen WXT

## Bijdragen

Bug reports, regressies en feature requests zijn welkom via GitHub Issues.
Geef bij een melding bij voorkeur aan:

- welk domein (marktplaats.nl, 2dehands.be, 2ememain.be)
- welke browser en versie
- een URL of screenshot van het probleem
- of het probleem ook optreedt na het uitzetten van de extensie

Zinvolle categorieën:

- bugs op overzichts- of advertentiepagina's
- regressies na markup-wijzigingen op de marktplaatssites
- compatibiliteitsproblemen tussen Chromium en Firefox
- voorstellen voor nieuwe filters of paneelopties

## Versie

Huidige versie: **`2.0.7`** — zie `src/shared/constants/update-notes.ts` voor
de volledige changelog die in de extensie wordt getoond.
