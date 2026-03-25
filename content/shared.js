/**
 * Cleanplaats shared content-script state and locale helpers.
 */

var browserAPI = typeof browser !== 'undefined' ? browser : chrome;
var CLEANPLAATS_DARK_MODE_CLASS = 'cleanplaats-dark-mode';
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
        webchat: null
    },

    featureFlags: {
        showStats: true,
        autoCollapse: false,
        firstRun: true
    },

    panelState: {
        isCollapsed: false,
        hasShownWelcomeToast: false,
        lastSeenVersion: ''
    }
};

var CLEANPLAATS_UPDATE_NOTES = {
    '2.0.4': {
        intro: 'Cleanplaats 2.0.4 brengt een grote opschoning onder de motorkap, samen met de additie van dark mode en ondersteuning voor 2ememain.',
        highlights: [
            'Nieuwe feature: Dark mode is toegevoegd! Met een nieuwe thema-schakelaar bovenin het paneel. Probeer het eens!',
            'De extensie is intern opgesplitst in overzichtelijkere modules, wat zorgt voor een stabielere basis voor toekomstige updates.',
            'De ondersteuning voor 2dehands is verbeterd en ondersteuning voor 2ememains is toegevoegd. Inclusief verwerking van Franse benamingen.',
            'Blacklist-termen werken nu betrouwbaarder op de vernieuwde resultaatpagina’s.',
            'Storende elementen zoals marketingbanners en bepaalde gesponsorde meldingen zijn verder opgeruimd voor een rustigere ervaring.'
        ],
        note: 'Zie je nog iets dat niet goed wordt meegenomen op Marktplaats, 2dehands of 2ememain? Meld het via GitHub issues in het paneel.'
    },
    '2.0.3': {
        intro: 'Cleanplaats lost problemen op met sorteren en filtert bedrijfsadvertenties nu ook  op de homepage.',
        highlights: [
            'Wisselen tussen bijvoorbeeld "Datum (nieuw-oud)" en "Prijs (laag-hoog)" werkt nu betrouwbaarder.',
            'De extensie zet je gekozen sortering niet meer onbedoeld terug bij verversen of pagineren.',
            'Daardoor hoef je een andere sorteermodus niet meer twee keer aan te klikken.',
            'De filter "Bedrijfsadvertenties" verbergt nu ook alle bedrijfs- en winkeladvertenties op de homepage bij "Voor jou" en "In je buurt", zoals bijv. Catawiki.',
            'De knop om een verkoper te verbergen blijft nu ook op mobiel zichtbaar op listingpagina’s.',
            'Bij "Beheer verborgen verkopers" kun je nu ook zelf verkopers toevoegen, inclusief meerdere namen tegelijk met komma’s of puntkomma’s.'
        ],
        note: 'Zie je nog iets vreemds met sorteren of homepage-filters? Meld het via GitHub issues in het paneel.'
    },
    '2.0.0': {
        intro: 'Deze update legt een sterkere basis voor de vernieuwde Marktplaats- en 2dehands-pagina’s.',
        highlights: [
            'De ondersteuning voor 2dehands en bijgewerkte Marktplaats-selectors is uitgebreid.',
            'Blacklist-knoppen en seller-detectie werken betrouwbaarder op meer listing-varianten.',
            'Diverse layout- en filterfixes zorgen voor stabielere opschoning van resultaten.'
        ],
        note: 'Zie je nog iets doorheen glippen? Meld het via GitHub issues in het paneel.'
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
