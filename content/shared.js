/**
 * Cleanplaats shared content-script state and locale helpers.
 */

var browserAPI = typeof browser !== 'undefined' ? browser : chrome;
var CLEANPLAATS_DARK_MODE_CLASS = 'cleanplaats-dark-mode';
var CLEANPLAATS_TWH_SITE_CLASS = 'cleanplaats-site-twh';
var CLEANPLAATS_THEME_STORAGE_KEY = 'cleanplaats:darkMode';
var CLEANPLAATS_FLOATING_OFFSET_VAR = '--cleanplaats-floating-offset';
var MARKTPLAATS_DESKTOP_LOGO_MATCH = /\/tenant--nlnl(?:\.[a-z0-9]+)?\.svg$/i;
var CLEANPLAATS_DARK_LOGO_PATH = 'icons/marktplaats-logo-darkmode.svg';
var cleanplaatsStorageSyncRegistered = false;
var notificationTimeout;
var notificationVisible = false;

function getReviewCTAConfig() {
    const runtimeUrl = browserAPI?.runtime?.getURL ? browserAPI.runtime.getURL('') : '';
    const isFirefox = runtimeUrl.startsWith('moz-extension://') || navigator.userAgent.includes('Firefox');

    if (isFirefox) {
        return {
            linkLabel: 'Firefox Add-ons',
            url: 'https://addons.mozilla.org/nl/firefox/addon/cleanplaats-marktplaats-filter/reviews/'
        };
    }

    return {
        linkLabel: 'Chrome Web Store',
        url: 'https://chromewebstore.google.com/detail/cleanplaats-marktplaats-z/peebdbeclpkljmfocjifjpjlngfpfhjp/reviews'
    };
}

function is2ememainLocale() {
    return location.hostname.includes('2ememain.be');
}

function is2dehandsFamilySite() {
    return location.hostname.includes('2dehands.be') || location.hostname.includes('2ememain.be');
}

function isMarktplaatsSite() {
    return location.hostname.includes('marktplaats.nl');
}

function isProductDetailPage() {
    return /\/v\//.test(window.location.pathname);
}

function normalizeSellerAgeText(text) {
    return (text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function parseSellerAgeToDays(text) {
    const normalizedText = normalizeSellerAgeText(text);
    const match = normalizedText.match(/(\d+)\s+(dag|dagen|day|days|jour|jours|week|weken|maand|maanden|jaar|jaren|month|months|year|years|mois|an|ans|semaine|semaines)\b/);

    if (!match) {
        return null;
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2];

    if (!Number.isFinite(amount) || amount < 0) {
        return null;
    }

    if (unit === 'dag' || unit === 'dagen' || unit === 'day' || unit === 'days' || unit === 'jour' || unit === 'jours') {
        return amount;
    }

    if (unit === 'week' || unit === 'weken' || unit === 'semaine' || unit === 'semaines') {
        return amount * 7;
    }

    if (unit === 'maand' || unit === 'maanden' || unit === 'month' || unit === 'months' || unit === 'mois') {
        return amount * 30;
    }

    if (unit === 'jaar' || unit === 'jaren' || unit === 'year' || unit === 'years' || unit === 'an' || unit === 'ans') {
        return amount * 365;
    }

    return null;
}

function getSellerAgeWarningThresholdDays() {
    const value = Math.max(1, parseInt(CLEANPLAATS.settings.sellerAgeWarningThresholdValue, 10) || 1);
    const unit = CLEANPLAATS.settings.sellerAgeWarningThresholdUnit;

    if (unit === 'days') {
        return value;
    }

    if (unit === 'weeks') {
        return value * 7;
    }

    if (unit === 'years') {
        return value * 365;
    }

    return value * 30;
}

function getPanelLocaleText() {
    if (is2ememainLocale()) {
        return {
            feedbackLabel: 'Retour',
            feedbackText: 'Issues GitHub',
            feedbackAriaLabel: 'Ouvrir GitHub issues pour les demandes de fonctionnalité, modifications et bugs',
            reviewAriaLabel: linkLabel => `Laisser un avis sur Cleanplaats sur ${linkLabel}`,
            supportTitle: 'Soutenir Cleanplaats',
            supportButton: 'Soutenir Cleanplaats',
            optionsTitle: 'Options de filtrage',
            topAdLabel: 'Pub au top',
            topAdTooltip: "Masque les annonces marquées 'Pub au top'",
            dagtoppersLabel: 'Tops du jour',
            dagtoppersTooltip: "Supprime les annonces marquées 'Top du jour'",
            promotedListingsLabel: 'Annonces professionnelles',
            promotedListingsTooltip: "Masque les annonces de boutiques et d'entreprises, y compris sur la page d'accueil dans 'Pour vous' et 'Près de chez vous'",
            stickersLabel: 'Autocollants promotionnels',
            stickersTooltip: 'Supprime les annonces avec des autocollants promotionnels',
            reservedLabel: 'Réservées',
            reservedTooltip: "Masque les annonces marquées 'Réservé'",
            favoriteRelatedAdsLabel: 'Annonces similaires dans les favoris',
            favoriteRelatedAdsTooltip: 'Masque la liste des annonces similaires affichée dans les favoris',
            sellerAgeWarningLabel: 'Alerte compte vendeur récent',
            sellerAgeWarningTooltip: "Affiche un avertissement sur une page d'annonce si le compte vendeur est plus récent que votre seuil.",
            sellerAgeWarningThresholdLabel: 'Avertir en dessous de',
            sellerAgeWarningThresholdValueAriaLabel: 'Valeur seuil pour le compte vendeur récent',
            sellerAgeWarningThresholdUnitAriaLabel: 'Unité seuil pour le compte vendeur récent',
            sellerAgeWarningThresholdUnits: {
                days: 'jours',
                weeks: 'semaines',
                months: 'mois',
                years: 'ans'
            },
            sellerAgeWarningToastTitle: 'Compte vendeur récent',
            sellerAgeWarningToastMessage: (sellerName, sellerAgeText, thresholdLabel) => `${sellerName} est sur la plateforme depuis ${sellerAgeText}. Votre seuil est ${thresholdLabel}.`,
            preferencesLabel: 'Préférences',
            backLabel: '← Retour',
            preferencesIntro: '',
            darkModeLabel: 'Mode sombre',
            darkModeTooltip: 'Active un thème sombre pour 2ememain et le panneau Cleanplaats. Expérimental: si la visibilité pose problème, désactivez-le.',
            resultsPerPageLabel: 'Résultats par page :',
            defaultSortLabel: 'Tri par défaut :',
            sortOptions: {
                standard: 'Standard',
                date_new_old: 'Plus récentes',
                date_old_new: 'Plus anciennes',
                price_low_high: 'Prix ↑',
                price_high_low: 'Prix ↓',
                distance: 'Distance'
            },
            statsTitle: 'Éléments supprimés',
            statsTop: 'Top :',
            statsDagtoppers: 'Tops du jour :',
            statsBusiness: 'Professionnel :',
            statsStickers: 'Autocollants :',
            statsOther: 'Autres :',
            statsTotal: 'Total :',
            manageTerms: 'Gérer les termes masqués dans le titre',
            manageSellers: 'Gérer les vendeurs masqués',
            termsModalTitle: 'Termes masqués',
            termsEmpty: 'Aucun terme ajouté',
            hiddenButton: 'Masqué',
            unhideButton: 'Afficher',
            termInputPlaceholder: 'Saisissez un terme',
            termInputHelp: 'Les annonces sont masquées si ce terme apparaît dans le titre.',
            addButton: 'Ajouter',
            closeButton: 'Fermer',
            sellersModalTitle: 'Vendeurs masqués',
            sellersEmpty: 'Aucun vendeur ajouté',
            sellerInputPlaceholder: 'ex. Catawiki',
            sellerInputHelp: 'Vous voulez ajouter plusieurs noms à la fois ? Séparez-les avec des virgules ou des points-virgules.',
            hideSellerButton: 'Masquer le vendeur',
            hiddenSellerButton: 'Vendeur masqué',
            hideSellerButtonAriaLabel: 'Masquer ce vendeur',
            blacklistToastHint: 'Gérez les vendeurs masqués via le panneau',
            blacklistToastHiddenSuffix: 'masqué',
            blacklistToastHiddenPluralSuffix: 'vendeurs masqués',
            blacklistToastShownSuffix: "n'est plus masqué",
            blacklistToastShownHint: 'Ce vendeur est à nouveau visible dans les résultats',
            termToastHidden: term => `Toutes les annonces contenant le terme '${term}' sont désormais masquées.`,
            termToastShown: term => `Les annonces contenant le terme '${term}' sont à nouveau affichées.`
        };
    }

    return {
        feedbackLabel: 'Feedback',
        feedbackText: 'GitHub issues',
        feedbackAriaLabel: 'Open GitHub issues voor functieverzoeken, wijzigingen en bugs',
        reviewAriaLabel: linkLabel => `Laat een review achter voor Cleanplaats op ${linkLabel}`,
        supportTitle: 'Steun Cleanplaats met een kleine bijdrage',
        supportButton: 'Steun Cleanplaats',
        optionsTitle: 'Filteropties',
        topAdLabel: 'Topadvertenties',
        topAdTooltip: location.hostname.includes('2dehands.be')
            ? "Verbergt 'Topadvertentie' en 'Topzoekertje' listings"
            : "Verwijdert betaalde 'Topadvertentie' advertenties",
        dagtoppersLabel: 'Dagtoppers',
        dagtoppersTooltip: "Verwijdert 'Dagtopper' advertenties",
        promotedListingsLabel: 'Bedrijfsadvertenties',
        promotedListingsTooltip: "Verbergt advertenties van bedrijven en winkels, zoals Catawiki, ook op de homepage bij 'Voor jou' en 'In je buurt'",
        stickersLabel: 'Opvalstickers',
        stickersTooltip: 'Verwijdert advertenties met opvalstickers',
        reservedLabel: 'Gereserveerde',
        reservedTooltip: "Verbergt advertenties die 'Gereserveerd' zijn",
        favoriteRelatedAdsLabel: 'Gerelateerde advertenties bij favorieten',
        favoriteRelatedAdsTooltip: 'Verbergt het blok met gerelateerde advertenties op de favorietenpagina',
        sellerAgeWarningLabel: 'Waarschuwing voor nieuwe verkoperaccounts',
        sellerAgeWarningTooltip: 'Toont op een advertentiepagina een waarschuwing als het verkopersaccount jonger is dan jouw ingestelde grens.',
        sellerAgeWarningThresholdLabel: 'Waarschuwen onder',
        sellerAgeWarningThresholdValueAriaLabel: 'Drempelwaarde voor waarschuwing nieuwe verkoperaccounts',
        sellerAgeWarningThresholdUnitAriaLabel: 'Drempeleenheid voor waarschuwing nieuwe verkoperaccounts',
        sellerAgeWarningThresholdUnits: {
            days: 'dagen',
            weeks: 'weken',
            months: 'maanden',
            years: 'jaar'
        },
        sellerAgeWarningToastTitle: 'Nieuw verkoperaccount',
        sellerAgeWarningToastMessage: (sellerName, sellerAgeText, thresholdLabel) => `${sellerName} zit pas ${sellerAgeText}. Jouw grens staat op ${thresholdLabel}. Verberg verkoper via de knop onder de naam.`,
        preferencesLabel: 'Voorkeuren',
        backLabel: '← Terug',
        preferencesIntro: '',
        darkModeLabel: 'Donkere modus',
        darkModeTooltip: 'Schakelt een donker thema in voor Marktplaats en het Cleanplaats-paneel. Experimenteel: werkt meestal goed, maar zet het uit als iets slecht leesbaar is.',
        resultsPerPageLabel: 'Resultaten per pagina:',
        defaultSortLabel: 'Standaard sortering:',
        sortOptions: {
            standard: 'Standaard',
            date_new_old: 'Nieuw eerst',
            date_old_new: 'Oud eerst',
            price_low_high: 'Prijs ↑',
            price_high_low: 'Prijs ↓',
            distance: 'Afstand'
        },
        statsTitle: 'Verwijderde items',
        statsTop: 'Top:',
        statsDagtoppers: 'Dagtoppers:',
        statsBusiness: 'Bedrijf:',
        statsStickers: 'Stickers:',
        statsOther: 'Overig:',
        statsTotal: 'Totaal:',
        manageTerms: 'Beheer blacklist-termen in titels',
        manageSellers: 'Beheer verborgen verkopers',
        termsModalTitle: 'Blacklist termen',
        termsEmpty: 'Geen termen toegevoegd',
        hiddenButton: 'Verborgen',
        unhideButton: 'Opheffen',
        termInputPlaceholder: 'Voer een term in',
        termInputHelp: 'Advertenties worden verborgen als deze term in de titel voorkomt.',
        addButton: 'Toevoegen',
        closeButton: 'Sluiten',
        sellersModalTitle: 'Verborgen verkopers',
        sellersEmpty: 'Geen verkopers toegevoegd',
        sellerInputPlaceholder: 'bijv. Catawiki',
        sellerInputHelp: "Wil je meerdere namen tegelijk toevoegen? Scheid ze dan met komma's of puntkomma's.",
        hideSellerButton: 'Verkoper verbergen',
        hiddenSellerButton: 'Verkoper verborgen',
        hideSellerButtonAriaLabel: 'Verberg deze verkoper',
        blacklistToastHint: 'Beheer verborgen verkopers via het paneel',
        blacklistToastHiddenSuffix: 'verborgen',
        blacklistToastHiddenPluralSuffix: 'verkopers verborgen',
        blacklistToastShownSuffix: 'niet meer verborgen',
        blacklistToastShownHint: 'Deze verkoper is weer zichtbaar in de resultaten',
        termToastHidden: term => `Alle advertenties met de term '${term}' zijn nu verborgen.`,
        termToastShown: term => `Advertenties met de term '${term}' worden weer getoond.`
    };
}

var CLEANPLAATS = {
    settings: {
        removeTopAds: true,
        removeDagtoppers: true,
        removePromotedListings: true,
        removeOpvalStickers: true,
        removeReservedListings: false,
        removeFavoriteRelatedAds: false,
        sellerAgeWarningEnabled: false,
        sellerAgeWarningThresholdValue: 3,
        sellerAgeWarningThresholdUnit: 'days',
        darkMode: false,
        blacklistedSellers: [],
        blacklistedTerms: [],
        resultsPerPage: 30,
        defaultSortMode: 'standard',
        sortPreferenceSource: 'cleanplaats'
    },

    stats: {
        topAdsRemoved: 0,
        dagtoppersRemoved: 0,
        promotedListingsRemoved: 0,
        opvalStickersRemoved: 0,
        otherAdsRemoved: 0,
        totalRemoved: 0
    },

    observers: {
        mutation: null,
        ads: null,
        webchat: null,
        sellerAge: null
    },

    runtime: {
        lastSellerAgeWarningKey: '',
        sellerAgeCheckTimer: 0
    },

    featureFlags: {
        showStats: true,
        autoCollapse: false,
        firstRun: true
    },

    panelState: {
        isCollapsed: false,
        hasShownWelcomeToast: false,
        lastSeenVersion: '',
        activeView: 'filters'
    }
};

var CLEANPLAATS_UPDATE_NOTES = {
    '2.0.7': {
        intro: 'Cleanplaats 2.0.7 voegt een extra veiligheidswaarschuwing toe op advertentiepagina’s en maakt het verbergen van verkopers duidelijker en handiger.',
        highlights: [
            'Je kunt nu een waarschuwing krijgen bij nieuwe verkoperaccounts. Deze instelling vind je onder het tabje "Voorkeuren" in het paneel, waar je zelf kiest vanaf hoeveel dagen, weken, maanden of jaren je zo’n melding wilt zien.',
            'Op advertentiepagina’s staat nu ook een knop onder de verkopernaam om in één keer alle advertenties van die verkoper te verbergen.',
            'De knop om een verkoper te verbergen is nu ook netjes vertaald op 2ememain.'
        ],
        note: 'Zie je een verkoper die je niet vertrouwt? Dan kun je die nu direct vanaf de advertentiepagina verbergen.'
    },
    '2.0.6': {
        intro: 'Cleanplaats 2.0.6 herstelt een paar dingen op Favorieten en lost een vervelende fout op die sommige filters uit beeld haalde.',
        highlights: [
            'De filters voor categorie en afstand zijn weer terug waar ze horen.',
            'Gerelateerde advertenties in Favorieten worden niet meer standaard verborgen. Via de nieuwe knop "Voorkeuren" kun je dit nu zelf aan of uit zetten.',
            'Niet-beschikbare advertenties in Favorieten zien er in dark mode nu weer duidelijk anders uit dan actieve advertenties.'
        ],
        note: 'Excuses voor de bug waardoor categorie en afstand ineens konden verdwijnen. Bedankt aan iedereen die dit zo snel heeft gemeld via Reddit en GitHub issues. Jullie hulp en betrokkenheid maken Cleanplaats tot het succes dat het is.'
    },
    '2.0.5': {
        intro: 'Cleanplaats 2.0.5 werkt Marktplaats verder bij met vooral meer dark mode-ondersteuning en een rustigere interface op meerdere pagina’s.',
        highlights: [
            'Dark mode is verder uitgebreid op onder meer "Mijn advertenties", account- en plaats advertentie-pagina’s, tabelweergaven en onderdelen rond eigen advertenties.',
            'Ook losse interface-elementen zoals "Deal gesloten?", voorstel- en leveringsmenu’s nemen nu beter het donkere thema over.',
            'Storende banners en promotieblokken zijn op meerdere plekken verborgen, waaronder "gerelateerde advertenties" in Favorieten.',
            'Een visuele flicker bij het laden in dark mode is aangepakt, waardoor pagina’s rustiger en consistenter openen.',
            "Marktplaats banner voor 'koop je auto bij autobedrijven' weggehaald"
        ],
        note: "Zie je nog een onderdeel of licht onderdeel dat door de dark mode heen glipt in veel gebruikte pagina's? Meld het via GitHub issues in het paneel."
    }
};

var MARKTPLAATS_SORT_LABEL_TO_MODE = {
    'standaard': 'standard',
    'datum (nieuw-oud)': 'date_new_old',
    'datum (oud-nieuw)': 'date_old_new',
    'prijs (laag-hoog)': 'price_low_high',
    'prijs (hoog-laag)': 'price_high_low',
    'afstand': 'distance'
};

function normalizeSortLabel(label) {
    return (label || '').trim().toLowerCase();
}

function getSortModeFromLabel(label) {
    return MARKTPLAATS_SORT_LABEL_TO_MODE[normalizeSortLabel(label)] || null;
}

function isMarketplaceSortDropdown(element) {
    if (!(element instanceof HTMLSelectElement)) return false;

    const ariaLabel = normalizeSortLabel(element.getAttribute('aria-label'));
    if (ariaLabel === 'sorteer op') return true;

    return Array.from(element.options || []).some(option => {
        return normalizeSortLabel(option.textContent) === 'datum (nieuw-oud)';
    });
}
