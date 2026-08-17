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

// Mirrors the LIMIT in the server's /api/matches. Only used to tell the user
// when a list is showing everything versus only the most recent slice; if the
// two ever drift the note is slightly off, nothing breaks.
var ALERT_MATCHES_PAGE_SIZE = 60;

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
    cachedMatches: null,
    // Whatever had focus when the panel opened, so closing it puts focus back.
    returnFocusTo: null,
    // Which of the rail's views is on screen. Starts on the advertisements,
    // since that is what the panel is for; managing searches is the other one.
    view: 'matches',
    // Which alert's match view is on screen, so a slow /api/matches response
    // can tell whether it still has a view to render into.
    openAlertMatchesId: null
};

/**
 * One word per thing, everywhere:
 *   zoekmelding  - what you switch on here (never "melding", never "zoekopdracht")
 *   zoekopdracht - the Marktplaats search it watches
 *   gevonden     - what it turned up
 */
var ALERTS_TEXT = {
    modalTitle: 'Zoekmeldingen',
    tagline: 'Krijg nieuwe advertenties direct in je Telegram, ook als je browser dicht is.',
    intro: 'Krijg een melding zodra er een nieuwe advertentie verschijnt die aan je zoekopdracht voldoet, ook als je browser dicht is. Je Cleanplaats-filters worden automatisch toegepast.',

    // Login: what it does first, the e-mail field second. Asking for an address
    // before showing anything is how you lose people who were only curious.
    loginTitle: 'Zoek verder terwijl je iets anders doet',
    loginIntro: 'Cleanplaats blijft op Marktplaats zoeken zodra jij weg bent, en stuurt je een bericht als er iets nieuws verschijnt.',
    loginBullets: [
        { icon: 'zap', text: 'Bericht binnen enkele minuten nadat een advertentie geplaatst is' },
        { icon: 'send', text: 'Via Telegram, dus ook als je browser dicht is' },
        { icon: 'filter', text: 'Je Cleanplaats-filters en blokkades tellen gewoon mee' }
    ],
    loginFormTitle: 'Maak een account of log in',
    loginFormHint: 'Gratis, en zonder wachtwoord: je krijgt een inlogcode per e-mail.',
    loginPrivacy: 'We gebruiken je e-mailadres om je in te laten loggen en je zoekmeldingen aan te koppelen, verder niets.',
    loginPrivacyLink: 'Privacybeleid',
    loginTermsLink: 'Voorwaarden',
    emailPlaceholder: 'jouw@email.nl',
    emailButton: 'Stuur inlogcode',
    emailSending: 'Versturen…',
    codeSentTo: email => `We hebben een 6-cijferige code gestuurd naar ${email}.`,
    codePlaceholder: '000000',
    codeButton: 'Inloggen',
    codeChecking: 'Controleren…',
    codeResend: 'Stuur nieuwe code',
    codeResending: 'Versturen…',
    codeResent: 'Nieuwe code verstuurd.',
    codeOtherEmail: 'Ander e-mailadres',
    logout: 'Uitloggen',
    logoutHint: 'Je logt alleen op dit apparaat uit. Je zoekmeldingen blijven gewoon doorlopen.',
    tierFree: 'Gratis',
    tierPremium: 'Premium',
    usageLabel: n => (n === 1 ? 'zoekmelding' : 'zoekmeldingen'),
    checkFrequency: m => `Controleert elke ${m} minuten`,
    createTitle: 'Maak een zoekmelding',
    createButton: 'Zoekmelding maken',
    labelPlaceholder: 'Zoekterm, bijv. iphone 15 pro',
    createTermMissing: 'Vul een zoekterm in.',
    createContextHint: 'Filters van je huidige zoekopdracht (categorie, locatie) gaan mee zolang je de zoekterm niet wijzigt.',
    createBroadWarning: count => `Deze zoekopdracht is breed: ${count.toLocaleString('nl-NL')} advertenties. ` +
        'Je krijgt er waarschijnlijk veel meldingen van. Verfijn eerst je zoekopdracht met een prijs, categorie of afstand.',
    listTitle: 'Jouw zoekmeldingen',
    empty: 'Je hebt nog geen zoekmeldingen. Zoek iets op Marktplaats en zet je eerste zoekmelding aan.',
    deleteButton: 'Verwijder',
    deleteConfirmTitle: 'Zoekmelding verwijderen?',
    deleteConfirmBody: label => `"${label}" stopt met zoeken en de gevonden advertenties verdwijnen uit je overzicht.`,
    deleteConfirmOk: 'Verwijderen',
    confirmCancel: 'Annuleren',
    detailsShow: 'Instellingen',
    detailsHide: 'Instellingen',
    pausedLabel: 'Gepauzeerd',
    activeLabel: 'Actief',
    matchCount: count => `${count} gevonden`,
    lastChecked: 'Laatst gecontroleerd',
    neverChecked: 'Nog niet gecontroleerd',
    nextCheckIn: m => `Volgende controle over ${m} ${m === 1 ? 'minuut' : 'minuten'}`,
    nextCheckSoon: 'Volgende controle: zo',
    // Shown instead of a next-check time once a search keeps failing: the check
    // does keep running, it just isn't reaching Marktplaats.
    checkFailing: 'Controle lukt nu niet, we blijven het proberen',
    checkFailingSince: at => `Laatst gelukt: ${at}`,
    checkFailingNever: 'Nog niet gelukt om deze zoekopdracht op te halen',
    refreshButton: 'Vernieuwen',
    validityLeft: n => `Verloopt over ${n} ${n === 1 ? 'dag' : 'dagen'}`,
    validityExpired: 'Verlopen',
    extendButton: 'Verleng',
    reactivateButton: 'Reactiveren',
    extendedToast: 'Zoekmelding verlengd.',
    reactivatedToast: 'Zoekmelding gereactiveerd.',
    channelTelegram: 'Telegram',
    matchesTitle: 'Nieuw gevonden',
    matchesEmpty: 'Nog niets binnengekomen. Zodra er een nieuwe advertentie verschijnt die aan een van je zoekmeldingen voldoet, zie je die hier.',
    newBadge: 'NIEUW',
    // The snapshot an alert takes on its first poll. It is not a find, so it
    // sits apart from the feed and out of the counts.
    baselineTitle: n => `Stond er al (${n})`,
    baselineHint: 'Deze advertenties stonden er al toen je deze zoekmelding aanmaakte. Je krijgt er geen melding van.',
    channelsTitle: 'Hoe je meldingen ontvangt',
    telegramLinked: 'Gekoppeld',
    telegramNotLinked: 'Nog niet gekoppeld',
    telegramLockedHint: 'Koppel eerst Telegram om hier meldingen via Telegram te krijgen. Klik om te koppelen.',
    // Telegram is the only delivery channel, so an unlinked account gets
    // nothing pushed to it — say that plainly instead of letting people wait.
    telegramRequiredTitle: 'Je ontvangt nog geen meldingen',
    telegramRequiredBody: 'Meldingen worden via Telegram verstuurd. Koppel Telegram om nieuwe advertenties binnen te krijgen. Gevonden advertenties zie je hieronder ook zonder koppeling.',
    telegramRequiredButton: 'Telegram koppelen',
    telegramTestButton: 'Stuur testmelding',
    telegramTestSending: 'Versturen…',
    telegramTestToast: 'Testmelding verstuurd. Kijk in je Telegram.',
    telegramTestHint: 'Even zeker weten dat het werkt? Stuur jezelf een testmelding.',
    telegramRelink: 'Ander account koppelen',
    telegramUnlink: 'Ontkoppelen',
    telegramUnlinkConfirm: 'Telegram ontkoppelen? Je ontvangt dan geen meldingen meer via Telegram.',
    telegramUnlinkedToast: 'Telegram ontkoppeld.',
    // Code-based linking flow (the bot sends you a code, you type it back here).
    telegramConnectTitle: 'Telegram koppelen',
    telegramConnectIntro: 'Krijg nieuwe advertenties direct in je Telegram-chat. Werkt ook als je alleen Telegram op je telefoon hebt.',
    telegramStep1Title: 'Open onze bot in Telegram',
    telegramStep1Body: 'Open Telegram en zoek deze bot:',
    telegramStep1Open: 'Open in Telegram',
    // Most people sit behind a laptop with Telegram on their phone, so the
    // scan is the short path and typing the handle over is the fallback.
    telegramQrTitle: 'Telegram op je telefoon?',
    telegramQrBody: 'Scan deze code met de camera van je telefoon, dan opent de bot direct.',
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
    createdToast: 'Zoekmelding aangemaakt! We kijken eerst wat er nu al staat, daarna krijg je een melding zodra er iets nieuws bij komt.',
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
    upgradeRegistered: 'Je staat op de lijst. We mailen je zodra Premium er is.',
    upgradeToast: 'Bedankt! Je hoort van ons zodra Premium beschikbaar is.',
    // Getting off that list has to be as easy as getting on it.
    upgradeWithdraw: 'Toch geen interesse',
    upgradeWithdrawing: 'Bezig…',
    upgradeWithdrawnToast: 'Je staat niet meer op de lijst. Je krijgt geen bericht over Premium.',

    // Contact. A mail address people can actually reach, without needing a
    // GitHub account for it.
    contactTitle: 'Vragen of feedback?',
    contactBody: 'Mail naar info@cleanplaats.com. Elk bericht komt bij de maker terecht.',
    contactAddress: 'info@cleanplaats.com',
    contactButton: 'Mail ons',

    // The rail, and the two surfaces it switches between.
    navMatches: 'Gevonden',
    navAlerts: 'Zoekmeldingen',
    navTelegram: 'Meldingen',
    matchesSub: 'Alles wat je zoekmeldingen sinds hun start hebben gevonden.',
    alertsSub: max => (max === 1
        ? 'Eén zoekmelding tegelijk op een gratis account. Zet hem aan, uit of verleng hem hier.'
        : `Tot ${max} zoekmeldingen tegelijk. Zet ze aan, uit of verleng ze hier.`),
    quotaUpgrade: 'Meer tegelijk laten lopen',
    contactShort: 'Vragen of feedback',

    // The one status line above the advertisements. Anything that would not
    // change what you do next does not belong here.
    stripRunning: n => `${n} ${n === 1 ? 'zoekmelding loopt' : 'zoekmeldingen lopen'}`,
    stripIdle: 'Er loopt nu geen zoekmelding, dus er komt niets binnen.',
    stripFailing: 'We kunnen Marktplaats even niet bereiken. Zodra dat weer lukt, gaat het zoeken door.',

    // Table headers on the Zoekmeldingen view.
    tableName: 'Zoekmelding',
    tableFound: 'Gevonden',
    tableCheck: 'Volgende controle',
    tableValidity: 'Geldig',
    tableStatus: 'Status',
    detailsChannel: 'Meldingen',
    detailsRemove: 'Verwijderen',
    createAtLimitHint: max => (max === 1
        ? 'Je hebt al een zoekmelding lopen. Verwijder hem eerst, dan kun je een nieuwe aanzetten.'
        : 'Je zit op je maximum. Verwijder er een om ruimte te maken.'),

    // Activation checklist. Three things stand between a fresh account and a
    // notification landing on someone's phone, and they are the same three for
    // everyone, so they are a list to work through rather than a warning to
    // read. The first is already done by the time it is on screen, which is
    // what makes the other two feel like finishing something.
    setupTitle: left => (left === 1 ? 'Nog één stap en je bent klaar' : `Nog ${left === 2 ? 'twee' : left} stappen en je bent klaar`),
    setupProgress: (done, total) => `${done} van ${total} klaar`,
    setupAccountTitle: 'Account gemaakt',
    setupAccountBody: 'Je zoekmeldingen volgen je e-mailadres, ook op een ander apparaat.',
    setupAlertTitle: 'Zet je eerste zoekmelding aan',
    setupAlertBody: 'Zoek iets op Marktplaats en vul de zoekterm hieronder in. Je categorie, locatie en afstand gaan mee.',
    setupAlertBodyDone: n => `Je hebt ${n} ${n === 1 ? 'zoekmelding' : 'zoekmeldingen'} lopen.`,
    setupTelegramTitle: 'Koppel Telegram',
    setupTelegramBody: 'Zonder koppeling blijft het stil: Telegram is de manier waarop we je bereiken.',
    setupTelegramBodyDone: 'Gekoppeld. Meldingen komen binnen in je Telegram-chat.',
    setupTelegramAction: 'Koppelen',

    // Account view
    accountTitle: 'Mijn account',
    accountOpen: 'Mijn account',
    accountEmailLabel: 'E-mailadres',
    accountPlanLabel: 'Abonnement',
    accountUsageLabel: 'Zoekmeldingen',
    accountIntervalLabel: 'Controlefrequentie',
    accountIntervalValue: m => `Elke ${m} minuten`,
    accountValidityLabel: 'Geldigheid',
    accountValidityValue: d => `${d} dagen per zoekmelding`,
    accountTelegramLabel: 'Telegram',
    accountSinceLabel: 'Lid sinds',
    accountPricingLink: 'Bekijk wat er in elk abonnement zit',
    backToAlerts: 'Terug',

    // Per-alert match view — the shared feed, narrowed to one search.
    alertMatchesOpen: label => `Bekijk de gevonden advertenties van ${label}`,
    alertMatchesTitle: 'Gevonden advertenties',
    alertMatchesSearchLink: 'Open deze zoekopdracht op Marktplaats',
    alertMatchesEmpty: 'Deze zoekmelding heeft nog niets nieuws gevonden. Zodra er een advertentie bij komt die eraan voldoet, zie je die hier.',
    alertMatchesError: 'We konden de advertenties van deze zoekmelding niet laden. Probeer het zo nog eens.',
    alertMatchesTruncated: n => `Je ziet de ${n} recentste advertenties van deze zoekmelding.`,

    // Limit view — shown when someone tries to add one too many.
    limitTitle: 'Je zit op je maximum',
    limitUsage: (used, max) => `${used} van ${max} ${max === 1 ? 'zoekmelding' : 'zoekmeldingen'} in gebruik`,
    limitBody: max => (max === 1
        ? 'Met een gratis account loopt er één zoekmelding tegelijk. Verwijder hieronder de huidige om ruimte te maken voor je nieuwe.'
        : `Met een gratis account kun je ${max} zoekmeldingen tegelijk laten lopen. ` +
          'Verwijder er hieronder een om ruimte te maken voor je nieuwe.'),
    limitListTitle: 'Jouw lopende zoekmeldingen',
    limitPremiumTitle: 'Meer tegelijk laten lopen?',
    limitPremiumBody: (plan, freePlan) => `Premium geeft je ${plan.maxAlerts} zoekmeldingen in plaats van ` +
        `${freePlan.maxAlerts}, en controleert elke ${plan.intervalMinutes} minuten in plaats van ` +
        `${freePlan.intervalMinutes}. Het is er nog niet, maar we laten het weten zodra het zover is.`,
    limitFreedToast: 'Er is weer ruimte. Zet je nieuwe zoekmelding aan.',

    // Pricing view
    pricingTitle: 'Wat je krijgt',
    pricingIntro: 'Cleanplaats blijft gratis te gebruiken. Premium is voor wie er als eerste bij wil zijn.',
    pricingCurrentPlan: 'Je huidige abonnement',
    pricingFree: 'Gratis',
    pricingPremium: 'Premium',
    // The paid column repeats nothing: eight lines of which five are identical
    // makes the expensive column look longer, not better. This says what is
    // different and lets the free column carry the rest.
    pricingPremiumIncludes: 'Alles uit Gratis, plus:',
    pricingFeatureAlerts: n => `${n} ${n === 1 ? 'zoekmelding' : 'zoekmeldingen'} tegelijk`,
    pricingFeatureInterval: m => `Controle elke ${m} minuten`,
    pricingFeatureIntervalFaster: (m, freeM) => `Drie keer sneller: elke ${m} minuten in plaats van ${freeM}`,
    pricingFeatureAlertsMore: (n, freeN) => `${n} zoekmeldingen tegelijk in plaats van ${freeN}`,
    pricingFeatureValidity: d => `${d} dagen geldig per zoekmelding`,
    pricingFeatureValidityLonger: (d, freeD) => `${d} dagen geldig in plaats van ${freeD}`,
    pricingFeatureTelegram: 'Meldingen via Telegram',
    pricingFeatureFilters: 'Je Cleanplaats-filters werken door in je meldingen',
    pricingFeatureBlocklist: 'Geblokkeerde verkopers en woorden tellen mee',
    pricingFeatureOneClick: 'Zoekmelding aanzetten vanaf je Marktplaats-zoekresultaten',
    pricingFeatureFeed: 'Overzicht van alle gevonden advertenties',

    // Filters are pushed to the server on every dashboard load. When that is
    // refused the alerts keep running with the last set that did fit, which is
    // exactly the kind of thing that must not fail quietly.
    filtersTooLargeToast: 'Je blokkeerlijsten zijn te groot om mee te sturen. Je zoekmeldingen gebruiken nu een oudere versie.'
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
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'
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

/**
 * `options.hideAlertLabel` drops the "which alert found this" line: in the
 * per-alert view every row has the same answer, and the heading already gave
 * it. `options.emptyText` lets that view say something about *this* search
 * rather than about the feed as a whole.
 */
function renderAlertMatchItems(matches, options = {}) {
    if (!matches || matches.length === 0) {
        return `<div class="cleanplaats-alerts-empty">${options.emptyText || ALERTS_TEXT.matchesEmpty}</div>`;
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
        // The badge sits at the end of the row rather than in front of the
        // title: inline, it pushed the first line over and left every badged
        // title breaking a word early.
        return `
            <a class="cleanplaats-alerts-match${isNew ? ' is-new' : ''}" href="${escapeAlertText(match.url)}">
                ${thumb}
                <span class="cleanplaats-alerts-match-info">
                    <span class="cleanplaats-alerts-match-title">${escapeAlertText(match.title)}</span>
                    <span class="cleanplaats-alerts-match-sub">
                        <span class="cleanplaats-alerts-match-price">${formatAlertMatchPrice(match)}</span>
                        ${match.city ? `<span>· ${escapeAlertText(match.city)}</span>` : ''}
                        ${options.hideAlertLabel ? '' : `<span class="cleanplaats-alerts-match-alert-label">· ${escapeAlertText(match.alert_label || '')}</span>`}
                    </span>
                </span>
                <span class="cleanplaats-alerts-match-meta">
                    ${isNew ? `<span class="cleanplaats-alerts-new">${ALERTS_TEXT.newBadge}</span>` : ''}
                    <span class="cleanplaats-alerts-match-time">${formatAlertRelativeTime(match.found_at)}</span>
                </span>
            </a>
        `;
    }).join('');
}

/**
 * The heading-with-sorter plus the list itself. Shared by the dashboard feed
 * and the per-alert view so both sort identically; wireAlertMatchesSort()
 * re-renders into the same ids.
 */
function buildAlertMatchesSectionHtml(matches, title, options = {}) {
    // Nothing to sort yet: the dropdown would just be a control that does
    // nothing next to a message saying there is nothing here.
    const sorter = (matches && matches.length > 0) ? `
            <select id="cleanplaats-alerts-sort" class="cleanplaats-alerts-sort-select">
                <option value="newest">${ALERTS_TEXT.sortNewest}</option>
                <option value="price_asc">${ALERTS_TEXT.sortPriceAsc}</option>
                <option value="price_desc">${ALERTS_TEXT.sortPriceDesc}</option>
            </select>` : '';

    return `
        <div class="cleanplaats-alerts-section-header">
            <span class="cleanplaats-alerts-section-title">${title}</span>${sorter}
        </div>
        <div class="cleanplaats-alerts-matches" id="cleanplaats-alerts-matches-list">${renderAlertMatchItems(sortAlertMatches(matches, 'newest'), options)}</div>
    `;
}

/**
 * The alert's opening snapshot, folded away. These listings were already on
 * Marktplaats when the alert was made, so they are not finds and never trigger
 * a notification — but throwing them out entirely would lose the one thing
 * they are good for: seeing what is out there right now. Collapsed by default
 * so a fresh alert opens on a calm screen instead of a hundred rows.
 */
function buildAlertBaselineSectionHtml(baseline) {
    if (!baseline || baseline.length === 0) return '';
    return `
        <div class="cleanplaats-alerts-baseline">
            <button class="cleanplaats-alerts-baseline-trigger" type="button" aria-expanded="false">
                <span class="cleanplaats-alerts-baseline-trigger-left">
                    ${alertIcon('archive', 14)}<span>${ALERTS_TEXT.baselineTitle(baseline.length)}</span>
                </span>
                <span class="cleanplaats-alerts-baseline-chevron">${alertIcon('chevron', 15)}</span>
            </button>
            <div class="cleanplaats-alerts-baseline-panel" hidden>
                <p class="cleanplaats-alerts-baseline-hint">${ALERTS_TEXT.baselineHint}</p>
                <div class="cleanplaats-alerts-matches">${renderAlertMatchItems(baseline, { hideAlertLabel: true })}</div>
            </div>
        </div>
    `;
}

function wireAlertsBaselineToggle(body) {
    const trigger = body.querySelector('.cleanplaats-alerts-baseline-trigger');
    const panel = body.querySelector('.cleanplaats-alerts-baseline-panel');
    if (!trigger || !panel) return;
    trigger.addEventListener('click', () => {
        const isOpen = !panel.hasAttribute('hidden');
        if (isOpen) panel.setAttribute('hidden', '');
        else panel.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', String(!isOpen));
        trigger.classList.toggle('cleanplaats-alerts-baseline-trigger-open', !isOpen);
    });
}

/**
 * `getMatches` is a getter rather than an array because the dashboard's feed
 * is replaced wholesale by a refresh; reading it at change-time keeps the
 * sorter pointed at whatever is currently on screen.
 */
function wireAlertMatchesSort(getMatches, options = {}) {
    const sortSelect = document.getElementById('cleanplaats-alerts-sort');
    if (!sortSelect) return;
    sortSelect.addEventListener('change', () => {
        const matchesList = document.getElementById('cleanplaats-alerts-matches-list');
        const matches = getMatches();
        if (!matchesList || !matches) return;
        const sorted = sortAlertMatches(matches, sortSelect.value);
        matchesList.innerHTML = DOMPurify.sanitize(renderAlertMatchItems(sorted, options));
        wireAlertMatchLinks(matchesList);
    });
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

    // No searchInTitleAndDescription here on purpose. Marktplaats searches
    // descriptions by default and ignores the parameter entirely (checked
    // against /lrp/api/search: absent, 'true' and 'false' return identical
    // totals, and results include ads with the term only in the description).
    // Sending nothing means an alert keeps matching whatever the search page
    // itself matches, even if that default ever changes.

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
        // 413 is the one failure the user has to know about: their alerts keep
        // running on an older copy of the blocklists, so ads they have blocked
        // can still come through. Everything else is a transient network
        // problem the next dashboard load fixes by itself.
        if (error && error.status === 413) {
            showBubbleNotification(ALERTS_TEXT.filtersTooLargeToast);
        }
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

/**
 * Keyboard behaviour for a dialog that sits on top of somebody else's page:
 * Escape closes it, and Tab stays inside it. Without the trap you tab straight
 * out of the panel into the Marktplaats page behind it, which is still there
 * and still focusable, with no way to tell where you are.
 */
var CLEANPLAATS_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function handleAlertsModalKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        // A confirmation on screen is the thing Escape should dismiss first.
        if (closeAlertsConfirm()) return;
        hideAlertsModal();
        return;
    }

    if (event.key !== 'Tab') return;

    const card = document.querySelector('#cleanplaats-alerts-modal .cleanplaats-alerts-card');
    if (!card) return;
    const focusable = [...card.querySelectorAll(CLEANPLAATS_FOCUSABLE)]
        .filter(element => element.offsetParent !== null || element === document.activeElement);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function hideAlertsModal() {
    const overlay = document.getElementById('cleanplaats-alerts-modal');
    if (overlay) overlay.style.display = 'none';

    document.removeEventListener('keydown', handleAlertsModalKeydown, true);
    document.documentElement.classList.remove('cleanplaats-alerts-modal-open');
    closeAlertsConfirm();

    // Back to whatever opened the panel, so keyboard users don't restart at the
    // top of the Marktplaats page.
    const returnTo = cleanplaatsAlertsRuntime.returnFocusTo;
    cleanplaatsAlertsRuntime.returnFocusTo = null;
    if (returnTo && returnTo.isConnected) {
        try {
            returnTo.focus();
        } catch (error) {
            /* the element went away with a re-render; nothing to restore to */
        }
    }
    // Next time the panel opens it should use the visit the server stamped
    // during this one, so what we just looked at is no longer "NIEUW".
    cleanplaatsAlertsRuntime.matchesSeenAt = null;
    cleanplaatsAlertsRuntime.openAlertMatchesId = null;
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
    cleanplaatsAlertsRuntime.returnFocusTo =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

    renderAlertsShell(overlay);
    overlay.style.display = 'flex';
    // Capture phase: Marktplaats' own key handlers sit on the page behind us.
    document.addEventListener('keydown', handleAlertsModalKeydown, true);
    // The page behind a full-screen dialog should stay put while you scroll it.
    document.documentElement.classList.add('cleanplaats-alerts-modal-open');
    document.getElementById('cleanplaats-alerts-close')?.focus();

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
        <div class="cleanplaats-alerts-card" role="dialog" aria-modal="true" aria-label="${ALERTS_TEXT.modalTitle}">
            <div class="cleanplaats-alerts-header">
                <div class="cleanplaats-alerts-header-title">
                    <span class="cleanplaats-alerts-bell"><img id="cleanplaats-alerts-bell-img" alt="" width="42" height="42"></span>
                    <div>
                        <h3>${ALERTS_TEXT.modalTitle}</h3>
                        <span class="cleanplaats-alerts-tagline" id="cleanplaats-alerts-tagline">${ALERTS_TEXT.tagline}</span>
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
    // Only the dashboard runs the rail-and-surface grid; every other view is a
    // single readable column, and the dashboard adds the class back itself.
    // Leaving it on squeezed each sub-view into the rail's column.
    body.classList.remove('cleanplaats-alerts-body-app');
    // The tagline is the pitch, so it belongs on the first screen and on the
    // dashboard, not repeated above every sub-view that has its own heading.
    setAlertsTaglineVisible(false);
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

function setAlertsTaglineVisible(visible) {
    const tagline = document.getElementById('cleanplaats-alerts-tagline');
    if (tagline) tagline.hidden = !visible;
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

/* ===== Bevestigen =====
   Deleting used to go through window.confirm(), which puts a browser dialog
   labelled "marktplaats.nl" on top of our own panel: it reads as the site
   asking, not us, and it cannot say which search is about to disappear. This
   is the same question inside the panel, in our own words. */

function closeAlertsConfirm() {
    const existing = document.getElementById('cleanplaats-alerts-confirm');
    if (!existing) return false;
    const returnTo = existing.cleanplaatsReturnFocus;
    existing.remove();
    if (returnTo && returnTo.isConnected) returnTo.focus();
    return true;
}

/**
 * `onConfirm` runs when the user goes through with it. Nothing happens on
 * cancel, Escape or a click on the backdrop.
 */
function openAlertsConfirm({ title, body, confirmLabel, danger = true, onConfirm }) {
    closeAlertsConfirm();

    const overlay = document.getElementById('cleanplaats-alerts-modal');
    if (!overlay) return;

    const wrap = document.createElement('div');
    wrap.id = 'cleanplaats-alerts-confirm';
    wrap.className = 'cleanplaats-alerts-confirm';
    wrap.cleanplaatsReturnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    wrap.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-alerts-confirm-box" role="alertdialog" aria-modal="true" aria-label="${escapeAlertText(title)}">
            <div class="cleanplaats-alerts-confirm-title">${escapeAlertText(title)}</div>
            <div class="cleanplaats-alerts-confirm-body">${escapeAlertText(body)}</div>
            <div class="cleanplaats-alerts-confirm-actions">
                <button type="button" class="cleanplaats-alerts-secondary-btn" id="cleanplaats-alerts-confirm-cancel">${ALERTS_TEXT.confirmCancel}</button>
                <button type="button" class="${danger ? 'cleanplaats-alerts-danger-btn' : 'cleanplaats-alerts-primary-btn'}" id="cleanplaats-alerts-confirm-ok">${escapeAlertText(confirmLabel)}</button>
            </div>
        </div>
    `);

    overlay.appendChild(wrap);
    wrap.addEventListener('click', event => {
        if (event.target === wrap) closeAlertsConfirm();
    });
    document.getElementById('cleanplaats-alerts-confirm-cancel').onclick = () => closeAlertsConfirm();
    document.getElementById('cleanplaats-alerts-confirm-ok').onclick = () => {
        closeAlertsConfirm();
        onConfirm();
    };
    document.getElementById('cleanplaats-alerts-confirm-ok').focus();
}

/* ===== Login views ===== */

/**
 * The first screen anybody ever sees of this feature. It leads with what the
 * thing does and only then asks for an address, with one line about what
 * happens to it: an e-mail field on an otherwise blank card asks for a
 * commitment before it has offered anything.
 */
function renderAlertsLoginView() {
    const bullets = ALERTS_TEXT.loginBullets.map(bullet => `
        <li class="cleanplaats-alerts-sell-item">
            <span class="cleanplaats-alerts-sell-icon">${alertIcon(bullet.icon, 16)}</span>
            <span>${bullet.text}</span>
        </li>
    `).join('');

    const body = setAlertsBody(`
        <div class="cleanplaats-alerts-sell">
            <h4 class="cleanplaats-alerts-sell-title">${ALERTS_TEXT.loginTitle}</h4>
            <p class="cleanplaats-alerts-sell-intro">${ALERTS_TEXT.loginIntro}</p>
            <ul class="cleanplaats-alerts-sell-list">${bullets}</ul>

            <div class="cleanplaats-alerts-sell-form">
                <div class="cleanplaats-alerts-sell-form-head">
                    <span class="cleanplaats-alerts-sell-form-title">${ALERTS_TEXT.loginFormTitle}</span>
                    <span class="cleanplaats-alerts-sell-form-hint">${ALERTS_TEXT.loginFormHint}</span>
                </div>
                <div class="cleanplaats-alerts-form-row">
                    <input type="email" id="cleanplaats-alerts-email-input" placeholder="${ALERTS_TEXT.emailPlaceholder}" autocomplete="email" aria-label="${ALERTS_TEXT.loginFormTitle}">
                    <button id="cleanplaats-alerts-email-submit" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.emailButton}</button>
                </div>
                <div class="cleanplaats-alerts-form-error" id="cleanplaats-alerts-form-error" style="display:none;"></div>
                <p class="cleanplaats-alerts-sell-privacy">
                    ${ALERTS_TEXT.loginPrivacy}
                    <a href="https://www.cleanplaats.com/privacy" target="_blank" rel="noopener noreferrer">${ALERTS_TEXT.loginPrivacyLink}</a>
                    ·
                    <a href="https://www.cleanplaats.com/voorwaarden" target="_blank" rel="noopener noreferrer">${ALERTS_TEXT.loginTermsLink}</a>
                </p>
            </div>
        </div>
    `);
    if (!body) return;
    setAlertsTaglineVisible(true);

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

    // Disabled while the request is in flight and for a short cooldown after a
    // successful send, but re-enabled on failure: a resend that fails used to
    // leave the only way forward greyed out permanently.
    const resend = document.getElementById('cleanplaats-alerts-resend');
    resend.onclick = () => {
        resend.disabled = true;
        resend.textContent = ALERTS_TEXT.codeResending;
        alertsApiFetch('/api/auth/request-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        }).then(() => {
            resend.textContent = ALERTS_TEXT.codeResent;
            setTimeout(() => {
                if (!resend.isConnected) return;
                resend.disabled = false;
                resend.textContent = ALERTS_TEXT.codeResend;
            }, 30000);
        }).catch(error => {
            resend.disabled = false;
            resend.textContent = ALERTS_TEXT.codeResend;
            showAlertsInlineError(error.message || ALERTS_TEXT.errorToast);
        });
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

    // The QR is a shipped asset rather than something generated here: the bot
    // handle is a constant, so there is nothing to generate per user, and a
    // static file beats carrying a QR encoder in a content script. It is only
    // shown for the bot it actually encodes, so a renamed bot loses the QR
    // instead of quietly pointing people at the wrong chat.
    const qrBot = 'CleanplaatsBot';
    const qrBlock = bot === qrBot ? `
                        <div class="cleanplaats-alerts-qr">
                            <img class="cleanplaats-alerts-qr-img" id="cleanplaats-tg-qr" alt="QR-code naar de Cleanplaats-bot in Telegram" width="132" height="132">
                            <span class="cleanplaats-alerts-qr-copy">
                                <span class="cleanplaats-alerts-qr-title">${ALERTS_TEXT.telegramQrTitle}</span>
                                <span class="cleanplaats-alerts-qr-body">${ALERTS_TEXT.telegramQrBody}</span>
                            </span>
                        </div>` : '';

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
                        ${qrBlock}
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

    // Same reason as the header bell: DOMPurify drops the extension scheme, so
    // the source is assigned after sanitizing.
    const qrImage = document.getElementById('cleanplaats-tg-qr');
    if (qrImage) qrImage.src = browserAPI.runtime.getURL('icons/telegram-bot-qr.svg');

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
    if (!timestamp) return 'Onbekend';
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
        ${buildAlertsContactHtml()}
        <div class="cleanplaats-alerts-footer">
            <button class="cleanplaats-alerts-danger-btn" id="cleanplaats-alerts-logout">${alertIcon('logout', 16)}<span>${ALERTS_TEXT.logout}</span></button>
            <span class="cleanplaats-alerts-footer-hint">${ALERTS_TEXT.logoutHint}</span>
        </div>
    `);

    wireAlertsBackButton();
    wireAlertsLogout();
    wireAlertsContact();
    document.getElementById('cleanplaats-alerts-open-pricing').onclick = renderAlertsPricingView;
}

function buildPricingPlanHtml({ name, priceLabel, current, soon, features, includesLine }) {
    return `
        <div class="cleanplaats-alerts-plan ${current ? 'cleanplaats-alerts-plan-current' : ''}">
            <div class="cleanplaats-alerts-plan-head">
                <span class="cleanplaats-alerts-plan-name">${name}</span>
                ${current ? `<span class="cleanplaats-alerts-plan-badge">${ALERTS_TEXT.pricingCurrentPlan}</span>` : ''}
                ${soon ? `<span class="cleanplaats-alerts-plan-badge cleanplaats-alerts-plan-badge-soon">${ALERTS_TEXT.upgradeSoon}</span>` : ''}
            </div>
            <div class="cleanplaats-alerts-plan-price">${priceLabel}</div>
            ${includesLine ? `<div class="cleanplaats-alerts-plan-includes">${includesLine}</div>` : ''}
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
    // The free column carries the full list; the paid one says what changes.
    // Repeating five identical lines under a price only made the paid column
    // longer, and buried the three lines that are the actual offer.
    const sharedFeatures = [
        ALERTS_TEXT.pricingFeatureTelegram,
        ALERTS_TEXT.pricingFeatureOneClick,
        ALERTS_TEXT.pricingFeatureFilters,
        ALERTS_TEXT.pricingFeatureBlocklist,
        ALERTS_TEXT.pricingFeatureFeed
    ];

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
                includesLine: ALERTS_TEXT.pricingPremiumIncludes,
                // Speed first: it is the difference people would pay for.
                features: [
                    ALERTS_TEXT.pricingFeatureIntervalFaster(premium.intervalMinutes, free.intervalMinutes),
                    ALERTS_TEXT.pricingFeatureAlertsMore(premium.maxAlerts, free.maxAlerts),
                    ALERTS_TEXT.pricingFeatureValidityLonger(premium.validDays, free.validDays)
                ]
            })}
        </div>
        ${me.tier === 'premium' ? '' : buildUpgradeInterestSlotHtml()}
        ${buildAlertsContactHtml()}
    `);

    wireAlertsBackButton();
    wireAlertsUpgradeButton();
    wireAlertsContact();
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
            <button class="cleanplaats-alerts-delete" data-alert-id="${alert.id}" data-alert-label="${escapeAlertText(alert.label)}" title="${ALERTS_TEXT.deleteButton}" aria-label="${ALERTS_TEXT.deleteButton}">${alertIcon('trash', 15)}</button>
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
            openAlertsConfirm({
                title: ALERTS_TEXT.deleteConfirmTitle,
                body: ALERTS_TEXT.deleteConfirmBody(button.dataset.alertLabel || ''),
                confirmLabel: ALERTS_TEXT.deleteConfirmOk,
                onConfirm: () => {
                    button.disabled = true;
                    alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, { method: 'DELETE' })
                        .then(() => {
                            showBubbleNotification(ALERTS_TEXT.limitFreedToast);
                            cleanplaatsAlertsRuntime.view = 'alerts';
                            loadAlertsDashboard();
                        })
                        .catch(error => {
                            button.disabled = false;
                            showBubbleNotification((error && error.message) || ALERTS_TEXT.errorToast);
                        });
                }
            });
        };
    });
}

/**
 * One alert's matches. The dashboard feed mixes every search together, which
 * answers "what came in" but not "did *this* search find anything" — that
 * second question is what this view is for.
 *
 * It refetches instead of filtering the cached feed: that feed is capped at 60
 * rows across all alerts, so a busy search can be badly under-represented in
 * it while its own card promises a much higher count.
 */
function renderAlertMatchesView(alertId) {
    const alert = (cleanplaatsAlertsRuntime.cachedAlerts || [])
        .find(item => String(item.id) === String(alertId));
    if (!alert) {
        loadAlertsDashboard();
        return;
    }

    cleanplaatsAlertsRuntime.openAlertMatchesId = String(alert.id);

    const subtitle = alert.search_url
        ? `<a class="cleanplaats-alerts-subview-link" href="${escapeAlertText(alert.search_url)}">${ALERTS_TEXT.alertMatchesSearchLink}</a>`
        : '';
    const header = alertsViewHeader(escapeAlertText(alert.label), subtitle);

    const body = setAlertsBody(`
        ${header}
        <div class="cleanplaats-alerts-loading">${ALERTS_TEXT.loading}</div>
    `);
    if (!body) return;
    wireAlertsBackButton();
    wireAlertMatchLinks(body);

    // Every row here belongs to the same alert, so repeating its label under
    // each one would be noise; the heading already says which search this is.
    const itemOptions = { hideAlertLabel: true, emptyText: ALERTS_TEXT.alertMatchesEmpty };

    // This is the one place the opening snapshot is still worth having, so it
    // is asked for here and nowhere else. It lands in its own collapsed block.
    alertsApiFetch(`/api/matches?alertId=${encodeURIComponent(alert.id)}&includeBaseline=1`)
        .then(data => {
            // A slow response must not paint over a view the user has already
            // left, or over a different alert they opened in the meantime.
            if (cleanplaatsAlertsRuntime.openAlertMatchesId !== String(alert.id)) return;

            const all = data.matches || [];
            const matches = all.filter(match => !match.is_baseline);
            const baseline = all.filter(match => match.is_baseline);
            const truncated = all.length >= ALERT_MATCHES_PAGE_SIZE;
            const nextBody = setAlertsBody(`
                ${header}
                ${buildAlertMatchesSectionHtml(matches, ALERTS_TEXT.alertMatchesTitle, itemOptions)}
                ${buildAlertBaselineSectionHtml(baseline)}
                ${truncated ? `<div class="cleanplaats-alerts-matches-note">${ALERTS_TEXT.alertMatchesTruncated(ALERT_MATCHES_PAGE_SIZE)}</div>` : ''}
            `);
            if (!nextBody) return;
            wireAlertsBackButton();
            wireAlertMatchLinks(nextBody);
            wireAlertMatchesSort(() => matches, itemOptions);
            wireAlertsBaselineToggle(nextBody);
        })
        .catch(error => {
            if (cleanplaatsAlertsRuntime.openAlertMatchesId !== String(alert.id)) return;
            // Same as the dashboard: a session that expired while the panel was
            // open should land on the login view, not on an error about matches.
            if (error.status === 401) {
                storeAlertsToken('').then(() => renderAlertsLoginView());
                return;
            }
            console.error('Cleanplaats: Failed to load matches for alert', error);
            const errorBody = setAlertsBody(`
                ${header}
                <div class="cleanplaats-alerts-empty">${ALERTS_TEXT.alertMatchesError}</div>
            `);
            if (errorBody) wireAlertsBackButton();
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

/**
 * The premium call to action, in whichever of its two states applies: an offer
 * to be told when premium lands, or the confirmation that you will be — with
 * the way back out next to it. Both live in one slot so a click can swap them
 * without re-rendering the whole view.
 */
function buildUpgradeInterestHtml() {
    const me = cleanplaatsAlertsRuntime.me;
    if (me && me.upgradeInterestRegistered) {
        return `
            <div class="cleanplaats-alerts-upgrade-done">
                <span class="cleanplaats-alerts-upgrade-done-text">${alertIcon('check', 14)}<span>${ALERTS_TEXT.upgradeRegistered}</span></span>
                <button type="button" class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-upgrade-withdraw">${ALERTS_TEXT.upgradeWithdraw}</button>
            </div>
        `;
    }
    return `<button type="button" class="cleanplaats-alerts-primary-btn cleanplaats-alerts-block-btn" id="cleanplaats-alerts-upgrade-btn" data-source="pricing">${ALERTS_TEXT.upgradeButton}</button>`;
}

function buildUpgradeInterestSlotHtml() {
    return `<div id="cleanplaats-alerts-upgrade-slot">${buildUpgradeInterestHtml()}</div>`;
}

function renderUpgradeInterestSlot() {
    const slot = document.getElementById('cleanplaats-alerts-upgrade-slot');
    if (!slot) return;
    slot.innerHTML = DOMPurify.sanitize(buildUpgradeInterestHtml());
    wireAlertsUpgradeButton();
}

function wireAlertsUpgradeButton() {
    const button = document.getElementById('cleanplaats-alerts-upgrade-btn');
    if (button) {
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
                renderUpgradeInterestSlot();
                showBubbleNotification(ALERTS_TEXT.upgradeToast);
            }).catch(error => {
                button.disabled = false;
                button.textContent = ALERTS_TEXT.upgradeButton;
                showBubbleNotification((error && error.message) || ALERTS_TEXT.errorToast);
            });
        };
    }

    const withdraw = document.getElementById('cleanplaats-alerts-upgrade-withdraw');
    if (withdraw) {
        withdraw.onclick = () => {
            withdraw.disabled = true;
            withdraw.textContent = ALERTS_TEXT.upgradeWithdrawing;
            alertsApiFetch('/api/upgrade-interest', { method: 'DELETE' })
                .then(() => {
                    if (cleanplaatsAlertsRuntime.me) {
                        cleanplaatsAlertsRuntime.me.upgradeInterestRegistered = false;
                    }
                    renderUpgradeInterestSlot();
                    showBubbleNotification(ALERTS_TEXT.upgradeWithdrawnToast);
                })
                .catch(error => {
                    withdraw.disabled = false;
                    withdraw.textContent = ALERTS_TEXT.upgradeWithdraw;
                    showBubbleNotification((error && error.message) || ALERTS_TEXT.errorToast);
                });
        };
    }
}

/**
 * A mail address, in the panel itself. The main panel points at GitHub issues,
 * which asks for an account before anyone can say anything.
 */
function buildAlertsContactHtml() {
    return `
        <div class="cleanplaats-alerts-contact">
            <span class="cleanplaats-alerts-contact-icon">${alertIcon('mail', 16)}</span>
            <span class="cleanplaats-alerts-contact-copy">
                <span class="cleanplaats-alerts-contact-title">${ALERTS_TEXT.contactTitle}</span>
                <span class="cleanplaats-alerts-contact-body">${ALERTS_TEXT.contactBody}</span>
            </span>
            <button type="button" class="cleanplaats-alerts-secondary-btn" id="cleanplaats-alerts-contact-btn">${ALERTS_TEXT.contactButton}</button>
        </div>
    `;
}

/**
 * Wired rather than an <a href="mailto:">: DOMPurify keeps mailto links, but a
 * plain anchor inside the overlay navigates the Marktplaats tab away on some
 * setups. window.open leaves the page, and the panel, where it was.
 */
function wireAlertsContact() {
    const button = document.getElementById('cleanplaats-alerts-contact-btn');
    if (!button) return;
    button.onclick = () => {
        window.open(`mailto:${ALERTS_TEXT.contactAddress}`, '_blank');
    };
}

/* ===== Dashboard ===== */

function loadAlertsDashboard() {
    // Leaving a per-alert view: anything still in flight for it is now stale.
    cleanplaatsAlertsRuntime.openAlertMatchesId = null;

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
        // The server leaves the baseline out of this feed already; filtering
        // again costs nothing and keeps an extension that updated before the
        // server did from showing the flood anyway.
        const feed = (matchesData.matches || []).filter(match => !match.is_baseline);
        renderAlertsDashboard(me, alertsData.alerts || [], feed);
    }).catch(error => {
        if (error.status === 401) {
            storeAlertsToken('').then(() => renderAlertsLoginView());
            return;
        }
        console.error('Cleanplaats: Failed to load alerts', error);
        setAlertsBody(`<div class="cleanplaats-alerts-loading">${ALERTS_TEXT.errorToast}</div>`);
    });
}

/**
 * The dashboard is an app in a window rather than a stack of boxes: a rail on
 * the left says where you are, one surface on the right holds one thing at a
 * time. It replaces a single scrolling column where an account block, a
 * warning, a create box, a list of cards and the feed all fought for the top.
 *
 * What people come here for is the advertisements, so that is the view the
 * panel opens on. Managing searches is the second tab, and there are no
 * dashboard statistics: a number that nobody acts on is furniture.
 *
 * Views inside the shell (rail stays put): matches, alerts.
 * Views that take over the whole body (own back button): account, pricing,
 * telegram, one alert's finds, the limit screen.
 */
var ALERTS_NAV_ITEMS = [
    { id: 'matches', icon: 'search', label: () => ALERTS_TEXT.navMatches },
    { id: 'alerts', icon: 'bell', label: () => ALERTS_TEXT.navAlerts }
];

function alertsCurrentView() {
    const view = cleanplaatsAlertsRuntime.view;
    return ALERTS_NAV_ITEMS.some(item => item.id === view) ? view : 'matches';
}

/**
 * How much of an alert's validity window is left, as a fraction. The bar is
 * the one place the window is a quantity rather than a sentence, which is what
 * makes "still fine" and "about to lapse" readable without doing the sum.
 */
function alertValidityFraction(alert, me) {
    const validity = getAlertValidity(alert);
    if (!validity) return null;
    const plan = me.plans && me.plans[me.tier === 'premium' ? 'premium' : 'free'];
    const total = (plan && plan.validDays) || 0;
    if (!total) return null;
    if (validity.expired) return 0;
    return Math.max(0.02, Math.min(1, validity.daysLeft / total));
}

// A search that keeps failing is not "checked 3 minutes ago": last_checked_at
// moves on whether or not Marktplaats answered. Two strikes in a row is the
// point where this stops being a blip.
function isAlertFailing(alert) {
    return (alert.fail_count || 0) >= 2;
}

/**
 * One line above the listings: how many searches are running, how often they
 * run, and when the next one lands. It is the only status the panel keeps on
 * screen, because it is the only status that changes what you would do next.
 */
function buildAlertsStatusStripHtml(me, alerts) {
    const running = alerts.filter(alert => {
        const validity = getAlertValidity(alert);
        return alert.enabled && !(validity && validity.expired);
    });

    if (running.length === 0) {
        return `<div class="cleanplaats-alerts-strip cleanplaats-alerts-strip-idle">
            ${alertIcon('clock', 14)}<span>${ALERTS_TEXT.stripIdle}</span>
        </div>`;
    }

    if (running.some(isAlertFailing)) {
        return `<div class="cleanplaats-alerts-strip cleanplaats-alerts-strip-warn">
            ${alertIcon('clock', 14)}<span>${ALERTS_TEXT.stripFailing}</span>
        </div>`;
    }

    const checked = running.filter(alert => alert.last_checked_at);
    const next = checked.length > 0
        ? formatAlertNextCheck(Math.min(...checked.map(alert => alert.last_checked_at)), me.intervalMinutes)
        : '';

    return `<div class="cleanplaats-alerts-strip">
        <span class="cleanplaats-alerts-strip-dot"></span>
        <span>${ALERTS_TEXT.stripRunning(running.length)}</span>
        <span class="cleanplaats-alerts-strip-sep">·</span>
        <span>${ALERTS_TEXT.checkFrequency(me.intervalMinutes)}</span>
        ${next ? `<span class="cleanplaats-alerts-strip-sep">·</span><span>${next}</span>` : ''}
    </div>`;
}

/**
 * Three steps stand between a fresh account and a message arriving, and they
 * are the same three for everyone. As a checklist they are something to finish;
 * as the old orange banner they were something to feel bad about. Gone once all
 * three are done, so a set-up account never sees setup again.
 */
function buildAlertsChecklistHtml(me, alerts) {
    const hasAlert = alerts.length > 0;
    const steps = [
        {
            done: true,
            title: ALERTS_TEXT.setupAccountTitle,
            body: ALERTS_TEXT.setupAccountBody,
            action: ''
        },
        {
            done: hasAlert,
            title: ALERTS_TEXT.setupAlertTitle,
            body: hasAlert ? ALERTS_TEXT.setupAlertBodyDone(alerts.length) : ALERTS_TEXT.setupAlertBody,
            action: hasAlert ? '' : `<button type="button" class="cleanplaats-alerts-secondary-btn" data-nav-jump="alerts">${ALERTS_TEXT.createButton}</button>`
        },
        {
            done: Boolean(me.telegramLinked),
            title: ALERTS_TEXT.setupTelegramTitle,
            body: me.telegramLinked ? ALERTS_TEXT.setupTelegramBodyDone : ALERTS_TEXT.setupTelegramBody,
            action: me.telegramLinked ? '' : `<button type="button" class="cleanplaats-alerts-primary-btn" id="cleanplaats-alert-telegram-link-notice">${ALERTS_TEXT.setupTelegramAction}</button>`
        }
    ];

    const doneCount = steps.filter(step => step.done).length;
    if (doneCount === steps.length) return '';

    return `
        <section class="cleanplaats-alerts-setup">
            <div class="cleanplaats-alerts-setup-head">
                <span class="cleanplaats-alerts-setup-title">${ALERTS_TEXT.setupTitle(steps.length - doneCount)}</span>
                <span class="cleanplaats-alerts-setup-progress">
                    <span class="cleanplaats-alerts-setup-bar"><span style="width:${Math.round((doneCount / steps.length) * 100)}%"></span></span>
                    <span class="cleanplaats-alerts-setup-count">${ALERTS_TEXT.setupProgress(doneCount, steps.length)}</span>
                </span>
            </div>
            <ol class="cleanplaats-alerts-setup-steps">
                ${steps.map((step, index) => `
                    <li class="cleanplaats-alerts-setup-step${step.done ? ' cleanplaats-alerts-setup-step-done' : ''}">
                        <span class="cleanplaats-alerts-setup-marker">${step.done ? alertIcon('check', 13) : String(index + 1)}</span>
                        <span class="cleanplaats-alerts-setup-copy">
                            <span class="cleanplaats-alerts-setup-step-title">${step.title}</span>
                            <span class="cleanplaats-alerts-setup-step-body">${step.body}</span>
                        </span>
                        ${step.action ? `<span class="cleanplaats-alerts-setup-action">${step.action}</span>` : ''}
                    </li>
                `).join('')}
            </ol>
        </section>
    `;
}

function buildAlertsCreateHtml(context, me) {
    const atLimit = (me.alertCount || 0) >= me.maxAlerts;
    return `
        <section class="cleanplaats-alerts-create">
            <div class="cleanplaats-alerts-create-title">${ALERTS_TEXT.createTitle}</div>
            <div class="cleanplaats-alerts-form-row">
                <input type="text" id="cleanplaats-alert-label-input" value="${context ? escapeAlertText(context.suggestedLabel) : ''}" placeholder="${ALERTS_TEXT.labelPlaceholder}" maxlength="120" aria-label="${ALERTS_TEXT.createTitle}">
                <button id="cleanplaats-alert-create" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.createButton}</button>
            </div>
            ${context ? `<div class="cleanplaats-alerts-create-note" id="cleanplaats-alert-create-note">${ALERTS_TEXT.createContextHint}</div>` : ''}
            ${atLimit ? `<div class="cleanplaats-alerts-create-note cleanplaats-alerts-create-note-limit">${ALERTS_TEXT.createAtLimitHint(me.maxAlerts)}</div>` : ''}
            <div class="cleanplaats-alerts-create-warning" id="cleanplaats-alert-broad-warning" hidden></div>
        </section>
    `;
}

/**
 * One alert per row, with everything you only need while changing something
 * (channel, filters, delete) folded into a second row underneath. The row
 * itself answers the two questions the panel gets opened for: is it running,
 * and did it find anything.
 */
function buildAlertsTableHtml(alerts, me) {
    if (alerts.length === 0) {
        return `<div class="cleanplaats-alerts-empty">${ALERTS_TEXT.empty}</div>`;
    }

    const rows = alerts.map(alert => {
        const validity = getAlertValidity(alert);
        const expired = Boolean(validity && validity.expired);
        const statusClass = expired ? 'expired' : (alert.enabled ? 'active' : 'paused');
        const running = alert.enabled && !expired;
        const failing = running && isAlertFailing(alert);

        let checkText;
        if (failing) {
            checkText = `<span class="cleanplaats-alerts-cell-warn">${ALERTS_TEXT.checkFailing}</span>`;
        } else if (running && alert.last_checked_at) {
            checkText = formatAlertNextCheck(alert.last_checked_at, me.intervalMinutes) || ALERTS_TEXT.nextCheckSoon;
        } else if (alert.last_checked_at) {
            checkText = `${ALERTS_TEXT.lastChecked}: ${formatAlertRelativeTime(alert.last_checked_at)}`;
        } else {
            checkText = ALERTS_TEXT.neverChecked;
        }

        const label = alert.search_url
            ? `<a href="${escapeAlertText(alert.search_url)}" class="cleanplaats-alerts-card-label">${escapeAlertText(alert.label)}</a>`
            : `<span class="cleanplaats-alerts-card-label">${escapeAlertText(alert.label)}</span>`;

        const matchCount = alert.match_count || 0;
        const openable = matchCount > 0 || (alert.baseline_count || 0) > 0;
        const matchCell = openable
            ? `<button type="button" class="cleanplaats-alerts-match-badge cleanplaats-alerts-match-badge-link" data-open-matches="${alert.id}" aria-label="${escapeAlertText(ALERTS_TEXT.alertMatchesOpen(alert.label))}">${ALERTS_TEXT.matchCount(matchCount)}${alertIcon('chevron', 13)}</button>`
            : `<span class="cleanplaats-alerts-match-badge cleanplaats-alerts-match-badge-zero">${ALERTS_TEXT.matchCount(matchCount)}</span>`;

        const fraction = alertValidityFraction(alert, me);
        const validityCell = validity
            ? `<span class="cleanplaats-alerts-validity-meter${validity.expired ? ' is-expired' : (validity.soon ? ' is-soon' : '')}">
                   <span class="cleanplaats-alerts-validity-bar"><span style="width:${Math.round((fraction || 0) * 100)}%"></span></span>
                   <span class="cleanplaats-alerts-validity-text">${validity.expired ? ALERTS_TEXT.validityExpired : ALERTS_TEXT.validityLeft(validity.daysLeft)}</span>
               </span>`
            : '<span class="cleanplaats-alerts-validity-text">∞</span>';

        const statusCell = expired
            ? `<button class="cleanplaats-alerts-extend-btn cleanplaats-alerts-extend-btn-primary" data-alert-id="${alert.id}" data-extend="1">${ALERTS_TEXT.reactivateButton}</button>`
            : `<button class="cleanplaats-alerts-switch cleanplaats-alerts-switch-status ${alert.enabled ? 'on' : ''}" data-alert-id="${alert.id}" data-enabled="${alert.enabled ? '1' : '0'}" role="switch" aria-checked="${alert.enabled ? 'true' : 'false'}">
                   <span class="cleanplaats-alerts-switch-label">${alert.enabled ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel}</span><span class="cleanplaats-alerts-switch-track"></span>
               </button>`;

        const telegramSwitch = me.telegramLinked
            ? `<button class="cleanplaats-alerts-switch ${alert.notify_telegram ? 'on' : ''}" data-channel="telegram" data-alert-id="${alert.id}" data-value="${alert.notify_telegram ? '1' : '0'}" role="switch" aria-checked="${alert.notify_telegram ? 'true' : 'false'}">
                   ${alertIcon('send', 14)}<span class="cleanplaats-alerts-switch-label">${ALERTS_TEXT.channelTelegram}</span><span class="cleanplaats-alerts-switch-track"></span>
               </button>`
            : `<button class="cleanplaats-alerts-switch cleanplaats-alerts-switch-locked" data-channel="telegram" data-alert-id="${alert.id}" data-locked="1" type="button" aria-label="${ALERTS_TEXT.telegramLockedHint}" data-tip="${ALERTS_TEXT.telegramLockedHint}">
                   ${alertIcon('send', 14)}<span class="cleanplaats-alerts-switch-label">${ALERTS_TEXT.channelTelegram}</span><span class="cleanplaats-alerts-switch-track"></span>
               </button>`;

        const extendBtn = (validity && validity.soon && !expired)
            ? `<button class="cleanplaats-alerts-extend-btn" data-alert-id="${alert.id}" data-extend="1">${ALERTS_TEXT.extendButton}</button>`
            : '';

        return `
            <div class="cleanplaats-alerts-row-group cleanplaats-alerts-alert-${statusClass}" data-alert-id="${alert.id}">
                <div class="cleanplaats-alerts-row" role="row">
                    <span class="cleanplaats-alerts-cell cleanplaats-alerts-cell-name" role="cell">
                        <span class="cleanplaats-alerts-status-dot" title="${expired ? ALERTS_TEXT.validityExpired : (alert.enabled ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel)}"></span>
                        ${label}
                    </span>
                    <span class="cleanplaats-alerts-cell cleanplaats-alerts-cell-count" role="cell" data-label="${ALERTS_TEXT.tableFound}">${matchCell}</span>
                    <span class="cleanplaats-alerts-cell cleanplaats-alerts-cell-check" role="cell" data-label="${ALERTS_TEXT.tableCheck}"><span class="cleanplaats-alerts-cell-value">${checkText}</span></span>
                    <span class="cleanplaats-alerts-cell cleanplaats-alerts-cell-validity" role="cell" data-label="${ALERTS_TEXT.tableValidity}">${validityCell}</span>
                    <span class="cleanplaats-alerts-cell cleanplaats-alerts-cell-status" role="cell">${statusCell}</span>
                    <span class="cleanplaats-alerts-cell cleanplaats-alerts-cell-toggle" role="cell">
                        <button type="button" class="cleanplaats-alerts-row-toggle" data-row-toggle="${alert.id}" aria-expanded="false" aria-label="${ALERTS_TEXT.detailsShow}">${alertIcon('chevron', 16)}</button>
                    </span>
                </div>
                <div class="cleanplaats-alerts-row-details" hidden>
                    <div class="cleanplaats-alerts-details">
                        <div class="cleanplaats-alerts-details-row">
                            <span class="cleanplaats-alerts-details-label">${ALERTS_TEXT.detailsChannel}</span>
                            <span class="cleanplaats-alerts-details-controls">${telegramSwitch}${extendBtn}</span>
                        </div>
                        ${buildAlertFilterBlockHtml(alert)}
                        <div class="cleanplaats-alerts-details-row cleanplaats-alerts-details-row-danger">
                            <span class="cleanplaats-alerts-details-label">${ALERTS_TEXT.detailsRemove}</span>
                            <span class="cleanplaats-alerts-details-controls">
                                <button class="cleanplaats-alerts-text-btn cleanplaats-alerts-text-btn-danger cleanplaats-alerts-delete" data-alert-id="${alert.id}" data-alert-label="${escapeAlertText(alert.label)}">${alertIcon('trash', 14)}<span>${ALERTS_TEXT.deleteButton}</span></button>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // A grid rather than a <table>: the expandable detail row needs a full-width
    // block under each row, and inside a real table that meant a colspan cell
    // whose intrinsic width fought the fixed column widths.
    return `
        <div class="cleanplaats-alerts-tablelist" role="table" aria-label="${ALERTS_TEXT.navAlerts}">
            <div class="cleanplaats-alerts-row cleanplaats-alerts-row-head" role="row">
                <span role="columnheader">${ALERTS_TEXT.tableName}</span>
                <span role="columnheader">${ALERTS_TEXT.tableFound}</span>
                <span role="columnheader">${ALERTS_TEXT.tableCheck}</span>
                <span role="columnheader">${ALERTS_TEXT.tableValidity}</span>
                <span role="columnheader">${ALERTS_TEXT.tableStatus}</span>
                <span role="columnheader"><span class="cleanplaats-alerts-sr">${ALERTS_TEXT.detailsShow}</span></span>
            </div>
            ${rows}
        </div>
    `;
}

function renderAlertsDashboard(me, alerts, matches) {
    // Kept so the sub-views can render without refetching.
    cleanplaatsAlertsRuntime.cachedAlerts = alerts;
    cleanplaatsAlertsRuntime.cachedMatches = matches;

    const tierLabel = me.tier === 'premium' ? ALERTS_TEXT.tierPremium : ALERTS_TEXT.tierFree;
    const used = me.alertCount || 0;
    const usedFraction = me.maxAlerts > 0 ? Math.min(1, used / me.maxAlerts) : 0;

    const body = setAlertsBody(`
        <div class="cleanplaats-alerts-app">
            <aside class="cleanplaats-alerts-rail">
                <button type="button" class="cleanplaats-alerts-identity" id="cleanplaats-alerts-account-bar" aria-label="${ALERTS_TEXT.accountOpen}">
                    <span class="cleanplaats-alerts-identity-avatar">${alertIcon('user', 16)}</span>
                    <span class="cleanplaats-alerts-identity-copy">
                        <span class="cleanplaats-alerts-identity-email" title="${escapeAlertText(me.email)}">${escapeAlertText(me.email)}</span>
                        <span class="cleanplaats-alerts-identity-tier${me.tier === 'premium' ? ' is-premium' : ''}">${tierLabel}</span>
                    </span>
                    <span class="cleanplaats-alerts-identity-chevron" aria-hidden="true">${alertIcon('chevron', 15)}</span>
                </button>

                <nav class="cleanplaats-alerts-nav" aria-label="${ALERTS_TEXT.modalTitle}">
                    ${ALERTS_NAV_ITEMS.map(item => `
                        <button type="button" class="cleanplaats-alerts-nav-item" data-nav="${item.id}">
                            ${alertIcon(item.icon, 16)}<span>${item.label()}</span>
                        </button>
                    `).join('')}
                    <button type="button" class="cleanplaats-alerts-nav-item" data-nav-view="telegram">
                        ${alertIcon('send', 16)}<span>${ALERTS_TEXT.navTelegram}</span>
                        <span class="cleanplaats-alerts-nav-state ${me.telegramLinked ? 'on' : 'off'}" title="${me.telegramLinked ? ALERTS_TEXT.telegramLinked : ALERTS_TEXT.telegramNotLinked}">${me.telegramLinked ? ALERTS_TEXT.telegramLinked : ALERTS_TEXT.telegramNotLinked}</span>
                    </button>
                </nav>

                <div class="cleanplaats-alerts-rail-foot">
                    <div class="cleanplaats-alerts-quota">
                        <span class="cleanplaats-alerts-quota-top">
                            <span>${ALERTS_TEXT.navAlerts}</span>
                            <span class="cleanplaats-alerts-quota-count">${used} / ${me.maxAlerts}</span>
                        </span>
                        <span class="cleanplaats-alerts-quota-bar${usedFraction >= 1 ? ' is-full' : ''}"><span style="width:${Math.round(usedFraction * 100)}%"></span></span>
                        ${me.tier === 'premium' ? '' : `<button type="button" class="cleanplaats-alerts-quota-link" id="cleanplaats-alerts-open-pricing">${ALERTS_TEXT.quotaUpgrade}</button>`}
                    </div>
                    <button type="button" class="cleanplaats-alerts-text-btn cleanplaats-alerts-rail-contact" id="cleanplaats-alerts-contact-btn">${alertIcon('mail', 14)}<span>${ALERTS_TEXT.contactShort}</span></button>
                </div>
            </aside>

            <main class="cleanplaats-alerts-main" id="cleanplaats-alerts-main"></main>
        </div>
    `);
    if (!body) return;
    body.classList.add('cleanplaats-alerts-body-app');

    body.querySelectorAll('[data-nav]').forEach(button => {
        button.addEventListener('click', () => {
            cleanplaatsAlertsRuntime.view = button.dataset.nav;
            renderAlertsMainView();
        });
    });
    body.querySelector('[data-nav-view="telegram"]')?.addEventListener('click', openAlertsTelegramView);
    document.getElementById('cleanplaats-alerts-account-bar')?.addEventListener('click', renderAlertsAccountView);
    document.getElementById('cleanplaats-alerts-open-pricing')?.addEventListener('click', renderAlertsPricingView);
    wireAlertsContact();

    renderAlertsMainView();

    setAlertsRefreshVisible(true);
    setAlertsAccountVisible(true);
    storeAlertsSummary(alerts, matches);
    maybeRunAlertsWalkthrough(me, alerts);
}

/**
 * Telegram from the rail: the connect flow when there is nothing linked yet,
 * the channel's own screen (test message, relink, unlink) when there is.
 */
function openAlertsTelegramView() {
    const me = cleanplaatsAlertsRuntime.me;
    if (!me) return;
    if (!me.telegramLinked) {
        renderTelegramConnect(me);
        return;
    }
    renderAlertsChannelView();
}

function renderAlertsChannelView() {
    setAlertsBody(`
        ${alertsViewHeader(ALERTS_TEXT.channelsTitle)}
        <div class="cleanplaats-alerts-channel-list">
            <div class="cleanplaats-alerts-channel-row">
                <span class="cleanplaats-alerts-channel-icon on">${alertIcon('send', 18)}</span>
                <span class="cleanplaats-alerts-channel-info">
                    <span class="cleanplaats-alerts-channel-name">${ALERTS_TEXT.channelTelegram}</span>
                    <span class="cleanplaats-alerts-channel-sub cleanplaats-alerts-channel-sub-on">${ALERTS_TEXT.telegramLinked}</span>
                </span>
                <span class="cleanplaats-alerts-channel-actions">
                    <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alert-telegram-relink">${ALERTS_TEXT.telegramRelink}</button>
                    <button class="cleanplaats-alerts-text-btn cleanplaats-alerts-text-btn-danger" id="cleanplaats-alert-telegram-unlink">${ALERTS_TEXT.telegramUnlink}</button>
                </span>
            </div>
        </div>
        <div class="cleanplaats-alerts-test">
            <span class="cleanplaats-alerts-test-copy">${ALERTS_TEXT.telegramTestHint}</span>
            <button type="button" class="cleanplaats-alerts-secondary-btn" id="cleanplaats-alerts-test-btn">${ALERTS_TEXT.telegramTestButton}</button>
        </div>
    `);

    wireAlertsBackButton();
    wireAlertsTelegramButtons();
}

function renderAlertsMainView() {
    const main = document.getElementById('cleanplaats-alerts-main');
    const me = cleanplaatsAlertsRuntime.me;
    if (!main || !me) return;

    const alerts = cleanplaatsAlertsRuntime.cachedAlerts || [];
    const matches = cleanplaatsAlertsRuntime.cachedMatches || [];
    const view = alertsCurrentView();
    const context = getAlertSearchContext();

    document.querySelectorAll('.cleanplaats-alerts-nav-item[data-nav]').forEach(button => {
        const active = button.dataset.nav === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    let html;
    if (view === 'alerts') {
        html = `
            ${buildAlertsViewHead(ALERTS_TEXT.navAlerts, ALERTS_TEXT.alertsSub(me.maxAlerts))}
            ${buildAlertsCreateHtml(context, me)}
            ${buildAlertsTableHtml(alerts, me)}
        `;
    } else {
        const truncated = matches.length >= ALERT_MATCHES_PAGE_SIZE;
        html = `
            ${buildAlertsViewHead(ALERTS_TEXT.navMatches, ALERTS_TEXT.matchesSub)}
            ${buildAlertsStatusStripHtml(me, alerts)}
            ${buildAlertsChecklistHtml(me, alerts)}
            ${buildAlertMatchesSectionHtml(matches, ALERTS_TEXT.matchesTitle)}
            ${truncated ? `<div class="cleanplaats-alerts-matches-note">${ALERTS_TEXT.alertMatchesTruncated(ALERT_MATCHES_PAGE_SIZE)}</div>` : ''}
        `;
    }

    main.innerHTML = DOMPurify.sanitize(html);
    main.scrollTop = 0;
    wireAlertsMainEvents(main, view);
}

function buildAlertsViewHead(title, subtitle) {
    return `
        <div class="cleanplaats-alerts-view-head">
            <h4>${title}</h4>
            ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
    `;
}

// Roughly where a search stops making a useful alert. A well-aimed query sits
// far below it ("macbook air m1": 339, "eames stoel": 1.486), while the ones
// that bury you in notifications sit far above ("playstation 5": 20.033,
// "iphone": 40.204, "stoel": 337.959).
var CLEANPLAATS_ALERTS_BROAD_RESULT_COUNT = 5000;

/**
 * Warns before the fact when the search behind the box is so broad that the
 * alert would fire constantly. Stays silent on any failure: a missing count is
 * no reason to hold up the dashboard.
 *
 * `term` is what is actually in the input. While it matches the page we came
 * from, the page's filters (category, distance) count towards the total; once
 * it is edited, the alert would be a plain search for that word, so that is
 * what gets counted.
 */
function warnWhenSearchIsBroad(context, term) {
    const element = document.getElementById('cleanplaats-alert-broad-warning');
    if (!element) return;
    element.hidden = true;

    const typed = String(term == null ? '' : term).trim();
    const usesContext = Boolean(context && context.searchParams) &&
        (!typed || typed.toLowerCase() === context.suggestedLabel.trim().toLowerCase());

    const searchParams = usesContext
        ? context.searchParams
        : (typed ? { query: typed } : null);
    if (!searchParams) return;

    const params = new URLSearchParams({ limit: '1', offset: '0' });
    Object.entries(searchParams).forEach(([key, value]) => {
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

/**
 * Everything inside the main surface. Called after every render of it, so it
 * never assumes an element from another view is present.
 */
function wireAlertsMainEvents(main, view) {
    main.querySelectorAll('[data-nav-jump]').forEach(button => {
        button.addEventListener('click', () => {
            cleanplaatsAlertsRuntime.view = button.dataset.navJump;
            renderAlertsMainView();
        });
    });

    document.getElementById('cleanplaats-alert-telegram-link-notice')
        ?.addEventListener('click', () => renderTelegramConnect(cleanplaatsAlertsRuntime.me));

    wireAlertsCreateBox(main);
    wireAlertsRowToggles(main);
    wireAlertsRowControls(main);
    wireAlertFilterControls(main);
    wireAlertMatchLinks(main);

    if (view === 'matches') {
        wireAlertMatchesSort(() => cleanplaatsAlertsRuntime.cachedMatches);
    }

    main.querySelectorAll('[data-open-matches]').forEach(button => {
        button.addEventListener('click', () => renderAlertMatchesView(button.dataset.openMatches));
    });
}

function wireAlertsCreateBox(main) {
    const createButton = main.querySelector('#cleanplaats-alert-create');
    if (!createButton) return;

    const labelInput = main.querySelector('#cleanplaats-alert-label-input');
    const createNote = main.querySelector('#cleanplaats-alert-create-note');
    const suggestedTerm = (labelInput?.value || '').trim().toLowerCase();

    if (labelInput && createNote) {
        labelInput.addEventListener('input', () => {
            createNote.style.display =
                labelInput.value.trim().toLowerCase() === suggestedTerm ? '' : 'none';
        });
    }

    // The warning belongs to whatever is in the box, not to the page it was
    // opened from: someone who types a term of their own deserves the same
    // heads-up as someone who arrived from a broad search page.
    if (labelInput) {
        let debounce = null;
        labelInput.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => warnWhenSearchIsBroad(getAlertSearchContext(), labelInput.value), 500);
        });
    }
    warnWhenSearchIsBroad(getAlertSearchContext(), labelInput?.value);

    createButton.onclick = () => {
        const term = (labelInput?.value || '').trim();
        if (!term) {
            showBubbleNotification(ALERTS_TEXT.createTermMissing);
            if (labelInput) labelInput.focus();
            return;
        }

        // Out of room: explain the ceiling here rather than firing a request we
        // know the server will refuse.
        const me = cleanplaatsAlertsRuntime.me;
        if (me && (me.alertCount || 0) >= me.maxAlerts) {
            renderAlertsLimitView(cleanplaatsAlertsRuntime.cachedAlerts || []);
            return;
        }

        // Reuse the page's search context (category/location filters) only
        // while the term still matches it; an edited term is a new, plain
        // search.
        const context = getAlertSearchContext();
        const usesContext = Boolean(context) &&
            term.toLowerCase() === context.suggestedLabel.trim().toLowerCase();
        const searchParams = usesContext
            ? context.searchParams
            : { query: term };
        const searchUrl = usesContext
            ? context.searchUrl
            : `https://www.marktplaats.nl/q/${encodeURIComponent(term).replace(/%20/g, '+')}/`;

        createButton.disabled = true;
        alertsApiFetch('/api/alerts', {
            method: 'POST',
            body: JSON.stringify({ label: term, searchParams, searchUrl, filters: getDefaultAlertFilters() })
        }).then(() => {
            showBubbleNotification(ALERTS_TEXT.createdToast);
            cleanplaatsAlertsRuntime.view = 'alerts';
            loadAlertsDashboard();
        }).catch(error => {
            createButton.disabled = false;
            // 403 is the server's own limit check — reachable when this device's
            // count is stale (another browser added one).
            if (error.status === 403) {
                renderAlertsLimitView(cleanplaatsAlertsRuntime.cachedAlerts || []);
                return;
            }
            showBubbleNotification(error.message || ALERTS_TEXT.errorToast);
        });
    };
}

function wireAlertsRowToggles(main) {
    main.querySelectorAll('[data-row-toggle]').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const group = toggle.closest('.cleanplaats-alerts-row-group');
            const details = group?.querySelector('.cleanplaats-alerts-row-details');
            if (!details) return;
            const isOpen = !details.hasAttribute('hidden');
            if (isOpen) details.setAttribute('hidden', '');
            else details.removeAttribute('hidden');
            toggle.setAttribute('aria-expanded', String(!isOpen));
            group.classList.toggle('is-open', !isOpen);
        });
    });
}

function wireAlertsRowControls(main) {
    main.querySelectorAll('.cleanplaats-alerts-delete').forEach(button => {
        button.onclick = () => {
            openAlertsConfirm({
                title: ALERTS_TEXT.deleteConfirmTitle,
                body: ALERTS_TEXT.deleteConfirmBody(button.dataset.alertLabel || ''),
                confirmLabel: ALERTS_TEXT.deleteConfirmOk,
                onConfirm: () => {
                    alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, { method: 'DELETE' })
                        .then(() => {
                            showBubbleNotification(ALERTS_TEXT.deletedToast);
                            loadAlertsDashboard();
                        })
                        .catch(error => showBubbleNotification((error && error.message) || ALERTS_TEXT.errorToast));
                }
            });
        };
    });

    main.querySelectorAll('.cleanplaats-alerts-switch-status').forEach(button => {
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
                const group = button.closest('.cleanplaats-alerts-row-group');
                if (group) {
                    group.classList.toggle('cleanplaats-alerts-alert-active', nextEnabled);
                    group.classList.toggle('cleanplaats-alerts-alert-paused', !nextEnabled);
                }
                // The strip counts running searches, so it is now out of date.
                const cached = (cleanplaatsAlertsRuntime.cachedAlerts || [])
                    .find(alert => String(alert.id) === String(button.dataset.alertId));
                if (cached) cached.enabled = nextEnabled ? 1 : 0;
            }).catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });

    main.querySelectorAll('.cleanplaats-alerts-extend-btn').forEach(button => {
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

    main.querySelectorAll('.cleanplaats-alerts-switch[data-channel]').forEach(button => {
        button.onclick = () => {
            // A locked Telegram toggle (nothing linked yet) can't carry a
            // setting, so clicking it kicks off the connect flow instead.
            if (button.dataset.locked === '1') {
                renderTelegramConnect(cleanplaatsAlertsRuntime.me);
                return;
            }
            const next = button.dataset.value !== '1';
            // Telegram is the only channel with a switch; the e-mail one is gone
            // while server-side e-mail notifications are off.
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ notifyTelegram: next })
            }).then(() => {
                button.dataset.value = next ? '1' : '0';
                button.setAttribute('aria-checked', String(next));
                button.classList.toggle('on', next);
            }).catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });
}

/** Relink, unlink and the test message: only present on the channel view. */
function wireAlertsTelegramButtons() {
    document.getElementById('cleanplaats-alert-telegram-relink')
        ?.addEventListener('click', () => renderTelegramConnect(cleanplaatsAlertsRuntime.me));

    const unlink = document.getElementById('cleanplaats-alert-telegram-unlink');
    if (unlink) {
        unlink.onclick = () => {
            openAlertsConfirm({
                title: ALERTS_TEXT.telegramUnlink,
                body: ALERTS_TEXT.telegramUnlinkConfirm,
                confirmLabel: ALERTS_TEXT.telegramUnlink,
                onConfirm: () => {
                    alertsApiFetch('/api/telegram/unlink', { method: 'POST' })
                        .then(() => {
                            showBubbleNotification(ALERTS_TEXT.telegramUnlinkedToast);
                            loadAlertsDashboard();
                        })
                        .catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
                }
            });
        };
    }

    const test = document.getElementById('cleanplaats-alerts-test-btn');
    if (test) {
        test.onclick = () => {
            test.disabled = true;
            test.textContent = ALERTS_TEXT.telegramTestSending;
            alertsApiFetch('/api/telegram/test', { method: 'POST' })
                .then(() => showBubbleNotification(ALERTS_TEXT.telegramTestToast))
                .catch(error => showBubbleNotification((error && error.message) || ALERTS_TEXT.errorToast))
                .then(() => {
                    if (!test.isConnected) return;
                    test.disabled = false;
                    test.textContent = ALERTS_TEXT.telegramTestButton;
                });
        };
    }
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
    // Every link out of the panel goes to a new tab: the overlay lives on the
    // Marktplaats page, so navigating in place would throw it away.
    (container || document).querySelectorAll('.cleanplaats-alerts-match, .cleanplaats-alerts-card-label[href], .cleanplaats-alerts-subview-link[href]').forEach(link => {
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

    // The create box lives on the Zoekmeldingen view; from the advertisements
    // view the checklist is what points at it, so the tour follows whichever of
    // the two is actually on screen.
    const createSelector = document.getElementById('cleanplaats-alert-label-input')
        ? '.cleanplaats-alerts-create'
        : (document.querySelector('.cleanplaats-alerts-setup') ? '.cleanplaats-alerts-setup' : '');
    if (createSelector) {
        const hasContext = Boolean(getAlertSearchContext());
        steps.push({
            selector: createSelector,
            title: ALERTS_WALKTHROUGH_TEXT.createTitle,
            body: hasContext ? ALERTS_WALKTHROUGH_TEXT.createBody : ALERTS_WALKTHROUGH_TEXT.createBodyPlain
        });
    }

    if (me.telegramLinked) {
        steps.push({
            selector: '.cleanplaats-alerts-nav-item[data-nav-view="telegram"]',
            title: ALERTS_WALKTHROUGH_TEXT.telegramLinkedTitle,
            body: ALERTS_WALKTHROUGH_TEXT.telegramLinkedBody
        });
    } else {
        steps.push({
            selector: '.cleanplaats-alerts-setup',
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
    // Capture: on the wide dashboard the body is a grid and its two columns do
    // the scrolling, and scroll events don't bubble.
    document.getElementById('cleanplaats-alerts-body')
        ?.addEventListener('scroll', cleanplaatsAlertsRuntime.walkthroughReposition, true);
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
            ?.removeEventListener('scroll', cleanplaatsAlertsRuntime.walkthroughReposition, true);
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
