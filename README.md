# Cleanplaats - Marktplaats zonder spam

Een browser extensie die automatisch advertenties en promotionele content verwijdert van Marktplaats en 2dehands.be.

## Features

### 🧹 Automatische filtering
- **Topadvertenties/Topzoekertjes**: Verwijdert betaalde top advertenties
- **Dagtoppers**: Verwijdert dagtopper advertenties  
- **Bedrijfsadvertenties**: Verwijdert advertenties van bedrijven met "Bezoek website" links
- **Opvalstickers**: Verwijdert advertenties met opvalstickers
- **Google Ads**: Verwijdert alle Google advertenties en banners

### 🚫 Blacklist functionaliteit
- **Verkopers verbergen**: Klik op "Verkoper verbergen" om alle advertenties van een verkoper te verbergen
- **Termen blacklist**: Voeg termen toe om advertenties met die termen automatisch te verbergen
- **Beheer interface**: Eenvoudig beheer van verborgen verkopers en termen via het configuratiepaneel

### ⚙️ Resultaten per pagina
- **Aanpasbaar aantal**: Kies tussen 30, 50 of 100 resultaten per pagina
- **URL rewriting**: Automatische URL aanpassing voor consistente resultaten
- **Cross-browser**: Werkt op Chrome, Firefox en Firefox Android

### 📊 Statistieken & Badge
- **Live teller**: Zie hoeveel items er zijn verwijderd in het configuratiepaneel
- **Browser badge**: Toont het aantal verwijderde items in de browser toolbar
- **Per categorie**: Gedetailleerde statistieken per type verwijderd item

### 🎨 Gebruiksvriendelijk
- **Configuratiepaneel**: Inklapbaar paneel rechtsonder op de pagina
- **Onboarding**: Welkomstbericht voor nieuwe gebruikers
- **Responsive**: Werkt op desktop en mobiel
- **Toast notificaties**: Feedback bij acties zoals blacklisting

## Installatie

### Chrome/Chromium
1. Download de extensie bestanden
2. Ga naar `chrome://extensions/`
3. Zet "Developer mode" aan
4. Klik "Load unpacked" en selecteer de extensie map

### Firefox
1. Download de extensie bestanden  
2. Ga naar `about:debugging`
3. Klik "This Firefox"
4. Klik "Load Temporary Add-on" en selecteer `manifest.json`

### Firefox Android
1. Installeer Firefox Nightly op Android
2. Ga naar `about:config` en zet `xpinstall.signatures.required` op `false`
3. Volg de Firefox desktop instructies

## Technische details

### Manifest v2
De extensie gebruikt Manifest v2 voor optimale compatibiliteit met:
- WebRequest API voor URL rewriting
- Browser badge functionaliteit  
- Cross-browser ondersteuning

### Bestanden
- `manifest.json`: Extensie configuratie
- `background.js`: URL rewriting en badge management
- `content.js`: DOM manipulatie en filtering
- `content.css`: Styling voor het configuratiepaneel
- `purify.min.js`: DOMPurify voor veilige HTML sanitization

### Permissions
- `storage`: Opslaan van gebruikersinstellingen
- `webRequest`: URL interceptie voor resultaten per pagina
- `webRequestBlocking`: Blokkeren van requests voor rewriting
- `tabs`: Badge updates en tab management
- Host permissions voor marktplaats.nl en 2dehands.be

## Ontwikkeling

### Lokaal testen
```bash
# Controleer bestanden
find . -name "*.json" -o -name "*.js"

# Laad in browser voor testen
# Chrome: chrome://extensions/ -> Load unpacked
# Firefox: about:debugging -> Load Temporary Add-on
```

### Features toevoegen
1. Voeg nieuwe filtering logica toe in `content.js`
2. Update instellingen interface in `createControlPanel()`
3. Voeg storage handling toe in `loadSettings()` en `saveSettings()`
4. Test op beide Marktplaats en 2dehands

## Licentie

Dit project is open source. Zie de broncode voor details.

## Ondersteuning

Voor vragen of problemen, maak een issue aan in de repository.

---

**Buy me a coffee**: Als je Cleanplaats nuttig vindt, overweeg dan om de ontwikkelaar te steunen via de "Buy me a coffee" link in het configuratiepaneel. 