/**
 * Cleanplaats zoekopdrachten (search alerts).
 *
 * The extension is only the UI: alerts live on the Cleanplaats Alerts server
 * (see server/README.md), which polls the site around the clock and notifies
 * via e-mail/Telegram. Auth is an e-mail account with passwordless login
 * codes; this device stores a session token, so alerts and premium follow the
 * account across devices.
 *
 * The UI is a full-screen overlay (not the small panel popup): it renders a
 * login view, then a dashboard with stats, alert cards and a match feed.
 */

// Our own zone, not the workers.dev host: only a zone we own can carry WAF and
// rate limiting rules, and those are what keep the API from being a bill.
var CLEANPLAATS_ALERTS_API_BASE = 'https://api.cleanplaats.com';
var CLEANPLAATS_ALERTS_TOKEN_KEY = 'cleanplaatsAlertsToken';
var CLEANPLAATS_ALERTS_API_BASE_KEY = 'cleanplaatsAlertsApiBase';

// Mirrors the LIMIT in the server's /api/matches. Only used to tell the user
// when a list is showing everything versus only the most recent slice; if the
// two ever drift the note is slightly off, nothing breaks.
var ALERT_MATCHES_PAGE_SIZE = 60;

/**
 * The sites you can make a zoekopdracht on, and how each one is named and
 * linked. `comingSoon` holds a site back from the entry point while the rest
 * of it already works, which is what 2ememain sat behind until the panel had
 * French copy to show.
 *
 * An account is not tied to a site, so a zoekopdracht made on one site shows
 * up in the panel on the other. buildAlertsTableHtml() badges those rows
 * rather than hiding them: filtering them out makes an alert someone is still
 * paying attention to look deleted.
 */
var CLEANPLAATS_ALERT_SITES = {
    marktplaats: { origin: 'https://www.marktplaats.nl', name: 'Marktplaats' },
    '2dehands': { origin: 'https://www.2dehands.be', name: '2dehands' },
    '2ememain': { origin: 'https://www.2ememain.be', name: '2ememain' }
};

function isAlertsSiteSupported() {
    const site = CLEANPLAATS_ALERT_SITES[getCleanplaatsSiteKey()];
    return Boolean(site) && !site.comingSoon;
}

// The site this page is on, falling back to Marktplaats so the copy still reads
// as a sentence if this ever runs somewhere unexpected.
function getAlertsSiteName(siteKey) {
    const site = CLEANPLAATS_ALERT_SITES[siteKey || getCleanplaatsSiteKey()];
    return site ? site.name : CLEANPLAATS_ALERT_SITES.marktplaats.name;
}

function getAlertsSiteOrigin(siteKey) {
    const site = CLEANPLAATS_ALERT_SITES[siteKey || getCleanplaatsSiteKey()];
    return site ? site.origin : CLEANPLAATS_ALERT_SITES.marktplaats.origin;
}

// Fixed for the lifetime of the page, and read from ALERTS_TEXT below, so it is
// resolved once here rather than at every use.
var CLEANPLAATS_ALERTS_SITE_NAME = getAlertsSiteName();

// The language the panel is written in, which the server is told on every call
// so its answers come back in the same one.
var CLEANPLAATS_ALERTS_LANG = is2ememainLocale() ? 'fr' : 'nl';

// Month names have to follow the panel's language, so dates take the site's
// locale. "14 sept." is what 2ememain itself prints.
var CLEANPLAATS_ALERTS_DATE_LOCALE = is2ememainLocale() ? 'fr-BE' : 'nl-NL';

// Amounts do not. All three sites render prices as "€ 1.850,00" — dot for
// thousands, comma for decimals — while fr-BE groups with a space ("1 850,50"),
// which would read as a foreign number right next to the site's own prices.
// Checked against a live 2ememain result page, not assumed from the language.
var CLEANPLAATS_ALERTS_NUMBER_LOCALE = 'nl-NL';

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
    openAlertMatchesId: null,
    // The filters set in the create box, the categories/counts the site last
    // handed back for them, and whether the block is folded open. Kept on the
    // runtime rather than read back off the DOM because the dashboard re-renders
    // whole (after a create, after a row PATCH) and a half-filled form must
    // survive that. Cleared on close and after a successful create.
    createDraft: null,
    createFacets: null,
    createFacetsSeq: 0,
    createFilterOpen: false,
    // The params the last facet request went out with, so a re-render of the
    // dashboard repaints from what is already here instead of asking the site
    // the same question again.
    createFacetsKey: '',
    // Set when the label input was prefilled with a name rather than a search
    // term (a category page has no term). While the input still reads exactly
    // this, it names the alert and nothing more. See alertCreateQueryTerm().
    createLabelOnly: '',
    // One render's worth of "start over": set after a create so the box does not
    // immediately fill itself back up from the page behind the panel.
    createCleared: false,
    // The site's main categories. Fetched once and kept: the list never changes
    // with the search term, and the ordinary request cannot supply it (see
    // loadAlertMainCategories).
    createMainCategories: null,
    // The subcategories of the main category in the box, as { l1, items }, from
    // the last answer that still listed them all. Once a subcategory is
    // selected the site narrows its category facet to that one subcategory:
    // right for the count, useless for a dropdown that has to keep offering the
    // siblings. See paintAlertCategoryOptions().
    createSubCategories: null
};

/**
 * One word per thing, everywhere:
 *   zoekopdracht - the saved Marktplaats search we watch, which is also what
 *                  you switch on here (never "zoekmelding", never "alert")
 *   melding      - the Telegram message it sends, never the search itself
 *   gevonden     - what it turned up
 */
var ALERTS_TEXT_NL = {
    modalTitle: 'Zoekopdrachten',
    tagline: 'Krijg nieuwe advertenties direct in je Telegram, ook als je browser dicht is.',
    intro: 'Krijg een melding zodra er een nieuwe advertentie verschijnt die aan je zoekopdracht voldoet, ook als je browser dicht is. Je Cleanplaats-filters worden automatisch toegepast.',

    // Login: what it does first, the e-mail field second. Asking for an address
    // before showing anything is how you lose people who were only curious.
    loginTitle: 'Zoek verder terwijl je iets anders doet',
    loginIntro: `Cleanplaats blijft op ${CLEANPLAATS_ALERTS_SITE_NAME} zoeken zodra jij weg bent, en stuurt je een bericht als er iets nieuws verschijnt.`,
    loginBullets: [
        { icon: 'zap', text: 'Bericht binnen enkele minuten nadat een advertentie geplaatst is' },
        { icon: 'send', text: 'Via Telegram, dus ook als je browser dicht is' },
        { icon: 'filter', text: 'Je Cleanplaats-filters en blokkades tellen gewoon mee' }
    ],
    // Zoekopdrachten went live with this release, so the screen that asks for
    // an address says so before anyone commits to it. It asks for the report
    // rather than disclaiming the bug: a warning invites people to distrust
    // the notifications, an invitation gets them to tell us when one misses.
    loginNewTitle: 'Net gelanceerd',
    loginNewBody: 'Zoekopdrachten is net gelanceerd. ' +
        'Werkt er iets niet zoals je verwacht? Laat het weten via info@cleanplaats.com, dan lossen we het op.',

    loginFormTitle: 'Maak een account of log in',
    loginFormHint: 'Gratis, en zonder wachtwoord: je krijgt een inlogcode per e-mail.',
    loginPrivacy: 'We gebruiken je e-mailadres om je in te laten loggen en je zoekopdrachten aan te koppelen, verder niets.',
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
    emailInvalid: 'Vul een geldig e-mailadres in.',
    codeSixDigits: 'Vul de 6-cijferige code in.',
    logout: 'Uitloggen',
    logoutHint: 'Je logt alleen op dit apparaat uit. Je zoekopdrachten blijven gewoon doorlopen.',
    tierFree: 'Gratis',
    tierPremium: 'Premium',
    usageLabel: n => (n === 1 ? 'zoekopdracht' : 'zoekopdrachten'),
    checkFrequency: m => `Controleert elke ${m} minuten`,
    createTitle: 'Maak een zoekopdracht',
    createButton: 'Zoekopdracht maken',
    labelPlaceholder: 'Zoekterm, bijv. iphone 15 pro',
    createTermMissing: 'Vul een zoekterm in.',
    createContextHint: `De filters van je zoekresultaten op ${CLEANPLAATS_ALERTS_SITE_NAME} staan hieronder al ingevuld.`,
    createBroadWarning: count => `Deze zoekopdracht is breed: ${count.toLocaleString(CLEANPLAATS_ALERTS_NUMBER_LOCALE)} advertenties. ` +
        'Je krijgt er waarschijnlijk veel meldingen van. Verfijn hem eerst met een prijs, categorie of afstand.',

    // The filters you can set on the search itself, in the create box. Named
    // one by one on the trigger: "Verfijnen" alone left people assuming the
    // panel could only watch a plain search term.
    createFilterTrigger: 'Categorie, prijs en afstand',
    createFilterNone: 'Instellen',
    createFilterCategory: 'Categorie',
    createFilterCategoryAll: 'Alle categorieën',
    createFilterSubcategory: 'Subcategorie',
    createFilterSubcategoryAll: 'Hele categorie',
    createFilterCategoryRelevant: 'Past bij je zoekterm',
    createFilterCategoryOther: 'Overige categorieën',
    createFilterCategoryLoading: 'Categorieën laden…',
    createFilterPrice: 'Prijs',
    createFilterPriceFrom: 'Vanaf',
    createFilterPriceTo: 'Tot',
    createFilterDistance: 'Afstand',
    createFilterPostcode: 'Postcode',
    createFilterDistanceAll: 'Alle afstanden',
    createFilterDistanceOption: km => `Binnen ${km} km`,
    createFilterPostcodeInvalid: 'Vul een geldige postcode in, bijvoorbeeld 1011 AB of 2000.',
    createResultCount: count => (count === 1
        ? '1 advertentie op dit moment'
        : `${count.toLocaleString(CLEANPLAATS_ALERTS_NUMBER_LOCALE)} advertenties op dit moment`),
    createResultCountNone: 'Geen advertenties. Verruim je filters.',
    listTitle: 'Jouw zoekopdrachten',
    empty: `Je hebt nog geen zoekopdrachten. Zoek iets op ${CLEANPLAATS_ALERTS_SITE_NAME} en zet je eerste zoekopdracht aan.`,
    deleteButton: 'Verwijder',
    deleteConfirmTitle: 'Zoekopdracht verwijderen?',
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
    extendedToast: 'Zoekopdracht verlengd.',
    reactivatedToast: 'Zoekopdracht gereactiveerd.',
    channelTelegram: 'Telegram',
    matchesTitle: 'Nieuw gevonden',
    matchesEmpty: 'Nog niets binnengekomen. Zodra er een nieuwe advertentie verschijnt die aan een van je zoekopdrachten voldoet, zie je die hier.',
    newBadge: 'NIEUW',
    // The snapshot an alert takes on its first poll. It is not a find, so it
    // sits apart from the feed and out of the counts.
    baselineTitle: n => `Stond er al (${n})`,
    baselineHint: 'Deze advertenties stonden er al toen je deze zoekopdracht aanmaakte. Je krijgt er geen melding van.',
    channelsTitle: 'Hoe je meldingen ontvangt',
    telegramLinked: 'Gekoppeld',
    telegramNotLinked: 'Nog niet gekoppeld',
    telegramLockedHint: 'Koppel eerst Telegram om hier meldingen via Telegram te krijgen. Klik om te koppelen.',
    // Telegram is the only delivery channel, so an unlinked account gets
    // nothing pushed to it — say that plainly instead of letting people wait.
    // It is not a soft limitation either: after the grace window the poller
    // stops checking the search altogether, so the copy names that too.
    telegramRequiredTitle: 'Je ontvangt nog geen meldingen',
    telegramRequiredBody: hours => 'Meldingen gaan via Telegram. Zonder koppeling controleren we een nieuwe zoekopdracht nog ' +
        `${hours} uur en daarna stopt hij. Wat we in die tijd vinden, zie je gewoon in dit paneel.`,
    telegramRequiredButton: 'Telegram koppelen',
    // The second line of a row's validity column while nothing is linked. It is
    // the deadline that bites first: the search may be valid for another two
    // weeks, but without a channel the checks stop long before that.
    unlinkedStops: h => (h <= 1
        ? 'Stopt binnen een uur zonder Telegram'
        : `Stopt over ${h} uur zonder Telegram`),
    unlinkedStopped: 'Gestopt tot je Telegram koppelt',
    // Turning the channel off is the same thing as pausing while Telegram is
    // the only way we reach anyone, so say so before doing both.
    telegramOffPauseTitle: 'Zoekopdracht gaat op pauze',
    telegramOffPauseBody: 'Telegram is de enige manier waarop we je bereiken. Zet je hem uit, dan pauzeren we deze zoekopdracht ook, zodat we niet blijven zoeken naar iets waar je niets van hoort.',
    telegramOffPauseConfirm: 'Uitzetten en pauzeren',
    telegramOffPausedToast: 'Telegram uit. Deze zoekopdracht staat nu op pauze.',
    telegramOnResumedToast: 'Telegram aan. Deze zoekopdracht loopt weer.',
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
    createdToast: 'Zoekopdracht aangemaakt! We kijken eerst wat er nu al staat, daarna krijg je een melding zodra er iets nieuws bij komt.',
    deletedToast: 'Zoekopdracht verwijderd.',
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
    filterEditorIntro: 'Vink aan welke soorten advertenties je voor deze zoekopdracht níét wilt zien.',
    filterDagtoppers: 'Dagtoppers',
    filterReserved: 'Gereserveerd',
    filterOpval: 'Opvalstickers',
    filterCountActive: n => `${n} actief`,
    filterNoneActive: 'Alles tonen',
    filterAlwaysExcluded: 'Top- en bedrijfsadvertenties krijg je nooit als melding.',
    filterGlobalListsTitle: 'Geblokkeerde verkopers & woorden',
    filterGlobalListsHint: 'Deze gelden voor al je zoekopdrachten. Beheren doe je in het Cleanplaats-paneel.',
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
    navAlerts: 'Zoekopdrachten',
    navTelegram: 'Meldingen',
    matchesSub: 'Alles wat je zoekopdrachten sinds hun start hebben gevonden.',
    alertsSub: max => (max === 1
        ? 'Eén zoekopdracht tegelijk op een gratis account. Zet hem aan, uit of verleng hem hier.'
        : `Tot ${max} zoekopdrachten tegelijk. Zet ze aan, uit of verleng ze hier.`),
    quotaUpgrade: 'Meer tegelijk laten lopen',
    contactShort: 'Vragen of feedback',

    // The one status line above the advertisements. Anything that would not
    // change what you do next does not belong here.
    stripRunning: n => `${n} ${n === 1 ? 'zoekopdracht loopt' : 'zoekopdrachten lopen'}`,
    stripIdle: 'Er loopt nu geen zoekopdracht, dus er komt niets binnen.',
    stripUnlinked: 'Telegram is niet gekoppeld, dus er wordt niets naar je verstuurd.',
    stripFailing: `We kunnen ${CLEANPLAATS_ALERTS_SITE_NAME} even niet bereiken. Zodra dat weer lukt, gaat het zoeken door.`,

    // Table headers on the Zoekopdrachten view.
    tableName: 'Zoekopdracht',
    tableFound: 'Gevonden',
    tableCheck: 'Volgende controle',
    tableValidity: 'Geldig',
    tableStatus: 'Status',
    detailsChannel: 'Meldingen',
    detailsRemove: 'Verwijderen',
    createAtLimitHint: max => (max === 1
        ? 'Je hebt al een zoekopdracht lopen. Verwijder hem eerst, dan kun je een nieuwe aanzetten.'
        : 'Je zit op je maximum. Verwijder er een om ruimte te maken.'),

    // Activation checklist. Three things stand between a fresh account and a
    // notification landing on someone's phone, and they are the same three for
    // everyone, so they are a list to work through rather than a warning to
    // read. The first is already done by the time it is on screen, which is
    // what makes the other two feel like finishing something.
    setupTitle: left => (left === 1 ? 'Nog één stap en je bent klaar' : `Nog ${left === 2 ? 'twee' : left} stappen en je bent klaar`),
    setupProgress: (done, total) => `${done} van ${total} klaar`,
    setupAccountTitle: 'Account gemaakt',
    setupAccountBody: 'Je zoekopdrachten volgen je e-mailadres, ook op een ander apparaat.',
    setupAlertTitle: 'Zet je eerste zoekopdracht aan',
    setupAlertBody: `Vul hieronder een zoekterm in en kies er een categorie, prijs en afstand bij. Zoek je eerst op ${CLEANPLAATS_ALERTS_SITE_NAME}, dan staan die filters al klaar.`,
    setupAlertBodyDone: n => `Je hebt ${n} ${n === 1 ? 'zoekopdracht' : 'zoekopdrachten'} lopen.`,
    setupTelegramTitle: 'Koppel Telegram',
    // Says what actually happens: without a linked chat the server stops
    // checking the search after a day. Promising a next check we do not make
    // would be the one thing worse than the warning itself.
    setupTelegramBody: hours => `Telegram is de manier waarop we je bereiken. Zonder koppeling stopt de controle na ${hours} uur.`,
    setupTelegramBodyDone: 'Gekoppeld. Meldingen komen binnen in je Telegram-chat.',
    setupTelegramAction: 'Koppelen',

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

    // Per-alert match view — the shared feed, narrowed to one search.
    alertMatchesOpen: label => `Bekijk de gevonden advertenties van ${label}`,
    alertMatchesTitle: 'Gevonden advertenties',
    alertMatchesSearchLink: siteName => `Open deze zoekopdracht op ${siteName}`,
    // Shown on a row belonging to another site, so a zoekopdracht made on
    // 2dehands is recognisable as such from the Marktplaats panel.
    alertOtherSiteTitle: siteName => `Deze zoekopdracht loopt op ${siteName}`,
    alertMatchesEmpty: 'Deze zoekopdracht heeft nog niets nieuws gevonden. Zodra er een advertentie bij komt die eraan voldoet, zie je die hier.',
    alertMatchesError: 'We konden de advertenties van deze zoekopdracht niet laden. Probeer het zo nog eens.',
    alertMatchesTruncated: n => `Je ziet de ${n} recentste advertenties van deze zoekopdracht.`,

    // Limit view — shown when someone tries to add one too many.
    limitTitle: 'Je zit op je maximum',
    limitUsage: (used, max) => `${used} van ${max} ${max === 1 ? 'zoekopdracht' : 'zoekopdrachten'} in gebruik`,
    limitBody: max => (max === 1
        ? 'Met een gratis account loopt er één zoekopdracht tegelijk. Verwijder hieronder de huidige om ruimte te maken voor je nieuwe.'
        : `Met een gratis account kun je ${max} zoekopdrachten tegelijk laten lopen. ` +
          'Verwijder er hieronder een om ruimte te maken voor je nieuwe.'),
    limitListTitle: 'Jouw lopende zoekopdrachten',
    limitPremiumTitle: 'Meer tegelijk laten lopen?',
    limitPremiumBody: (plan, freePlan) => `Premium geeft je ${plan.maxAlerts} zoekopdrachten in plaats van ` +
        `${freePlan.maxAlerts}, en controleert elke ${plan.intervalMinutes} minuten in plaats van ` +
        `${freePlan.intervalMinutes}. Het is er nog niet en wat er precies in komt kan nog veranderen, ` +
        'maar we laten het weten zodra het zover is.',
    limitFreedToast: 'Er is weer ruimte. Zet je nieuwe zoekopdracht aan.',

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
    // Nothing here is sold yet, so the list is a plan and not a promise. Saying
    // that on the card itself is cheaper than disappointing someone later.
    pricingPremiumProvisional: 'Premium is nog in de maak. Wat er precies in komt, staat nog niet vast en kan nog veranderen.',
    pricingFeatureAlerts: n => `${n} ${n === 1 ? 'zoekopdracht' : 'zoekopdrachten'} tegelijk`,
    pricingFeatureInterval: m => `Controle elke ${m} minuten`,
    pricingFeatureIntervalFaster: (m, freeM) => `Drie keer sneller: elke ${m} minuten in plaats van ${freeM}`,
    pricingFeatureAlertsMore: (n, freeN) => `${n} zoekopdrachten tegelijk in plaats van ${freeN}`,
    pricingFeatureValidity: d => `${d} dagen geldig per zoekopdracht`,
    pricingFeatureValidityLonger: (d, freeD) => `${d} dagen geldig in plaats van ${freeD}`,
    pricingFeatureTelegram: 'Meldingen via Telegram',
    pricingFeatureFilters: 'Je Cleanplaats-filters werken door in je meldingen',
    pricingFeatureBlocklist: 'Geblokkeerde verkopers en woorden tellen mee',
    pricingFeatureOneClick: `Zoekopdracht aanzetten vanaf je zoekresultaten op ${CLEANPLAATS_ALERTS_SITE_NAME}`,
    pricingFeatureFeed: 'Overzicht van alle gevonden advertenties',

    // Filters are pushed to the server on every dashboard load. Both ways that
    // can go wrong leave the alerts filtering on something other than what the
    // panel shows, which is exactly the kind of thing that must not fail
    // quietly.
    filtersTooLargeToast: 'Je blokkeerlijsten zijn te groot om mee te sturen. Je zoekopdrachten gebruiken nu een oudere versie.',
    filtersTrimmedToast: count => `Je blokkeerlijsten zijn erg lang. Je zoekopdrachten gebruiken de eerste ${count} per lijst.`
};

/**
 * The same panel in French, for 2ememain.
 *
 * One word per thing here too, mirroring the Dutch:
 *   recherche    - the saved search we watch, which is also what you switch on
 *                  here (never "alerte" for the search itself)
 *   notification - the Telegram message it sends, never the search
 *   trouvee      - what it turned up
 */
var ALERTS_TEXT_FR = {
    modalTitle: 'Recherches',
    tagline: 'Recevez les nouvelles annonces directement dans Telegram, même navigateur fermé.',
    intro: 'Recevez une notification dès qu’une nouvelle annonce correspond à votre recherche, même navigateur fermé. Vos filtres Cleanplaats sont appliqués automatiquement.',

    loginTitle: 'Continuez à chercher pendant que vous faites autre chose',
    loginIntro: `Cleanplaats continue à chercher sur ${CLEANPLAATS_ALERTS_SITE_NAME} une fois que vous êtes parti, et vous prévient dès que quelque chose de nouveau apparaît.`,
    loginBullets: [
        { icon: 'zap', text: 'Un message quelques minutes après la mise en ligne d’une annonce' },
        { icon: 'send', text: 'Via Telegram, donc même navigateur fermé' },
        { icon: 'filter', text: 'Vos filtres et blocages Cleanplaats comptent aussi' }
    ],
    loginNewTitle: 'Tout juste lancé',
    loginNewBody: 'Les recherches viennent d’être lancées. ' +
        'Quelque chose ne fonctionne pas comme prévu ? Écrivez à info@cleanplaats.com et nous le corrigerons.',

    loginFormTitle: 'Créez un compte ou connectez-vous',
    loginFormHint: 'Gratuit, et sans mot de passe : vous recevez un code de connexion par e-mail.',
    loginPrivacy: 'Nous utilisons votre adresse e-mail pour vous connecter et y rattacher vos recherches, rien de plus.',
    loginPrivacyLink: 'Politique de confidentialité',
    loginTermsLink: 'Conditions',
    emailPlaceholder: 'votre@email.be',
    emailButton: 'Envoyer le code',
    emailSending: 'Envoi…',
    codeSentTo: email => `Nous avons envoyé un code à 6 chiffres à ${email}.`,
    codePlaceholder: '000000',
    codeButton: 'Se connecter',
    codeChecking: 'Vérification…',
    codeResend: 'Envoyer un nouveau code',
    codeResending: 'Envoi…',
    codeResent: 'Nouveau code envoyé.',
    codeOtherEmail: 'Autre adresse e-mail',
    emailInvalid: 'Saisissez une adresse e-mail valide.',
    codeSixDigits: 'Saisissez le code à 6 chiffres.',
    logout: 'Se déconnecter',
    logoutHint: 'Vous vous déconnectez uniquement sur cet appareil. Vos recherches continuent de tourner.',
    tierFree: 'Gratuit',
    tierPremium: 'Premium',
    usageLabel: n => (n === 1 ? 'recherche' : 'recherches'),
    checkFrequency: m => `Vérifie toutes les ${m} minutes`,
    createTitle: 'Créer une recherche',
    createButton: 'Créer la recherche',
    labelPlaceholder: 'Terme, par ex. iphone 15 pro',
    createTermMissing: 'Saisissez un terme de recherche.',
    createContextHint: `Les filtres de vos résultats sur ${CLEANPLAATS_ALERTS_SITE_NAME} sont déjà repris ci-dessous.`,
    createBroadWarning: count => `Cette recherche est large : ${count.toLocaleString(CLEANPLAATS_ALERTS_NUMBER_LOCALE)} annonces. ` +
        'Vous en recevrez probablement beaucoup de notifications. Affinez-la d’abord avec un prix, une catégorie ou une distance.',

    createFilterTrigger: 'Catégorie, prix et distance',
    createFilterNone: 'Régler',
    createFilterCategory: 'Catégorie',
    createFilterCategoryAll: 'Toutes les catégories',
    createFilterSubcategory: 'Sous-catégorie',
    createFilterSubcategoryAll: 'Toute la catégorie',
    createFilterCategoryRelevant: 'Correspond à votre terme',
    createFilterCategoryOther: 'Autres catégories',
    createFilterCategoryLoading: 'Chargement des catégories…',
    createFilterPrice: 'Prix',
    createFilterPriceFrom: 'À partir de',
    createFilterPriceTo: 'Jusqu’à',
    createFilterDistance: 'Distance',
    createFilterPostcode: 'Code postal',
    createFilterDistanceAll: 'Toutes les distances',
    createFilterDistanceOption: km => `Moins de ${km} km`,
    createFilterPostcodeInvalid: 'Saisissez un code postal valide, par exemple 2000 ou 1011 AB.',
    createResultCount: count => (count === 1
        ? '1 annonce en ce moment'
        : `${count.toLocaleString(CLEANPLAATS_ALERTS_NUMBER_LOCALE)} annonces en ce moment`),
    createResultCountNone: 'Aucune annonce. Élargissez vos filtres.',
    listTitle: 'Vos recherches',
    empty: `Vous n’avez pas encore de recherche. Cherchez quelque chose sur ${CLEANPLAATS_ALERTS_SITE_NAME} et activez votre première recherche.`,
    deleteButton: 'Supprimer',
    deleteConfirmTitle: 'Supprimer la recherche ?',
    deleteConfirmBody: label => `"${label}" cesse de chercher et les annonces trouvées disparaissent de votre aperçu.`,
    deleteConfirmOk: 'Supprimer',
    confirmCancel: 'Annuler',
    detailsShow: 'Réglages',
    detailsHide: 'Réglages',
    pausedLabel: 'En pause',
    activeLabel: 'Active',
    matchCount: count => `${count} trouvée${count === 1 ? '' : 's'}`,
    lastChecked: 'Dernière vérification',
    neverChecked: 'Pas encore vérifiée',
    nextCheckIn: m => `Prochaine vérification dans ${m} minute${m === 1 ? '' : 's'}`,
    nextCheckSoon: 'Prochaine vérification : bientôt',
    checkFailing: 'La vérification échoue pour l’instant, nous continuons d’essayer',
    checkFailingSince: at => `Dernière réussite : ${at}`,
    checkFailingNever: 'Nous n’avons pas encore réussi à charger cette recherche',
    refreshButton: 'Actualiser',
    validityLeft: n => `Expire dans ${n} jour${n === 1 ? '' : 's'}`,
    validityExpired: 'Expirée',
    extendButton: 'Prolonger',
    reactivateButton: 'Réactiver',
    extendedToast: 'Recherche prolongée.',
    reactivatedToast: 'Recherche réactivée.',
    channelTelegram: 'Telegram',
    matchesTitle: 'Nouveautés trouvées',
    matchesEmpty: 'Rien n’est encore arrivé. Dès qu’une nouvelle annonce correspond à une de vos recherches, elle apparaît ici.',
    newBadge: 'NOUVEAU',
    baselineTitle: n => `Déjà en ligne (${n})`,
    baselineHint: 'Ces annonces étaient déjà en ligne quand vous avez créé cette recherche. Vous n’en recevez pas de notification.',
    channelsTitle: 'Comment vous recevez vos notifications',
    telegramLinked: 'Lié',
    telegramNotLinked: 'Pas encore lié',
    telegramLockedHint: 'Liez d’abord Telegram pour recevoir les notifications par ce canal. Cliquez pour lier.',
    telegramRequiredTitle: 'Vous ne recevez pas encore de notifications',
    telegramRequiredBody: hours => 'Les notifications passent par Telegram. Sans liaison, nous vérifions une nouvelle recherche ' +
        `encore ${hours} heures, puis elle s’arrête. Ce que nous trouvons entre-temps reste visible dans ce panneau.`,
    telegramRequiredButton: 'Lier Telegram',
    unlinkedStops: h => (h <= 1
        ? 'S’arrête dans une heure sans Telegram'
        : `S’arrête dans ${h} heures sans Telegram`),
    unlinkedStopped: 'Arrêtée jusqu’à ce que vous liiez Telegram',
    telegramOffPauseTitle: 'La recherche passe en pause',
    telegramOffPauseBody: 'Telegram est le seul moyen que nous ayons de vous joindre. Si vous le coupez, nous mettons aussi cette recherche en pause, pour ne pas continuer à chercher quelque chose dont vous n’entendrez jamais parler.',
    telegramOffPauseConfirm: 'Couper et mettre en pause',
    telegramOffPausedToast: 'Telegram coupé. Cette recherche est maintenant en pause.',
    telegramOnResumedToast: 'Telegram activé. Cette recherche tourne à nouveau.',
    telegramTestButton: 'Envoyer une notification de test',
    telegramTestSending: 'Envoi…',
    telegramTestToast: 'Notification de test envoyée. Regardez dans Telegram.',
    telegramTestHint: 'Envie de vérifier que tout marche ? Envoyez-vous une notification de test.',
    telegramRelink: 'Lier un autre compte',
    telegramUnlink: 'Délier',
    telegramUnlinkConfirm: 'Délier Telegram ? Vous ne recevrez plus de notifications par ce canal.',
    telegramUnlinkedToast: 'Telegram délié.',
    telegramConnectTitle: 'Lier Telegram',
    telegramConnectIntro: 'Recevez les nouvelles annonces directement dans votre chat Telegram. Fonctionne aussi si vous n’avez Telegram que sur votre téléphone.',
    telegramStep1Title: 'Ouvrez notre bot dans Telegram',
    telegramStep1Body: 'Ouvrez Telegram et cherchez ce bot :',
    telegramStep1Open: 'Ouvrir dans Telegram',
    telegramQrTitle: 'Telegram sur votre téléphone ?',
    telegramQrBody: 'Scannez ce code avec l’appareil photo de votre téléphone, le bot s’ouvre directement.',
    telegramStep2Title: 'Envoyez le message',
    telegramStep2Body: 'Appuyez sur Start ou envoyez ce message au bot :',
    telegramStep3Title: 'Saisissez le code',
    telegramStep3Body: 'Le bot vous renvoie un code à 6 chiffres. Tapez-le ici :',
    telegramCodePlaceholder: '123456',
    telegramVerifyButton: 'Lier',
    telegramVerifying: 'Liaison…',
    telegramVerifyError: 'Ce code est incorrect ou expiré. Renvoyez un message au bot pour en obtenir un nouveau.',
    telegramLinkedToast: 'Telegram lié ! Vous recevez désormais aussi les notifications par ce canal.',
    telegramBack: 'Retour',
    telegramCopied: 'Copié',
    createdToast: 'Recherche créée ! Nous regardons d’abord ce qui est déjà en ligne, ensuite vous recevez une notification dès qu’il y a du nouveau.',
    deletedToast: 'Recherche supprimée.',
    errorToast: 'Un problème est survenu lors de la connexion au serveur de notifications.',
    loading: 'Chargement…',
    justNow: 'À l’instant',
    minutesAgo: m => `il y a ${m} min`,
    hoursAgo: h => `il y a ${h} h`,
    closeButton: 'Fermer',
    sortNewest: 'Plus récentes',
    sortPriceAsc: 'Prix : croissant',
    sortPriceDesc: 'Prix : décroissant',

    filterButton: 'Filtres',
    filterEditorTitle: 'Que voulez-vous ignorer ?',
    filterEditorIntro: 'Cochez les types d’annonces que vous ne voulez pas voir pour cette recherche.',
    // Matches the wording the Cleanplaats panel already uses on 2ememain, so
    // the same filter is not called two different things in one product.
    filterDagtoppers: 'Tops du jour',
    filterReserved: 'Réservées',
    filterOpval: 'Autocollants promotionnels',
    filterCountActive: n => `${n} actif${n === 1 ? '' : 's'}`,
    filterNoneActive: 'Tout afficher',
    filterAlwaysExcluded: 'Les pubs au top et les annonces professionnelles ne font jamais l’objet d’une notification.',
    filterGlobalListsTitle: 'Vendeurs et termes bloqués',
    filterGlobalListsHint: 'Ils valent pour toutes vos recherches. Vous les gérez dans le panneau Cleanplaats.',
    filterListSellers: n => `${n} vendeur${n !== 1 ? 's' : ''}`,
    filterListTerms: n => `${n} terme${n !== 1 ? 's' : ''}`,
    filterListListings: n => `${n} annonce${n !== 1 ? 's' : ''}`,
    filterListsNone: 'Aucun blocage défini',
    filterSavedToast: 'Filtre enregistré.',

    upgradePrice: price => `€ ${price.toFixed(2).replace('.', ',')}`,
    upgradePerMonth: 'par mois',
    upgradeSoon: 'Bientôt',
    upgradeButton: 'Tenez-moi au courant',
    upgradeSending: 'En cours…',
    upgradeRegistered: 'Vous êtes sur la liste. Nous vous écrirons dès que Premium existe.',
    upgradeToast: 'Merci ! Vous aurez de nos nouvelles dès que Premium est disponible.',
    upgradeWithdraw: 'Finalement, non merci',
    upgradeWithdrawing: 'En cours…',
    upgradeWithdrawnToast: 'Vous n’êtes plus sur la liste. Vous ne recevrez rien au sujet de Premium.',

    contactTitle: 'Une question ou un retour ?',
    contactBody: 'Écrivez à info@cleanplaats.com. Chaque message arrive chez le créateur.',
    contactAddress: 'info@cleanplaats.com',
    contactButton: 'Nous écrire',

    navMatches: 'Trouvées',
    navAlerts: 'Recherches',
    navTelegram: 'Notifications',
    matchesSub: 'Tout ce que vos recherches ont trouvé depuis leur démarrage.',
    alertsSub: max => (max === 1
        ? 'Une recherche à la fois avec un compte gratuit. Activez-la, coupez-la ou prolongez-la ici.'
        : `Jusqu’à ${max} recherches à la fois. Activez-les, coupez-les ou prolongez-les ici.`),
    quotaUpgrade: 'En faire tourner plus à la fois',
    contactShort: 'Question ou retour',

    stripRunning: n => `${n} recherche${n === 1 ? '' : 's'} en cours`,
    stripIdle: 'Aucune recherche ne tourne, donc rien n’arrivera.',
    stripUnlinked: 'Telegram n’est pas lié, donc rien ne vous est envoyé.',
    stripFailing: `Nous n’arrivons pas à joindre ${CLEANPLAATS_ALERTS_SITE_NAME} pour le moment. Dès que ça remarche, la recherche reprend.`,

    tableName: 'Recherche',
    tableFound: 'Trouvées',
    tableCheck: 'Prochaine vérification',
    tableValidity: 'Valable',
    tableStatus: 'Statut',
    detailsChannel: 'Notifications',
    detailsRemove: 'Supprimer',
    createAtLimitHint: max => (max === 1
        ? 'Vous avez déjà une recherche en cours. Supprimez-la d’abord pour en activer une nouvelle.'
        : 'Vous êtes à votre maximum. Supprimez-en une pour faire de la place.'),

    setupTitle: left => (left === 1 ? 'Encore une étape et c’est prêt' : `Encore ${left === 2 ? 'deux' : left} étapes et c’est prêt`),
    setupProgress: (done, total) => `${done} sur ${total} terminé${done === 1 ? '' : 's'}`,
    setupAccountTitle: 'Compte créé',
    setupAccountBody: 'Vos recherches suivent votre adresse e-mail, même sur un autre appareil.',
    setupAlertTitle: 'Activez votre première recherche',
    setupAlertBody: `Saisissez un terme ci-dessous et choisissez-y une catégorie, un prix et une distance. Si vous cherchez d’abord sur ${CLEANPLAATS_ALERTS_SITE_NAME}, ces filtres sont déjà prêts.`,
    setupAlertBodyDone: n => `Vous avez ${n} recherche${n === 1 ? '' : 's'} en cours.`,
    setupTelegramTitle: 'Liez Telegram',
    setupTelegramBody: hours => `Telegram est la façon dont nous vous joignons. Sans liaison, la vérification s’arrête après ${hours} heures.`,
    setupTelegramBodyDone: 'Lié. Les notifications arrivent dans votre chat Telegram.',
    setupTelegramAction: 'Lier',

    accountTitle: 'Mon compte',
    accountOpen: 'Mon compte',
    accountEmailLabel: 'Adresse e-mail',
    accountPlanLabel: 'Formule',
    accountUsageLabel: 'Recherches',
    accountIntervalLabel: 'Fréquence de vérification',
    accountIntervalValue: m => `Toutes les ${m} minutes`,
    accountValidityLabel: 'Validité',
    accountValidityValue: d => `${d} jours par recherche`,
    accountTelegramLabel: 'Telegram',
    accountSinceLabel: 'Membre depuis',
    accountPricingLink: 'Voir ce que contient chaque formule',
    backToAlerts: 'Retour',

    alertMatchesOpen: label => `Voir les annonces trouvées par ${label}`,
    alertMatchesTitle: 'Annonces trouvées',
    alertMatchesSearchLink: siteName => `Ouvrir cette recherche sur ${siteName}`,
    alertOtherSiteTitle: siteName => `Cette recherche tourne sur ${siteName}`,
    alertMatchesEmpty: 'Cette recherche n’a encore rien trouvé de neuf. Dès qu’une annonce y correspond, elle apparaît ici.',
    alertMatchesError: 'Nous n’avons pas pu charger les annonces de cette recherche. Réessayez dans un instant.',
    alertMatchesTruncated: n => `Vous voyez les ${n} annonces les plus récentes de cette recherche.`,

    limitTitle: 'Vous êtes à votre maximum',
    limitUsage: (used, max) => `${used} recherche${max === 1 ? '' : 's'} sur ${max} utilisée${used === 1 ? '' : 's'}`,
    limitBody: max => (max === 1
        ? 'Avec un compte gratuit, une seule recherche tourne à la fois. Supprimez l’actuelle ci-dessous pour faire de la place à la nouvelle.'
        : `Avec un compte gratuit, vous pouvez faire tourner ${max} recherches à la fois. ` +
          'Supprimez-en une ci-dessous pour faire de la place à la nouvelle.'),
    limitListTitle: 'Vos recherches en cours',
    limitPremiumTitle: 'En faire tourner plus à la fois ?',
    limitPremiumBody: (plan, freePlan) => `Premium vous donne ${plan.maxAlerts} recherches au lieu de ` +
        `${freePlan.maxAlerts}, et vérifie toutes les ${plan.intervalMinutes} minutes au lieu de ` +
        `${freePlan.intervalMinutes}. Ce n’est pas encore disponible et son contenu exact peut encore changer, ` +
        'mais nous vous préviendrons le moment venu.',
    limitFreedToast: 'Il y a de la place à nouveau. Activez votre nouvelle recherche.',

    pricingTitle: 'Ce que vous obtenez',
    pricingIntro: 'Cleanplaats reste gratuit. Premium s’adresse à celles et ceux qui veulent arriver les premiers.',
    pricingCurrentPlan: 'Votre formule actuelle',
    pricingFree: 'Gratuit',
    pricingPremium: 'Premium',
    pricingPremiumIncludes: 'Tout ce que contient Gratuit, plus :',
    pricingPremiumProvisional: 'Premium est encore en préparation. Son contenu exact n’est pas fixé et peut encore changer.',
    pricingFeatureAlerts: n => `${n} recherche${n === 1 ? '' : 's'} à la fois`,
    pricingFeatureInterval: m => `Vérification toutes les ${m} minutes`,
    pricingFeatureIntervalFaster: (m, freeM) => `Trois fois plus rapide : toutes les ${m} minutes au lieu de ${freeM}`,
    pricingFeatureAlertsMore: (n, freeN) => `${n} recherches à la fois au lieu de ${freeN}`,
    pricingFeatureValidity: d => `${d} jours de validité par recherche`,
    pricingFeatureValidityLonger: (d, freeD) => `${d} jours de validité au lieu de ${freeD}`,
    pricingFeatureTelegram: 'Notifications via Telegram',
    pricingFeatureFilters: 'Vos filtres Cleanplaats s’appliquent à vos notifications',
    pricingFeatureBlocklist: 'Les vendeurs et termes bloqués comptent aussi',
    pricingFeatureOneClick: `Activer une recherche depuis vos résultats sur ${CLEANPLAATS_ALERTS_SITE_NAME}`,
    pricingFeatureFeed: 'Aperçu de toutes les annonces trouvées',

    filtersTooLargeToast: 'Vos listes de blocage sont trop volumineuses pour être envoyées. Vos recherches utilisent pour l’instant une version plus ancienne.',
    filtersTrimmedToast: count => `Vos listes de blocage sont très longues. Vos recherches utilisent les ${count} premiers éléments de chaque liste.`
};

// One panel, one language: French on 2ememain, Dutch on the other two.
var ALERTS_TEXT = is2ememainLocale() ? ALERTS_TEXT_FR : ALERTS_TEXT_NL;

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

function formatAlertRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    if (diff < 90 * 1000) return ALERTS_TEXT.justNow;
    if (diff < 60 * 60 * 1000) return ALERTS_TEXT.minutesAgo(Math.round(diff / 60000));
    if (diff < 24 * 60 * 60 * 1000) return ALERTS_TEXT.hoursAgo(Math.round(diff / 3600000));
    try {
        return new Date(timestamp).toLocaleDateString(CLEANPLAATS_ALERTS_DATE_LOCALE, { day: 'numeric', month: 'short' });
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
var ALERT_PRICE_TYPE_LABELS_NL = {
    FAST_BID: 'Bieden',
    MIN_BID: 'Bieden',
    SEE_DESCRIPTION: 'Zie omschrijving',
    NOTK: 'N.o.t.k.',
    FREE: 'Gratis',
    RESERVED: 'Gereserveerd',
    EXCHANGE: 'Ruilen',
    ON_REQUEST: 'Op aanvraag'
};

// The site's own words, lifted from 2ememain's translation table rather than
// translated by hand: this label sits where the site prints a price, so a
// synonym of ours would read as a different thing than the listing says.
var ALERT_PRICE_TYPE_LABELS_FR = {
    FAST_BID: 'Faire une offre',
    MIN_BID: 'Faire une offre',
    SEE_DESCRIPTION: 'Voir description',
    NOTK: 'À débattre',
    FREE: 'Gratuit',
    RESERVED: 'Réservé',
    EXCHANGE: 'Échanger',
    ON_REQUEST: 'Sur demande'
};

var ALERT_PRICE_TYPE_LABELS = is2ememainLocale() ? ALERT_PRICE_TYPE_LABELS_FR : ALERT_PRICE_TYPE_LABELS_NL;

// "Bieden vanaf € 250" — our own sentence around the site's word for a minimum
// bid, so it needs its own translation.
var ALERT_MIN_BID_PREFIX = is2ememainLocale()
    ? amount => `Offre à partir de ${amount}`
    : amount => `Bieden vanaf ${amount}`;

function formatAlertMatchPrice(match) {
    if (Number.isFinite(match.price_cents) && match.price_cents > 0) {
        const euros = match.price_cents / 100;
        // Whole euros drop the ",00" the way Marktplaats itself writes them, but
        // both paths go through toLocaleString or a thousands separator would
        // appear on € 1.500 and vanish again on € 1500,50.
        const amount = `€ ${euros.toLocaleString(CLEANPLAATS_ALERTS_NUMBER_LOCALE, {
            minimumFractionDigits: Number.isInteger(euros) ? 0 : 2,
            maximumFractionDigits: 2
        })}`;
        return match.price_type === 'MIN_BID' ? ALERT_MIN_BID_PREFIX(amount) : amount;
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
        : chips.map(c => `<span class="cleanplaats-alerts-filter-chip">${escapeHtmlText(c)}</span>`).join('');
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
            ? `<img class="cleanplaats-alerts-match-thumb" src="${escapeHtmlText(match.image_url)}" alt="" loading="lazy">`
            : `<span class="cleanplaats-alerts-match-thumb cleanplaats-alerts-match-thumb-empty">${alertIcon('image', 20)}</span>`;
        // The badge sits at the end of the row rather than in front of the
        // title: inline, it pushed the first line over and left every badged
        // title breaking a word early.
        return `
            <a class="cleanplaats-alerts-match${isNew ? ' is-new' : ''}" href="${escapeHtmlText(match.url)}">
                ${thumb}
                <span class="cleanplaats-alerts-match-info">
                    <span class="cleanplaats-alerts-match-title">${escapeHtmlText(match.title)}</span>
                    <span class="cleanplaats-alerts-match-sub">
                        <span class="cleanplaats-alerts-match-price">${formatAlertMatchPrice(match)}</span>
                        ${match.city ? `<span>· ${escapeHtmlText(match.city)}</span>` : ''}
                        ${options.hideAlertLabel ? '' : `<span class="cleanplaats-alerts-match-alert-label">· ${escapeHtmlText(match.alert_label || '')}</span>`}
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
    // Same definition of "active" the modal paints its rows with, so the panel
    // does not report searches as running while the server has stopped checking
    // them for want of a linked Telegram.
    const activeCount = alerts.filter(
        alert => alertStatusClass(alert, cleanplaatsAlertsRuntime.me) === 'active'
    ).length;

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

/**
 * Closing the panel means the matches it just showed have been read, and the
 * visit the server stamped on open says so too. Zeroing the stored count keeps
 * the card in step with that, instead of repeating the same number until the
 * next dashboard load.
 */
function clearStoredNewMatchCount() {
    if (typeof CLEANPLAATS === 'undefined' || !CLEANPLAATS.settings) return;

    const summary = CLEANPLAATS.settings.alertsSummary;
    if (!summary || !summary.newMatchCount) return;

    summary.newMatchCount = 0;
    if (typeof saveSettings === 'function') {
        saveSettings().catch(error => {
            console.error('Cleanplaats: Failed to clear alerts summary badge', error);
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
    const headers = {
        'Content-Type': 'application/json',
        // The server answers in the language the panel is drawn in. The account
        // cannot say which that is: the same user can hold a Dutch and a French
        // zoekopdracht at once, so it travels with the request.
        'X-Cleanplaats-Lang': CLEANPLAATS_ALERTS_LANG,
        ...(options.headers || {})
    };
    if (cleanplaatsAlertsRuntime.token) {
        headers['Authorization'] = `Bearer ${cleanplaatsAlertsRuntime.token}`;
    }

    return fetch(`${cleanplaatsAlertsRuntime.apiBase}${path}`, { ...options, headers })
        .then(response => response.json().catch(() => ({})).then(data => {
            if (!response.ok) {
                const error = new Error(data.error || `Alerts API error ${response.status}`);
                error.status = response.status;
                if (response.status === 401) {
                    error.sessionExpired = true;
                    handleExpiredAlertsSession();
                }
                throw error;
            }
            return data;
        }));
}

/**
 * The server answers 401 from one place only: the session gate that every
 * logged-in route sits behind. It can therefore never mean "wrong login code"
 * (the auth routes run before the gate and answer 400), only "this token is no
 * longer a session". That makes it something the panel can answer once, here,
 * instead of at each of the twenty call sites: drop the token and put the login
 * view back. Callers get the rejection either way, marked so they can tell an
 * answered session expiry from a failure they still have to explain.
 */
function handleExpiredAlertsSession() {
    if (!cleanplaatsAlertsRuntime.token) return;
    storeAlertsToken('').then(() => {
        // Filters sync in the background, so a 401 can arrive with no panel on
        // screen. Nothing to re-render then; the next open starts logged out.
        if (document.getElementById('cleanplaats-alerts-body')) renderAlertsLoginView();
    });
}

/**
 * Reports a failed call, unless it was the session expiring: that already
 * replaced the panel with the login view, and a toast about it would land on
 * top of its own answer.
 */
function notifyAlertsError(error, message) {
    if (error && error.sessionExpired) return;
    showBubbleNotification(message || ALERTS_TEXT.errorToast);
}

/**
 * Extracts the current search as server-ready /lrp/api/search params.
 * Mirrors buildSearchApiUrl() in cleanup.js — it leans on the same two readers,
 * so the panel and the page filter can never disagree about what is on screen —
 * but returns the params instead of a URL, so the server can re-run the search
 * on its own schedule.
 */
function getAlertSearchContext() {
    if (!isAlertsSiteSupported()) return null;

    const href = window.location.href;
    if (!href.includes('/q/') && !href.includes('/l/')) return null;

    // The term is not always where you would expect it: /q/<term>/ pages carry
    // it in the path, category pages in the hash (/l/<cat>/#q:<term>), and a
    // hash never reaches the server, so __NEXT_DATA__ reports an empty
    // searchQuery there. getSearchQueryFromUrl() knows both spots;
    // getNextDataQuery() pairs the term with the filters of the search on
    // screen, and returns null when __NEXT_DATA__ still describes an older one.
    const urlQuery = getSearchQueryFromUrl();
    const pageQuery = getNextDataQuery();

    let searchParams = {};

    if (pageQuery) {
        if (pageQuery.searchQuery) searchParams.query = String(pageQuery.searchQuery);
        // Only the names /lrp/api/search answers to. The path-shaped ones the
        // page also carries (attributesValuesIds and friends) are accepted by
        // the endpoint and then ignored — sending them would look like a filter
        // and behave like none. readSearchFilters() in cleanup.js has already
        // put the facets under these keys, fragment included.
        ['l1CategoryId', 'postcode', 'distanceMeters',
            'attributesById', 'attributesByKey', 'attributeRanges'].forEach(key => {
            const value = pageQuery[key];
            if (value !== undefined && value !== null && value !== ''
                && !(Array.isArray(value) && value.length === 0)) {
                searchParams[key] = value;
            }
        });

        // The subcategory is a list on the page and a single value on an alert,
        // so only one of them transfers. Two is not a choice to make on the
        // user's behalf: the alert keeps the main category then, broader than
        // the page but never a different search than the one on screen.
        const l2Ids = pageQuery.l2CategoryIds || [];
        if (l2Ids.length === 1) searchParams.l2CategoryId = String(l2Ids[0]);
    } else if (urlQuery) {
        // No filters we can still trust: the term on its own makes a correct
        // alert, just a broader one than the page the user is looking at.
        searchParams = { query: urlQuery };
    }

    // Hash params override (same precedence as buildSearchApiUrl).
    const hashParams = parseLocationHashParams();
    if (hashParams.postcode) searchParams.postcode = hashParams.postcode;
    if (hashParams.distanceMeters) searchParams.distanceMeters = hashParams.distanceMeters;

    if (Object.keys(searchParams).length === 0) return null;

    // No searchInTitleAndDescription here on purpose. Marktplaats searches
    // descriptions by default and ignores the parameter entirely (checked
    // against /lrp/api/search: absent, 'true' and 'false' return identical
    // totals, and results include ads with the term only in the description).
    // Sending nothing means an alert keeps matching whatever the search page
    // itself matches, even if that default ever changes.

    const suggestedLabel = searchParams.query || decodeURIComponent(
        (window.location.pathname.match(/\/[ql]\/([^/]+)/) || [, ''])[1] || ''
    ).replace(/[-+]/g, ' ').trim() || `${CLEANPLAATS_ALERTS_SITE_NAME} zoekopdracht`;

    return {
        suggestedLabel: suggestedLabel.slice(0, 120),
        // Whether that label is a search term or only a name. On a category page
        // it is read off the URL slug, and searching for the words "fietsen en
        // brommers" inside the fietsen category is a different, far narrower
        // search than the one on screen — so the box must not send it as one.
        labelIsSearchTerm: Boolean(searchParams.query),
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

// Said once per page: this runs on every dashboard load, and a list that is
// too long stays too long until the user shortens it.
let alertFiltersSizeWarned = false;

function syncAlertFilters() {
    const filters = buildAlertFiltersPayload();
    const longestList = Math.max(
        filters.blacklistedSellers.length,
        filters.blacklistedTerms.length,
        filters.blacklistedDescriptionTerms.length,
        filters.blockedListings.length
    );

    return alertsApiFetch('/api/filters', {
        method: 'PUT',
        body: JSON.stringify({ filters })
    }).then(response => {
        // Lists that would cost the poller too much are shortened rather than
        // refused, so a save can succeed and still leave part of a blocklist
        // behind. The server says how much of each list it kept, and that has
        // to be passed on: the entries it dropped stop blocking anything, so
        // ads the panel hides can still arrive as matches.
        const kept = Number(response && response.maxEntriesPerList);
        if (!Number.isFinite(kept) || kept <= 0 || longestList <= kept) return;
        if (alertFiltersSizeWarned) return;
        alertFiltersSizeWarned = true;
        showBubbleNotification(ALERTS_TEXT.filtersTrimmedToast(kept));
    }).catch(error => {
        console.error('Cleanplaats: Failed to sync filters to alerts server', error);
        // A body too big to be read at all comes back as 400, and it is the one
        // failure the user has to know about: nothing was stored, so the alerts
        // keep running on an older copy of the blocklists. Everything else is a
        // transient network problem the next dashboard load fixes by itself.
        if (!error || error.status !== 400 || alertFiltersSizeWarned) return;
        alertFiltersSizeWarned = true;
        showBubbleNotification(ALERTS_TEXT.filtersTooLargeToast);
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
    // A half-filled create box is about the page it was opened on. Next time
    // that could be a different search entirely, so it starts over.
    resetAlertCreateDraft();
    endAlertsWalkthrough({ disarm: true });
    restorePanelAfterAlerts();
    // The card summarises what this session just loaded, so bring it up to date
    // before the panel comes back into view.
    clearStoredNewMatchCount();
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
        <div class="cleanplaats-alerts-card is-loading-app" role="dialog" aria-modal="true" aria-label="${ALERTS_TEXT.modalTitle}">
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
    // The card holds the dashboard's size while the first load is in flight,
    // so opening the panel doesn't show a small card that then grows. Any body
    // we render ends that hold: either the dashboard puts its own class back a
    // few lines further on, or this is a sub-view that should shrink-wrap.
    alertsCard()?.classList.remove('is-loading-app');
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

/**
 * The first load, where there is nothing on screen yet to keep. Its own markup
 * rather than the bare .cleanplaats-alerts-loading line, because that class is
 * also what the failure message renders in, and a spinner next to "something
 * went wrong" says the opposite of what happened.
 */
function alertsLoadingHtml() {
    return `<div class="cleanplaats-alerts-loading">
        <span class="cleanplaats-alerts-loading-spin" aria-hidden="true"></span>
        <span>${ALERTS_TEXT.loading}</span>
    </div>`;
}

function alertsCard() {
    return document.querySelector('.cleanplaats-alerts-card');
}

/**
 * Refreshing a view that is already on screen: veil it and spin, rather than
 * replacing it with a loading line. Swapping the body drops the app grid, and
 * the card's width and height hang off that grid, so the panel shrank to a
 * sub-view's size and snapped back the moment the data landed.
 */
function setAlertsBusy(busy) {
    alertsCard()?.classList.toggle('is-busy', busy);
    const body = document.getElementById('cleanplaats-alerts-body');
    if (body) body.setAttribute('aria-busy', busy ? 'true' : 'false');
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
        <div class="cleanplaats-alerts-confirm-box" role="alertdialog" aria-modal="true" aria-label="${escapeHtmlText(title)}">
            <div class="cleanplaats-alerts-confirm-title">${escapeHtmlText(title)}</div>
            <div class="cleanplaats-alerts-confirm-body">${escapeHtmlText(body)}</div>
            <div class="cleanplaats-alerts-confirm-actions">
                <button type="button" class="cleanplaats-alerts-secondary-btn" id="cleanplaats-alerts-confirm-cancel">${ALERTS_TEXT.confirmCancel}</button>
                <button type="button" class="${danger ? 'cleanplaats-alerts-danger-btn' : 'cleanplaats-alerts-primary-btn'}" id="cleanplaats-alerts-confirm-ok">${escapeHtmlText(confirmLabel)}</button>
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

            <div class="cleanplaats-alerts-sell-new">
                <span class="cleanplaats-alerts-sell-new-icon">${alertIcon('mail', 16)}</span>
                <span class="cleanplaats-alerts-sell-new-copy">
                    <span class="cleanplaats-alerts-sell-new-title">${ALERTS_TEXT.loginNewTitle}</span>
                    <span class="cleanplaats-alerts-sell-new-body">${ALERTS_TEXT.loginNewBody}</span>
                </span>
            </div>

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
            showAlertsInlineError(ALERTS_TEXT.emailInvalid);
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
            <p>${escapeHtmlText(ALERTS_TEXT.codeSentTo(email))}</p>
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
            showAlertsInlineError(ALERTS_TEXT.codeSixDigits);
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
                            <code class="cleanplaats-alerts-connect-code" id="cleanplaats-tg-bot">${escapeHtmlText(botHandle)}</code>
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
            showError(ALERTS_TEXT.codeSixDigits);
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
    return new Date(timestamp).toLocaleDateString(CLEANPLAATS_ALERTS_DATE_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderAlertsAccountView() {
    const me = cleanplaatsAlertsRuntime.me;
    if (!me) {
        loadAlertsDashboard();
        return;
    }

    const isPremium = me.tier === 'premium';
    const rows = [
        [ALERTS_TEXT.accountEmailLabel, escapeHtmlText(me.email)],
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

function buildPricingPlanHtml({ name, priceLabel, current, soon, features, includesLine, note }) {
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
            ${note ? `<p class="cleanplaats-alerts-plan-note">${note}</p>` : ''}
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
                ],
                // Only while it is still a plan: once premium can be bought,
                // the list has to stand as it is.
                note: premium.available ? '' : ALERTS_TEXT.pricingPremiumProvisional
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
            <span class="cleanplaats-alerts-limit-item-label">${escapeHtmlText(alert.label)}</span>
            <span class="cleanplaats-alerts-limit-item-meta">${ALERTS_TEXT.matchCount(alert.match_count || 0)}</span>
            <button class="cleanplaats-alerts-delete" data-alert-id="${alert.id}" data-alert-label="${escapeHtmlText(alert.label)}" title="${ALERTS_TEXT.deleteButton}" aria-label="${ALERTS_TEXT.deleteButton}">${alertIcon('trash', 15)}</button>
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
                            notifyAlertsError(error, error && error.message);
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
        ? `<a class="cleanplaats-alerts-subview-link" href="${escapeHtmlText(alert.search_url)}">${escapeHtmlText(ALERTS_TEXT.alertMatchesSearchLink(getAlertsSiteName(alert.site)))}</a>`
        : '';
    const header = alertsViewHeader(escapeHtmlText(alert.label), subtitle);

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
            // A session that expired while the panel was open already put the
            // login view back, so there is nothing to say about matches.
            if (error.sessionExpired) return;
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
                notifyAlertsError(error, error && error.message);
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
                    notifyAlertsError(error, error && error.message);
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

    const body = document.getElementById('cleanplaats-alerts-body');
    if (!body) return;

    // Every action in the panel ends up here. When the dashboard is already on
    // screen, refresh underneath it: the rail, the surface and the card's size
    // all stay put, and the only thing that says "working" is the veil. The
    // full loading body is for the first load, when there is nothing to keep.
    const inPlace = body.classList.contains('cleanplaats-alerts-body-app');
    const mainScroll = inPlace
        ? (document.getElementById('cleanplaats-alerts-main')?.scrollTop || 0)
        : 0;
    if (inPlace) {
        setAlertsBusy(true);
    } else {
        setAlertsBody(alertsLoadingHtml());
    }

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
        // renderAlertsMainView() starts every view at the top, which is right
        // for a view change and wrong for a refresh of the one you are reading.
        if (inPlace && mainScroll) {
            const main = document.getElementById('cleanplaats-alerts-main');
            if (main) main.scrollTop = mainScroll;
        }
        setAlertsBusy(false);
    }).catch(error => {
        setAlertsBusy(false);
        if (error.sessionExpired) return;
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

// The server polls an alert on an unlinked account for a while after it was
// created, so the first check still fills the panel. The length of that window
// is the server's to decide, so it comes over the wire; the fallback only keeps
// the copy sensible against a server that predates the field.
function alertsUnlinkedGraceHours(me) {
    const hours = me && Number(me.unlinkedGraceHours);
    return Number.isFinite(hours) && hours > 0 ? Math.round(hours) : 24;
}

/**
 * What the checks are actually doing while no Telegram is linked. Without this
 * the panel keeps counting down to a next check that the server will never
 * run: the alert says "Actief" and nothing behind it moves. Returns null once
 * Telegram is linked, since then nothing is being held back.
 */
function alertUnlinkedCheckState(alert, me) {
    if (!me || me.telegramLinked) return null;
    const graceMs = alertsUnlinkedGraceHours(me) * 60 * 60 * 1000;
    const endsAt = (alert.created_at || 0) + graceMs;
    const msLeft = endsAt - Date.now();
    if (msLeft <= 0) return { stopped: true, hoursLeft: 0 };
    return { stopped: false, hoursLeft: Math.ceil(msLeft / (60 * 60 * 1000)) };
}

/**
 * Which of the three looks a row wears. An alert whose account has no Telegram
 * keeps the active look while the server is still checking it; once that window
 * has run out nothing moves behind it any more, so it takes the paused look
 * until the channel is there.
 */
function alertStatusClass(alert, me) {
    const validity = getAlertValidity(alert);
    if (validity && validity.expired) return 'expired';
    if (!alert.enabled) return 'paused';
    // Inside the grace window the search is still being polled, so it counts as
    // running; only once the server has dropped it does the row take the paused
    // look. Anything else has the panel reporting nothing active while a search
    // is quietly filling up with finds.
    const unlinked = alertUnlinkedCheckState(alert, me);
    return unlinked && unlinked.stopped ? 'paused' : 'active';
}

/**
 * The check column of one row: when the next check lands, nothing else. Split
 * out because the switches repaint it in place: pausing an alert turns
 * "volgende controle" into "laatst gecontroleerd" and the row would otherwise
 * keep the old sentence until the next reload.
 */
function alertCheckCellHtml(alert, me) {
    const validity = getAlertValidity(alert);
    const expired = Boolean(validity && validity.expired);
    const unlinked = (alert.enabled && !expired) ? alertUnlinkedCheckState(alert, me) : null;
    // Still inside the grace window the poller does run, so this column says
    // when. Once it has stopped there is no next check to name, and why it
    // stopped is the validity column's line to carry.
    const running = alert.enabled && !expired && !(unlinked && unlinked.stopped);

    if (running && isAlertFailing(alert)) {
        return `<span class="cleanplaats-alerts-cell-warn">${ALERTS_TEXT.checkFailing}</span>`;
    }
    if (running && alert.last_checked_at) {
        return formatAlertNextCheck(alert.last_checked_at, me.intervalMinutes) || ALERTS_TEXT.nextCheckSoon;
    }
    if (alert.last_checked_at) {
        return `${ALERTS_TEXT.lastChecked}: ${formatAlertRelativeTime(alert.last_checked_at)}`;
    }
    return ALERTS_TEXT.neverChecked;
}

/**
 * The validity column of one row. Both lines answer the same question — how
 * much longer does this keep running — so the Telegram deadline sits here
 * rather than in the check column, where it was pushing out the one thing that
 * column exists to say. Repainted in place for the same reason as the check
 * cell: pausing a search retires the deadline with it.
 */
function alertValidityCellHtml(alert, me) {
    const validity = getAlertValidity(alert);
    const expired = Boolean(validity && validity.expired);
    const unlinked = (alert.enabled && !expired) ? alertUnlinkedCheckState(alert, me) : null;
    const note = unlinked
        ? `<span class="cleanplaats-alerts-validity-note">${unlinked.stopped
            ? ALERTS_TEXT.unlinkedStopped
            : ALERTS_TEXT.unlinkedStops(unlinked.hoursLeft)}</span>`
        : '';

    if (!validity) {
        return `<span class="cleanplaats-alerts-validity-meter">
                   <span class="cleanplaats-alerts-validity-text">∞</span>
                   ${note}
               </span>`;
    }

    const fraction = alertValidityFraction(alert, me);
    return `<span class="cleanplaats-alerts-validity-meter${expired ? ' is-expired' : (validity.soon ? ' is-soon' : '')}">
               <span class="cleanplaats-alerts-validity-bar"><span style="width:${Math.round((fraction || 0) * 100)}%"></span></span>
               <span class="cleanplaats-alerts-validity-text">${expired ? ALERTS_TEXT.validityExpired : ALERTS_TEXT.validityLeft(validity.daysLeft)}</span>
               ${note}
           </span>`;
}

/**
 * The banner above the list while nothing is linked. The checklist on the
 * finds view already nags about linking, but the searches view is where
 * someone sits looking at a row that claims to be running, so the reason it
 * isn't belongs there too.
 */
function buildAlertsUnlinkedNoticeHtml(me, alerts) {
    if (!me || me.telegramLinked || alerts.length === 0) return '';
    return `
        <div class="cleanplaats-alerts-notice">
            <span class="cleanplaats-alerts-notice-icon">${alertIcon('send', 16)}</span>
            <span class="cleanplaats-alerts-notice-copy">
                <span class="cleanplaats-alerts-notice-title">${ALERTS_TEXT.telegramRequiredTitle}</span>
                <span class="cleanplaats-alerts-notice-body">${ALERTS_TEXT.telegramRequiredBody(alertsUnlinkedGraceHours(me))}</span>
            </span>
            <button type="button" class="cleanplaats-alerts-primary-btn" id="cleanplaats-alerts-notice-link">${ALERTS_TEXT.telegramRequiredButton}</button>
        </div>
    `;
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

    // Nothing linked outranks every other status: the searches may well be
    // running, but not one of their finds is going anywhere.
    if (!me.telegramLinked) {
        return `<div class="cleanplaats-alerts-strip cleanplaats-alerts-strip-warn">
            ${alertIcon('send', 14)}<span>${ALERTS_TEXT.stripUnlinked}</span>
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
            body: me.telegramLinked
                ? ALERTS_TEXT.setupTelegramBodyDone
                : ALERTS_TEXT.setupTelegramBody(alertsUnlinkedGraceHours(me)),
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

/* ===== The search filters you can set while making a zoekopdracht ===== */

// The radius steps the sites' own "Afstand" dropdown offers, in meters. Read off
// the search page's distanceOptions rather than invented, so the choices here
// are the choices there.
var ALERT_DISTANCE_STEPS = [3000, 5000, 10000, 15000, 25000, 50000, 75000];

// Which AttributeGroupFacets the create box draws as checkboxes. Empty for now:
// category, price and distance ship first. Putting a key in here is enough to
// put that facet on screen, the category-bound ones (brand, frame height)
// included — they arrive in the same response once a category is picked.
var ALERT_CREATE_FACET_KEYS = [];

// Dutch "1011 AB" (the space optional) and Belgian "2000". Both accepted on
// every site: a Dutch user searching 2dehands is unusual, not wrong, and
// refusing their postcode would be.
var ALERT_POSTCODE_PATTERNS = [/^\d{4}\s?[a-z]{2}$/i, /^\d{4}$/];

var cleanplaatsAlertCreateRefreshTimer = null;
var cleanplaatsAlertCreateCategoriesPending = false;
var cleanplaatsAlertCreateSubCategoriesPending = '';

function emptyAlertCreateDraft() {
    return {
        // Ids drive the search, keys drive the link back to the site, labels
        // keep a choice readable in the dropdown while it is the only thing we
        // know about it.
        l1CategoryId: '', l1Key: '', l1Label: '',
        l2CategoryId: '', l2Key: '', l2Label: '',
        postcode: '',
        distanceMeters: '',
        priceMinCents: null,
        priceMaxCents: null,
        attributesById: [],
        // Filters the box has no control for — "aangeboden sinds", bouwjaar,
        // kilometerstand, the car-shaped ones. They came in with the page and
        // travel back out untouched: not drawing a filter is not a reason to
        // drop it.
        attributesByKey: [],
        otherRanges: []
    };
}

function getAlertCreateDraft() {
    if (!cleanplaatsAlertsRuntime.createDraft) {
        cleanplaatsAlertsRuntime.createDraft = emptyAlertCreateDraft();
    }
    return cleanplaatsAlertsRuntime.createDraft;
}

function resetAlertCreateDraft() {
    cleanplaatsAlertsRuntime.createDraft = null;
    cleanplaatsAlertsRuntime.createFacets = null;
    cleanplaatsAlertsRuntime.createFilterOpen = false;
    cleanplaatsAlertsRuntime.createFacetsKey = '';
    cleanplaatsAlertsRuntime.createLabelOnly = '';
    cleanplaatsAlertsRuntime.createSubCategories = null;
    // Requests already out belong to the draft that just went away. Moving the
    // sequence on retires them: without this a response landing after the panel
    // closed would repopulate the facets and, through paintAlertCategoryOptions,
    // leave a fresh empty draft behind — which then blocks the next seed,
    // because seeding only fills a box that has no draft yet.
    cleanplaatsAlertsRuntime.createFacetsSeq += 1;
    clearTimeout(cleanplaatsAlertCreateRefreshTimer);
}

/**
 * What the box should actually search for. Normally the label is the term, but a
 * label the panel filled in on a category page is only a name for the alert —
 * sending it as a term would swap the category the user is looking at for a
 * text search inside it. The moment they change a character it is theirs, and
 * it counts.
 */
function alertCreateQueryTerm(term) {
    const value = String(term || '').trim();
    const labelOnly = cleanplaatsAlertsRuntime.createLabelOnly;
    return labelOnly && value === labelOnly ? '' : value;
}

function normalizeAlertPostcode(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isValidAlertPostcode(value) {
    const cleaned = String(value || '').trim();
    return ALERT_POSTCODE_PATTERNS.some(pattern => pattern.test(cleaned));
}

// An open end of a price range comes across as an empty string, the word
// "null", or a missing key. Number('') is 0, which would silently turn "no
// minimum" into "at least free", so the empty cases are caught before that.
function alertCentsOrNull(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (raw === '' || raw === 'null' || raw === 'undefined') return null;
    const cents = Number(raw);
    return Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : null;
}

// Which attribute a range is about, whichever of the two shapes it arrived in.
function alertRangeKeyOf(entry) {
    if (!entry) return '';
    if (typeof entry === 'object') return entry.attributeKey || '';
    return String(entry).split(':')[0];
}

/**
 * The page hands its price filter over in either of two shapes: the query
 * string form ("PriceCents:1000:5000") or __NEXT_DATA__'s parsed objects
 * ({ attributeKey, from, to }). Both mean the same thing.
 */
function parseAlertPriceRange(attributeRanges) {
    const entries = Array.isArray(attributeRanges) ? attributeRanges : [attributeRanges];
    for (const entry of entries) {
        if (!entry) continue;
        if (typeof entry === 'object') {
            if (entry.attributeKey !== 'PriceCents') continue;
            return { min: alertCentsOrNull(entry.from), max: alertCentsOrNull(entry.to) };
        }
        const parts = String(entry).split(':');
        if (parts[0] !== 'PriceCents') continue;
        return { min: alertCentsOrNull(parts[1]), max: alertCentsOrNull(parts[2]) };
    }
    return null;
}

/**
 * The price range in the order the site insists on. A minimum above the maximum
 * is a 400 from /lrp/api/search, not an empty result, so leaving it as typed
 * would make an alert the poller can never run. Both ends are on screen, so
 * reading them in the order that works is the only interpretation there is.
 */
function alertPriceRangeFor(draft) {
    const min = draft.priceMinCents;
    const max = draft.priceMaxCents;
    if (min === null && max === null) return null;
    if (min !== null && max !== null && min > max) return { from: max, to: min };
    return { from: min, to: max };
}

function countAlertCreateFilters(draft) {
    let count = 0;
    if (draft.l1CategoryId) count += 1;
    if (draft.priceMinCents !== null || draft.priceMaxCents !== null) count += 1;
    if (isValidAlertPostcode(draft.postcode)) count += 1;
    // The ones without a control of their own count too: they narrow the alert
    // just as much, and a summary that skipped them would read "geen filters"
    // over a search that has several.
    return count + draft.attributesById.length + draft.attributesByKey.length + draft.otherRanges.length;
}

/**
 * The draft as server-ready /lrp/api/search params, in the same shape
 * getAlertSearchContext() produces, so the two routes into an alert stay
 * interchangeable.
 */
function buildAlertCreateSearchParams(draft, term) {
    const params = {};
    const query = String(term || '').trim();
    if (query) params.query = query;
    if (draft.l1CategoryId) params.l1CategoryId = String(draft.l1CategoryId);
    if (draft.l2CategoryId) params.l2CategoryId = String(draft.l2CategoryId);

    // A radius without a postcode is not a filter, it is a parameter the site
    // answers by ignoring it, so the two only ever travel together.
    if (isValidAlertPostcode(draft.postcode)) {
        params.postcode = normalizeAlertPostcode(draft.postcode);
        if (draft.distanceMeters) params.distanceMeters = String(draft.distanceMeters);
    }

    const price = alertPriceRangeFor(draft);
    const ranges = [
        ...(price ? [searchRangeParam('PriceCents', price.from, price.to)] : []),
        ...draft.otherRanges
    ];
    if (ranges.length > 0) params.attributeRanges = ranges;

    if (draft.attributesById.length > 0) {
        params.attributesById = draft.attributesById.map(String);
    }
    if (draft.attributesByKey.length > 0) {
        params.attributesByKey = draft.attributesByKey.map(String);
    }

    return params;
}

function alertCategoryKeyFor(categoryId) {
    const facets = cleanplaatsAlertsRuntime.createFacets;
    if (!facets || !categoryId) return '';
    const fromTree = (facets.categories || []).find(item => String(item.id) === String(categoryId));
    if (fromTree && fromTree.key) return fromTree.key;
    const fromOptions = [...(facets.categoryOptions || []), ...(cleanplaatsAlertsRuntime.createMainCategories || [])]
        .find(item => String(item.id) === String(categoryId));
    return (fromOptions && fromOptions.key) || '';
}

/**
 * The link the alert row carries, rebuilt so it opens the search the alert
 * actually runs. Category lives in the path, everything else in the hash, which
 * is exactly the split parseLocationHashParams() in cleanup.js reads back.
 */
function buildAlertSearchUrl(draft, term) {
    const query = String(term || '').trim();
    const encoded = encodeURIComponent(query).replace(/%20/g, '+');
    const l1Key = draft.l1Key || alertCategoryKeyFor(draft.l1CategoryId);
    const l2Key = draft.l2Key || alertCategoryKeyFor(draft.l2CategoryId);

    const path = l1Key
        ? `/l/${l1Key}/${l2Key ? `${l2Key}/` : ''}`
        : `/q/${encoded}/`;

    const hash = [];
    // On a category page the term only exists in the hash; on a /q/ page it is
    // already in the path and repeating it changes nothing.
    if (l1Key && query) hash.push(`q:${encoded}`);

    // A range is two fragment keys here, not one with two colons: the site
    // splits every fragment entry on its first colon, so "PriceCents:0:50000"
    // reaches its parser as the value "0" and is dropped for having no
    // From/To suffix. Only the *request* joins the ends with colons.
    const price = alertPriceRangeFor(draft);
    if (price) {
        if (price.from !== null) hash.push(`PriceCentsFrom:${price.from}`);
        if (price.to !== null) hash.push(`PriceCentsTo:${price.to}`);
    }
    if (draft.attributesById.length > 0) hash.push(`f:${draft.attributesById.join(',')}`);
    if (isValidAlertPostcode(draft.postcode)) {
        hash.push(`postcode:${normalizeAlertPostcode(draft.postcode)}`);
        if (draft.distanceMeters) hash.push(`distanceMeters:${draft.distanceMeters}`);
    }

    return `${getAlertsSiteOrigin()}${path}${hash.length > 0 ? `#${hash.join('|')}` : ''}`;
}

/**
 * Fills an empty draft with the filters of the search page the panel was opened
 * from. That used to happen invisibly at create time and only while the term was
 * untouched; now it lands in controls the user can see and change, so editing
 * the term no longer throws the filters away without saying so.
 */
function seedAlertCreateDraftFromContext(context) {
    if (cleanplaatsAlertsRuntime.createDraft) return;

    const draft = emptyAlertCreateDraft();
    cleanplaatsAlertsRuntime.createDraft = draft;

    // A label the panel wrote itself, on a page with nothing typed to search
    // for. Remembered so the box can tell it apart from a term of the user's.
    cleanplaatsAlertsRuntime.createLabelOnly =
        context && !context.labelIsSearchTerm ? context.suggestedLabel : '';

    const pageParams = context && context.searchParams;
    if (!pageParams) return;

    if (pageParams.l1CategoryId) draft.l1CategoryId = String(pageParams.l1CategoryId);
    if (pageParams.l2CategoryId) draft.l2CategoryId = String(pageParams.l2CategoryId);
    if (pageParams.postcode) draft.postcode = String(pageParams.postcode);
    if (pageParams.distanceMeters) draft.distanceMeters = String(pageParams.distanceMeters);

    const ranges = Array.isArray(pageParams.attributeRanges)
        ? pageParams.attributeRanges
        : [pageParams.attributeRanges].filter(Boolean);

    const price = parseAlertPriceRange(ranges);
    if (price) {
        draft.priceMinCents = price.min;
        draft.priceMaxCents = price.max;
    }
    draft.otherRanges = ranges
        .filter(entry => alertRangeKeyOf(entry) && alertRangeKeyOf(entry) !== 'PriceCents')
        .map(entry => (typeof entry === 'object'
            ? searchRangeParam(entry.attributeKey, entry.from ?? null, entry.to ?? null)
            : String(entry)));

    if (Array.isArray(pageParams.attributesById)) {
        draft.attributesById = pageParams.attributesById.map(String);
    } else if (pageParams.attributesById) {
        draft.attributesById = [String(pageParams.attributesById)];
    }
    if (Array.isArray(pageParams.attributesByKey)) {
        draft.attributesByKey = pageParams.attributesByKey.map(String);
    }

    // The category keys sit in the path of the page we came from, and they are
    // what the alert's own link gets rebuilt from. The first facet response
    // replaces them with the site's, so a wrong guess corrects itself.
    const pathKeys = window.location.pathname.match(/^\/l\/([^/]+)(?:\/([^/]+))?/) || [];
    if (draft.l1CategoryId && pathKeys[1]) draft.l1Key = pathKeys[1];
    if (draft.l2CategoryId && pathKeys[2] && pathKeys[2] !== 'p') draft.l2Key = pathKeys[2];

    // Filters that came across belong on screen, not folded away: the point of
    // showing them is that the user knows what the alert will actually watch.
    if (countAlertCreateFilters(draft) > 0) cleanplaatsAlertsRuntime.createFilterOpen = true;
}

/**
 * Runs the search the create box currently describes, for a single result, and
 * hands back both the total and the filter data the site itself would show for
 * it. One request feeds three things: the live count under the box, the broad
 * search warning, and the contents of the category dropdowns.
 */
function fetchAlertCreateFacets(searchParams) {
    const params = new URLSearchParams({ limit: '1', offset: '0', viewOptions: 'list-view' });
    Object.entries(searchParams).forEach(([key, value]) => {
        // The subcategory only counts under its plural name. As l2CategoryId
        // the endpoint accepts it and ignores it, and the count under the box
        // would be the main category's — the same number the poller was
        // matching on. The main category is the reverse (l1CategoryId works,
        // l1CategoryIds does not), so this renames one parameter.
        if (key === 'l2CategoryId') params.append('l2CategoryIds[]', value);
        else if (Array.isArray(value)) value.forEach(item => params.append(`${key}[]`, item));
        else params.set(key, value);
    });

    // Same-origin on every supported site, so this rides along on the session
    // the user already has.
    return fetch(`/lrp/api/search?${params.toString()}`, { headers: { 'Accept': 'application/json' } })
        .then(response => (response.ok ? response.json() : null))
        .then(data => {
            if (!data) return null;
            const facets = Array.isArray(data.facets) ? data.facets : [];
            const categoryFacet = facets.find(facet => facet.key === 'RelevantCategories');
            return {
                total: Number.isFinite(data.totalResultCount) ? data.totalResultCount : null,
                // Only the categories worth offering for this term, with counts.
                categories: (categoryFacet && categoryFacet.categories) || [],
                // Every main category, so picking one the term does not favour
                // stays possible. Filtered on having no parent: as soon as a
                // category is selected the site repurposes this list for its own
                // drill-down and fills it with that category's subcategories,
                // which are not main categories at all.
                categoryOptions: (Array.isArray(data.searchCategoryOptions) ? data.searchCategoryOptions : [])
                    .filter(item => item.parentId === null || item.parentId === undefined),
                attributeFacets: facets.filter(facet => facet.type === 'AttributeGroupFacet'),
                // What the site made of the ids we sent: the authoritative
                // source for their keys and names.
                selected: (data.searchRequest && data.searchRequest.categories) || {}
            };
        })
        .catch(() => null);
}

function syncAlertDraftCategoryNames(draft, selected) {
    const l1 = selected && selected.l1Category;
    // l2Categories, plural: the endpoint answers with a list even for the one
    // subcategory an alert can hold. Read as l2Category this was always
    // undefined, so the site's own key and name never reached the draft.
    const l2 = ((selected && selected.l2Categories) || [])
        .find(item => item && String(item.id) === String(draft.l2CategoryId));
    if (l1 && String(l1.id) === String(draft.l1CategoryId)) {
        draft.l1Key = l1.key || draft.l1Key;
        draft.l1Label = l1.fullName || draft.l1Label;
    }
    if (l2) {
        draft.l2Key = l2.key || draft.l2Key;
        draft.l2Label = l2.fullName || draft.l2Label;
    }
}

/**
 * Re-runs the count and refills the dropdowns for whatever is in the box now. A
 * sequence number rather than an abort: a slow early response must not land on
 * top of a newer one and put the previous term's categories back.
 */
function refreshAlertCreateFacets() {
    const input = document.getElementById('cleanplaats-alert-label-input');
    if (!input) return;

    const draft = getAlertCreateDraft();
    const params = buildAlertCreateSearchParams(draft, alertCreateQueryTerm(input.value));

    // Re-rendering the dashboard rewires this box every time — switching views,
    // toggling a row open, coming back from a PATCH — and none of that changes
    // the search. Asking the site again for an answer we are still holding costs
    // a request per click, so an unchanged box repaints from what we have.
    // Nothing typed and nothing filtered describes no search at all, and the
    // site answers that with an empty body. Worth not asking.
    if (Object.keys(params).length === 0) {
        cleanplaatsAlertsRuntime.createFacetsKey = '';
        paintAlertCategoryOptions();
        paintAlertCreateCount(null);
        return;
    }

    const key = JSON.stringify(params);
    if (key === cleanplaatsAlertsRuntime.createFacetsKey && cleanplaatsAlertsRuntime.createFacets) {
        paintAlertCategoryOptions();
        paintAlertCreateCount(cleanplaatsAlertsRuntime.createFacets.total);
        return;
    }

    cleanplaatsAlertsRuntime.createFacetsKey = key;
    const seq = ++cleanplaatsAlertsRuntime.createFacetsSeq;

    fetchAlertCreateFacets(params).then(result => {
        if (seq !== cleanplaatsAlertsRuntime.createFacetsSeq) return;
        // The panel closed while this was in flight, and the draft it describes
        // is gone. Painting now would build a new one out of nothing.
        if (!cleanplaatsAlertsRuntime.createDraft) return;
        // A failed request keeps the categories that are already on screen: a
        // dropdown emptied by a hiccup is a worse answer than a slightly stale
        // one, and the count is the only part that has to stay honest.
        if (result) {
            cleanplaatsAlertsRuntime.createFacets = result;
            if (result.categoryOptions.length > 1) {
                cleanplaatsAlertsRuntime.createMainCategories = result.categoryOptions;
            }
            // Kept while the answer still has all of them: with a subcategory
            // selected the site lists only that one, and the dropdown would
            // have nothing left to switch to.
            if (draft.l1CategoryId && !draft.l2CategoryId) {
                cleanplaatsAlertsRuntime.createSubCategories = {
                    l1: String(draft.l1CategoryId),
                    items: result.categories.filter(
                        item => String(item.parentId) === String(draft.l1CategoryId))
                };
            } else {
                loadAlertSubCategories(params, draft.l1CategoryId);
            }
            syncAlertDraftCategoryNames(draft, result.selected);
            paintAlertCategoryOptions();
            // The raw text, not the search term: this only needs *a* word to
            // ask the site for its category list, and on a category page the
            // term is deliberately empty.
            loadAlertMainCategories(input.value);
        } else {
            // Nothing came back, so nothing is cached under this key either —
            // let the next paint try again instead of repeating the silence.
            cleanplaatsAlertsRuntime.createFacetsKey = '';
        }
        paintAlertCreateCount(result ? result.total : null);
    });
}

/**
 * The main categories as the page already carries them, so the dropdown is
 * filled the moment the box opens rather than after a round trip. The two page
 * types keep them in different places: a search page in __NEXT_DATA__, with the
 * keys the alert's own link is built from, and the home page, which has no
 * __NEXT_DATA__ at all, in the header's inline config without keys. Either way
 * in the language of the site.
 *
 * Returns null when neither is readable; the request path fills the list then.
 */
function readAlertMainCategoriesFromPage() {
    try {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        const options = nextDataEl && JSON.parse(nextDataEl.textContent)
            ?.props?.pageProps?.searchRequestAndResponse?.searchCategoryOptions;
        // With a category selected the site refills this with that category's
        // children, so only the parentless entries are main categories.
        const main = (options || []).filter(item => item.parentId === null || item.parentId === undefined);
        if (main.length > 1) {
            return main.map(item => ({ id: item.id, name: item.name || item.fullName, key: item.key || '' }));
        }
    } catch (error) {
        /* A page shape we don't know. The header config below, or the request
           path, still gets there. */
    }

    try {
        const script = [...document.querySelectorAll('script')]
            .find(node => node.textContent.includes('window.__HEADER_CONFIG__'));
        if (!script) return null;

        // A plain JSON object literal, read out of the script's text the same
        // way __NEXT_DATA__ is: a content script cannot reach the page's own
        // window to read the variable itself.
        const match = script.textContent.match(/window\.__HEADER_CONFIG__\s*=\s*(\{[\s\S]*?\});/);
        if (!match) return null;

        const main = (JSON.parse(match[1])?.searchBar?.categoryOptions || [])
            // Its own "all categories" entry, which this dropdown already has.
            .filter(item => item.value && item.value !== '0')
            .map(item => ({ id: item.value, name: item.label, key: '' }));
        return main.length > 1 ? main : null;
    } catch (error) {
        return null;
    }
}

/**
 * Stops scanning once the list has keys, and upgrades a keyless one (read off a
 * home page) as soon as a page that does carry them is open. That also bounds
 * the work: the scan repeats only while there is something better to find.
 */
function ensureAlertMainCategoriesFromPage() {
    const current = cleanplaatsAlertsRuntime.createMainCategories;
    if (current && current.some(item => item.key)) return;

    const fromPage = readAlertMainCategoriesFromPage();
    if (fromPage && (!current || fromPage.some(item => item.key))) {
        cleanplaatsAlertsRuntime.createMainCategories = fromPage;
    }
}

/**
 * The main categories from a request, for the pages that carry neither list.
 * They do not depend on the search term, and the box's own request cannot be
 * relied on for them: the moment it carries a category the site answers with
 * that branch instead of the whole list. So one extra request, and only when
 * there is nothing on the page to read.
 */
function loadAlertMainCategories(term) {
    if (cleanplaatsAlertsRuntime.createMainCategories) return;
    // Every keystroke comes back through here until the list lands, and they
    // would all ask for the same thing.
    if (cleanplaatsAlertCreateCategoriesPending) return;

    // A search with no term at all comes back with an empty body, so there is
    // nothing to ask for yet. The next keystroke arrives back here.
    const query = String(term || '').trim();
    if (!query) return;

    cleanplaatsAlertCreateCategoriesPending = true;
    fetchAlertCreateFacets({ query }).then(result => {
        cleanplaatsAlertCreateCategoriesPending = false;
        if (!result || result.categoryOptions.length <= 1) return;
        // Worth keeping whenever it arrives — the list outlives any one draft.
        cleanplaatsAlertsRuntime.createMainCategories = result.categoryOptions;
        // Painting is a different matter: with the box gone it would leave an
        // empty draft behind that the next seed then refuses to fill.
        if (cleanplaatsAlertsRuntime.createDraft) paintAlertCategoryOptions();
    });
}

/**
 * The subcategories of the main category in the box, asked for without the
 * subcategory that is already selected. With one selected the ordinary request
 * comes back listing only that one, which is the right answer to the question
 * it was asked and the wrong list for a dropdown: the user opened the panel on
 * a subcategory page and would have nothing to switch to. One request per main
 * category, and only when the ordinary one cannot supply the list itself.
 */
function loadAlertSubCategories(params, l1CategoryId) {
    if (!l1CategoryId || !params.l2CategoryId) return;

    const l1 = String(l1CategoryId);
    const cached = cleanplaatsAlertsRuntime.createSubCategories;
    if (cached && String(cached.l1) === l1) return;
    if (cleanplaatsAlertCreateSubCategoriesPending === l1) return;

    const { l2CategoryId, ...withoutSubcategory } = params;
    cleanplaatsAlertCreateSubCategoriesPending = l1;
    fetchAlertCreateFacets(withoutSubcategory).then(result => {
        cleanplaatsAlertCreateSubCategoriesPending = '';
        if (!result) return;
        const items = result.categories.filter(item => String(item.parentId) === l1);
        if (items.length === 0) return;
        cleanplaatsAlertsRuntime.createSubCategories = { l1, items };
        // Same reason as loadAlertMainCategories: with the box gone, painting
        // would leave an empty draft behind that the next seed then refuses.
        if (cleanplaatsAlertsRuntime.createDraft) paintAlertCategoryOptions();
    });
}

function scheduleAlertCreateRefresh(delay = 400) {
    clearTimeout(cleanplaatsAlertCreateRefreshTimer);
    cleanplaatsAlertCreateRefreshTimer = setTimeout(refreshAlertCreateFacets, delay);
}

function addAlertCategoryOption(parent, value, label, count, selectedValue, key) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = count
        ? `${label} · ${count.toLocaleString(CLEANPLAATS_ALERTS_NUMBER_LOCALE)}`
        : String(label);
    // The name without the result count, and the slug the alert's link is built
    // from, kept beside the option rather than parsed back out of its text:
    // "Racefietsen · 27.197" is what the user reads, not what either is.
    option.dataset.label = String(label);
    if (key) option.dataset.key = String(key);
    if (String(selectedValue || '') === String(value)) option.selected = true;
    parent.appendChild(option);
}

/**
 * Built as elements rather than markup: the labels are the site's own text, and
 * this way there is no escaping to get wrong. Repainting the options instead of
 * the whole block also keeps focus where the user put it.
 */
function paintAlertCategoryOptions() {
    const l1Select = document.getElementById('cleanplaats-alert-cat1');
    const l2Select = document.getElementById('cleanplaats-alert-cat2');
    if (!l1Select || !l2Select) return;

    const draft = getAlertCreateDraft();
    const facets = cleanplaatsAlertsRuntime.createFacets;
    const allCategories = cleanplaatsAlertsRuntime.createMainCategories || [];
    const tree = (facets && facets.categories) || [];
    const relevantIds = new Set(
        tree.filter(item => item.parentId === null || item.parentId === undefined)
            .map(item => String(item.id))
    );

    l1Select.textContent = '';
    addAlertCategoryOption(l1Select, '', ALERTS_TEXT.createFilterCategoryAll, 0, draft.l1CategoryId);

    if (allCategories.length === 0) {
        // Nothing has come back yet. Keep a category that is already chosen
        // visible, so a prefilled one does not blink away while the first
        // request is out.
        if (draft.l1CategoryId) {
            addAlertCategoryOption(l1Select, draft.l1CategoryId,
                draft.l1Label || ALERTS_TEXT.createFilterCategoryLoading, 0, draft.l1CategoryId, draft.l1Key);
        }
        l1Select.disabled = true;
    } else {
        const relevant = allCategories.filter(item => relevantIds.has(String(item.id)));
        const rest = allCategories.filter(item => !relevantIds.has(String(item.id)));
        // The site puts the categories that fit the term first. Only worth two
        // groups when both are non-empty; otherwise the headings say nothing.
        const groups = (relevant.length > 0 && rest.length > 0)
            ? [[ALERTS_TEXT.createFilterCategoryRelevant, relevant], [ALERTS_TEXT.createFilterCategoryOther, rest]]
            : [[null, allCategories]];

        groups.forEach(([groupLabel, items]) => {
            let target = l1Select;
            if (groupLabel) {
                target = document.createElement('optgroup');
                target.label = groupLabel;
                l1Select.appendChild(target);
            }
            items.forEach(item => addAlertCategoryOption(
                target, item.id, item.name || item.fullName, 0, draft.l1CategoryId, item.key));
        });
        l1Select.disabled = false;
    }

    l2Select.textContent = '';
    addAlertCategoryOption(l2Select, '', ALERTS_TEXT.createFilterSubcategoryAll, 0, draft.l2CategoryId);

    if (!draft.l1CategoryId) {
        l2Select.disabled = true;
        return;
    }

    // A selected subcategory narrows the site's own category facet to that one
    // subcategory. The last answer that still listed the siblings describes
    // them just as well, and keeps switching to one of them a single click.
    const listed = tree.filter(item => String(item.parentId) === String(draft.l1CategoryId));
    const remembered = cleanplaatsAlertsRuntime.createSubCategories;
    const children = (listed.length <= 1 && draft.l2CategoryId && remembered
        && String(remembered.l1) === String(draft.l1CategoryId))
        ? remembered.items
        : listed;

    const seen = new Set();
    children.forEach(item => {
        seen.add(String(item.id));
        addAlertCategoryOption(l2Select, item.id, item.label, item.histogramCount, draft.l2CategoryId, item.key);
    });

    // A subcategory the term no longer turns up (you retyped the search) must
    // not disappear out of the dropdown without a word: leaving it selected lets
    // the live count underneath explain what happened.
    if (draft.l2CategoryId && !seen.has(String(draft.l2CategoryId))) {
        addAlertCategoryOption(l2Select, draft.l2CategoryId,
            draft.l2Label || ALERTS_TEXT.createFilterCategoryLoading, 0, draft.l2CategoryId, draft.l2Key);
    }

    l2Select.disabled = children.length === 0 && !draft.l2CategoryId;
}

function paintAlertCreateFilterCount() {
    const countEl = document.querySelector('.cleanplaats-alerts-create-filters .cleanplaats-alerts-filter-count');
    if (!countEl) return;

    const active = countAlertCreateFilters(getAlertCreateDraft());
    countEl.textContent = active > 0 ? ALERTS_TEXT.filterCountActive(active) : ALERTS_TEXT.createFilterNone;
    countEl.classList.toggle('cleanplaats-alerts-filter-count-zero', active === 0);
}

/**
 * The line under the box: how many advertisements the search finds right now,
 * and, past the point where an alert would fire constantly, the warning that
 * used to be the only thing here.
 */
function paintAlertCreateCount(total) {
    const countEl = document.getElementById('cleanplaats-alert-result-count');
    const warningEl = document.getElementById('cleanplaats-alert-broad-warning');
    if (warningEl) warningEl.hidden = true;
    if (!countEl) return;

    if (!Number.isFinite(total)) {
        // No count is no reason to say anything: the box still works.
        countEl.textContent = '';
        countEl.hidden = true;
        return;
    }

    countEl.hidden = false;
    countEl.textContent = total === 0
        ? ALERTS_TEXT.createResultCountNone
        : ALERTS_TEXT.createResultCount(total);
    countEl.classList.toggle('cleanplaats-alerts-create-count-none', total === 0);

    if (warningEl && total >= CLEANPLAATS_ALERTS_BROAD_RESULT_COUNT) {
        warningEl.textContent = ALERTS_TEXT.createBroadWarning(total);
        warningEl.hidden = false;
    }
}

function buildAlertCreateFacetsHtml() {
    const facets = (cleanplaatsAlertsRuntime.createFacets || {}).attributeFacets || [];
    const draft = getAlertCreateDraft();

    return ALERT_CREATE_FACET_KEYS.map(key => {
        const facet = facets.find(item => item.key === key);
        const values = (facet && facet.attributeGroup) || [];
        if (values.length === 0) return '';

        const boxes = values.map(value => `
            <label class="cleanplaats-alerts-create-facet-opt">
                <input type="checkbox" data-facet-value="${escapeHtmlText(String(value.attributeValueId))}"${draft.attributesById.includes(String(value.attributeValueId)) ? ' checked' : ''}>
                <span class="cleanplaats-alerts-filter-opt-box">${alertIcon('check', 12)}</span>
                <span class="cleanplaats-alerts-filter-opt-label">${escapeHtmlText(value.attributeValueLabel || value.attributeValueKey || '')}</span>
            </label>
        `).join('');

        return `
            <div class="cleanplaats-alerts-create-field">
                <span class="cleanplaats-alerts-create-field-label">${escapeHtmlText(facet.label || '')}</span>
                <div class="cleanplaats-alerts-create-facet-opts">${boxes}</div>
            </div>
        `;
    }).join('');
}

function buildAlertCreateFilterHtml() {
    // Before the first paint, so the category dropdown comes up filled instead
    // of greyed out until a request lands.
    ensureAlertMainCategoriesFromPage();

    const draft = getAlertCreateDraft();
    const open = cleanplaatsAlertsRuntime.createFilterOpen;
    const active = countAlertCreateFilters(draft);
    const summary = active > 0
        ? `<span class="cleanplaats-alerts-filter-count">${ALERTS_TEXT.filterCountActive(active)}</span>`
        : `<span class="cleanplaats-alerts-filter-count cleanplaats-alerts-filter-count-zero">${ALERTS_TEXT.createFilterNone}</span>`;

    const distanceOptions = [
        `<option value="">${escapeHtmlText(ALERTS_TEXT.createFilterDistanceAll)}</option>`,
        ...ALERT_DISTANCE_STEPS.map(meters => {
            const selected = String(draft.distanceMeters) === String(meters) ? ' selected' : '';
            return `<option value="${meters}"${selected}>${escapeHtmlText(ALERTS_TEXT.createFilterDistanceOption(meters / 1000))}</option>`;
        })
    ].join('');

    const euros = cents => (cents === null ? '' : String(Math.round(cents / 100)));
    const postcodeValid = isValidAlertPostcode(draft.postcode);

    return `
        <div class="cleanplaats-alerts-create-filters${open ? ' cleanplaats-alerts-create-filters-open' : ''}">
            <button type="button" class="cleanplaats-alerts-create-filters-trigger" id="cleanplaats-alert-filters-trigger" aria-expanded="${open ? 'true' : 'false'}" aria-controls="cleanplaats-alert-filters-editor">
                <span class="cleanplaats-alerts-create-filters-trigger-left">
                    ${alertIcon('filter', 13)}<span>${ALERTS_TEXT.createFilterTrigger}</span>${summary}
                </span>
                <span class="cleanplaats-alerts-filter-chevron">${alertIcon('chevron', 15)}</span>
            </button>
            <div class="cleanplaats-alerts-create-filters-editor" id="cleanplaats-alert-filters-editor"${open ? '' : ' hidden'}>
                <div class="cleanplaats-alerts-create-field">
                    <span class="cleanplaats-alerts-create-field-label">${ALERTS_TEXT.createFilterCategory}</span>
                    <div class="cleanplaats-alerts-create-field-controls">
                        <select id="cleanplaats-alert-cat1" aria-label="${ALERTS_TEXT.createFilterCategory}" disabled></select>
                        <select id="cleanplaats-alert-cat2" aria-label="${ALERTS_TEXT.createFilterSubcategory}" disabled></select>
                    </div>
                </div>
                <div class="cleanplaats-alerts-create-field">
                    <span class="cleanplaats-alerts-create-field-label">${ALERTS_TEXT.createFilterPrice}</span>
                    <div class="cleanplaats-alerts-create-field-controls">
                        <span class="cleanplaats-alerts-create-money">
                            <span class="cleanplaats-alerts-create-money-sign">€</span>
                            <input type="text" id="cleanplaats-alert-price-min" inputmode="numeric" maxlength="9" value="${escapeHtmlText(euros(draft.priceMinCents))}" placeholder="${ALERTS_TEXT.createFilterPriceFrom}" aria-label="${ALERTS_TEXT.createFilterPriceFrom}">
                        </span>
                        <span class="cleanplaats-alerts-create-money">
                            <span class="cleanplaats-alerts-create-money-sign">€</span>
                            <input type="text" id="cleanplaats-alert-price-max" inputmode="numeric" maxlength="9" value="${escapeHtmlText(euros(draft.priceMaxCents))}" placeholder="${ALERTS_TEXT.createFilterPriceTo}" aria-label="${ALERTS_TEXT.createFilterPriceTo}">
                        </span>
                    </div>
                </div>
                <div class="cleanplaats-alerts-create-field">
                    <span class="cleanplaats-alerts-create-field-label">${ALERTS_TEXT.createFilterDistance}</span>
                    <div class="cleanplaats-alerts-create-field-controls">
                        <input type="text" id="cleanplaats-alert-postcode" maxlength="8" value="${escapeHtmlText(draft.postcode)}" placeholder="${ALERTS_TEXT.createFilterPostcode}" aria-label="${ALERTS_TEXT.createFilterPostcode}">
                        <select id="cleanplaats-alert-distance" aria-label="${ALERTS_TEXT.createFilterDistance}"${postcodeValid ? '' : ' disabled'}>${distanceOptions}</select>
                    </div>
                </div>
                ${buildAlertCreateFacetsHtml()}
                <div class="cleanplaats-alerts-create-hint" id="cleanplaats-alert-postcode-hint" hidden>${ALERTS_TEXT.createFilterPostcodeInvalid}</div>
            </div>
        </div>
    `;
}

function buildAlertsCreateHtml(context, me) {
    const atLimit = (me.alertCount || 0) >= me.maxAlerts;
    return `
        <section class="cleanplaats-alerts-create">
            <div class="cleanplaats-alerts-create-title">${ALERTS_TEXT.createTitle}</div>
            <div class="cleanplaats-alerts-form-row">
                <input type="text" id="cleanplaats-alert-label-input" value="${context ? escapeHtmlText(context.suggestedLabel) : ''}" placeholder="${ALERTS_TEXT.labelPlaceholder}" maxlength="120" aria-label="${ALERTS_TEXT.createTitle}">
                <button id="cleanplaats-alert-create" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.createButton}</button>
            </div>
            ${context ? `<div class="cleanplaats-alerts-create-note" id="cleanplaats-alert-create-note">${ALERTS_TEXT.createContextHint}</div>` : ''}
            ${buildAlertCreateFilterHtml()}
            <div class="cleanplaats-alerts-create-count" id="cleanplaats-alert-result-count" hidden></div>
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

    const currentSite = getCleanplaatsSiteKey() || 'marktplaats';

    const rows = alerts.map(alert => {
        const validity = getAlertValidity(alert);
        const expired = Boolean(validity && validity.expired);
        const statusClass = alertStatusClass(alert, me);
        const checkText = alertCheckCellHtml(alert, me);

        const label = alert.search_url
            ? `<a href="${escapeHtmlText(alert.search_url)}" class="cleanplaats-alerts-card-label">${escapeHtmlText(alert.label)}</a>`
            : `<span class="cleanplaats-alerts-card-label">${escapeHtmlText(alert.label)}</span>`;

        // Only rows from somewhere else get a badge: naming the site you are
        // already on would put a label on every row and say nothing.
        const alertSite = alert.site || 'marktplaats';
        const siteBadge = alertSite === currentSite
            ? ''
            : `<span class="cleanplaats-alerts-site-badge" title="${escapeHtmlText(ALERTS_TEXT.alertOtherSiteTitle(getAlertsSiteName(alertSite)))}">${escapeHtmlText(getAlertsSiteName(alertSite))}</span>`;

        const matchCount = alert.match_count || 0;
        const openable = matchCount > 0 || (alert.baseline_count || 0) > 0;
        const matchCell = openable
            ? `<button type="button" class="cleanplaats-alerts-match-badge cleanplaats-alerts-match-badge-link" data-open-matches="${alert.id}" aria-label="${escapeHtmlText(ALERTS_TEXT.alertMatchesOpen(alert.label))}">${ALERTS_TEXT.matchCount(matchCount)}${alertIcon('chevron', 13)}</button>`
            : `<span class="cleanplaats-alerts-match-badge cleanplaats-alerts-match-badge-zero">${ALERTS_TEXT.matchCount(matchCount)}</span>`;

        const validityCell = alertValidityCellHtml(alert, me);

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
                        <span class="cleanplaats-alerts-status-dot" title="${statusClass === 'expired' ? ALERTS_TEXT.validityExpired : (statusClass === 'active' ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel)}"></span>
                        ${label}${siteBadge}
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
                                <button class="cleanplaats-alerts-text-btn cleanplaats-alerts-text-btn-danger cleanplaats-alerts-delete" data-alert-id="${alert.id}" data-alert-label="${escapeHtmlText(alert.label)}">${alertIcon('trash', 14)}<span>${ALERTS_TEXT.deleteButton}</span></button>
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
                        <span class="cleanplaats-alerts-identity-email" title="${escapeHtmlText(me.email)}">${escapeHtmlText(me.email)}</span>
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

    // A create just went through, so this one render starts from nothing. The
    // page behind the panel has not changed, so seeding from it again would put
    // the filters that were just saved straight back into the empty box.
    const cleared = cleanplaatsAlertsRuntime.createCleared;
    cleanplaatsAlertsRuntime.createCleared = false;
    const context = cleared ? null : getAlertSearchContext();

    // Before the create box is built, so its controls come up already showing
    // whatever the page we were opened from had filtered on.
    seedAlertCreateDraftFromContext(context);

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
            ${buildAlertsUnlinkedNoticeHtml(me, alerts)}
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

// The count under the create box, and the warning that goes with it, are
// painted by refreshAlertCreateFacets(): the request that fills the category
// dropdowns already carries the total, so the box asks the site once rather
// than twice about the same search. See paintAlertCreateCount().

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
    main.querySelector('#cleanplaats-alerts-notice-link')
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

/**
 * The filter controls under the term input. Every change writes straight into
 * the draft on the runtime and asks the site for a fresh count, so what the box
 * says it will watch and what it will actually watch never drift apart.
 */
function wireAlertCreateFilters(main) {
    const block = main.querySelector('.cleanplaats-alerts-create-filters');
    const trigger = main.querySelector('#cleanplaats-alert-filters-trigger');
    const editor = main.querySelector('#cleanplaats-alert-filters-editor');
    if (!block || !trigger || !editor) return;

    const draft = getAlertCreateDraft();

    trigger.addEventListener('click', () => {
        const opening = editor.hasAttribute('hidden');
        if (opening) editor.removeAttribute('hidden');
        else editor.setAttribute('hidden', '');
        trigger.setAttribute('aria-expanded', String(opening));
        block.classList.toggle('cleanplaats-alerts-create-filters-open', opening);
        cleanplaatsAlertsRuntime.createFilterOpen = opening;
    });

    const afterChange = (immediate = true) => {
        paintAlertCreateFilterCount();
        paintAlertCategoryOptions();
        if (immediate) refreshAlertCreateFacets();
        else scheduleAlertCreateRefresh();
    };

    const l1Select = main.querySelector('#cleanplaats-alert-cat1');
    const l2Select = main.querySelector('#cleanplaats-alert-cat2');

    // The option carries the site's own slug and its plain name. Reading them
    // here means the alert's link is right from the click rather than from the
    // next response — create before that lands and the row still opens the
    // category, not a broader search — and that a subcategory's stored name
    // never keeps the result count that is only there to be read.
    l1Select?.addEventListener('change', () => {
        const option = l1Select.selectedOptions[0];
        draft.l1CategoryId = l1Select.value;
        draft.l1Key = option?.dataset.key || '';
        draft.l1Label = option?.dataset.label || '';
        // The subcategory belonged to the old category, so it goes with it.
        draft.l2CategoryId = '';
        draft.l2Key = '';
        draft.l2Label = '';
        afterChange();
    });

    l2Select?.addEventListener('change', () => {
        const option = l2Select.selectedOptions[0];
        draft.l2CategoryId = l2Select.value;
        draft.l2Key = option?.dataset.key || '';
        draft.l2Label = option?.dataset.label || '';
        afterChange();
    });

    const priceMin = main.querySelector('#cleanplaats-alert-price-min');
    const priceMax = main.querySelector('#cleanplaats-alert-price-max');

    // Whole euros only, and anything that is not a digit is dropped as it is
    // typed: "1.500" and "1 500" mean the same thing and both have to work.
    const readPrice = input => {
        const digits = String(input.value || '').replace(/[^\d]/g, '');
        if (digits !== input.value) input.value = digits;
        return digits ? Number(digits) * 100 : null;
    };

    priceMin?.addEventListener('input', () => {
        draft.priceMinCents = readPrice(priceMin);
        afterChange(false);
    });
    priceMax?.addEventListener('input', () => {
        draft.priceMaxCents = readPrice(priceMax);
        afterChange(false);
    });

    // Once the field is left alone, put the two ends on screen in the order the
    // search will actually use them, so nothing is reinterpreted behind the
    // user's back. Not while typing: "5" on its way to "5000" is briefly below
    // the maximum and swapping it there would fight the keyboard.
    const orderPriceFields = () => {
        const ordered = alertPriceRangeFor(draft);
        if (!ordered || ordered.from === null || ordered.to === null) return;
        if (draft.priceMinCents <= draft.priceMaxCents) return;
        draft.priceMinCents = ordered.from;
        draft.priceMaxCents = ordered.to;
        if (priceMin) priceMin.value = String(Math.round(ordered.from / 100));
        if (priceMax) priceMax.value = String(Math.round(ordered.to / 100));
    };
    priceMin?.addEventListener('change', orderPriceFields);
    priceMax?.addEventListener('change', orderPriceFields);

    const postcode = main.querySelector('#cleanplaats-alert-postcode');
    const distance = main.querySelector('#cleanplaats-alert-distance');
    const postcodeHint = main.querySelector('#cleanplaats-alert-postcode-hint');

    // A radius means nothing without a postcode, so it stays out of reach until
    // there is one the site can actually resolve. Half-typed is not yet wrong:
    // the hint waits until something is in the field.
    const applyPostcodeState = () => {
        const valid = isValidAlertPostcode(draft.postcode);
        if (distance) {
            distance.disabled = !valid;
            if (!valid) {
                distance.value = '';
                draft.distanceMeters = '';
            }
        }
        if (postcodeHint) postcodeHint.hidden = valid || draft.postcode.trim().length === 0;
    };

    postcode?.addEventListener('input', () => {
        draft.postcode = postcode.value;
        applyPostcodeState();
        afterChange(false);
    });

    distance?.addEventListener('change', () => {
        draft.distanceMeters = distance.value;
        afterChange();
    });

    main.querySelectorAll('[data-facet-value]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const value = checkbox.dataset.facetValue;
            draft.attributesById = checkbox.checked
                ? [...new Set([...draft.attributesById, value])]
                : draft.attributesById.filter(item => item !== value);
            afterChange();
        });
    });

    applyPostcodeState();
    paintAlertCategoryOptions();
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

    wireAlertCreateFilters(main);

    // The count and the categories belong to whatever is in the box, not to the
    // page it was opened from: someone who types a term of their own gets the
    // same numbers and the same choices as someone who arrived from a search.
    if (labelInput) {
        labelInput.addEventListener('input', () => scheduleAlertCreateRefresh());
    }
    refreshAlertCreateFacets();

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

        // The controls are the whole truth about the search now: they start out
        // holding whatever the page we were opened from filtered on, and the
        // user can see and change every part of that. So there is no longer a
        // context to fall back on, and editing the term no longer quietly drops
        // the filters that came with it.
        const draft = getAlertCreateDraft();
        // On a category page the box names the alert after the category, and
        // that name is not something to search for. What is left is the
        // category itself, which is exactly the search on screen.
        const query = alertCreateQueryTerm(term);
        const searchParams = buildAlertCreateSearchParams(draft, query);
        const searchUrl = buildAlertSearchUrl(draft, query);

        // Clearing the category out of an alert that never had a term leaves
        // nothing to watch but the whole site.
        if (Object.keys(searchParams).length === 0) {
            showBubbleNotification(ALERTS_TEXT.createTermMissing);
            if (labelInput) labelInput.focus();
            return;
        }

        createButton.disabled = true;
        alertsApiFetch('/api/alerts', {
            method: 'POST',
            body: JSON.stringify({
                label: term,
                // The site the alert is made on decides where it is polled and
                // which origin its links carry, so it travels with the search
                // itself rather than being inferred later.
                site: getCleanplaatsSiteKey(),
                searchParams,
                searchUrl,
                filters: getDefaultAlertFilters()
            })
        }).then(() => {
            showBubbleNotification(ALERTS_TEXT.createdToast);
            // The next zoekopdracht is a new one: leaving this one's filters in
            // the box would quietly attach them to whatever gets typed next.
            // The flag makes that stick through the reload underneath, which
            // re-renders the box and would otherwise seed it from the page all
            // over again.
            resetAlertCreateDraft();
            cleanplaatsAlertsRuntime.createCleared = true;
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
                        .catch(error => notifyAlertsError(error, error && error.message));
                }
            });
        };
    });

    main.querySelectorAll('.cleanplaats-alerts-switch-status').forEach(button => {
        button.onclick = () => {
            const alertId = button.dataset.alertId;
            const nextEnabled = button.dataset.enabled !== '1';
            alertsApiFetch(`/api/alerts/${alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: nextEnabled })
            }).then(response => {
                // Resuming an alert also switches its channel back on, so the
                // row is repainted from the server's answer rather than from
                // the one value this button knows about.
                applyAlertRowState(main, alertId, response, { enabled: nextEnabled });
            }).catch(error => notifyAlertsError(error));
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
            }).catch(error => {
                button.disabled = false;
                notifyAlertsError(error);
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
            const alertId = button.dataset.alertId;
            const next = button.dataset.value !== '1';
            const me = cleanplaatsAlertsRuntime.me;

            // Telegram is the only channel with a switch; the e-mail one is gone
            // while server-side e-mail notifications are off. That makes
            // switching it off the same thing as pausing: the alert would keep
            // costing checks against Marktplaats with nowhere to send the
            // result. The server pauses it along with the channel, so the panel
            // says that first instead of letting a second switch move by itself.
            const alsoPauses = !next && me && me.telegramOnlyChannel !== false;
            const send = () => alertsApiFetch(`/api/alerts/${alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ notifyTelegram: next })
            }).then(response => {
                applyAlertRowState(main, alertId, response, { notifyTelegram: next });
            }).catch(error => notifyAlertsError(error));

            if (!alsoPauses) {
                send();
                return;
            }
            openAlertsConfirm({
                title: ALERTS_TEXT.telegramOffPauseTitle,
                body: ALERTS_TEXT.telegramOffPauseBody,
                confirmLabel: ALERTS_TEXT.telegramOffPauseConfirm,
                danger: false,
                onConfirm: send
            });
        };
    });
}

/**
 * Repaint one row from the state the server reports back. A single click can
 * move both switches (the channel and the pause state are one thing while
 * Telegram is the only way out), and reloading the whole dashboard would fold
 * shut the detail row the user is working in, so the row is patched in place.
 * `fallback` covers a server that predates the state in the response.
 */
function applyAlertRowState(main, alertId, response, fallback) {
    const me = cleanplaatsAlertsRuntime.me;
    const enabled = typeof response?.enabled === 'boolean'
        ? response.enabled
        : Boolean(fallback.enabled ?? fallback.notifyTelegram);
    const notifyTelegram = typeof response?.notifyTelegram === 'boolean'
        ? response.notifyTelegram
        : Boolean(fallback.notifyTelegram ?? fallback.enabled);

    // The cache feeds the status strip and every re-render of this view, so it
    // moves first: leaving it stale is how a paused search keeps being counted
    // among the running ones.
    const cached = (cleanplaatsAlertsRuntime.cachedAlerts || [])
        .find(alert => String(alert.id) === String(alertId));
    const wasEnabled = cached ? Boolean(cached.enabled) : enabled;
    if (cached) {
        cached.enabled = enabled ? 1 : 0;
        cached.notify_telegram = notifyTelegram ? 1 : 0;
    }

    const group = main.querySelector(`.cleanplaats-alerts-row-group[data-alert-id="${alertId}"]`);
    if (group) {
        const statusSwitch = group.querySelector('.cleanplaats-alerts-switch-status');
        if (statusSwitch) {
            statusSwitch.dataset.enabled = enabled ? '1' : '0';
            statusSwitch.setAttribute('aria-checked', String(enabled));
            statusSwitch.classList.toggle('on', enabled);
            const label = statusSwitch.querySelector('.cleanplaats-alerts-switch-label');
            if (label) label.textContent = enabled ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel;
        }

        const channelSwitch = group.querySelector('.cleanplaats-alerts-switch[data-channel="telegram"]:not(.cleanplaats-alerts-switch-locked)');
        if (channelSwitch) {
            channelSwitch.dataset.value = notifyTelegram ? '1' : '0';
            channelSwitch.setAttribute('aria-checked', String(notifyTelegram));
            channelSwitch.classList.toggle('on', notifyTelegram);
        }

        if (cached && me) {
            const statusClass = alertStatusClass(cached, me);
            group.classList.remove(
                'cleanplaats-alerts-alert-active',
                'cleanplaats-alerts-alert-paused',
                'cleanplaats-alerts-alert-expired'
            );
            group.classList.add(`cleanplaats-alerts-alert-${statusClass}`);

            const dot = group.querySelector('.cleanplaats-alerts-status-dot');
            if (dot) {
                dot.title = statusClass === 'expired'
                    ? ALERTS_TEXT.validityExpired
                    : (statusClass === 'active' ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel);
            }

            // "Volgende controle over 4 minuten" is no longer true once the
            // alert is paused, so the check column is rewritten with it. The
            // validity column goes along: a paused search is not counting down
            // to the Telegram deadline either.
            const checkValue = group.querySelector('.cleanplaats-alerts-cell-check .cleanplaats-alerts-cell-value');
            if (checkValue) checkValue.innerHTML = DOMPurify.sanitize(alertCheckCellHtml(cached, me));

            const validityCell = group.querySelector('.cleanplaats-alerts-cell-validity');
            if (validityCell) validityCell.innerHTML = DOMPurify.sanitize(alertValidityCellHtml(cached, me));
        }
    }

    // Only when the channel switch was what moved the pause state: saying "staat
    // nu op pauze" after someone pressed the pause button is noise.
    if (fallback.notifyTelegram !== undefined && enabled !== wasEnabled) {
        showBubbleNotification(enabled ? ALERTS_TEXT.telegramOnResumedToast : ALERTS_TEXT.telegramOffPausedToast);
    }
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
                        .catch(error => notifyAlertsError(error));
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
                .catch(error => notifyAlertsError(error, error && error.message))
                .then(() => {
                    if (!test.isConnected) return;
                    test.disabled = false;
                    test.textContent = ALERTS_TEXT.telegramTestButton;
                });
        };
    }
}

/**
 * Collapsed, a filter block shows nothing but a count, so that count has to be
 * painted from the boxes themselves: once when a change is made, and again when
 * a failed save puts a tick back.
 */
function paintAlertFilterCount(block) {
    const countEl = block.querySelector('.cleanplaats-alerts-filter-count');
    if (!countEl) return;

    const activeCount = [...block.querySelectorAll('.cleanplaats-alerts-filter-opt input[type="checkbox"]')]
        .filter(cb => cb.checked).length;

    if (activeCount > 0) {
        countEl.textContent = ALERTS_TEXT.filterCountActive(activeCount);
        countEl.classList.remove('cleanplaats-alerts-filter-count-zero');
    } else {
        countEl.textContent = ALERTS_TEXT.filterNoneActive;
        countEl.classList.add('cleanplaats-alerts-filter-count-zero');
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
            paintAlertFilterCount(block);

            checkbox.disabled = true;
            alertsApiFetch(`/api/alerts/${alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ filters })
            }).then(() => {
                checkbox.disabled = false;
            }).catch(error => {
                checkbox.disabled = false;
                checkbox.checked = !checkbox.checked;
                // The tick went back, so the count has to go back with it, or the
                // collapsed block keeps reporting the filter set the save failed
                // to make.
                paintAlertFilterCount(block);
                notifyAlertsError(error);
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

var ALERTS_WALKTHROUGH_TEXT_NL = {
    skip: 'Overslaan',
    next: 'Volgende',
    done: 'Aan de slag',
    counter: (index, total) => `${index} van ${total}`,
    loginTitle: 'Eerst een account',
    loginBody: 'Je e-mailadres is je account. Je krijgt er een inlogcode op, dus er is geen wachtwoord om te onthouden.',
    createTitle: 'Maak je eerste melding',
    createBody: 'Je huidige zoekopdracht staat al ingevuld, mét de filters die je nu gebruikt. Pas categorie, prijs of afstand hieronder nog aan, en Cleanplaats zoekt vanaf nu voor je door.',
    createBodyPlain: 'Vul hier een zoekterm in en verfijn hem met categorie, prijs en afstand. Kom je vanaf een zoekresultatenpagina, dan staan die filters al ingevuld.',
    telegramTitle: 'Koppel Telegram',
    telegramBody: 'Je meldingen komen binnen via Telegram, ook als je browser dicht is. Zonder koppeling blijft het stil.',
    telegramLinkedTitle: 'Zo ontvang je ze',
    telegramLinkedBody: 'Telegram is gekoppeld. Zet je hem bij een zoekopdracht uit, dan pauzeert die zoekopdracht ook: er is dan niemand meer om iets naartoe te sturen.',
    matchesTitle: 'Alles komt hier binnen',
    matchesBody: 'Elke gevonden advertentie verschijnt in deze lijst, met NIEUW ernaast zolang je hem nog niet bekeken hebt.'
};

var ALERTS_WALKTHROUGH_TEXT_FR = {
    skip: 'Passer',
    next: 'Suivant',
    done: 'C’est parti',
    counter: (index, total) => `${index} sur ${total}`,
    loginTitle: 'D’abord un compte',
    loginBody: 'Votre adresse e-mail est votre compte. Vous y recevez un code de connexion, il n’y a donc pas de mot de passe à retenir.',
    createTitle: 'Créez votre première recherche',
    createBody: 'Votre recherche actuelle est déjà remplie, avec les filtres que vous utilisez. Ajustez encore la catégorie, le prix ou la distance ci-dessous, et Cleanplaats continue à chercher pour vous.',
    createBodyPlain: 'Saisissez un terme ici et affinez-le avec la catégorie, le prix et la distance. Si vous venez d’une page de résultats, ces filtres sont déjà remplis.',
    telegramTitle: 'Liez Telegram',
    telegramBody: 'Vos notifications arrivent via Telegram, même navigateur fermé. Sans liaison, rien ne part.',
    telegramLinkedTitle: 'Voilà comment vous les recevez',
    telegramLinkedBody: 'Telegram est lié. Si vous le coupez pour une recherche, celle-ci passe aussi en pause : il n’y a alors plus personne à qui envoyer quoi que ce soit.',
    matchesTitle: 'Tout arrive ici',
    matchesBody: 'Chaque annonce trouvée apparaît dans cette liste, avec NOUVEAU à côté tant que vous ne l’avez pas ouverte.'
};

var ALERTS_WALKTHROUGH_TEXT = is2ememainLocale() ? ALERTS_WALKTHROUGH_TEXT_FR : ALERTS_WALKTHROUGH_TEXT_NL;

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

    // The create box lives on the Zoekopdrachten view; from the advertisements
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
        <div class="cleanplaats-alerts-walk-title">${escapeHtmlText(step.title)}</div>
        <div class="cleanplaats-alerts-walk-body">${escapeHtmlText(step.body)}</div>
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
