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
// Deliberately NOT blocked: consent.marktplaats.nl, faas.marktplaats.nl,
// *.sdk.awswaf.com and /v/api/feed-items. The feed items may back
// recommendation content the user actually wants.
//
// consent.marktplaats.nl is the CMP. Blocking it does not strand anyone under
// an overlay: the CMP injects its own UI, so with the script gone there is
// nothing to be stuck under, and a cold first visit still renders the full
// results page. It stays unblocked because suppressing it means no consent
// choice is ever recorded for the user, which is not ours to decide for them.
//
// faas.marktplaats.nl is not feature flags. It is a first-party alias for a
// third-party fraud-scoring service and it fingerprints the device: a 100 kB
// tag script, a handful of beacons and iframes, and calls back out to the
// vendor's own hosts. It loads with the login form, never on search or
// listing pages. The homepage does embed that form in a frame for visitors
// who are not signed in, so it runs there too, but blocking it would still
// risk every sign-in being scored as suspicious. Same trade as the
// bot-protection challenge.
//
// The awswaf challenge is that bot protection, not an analytics tag: it loads
// a challenge script, collects browser inputs and posts them back for a token.
// It does profile the browser, but the signals go to the site's own bot
// scoring rather than to an ad or analytics vendor. Browsing works with it
// blocked right up until the origin decides to enforce the challenge, and
// then the check can never complete, so the failure mode is a hard stop
// rather than a slightly worse page. Not worth it.
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
//
// The tag manager is a first-party Google Tag Manager, one per site:
// (load.)tagmanager.marktplaats.nl, tagmanager.2dehands.be and
// tagmanager.2ememain.be. Anchoring on the subdomain covers all three. Naming
// only the Marktplaats host left the Belgian sites loading everything it
// injects: Meta's pixel, Criteo, Brandmetrics, Gemius, UserZoom, Qualaroo and
// Google's Floodlight and Ads conversion tags. Those vendors get rules of
// their own as well (17 and 28 to 39), so a tag that moves out of the tag
// manager, or a tag manager on a new host, does not bring them back. Meta is
// matched on the pixel alone: the rest of connect.facebook.net is the Facebook
// SDK, which a Facebook login would need. Likewise only the conversion paths
// on www.google.com (ccm, gmp, rmkt) go, not the host.
//
// doubleclick.net is Google's ad server and nothing else. securepubads serves
// the ad library; fls, ad and googleads are the conversion and remarketing
// pings the Belgian tag managers fired.
//
// demdex.net is Adobe Audience Manager, a data management platform that hands
// out a visitor id and syncs it with ad partners. Rule 14 blocks its loader
// script, but the search page carries the same code in its own chunks and
// calls demdex.net directly, on all three sites.
//
// google.com/adsense/ is AdSense for Search, the sponsored links under the
// results. removeAllAds() hides their containers anyway, so the loader only
// fed the ad auction. Matched on the path, because www.google.com serves more
// than ads.
var AD_BLOCK_RULES = [
    { id: 10, urlFilter: '||tagmanager.' },
    { id: 11, urlFilter: '/lrp/api/audience-targeting' },
    { id: 12, urlFilter: '/ecg-js-banners/ads/ads-adsscript' },
    { id: 13, urlFilter: '/ecg-js-banners/index.' },
    { id: 14, urlFilter: '/auroraAdobeDmpJs' },
    { id: 15, urlFilter: '/audience-targeting/v1/' },
    { id: 16, urlFilter: '/ecg-js-ga-tracking/' },
    { id: 17, urlFilter: '||doubleclick.net^' },
    { id: 18, urlFilter: '||p.marktplaats.net^' },
    { id: 19, urlFilter: '||datadoghq-browser-agent.com^' },
    { id: 22, urlFilter: '||pubmatic.com^' },
    { id: 23, urlFilter: '||googlesyndication.com^' },
    { id: 24, urlFilter: '||google-analytics.com^' },
    { id: 25, urlFilter: '||adtrafficquality.google^' },
    { id: 26, urlFilter: '||demdex.net^' },
    { id: 27, urlFilter: '||google.com/adsense/' },
    { id: 28, urlFilter: '||googletagmanager.com^' },
    { id: 29, urlFilter: '||analytics.google.com^' },
    { id: 30, urlFilter: '||connect.facebook.net/*/fbevents.js' },
    { id: 31, urlFilter: '||facebook.com/tr^' },
    { id: 32, urlFilter: '||criteo.net^' },
    { id: 33, urlFilter: '||brandmetrics.com^' },
    { id: 34, urlFilter: '||gemius.pl^' },
    { id: 35, urlFilter: '||userzoom.com^' },
    { id: 36, urlFilter: '||s3.amazonaws.com/ki.js/' },
    { id: 37, urlFilter: '||google.com/ccm/' },
    { id: 38, urlFilter: '||google.com/gmp/' },
    { id: 39, urlFilter: '||google.com/rmkt/' }
];

// Admarkt is the paid-placement platform, so these only make sense while the
// user is hiding promoted listings. Blocking them with the setting off would
// break images on listings they asked to keep seeing.
//
// The Admarkt CDN is per country: Marktplaats loads from
// admarkt-cdn.marktplaats.com, 2dehands and 2ememain both from
// admarkt-cdn.2dehands.com. Anchoring on the subdomain alone covers all three.
var PROMOTED_BLOCK_RULES = [
    { id: 20, urlFilter: '||admarkt-cdn.' },
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
