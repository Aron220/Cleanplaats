/**
 * Cleanplaats shared content-script state and locale helpers.
 */

var browserAPI = typeof browser !== 'undefined' ? browser : chrome;
var CLEANPLAATS_DARK_MODE_CLASS = 'cleanplaats-dark-mode';
var CLEANPLAATS_TWH_SITE_CLASS = 'cleanplaats-site-twh';
var CLEANPLAATS_THEME_STORAGE_KEY = 'cleanplaats:darkMode';
var CLEANPLAATS_SORT_STORAGE_KEY = 'cleanplaats:sortMode';
var CLEANPLAATS_SORT_SOURCE_STORAGE_KEY = 'cleanplaats:sortSource';
var CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY = 'cleanplaatsViewedListings';
var CLEANPLAATS_MAX_VIEWED_LISTINGS = 1500;
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

function getListingIdFromUrl(url) {
    const rawUrl = typeof url === 'string' ? url : String(url || '');

    try {
        const parsedUrl = new URL(rawUrl, window.location.origin);
        const pathMatch = parsedUrl.pathname.match(/\/([am]\d+)(?:[-/?]|$)/i);
        if (pathMatch) {
            return pathMatch[1].toLowerCase();
        }

        const itemId = parsedUrl.searchParams.get('itemId');
        if (itemId && /^[am]\d+$/i.test(itemId)) {
            return itemId.toLowerCase();
        }
    } catch (error) {
        const rawMatch = rawUrl.match(/([am]\d+)(?:[-/?]|$)/i);
        if (rawMatch) {
            return rawMatch[1].toLowerCase();
        }
    }

    return '';
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
            viewedListingsLabel: 'Marquer les annonces déjà ouvertes',
            viewedListingsTooltip: 'Ajoute un repère visuel dans les résultats de recherche pour les annonces que vous avez déjà ouvertes.',
            viewedListingBadge: 'Vu',
            viewedListingBadgeUndo: 'Annuler',
            viewedListingBadgeUndoTooltip: 'Marquer comme non vue',
            viewedListingsClearButton: 'Effacer',
            viewedListingsClearButtonAriaLabel: 'Effacer toutes les annonces vues enregistrées',
            viewedListingsClearedToast: 'Les repères des annonces vues ont été effacés.',
            viewedListingRemovedToast: 'Cette annonce n’est plus marquée comme vue.',
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
            expandPanelOnPageLoadLabel: 'Déplier le panneau à l’ouverture de la page',
            expandPanelOnPageLoadTooltip: 'Si cette option est désactivée, le panneau reste replié en bas à droite à chaque chargement de page (sauf la toute première visite).',
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
            manageTerms: 'Gérer les termes masqués',
            manageSellers: 'Gérer les vendeurs masqués',
            manageBlockedListings: 'Gérer les annonces masquées',
            termsModalTitle: 'Termes masqués',
            termsTitleSectionLabel: 'Dans le titre',
            termsDescriptionSectionLabel: 'Dans la description',
            termsEmpty: 'Aucun terme ajouté',
            hiddenButton: 'Masqué',
            unhideButton: 'Afficher',
            termInputPlaceholder: 'Saisissez un terme',
            termInputHelp: 'Les annonces sont masquées si ce terme apparaît dans le titre.',
            descriptionTermsEmpty: 'Aucun terme ajouté',
            descriptionTermInputPlaceholder: 'Saisissez un terme',
            descriptionTermInputHelp: 'Les annonces sont masquées si ce terme apparaît dans la description.',
            addButton: 'Ajouter',
            closeButton: 'Fermer',
            sellersModalTitle: 'Vendeurs masqués',
            sellersEmpty: 'Aucun vendeur ajouté',
            sellerInputPlaceholder: 'ex. Catawiki',
            sellerInputHelp: 'Vous voulez ajouter plusieurs noms à la fois ? Séparez-les avec des virgules ou des points-virgules.',
            hideSellerButton: 'Masquer le vendeur',
            hiddenSellerButton: 'Vendeur masqué',
            hideSellerButtonAriaLabel: 'Masquer ce vendeur',
            blockedListingsModalTitle: 'Annonces masquées',
            blockedListingsEmpty: 'Aucune annonce masquée',
            hideListingButton: "Masquer l'annonce",
            hiddenListingButton: 'Annonce masquée',
            hideListingButtonAriaLabel: 'Masquer cette annonce',
            listingToastHidden: (title) => `"${title}" est maintenant masquée.`,
            listingToastShown: (title) => `"${title}" est à nouveau visible.`,
            blacklistToastHint: 'Gérez les vendeurs masqués via le panneau',
            blacklistToastHiddenSuffix: 'masqué',
            blacklistToastHiddenPluralSuffix: 'vendeurs masqués',
            blacklistToastShownSuffix: "n'est plus masqué",
            blacklistToastShownHint: 'Ce vendeur est à nouveau visible dans les résultats',
            termToastHidden: term => `Toutes les annonces contenant le terme '${term}' sont désormais masquées.`,
            termToastShown: term => `Les annonces contenant le terme '${term}' sont à nouveau affichées.`,
            descriptionTermToastHidden: term => `Les annonces avec '${term}' dans la description sont désormais masquées.`,
            descriptionTermToastShown: term => `Les annonces avec '${term}' dans la description sont à nouveau affichées.`,
            emptyPageText: 'Toutes les annonces de cette page sont masquées par Cleanplaats.',
            emptyPageFindNext: 'Trouver la prochaine page avec des annonces visibles',
            emptyPageSearching: 'Recherche en cours…',
            emptyPageNotFound: 'Aucune page avec des annonces visibles trouvée.',
            donationNudgeText: count => `Vous avez déjà filtré ${count} fois avec Cleanplaats 🎉 Si cela vous fait gagner du temps, pensez à faire un petit don.`,
            donationNudgeDismiss: 'Peut-être plus tard'
        };
    }

    return {
        feedbackLabel: 'Feedback',
        feedbackText: 'GitHub issues',
        feedbackAriaLabel: 'Open GitHub issues voor functieverzoeken, wijzigingen en bugs',
        reviewAriaLabel: linkLabel => `Laat een review achter voor Cleanplaats op ${linkLabel}`,
        supportTitle: 'Steun Cleanplaats met een kleine bijdrage',
        supportButton: 'Steun Cleanplaats',
        donationNudgeText: count => `Je hebt al ${count} keer gefilterd met Cleanplaats 🎉 Als het je tijd bespaart, overweeg dan een kleine bijdrage.`,
        donationNudgeDismiss: 'Misschien later',
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
        viewedListingsLabel: 'Markeer eerder geopende advertenties',
        viewedListingsTooltip: 'Laat in zoekresultaten zien welke advertenties je eerder al hebt geopend.',
        viewedListingBadge: 'Bekeken',
        viewedListingBadgeUndo: 'Niet bekeken',
        viewedListingBadgeUndoTooltip: 'Markeer als niet bekeken',
        viewedListingsClearButton: 'Wis',
        viewedListingsClearButtonAriaLabel: 'Wis alle opgeslagen bekeken advertenties',
        viewedListingsClearedToast: 'Alle bekeken-markeringen zijn gewist.',
        viewedListingRemovedToast: 'Deze advertentie is niet meer gemarkeerd als bekeken.',
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
        expandPanelOnPageLoadLabel: 'Paneel uitklappen bij openen pagina',
        expandPanelOnPageLoadTooltip: 'Uit: het paneel start bij elke pagina ingeklapt (behalve de allereerste keer). Aan: onthoudt of het paneel uit- of ingeklapt was.',
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
        manageTerms: 'Beheer blacklist-termen',
        manageSellers: 'Beheer verborgen verkopers',
        manageBlockedListings: 'Beheer verborgen advertenties',
        termsModalTitle: 'Blacklist termen',
        termsTitleSectionLabel: 'In titels',
        termsDescriptionSectionLabel: 'In beschrijvingen',
        termsEmpty: 'Geen termen toegevoegd',
        hiddenButton: 'Verborgen',
        unhideButton: 'Opheffen',
        termInputPlaceholder: 'Voer een term in',
        termInputHelp: 'Advertenties worden verborgen als deze term in de titel voorkomt.',
        descriptionTermsEmpty: 'Geen termen toegevoegd',
        descriptionTermInputPlaceholder: 'Voer een term in',
        descriptionTermInputHelp: 'Advertenties worden verborgen als deze term in de beschrijving voorkomt.',
        addButton: 'Toevoegen',
        closeButton: 'Sluiten',
        sellersModalTitle: 'Verborgen verkopers',
        sellersEmpty: 'Geen verkopers toegevoegd',
        sellerInputPlaceholder: 'bijv. Catawiki',
        sellerInputHelp: "Wil je meerdere namen tegelijk toevoegen? Scheid ze dan met komma's of puntkomma's.",
        hideSellerButton: 'Verkoper verbergen',
        hiddenSellerButton: 'Verkoper verborgen',
        hideSellerButtonAriaLabel: 'Verberg deze verkoper',
        blockedListingsModalTitle: 'Verborgen advertenties',
        blockedListingsEmpty: 'Geen advertenties verborgen',
        hideListingButton: 'Verberg advertentie',
        hiddenListingButton: 'Advertentie verborgen',
        hideListingButtonAriaLabel: 'Verberg deze advertentie',
        listingToastHidden: (title) => `"${title}" is nu verborgen.`,
        listingToastShown: (title) => `"${title}" is weer zichtbaar.`,
        blacklistToastHint: 'Beheer verborgen verkopers via het paneel',
        blacklistToastHiddenSuffix: 'verborgen',
        blacklistToastHiddenPluralSuffix: 'verkopers verborgen',
        blacklistToastShownSuffix: 'niet meer verborgen',
        blacklistToastShownHint: 'Deze verkoper is weer zichtbaar in de resultaten',
        termToastHidden: term => `Alle advertenties met de term '${term}' zijn nu verborgen.`,
        termToastShown: term => `Advertenties met de term '${term}' worden weer getoond.`,
        descriptionTermToastHidden: term => `Advertenties met '${term}' in de beschrijving zijn nu verborgen.`,
        descriptionTermToastShown: term => `Advertenties met '${term}' in de beschrijving worden weer getoond.`,
        emptyPageText: 'Alle advertenties op deze pagina zijn verborgen door Cleanplaats.',
        emptyPageFindNext: 'Zoek volgende pagina met zichtbare advertenties',
        emptyPageSearching: 'Zoeken…',
        emptyPageNotFound: 'Geen pagina met zichtbare advertenties gevonden.'
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
        showViewedListingsIndicator: false,
        sellerAgeWarningEnabled: false,
        sellerAgeWarningThresholdValue: 3,
        sellerAgeWarningThresholdUnit: 'days',
        darkMode: false,
        blacklistedSellers: [],
        blacklistedTerms: [],
        blacklistedDescriptionTerms: [],
        blockedListings: [],
        resultsPerPage: 30,
        defaultSortMode: 'standard',
        sortPreferenceSource: 'cleanplaats',
        expandPanelOnPageLoad: false,
        totalActionsCount: 0,
        donationNudgeDismissedAt: 0,
        donationNudgeClickedBmc: false
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
        sellerAgeCheckTimer: 0,
        cleanupTimer: 0,
        viewedListings: {}
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
    '2.1.3': {
        intro: 'Cleanplaats 2.1.3 lost een belangrijk Firefox-probleem op.',
        highlights: [
            'Firefox-fix: het ingestelde aantal resultaten per pagina werd in Firefox genegeerd (er werden altijd 30 resultaten getoond). Dit werkt nu net als in Chrome.'
        ],
        note: null
    },
    '2.1.2': {
        intro: 'Cleanplaats 2.1.2 laat je individuele advertenties verbergen — handig als je een bepaalde aanbieding niet meer wil zien zonder de hele verkoper te blokkeren.',
        highlights: [
            'Nieuwe knop "Verberg advertentie" op elke zoekresultaat — verberg een specifieke advertentie met één klik, zonder de verkoper te blokkeren.',
            'Verborgen advertenties beheer je via "Beheer verborgen advertenties" in het paneel: zie alle verborgen advertenties en zet ze eenvoudig terug.',
            'Firefox-fix: de ingestelde standaard sortering werd bij Firefox niet altijd correct toegepast — dit werkt nu betrouwbaar.',
            'Donkere modus: de banner "Zoek volgende pagina" was slecht leesbaar in dark mode — dit is nu opgelost.'
        ],
        note: null
    },
    '2.1.1': {
        intro: 'Cleanplaats 2.1.0 voegt een handige knop toe om snel de volgende pagina met zichtbare advertenties te vinden.',
        highlights: [
            'Staat een hele pagina vol met gefilterde advertenties? Er verschijnt nu automatisch een banner met de knop "Zoek volgende pagina met zichtbare advertenties" — Cleanplaats scant de volgende pagina\'s en springt direct naar de eerste pagina met iets te zien.'
        ],
        note: null
    },
    '2.0.9': {
        intro: 'Cleanplaats 2.0.9 breidt de blacklist uit met beschrijvingen, voegt een bekeken-indicator toe en verbetert de donkere modus.',
        highlights: [
            'Blacklist-termen werken nu ook op advertentiebeschrijvingen — voeg termen toe via "Beheer blacklist-termen" onder het kopje "In beschrijvingen".',
            'Bekeken advertenties krijgen een subtiele indicator zodat je ze makkelijker herkent. Dit kun je in- of uitschakelen via Voorkeuren.',
            'De donkere modus dekt nu ook de "Direct kopen"-pagina correct af.'
        ],
        note: 'Wil je advertenties met bepaalde woorden in de beschrijving verbergen? Voeg ze toe via "Beheer blacklist-termen".'
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
