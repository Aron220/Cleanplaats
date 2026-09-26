/**
 * Blocked sellers in the homepage feed ("Voor jou" / "In je buurt").
 *
 * A feed card does not say who placed it. There is no seller in its markup,
 * none in the /hp/api/feed-items payload it is built from, and part of the
 * cards do not even link to their ad (thinContent). Asking the site "whose ad
 * is this?" would take a request per card, hundreds on one visit.
 *
 * So the question is asked the other way round. /lrp/api/search lists the ads
 * of the sellers named in sellerIds[], twenty sellers per request, and every ad
 * comes back with its item id and its photo. A feed card is recognised among
 * them by its link, or by its photo when it has no link: the photo id is the
 * same in the feed and in the search results.
 *
 * Admarkt ads (a-ids) are the exception. A request for several sellers only
 * includes the Admarkt ads of the first seller in it, and getting them for
 * everyone would take a request per seller. They are left to the
 * Bedrijfsadvertenties filter, which is on by default and hides every Admarkt
 * ad in the feed. With that filter off, a blocked seller's Admarkt ads can
 * still show on the homepage.
 *
 * The feed only shows fresh ads, so the hundred newest per request are enough.
 * Measured on both tabs of the live feed: 80 cards from 56 sellers, and every
 * one of them was among the hundred newest ads of its request, including a
 * request whose twenty sellers had 10,519 ads between them.
 */

// The search endpoint answers a 500 for more sellers than this in one request,
// and a 400 for more results than this on one page.
var CLEANPLAATS_SELLER_ADS_BATCH_SIZE = 20;
var CLEANPLAATS_SELLER_ADS_PAGE_SIZE = 100;

// New ads keep entering the feed while it is open. Ads fetched longer ago than
// this are fetched again the next time the feed changes.
var CLEANPLAATS_SELLER_ADS_MAX_AGE_MS = 5 * 60 * 1000;

// A failed request is not retried on every mutation of the feed.
var CLEANPLAATS_SELLER_ADS_RETRY_MS = 60 * 1000;

// How long the sellers found under a blocked name stay looked up. A name that
// turned up nobody is tried again sooner: that seller may simply have had no
// ads online that day.
var CLEANPLAATS_SELLER_NAME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
var CLEANPLAATS_SELLER_NAME_UNFOUND_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// A block on a common first name stands for thousands of sellers. Only the
// ones with the most ads are looked up, since those are the ones filling a feed.
var CLEANPLAATS_SELLER_NAME_MAX_IDS = 10;

// Photo ids are UUIDs, sometimes behind a shard directory (/images/bc/<id>).
var CLEANPLAATS_PHOTO_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Read at startup together with the settings, so the first cleanup pass on the
// homepage already knows what the previous visit found, instead of showing
// those ads until a request comes back.
//
// ads maps an item id or photo id to [seller id, seller name]. The name is kept
// per ad, not per seller, because one seller can go by two: an Admarkt
// campaign carries a name of its own ("Fatbike Direct" on the ad, "Fresh Bikes
// Amsterdam" on that seller's other ads), and a block by name matches on the
// name the ad shows.
//
// resolved (blocked name -> the sellers found under it) is a Map because seller
// names are free text, and a seller called "__proto__" would do odd things to a
// plain object. It is stored as a list of pairs for the same reason.
function setSellerAdsFromStorage(stored) {
    const sellerAds = { ads: {}, fetchedAt: {}, resolved: new Map() };

    if (stored && typeof stored === 'object') {
        ['ads', 'fetchedAt'].forEach(key => {
            if (stored[key] && typeof stored[key] === 'object' && !Array.isArray(stored[key])) {
                sellerAds[key] = stored[key];
            }
        });

        (Array.isArray(stored.resolved) ? stored.resolved : []).forEach(pair => {
            const [name, found] = Array.isArray(pair) ? pair : [];
            if (typeof name === 'string' && Array.isArray(found?.ids) && Number.isFinite(found?.at)) {
                sellerAds.resolved.set(name, { ids: found.ids.map(String), at: found.at });
            }
        });
    }

    CLEANPLAATS.runtime.sellerAds = sellerAds;
}

function persistSellerAds() {
    const { ads, fetchedAt, resolved } = CLEANPLAATS.runtime.sellerAds;

    try {
        browserAPI.storage.local.set({
            [CLEANPLAATS_SELLER_ADS_STORAGE_KEY]: { ads, fetchedAt, resolved: [...resolved] }
        }, () => {
            if (browserAPI.runtime.lastError) {
                console.warn('Cleanplaats: Failed to save the ads of blocked sellers', browserAPI.runtime.lastError);
            }
        });
    } catch (error) {
        console.warn('Cleanplaats: Failed to save the ads of blocked sellers', error);
    }
}

function getPhotoIdFromUrl(url) {
    const match = String(url || '').match(CLEANPLAATS_PHOTO_ID_PATTERN);
    return match ? match[0].toLowerCase() : '';
}

// What a feed card can be recognised by: its item id, and its photo.
function getAdKeys(listing) {
    const keys = [];

    const itemId = String(listing?.itemId || '').toLowerCase();
    if (/^[am]\d+$/.test(itemId)) keys.push(itemId);

    (listing?.pictures || []).forEach(picture => {
        const photoId = getPhotoIdFromUrl(picture?.url);
        if (photoId) keys.push(photoId);
    });

    return keys;
}

function getAdSellerId(key) {
    const ad = CLEANPLAATS.runtime.sellerAds.ads[key];
    return Array.isArray(ad) ? ad[0] : '';
}

// Only ever known for the ads of blocked sellers: those are the only ones asked
// about.
function getFeedCardSeller(card) {
    const { ads } = CLEANPLAATS.runtime.sellerAds;
    const itemId = getListingIdFromUrl(card.querySelector('a[href*="/v/"]')?.href);
    const photoId = getPhotoIdFromUrl(card.querySelector('img')?.getAttribute('src'));
    const ad = (itemId && ads[itemId]) || (photoId && ads[photoId]);

    return Array.isArray(ad) ? { id: ad[0], name: ad[1] || '' } : null;
}

// The feed half of the seller blacklist, run from performCleanup(). Returns how
// many cards it hid, for the "Door jou verborgen" count.
function hideBlockedSellersInFeed() {
    const cards = document.querySelectorAll('.hz-StructuredListing');
    if (!cards.length || !getBlacklistedSellerEntries().length) return 0;

    let hidden = 0;
    cards.forEach(card => {
        if (card.hasAttribute('data-cleanplaats-hidden')) return;

        const seller = getFeedCardSeller(card);
        if (seller && isSellerBlacklisted(seller.id, seller.name) && hideElement(card)) {
            hidden++;
        }
    });

    refreshSellerAdsIfNeeded();
    return hidden;
}

// Lifting a block has to bring the cards back straight away: a cleanup pass
// only ever hides.
function showFeedCardsOfSeller(entry) {
    document.querySelectorAll('.hz-StructuredListing[data-cleanplaats-hidden]').forEach(card => {
        const seller = getFeedCardSeller(card);
        if (!seller) return;

        const matches = entry.id ? seller.id === entry.id : seller.name === entry.name;
        if (matches) {
            card.removeAttribute('data-cleanplaats-hidden');
            card.style.display = '';
        }
    });
}

// A block by id names its seller outright. A block by name stands for every
// seller found under that name.
function getBlockedSellerIds() {
    const { resolved } = CLEANPLAATS.runtime.sellerAds;
    const ids = new Set();

    getBlacklistedSellerEntries().forEach(entry => {
        if (entry.id) {
            ids.add(entry.id);
            return;
        }
        (resolved.get(entry.name)?.ids || []).forEach(id => ids.add(id));
    });

    // One id the endpoint cannot parse fails the whole request with a 400.
    return [...ids].filter(id => /^\d+$/.test(id));
}

function getStaleSellerNames(now) {
    const { resolved } = CLEANPLAATS.runtime.sellerAds;

    return getBlacklistedSellerEntries()
        .filter(entry => {
            if (entry.id) return false;
            const found = resolved.get(entry.name);
            if (!found) return true;
            const maxAge = found.ids.length ? CLEANPLAATS_SELLER_NAME_MAX_AGE_MS : CLEANPLAATS_SELLER_NAME_UNFOUND_MAX_AGE_MS;
            return now - found.at > maxAge;
        })
        .map(entry => entry.name);
}

// Never fetched first, then the longest ago.
function getStaleSellerIds(now) {
    const { fetchedAt } = CLEANPLAATS.runtime.sellerAds;

    return getBlockedSellerIds()
        .filter(id => !fetchedAt[id] || now - fetchedAt[id] > CLEANPLAATS_SELLER_ADS_MAX_AGE_MS)
        .sort((a, b) => (fetchedAt[a] || 0) - (fetchedAt[b] || 0));
}

function refreshSellerAdsIfNeeded() {
    const runtime = CLEANPLAATS.runtime;
    if (runtime.sellerAdsRefreshing) return;

    const now = Date.now();
    if (now - runtime.sellerAdsFailedAt < CLEANPLAATS_SELLER_ADS_RETRY_MS) return;
    if (!getStaleSellerIds(now).length && !getStaleSellerNames(now).length) return;

    runtime.sellerAdsRefreshing = true;
    refreshSellerAds()
        .catch(error => {
            runtime.sellerAdsFailedAt = Date.now();
            console.warn('Cleanplaats: Failed to look up the ads of blocked sellers', error);
        })
        .finally(() => {
            runtime.sellerAdsRefreshing = false;
        });
}

async function refreshSellerAds() {
    try {
        // Blocks by id first: they need no lookup, and most blocks are by id.
        await fetchStaleSellerAds();

        const names = getStaleSellerNames(Date.now());
        for (const name of names) {
            const ids = await findSellerIdsByName(name);
            CLEANPLAATS.runtime.sellerAds.resolved.set(name, { ids, at: Date.now() });
        }

        if (names.length) await fetchStaleSellerAds();
    } finally {
        // Whatever did arrive is kept, also when a later request failed.
        forgetUnblockedSellers();
        persistSellerAds();
    }
}

// One request at a time, and the feed is cleaned after each, so the cards go
// as soon as their seller's ads are in.
async function fetchStaleSellerAds() {
    const ids = getStaleSellerIds(Date.now());

    for (let i = 0; i < ids.length; i += CLEANPLAATS_SELLER_ADS_BATCH_SIZE) {
        await fetchSellerAds(ids.slice(i, i + CLEANPLAATS_SELLER_ADS_BATCH_SIZE));
        scheduleCleanup();
    }
}

async function fetchSellerAds(sellerIds) {
    const params = new URLSearchParams({
        limit: String(CLEANPLAATS_SELLER_ADS_PAGE_SIZE),
        offset: '0',
        // Newest first, because that is what the feed shows.
        sortBy: 'SORT_INDEX',
        sortOrder: 'DECREASING',
        viewOptions: 'list-view'
    });
    sellerIds.forEach(id => params.append('sellerIds[]', id));

    const listings = await searchForSellerAds(params);
    const { ads, fetchedAt } = CLEANPLAATS.runtime.sellerAds;
    const batch = new Set(sellerIds);

    // Replaced rather than added to, so the stored copy stays at a hundred ads
    // per request instead of growing with everything these sellers ever placed.
    Object.keys(ads).forEach(key => {
        if (batch.has(getAdSellerId(key))) delete ads[key];
    });

    listings.forEach(listing => {
        const sellerId = String(listing?.sellerInformation?.sellerId ?? '');
        if (!batch.has(sellerId)) return;

        const sellerName = String(listing.sellerInformation.sellerName || '').trim();
        getAdKeys(listing).forEach(key => {
            ads[key] = [sellerId, sellerName];
        });
    });

    const now = Date.now();
    sellerIds.forEach(id => {
        fetchedAt[id] = now;
    });
}

// A block by name has no id to ask for. The search matches seller names as well
// as titles, though, so searching for the name brings up that seller's ads,
// mixed with ads that merely mention it. Only an exact name counts, compared the
// way isSellerBlacklisted() compares.
async function findSellerIdsByName(name) {
    const params = new URLSearchParams({
        // Enough to find a seller under their own name, and light enough that
        // the first lookup of a long list of names stays cheap.
        limit: '30',
        offset: '0',
        query: name,
        sortBy: 'SORT_INDEX',
        sortOrder: 'DECREASING',
        viewOptions: 'list-view'
    });

    const adsPerSeller = new Map();
    (await searchForSellerAds(params)).forEach(listing => {
        const sellerId = String(listing?.sellerInformation?.sellerId ?? '');
        const sellerName = String(listing?.sellerInformation?.sellerName || '').trim();
        if (sellerName !== name || !/^\d+$/.test(sellerId)) return;

        adsPerSeller.set(sellerId, (adsPerSeller.get(sellerId) || 0) + 1);
    });

    return [...adsPerSeller]
        .sort((a, b) => b[1] - a[1])
        .slice(0, CLEANPLAATS_SELLER_NAME_MAX_IDS)
        .map(([sellerId]) => sellerId);
}

// Without cookies, like the seller-profile request: the user did not make this
// search, and the feed is personalised on what a visitor looks at. Searching
// for a blocked seller's ads with the user's cookies attached could teach the
// site to show more of exactly those.
async function searchForSellerAds(params) {
    const response = await fetch(`/lrp/api/search?${params.toString()}`, {
        credentials: 'omit',
        headers: { Accept: 'application/json' }
    });

    // 204 is how the endpoint says it found nothing.
    if (response.status === 204) return [];
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    return [...(data?.topBlock || []), ...(data?.listings || [])];
}

// Sellers that are no longer blocked drop out, so the stored copy does not grow
// with every seller the user ever blocked.
function forgetUnblockedSellers() {
    const { ads, fetchedAt, resolved } = CLEANPLAATS.runtime.sellerAds;
    const blockedNames = new Set(getBlacklistedSellerEntries().filter(entry => !entry.id).map(entry => entry.name));

    [...resolved.keys()].forEach(name => {
        if (!blockedNames.has(name)) resolved.delete(name);
    });

    const blockedIds = new Set(getBlockedSellerIds());

    Object.keys(ads).forEach(key => {
        if (!blockedIds.has(getAdSellerId(key))) delete ads[key];
    });

    Object.keys(fetchedAt).forEach(sellerId => {
        if (!blockedIds.has(sellerId)) delete fetchedAt[sellerId];
    });
}
