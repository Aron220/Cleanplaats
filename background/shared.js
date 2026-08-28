/**
 * Cleanplaats background shared state and constants.
 */

console.log('Cleanplaats background.js: Script execution started/restarted.', new Date().toISOString());

var browserAPI = typeof browser !== 'undefined' ? browser : chrome;

var resultsPerPage = '30';
var defaultSortMode = 'standard';
var removePromotedListings = true;
var lastMarktplaatsActivity = Date.now();

var SORT_MODES = {
    standard: { sortBy: 'OPTIMIZED', sortOrder: 'DECREASING' },
    date_new_old: { sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' },
    date_old_new: { sortBy: 'SORT_INDEX', sortOrder: 'INCREASING' },
    price_low_high: { sortBy: 'PRICE', sortOrder: 'INCREASING' },
    price_high_low: { sortBy: 'PRICE', sortOrder: 'DECREASING' },
    distance: { sortBy: 'LOCATION', sortOrder: 'INCREASING' }
};

var API_RULE_ID = 1;
var HASH_URL_PATTERNS = [
    'https://www.marktplaats.nl/l/',
    'https://www.marktplaats.nl/q/',
    'https://www.2dehands.be/l/',
    'https://www.2dehands.be/q/',
    'https://www.2ememain.be/l/',
    'https://www.2ememain.be/q/'
];
var API_URL_FILTER = '/lrp/api/search';
var API_REQUEST_DOMAINS = ['marktplaats.nl', '2dehands.be', '2ememain.be'];

// Ad and tracking endpoints blocked before they load. Hiding these after render
// is what leaves empty banner slots behind (the white grid square the
// BrandTileBanner rule works around), so cancelling the request is both cheaper
// and free of layout shift.
//
// Deliberately NOT blocked: consent.marktplaats.nl (the CMP — blocking it can
// leave a permanent consent overlay), faas.marktplaats.nl (unidentified, may
// serve feature flags) and /v/api/feed-items (may back recommendation content
// the user actually wants).
//
// urlFilters stay locale-agnostic: the banner bundle is per-locale
// (index.mp.nlnl, index.mp.nlbe, index.mp.frbe), so matching on the path up to
// 'index.' covers 2dehands and 2ememain too. The ga-tracking bundle is
// content-hashed the same way, so that rule stops at the directory.
//
// Audience targeting is reachable on two paths: the /lrp/api/ one the search
// page calls, and a bare /audience-targeting/v1/ on the api host. Rule 11 only
// covers the first, so rule 15 catches the second.
//
// p.marktplaats.net serves one file, /identity/v2/mid.js. The response sets a
// SameSite=None cookie on that host and the script body writes the same fresh
// UUID back as a first-party __mpx cookie on .marktplaats.nl, both for 180
// days. It is an identifier and nothing else, so the whole host goes.
//
// The Datadog bundle is real user monitoring, not error logging: session id,
// views and interactions. It currently loads without ever initialising, so
// this mostly saves 180 kB and forecloses the tracking if that changes.
//
// Pubmatic is the header bidding side of the ad stack: ads.pubmatic.com serves
// the prebid wrapper, ut.pubmatic.com does a geo lookup carrying the publisher
// id. Nothing functional hangs off either, so the whole domain goes.
//
// analytics.js is pulled in by the page itself, not by the ecg-js-ga-tracking
// bundle, which is why rule 16 never caught it. Matching the domain covers the
// regional endpoints (region1.google-analytics.com and friends) too.
var AD_BLOCK_RULES = [
    { id: 10, urlFilter: '||tagmanager.marktplaats.nl^' },
    { id: 11, urlFilter: '/lrp/api/audience-targeting' },
    { id: 12, urlFilter: '/ecg-js-banners/ads/ads-adsscript' },
    { id: 13, urlFilter: '/ecg-js-banners/index.' },
    { id: 14, urlFilter: '/auroraAdobeDmpJs' },
    { id: 15, urlFilter: '/audience-targeting/v1/' },
    { id: 16, urlFilter: '/ecg-js-ga-tracking/' },
    { id: 17, urlFilter: '||securepubads.g.doubleclick.net^' },
    { id: 18, urlFilter: '||p.marktplaats.net^' },
    { id: 19, urlFilter: '||datadoghq-browser-agent.com^' },
    { id: 22, urlFilter: '||pubmatic.com^' },
    { id: 23, urlFilter: '||googlesyndication.com^' },
    { id: 24, urlFilter: '||google-analytics.com^' },
    { id: 25, urlFilter: '||adtrafficquality.google^' }
];

// Admarkt is the paid-placement platform, so these only make sense while the
// user is hiding promoted listings. Blocking them with the setting off would
// break images on listings they asked to keep seeing.
var PROMOTED_BLOCK_RULES = [
    { id: 20, urlFilter: '||admarkt-cdn.marktplaats.com^' },
    { id: 21, urlFilter: '/lrp/api/complementary-listings' }
];

var ALL_BLOCK_RULE_IDS = AD_BLOCK_RULES.concat(PROMOTED_BLOCK_RULES).map(function (rule) { return rule.id; });
var THEME_INIT_SCRIPT_ID = 'cleanplaats-theme-init';
var THEME_MATCH_PATTERNS = [
    '*://*.marktplaats.nl/*',
    '*://*.2dehands.be/*',
    '*://*.2ememain.be/*'
];
var WAKEUP_NAVIGATION_FILTERS = [
    { hostSuffix: 'marktplaats.nl' },
    { hostSuffix: '2dehands.be' },
    { hostSuffix: '2ememain.be' }
];

// Resolved once settings are loaded from storage. Handlers await this before
// using defaultSortMode/resultsPerPage so Firefox cold-starts get correct values.
var _resolveSettingsReady;
var settingsReadyPromise = new Promise(function (resolve) { _resolveSettingsReady = resolve; });
