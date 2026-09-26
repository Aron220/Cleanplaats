/**
 * Listings that already have a bid on them.
 *
 * Neither the search payload nor the listing card says whether anyone has bid.
 * The search API returns a price type (FIXED, SEE_DESCRIPTION, MIN_BID,
 * FAST_BID) and nothing about bids, and a card with two bids looks exactly like
 * one with none: a FAST_BID card prints "Bieden", a MIN_BID card prints its
 * asking price, and that is all either of them gives away. The ad's own page is
 * the only place the bids are published, in
 * window.__CONFIG__.listing.bidsInfo.bids.
 *
 * So this filter cannot be a pure DOM pass like the others. It asks the ad page
 * about a card, one request each, and remembers the answer. What keeps that
 * affordable is the price type:
 *
 * - A listing can only have bids if bidding is enabled at all, so FIXED and
 *   SEE_DESCRIPTION cards are never asked about. Checked against the live site,
 *   they never carry bids.
 * - Only MIN_BID and FAST_BID cards that are still visible are looked up, which
 *   after the other filters is a handful per page. The answer is kept in
 *   storage, so a second visit to the same search costs nothing until the
 *   answers expire.
 * - An ad the user opens tells us its bids for free, and that answer replaces
 *   whatever was cached for it.
 *
 * Each lookup is about 27 KB. Reading only the start of the page would not save
 * anything: __CONFIG__ sits near the end of it. The requests carry no
 * credentials, go to the same origin the user is already browsing, and at most
 * CLEANPLAATS_BID_CONCURRENCY are in flight.
 *
 * Checked and ruled out, so there is no need to look again: the search payload
 * has no bid field at all, and /v/api/bids/{itemId} requires the logged-in
 * user's bearer token.
 *
 * Every answer is either "has bids" or "does not have bids", and only the first
 * hides anything. Anything we cannot read leaves the listing where it is: an ad
 * hidden by mistake is worse than a bid that stays on screen, and a page layout
 * change should degrade into a filter that quietly does nothing, not into one
 * that hides the wrong listings.
 *
 * One consequence worth stating: the answer arrives a moment after the cards do,
 * so a listing with bids is visible for about a second before it goes. There is
 * no way around that, since the answer is not on the page, and it is why the
 * panel's tooltip says so.
 */

// The listing types bidding is possible on. The others are a price, a
// description, or nothing.
var CLEANPLAATS_BIDDABLE_PRICE_TYPES = ['MIN_BID', 'FAST_BID'];

// What the site prints in the price slot of a card that accepts bids, in the
// site's own words. A MIN_BID card shows its asking price instead, so this only
// ever adds cards the search payload has not told us about yet.
var CLEANPLAATS_BID_PRICE_WORDS = ['bieden', 'faire une offre'];
var CLEANPLAATS_BID_PRICE_SELECTOR = '.hz-Listing-price, [class*="ListingPrice_hz-Listing-price"], .hz-StructuredListing-price';

var CLEANPLAATS_BID_CONCURRENCY = 3;

// A search that hangs costs more than one that fails: it would hold a worker
// slot open while the filter could be falling back on what it already knows. A
// healthy ad page answers in about a fifth of a second.
var CLEANPLAATS_BID_TIMEOUT_MS = 8 * 1000;

// After the site refuses us, every lookup waits, and waits twice as long each
// time the refusal repeats. The sites sit behind bot protection, and knocking
// once a minute on a door that stays shut is how a warning becomes a block of
// the user's own browsing. One answered lookup resets it.
var CLEANPLAATS_BID_BACKOFF_MIN_MS = 60 * 1000;
var CLEANPLAATS_BID_BACKOFF_MAX_MS = 30 * 60 * 1000;

// How long each answer is believed. The two real answers fail in different
// directions, which is why they are not the same:
//
// - "Has none" going stale lets a listing that just got its first bid through.
//   The filter fails open, and re-asking costs one request, so an hour.
// - "Has bids" going stale hides a listing that should be back: a bidder can
//   withdraw a bid and a seller can remove one (bidsInfo.isRemovingBidEnabled).
//   A hidden card is never looked at again while it stays hidden, so this is
//   the only thing that brings it back. A day: bids are rarely withdrawn, and
//   the ads that have them are few.
// - An ad whose page could not be read is left alone for half an hour rather
//   than asked again on every pass.
var CLEANPLAATS_BID_HAS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var CLEANPLAATS_BID_NONE_MAX_AGE_MS = 60 * 60 * 1000;
var CLEANPLAATS_BID_FAIL_MAX_AGE_MS = 30 * 60 * 1000;

// Per bucket, oldest dropped first. Expired answers are dropped anyway, so this
// only bounds a day of very heavy browsing.
var CLEANPLAATS_BID_MAX_ENTRIES = 2000;

// What a lookup can conclude about one listing: it has bids, it has none, or its
// page could not be read. `blocked` and `cancelled` (see lookUpBidsOfAd) are
// outcomes of the request rather than facts about the ad, and are never stored.
var CLEANPLAATS_BID_VERDICTS = ['yes', 'no', 'fail'];

// Queued plus in flight. One result page of a hundred has about 45 candidates.
var CLEANPLAATS_BID_MAX_QUEUE = 60;

// Answers come in a few hundred milliseconds apart. They are written to storage
// once they stop coming, not once each.
var CLEANPLAATS_BID_PERSIST_DELAY_MS = 1500;

function getBidVerdictMaxAge(verdict) {
    if (verdict === 'yes') return CLEANPLAATS_BID_HAS_MAX_AGE_MS;
    if (verdict === 'no') return CLEANPLAATS_BID_NONE_MAX_AGE_MS;
    return CLEANPLAATS_BID_FAIL_MAX_AGE_MS;
}

// A stored copy, shape-guarded: a corrupt one costs the cached answers, not the
// filter.
function normalizeStoredListingBids(stored) {
    const checked = { yes: {}, no: {}, fail: {} };
    if (!stored || typeof stored !== 'object') return checked;

    CLEANPLAATS_BID_VERDICTS.forEach(verdict => {
        const source = stored[verdict];
        if (!source || typeof source !== 'object' || Array.isArray(source)) return;

        Object.entries(source).forEach(([itemId, at]) => {
            if (/^[am]\d+$/.test(itemId) && Number.isFinite(at)) {
                checked[verdict][itemId] = at;
            }
        });
    });

    return checked;
}

// Read by loadSettings(), which already reads the key next to it. The rest of
// runtime.listingBids is this page's work and is never stored.
function setListingBidsFromStorage(stored) {
    CLEANPLAATS.runtime.listingBids.checked = normalizeStoredListingBids(stored);
}

// One answer per listing, the newest across all copies. Every tab holds its own
// copy from when it loaded, so writing that back as it is would throw away what
// the other tabs learned in the meantime.
function mergeBidAnswers(...copies) {
    const latest = {};

    copies.forEach(copy => {
        CLEANPLAATS_BID_VERDICTS.forEach(verdict => {
            Object.entries(copy?.[verdict] || {}).forEach(([itemId, at]) => {
                if (!latest[itemId] || at > latest[itemId].at) latest[itemId] = { verdict, at };
            });
        });
    });

    const merged = { yes: {}, no: {}, fail: {} };
    Object.entries(latest).forEach(([itemId, { verdict, at }]) => {
        merged[verdict][itemId] = at;
    });

    return merged;
}

// Drops what no answer would be used from anyway, so the stored copy stays a
// window rather than a history.
function pruneBidEntries(now) {
    const { checked } = CLEANPLAATS.runtime.listingBids;

    CLEANPLAATS_BID_VERDICTS.forEach(verdict => {
        const entries = checked[verdict];
        const maxAge = getBidVerdictMaxAge(verdict);

        Object.entries(entries).forEach(([itemId, at]) => {
            if (!Number.isFinite(at) || now - at >= maxAge) delete entries[itemId];
        });

        const ids = Object.keys(entries);
        if (ids.length <= CLEANPLAATS_BID_MAX_ENTRIES) return;

        ids.sort((a, b) => entries[a] - entries[b])
            .slice(0, ids.length - CLEANPLAATS_BID_MAX_ENTRIES)
            .forEach(itemId => {
                delete entries[itemId];
            });
    });
}

function persistListingBids() {
    const warn = error => console.warn('Cleanplaats: Failed to save the bid lookups', error);

    try {
        browserAPI.storage.local.get(CLEANPLAATS_LISTING_BIDS_STORAGE_KEY, items => {
            if (browserAPI.runtime.lastError) {
                warn(browserAPI.runtime.lastError);
                return;
            }

            const bids = CLEANPLAATS.runtime.listingBids;
            const stored = normalizeStoredListingBids(items?.[CLEANPLAATS_LISTING_BIDS_STORAGE_KEY]);
            bids.checked = mergeBidAnswers(stored, bids.checked);
            pruneBidEntries(Date.now());

            const { yes, no, fail } = bids.checked;
            browserAPI.storage.local.set({ [CLEANPLAATS_LISTING_BIDS_STORAGE_KEY]: { yes, no, fail } }, () => {
                if (browserAPI.runtime.lastError) warn(browserAPI.runtime.lastError);
            });
        });
    } catch (error) {
        warn(error);
    }
}

function schedulePersistListingBids() {
    const bids = CLEANPLAATS.runtime.listingBids;
    clearTimeout(bids.persistTimer);
    bids.persistTimer = setTimeout(() => {
        bids.persistTimer = 0;
        persistListingBids();
    }, CLEANPLAATS_BID_PERSIST_DELAY_MS);
}

function isBiddablePriceType(priceType) {
    return CLEANPLAATS_BIDDABLE_PRICE_TYPES.includes(String(priceType || ''));
}

function isListingKnownToHaveBids(itemId) {
    const key = String(itemId || '').toLowerCase();
    const at = CLEANPLAATS.runtime.listingBids.checked.yes[key];
    return Boolean(key) && Number.isFinite(at) && Date.now() - at < CLEANPLAATS_BID_HAS_MAX_AGE_MS;
}

// Asked already, and recently enough that the answer is still worth having.
function isBidLookupFresh(itemId, now) {
    const { checked } = CLEANPLAATS.runtime.listingBids;
    const key = String(itemId || '').toLowerCase();

    return CLEANPLAATS_BID_VERDICTS.some(verdict => {
        const at = checked[verdict][key];
        return Number.isFinite(at) && now - at < getBidVerdictMaxAge(verdict);
    });
}

// The address to ask about a card: the path of its own link, so the request goes
// to the site the user is on. getListingBidFacts() only returns cards that have
// one; a link to another origin falls back on the bare item id, which the site
// redirects to the ad.
function getBidLookupPath({ href, itemId }) {
    try {
        const url = new URL(href, window.location.origin);
        if (url.origin === window.location.origin && url.pathname) return url.pathname;
    } catch (error) {
        // Falls through to the id.
    }

    return `/${itemId}`;
}

// One ad page. Never throws: every outcome is a verdict for the caller.
//
// `blocked` is the one that stops everything. A refusal, a challenge or a dead
// network says nothing about this particular ad, so nothing is recorded for it
// and the whole queue waits, instead of marking forty listings unreadable
// because the user's connection dropped.
async function lookUpBidsOfAd(path, signal) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), CLEANPLAATS_BID_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal.addEventListener('abort', onAbort);

    try {
        const response = await fetch(path, { credentials: 'omit', signal: timeout.signal });

        // The ad is gone. Not worth asking about again for a while, and the card
        // it belonged to is on its way out of the result set anyway.
        if (response.status === 404 || response.status === 410) return { verdict: 'fail' };

        // An ad page is a plain 200. Anything else is the site talking about us
        // rather than about the ad: a refusal (403, 429), or a bot-protection
        // challenge, which can come back as a 202.
        if (response.status !== 200) return { verdict: 'blocked' };

        const html = await response.text();
        let listing = null;
        try {
            listing = getConfigListingFromText(html);
        } catch (error) {
            return { verdict: 'fail' };
        }

        // No __CONFIG__ means this is not an ad page. After a redirect that is
        // where the site sends a visitor for an ad that is gone. Without one it is
        // a page served in the ad's place, most likely a challenge, which is the
        // site asking us to stop.
        if (!listing) return { verdict: response.redirected ? 'fail' : 'blocked' };

        const bids = listing.bidsInfo?.bids;
        // Every ad page carries bidsInfo, empty when bidding is off, so its
        // absence means this page rendered differently rather than that nobody
        // bid. Read as unreadable, not as "no bids".
        if (!Array.isArray(bids)) return { verdict: 'fail' };

        return { verdict: bids.length > 0 ? 'yes' : 'no' };
    } catch (error) {
        // An interrupted request is not a fact about the ad. When we cancelled
        // it, the page moved on; otherwise it timed out or the network failed,
        // which is a reason to wait like any other refusal.
        return { verdict: signal.aborted ? 'cancelled' : 'blocked' };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}

// A listing has one answer, so the previous one is dropped first: an ad can gain
// a bid, and after it does, an older "no" must not survive alongside it.
function recordBidAnswer(itemId, verdict, now) {
    const { checked } = CLEANPLAATS.runtime.listingBids;
    if (!CLEANPLAATS_BID_VERDICTS.includes(verdict)) return;

    CLEANPLAATS_BID_VERDICTS.forEach(bucket => {
        delete checked[bucket][itemId];
    });

    checked[verdict][itemId] = now;
}

// The filter itself, like removeReservedListings() in content/cleanup.js: it
// hides what the answered lookups say. Hiding never waits on a request.
function removeListingsWithBids() {
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const facts = getListingBidFacts(listing);
        if (!facts || !isListingKnownToHaveBids(facts.itemId)) return;

        if (hideElement(listing)) CLEANPLAATS.stats.bidListingsRemoved++;
    });
}

// The price slot of a card that accepts bids reads "Bieden", or its French
// counterpart, where a fixed price would be. Only ever a fallback: a MIN_BID
// card shows an amount here, so the search payload stays the better source.
function hasBiddablePriceText(listing) {
    const text = listing.querySelector(CLEANPLAATS_BID_PRICE_SELECTOR)?.textContent?.trim().toLowerCase() || '';
    if (!text) return false;

    return CLEANPLAATS_BID_PRICE_WORDS.some(word => text === word || text.startsWith(`${word} `));
}

function getBidLookupCandidates(now) {
    const { queue, inFlight } = CLEANPLAATS.runtime.listingBids;
    const seen = new Set();
    const candidates = [];

    document.querySelectorAll('.hz-Listing').forEach(listing => {
        // A hidden card is either answered already or hidden by another filter,
        // and asking about it would change nothing on screen.
        if (listing.hasAttribute('data-cleanplaats-hidden')) return;

        const facts = getListingBidFacts(listing);
        if (!facts || seen.has(facts.itemId)) return;
        if (queue.has(facts.itemId) || inFlight.has(facts.itemId)) return;
        if (isBidLookupFresh(facts.itemId, now)) return;
        if (!isBiddablePriceType(facts.priceType) && !hasBiddablePriceText(listing)) return;

        seen.add(facts.itemId);
        candidates.push({ itemId: facts.itemId, path: getBidLookupPath(facts) });
    });

    return candidates;
}

// Stops asking on behalf of a page the user has left, or a filter they switched
// off. What is already answered is kept, and a request that completes before the
// abort reaches it still counts: its answer is a fact about the ad, whichever
// page asked.
function abortBidLookups() {
    const bids = CLEANPLAATS.runtime.listingBids;
    bids.queue.clear();

    if (bids.controller) {
        bids.controller.abort();
        bids.controller = null;
    }
}

// One queue, drained by at most CLEANPLAATS_BID_CONCURRENCY requests, topped up
// by every cleanup pass. There is no "run" to start or finish: each request that
// settles starts the next one, and a request only listens to the controller it
// was started under, so an abort can never be undone by a request that was
// already on its way.
function pumpBidLookups() {
    const bids = CLEANPLAATS.runtime.listingBids;

    while (bids.inFlight.size < CLEANPLAATS_BID_CONCURRENCY && bids.queue.size > 0) {
        const [itemId, path] = bids.queue.entries().next().value;
        bids.queue.delete(itemId);
        bids.inFlight.add(itemId);

        if (!bids.controller) bids.controller = new AbortController();

        lookUpBidsOfAd(path, bids.controller.signal).then(({ verdict }) => {
            bids.inFlight.delete(itemId);

            if (verdict === 'cancelled') return;

            if (verdict === 'blocked') {
                bids.backoffMs = Math.min(CLEANPLAATS_BID_BACKOFF_MAX_MS,
                    bids.backoffMs ? bids.backoffMs * 2 : CLEANPLAATS_BID_BACKOFF_MIN_MS);
                bids.pausedUntil = Date.now() + bids.backoffMs;
                bids.queue.clear();
                return;
            }

            bids.backoffMs = 0;
            recordBidAnswer(itemId, verdict, Date.now());
            schedulePersistListingBids();

            // A "yes" has a card to hide. Once the queue is empty, one more pass
            // picks up cards that arrived while it was full.
            const drained = bids.queue.size === 0 && bids.inFlight.size === 0;
            if ((verdict === 'yes' || drained) && typeof scheduleCleanup === 'function') scheduleCleanup();

            if (Date.now() >= bids.pausedUntil) pumpBidLookups();
        });
    }
}

// The ad the user opens says for itself whether it has bids, so reading it costs
// no request, and it is the freshest answer there is: it corrects a cached one
// (a bid withdrawn, or a first bid placed) before that one expires.
function recordBidsFromDetailPage() {
    const bids = CLEANPLAATS.runtime.listingBids;
    const path = window.location.pathname;
    if (bids.detailPagePath === path) return;

    const itemId = getListingIdFromUrl(path);
    if (!itemId) return;

    let listing = null;
    try {
        const script = [...document.querySelectorAll('script:not([src])')]
            .find(node => node.textContent.includes('__CONFIG__'));
        listing = script ? getConfigListingFromText(script.textContent) : null;
    } catch (error) {
        listing = null;
    }

    const list = listing?.bidsInfo?.bids;
    if (!Array.isArray(list)) return;

    bids.detailPagePath = path;
    recordBidAnswer(itemId, list.length > 0 ? 'yes' : 'no', Date.now());
    schedulePersistListingBids();
}

// The one entry point, from the cleanup pass. Idempotent on purpose: a pass runs
// on every mutation, and one that finds nothing new to ask, a page that is not a
// search, or a site that just refused us must start nothing.
function ensureBidLookups() {
    const bids = CLEANPLAATS.runtime.listingBids;

    if (!CLEANPLAATS.settings.removeListingsWithBids) {
        abortBidLookups();
        return;
    }

    if (isProductDetailPage()) {
        recordBidsFromDetailPage();
        return;
    }

    if (typeof isSearchResultsPage === 'function' && !isSearchResultsPage()) return;
    if (Date.now() < bids.pausedUntil) return;

    const room = CLEANPLAATS_BID_MAX_QUEUE - bids.queue.size - bids.inFlight.size;
    getBidLookupCandidates(Date.now()).slice(0, Math.max(0, room)).forEach(({ itemId, path }) => {
        bids.queue.set(itemId, path);
    });

    pumpBidLookups();
}
