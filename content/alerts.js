/**
 * Cleanplaats zoekmeldingen (search alerts) — Marktplaats only.
 *
 * The extension is only the UI: alerts live on the Cleanplaats Alerts server
 * (see server/README.md), which polls Marktplaats around the clock and
 * notifies via e-mail/Telegram. Auth is an e-mail account with passwordless
 * login codes; this device stores a session token, so alerts and premium
 * follow the account across devices.
 *
 * The UI is a full-screen overlay (not the small panel popup): it renders a
 * login view, then a dashboard with stats, alert cards and a match feed.
 */

var CLEANPLAATS_ALERTS_API_BASE = 'https://cleanplaats-alerts.aron-vanderwal-46a.workers.dev';
var CLEANPLAATS_ALERTS_TOKEN_KEY = 'cleanplaatsAlertsToken';
var CLEANPLAATS_ALERTS_API_BASE_KEY = 'cleanplaatsAlertsApiBase';

var cleanplaatsAlertsRuntime = {
    token: '',
    apiBase: '',
    me: null,
    pendingEmail: '',
    // When the user last looked at the feed *before* opening this panel. Kept
    // for as long as the modal stays open — including across refreshes — so
    // the "NIEUW" badges don't vanish the moment you press refresh. Reset on
    // close, so a later visit starts from the freshly stamped server value.
    matchesSeenAt: null,
    // Remembers whether the control panel was expanded when the modal opened,
    // so closing the modal can restore it (the modal collapses the panel out
    // of the way while it's open).
    panelWasExpanded: false,
    // Guided-first-alert walkthrough, started from the panel card. `requested`
    // arms it for this panel session; `keepArmed` survives the login waypoint
    // so the dashboard steps still run once an account exists.
    walkthroughRequested: false,
    walkthroughKeepArmed: false,
    walkthroughSteps: null,
    walkthroughIndex: 0,
    walkthroughTarget: null,
    walkthroughReposition: null,
    // Last loaded alerts/matches, so the sub-views can render without refetching.
    cachedAlerts: null,
    cachedMatches: null
};

var ALERTS_TEXT = {
    modalTitle: 'Zoekmeldingen',
    tagline: 'Krijg nieuwe advertenties direct in je Telegram — ook als je browser dicht is.',
    intro: 'Krijg een melding zodra er een nieuwe advertentie verschijnt die aan je zoekopdracht voldoet — ook als je browser dicht is. Je Cleanplaats-filters worden automatisch toegepast.',
    loginTitle: 'Inloggen of account maken',
    loginIntro: 'Je e-mailadres is je account: je krijgt er een inlogcode op, en je zoekmeldingen werken daarmee op al je apparaten.',
    emailPlaceholder: 'jouw@email.nl',
    emailButton: 'Stuur inlogcode',
    emailSending: 'Versturen…',
    codeSentTo: email => `We hebben een 6-cijferige code gestuurd naar ${email}.`,
    codePlaceholder: '000000',
    codeButton: 'Inloggen',
    codeChecking: 'Controleren…',
    codeResend: 'Stuur nieuwe code',
    codeOtherEmail: 'Ander e-mailadres',
    loggedInAs: 'Ingelogd als',
    logout: 'Uitloggen',
    tierFree: 'Gratis',
    tierPremium: 'Premium',
    usageLabel: 'meldingen',
    checkFrequency: m => `Controleert elke ${m} minuten`,
    createTitle: 'Maak een zoekmelding',
    createButton: 'Zoekmelding maken',
    labelPlaceholder: 'Zoekterm, bijv. iphone 15 pro',
    createTermMissing: 'Vul een zoekterm in.',
    createContextHint: 'Filters van je huidige zoekopdracht (categorie, locatie) gaan mee zolang je de zoekterm niet wijzigt.',
    createBroadWarning: count => `Deze zoekopdracht is breed: ${count.toLocaleString('nl-NL')} advertenties. ` +
        'Je krijgt er waarschijnlijk veel meldingen van. Verfijn eerst je zoekopdracht met een prijs, categorie of afstand.',
    listTitle: 'Jouw zoekmeldingen',
    empty: 'Je hebt nog geen zoekmeldingen. Zoek iets op Marktplaats en maak je eerste melding aan.',
    deleteButton: 'Verwijder',
    deleteConfirm: 'Weet je zeker dat je deze melding wilt verwijderen?',
    pausedLabel: 'Gepauzeerd',
    activeLabel: 'Actief',
    matchCount: count => `${count} gevonden`,
    lastChecked: 'Laatst gecontroleerd',
    neverChecked: 'Nog niet gecontroleerd',
    nextCheckIn: m => `Volgende controle over ${m} ${m === 1 ? 'minuut' : 'minuten'}`,
    nextCheckSoon: 'Volgende controle: zo',
    refreshButton: 'Vernieuwen',
    validityLeft: n => `Verloopt over ${n} ${n === 1 ? 'dag' : 'dagen'}`,
    validityExpired: 'Verlopen',
    extendButton: 'Verleng',
    reactivateButton: 'Reactiveren',
    extendedToast: 'Zoekmelding verlengd.',
    reactivatedToast: 'Zoekmelding gereactiveerd.',
    channelTelegram: 'Telegram',
    statusLabel: 'Actief',
    matchesTitle: 'Gevonden advertenties',
    matchesEmpty: 'Nog niets gevonden. Zodra de eerste controle klaar is — binnen enkele minuten — verschijnen de advertenties hier.',
    newBadge: 'NIEUW',
    channelsTitle: 'Hoe je meldingen ontvangt',
    telegramLinked: 'Gekoppeld',
    telegramNotLinked: 'Nog niet gekoppeld',
    telegramLockedHint: 'Koppel eerst Telegram om hier meldingen via Telegram te krijgen. Klik om te koppelen.',
    // Telegram is the only delivery channel, so an unlinked account gets
    // nothing pushed to it — say that plainly instead of letting people wait.
    telegramRequiredTitle: 'Je ontvangt nog geen meldingen',
    telegramRequiredBody: 'Meldingen worden via Telegram verstuurd. Koppel Telegram om nieuwe advertenties binnen te krijgen — gevonden advertenties zie je hieronder ook zonder koppeling.',
    telegramRequiredButton: 'Telegram koppelen',
    telegramRelink: 'Ander account koppelen',
    telegramUnlink: 'Ontkoppelen',
    telegramUnlinkConfirm: 'Telegram ontkoppelen? Je ontvangt dan geen meldingen meer via Telegram.',
    telegramUnlinkedToast: 'Telegram ontkoppeld.',
    // Code-based linking flow (the bot sends you a code, you type it back here).
    telegramConnectTitle: 'Telegram koppelen',
    telegramConnectIntro: 'Krijg nieuwe advertenties direct in je Telegram-chat — werkt ook als je alleen Telegram op je telefoon hebt.',
    telegramStep1Title: 'Open onze bot in Telegram',
    telegramStep1Body: 'Open Telegram en zoek deze bot:',
    telegramStep1Open: 'Open in Telegram',
    telegramStep2Title: 'Stuur het bericht',
    telegramStep2Body: 'Tik op Start of stuur dit bericht naar de bot:',
    telegramStep3Title: 'Vul de code in',
    telegramStep3Body: 'De bot stuurt je een code van 6 cijfers terug. Typ die hier in:',
    telegramCodePlaceholder: '123456',
    telegramVerifyButton: 'Koppelen',
    telegramVerifying: 'Koppelen…',
    telegramVerifyError: 'Deze code klopt niet of is verlopen. Stuur de bot opnieuw een bericht voor een nieuwe code.',
    telegramLinkedToast: 'Telegram gekoppeld! Je ontvangt nu ook meldingen via Telegram.',
    telegramBack: 'Terug',
    telegramCopied: 'Gekopieerd',
    createdToast: 'Zoekmelding aangemaakt! Binnen enkele minuten zie je hier de huidige advertenties; daarna krijg je meldingen bij nieuwe.',
    deletedToast: 'Zoekmelding verwijderd.',
    errorToast: 'Er ging iets mis bij het verbinden met de meldingenserver.',
    loading: 'Laden…',
    justNow: 'Zojuist',
    minutesAgo: m => `${m} min geleden`,
    hoursAgo: h => `${h} uur geleden`,
    closeButton: 'Sluiten',
    sortNewest: 'Nieuwste eerst',
    sortPriceAsc: 'Prijs: laag-hoog',
    sortPriceDesc: 'Prijs: hoog-laag',
    // Per-alert filters
    filterButton: 'Filters',
    filterEditorTitle: 'Wat wil je overslaan?',
    filterEditorIntro: 'Vink aan welke soorten advertenties je voor deze zoekmelding níét wilt zien.',
    filterDagtoppers: 'Dagtoppers',
    filterReserved: 'Gereserveerd',
    filterOpval: 'Opvalstickers',
    filterCountActive: n => `${n} actief`,
    filterNoneActive: 'Alles tonen',
    filterAlwaysExcluded: 'Top- en bedrijfsadvertenties krijg je nooit als melding.',
    filterGlobalListsTitle: 'Geblokkeerde verkopers & woorden',
    filterGlobalListsHint: 'Deze gelden voor al je zoekmeldingen. Beheren doe je in het Cleanplaats-paneel.',
    filterListSellers: n => `${n} verkoper${n !== 1 ? 's' : ''}`,
    filterListTerms: n => `${n} woord${n !== 1 ? 'en' : ''}`,
    filterListListings: n => `${n} advertentie${n !== 1 ? 's' : ''}`,
    filterListsNone: 'Geen blokkades ingesteld',
    filterSavedToast: 'Filter opgeslagen.',
    // Premium. There is no checkout yet, so the button records interest instead
    // — with the price on screen, because that is the thing being tested.
    upgradePrice: price => `€ ${price.toFixed(2).replace('.', ',')}`,
    upgradePerMonth: 'per maand',
    upgradeSoon: 'Binnenkort',
    upgradeButton: 'Hou me op de hoogte',
    upgradeSending: 'Bezig…',
    upgradeRegistered: 'Je staat op de lijst — we mailen je zodra Premium er is.',
    upgradeToast: 'Bedankt! Je hoort van ons zodra Premium beschikbaar is.',

    // Account view
    accountTitle: 'Mijn account',
    accountOpen: 'Mijn account',
    accountEmailLabel: 'E-mailadres',
    accountPlanLabel: 'Abonnement',
    accountUsageLabel: 'Zoekopdrachten',
    accountIntervalLabel: 'Controlefrequentie',
    accountIntervalValue: m => `Elke ${m} minuten`,
    accountValidityLabel: 'Geldigheid',
    accountValidityValue: d => `${d} dagen per zoekopdracht`,
    accountTelegramLabel: 'Telegram',
    accountSinceLabel: 'Lid sinds',
    accountPricingLink: 'Bekijk wat er in elk abonnement zit',
    backToAlerts: 'Terug',

    // Limit view — shown when someone tries to add one too many.
    limitTitle: 'Je zit op je maximum',
    limitUsage: (used, max) => `${used} van ${max} zoekopdrachten in gebruik`,
    limitBody: max => `Met een gratis account kun je ${max} zoekopdrachten tegelijk laten lopen. ` +
        'Verwijder er hieronder een om ruimte te maken voor je nieuwe.',
    limitListTitle: 'Jouw lopende zoekopdrachten',
    limitPremiumTitle: 'Meer tegelijk laten lopen?',
    limitPremiumBody: (plan, freePlan) => `Premium geeft je ${plan.maxAlerts} zoekopdrachten in plaats van ` +
        `${freePlan.maxAlerts}, en controleert elke ${plan.intervalMinutes} minuten in plaats van ` +
        `${freePlan.intervalMinutes}. Het is er nog niet, maar we laten het weten zodra het zover is.`,
    limitFreedToast: 'Er is weer ruimte. Maak je nieuwe zoekopdracht aan.',

    // Pricing view
    pricingTitle: 'Wat je krijgt',
    pricingIntro: 'Cleanplaats blijft gratis te gebruiken. Premium is voor wie er als eerste bij wil zijn.',
    pricingCurrentPlan: 'Je huidige abonnement',
    pricingFree: 'Gratis',
    pricingPremium: 'Premium',
    pricingFeatureAlerts: n => `${n} zoekopdrachten tegelijk`,
    pricingFeatureInterval: m => `Controle elke ${m} minuten`,
    pricingFeatureValidity: d => `${d} dagen geldig per zoekopdracht`,
    pricingFeatureTelegram: 'Meldingen via Telegram',
    pricingFeatureFilters: 'Je Cleanplaats-filters werken door in je meldingen',
    pricingFeatureBlocklist: 'Geblokkeerde verkopers en woorden tellen mee',
    pricingFeatureOneClick: 'Zoekopdracht aanmaken vanaf je Marktplaats-zoekresultaten',
    pricingFeatureFeed: 'Overzicht van alle gevonden advertenties'
};

/**
 * The per-alert ad-type toggles. The blacklist *lists* (sellers/terms/blocked
 * listings) are global and managed in the main panel, so they are not here.
 * `setting` maps to the global Cleanplaats setting used as the default when a
 * new alert is created.
 */
var ALERT_FILTER_DEFS = [
    { key: 'removeDagtoppers', setting: 'removeDagtoppers', label: () => ALERTS_TEXT.filterDagtoppers },
    { key: 'removeOpvalStickers', setting: 'removeOpvalStickers', label: () => ALERTS_TEXT.filterOpval },
    { key: 'removeReservedListings', setting: 'removeReservedListings', label: () => ALERTS_TEXT.filterReserved }
];

function getDefaultAlertFilters() {
    const s = (typeof CLEANPLAATS !== 'undefined' && CLEANPLAATS.settings) || {};
    const filters = {};
    ALERT_FILTER_DEFS.forEach(def => { filters[def.key] = Boolean(s[def.setting]); });
    return filters;
}

function parseAlertFilters(alert) {
    if (alert && alert.filters_json) {
        try {
            const parsed = JSON.parse(alert.filters_json);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                const filters = {};
                ALERT_FILTER_DEFS.forEach(def => { filters[def.key] = Boolean(parsed[def.key]); });
                return filters;
            }
        } catch (error) {
            console.error('Cleanplaats: invalid alert filters_json', error);
        }
    }
    // Older alert without its own filters: fall back to the current globals.
    return getDefaultAlertFilters();
}

function countActiveAlertFilters(filters) {
    return ALERT_FILTER_DEFS.reduce((n, def) => n + (filters[def.key] ? 1 : 0), 0);
}

/**
 * Crisp inline SVG icons (stroke = currentColor, so they follow text color
 * and dark mode for free). Emoji rendered tiny/blurry and ignored theming.
 */
var ALERTS_ICONS = {
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    send: '<path d="m22 2-11 11"/><path d="m22 2-7 20-4-9-9-4 20-7z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    key: '<path d="m21 2-2 2"/><path d="m15.5 7.5 3 3L22 7l-3-3-3.5 3.5z"/><path d="M11.39 11.61a5.5 5.5 0 1 0 1 1z"/><path d="m11.39 11.61 4.11-4.11"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'
};

function alertIcon(name, size) {
    const s = size || 16;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ALERTS_ICONS[name] || ''}</svg>`;
}

function escapeAlertText(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatAlertRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    if (diff < 90 * 1000) return ALERTS_TEXT.justNow;
    if (diff < 60 * 60 * 1000) return ALERTS_TEXT.minutesAgo(Math.round(diff / 60000));
    if (diff < 24 * 60 * 60 * 1000) return ALERTS_TEXT.hoursAgo(Math.round(diff / 3600000));
    try {
        return new Date(timestamp).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
    } catch (error) {
        return '';
    }
}

/**
 * When the next poll is due. The cron runs every minute and picks up alerts
 * whose interval has elapsed, so this is accurate to about a minute — hence
 * "zo" rather than a countdown to the second once we're inside that window.
 */
function formatAlertNextCheck(lastCheckedAt, intervalMinutes) {
    const interval = Number(intervalMinutes) > 0 ? Number(intervalMinutes) : 0;
    if (!lastCheckedAt || !interval) return '';
    const remaining = lastCheckedAt + interval * 60 * 1000 - Date.now();
    if (remaining <= 60 * 1000) return ALERTS_TEXT.nextCheckSoon;
    return ALERTS_TEXT.nextCheckIn(Math.round(remaining / 60000));
}

/**
 * Validity window state for an alert. Returns null when the alert never
 * expires (expires_at missing/NULL). `soon` flags the last few days so the UI
 * can nudge with a Verleng button.
 */
function getAlertValidity(alert) {
    if (!alert || !alert.expires_at) return null;
    const msLeft = alert.expires_at - Date.now();
    if (msLeft <= 0) return { expired: true, daysLeft: 0, soon: false };
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    return { expired: false, daysLeft, soon: daysLeft <= 3 };
}

// Marktplaats sends price_cents: 0 for listings without a fixed price (FAST_BID,
// SEE_DESCRIPTION) — about a third of a result page — so only an amount above
// zero is a real price. MIN_BID is the exception: its amount is the starting bid.
// Keep in sync with formatPrice() in the alerts server's src/notify.js.
var ALERT_PRICE_TYPE_LABELS = {
    FAST_BID: 'Bieden',
    MIN_BID: 'Bieden',
    SEE_DESCRIPTION: 'Zie omschrijving',
    NOTK: 'N.o.t.k.',
    FREE: 'Gratis',
    RESERVED: 'Gereserveerd',
    EXCHANGE: 'Ruilen',
    ON_REQUEST: 'Op aanvraag'
};

function formatAlertMatchPrice(match) {
    if (Number.isFinite(match.price_cents) && match.price_cents > 0) {
        const euros = match.price_cents / 100;
        const amount = Number.isInteger(euros)
            ? `€ ${euros.toLocaleString('nl-NL')}`
            : `€ ${euros.toFixed(2).replace('.', ',')}`;
        return match.price_type === 'MIN_BID' ? `Bieden vanaf ${amount}` : amount;
    }
    return ALERT_PRICE_TYPE_LABELS[match.price_type] || '';
}

function sortAlertMatches(matches, mode) {
    const sorted = [...matches];
    if (mode === 'price_asc') {
        return sorted.sort((a, b) => {
            const pa = Number.isFinite(a.price_cents) ? a.price_cents : Infinity;
            const pb = Number.isFinite(b.price_cents) ? b.price_cents : Infinity;
            return pa - pb;
        });
    }
    if (mode === 'price_desc') {
        return sorted.sort((a, b) => {
            const pa = Number.isFinite(a.price_cents) ? a.price_cents : -Infinity;
            const pb = Number.isFinite(b.price_cents) ? b.price_cents : -Infinity;
            return pb - pa;
        });
    }
    // newest: non-baseline first, then by found_at DESC
    return sorted.sort((a, b) => (a.is_baseline - b.is_baseline) || (b.found_at - a.found_at));
}

function buildGlobalListsSummaryHtml() {
    const s = (typeof CLEANPLAATS !== 'undefined' && CLEANPLAATS.settings) || {};
    const sellerCount = (s.blacklistedSellers || []).length;
    const termCount = (s.blacklistedTerms || []).length + (s.blacklistedDescriptionTerms || []).length;
    const listingCount = (s.blockedListings || []).length;
    const chips = [];
    if (sellerCount > 0) chips.push(ALERTS_TEXT.filterListSellers(sellerCount));
    if (termCount > 0) chips.push(ALERTS_TEXT.filterListTerms(termCount));
    if (listingCount > 0) chips.push(ALERTS_TEXT.filterListListings(listingCount));
    const body = chips.length === 0
        ? `<span class="cleanplaats-alerts-filter-none">${ALERTS_TEXT.filterListsNone}</span>`
        : chips.map(c => `<span class="cleanplaats-alerts-filter-chip">${escapeAlertText(c)}</span>`).join('');
    return `
        <div class="cleanplaats-alerts-filter-global">
            <div class="cleanplaats-alerts-filter-global-head">${ALERTS_TEXT.filterGlobalListsTitle}</div>
            <div class="cleanplaats-alerts-filter-global-chips">${body}</div>
            <div class="cleanplaats-alerts-filter-global-hint">${ALERTS_TEXT.filterGlobalListsHint}</div>
        </div>
    `;
}

function buildAlertFilterBlockHtml(alert) {
    const filters = parseAlertFilters(alert);
    const activeCount = countActiveAlertFilters(filters);
    const summary = activeCount > 0
        ? `<span class="cleanplaats-alerts-filter-count">${ALERTS_TEXT.filterCountActive(activeCount)}</span>`
        : `<span class="cleanplaats-alerts-filter-count cleanplaats-alerts-filter-count-zero">${ALERTS_TEXT.filterNoneActive}</span>`;

    const toggles = ALERT_FILTER_DEFS.map(def => `
        <label class="cleanplaats-alerts-filter-opt">
            <input type="checkbox" data-alert-id="${alert.id}" data-filter-key="${def.key}"${filters[def.key] ? ' checked' : ''}>
            <span class="cleanplaats-alerts-filter-opt-box">${alertIcon('check', 12)}</span>
            <span class="cleanplaats-alerts-filter-opt-label">${def.label()}</span>
        </label>
    `).join('');

    return `
        <div class="cleanplaats-alerts-filter-block">
            <button class="cleanplaats-alerts-filter-trigger" type="button" data-alert-id="${alert.id}" aria-expanded="false">
                <span class="cleanplaats-alerts-filter-trigger-left">
                    ${alertIcon('filter', 13)}<span>${ALERTS_TEXT.filterButton}</span>${summary}
                </span>
                <span class="cleanplaats-alerts-filter-chevron">${alertIcon('chevron', 15)}</span>
            </button>
            <div class="cleanplaats-alerts-filter-editor" hidden>
                <p class="cleanplaats-alerts-filter-editor-intro">${ALERTS_TEXT.filterEditorIntro}</p>
                <div class="cleanplaats-alerts-filter-opts">${toggles}</div>
                <div class="cleanplaats-alerts-filter-always">${alertIcon('check', 13)}<span>${ALERTS_TEXT.filterAlwaysExcluded}</span></div>
                ${buildGlobalListsSummaryHtml()}
            </div>
        </div>
    `;
}

function renderAlertMatchItems(matches) {
    if (!matches || matches.length === 0) {
        return `<div class="cleanplaats-alerts-empty">${ALERTS_TEXT.matchesEmpty}</div>`;
    }
    return matches.map(match => {
        // "NIEUW" means new *to this user*: found after the last time they
        // looked. Baseline listings (the snapshot from the alert's first poll)
        // never qualify — they were already there when the alert was made.
        const seenAt = cleanplaatsAlertsRuntime.matchesSeenAt || 0;
        const isNew = !match.is_baseline && match.found_at > seenAt;
        const thumb = match.image_url
            ? `<img class="cleanplaats-alerts-match-thumb" src="${escapeAlertText(match.image_url)}" alt="" loading="lazy">`
            : `<span class="cleanplaats-alerts-match-thumb cleanplaats-alerts-match-thumb-empty">${alertIcon('image', 20)}</span>`;
        return `
            <a class="cleanplaats-alerts-match" href="${escapeAlertText(match.url)}">
                ${thumb}
                <span class="cleanplaats-alerts-match-info">
                    <span class="cleanplaats-alerts-match-title">${isNew ? `<span class="cleanplaats-alerts-new">${ALERTS_TEXT.newBadge}</span> ` : ''}${escapeAlertText(match.title)}</span>
                    <span class="cleanplaats-alerts-match-sub">
                        <span class="cleanplaats-alerts-match-price">${formatAlertMatchPrice(match)}</span>
                        ${match.city ? `<span>· ${escapeAlertText(match.city)}</span>` : ''}
                        <span>· ${formatAlertRelativeTime(match.found_at)}</span>
                    </span>
                    <span class="cleanplaats-alerts-match-alert-label">${escapeAlertText(match.alert_label || '')}</span>
                </span>
            </a>
        `;
    }).join('');
}

/**
 * Keeps the panel card able to say something real without a network call on
 * every page load: the dashboard writes what it just loaded into settings, and
 * the card renders from that.
 *
 * `newMatchCount` is what was unseen when this panel session started. Opening
 * the panel stamps the visit server-side, so after a close it settles back to
 * zero — a genuinely live unread badge needs a background check, which this
 * deliberately is not.
 */
function storeAlertsSummary(alerts, matches) {
    if (typeof CLEANPLAATS === 'undefined' || !CLEANPLAATS.settings) return;

    const seenAt = cleanplaatsAlertsRuntime.matchesSeenAt || 0;
    const activeCount = alerts.filter(alert => {
        const validity = getAlertValidity(alert);
        return alert.enabled && !(validity && validity.expired);
    }).length;

    CLEANPLAATS.settings.alertsSummary = {
        totalCount: alerts.length,
        activeCount,
        newMatchCount: matches.filter(match => !match.is_baseline && match.found_at > seenAt).length,
        updatedAt: Date.now()
    };

    if (typeof saveSettings === 'function') {
        saveSettings().catch(error => {
            console.error('Cleanplaats: Failed to store alerts summary', error);
        });
    }
}

function initAlertsRuntime() {
    return new Promise(resolve => {
        browserAPI.storage.local.get([CLEANPLAATS_ALERTS_TOKEN_KEY, CLEANPLAATS_ALERTS_API_BASE_KEY], items => {
            cleanplaatsAlertsRuntime.apiBase = items[CLEANPLAATS_ALERTS_API_BASE_KEY] || CLEANPLAATS_ALERTS_API_BASE;
            cleanplaatsAlertsRuntime.token = items[CLEANPLAATS_ALERTS_TOKEN_KEY] || '';
            resolve();
        });
    });
}

function storeAlertsToken(token) {
    cleanplaatsAlertsRuntime.token = token || '';
    return new Promise(resolve => {
        if (token) {
            browserAPI.storage.local.set({ [CLEANPLAATS_ALERTS_TOKEN_KEY]: token }, resolve);
        } else {
            browserAPI.storage.local.remove(CLEANPLAATS_ALERTS_TOKEN_KEY, resolve);
        }
    });
}

function alertsApiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (cleanplaatsAlertsRuntime.token) {
        headers['Authorization'] = `Bearer ${cleanplaatsAlertsRuntime.token}`;
    }

    return fetch(`${cleanplaatsAlertsRuntime.apiBase}${path}`, { ...options, headers })
        .then(response => response.json().catch(() => ({})).then(data => {
            if (!response.ok) {
                const error = new Error(data.error || `Alerts API error ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return data;
        }));
}

/**
 * Extracts the current search as server-ready /lrp/api/search params.
 * Mirrors buildSearchApiUrl() in cleanup.js, but returns the params instead
 * of a URL so the server can re-run the search on its own schedule.
 */
function getAlertSearchContext() {
    if (!isMarktplaatsSite()) return null;

    const href = window.location.href;
    if (!href.includes('/q/') && !href.includes('/l/')) return null;

    // Query straight from the URL. Marktplaats navigates client-side between
    // searches, so the server-rendered __NEXT_DATA__ blob can still describe
    // a *previous* search; the URL always matches what the user sees.
    const urlQuery = decodeURIComponent(
        (window.location.pathname.match(/\/q\/([^/]+)/) || [, ''])[1] || ''
    ).replace(/[-+]/g, ' ').trim();

    let searchParams = {};
    let query = '';

    try {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
            const q = JSON.parse(nextDataEl.textContent).query || {};
            if (q.searchQuery) {
                query = String(q.searchQuery);
                searchParams.query = query;
            }
            ['l1CategoryId', 'l2CategoryId', 'postcode', 'distanceMeters',
                'attributesValuesIds', 'attributesValuesKeys', 'attributesById',
                'attributesByKey', 'attributeRanges'].forEach(key => {
                if (q[key] !== undefined && q[key] !== null && q[key] !== '') {
                    searchParams[key] = q[key];
                }
            });
        }
    } catch (error) {
        console.error('Cleanplaats: Failed to read search context for alert', error);
    }

    if (urlQuery && query.toLowerCase() !== urlQuery.toLowerCase()) {
        // __NEXT_DATA__ is stale (or absent): trust the URL and drop the
        // filters that belonged to the old search.
        query = urlQuery;
        searchParams = { query: urlQuery };
    }

    // Hash params override (same precedence as buildSearchApiUrl).
    const hash = window.location.hash.replace('#', '');
    hash.split('|').forEach(part => {
        const colonIdx = part.indexOf(':');
        if (colonIdx <= 0) return;
        const key = part.slice(0, colonIdx);
        const value = part.slice(colonIdx + 1);
        if (key === 'postcode' && value) searchParams.postcode = value;
        if (key === 'distanceMeters' && value) searchParams.distanceMeters = value;
    });

    if (Object.keys(searchParams).length === 0) return null;

    searchParams.searchInTitleAndDescription = 'true';

    const suggestedLabel = query || decodeURIComponent(
        (window.location.pathname.match(/\/[ql]\/([^/]+)/) || [, ''])[1] || ''
    ).replace(/[-+]/g, ' ').trim() || 'Marktplaats zoekopdracht';

    return {
        suggestedLabel: suggestedLabel.slice(0, 120),
        searchParams,
        searchUrl: href.slice(0, 500)
    };
}

function buildAlertFiltersPayload() {
    const s = CLEANPLAATS.settings;
    return {
        blacklistedSellers: s.blacklistedSellers || [],
        blacklistedTerms: s.blacklistedTerms || [],
        blacklistedDescriptionTerms: s.blacklistedDescriptionTerms || [],
        blockedListings: s.blockedListings || [],
        removeDagtoppers: Boolean(s.removeDagtoppers),
        removeReservedListings: Boolean(s.removeReservedListings),
        removeOpvalStickers: Boolean(s.removeOpvalStickers)
    };
}

function syncAlertFilters() {
    return alertsApiFetch('/api/filters', {
        method: 'PUT',
        body: JSON.stringify({ filters: buildAlertFiltersPayload() })
    }).catch(error => {
        console.error('Cleanplaats: Failed to sync filters to alerts server', error);
    });
}

/* ===== Overlay shell ===== */

function getAlertsOverlay() {
    let overlay = document.getElementById('cleanplaats-alerts-modal');
    if (overlay && !overlay.classList.contains('cleanplaats-alerts-overlay')) {
        // Stale node from an older panel render; replace it.
        overlay.remove();
        overlay = null;
    }
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cleanplaats-alerts-modal';
        overlay.className = 'cleanplaats-alerts-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) hideAlertsModal();
        });
    }
    return overlay;
}

function hideAlertsModal() {
    const overlay = document.getElementById('cleanplaats-alerts-modal');
    if (overlay) overlay.style.display = 'none';
    // Next time the panel opens it should use the visit the server stamped
    // during this one, so what we just looked at is no longer "NIEUW".
    cleanplaatsAlertsRuntime.matchesSeenAt = null;
    endAlertsWalkthrough({ disarm: true });
    restorePanelAfterAlerts();
    // The card summarises what this session just loaded, so bring it up to date
    // before the panel comes back into view.
    if (typeof refreshAlertsPromo === 'function') refreshAlertsPromo();
}

// The modal takes over the screen, so we tuck the control panel back into its
// bubble while it's open and bring it back exactly as it was on close.
function restorePanelAfterAlerts() {
    if (cleanplaatsAlertsRuntime.panelWasExpanded && typeof setPanelCollapsed === 'function') {
        setPanelCollapsed(false, { persist: false });
    }
    cleanplaatsAlertsRuntime.panelWasExpanded = false;
}

function showAlertsModal(options = {}) {
    const overlay = getAlertsOverlay();

    ['cleanplaats-blacklist-modal', 'cleanplaats-terms-modal', 'cleanplaats-blocked-listings-modal'].forEach(id => {
        const otherModal = document.getElementById(id);
        if (otherModal) otherModal.style.display = 'none';
    });

    if (overlay.style.display === 'flex') {
        hideAlertsModal();
        return;
    }

    // Set before the first render: the walkthrough attaches to elements the
    // dashboard (or login view) creates, so it has to be armed up front.
    cleanplaatsAlertsRuntime.walkthroughRequested = Boolean(options.walkthrough);

    renderAlertsShell(overlay);
    overlay.style.display = 'flex';

    // Get the control panel out of the way (remembering its state so close can
    // restore it). Don't persist — this is a temporary, modal-driven collapse.
    if (typeof CLEANPLAATS !== 'undefined' && CLEANPLAATS.panelState) {
        cleanplaatsAlertsRuntime.panelWasExpanded = !CLEANPLAATS.panelState.isCollapsed;
        if (cleanplaatsAlertsRuntime.panelWasExpanded && typeof setPanelCollapsed === 'function') {
            setPanelCollapsed(true, { persist: false });
        }
    }

    initAlertsRuntime().then(() => {
        if (!cleanplaatsAlertsRuntime.token) {
            renderAlertsLoginView();
            return;
        }
        loadAlertsDashboard();
    });
}

function renderAlertsShell(overlay) {
    overlay.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-alerts-card" role="dialog" aria-label="${ALERTS_TEXT.modalTitle}">
            <div class="cleanplaats-alerts-header">
                <div class="cleanplaats-alerts-header-title">
                    <span class="cleanplaats-alerts-bell"><img id="cleanplaats-alerts-bell-img" alt="" width="42" height="42"></span>
                    <div>
                        <h3>${ALERTS_TEXT.modalTitle}</h3>
                        <span class="cleanplaats-alerts-tagline">${ALERTS_TEXT.tagline}</span>
                    </div>
                </div>
                <div class="cleanplaats-alerts-header-actions">
                    <button class="cleanplaats-alerts-refresh" id="cleanplaats-alerts-account-btn" title="${ALERTS_TEXT.accountOpen}" aria-label="${ALERTS_TEXT.accountOpen}" hidden>${alertIcon('user', 16)}</button>
                    <button class="cleanplaats-alerts-refresh" id="cleanplaats-alerts-refresh" title="${ALERTS_TEXT.refreshButton}" aria-label="${ALERTS_TEXT.refreshButton}" hidden>${alertIcon('refresh', 16)}</button>
                    <button class="cleanplaats-alerts-close" id="cleanplaats-alerts-close" aria-label="${ALERTS_TEXT.closeButton}">${alertIcon('close', 16)}</button>
                </div>
            </div>
            <div class="cleanplaats-alerts-body" id="cleanplaats-alerts-body">
                <div class="cleanplaats-alerts-loading">${ALERTS_TEXT.loading}</div>
            </div>
        </div>
    `);
    // Set the src in JS: DOMPurify strips the chrome-extension:// scheme from
    // sanitized markup, so the image must be assigned after sanitizing.
    const bellImg = document.getElementById('cleanplaats-alerts-bell-img');
    if (bellImg) bellImg.src = browserAPI.runtime.getURL('icons/alert-icon.png');
    document.getElementById('cleanplaats-alerts-close').onclick = hideAlertsModal;
    document.getElementById('cleanplaats-alerts-account-btn').onclick = renderAlertsAccountView;
    // The panel lives on the page, so reloading Marktplaats to see whether
    // anything new came in would close it. This refreshes just the panel.
    const refreshButton = document.getElementById('cleanplaats-alerts-refresh');
    refreshButton.onclick = () => {
        // One turn of the icon: without it a refresh that returns the same
        // data looks like the button did nothing.
        refreshButton.classList.remove('cleanplaats-alerts-refresh-spinning');
        void refreshButton.offsetWidth;
        refreshButton.classList.add('cleanplaats-alerts-refresh-spinning');
        loadAlertsDashboard();
    };
}

function setAlertsBody(html) {
    const body = document.getElementById('cleanplaats-alerts-body');
    if (!body) return null;
    body.innerHTML = DOMPurify.sanitize(html);
    // Default the header buttons off on every view change; only the dashboard
    // turns them back on. Refreshing a half-typed login code or pairing code
    // would throw the input away, and the sub-views have their own way back.
    setAlertsRefreshVisible(false);
    setAlertsAccountVisible(false);
    return body;
}

function setAlertsRefreshVisible(visible) {
    const button = document.getElementById('cleanplaats-alerts-refresh');
    if (button) button.hidden = !visible;
}

/**
 * The account button only means something once there is an account, and only
 * when we are not already looking at it.
 */
function setAlertsAccountVisible(visible) {
    const button = document.getElementById('cleanplaats-alerts-account-btn');
    if (button) button.hidden = !visible;
}

function showAlertsInlineError(message) {
    const errorEl = document.getElementById('cleanplaats-alerts-form-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

/* ===== Login views ===== */

function renderAlertsLoginView() {
    const body = setAlertsBody(`
        <div class="cleanplaats-alerts-login">
            <div class="cleanplaats-alerts-login-icon">${alertIcon('mail', 24)}</div>
            <h4>${ALERTS_TEXT.loginTitle}</h4>
            <p>${ALERTS_TEXT.loginIntro}</p>
            <div class="cleanplaats-alerts-form-row">
                <input type="email" id="cleanplaats-alerts-email-input" placeholder="${ALERTS_TEXT.emailPlaceholder}" autocomplete="email">
                <button id="cleanplaats-alerts-email-submit" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.emailButton}</button>
            </div>
            <div class="cleanplaats-alerts-form-error" id="cleanplaats-alerts-form-error" style="display:none;"></div>
        </div>
    `);
    if (!body) return;

    const input = document.getElementById('cleanplaats-alerts-email-input');
    const submit = document.getElementById('cleanplaats-alerts-email-submit');
    if (cleanplaatsAlertsRuntime.pendingEmail) input.value = cleanplaatsAlertsRuntime.pendingEmail;

    const send = () => {
        const email = input.value.trim();
        if (!email || !email.includes('@')) {
            showAlertsInlineError('Vul een geldig e-mailadres in.');
            return;
        }
        submit.disabled = true;
        submit.textContent = ALERTS_TEXT.emailSending;
        alertsApiFetch('/api/auth/request-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        }).then(() => {
            cleanplaatsAlertsRuntime.pendingEmail = email;
            renderAlertsCodeView();
        }).catch(error => {
            submit.disabled = false;
            submit.textContent = ALERTS_TEXT.emailButton;
            showAlertsInlineError(error.message || ALERTS_TEXT.errorToast);
        });
    };

    submit.onclick = send;
    input.onkeydown = event => { if (event.key === 'Enter') send(); };
    input.focus();
    maybeRunAlertsLoginWalkthrough();
}

function renderAlertsCodeView() {
    const email = cleanplaatsAlertsRuntime.pendingEmail;
    const body = setAlertsBody(`
        <div class="cleanplaats-alerts-login">
            <div class="cleanplaats-alerts-login-icon">${alertIcon('key', 24)}</div>
            <h4>${ALERTS_TEXT.loginTitle}</h4>
            <p>${escapeAlertText(ALERTS_TEXT.codeSentTo(email))}</p>
            <div class="cleanplaats-alerts-form-row">
                <input type="text" id="cleanplaats-alerts-code-input" class="cleanplaats-alerts-code-input" inputmode="numeric" maxlength="6" placeholder="${ALERTS_TEXT.codePlaceholder}" autocomplete="one-time-code">
                <button id="cleanplaats-alerts-code-submit" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.codeButton}</button>
            </div>
            <div class="cleanplaats-alerts-form-error" id="cleanplaats-alerts-form-error" style="display:none;"></div>
            <div class="cleanplaats-alerts-login-links">
                <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-resend">${ALERTS_TEXT.codeResend}</button>
                <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-other-email">${ALERTS_TEXT.codeOtherEmail}</button>
            </div>
        </div>
    `);
    if (!body) return;

    const input = document.getElementById('cleanplaats-alerts-code-input');
    const submit = document.getElementById('cleanplaats-alerts-code-submit');

    const verify = () => {
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) {
            showAlertsInlineError('Vul de 6-cijferige code in.');
            return;
        }
        submit.disabled = true;
        submit.textContent = ALERTS_TEXT.codeChecking;
        alertsApiFetch('/api/auth/verify', {
            method: 'POST',
            body: JSON.stringify({ email, code })
        }).then(data => {
            return storeAlertsToken(data.token).then(() => {
                syncAlertFilters();
                loadAlertsDashboard();
            });
        }).catch(error => {
            submit.disabled = false;
            submit.textContent = ALERTS_TEXT.codeButton;
            showAlertsInlineError(error.message || ALERTS_TEXT.errorToast);
        });
    };

    submit.onclick = verify;
    input.onkeydown = event => { if (event.key === 'Enter') verify(); };
    input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); };
    input.focus();

    document.getElementById('cleanplaats-alerts-other-email').onclick = () => renderAlertsLoginView();
    document.getElementById('cleanplaats-alerts-resend').onclick = event => {
        event.target.disabled = true;
        alertsApiFetch('/api/auth/request-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        }).catch(error => showAlertsInlineError(error.message || ALERTS_TEXT.errorToast));
    };
}

/* ===== Telegram koppelen ===== */

/**
 * The step-by-step Telegram connect screen. The bot hands out a short code when
 * the user messages it; they type that code back here to claim the chat. This
 * replaces the old t.me deep-link, which silently failed without the Telegram
 * desktop app. Returns the user to the dashboard on success or via "Terug".
 */
function renderTelegramConnect(me) {
    const bot = (me && me.telegramBot) || '';
    const botHandle = bot ? '@' + bot : 'onze Telegram-bot';
    const tmeUrl = bot ? `https://t.me/${bot}` : '';
    const startCmd = '/start';

    const copyBtn = target => `<button class="cleanplaats-alerts-copy" type="button" data-copy-target="${target}" aria-label="${ALERTS_TEXT.telegramCopied}">${alertIcon('copy', 14)}</button>`;

    const body = setAlertsBody(`
        <div class="cleanplaats-alerts-connect">
            <button class="cleanplaats-alerts-text-btn cleanplaats-alerts-connect-back" id="cleanplaats-tg-back">
                ${alertIcon('arrowLeft', 15)}<span>${ALERTS_TEXT.telegramBack}</span>
            </button>

            <div class="cleanplaats-alerts-connect-head">
                <span class="cleanplaats-alerts-connect-logo">${alertIcon('send', 22)}</span>
                <h4>${ALERTS_TEXT.telegramConnectTitle}</h4>
                <p>${ALERTS_TEXT.telegramConnectIntro}</p>
            </div>

            <ol class="cleanplaats-alerts-connect-steps">
                <li class="cleanplaats-alerts-connect-step">
                    <span class="cleanplaats-alerts-connect-num">1</span>
                    <div class="cleanplaats-alerts-connect-body">
                        <span class="cleanplaats-alerts-connect-title">${ALERTS_TEXT.telegramStep1Title}</span>
                        <span class="cleanplaats-alerts-connect-sub">${ALERTS_TEXT.telegramStep1Body}</span>
                        <div class="cleanplaats-alerts-connect-actions">
                            <code class="cleanplaats-alerts-connect-code" id="cleanplaats-tg-bot">${escapeAlertText(botHandle)}</code>
                            ${bot ? copyBtn('cleanplaats-tg-bot') : ''}
                            ${tmeUrl ? `<a class="cleanplaats-alerts-secondary-btn cleanplaats-alerts-connect-open" id="cleanplaats-tg-open" href="${tmeUrl}" target="_blank" rel="noopener noreferrer">${ALERTS_TEXT.telegramStep1Open}</a>` : ''}
                        </div>
                    </div>
                </li>
                <li class="cleanplaats-alerts-connect-step">
                    <span class="cleanplaats-alerts-connect-num">2</span>
                    <div class="cleanplaats-alerts-connect-body">
                        <span class="cleanplaats-alerts-connect-title">${ALERTS_TEXT.telegramStep2Title}</span>
                        <span class="cleanplaats-alerts-connect-sub">${ALERTS_TEXT.telegramStep2Body}</span>
                        <div class="cleanplaats-alerts-connect-actions">
                            <code class="cleanplaats-alerts-connect-code" id="cleanplaats-tg-cmd">${startCmd}</code>
                            ${copyBtn('cleanplaats-tg-cmd')}
                        </div>
                    </div>
                </li>
                <li class="cleanplaats-alerts-connect-step">
                    <span class="cleanplaats-alerts-connect-num">3</span>
                    <div class="cleanplaats-alerts-connect-body">
                        <span class="cleanplaats-alerts-connect-title">${ALERTS_TEXT.telegramStep3Title}</span>
                        <span class="cleanplaats-alerts-connect-sub">${ALERTS_TEXT.telegramStep3Body}</span>
                        <div class="cleanplaats-alerts-connect-verify">
                            <input type="text" id="cleanplaats-tg-code" class="cleanplaats-alerts-code-input cleanplaats-alerts-connect-input" inputmode="numeric" maxlength="6" placeholder="${ALERTS_TEXT.telegramCodePlaceholder}" autocomplete="one-time-code">
                            <button id="cleanplaats-tg-verify" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.telegramVerifyButton}</button>
                        </div>
                        <div class="cleanplaats-alerts-form-error" id="cleanplaats-tg-error" style="display:none;"></div>
                    </div>
                </li>
            </ol>
        </div>
    `);
    if (!body) return;

    document.getElementById('cleanplaats-tg-back').onclick = () => loadAlertsDashboard();

    body.querySelectorAll('.cleanplaats-alerts-copy').forEach(button => {
        button.onclick = () => {
            const target = document.getElementById(button.dataset.copyTarget);
            const value = target ? target.textContent.trim() : '';
            if (!value || !navigator.clipboard) return;
            navigator.clipboard.writeText(value)
                .then(() => showBubbleNotification(ALERTS_TEXT.telegramCopied))
                .catch(() => {});
        };
    });

    const input = document.getElementById('cleanplaats-tg-code');
    const verifyBtn = document.getElementById('cleanplaats-tg-verify');
    const errorEl = document.getElementById('cleanplaats-tg-error');

    const showError = message => {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    };

    input.oninput = () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        if (errorEl) errorEl.style.display = 'none';
    };

    const verify = () => {
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) {
            showError('Vul de 6-cijferige code in.');
            return;
        }
        verifyBtn.disabled = true;
        verifyBtn.textContent = ALERTS_TEXT.telegramVerifying;
        alertsApiFetch('/api/telegram/verify', {
            method: 'POST',
            body: JSON.stringify({ code })
        }).then(() => {
            showBubbleNotification(ALERTS_TEXT.telegramLinkedToast);
            loadAlertsDashboard();
        }).catch(error => {
            verifyBtn.disabled = false;
            verifyBtn.textContent = ALERTS_TEXT.telegramVerifyButton;
            showError((error && error.message) || ALERTS_TEXT.telegramVerifyError);
        });
    };

    verifyBtn.onclick = verify;
    input.onkeydown = event => { if (event.key === 'Enter') verify(); };
    input.focus();
}

/* ===== Account, prijzen en de limiet =====
   Three views the dashboard hands off to. They exist to make the account feel
   like something you have rather than something that happens to you: what is
   in it, what it costs, and what the ceiling is when you hit it. */

function alertsViewHeader(title, subtitle) {
    return `
        <div class="cleanplaats-alerts-subview-header">
            <button type="button" class="cleanplaats-alerts-back" id="cleanplaats-alerts-back">${alertIcon('arrowLeft', 15)}<span>${ALERTS_TEXT.backToAlerts}</span></button>
            <h4 class="cleanplaats-alerts-subview-title">${title}</h4>
            ${subtitle ? `<p class="cleanplaats-alerts-subview-sub">${subtitle}</p>` : ''}
        </div>
    `;
}

function wireAlertsBackButton() {
    const back = document.getElementById('cleanplaats-alerts-back');
    if (back) back.onclick = loadAlertsDashboard;
}

function formatAlertsMemberSince(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderAlertsAccountView() {
    const me = cleanplaatsAlertsRuntime.me;
    if (!me) {
        loadAlertsDashboard();
        return;
    }

    const isPremium = me.tier === 'premium';
    const rows = [
        [ALERTS_TEXT.accountEmailLabel, escapeAlertText(me.email)],
        [ALERTS_TEXT.accountPlanLabel, isPremium ? ALERTS_TEXT.tierPremium : ALERTS_TEXT.tierFree],
        [ALERTS_TEXT.accountUsageLabel, `${me.alertCount || 0} / ${me.maxAlerts}`],
        [ALERTS_TEXT.accountIntervalLabel, ALERTS_TEXT.accountIntervalValue(me.intervalMinutes)],
        [ALERTS_TEXT.accountTelegramLabel, me.telegramLinked ? ALERTS_TEXT.telegramLinked : ALERTS_TEXT.telegramNotLinked],
        [ALERTS_TEXT.accountSinceLabel, formatAlertsMemberSince(me.createdAt)]
    ];

    const validDays = me.plans?.[isPremium ? 'premium' : 'free']?.validDays;
    if (validDays) {
        rows.splice(4, 0, [ALERTS_TEXT.accountValidityLabel, ALERTS_TEXT.accountValidityValue(validDays)]);
    }

    setAlertsBody(`
        ${alertsViewHeader(ALERTS_TEXT.accountTitle)}
        <div class="cleanplaats-alerts-detail-list">
            ${rows.map(([label, value]) => `
                <div class="cleanplaats-alerts-detail-row">
                    <span class="cleanplaats-alerts-detail-label">${label}</span>
                    <span class="cleanplaats-alerts-detail-value">${value}</span>
                </div>
            `).join('')}
        </div>
        <button type="button" class="cleanplaats-alerts-secondary-btn cleanplaats-alerts-block-btn" id="cleanplaats-alerts-open-pricing">${ALERTS_TEXT.accountPricingLink}</button>
        <div class="cleanplaats-alerts-footer">
            <button class="cleanplaats-alerts-text-btn cleanplaats-alerts-text-btn-danger" id="cleanplaats-alerts-logout">${ALERTS_TEXT.logout}</button>
        </div>
    `);

    wireAlertsBackButton();
    wireAlertsLogout();
    document.getElementById('cleanplaats-alerts-open-pricing').onclick = renderAlertsPricingView;
}

function buildPricingPlanHtml({ name, priceLabel, current, soon, features }) {
    return `
        <div class="cleanplaats-alerts-plan ${current ? 'cleanplaats-alerts-plan-current' : ''}">
            <div class="cleanplaats-alerts-plan-head">
                <span class="cleanplaats-alerts-plan-name">${name}</span>
                ${current ? `<span class="cleanplaats-alerts-plan-badge">${ALERTS_TEXT.pricingCurrentPlan}</span>` : ''}
                ${soon ? `<span class="cleanplaats-alerts-plan-badge cleanplaats-alerts-plan-badge-soon">${ALERTS_TEXT.upgradeSoon}</span>` : ''}
            </div>
            <div class="cleanplaats-alerts-plan-price">${priceLabel}</div>
            <ul class="cleanplaats-alerts-plan-features">
                ${features.map(feature => `<li>${alertIcon('check', 14)}<span>${feature}</span></li>`).join('')}
            </ul>
        </div>
    `;
}

function renderAlertsPricingView() {
    const me = cleanplaatsAlertsRuntime.me;
    if (!me || !me.plans) {
        loadAlertsDashboard();
        return;
    }

    const free = me.plans.free;
    const premium = me.plans.premium;
    // Everything that is free stays free in premium too, so the paid column
    // repeats it rather than looking thinner than the free one.
    const sharedFeatures = [
        ALERTS_TEXT.pricingFeatureTelegram,
        ALERTS_TEXT.pricingFeatureOneClick,
        ALERTS_TEXT.pricingFeatureFilters,
        ALERTS_TEXT.pricingFeatureBlocklist,
        ALERTS_TEXT.pricingFeatureFeed
    ];

    const upgradeAction = me.upgradeInterestRegistered
        ? `<div class="cleanplaats-alerts-upgrade-done">${alertIcon('check', 14)}${ALERTS_TEXT.upgradeRegistered}</div>`
        : `<button type="button" class="cleanplaats-alerts-primary-btn cleanplaats-alerts-block-btn" id="cleanplaats-alerts-upgrade-btn" data-source="pricing">${ALERTS_TEXT.upgradeButton}</button>`;

    setAlertsBody(`
        ${alertsViewHeader(ALERTS_TEXT.pricingTitle, ALERTS_TEXT.pricingIntro)}
        <div class="cleanplaats-alerts-plans">
            ${buildPricingPlanHtml({
                name: ALERTS_TEXT.pricingFree,
                priceLabel: `€ 0 <span class="cleanplaats-alerts-plan-period">${ALERTS_TEXT.upgradePerMonth}</span>`,
                current: me.tier !== 'premium',
                soon: false,
                features: [
                    ALERTS_TEXT.pricingFeatureAlerts(free.maxAlerts),
                    ALERTS_TEXT.pricingFeatureInterval(free.intervalMinutes),
                    ALERTS_TEXT.pricingFeatureValidity(free.validDays),
                    ...sharedFeatures
                ]
            })}
            ${buildPricingPlanHtml({
                name: ALERTS_TEXT.pricingPremium,
                priceLabel: `${ALERTS_TEXT.upgradePrice(premium.priceEur)} <span class="cleanplaats-alerts-plan-period">${ALERTS_TEXT.upgradePerMonth}</span>`,
                current: me.tier === 'premium',
                soon: !premium.available && me.tier !== 'premium',
                features: [
                    ALERTS_TEXT.pricingFeatureAlerts(premium.maxAlerts),
                    ALERTS_TEXT.pricingFeatureInterval(premium.intervalMinutes),
                    ALERTS_TEXT.pricingFeatureValidity(premium.validDays),
                    ...sharedFeatures
                ]
            })}
        </div>
        ${me.tier === 'premium' ? '' : upgradeAction}
    `);

    wireAlertsBackButton();
    wireAlertsUpgradeButton();
}

/**
 * Reached by trying to create one alert too many, which is the moment the
 * ceiling is worth explaining. Lists the running searches with their delete
 * buttons so the way out is right here, and says what premium would change
 * without pretending it can be bought yet.
 */
function renderAlertsLimitView(alerts) {
    const me = cleanplaatsAlertsRuntime.me;
    if (!me) {
        loadAlertsDashboard();
        return;
    }

    const premium = me.plans?.premium;
    const free = me.plans?.free;
    const premiumBlock = (premium && free && me.tier !== 'premium') ? `
        <div class="cleanplaats-alerts-limit-premium">
            <div class="cleanplaats-alerts-limit-premium-head">
                <span class="cleanplaats-alerts-limit-premium-icon">${alertIcon('zap', 16)}</span>
                <span class="cleanplaats-alerts-limit-premium-title">${ALERTS_TEXT.limitPremiumTitle}</span>
                <span class="cleanplaats-alerts-plan-badge cleanplaats-alerts-plan-badge-soon">${ALERTS_TEXT.upgradeSoon}</span>
            </div>
            <p class="cleanplaats-alerts-limit-premium-body">${ALERTS_TEXT.limitPremiumBody(premium, free)}</p>
            <button type="button" class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-open-pricing">${ALERTS_TEXT.accountPricingLink}</button>
        </div>
    ` : '';

    const items = alerts.map(alert => `
        <div class="cleanplaats-alerts-limit-item" data-alert-id="${alert.id}">
            <span class="cleanplaats-alerts-limit-item-label">${escapeAlertText(alert.label)}</span>
            <span class="cleanplaats-alerts-limit-item-meta">${ALERTS_TEXT.matchCount(alert.match_count || 0)}</span>
            <button class="cleanplaats-alerts-delete" data-alert-id="${alert.id}" title="${ALERTS_TEXT.deleteButton}" aria-label="${ALERTS_TEXT.deleteButton}">${alertIcon('trash', 15)}</button>
        </div>
    `).join('');

    setAlertsBody(`
        ${alertsViewHeader(ALERTS_TEXT.limitTitle)}
        <div class="cleanplaats-alerts-limit-meter">
            <span class="cleanplaats-alerts-limit-count">${me.alertCount || alerts.length} / ${me.maxAlerts}</span>
            <span class="cleanplaats-alerts-limit-count-label">${ALERTS_TEXT.limitUsage(me.alertCount || alerts.length, me.maxAlerts)}</span>
        </div>
        <p class="cleanplaats-alerts-limit-body">${ALERTS_TEXT.limitBody(me.maxAlerts)}</p>
        <div class="cleanplaats-alerts-section-title">${ALERTS_TEXT.limitListTitle}</div>
        <div class="cleanplaats-alerts-limit-list">${items}</div>
        ${premiumBlock}
    `);

    wireAlertsBackButton();
    document.getElementById('cleanplaats-alerts-open-pricing')?.addEventListener('click', renderAlertsPricingView);

    // Deleting from here should land back on the dashboard with room to spare,
    // rather than leaving someone on a limit screen that no longer applies.
    document.querySelectorAll('.cleanplaats-alerts-limit-list .cleanplaats-alerts-delete').forEach(button => {
        button.onclick = () => {
            if (!window.confirm(ALERTS_TEXT.deleteConfirm)) return;
            button.disabled = true;
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, { method: 'DELETE' })
                .then(() => {
                    showBubbleNotification(ALERTS_TEXT.limitFreedToast);
                    loadAlertsDashboard();
                })
                .catch(error => {
                    button.disabled = false;
                    showBubbleNotification((error && error.message) || ALERTS_TEXT.errorToast);
                });
        };
    });
}

function wireAlertsLogout() {
    const logout = document.getElementById('cleanplaats-alerts-logout');
    if (!logout) return;
    logout.onclick = () => {
        alertsApiFetch('/api/auth/logout', { method: 'POST' })
            .catch(() => {})
            .then(() => storeAlertsToken(''))
            .then(() => {
                cleanplaatsAlertsRuntime.me = null;
                renderAlertsLoginView();
            });
    };
}

function wireAlertsUpgradeButton() {
    const button = document.getElementById('cleanplaats-alerts-upgrade-btn');
    if (!button) return;
    button.onclick = () => {
        button.disabled = true;
        button.textContent = ALERTS_TEXT.upgradeSending;
        alertsApiFetch('/api/upgrade-interest', {
            method: 'POST',
            body: JSON.stringify({ source: button.dataset.source })
        }).then(() => {
            if (cleanplaatsAlertsRuntime.me) {
                cleanplaatsAlertsRuntime.me.upgradeInterestRegistered = true;
            }
            const done = document.createElement('div');
            done.className = 'cleanplaats-alerts-upgrade-done';
            done.innerHTML = DOMPurify.sanitize(`${alertIcon('check', 14)}${ALERTS_TEXT.upgradeRegistered}`);
            button.replaceWith(done);
            showBubbleNotification(ALERTS_TEXT.upgradeToast);
        }).catch(error => {
            button.disabled = false;
            button.textContent = ALERTS_TEXT.upgradeButton;
            showBubbleNotification((error && error.message) || ALERTS_TEXT.errorToast);
        });
    };
}

/* ===== Dashboard ===== */

function loadAlertsDashboard() {
    const body = setAlertsBody(`<div class="cleanplaats-alerts-loading">${ALERTS_TEXT.loading}</div>`);
    if (!body) return;

    syncAlertFilters();

    Promise.all([
        alertsApiFetch('/api/me'),
        alertsApiFetch('/api/alerts'),
        alertsApiFetch('/api/matches')
    ]).then(([me, alertsData, matchesData]) => {
        cleanplaatsAlertsRuntime.me = me;
        // Only the first load of this panel session decides the cut-off; every
        // refresh after that keeps it, so pressing refresh never clears badges
        // the user hasn't actually looked at yet.
        if (cleanplaatsAlertsRuntime.matchesSeenAt === null) {
            cleanplaatsAlertsRuntime.matchesSeenAt = matchesData.matchesSeenAt || 0;
        }
        renderAlertsDashboard(me, alertsData.alerts || [], matchesData.matches || []);
    }).catch(error => {
        if (error.status === 401) {
            storeAlertsToken('').then(() => renderAlertsLoginView());
            return;
        }
        console.error('Cleanplaats: Failed to load alerts', error);
        setAlertsBody(`<div class="cleanplaats-alerts-loading">${ALERTS_TEXT.errorToast}</div>`);
    });
}

function renderAlertsDashboard(me, alerts, matches) {
    const context = getAlertSearchContext();
    const tierLabel = me.tier === 'premium' ? ALERTS_TEXT.tierPremium : ALERTS_TEXT.tierFree;

    // Clickable: it already shows account facts, so it is the natural way into
    // the rest of them. The header button does the same for anyone who has
    // scrolled past it.
    const accountBar = `
        <button type="button" class="cleanplaats-alerts-account cleanplaats-alerts-account-link" id="cleanplaats-alerts-account-bar" aria-label="${ALERTS_TEXT.accountOpen}">
            <div class="cleanplaats-alerts-account-meta">
                <span class="cleanplaats-alerts-account-mail">${alertIcon('mail', 13)}<span class="cleanplaats-alerts-account-email" title="${escapeAlertText(me.email)}">${escapeAlertText(me.email)}</span></span>
                <span class="cleanplaats-alerts-tier cleanplaats-alerts-tier-${me.tier === 'premium' ? 'premium' : 'free'}">${tierLabel}</span>
            </div>
            <div class="cleanplaats-alerts-account-main">
                <span class="cleanplaats-alerts-usage">
                    <span class="cleanplaats-alerts-usage-value">${me.alertCount || 0}<span class="cleanplaats-alerts-usage-max"> / ${me.maxAlerts}</span></span>
                    <span class="cleanplaats-alerts-usage-label">${ALERTS_TEXT.usageLabel}</span>
                </span>
                <span class="cleanplaats-alerts-freq">${alertIcon('clock', 15)}<span>${ALERTS_TEXT.checkFrequency(me.intervalMinutes)}</span></span>
            </div>
            <span class="cleanplaats-alerts-account-chevron" aria-hidden="true">${alertIcon('chevron', 16)}</span>
        </button>
    `;

    // The create box stays even at the limit. Replacing it with a notice hides
    // the feature behind a rule nobody has hit yet; letting someone type a term
    // and press the button puts the limit in front of them at the moment they
    // actually want something, which is where it can be explained properly.
    const createSection = `
        <div class="cleanplaats-alerts-create">
            <div class="cleanplaats-alerts-create-title">${ALERTS_TEXT.createTitle}</div>
            <div class="cleanplaats-alerts-form-row">
                <input type="text" id="cleanplaats-alert-label-input" value="${context ? escapeAlertText(context.suggestedLabel) : ''}" placeholder="${ALERTS_TEXT.labelPlaceholder}" maxlength="120">
                <button id="cleanplaats-alert-create" class="cleanplaats-alerts-primary-btn">＋ ${ALERTS_TEXT.createButton}</button>
            </div>
            ${context ? `<div class="cleanplaats-alerts-create-note" id="cleanplaats-alert-create-note">${ALERTS_TEXT.createContextHint}</div>` : ''}
            <div class="cleanplaats-alerts-create-warning" id="cleanplaats-alert-broad-warning" hidden></div>
        </div>
    `;

    const alertItems = alerts.length === 0
        ? `<div class="cleanplaats-alerts-empty">${ALERTS_TEXT.empty}</div>`
        : alerts.map(alert => {
            const validity = getAlertValidity(alert);
            const statusClass = validity && validity.expired
                ? 'expired'
                : (alert.enabled ? 'active' : 'paused');
            // For a running alert, when the next check lands is the useful
            // fact; how long ago the last one was only matters when nothing
            // is scheduled (paused, or lapsed).
            const isRunning = alert.enabled && !(validity && validity.expired);
            const nextCheck = isRunning && alert.last_checked_at
                ? formatAlertNextCheck(alert.last_checked_at, me.intervalMinutes)
                : '';
            const lastChecked = nextCheck || (alert.last_checked_at
                ? `${ALERTS_TEXT.lastChecked}: ${formatAlertRelativeTime(alert.last_checked_at)}`
                : ALERTS_TEXT.neverChecked);
            const labelHtml = alert.search_url
                ? `<a href="${escapeAlertText(alert.search_url)}" class="cleanplaats-alerts-card-label">${escapeAlertText(alert.label)}</a>`
                : `<span class="cleanplaats-alerts-card-label">${escapeAlertText(alert.label)}</span>`;

            let validityHtml = '';
            if (validity) {
                if (validity.expired) {
                    validityHtml = ` · <span class="cleanplaats-alerts-validity cleanplaats-alerts-validity-expired">${ALERTS_TEXT.validityExpired}</span>`;
                } else {
                    const soonClass = validity.soon ? ' cleanplaats-alerts-validity-soon' : '';
                    validityHtml = ` · <span class="cleanplaats-alerts-validity${soonClass}">${ALERTS_TEXT.validityLeft(validity.daysLeft)}</span>`;
                }
            }

            // Expired alerts can only come back via Reactiveren (which resets the
            // window); re-enabling with the plain switch would just re-lapse next
            // poll, so the status switch is replaced. Active alerts get a subtle
            // Verleng nudge only in their final days.
            const extendBtn = validity && validity.expired
                ? `<button class="cleanplaats-alerts-extend-btn cleanplaats-alerts-extend-btn-primary" data-alert-id="${alert.id}" data-extend="1">${ALERTS_TEXT.reactivateButton}</button>`
                : (validity && validity.soon
                    ? `<button class="cleanplaats-alerts-extend-btn" data-alert-id="${alert.id}" data-extend="1">${ALERTS_TEXT.extendButton}</button>`
                    : '');
            const statusSwitch = validity && validity.expired
                ? ''
                : `<button class="cleanplaats-alerts-switch cleanplaats-alerts-switch-status ${alert.enabled ? 'on' : ''}" data-alert-id="${alert.id}" data-enabled="${alert.enabled ? '1' : '0'}" role="switch" aria-checked="${alert.enabled ? 'true' : 'false'}">
                                <span class="cleanplaats-alerts-switch-label">${alert.enabled ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel}</span><span class="cleanplaats-alerts-switch-track"></span>
                            </button>`;

            // Telegram has no value until an account is linked. Until then the
            // toggle is "locked": it can't be switched on (that would set a flag
            // nothing reads), and clicking it starts the connect-Telegram flow.
            const telegramSwitch = me.telegramLinked
                ? `<button class="cleanplaats-alerts-switch ${alert.notify_telegram ? 'on' : ''}" data-channel="telegram" data-alert-id="${alert.id}" data-value="${alert.notify_telegram ? '1' : '0'}" role="switch" aria-checked="${alert.notify_telegram ? 'true' : 'false'}">
                                ${alertIcon('send', 14)}<span class="cleanplaats-alerts-switch-label">${ALERTS_TEXT.channelTelegram}</span><span class="cleanplaats-alerts-switch-track"></span>
                            </button>`
                : `<button class="cleanplaats-alerts-switch cleanplaats-alerts-switch-locked" data-channel="telegram" data-alert-id="${alert.id}" data-locked="1" type="button" aria-label="${ALERTS_TEXT.telegramLockedHint}" data-tip="${ALERTS_TEXT.telegramLockedHint}">
                                ${alertIcon('send', 14)}<span class="cleanplaats-alerts-switch-label">${ALERTS_TEXT.channelTelegram}</span><span class="cleanplaats-alerts-switch-track"></span>
                            </button>`;

            return `
                <div class="cleanplaats-alerts-alert cleanplaats-alerts-alert-${statusClass}" data-alert-id="${alert.id}">
                    <div class="cleanplaats-alerts-alert-top">
                        <span class="cleanplaats-alerts-status-dot"></span>
                        ${labelHtml}
                        <span class="cleanplaats-alerts-match-badge">${ALERTS_TEXT.matchCount(alert.match_count || 0)}</span>
                    </div>
                    <div class="cleanplaats-alerts-alert-bottom">
                        <span class="cleanplaats-alerts-meta">${lastChecked}${validityHtml}</span>
                        <span class="cleanplaats-alerts-alert-actions">
                            ${telegramSwitch}
                            ${statusSwitch}
                            ${extendBtn}
                            <button class="cleanplaats-alerts-delete" data-alert-id="${alert.id}" title="${ALERTS_TEXT.deleteButton}" aria-label="${ALERTS_TEXT.deleteButton}">${alertIcon('trash', 15)}</button>
                        </span>
                    </div>
                    ${buildAlertFilterBlockHtml(alert)}
                </div>
            `;
        }).join('');

    // Kept so the limit view can list the running searches without refetching.
    cleanplaatsAlertsRuntime.cachedAlerts = alerts;
    cleanplaatsAlertsRuntime.cachedMatches = matches;
    const matchItems = renderAlertMatchItems(sortAlertMatches(matches, 'newest'));

    // Only rendered inside channelsSection, which requires a linked account.
    const telegramActions = `
        <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alert-telegram-relink">${ALERTS_TEXT.telegramRelink}</button>
        <button class="cleanplaats-alerts-text-btn cleanplaats-alerts-text-btn-danger" id="cleanplaats-alert-telegram-unlink">${ALERTS_TEXT.telegramUnlink}</button>`;

    // Only worth showing once Telegram is linked: before that the notice at the
    // top already carries the same "Koppelen" button, and this row would just
    // repeat it.
    const channelsSection = !me.telegramLinked ? '' : `
        <div class="cleanplaats-alerts-section-title">${ALERTS_TEXT.channelsTitle}</div>
        <div class="cleanplaats-alerts-channel-list">
            <div class="cleanplaats-alerts-channel-row">
                <span class="cleanplaats-alerts-channel-icon ${me.telegramLinked ? 'on' : ''}">${alertIcon('send', 18)}</span>
                <span class="cleanplaats-alerts-channel-info">
                    <span class="cleanplaats-alerts-channel-name">${ALERTS_TEXT.channelTelegram}</span>
                    <span class="cleanplaats-alerts-channel-sub ${me.telegramLinked ? 'cleanplaats-alerts-channel-sub-on' : ''}">${me.telegramLinked ? ALERTS_TEXT.telegramLinked : ALERTS_TEXT.telegramNotLinked}</span>
                </span>
                <span class="cleanplaats-alerts-channel-actions">${telegramActions}</span>
            </div>
        </div>
    `;

    // Telegram is the only channel that pushes anything out, so an unlinked
    // account silently receives nothing. Lead with that rather than letting
    // someone create alerts and wonder why it stays quiet.
    const telegramRequiredNotice = me.telegramLinked ? '' : `
        <div class="cleanplaats-alerts-notice">
            <span class="cleanplaats-alerts-notice-icon">${alertIcon('send', 18)}</span>
            <span class="cleanplaats-alerts-notice-info">
                <span class="cleanplaats-alerts-notice-title">${ALERTS_TEXT.telegramRequiredTitle}</span>
                <span class="cleanplaats-alerts-notice-body">${ALERTS_TEXT.telegramRequiredBody}</span>
            </span>
            <button id="cleanplaats-alert-telegram-link-notice" class="cleanplaats-alerts-secondary-btn">${ALERTS_TEXT.telegramRequiredButton}</button>
        </div>
    `;

    setAlertsBody(`
        ${accountBar}
        ${telegramRequiredNotice}
        ${createSection}
        <div class="cleanplaats-alerts-section-title">${ALERTS_TEXT.listTitle}</div>
        <div class="cleanplaats-alerts-list">${alertItems}</div>
        ${channelsSection}
        <div class="cleanplaats-alerts-section-header">
            <span class="cleanplaats-alerts-section-title">${ALERTS_TEXT.matchesTitle}</span>
            <select id="cleanplaats-alerts-sort" class="cleanplaats-alerts-sort-select">
                <option value="newest">${ALERTS_TEXT.sortNewest}</option>
                <option value="price_asc">${ALERTS_TEXT.sortPriceAsc}</option>
                <option value="price_desc">${ALERTS_TEXT.sortPriceDesc}</option>
            </select>
        </div>
        <div class="cleanplaats-alerts-matches" id="cleanplaats-alerts-matches-list">${matchItems}</div>
        <div class="cleanplaats-alerts-footer">
            <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-open-pricing">${ALERTS_TEXT.accountPricingLink}</button>
        </div>
    `);

    wireAlertsDashboardEvents();
    warnWhenSearchIsBroad(context);
    setAlertsRefreshVisible(true);
    setAlertsAccountVisible(true);
    storeAlertsSummary(alerts, matches);
    maybeRunAlertsWalkthrough(me, alerts);
}

// Roughly where a search stops making a useful alert. A well-aimed query sits
// far below it ("macbook air m1": 339, "eames stoel": 1.486), while the ones
// that bury you in notifications sit far above ("playstation 5": 20.033,
// "iphone": 40.204, "stoel": 337.959).
var CLEANPLAATS_ALERTS_BROAD_RESULT_COUNT = 5000;

/**
 * Warns before the fact when the current search is so broad that the alert
 * would fire constantly. Runs after render and stays silent on any failure:
 * a missing count is no reason to hold up the dashboard.
 */
function warnWhenSearchIsBroad(context) {
    const element = document.getElementById('cleanplaats-alert-broad-warning');
    if (!element || !context || !context.searchParams) return;

    const params = new URLSearchParams({ limit: '1', offset: '0' });
    Object.entries(context.searchParams).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach(item => params.append(`${key}[]`, item));
        else params.set(key, value);
    });

    // Same-origin on every supported site, so this rides along on the session
    // the user already has.
    fetch(`/lrp/api/search?${params.toString()}`, { headers: { 'Accept': 'application/json' } })
        .then(response => (response.ok ? response.json() : null))
        .then(data => {
            const count = data && data.totalResultCount;
            if (!Number.isFinite(count) || count < CLEANPLAATS_ALERTS_BROAD_RESULT_COUNT) return;
            element.textContent = ALERTS_TEXT.createBroadWarning(count);
            element.hidden = false;
        })
        .catch(() => {});
}

function wireAlertsDashboardEvents() {
    const body = document.getElementById('cleanplaats-alerts-body');
    if (!body) return;

    document.getElementById('cleanplaats-alerts-account-bar')?.addEventListener('click', renderAlertsAccountView);
    const pricingLink = document.getElementById('cleanplaats-alerts-open-pricing');
    if (pricingLink) pricingLink.onclick = renderAlertsPricingView;

    const createButton = document.getElementById('cleanplaats-alert-create');
    if (createButton) {
        const labelInput = document.getElementById('cleanplaats-alert-label-input');
        const createNote = document.getElementById('cleanplaats-alert-create-note');
        const suggestedTerm = (labelInput?.value || '').trim().toLowerCase();
        if (labelInput && createNote) {
            labelInput.addEventListener('input', () => {
                createNote.style.display =
                    labelInput.value.trim().toLowerCase() === suggestedTerm ? '' : 'none';
            });
        }

        createButton.onclick = () => {
            const term = (labelInput?.value || '').trim();
            if (!term) {
                showBubbleNotification(ALERTS_TEXT.createTermMissing);
                if (labelInput) labelInput.focus();
                return;
            }

            // Out of room: explain the ceiling here rather than firing a
            // request we know the server will refuse.
            const me = cleanplaatsAlertsRuntime.me;
            if (me && (me.alertCount || 0) >= me.maxAlerts) {
                renderAlertsLimitView(cleanplaatsAlertsRuntime.cachedAlerts || []);
                return;
            }

            // Reuse the page's search context (category/location filters)
            // only while the term still matches it; an edited term is a new,
            // plain search.
            const context = getAlertSearchContext();
            const usesContext = Boolean(context) &&
                term.toLowerCase() === context.suggestedLabel.trim().toLowerCase();
            const searchParams = usesContext
                ? context.searchParams
                : { query: term, searchInTitleAndDescription: 'true' };
            const searchUrl = usesContext
                ? context.searchUrl
                : `https://www.marktplaats.nl/q/${encodeURIComponent(term).replace(/%20/g, '+')}/`;

            createButton.disabled = true;
            alertsApiFetch('/api/alerts', {
                method: 'POST',
                body: JSON.stringify({ label: term, searchParams, searchUrl, filters: getDefaultAlertFilters() })
            }).then(() => {
                showBubbleNotification(ALERTS_TEXT.createdToast);
                loadAlertsDashboard();
            }).catch(error => {
                createButton.disabled = false;
                // 403 is the server's own limit check — reachable when this
                // device's count is stale (another browser added one).
                if (error.status === 403) {
                    renderAlertsLimitView(cleanplaatsAlertsRuntime.cachedAlerts || []);
                    return;
                }
                showBubbleNotification(error.message || ALERTS_TEXT.errorToast);
            });
        };
    }

    body.querySelectorAll('.cleanplaats-alerts-delete').forEach(button => {
        button.onclick = () => {
            if (!window.confirm(ALERTS_TEXT.deleteConfirm)) return;
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, { method: 'DELETE' })
                .then(() => {
                    showBubbleNotification(ALERTS_TEXT.deletedToast);
                    loadAlertsDashboard();
                })
                .catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });

    body.querySelectorAll('.cleanplaats-alerts-switch-status').forEach(button => {
        button.onclick = () => {
            const nextEnabled = button.dataset.enabled !== '1';
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: nextEnabled })
            }).then(() => {
                button.dataset.enabled = nextEnabled ? '1' : '0';
                button.setAttribute('aria-checked', String(nextEnabled));
                button.classList.toggle('on', nextEnabled);
                const label = button.querySelector('.cleanplaats-alerts-switch-label');
                if (label) label.textContent = nextEnabled ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel;
                const card = button.closest('.cleanplaats-alerts-alert');
                if (card) {
                    card.classList.toggle('cleanplaats-alerts-alert-active', nextEnabled);
                    card.classList.toggle('cleanplaats-alerts-alert-paused', !nextEnabled);
                }
            }).catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });

    body.querySelectorAll('.cleanplaats-alerts-extend-btn').forEach(button => {
        button.onclick = () => {
            const wasExpired = button.classList.contains('cleanplaats-alerts-extend-btn-primary');
            button.disabled = true;
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ extend: true })
            }).then(() => {
                showBubbleNotification(wasExpired ? ALERTS_TEXT.reactivatedToast : ALERTS_TEXT.extendedToast);
                loadAlertsDashboard();
            }).catch(() => {
                button.disabled = false;
                showBubbleNotification(ALERTS_TEXT.errorToast);
            });
        };
    });

    body.querySelectorAll('.cleanplaats-alerts-switch[data-channel]').forEach(button => {
        button.onclick = () => {
            // A locked Telegram toggle (no account linked yet) can't carry a
            // setting, so clicking it kicks off the connect flow instead.
            if (button.dataset.locked === '1') {
                startTelegramLink();
                return;
            }
            const next = button.dataset.value !== '1';
            // Telegram is the only channel with a switch; the e-mail one is gone
            // while server-side e-mail notifications are off.
            const field = 'notifyTelegram';
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ [field]: next })
            }).then(() => {
                button.dataset.value = next ? '1' : '0';
                button.setAttribute('aria-checked', String(next));
                button.classList.toggle('on', next);
            }).catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });

    // Both "Koppelen" and "Ander account koppelen" open the same step-by-step
    // connect screen; the bot hands out a code and the user types it back here.
    // (This runs in wireAlertsDashboardEvents, which has no `me` in scope — read
    // it from the runtime, which loadAlertsDashboard populated.)
    const startTelegramLink = () => renderTelegramConnect(cleanplaatsAlertsRuntime.me);

    // "Koppelen" and "Ander account koppelen" are the same flow: the user
    // messages the bot, gets a code, and types it back to claim the chat.
    ['cleanplaats-alert-telegram-link-notice', 'cleanplaats-alert-telegram-relink'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.onclick = startTelegramLink;
    });

    const telegramUnlinkButton = document.getElementById('cleanplaats-alert-telegram-unlink');
    if (telegramUnlinkButton) {
        telegramUnlinkButton.onclick = () => {
            if (!window.confirm(ALERTS_TEXT.telegramUnlinkConfirm)) return;
            alertsApiFetch('/api/telegram/unlink', { method: 'POST' })
                .then(() => {
                    showBubbleNotification(ALERTS_TEXT.telegramUnlinkedToast);
                    loadAlertsDashboard();
                })
                .catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    }

    wireAlertMatchLinks(body);

    const sortSelect = document.getElementById('cleanplaats-alerts-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            const matchesList = document.getElementById('cleanplaats-alerts-matches-list');
            if (!matchesList || !cleanplaatsAlertsRuntime.cachedMatches) return;
            const sorted = sortAlertMatches(cleanplaatsAlertsRuntime.cachedMatches, sortSelect.value);
            matchesList.innerHTML = DOMPurify.sanitize(renderAlertMatchItems(sorted));
            wireAlertMatchLinks(matchesList);
        });
    }

    wireAlertFilterControls(body);
}

function wireAlertFilterControls(body) {
    // Expand/collapse a card's filter editor.
    body.querySelectorAll('.cleanplaats-alerts-filter-trigger').forEach(trigger => {
        trigger.addEventListener('click', () => {
            const block = trigger.closest('.cleanplaats-alerts-filter-block');
            const editor = block?.querySelector('.cleanplaats-alerts-filter-editor');
            if (!editor) return;
            const isOpen = !editor.hasAttribute('hidden');
            if (isOpen) {
                editor.setAttribute('hidden', '');
            } else {
                editor.removeAttribute('hidden');
            }
            trigger.setAttribute('aria-expanded', String(!isOpen));
            block.classList.toggle('cleanplaats-alerts-filter-block-open', !isOpen);
        });
    });

    // Toggling a per-alert filter checkbox: persist just that alert's filters.
    body.querySelectorAll('.cleanplaats-alerts-filter-opt input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const alertId = checkbox.dataset.alertId;
            const block = checkbox.closest('.cleanplaats-alerts-filter-block');
            if (!block) return;

            const filters = {};
            block.querySelectorAll('.cleanplaats-alerts-filter-opt input[type="checkbox"]').forEach(cb => {
                filters[cb.dataset.filterKey] = cb.checked;
            });

            // Update the collapsed summary count immediately.
            const activeCount = Object.values(filters).filter(Boolean).length;
            const countEl = block.querySelector('.cleanplaats-alerts-filter-count');
            if (countEl) {
                if (activeCount > 0) {
                    countEl.textContent = ALERTS_TEXT.filterCountActive(activeCount);
                    countEl.classList.remove('cleanplaats-alerts-filter-count-zero');
                } else {
                    countEl.textContent = ALERTS_TEXT.filterNoneActive;
                    countEl.classList.add('cleanplaats-alerts-filter-count-zero');
                }
            }

            checkbox.disabled = true;
            alertsApiFetch(`/api/alerts/${alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ filters })
            }).then(() => {
                checkbox.disabled = false;
            }).catch(() => {
                checkbox.disabled = false;
                checkbox.checked = !checkbox.checked;
                showBubbleNotification(ALERTS_TEXT.errorToast);
            });
        });
    });
}

function wireAlertMatchLinks(container) {
    (container || document).querySelectorAll('.cleanplaats-alerts-match, .cleanplaats-alerts-card-label[href]').forEach(link => {
        if (!link.getAttribute('href')) return;
        link.addEventListener('click', event => {
            event.preventDefault();
            window.open(link.href, '_blank', 'noopener,noreferrer');
        });
    });
}

/* ===== Begeleide eerste melding =====
   An opt-in walkthrough, started from the panel card. It points at what is
   actually on screen rather than replaying a fixed script: the create box is
   skipped when the account is at its limit, and the Telegram step changes
   depending on whether an account is already linked.

   The steps highlight and annotate; they never dim the page. A scrim would
   have to sit inside the overlay card, and lifting a target out of it means
   fighting the stacking contexts the dashboard already creates. */

var ALERTS_WALKTHROUGH_TEXT = {
    skip: 'Overslaan',
    next: 'Volgende',
    done: 'Aan de slag',
    counter: (index, total) => `${index} van ${total}`,
    loginTitle: 'Eerst een account',
    loginBody: 'Je e-mailadres is je account. Je krijgt er een inlogcode op, dus er is geen wachtwoord om te onthouden.',
    createTitle: 'Maak je eerste melding',
    createBody: 'Je huidige zoekopdracht staat al ingevuld, mét de filters die je nu gebruikt. Eén klik en Cleanplaats zoekt vanaf nu voor je door.',
    createBodyPlain: 'Vul hier een zoekterm in. Doe je dit vanaf een zoekresultatenpagina, dan staan je zoekopdracht en filters er meteen klaar.',
    telegramTitle: 'Koppel Telegram',
    telegramBody: 'Je meldingen komen binnen via Telegram, ook als je browser dicht is. Zonder koppeling blijft het stil.',
    telegramLinkedTitle: 'Zo ontvang je ze',
    telegramLinkedBody: 'Telegram is gekoppeld. Per melding kun je hier aan- en uitzetten of je er bericht van krijgt.',
    matchesTitle: 'Alles komt hier binnen',
    matchesBody: 'Elke gevonden advertentie verschijnt in deze lijst, met NIEUW ernaast zolang je hem nog niet bekeken hebt.'
};

function isAlertsWalkthroughArmed() {
    return Boolean(cleanplaatsAlertsRuntime.walkthroughRequested);
}

function markAlertsWalkthroughDone() {
    if (typeof CLEANPLAATS === 'undefined' || !CLEANPLAATS.settings) return;
    if (CLEANPLAATS.settings.alertsWalkthroughDone) return;
    CLEANPLAATS.settings.alertsWalkthroughDone = true;
    if (typeof saveSettings === 'function') {
        saveSettings().catch(error => {
            console.error('Cleanplaats: Failed to store walkthrough state', error);
        });
    }
}

/** One coach mark on the login view, so the tour doesn't start mid-flow. */
function maybeRunAlertsLoginWalkthrough() {
    if (!isAlertsWalkthroughArmed()) return;
    startAlertsWalkthrough([{
        selector: '#cleanplaats-alerts-email-input',
        title: ALERTS_WALKTHROUGH_TEXT.loginTitle,
        body: ALERTS_WALKTHROUGH_TEXT.loginBody
    }], { keepArmed: true });
}

function maybeRunAlertsWalkthrough(me, alerts) {
    if (!isAlertsWalkthroughArmed()) return;

    const steps = [];

    if (document.getElementById('cleanplaats-alert-label-input')) {
        const hasContext = Boolean(getAlertSearchContext());
        steps.push({
            selector: '.cleanplaats-alerts-create',
            title: ALERTS_WALKTHROUGH_TEXT.createTitle,
            body: hasContext ? ALERTS_WALKTHROUGH_TEXT.createBody : ALERTS_WALKTHROUGH_TEXT.createBodyPlain
        });
    }

    if (me.telegramLinked) {
        steps.push({
            selector: '.cleanplaats-alerts-channel-list',
            title: ALERTS_WALKTHROUGH_TEXT.telegramLinkedTitle,
            body: ALERTS_WALKTHROUGH_TEXT.telegramLinkedBody
        });
    } else {
        steps.push({
            selector: '.cleanplaats-alerts-notice',
            title: ALERTS_WALKTHROUGH_TEXT.telegramTitle,
            body: ALERTS_WALKTHROUGH_TEXT.telegramBody
        });
    }

    // Pointless to promise a feed to someone whose first alert hasn't run yet
    // — the list is still the empty state at this point.
    if (alerts.length > 0) {
        steps.push({
            selector: '#cleanplaats-alerts-matches-list',
            title: ALERTS_WALKTHROUGH_TEXT.matchesTitle,
            body: ALERTS_WALKTHROUGH_TEXT.matchesBody
        });
    }

    startAlertsWalkthrough(steps);
}

function startAlertsWalkthrough(steps, options = {}) {
    const usable = steps.filter(step => document.querySelector(step.selector));
    if (usable.length === 0) {
        if (!options.keepArmed) endAlertsWalkthrough();
        return;
    }

    clearAlertsWalkthroughUI();
    cleanplaatsAlertsRuntime.walkthroughSteps = usable;
    cleanplaatsAlertsRuntime.walkthroughIndex = 0;
    // A login coach mark is a waypoint, not the tour: staying armed lets the
    // real steps run once the dashboard loads.
    cleanplaatsAlertsRuntime.walkthroughKeepArmed = Boolean(options.keepArmed);
    showAlertsWalkthroughStep(0);
}

function showAlertsWalkthroughStep(index) {
    const steps = cleanplaatsAlertsRuntime.walkthroughSteps || [];
    const step = steps[index];
    if (!step) {
        endAlertsWalkthrough();
        return;
    }

    const target = document.querySelector(step.selector);
    if (!target) {
        showAlertsWalkthroughStep(index + 1);
        return;
    }

    clearAlertsWalkthroughUI();
    cleanplaatsAlertsRuntime.walkthroughIndex = index;
    target.classList.add('cleanplaats-alerts-walk-target');
    cleanplaatsAlertsRuntime.walkthroughTarget = target;

    const isLast = index === steps.length - 1;
    const bubble = document.createElement('div');
    bubble.className = 'cleanplaats-alerts-walk-bubble';
    bubble.id = 'cleanplaats-alerts-walk-bubble';
    bubble.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-alerts-walk-title">${escapeAlertText(step.title)}</div>
        <div class="cleanplaats-alerts-walk-body">${escapeAlertText(step.body)}</div>
        <div class="cleanplaats-alerts-walk-actions">
            <span class="cleanplaats-alerts-walk-counter">${ALERTS_WALKTHROUGH_TEXT.counter(index + 1, steps.length)}</span>
            <button type="button" class="cleanplaats-alerts-walk-skip" id="cleanplaats-alerts-walk-skip">${ALERTS_WALKTHROUGH_TEXT.skip}</button>
            <button type="button" class="cleanplaats-alerts-walk-next" id="cleanplaats-alerts-walk-next">${isLast ? ALERTS_WALKTHROUGH_TEXT.done : ALERTS_WALKTHROUGH_TEXT.next}</button>
        </div>
    `);
    document.body.appendChild(bubble);

    // Skipping is a decision about the whole tour, so it disarms outright —
    // unlike reaching the end of the login waypoint, which hands over to the
    // dashboard steps.
    document.getElementById('cleanplaats-alerts-walk-skip').onclick = () => endAlertsWalkthrough({ disarm: true });
    document.getElementById('cleanplaats-alerts-walk-next').onclick = () => showAlertsWalkthroughStep(index + 1);

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Let the smooth scroll settle before measuring, otherwise the bubble is
    // placed against the pre-scroll position.
    setTimeout(() => positionAlertsWalkthroughBubble(target, bubble), 320);

    cleanplaatsAlertsRuntime.walkthroughReposition = () => positionAlertsWalkthroughBubble(target, bubble);
    window.addEventListener('resize', cleanplaatsAlertsRuntime.walkthroughReposition);
    document.getElementById('cleanplaats-alerts-body')
        ?.addEventListener('scroll', cleanplaatsAlertsRuntime.walkthroughReposition);
}

function positionAlertsWalkthroughBubble(target, bubble) {
    if (!target.isConnected || !bubble.isConnected) return;

    const rect = target.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const margin = 12;

    // Prefer below the target; flip above when that would run off screen.
    let top = rect.bottom + margin;
    if (top + bubbleRect.height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - bubbleRect.height - margin);
    }

    let left = rect.left + (rect.width - bubbleRect.width) / 2;
    left = Math.min(Math.max(margin, left), window.innerWidth - bubbleRect.width - margin);

    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
    bubble.classList.add('cleanplaats-alerts-walk-bubble-ready');
}

function clearAlertsWalkthroughUI() {
    document.getElementById('cleanplaats-alerts-walk-bubble')?.remove();
    cleanplaatsAlertsRuntime.walkthroughTarget?.classList.remove('cleanplaats-alerts-walk-target');
    cleanplaatsAlertsRuntime.walkthroughTarget = null;

    if (cleanplaatsAlertsRuntime.walkthroughReposition) {
        window.removeEventListener('resize', cleanplaatsAlertsRuntime.walkthroughReposition);
        document.getElementById('cleanplaats-alerts-body')
            ?.removeEventListener('scroll', cleanplaatsAlertsRuntime.walkthroughReposition);
        cleanplaatsAlertsRuntime.walkthroughReposition = null;
    }
}

function endAlertsWalkthrough(options = {}) {
    const wasRunning = Boolean(cleanplaatsAlertsRuntime.walkthroughSteps);
    clearAlertsWalkthroughUI();
    cleanplaatsAlertsRuntime.walkthroughSteps = null;
    cleanplaatsAlertsRuntime.walkthroughIndex = 0;

    // Finishing the login waypoint is a hand-off, not the end of the tour: the
    // dashboard steps still have to run once the account is in. An explicit
    // skip (or closing the panel) overrides that.
    if (cleanplaatsAlertsRuntime.walkthroughKeepArmed && !options.disarm) {
        cleanplaatsAlertsRuntime.walkthroughKeepArmed = false;
        return;
    }

    cleanplaatsAlertsRuntime.walkthroughKeepArmed = false;
    cleanplaatsAlertsRuntime.walkthroughRequested = false;
    if (wasRunning) markAlertsWalkthroughDone();
}
