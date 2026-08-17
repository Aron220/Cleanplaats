/**
 * Cleanplaats shared content-script state and locale helpers.
 */

var browserAPI = typeof browser !== 'undefined' ? browser : chrome;
var CLEANPLAATS_DARK_MODE_CLASS = 'cleanplaats-dark-mode';
var CLEANPLAATS_TWH_SITE_CLASS = 'cleanplaats-site-twh';
var CLEANPLAATS_THEME_STORAGE_KEY = 'cleanplaats:darkMode';
var CLEANPLAATS_SORT_STORAGE_KEY = 'cleanplaats:sortMode';
var CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY = 'cleanplaatsViewedListings';
var CLEANPLAATS_MAX_VIEWED_LISTINGS = 1500;
var CLEANPLAATS_FLOATING_OFFSET_VAR = '--cleanplaats-floating-offset';
// Marktplaats renamed this asset from tenant--nlnl to brand-logo--nlnl; match both.
var MARKTPLAATS_DESKTOP_LOGO_MATCH = /\/(?:tenant|brand-logo)--nlnl(?:\.[a-z0-9]+)?\.svg$/i;
var CLEANPLAATS_DARK_LOGO_PATH = 'icons/marktplaats-logo-darkmode.svg';
// Search results render as .hz-Listing, but the homepage feed ("Voor jou" / "In je
// buurt") renders as .hz-StructuredListing cards and never contains a single
// .hz-Listing. Anything that waits for "the listings are there" has to accept both,
// otherwise it waits forever on the homepage.
var CLEANPLAATS_LISTING_SELECTOR = '.hz-Listing, .hz-StructuredListing';
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

function hashStringToId(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
        hash >>>= 0;
    }
    return hash.toString(36);
}

// Marktplaats flags some ads as "thin content" and renders their cards without an href
// on the cover link (role="link" plus a JS click handler instead), so those cards carry
// no item id anywhere in the DOM. Fall back to a fingerprint of the card's own content
// so they can still be blocked individually.
function getListingCardFingerprint(listing) {
    if (!(listing instanceof Element)) return '';

    const imageSrc = listing.querySelector('img[src*="marktplaats.com"]')?.getAttribute('src') || '';
    const imageId = imageSrc.match(/\/images\/([0-9a-f-]{8,})/i)?.[1] || '';

    const title = typeof getListingTitleText === 'function' ? getListingTitleText(listing) : '';

    // The car-advert layout gets our own "hide seller" button appended inside the seller
    // element, so read the seller name without any Cleanplaats markup: the fingerprint has
    // to be identical before and after we inject buttons.
    const sellerElement = listing.querySelector(
        '.hz-Listing-seller-name, .hz-Listing-seller-name-new, .hz-Listing-sellerName, .hz-Listing-sellerName-new'
    );
    let seller = '';
    if (sellerElement) {
        const sellerClone = sellerElement.cloneNode(true);
        sellerClone.querySelectorAll('[class*="cleanplaats-"]').forEach(node => node.remove());
        seller = sellerClone.textContent.trim();
    }

    const price = listing.querySelector('[class*="hz-Listing-price"]')?.textContent?.trim() || '';

    if (!imageId && !title) return '';

    return `cp${hashStringToId([imageId, title, seller, price].join('|'))}`;
}

// Preferred id for a search-result card: the real Marktplaats item id when the card
// links to the listing, otherwise a stable content fingerprint.
function getListingCardId(listing) {
    if (!(listing instanceof Element)) return '';

    const listingId = getListingIdFromUrl(listing.querySelector('a[href*="/v/"]')?.href);
    if (listingId) return listingId;

    return getListingCardFingerprint(listing);
}

/* ===== Seller identity =====
 *
 * Seller *names* are not unique on Marktplaats: two accounts can both be called
 * "Demi". Blocking by name therefore hid every seller sharing the name with the
 * one the user actually blocked. Blocks made through our own buttons now record
 * the numeric sellerId instead.
 *
 * The rendered listing card carries no seller id anywhere — no profile link, no
 * data attribute — so the id has to come from the page's own search payload,
 * keyed by item id. __NEXT_DATA__ covers every listing the page server-rendered;
 * the search API responses cleanup.js already fetches fill in the rest.
 */

// Entries are stored as { id, name }. `id` is empty for entries the user typed
// by hand (there is no id to type) and for blocks made before ids existed —
// those keep matching on name, because there is no way to tell afterwards which
// of two identically named sellers was meant.
function normalizeBlacklistedSellerEntry(entry) {
    if (typeof entry === 'string') {
        const name = entry.trim();
        return name ? { id: '', name } : null;
    }

    if (entry && typeof entry === 'object') {
        const id = entry.id === null || entry.id === undefined ? '' : String(entry.id).trim();
        const name = String(entry.name || '').trim();
        if (!id && !name) return null;
        return { id, name };
    }

    return null;
}

function getBlacklistedSellerEntries() {
    return (CLEANPLAATS.settings.blacklistedSellers || [])
        .map(normalizeBlacklistedSellerEntry)
        .filter(Boolean);
}

// Stable key for an entry, used as the value of the unblock buttons' dataset so
// a name-only and an id-based entry for the same seller stay distinguishable.
function getBlacklistedSellerKey(entry) {
    const normalized = normalizeBlacklistedSellerEntry(entry);
    if (!normalized) return '';
    return normalized.id ? `id:${normalized.id}` : `name:${normalized.name}`;
}

// Seller names are free text and really do contain markup characters
// ("Shiro Neko (>w<)"), so both the label and the key attribute built from them
// have to be escaped or the unblock button loses the entry it points at.
function escapeHtmlText(text) {
    return String(text === null || text === undefined ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getBlacklistedSellerLabel(entry) {
    const normalized = normalizeBlacklistedSellerEntry(entry);
    if (!normalized) return '';
    return normalized.name || `#${normalized.id}`;
}

// An id-based entry deliberately does not fall back to matching on name: doing
// so would hide the very lookalike sellers this exists to stop hiding. When the
// id cannot be resolved the listing stays visible and the next page load, which
// does resolve it, hides it again.
function isSellerBlacklisted(sellerId, sellerName) {
    const id = sellerId === null || sellerId === undefined ? '' : String(sellerId).trim();
    const name = (sellerName || '').trim();

    return getBlacklistedSellerEntries().some(entry => {
        if (entry.id) return Boolean(id) && entry.id === id;
        return Boolean(name) && entry.name === name;
    });
}

function rememberSellerId(itemId, sellerId) {
    const key = String(itemId || '').toLowerCase();
    if (!key || sellerId === null || sellerId === undefined || sellerId === '') return;
    CLEANPLAATS.runtime.sellerIdsByListingId[key] = String(sellerId);
}

function indexSellerIdsFromApiListings(apiListings) {
    (apiListings || []).forEach(listing => {
        rememberSellerId(listing?.itemId, listing?.sellerInformation?.sellerId);
    });
}

// Marktplaats replaces __NEXT_DATA__ on client-side navigation, so this is read
// on every cleanup pass and merged into the map rather than replacing it: ids
// learned from an earlier search stay valid for cards still on the page.
function indexSellerIdsFromNextData() {
    try {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (!nextDataEl) return;

        const response = JSON.parse(nextDataEl.textContent)?.props?.pageProps?.searchRequestAndResponse;
        if (!response) return;

        indexSellerIdsFromApiListings([...(response.listings || []), ...(response.topBlock || [])]);
    } catch (error) {
        // A parse failure only costs us id resolution on this pass.
    }
}

function getListingSellerId(listing) {
    if (!(listing instanceof Element)) return '';

    const itemId = getListingIdFromUrl(listing.querySelector('a[href*="/v/"]')?.href);
    if (!itemId) return '';

    return CLEANPLAATS.runtime.sellerIdsByListingId[itemId] || '';
}

// The listing page and the detail page are different rendering stacks: the
// detail page has no __NEXT_DATA__ and no seller link either, but it does assign
// window.__CONFIG__ in an inline script. Content scripts run in an isolated
// world and cannot read page globals, so parse the script's own text.
function getDetailPageSellerId() {
    if (!isProductDetailPage()) return '';

    const cached = CLEANPLAATS.runtime.detailPageSellerId;
    if (cached && cached.path === window.location.pathname) return cached.sellerId;

    let sellerId = '';
    try {
        const script = [...document.querySelectorAll('script:not([src])')]
            .find(node => node.textContent.includes('__CONFIG__'));

        if (script) {
            const match = script.textContent.match(/__CONFIG__\s*=\s*(\{)/);
            if (match) {
                const json = extractJsonObject(script.textContent, match.index + match[0].length - 1);
                sellerId = json ? String(JSON.parse(json)?.listing?.seller?.id || '') : '';
            }
        }
    } catch (error) {
        sellerId = '';
    }

    CLEANPLAATS.runtime.detailPageSellerId = { path: window.location.pathname, sellerId };
    return sellerId;
}

// __CONFIG__ is followed by more script, so the object has to be cut out by
// brace balance rather than by a greedy match to the last '}' in the file.
function extractJsonObject(text, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }

        if (char === '"') inString = true;
        else if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) return text.slice(startIndex, i + 1);
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
            contactLabel: 'Contact',
            contactText: 'info@cleanplaats.com',
            contactAriaLabel: 'Envoyer un e-mail à info@cleanplaats.com',
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
            showUpdatePopupsLabel: 'Afficher les notifications de mise à jour',
            showUpdatePopupsTooltip: "Affiche une fenêtre 'Quoi de neuf ?' après une mise à jour de Cleanplaats.",
            updatePopupDontShowAgainLabel: 'Ne plus afficher ceci lors des prochaines mises à jour',
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
            statsReserved: 'Réservées :',
            statsUserBlocked: 'Masquées par vous :',
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
            emptyPageSearchUnavailable: 'Recherche impossible pour cette recherche.',
            donationNudgeText: count => `Vous avez déjà filtré ${count} fois avec Cleanplaats 🎉 Si cela vous fait gagner du temps, pensez à faire un petit don.`,
            donationNudgeDismiss: 'Peut-être plus tard'
        };
    }

    return {
        feedbackLabel: 'Feedback',
        feedbackText: 'GitHub issues',
        feedbackAriaLabel: 'Open GitHub issues voor functieverzoeken, wijzigingen en bugs',
        contactLabel: 'Vragen of feedback? Mail ons',
        contactText: 'info@cleanplaats.com',
        contactAriaLabel: 'Stuur een e-mail naar info@cleanplaats.com',
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
        showUpdatePopupsLabel: 'Toon updatemeldingen',
        showUpdatePopupsTooltip: "Toon na een update van Cleanplaats een 'Wat is er nieuw?'-pop-up.",
        updatePopupDontShowAgainLabel: 'Laat dit niet meer zien bij volgende updates',
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
        statsReserved: 'Gereserveerd:',
        statsUserBlocked: 'Door jou verborgen:',
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
        emptyPageNotFound: 'Geen pagina met zichtbare advertenties gevonden.',
        emptyPageSearchUnavailable: 'Zoeken lukt niet voor deze zoekopdracht.',
        // Other alert strings live in content/alerts.js (ALERTS_TEXT): the
        // feature is Marktplaats-only, so it isn't translated per locale.
        alertsManageButton: 'Zoekmeldingen',
        alertsPromoNewBadge: 'NIEUW',
        alertsPromoIntroText: 'Laat Cleanplaats voor je zoeken. Je krijgt een bericht zodra er een nieuwe advertentie verschijnt, ook als je browser dicht is.',
        alertsPromoIntroStart: 'Laat me zien hoe',
        alertsPromoIntroLater: 'Later',
        alertsPromoTagline: 'Als eerste bij een nieuwe advertentie',
        // One word throughout the feature: a "zoekmelding" is what you switch
        // on, a "zoekopdracht" is the Marktplaats search it watches.
        alertsPromoNoAlerts: 'Nog geen zoekmelding ingesteld',
        alertsPromoActiveCount: n => `${n} actieve zoekmelding${n === 1 ? '' : 'en'}`,
        // Bare number: at 280px the panel has no room for a worded pill without
        // truncating the title. The aria-label carries the meaning.
        alertsPromoNewMatches: n => String(n),
        alertsPromoAriaLabel: 'Zoekmeldingen openen',
        alertsPromoAriaLabelWithNew: n => `Zoekmeldingen openen, ${n} nieuwe advertentie${n === 1 ? '' : 's'} gevonden`
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
        expandPanelOnPageLoad: false,
        showUpdatePopups: true,
        totalActionsCount: 0,
        donationNudgeDismissedAt: 0,
        donationNudgeClickedBmc: false,
        // Zoekmeldingen entry point. The intro pitch shows until the user acts
        // on it (either button), after which the card falls back to its compact
        // form. `alertsSummary` is the last state the modal saw, so the compact
        // card can say something useful without an API call on every page load.
        alertsIntroDismissed: false,
        alertsWalkthroughDone: false,
        alertsSummary: null
    },

    stats: {
        topAdsRemoved: 0,
        dagtoppersRemoved: 0,
        promotedListingsRemoved: 0,
        opvalStickersRemoved: 0,
        reservedRemoved: 0,
        userBlockedRemoved: 0,
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
        lastCleanupAt: 0,
        viewedListings: {},
        // itemId -> sellerId, learned from the page's own search payloads. See
        // the seller identity section above.
        sellerIdsByListingId: {},
        detailPageSellerId: null
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
    '2.1.6': {
        intro: 'Cleanplaats 2.1.6 introduceert Zoekmeldingen: krijg een bericht in Telegram zodra er een nieuwe advertentie verschijnt voor je zoekopdracht, ook als je browser dicht is.',
        highlights: [
            'Nieuwe knop "Zoekmeldingen" onderin het paneel. Zoek iets op Marktplaats en klik erop: je zoekterm staat al ingevuld, en de categorie, locatie en afstand van je huidige zoekopdracht gaan automatisch mee.',
            'Meldingen komen binnen via Telegram, dus ook als je browser dicht is of je computer uit staat. Je koppelt Telegram eenmalig met een code van 6 cijfers die je van de bot krijgt, of door de QR-code te scannen met je telefoon.',
            'Je Cleanplaats-filters gelden ook voor je meldingen: dagtoppers, gereserveerde advertenties, opvalstickers en je geblokkeerde verkopers en woorden worden er automatisch uitgehouden. Top- en bedrijfsadvertenties krijg je nooit als melding.',
            'Gratis laat je één zoekmelding lopen, die elke 15 minuten wordt gecontroleerd. Gevonden advertenties zie je altijd terug in het overzicht, ook zonder Telegram.'
        ],
        note: 'Zoekmeldingen is splinternieuw. Werkt er iets niet zoals je verwacht? Mail dan naar info@cleanplaats.com, elk bericht komt bij de maker terecht.'
    },
    '2.1.5': {
        intro: 'Cleanplaats 2.1.5 lost een sorteerbug op en maakt de statistieken en de "zoek volgende pagina"-knop betrouwbaarder.',
        highlights: [
            'Fix: de standaard sortering kon terugspringen naar "Standaard" of vastlopen op een verkeerde volgorde. Sorteren via het paneel of via Marktplaats zelf werkt nu weer consistent.',
            'Fix: "Zoek volgende pagina met zichtbare advertenties" stuurde je bij sommige zoekopdrachten (met een zoekterm binnen een categorie, of een niet-standaard sortering) naar een verkeerde pagina. Dit werkt nu betrouwbaar, en je krijgt een duidelijke melding als zoeken niet mogelijk is.',
            'De statistieken tonen nu aparte tellingen voor "Gereserveerd" en "Door jou verborgen", in plaats van dat deze werden opgeteld bij "Overig". Het totaal klopt hierdoor weer.',
            'Met de filter "Bedrijfsadvertenties" aan werden advertenties met een "Bezoek website"-link al verborgen, maar advertenties van zakelijke verkopers zonder die link werden gemist. Deze worden nu ook verborgen.'
        ],
        note: null
    },
    '2.1.4': {
        intro: 'Cleanplaats 2.1.4 is een kleine onderhoudsupdate.',
        highlights: [
            'Fix: de Marktplaats-pagina kon vastlopen op mobiele schermformaten. Dit is opgelost.',
            'Fix: de knop "Verberg verkoper" werkte niet meer doordat Marktplaats de opmaak van advertenties had aangepast. Dit werkt nu weer.',
            'Fix: gereserveerde advertenties werden bij sommige zoekresultaten niet altijd verborgen, ook al stond de filter "Gereserveerde" aan. Dit is nu opgelost.',
            'Fix: een nieuw soort advertentie liet een leeg wit vakje achter in het rasteroverzicht. Dit wordt nu verborgen.'
        ],
        note: null
    },
    '2.1.3': {
        intro: 'Cleanplaats 2.1.3 lost een belangrijk Firefox-probleem op.',
        highlights: [
            'Firefox-fix: het ingestelde aantal resultaten per pagina werd in Firefox genegeerd (er werden altijd 30 resultaten getoond). Dit werkt nu net als in Chrome.'
        ],
        note: null
    },
    '2.1.2': {
        intro: 'Cleanplaats 2.1.2 laat je individuele advertenties verbergen. Handig als je een bepaalde aanbieding niet meer wil zien zonder de hele verkoper te blokkeren.',
        highlights: [
            'Nieuwe knop "Verberg advertentie" op elke zoekresultaat: verberg een specifieke advertentie met één klik, zonder de verkoper te blokkeren.',
            'Verborgen advertenties beheer je via "Beheer verborgen advertenties" in het paneel: zie alle verborgen advertenties en zet ze eenvoudig terug.',
            'Firefox-fix: de ingestelde standaard sortering werd bij Firefox niet altijd correct toegepast. Dit werkt nu betrouwbaar.',
            'Donkere modus: de banner "Zoek volgende pagina" was slecht leesbaar in dark mode. Dit is nu opgelost.'
        ],
        note: null
    },
    '2.1.1': {
        intro: 'Cleanplaats 2.1.0 voegt een handige knop toe om snel de volgende pagina met zichtbare advertenties te vinden.',
        highlights: [
            'Staat een hele pagina vol met gefilterde advertenties? Er verschijnt nu automatisch een banner met de knop "Zoek volgende pagina met zichtbare advertenties". Cleanplaats scant de volgende pagina\'s en springt direct naar de eerste pagina met iets te zien.'
        ],
        note: null
    },
    '2.0.9': {
        intro: 'Cleanplaats 2.0.9 breidt de blacklist uit met beschrijvingen, voegt een bekeken-indicator toe en verbetert de donkere modus.',
        highlights: [
            'Blacklist-termen werken nu ook op advertentiebeschrijvingen. Voeg termen toe via "Beheer blacklist-termen" onder het kopje "In beschrijvingen".',
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
