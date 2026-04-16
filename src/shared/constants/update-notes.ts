import type { UpdateNote } from '@/shared/types/state';

export const CLEANPLAATS_UPDATE_NOTES: Record<string, UpdateNote> = {
  '2.0.7': {
    intro:
      'Cleanplaats 2.0.7 voegt een extra veiligheidswaarschuwing toe op advertentiepagina’s en maakt het verbergen van verkopers duidelijker en handiger.',
    highlights: [
      'Je kunt nu een waarschuwing krijgen bij nieuwe verkoperaccounts. Deze instelling vind je onder het tabje "Voorkeuren" in het paneel, waar je zelf kiest vanaf hoeveel dagen, weken, maanden of jaren je zo’n melding wilt zien.',
      'Op advertentiepagina’s staat nu ook een knop onder de verkopernaam om in één keer alle advertenties van die verkoper te verbergen.',
      'De knop om een verkoper te verbergen is nu ook netjes vertaald op 2ememain.',
    ],
    note: 'Zie je een verkoper die je niet vertrouwt? Dan kun je die nu direct vanaf de advertentiepagina verbergen.',
  },
  '2.0.6': {
    intro:
      'Cleanplaats 2.0.6 herstelt een paar dingen op Favorieten en lost een vervelende fout op die sommige filters uit beeld haalde.',
    highlights: [
      'De filters voor categorie en afstand zijn weer terug waar ze horen.',
      'Gerelateerde advertenties in Favorieten worden niet meer standaard verborgen. Via de nieuwe knop "Voorkeuren" kun je dit nu zelf aan of uit zetten.',
      'Niet-beschikbare advertenties in Favorieten zien er in dark mode nu weer duidelijk anders uit dan actieve advertenties.',
    ],
    note: 'Excuses voor de bug waardoor categorie en afstand ineens konden verdwijnen. Bedankt aan iedereen die dit zo snel heeft gemeld via Reddit en GitHub issues. Jullie hulp en betrokkenheid maken Cleanplaats tot het succes dat het is.',
  },
  '2.0.5': {
    intro:
      'Cleanplaats 2.0.5 werkt Marktplaats verder bij met vooral meer dark mode-ondersteuning en een rustigere interface op meerdere pagina’s.',
    highlights: [
      'Dark mode is verder uitgebreid op onder meer "Mijn advertenties", account- en plaats advertentie-pagina’s, tabelweergaven en onderdelen rond eigen advertenties.',
      'Ook losse interface-elementen zoals "Deal gesloten?", voorstel- en leveringsmenu’s nemen nu beter het donkere thema over.',
      'Storende banners en promotieblokken zijn op meerdere plekken verborgen, waaronder "gerelateerde advertenties" in Favorieten.',
      'Een visuele flicker bij het laden in dark mode is aangepakt, waardoor pagina’s rustiger en consistenter openen.',
      "Marktplaats banner voor 'koop je auto bij autobedrijven' weggehaald",
    ],
    note: "Zie je nog een onderdeel of licht onderdeel dat door de dark mode heen glipt in veel gebruikte pagina's? Meld het via GitHub issues in het paneel.",
  },
};
