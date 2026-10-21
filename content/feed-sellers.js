/**
 * Blocked sellers in the homepage feed ("Voor jou" / "In je buurt").
 *
 * A feed card does not say who placed it. There is no seller in its markup,
 * none in the /hp/api/feed-items payload it is built from, and part of the
 * cards do not even link to their ad (thinContent). Asking the site "whose ad
 * is this?" would take a request per card, hundreds on one visit.
 *
 * So the question is asked the other way round. /lrp/api/search lists the ads
 * of the sellers named in sellerIds[], and every ad comes back with its item id
 * and its photo. A feed card is recognised among them by its link, or by its
 * photo when it has no link: the photo id is the same in the feed and in the
 * search results.
 *
 * The hundred newest ads of each seller are enough. Even the personalised "Voor
 * jou" of a logged-in account, which also picks older ads, had every one of 160
 * cards from 69 sellers among the hundred newest of its own seller. Getting
 * exactly that takes care, though: the endpoint returns one page of a hundred
 * for all the sellers in a request together, and one busy seller fills it on
 * their own. So there are two kinds of request:
 *
 * - A full check, every few hours: each seller's own hundred newest, with the
 *   sellers grouped so that every request comes back complete. A seller with
 *   more ads than fit on a page gets a request of their own.
 * - A quick look, every few minutes while the feed is in use: twenty sellers
 *   per request, for the hundred newest among them. That catches what they
 *   placed since the full check, and the busiest sellers, who place the most,
 *   are the ones it covers best.
 *
 * The hundred newest are not enough for a seller who uploads in bulk. One
 * seller of postcards had 57,851 ads and placed a thousand a day, and since
 * "In je buurt" is everything placed within about a kilometre, newest first,
 * the feed near them was that seller and little else, page after page, well
 * past the hundred newest. So a seller with more ads than fit on a page is
 * followed further back, see fetchDeeperSellerAds(), one page at a time and
 * only once the feed has got to the oldest of the ads known so far. That costs
 * a request per hundred or so of their cards the site itself loaded, however
 * many ads they have in all, and nothing for a seller who never fills a feed.
 *
 * Admarkt ads (a-ids) are the exception. A request for several sellers only
 * includes the Admarkt ads of the first seller in it, so they come back for a
 * seller with a request of their own and for the first one of a shared request,
 * but not for the rest. Those are left to the Bedrijfsadvertenties filter,
 * which is on by default and hides every Admarkt ad in the feed.
 *
 * Every card on the homepage also gets a "Verkoper verbergen" button. The card
 * still does not say whose ad it is, so that one ad is looked up when the
 * button is used: one request, and only then. The seller is blocked by id,
 * which is what the lookups above need.
 *
 * That button is the eye on the card's photo, next to the favourite heart. It
 * is one small icon rather than a labelled chip under every card, because one
 * visit shows hundreds of cards and the same label under each of them reads as
 * noise. The label unfolds while the pointer or the keyboard is on it, and a
 * note points at it once, see maybeShowFeedSellerHint().
 */

// The search endpoint answers a 500 for more sellers than this in one request,
// and a 400 for more results than this on one page.
var CLEANPLAATS_SELLER_ADS_BATCH_SIZE = 20;
var CLEANPLAATS_SELLER_ADS_PAGE_SIZE = 100;

// How often the two kinds of request above run. Both are only checked while
// the feed is on screen and changing, so a homepage left alone costs nothing.
var CLEANPLAATS_SELLER_ADS_QUICK_MAX_AGE_MS = 5 * 60 * 1000;
var CLEANPLAATS_SELLER_ADS_FULL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// A full check that did not fit on one page is split up, but only this many
// times over per group. What is still incomplete then waits for the next full
// check, grouped by what this one learned, and the quick looks cover it until
// then.
var CLEANPLAATS_SELLER_ADS_MAX_SPLIT_ROUNDS = 3;

// Following a seller further back, see fetchDeeperSellerAds(). The endpoint
// answers nothing past the 5000th result. EDGE is how many of the oldest known
// ads count as the end: the feed reaching one of those is what asks for the
// next page.
var CLEANPLAATS_SELLER_ADS_MAX_DEPTH = 5000;
var CLEANPLAATS_SELLER_ADS_EDGE = 50;
var CLEANPLAATS_SELLER_ADS_HEAD = 10;

// A failed request is not retried on every mutation of the feed.
var CLEANPLAATS_SELLER_ADS_RETRY_MS = 60 * 1000;

// The stored copy is kept by the background and shared by every tab, see
// withSellerAdsLock(). It is saved a few seconds after a change rather than
// after every answer, since it can run to megabytes. A tab that finds another
// one at work on it looks again this much later: BUSY for a lookup, which
// can wait, CLAIM_RETRY for the seller of a feed card, which is waiting to be
// saved.
var CLEANPLAATS_SELLER_ADS_SAVE_DELAY_MS = 5 * 1000;
var CLEANPLAATS_SELLER_ADS_BUSY_MS = 10 * 1000;
var CLEANPLAATS_SELLER_ADS_CLAIM_RETRY_MS = 2 * 1000;

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
// those ads until a request comes back. The copy comes from the background,
// see background/seller-ads.js.
//
// ads maps an item id or photo id to [seller id, seller name]. The name is kept
// per ad, not per seller, because one seller can go by two: an Admarkt
// campaign carries a name of its own ("Fatbike Direct" on the ad, "Fresh Bikes
// Amsterdam" on that seller's other ads), and a block by name matches on the
// name the ad shows.
//
// picked is the same for the ads the user hid a seller from, with the button on
// a feed card. Those were looked up one by one, so a full check that no longer
// lists one (it is older than the seller's hundred newest) does not drop it.
//
// quickAt and fullAt hold when each seller last had each kind of request, and
// sizes how many ads they had at the last complete answer, which is what the
// full checks are grouped by.
//
// chains holds, per seller followed further back than their hundred newest,
// how far back that goes: head is the item ids their newest ads had at the
// last look, next the offset the known ads reached at the last page, edge the
// keys of the oldest known ads, and done whether there is nothing further.
//
// resolved (blocked name -> the sellers found under it) is a Map because seller
// names are free text, and a seller called "__proto__" would do odd things to a
// plain object. It is stored as a list of pairs for the same reason.
function setSellerAdsFromStorage(stored) {
    const sellerAds = { ads: {}, picked: {}, quickAt: {}, fullAt: {}, sizes: {}, chains: {}, resolved: new Map() };

    if (stored && typeof stored === 'object') {
        ['ads', 'picked', 'quickAt', 'fullAt', 'sizes', 'chains'].forEach(key => {
            if (stored[key] && typeof stored[key] === 'object' && !Array.isArray(stored[key])) {
                sellerAds[key] = stored[key];
            }
        });

        // The deeper pages are asked for in a loop that counts on these.
        Object.entries(sellerAds.chains).forEach(([sellerId, chain]) => {
            if (!Array.isArray(chain?.head) || !Array.isArray(chain?.edge) || !Number.isFinite(chain?.next)) {
                delete sellerAds.chains[sellerId];
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

function sendSellerAdsMessage(message) {
    return Promise.resolve(browserAPI.runtime.sendMessage(message)).then(answer => {
        if (!answer || answer.error) throw new Error(answer?.error || 'No answer from the background');
        return answer;
    });
}

// Takes over whatever was saved since this tab's copy, by this tab or another.
// Says whether there was anything.
async function syncSellerAds() {
    const runtime = CLEANPLAATS.runtime;
    const answer = await sendSellerAdsMessage({
        action: 'sellerAds:load',
        version: runtime.sellerAdsVersion,
        token: runtime.sellerAdsLeaseToken
    });
    if (!('data' in answer)) return false;

    setSellerAdsFromStorage(answer.data);
    runtime.sellerAdsVersion = answer.version;
    return true;
}

// For the first cleanup pass, see loadSettings(). Without the background this
// tab starts empty, and the next lookup tries again.
function loadSellerAds() {
    return syncSellerAds().catch(error => {
        console.warn('Cleanplaats: Failed to load the ads of blocked sellers', error);
    });
}

function persistSellerAds() {
    const runtime = CLEANPLAATS.runtime;
    if (!runtime.sellerAdsSaveTimer) {
        runtime.sellerAdsSaveTimer = setTimeout(flushSellerAds, CLEANPLAATS_SELLER_ADS_SAVE_DELAY_MS);
    }
}

function flushSellerAds() {
    const runtime = CLEANPLAATS.runtime;
    clearTimeout(runtime.sellerAdsSaveTimer);
    runtime.sellerAdsSaveTimer = 0;

    const { ads, picked, quickAt, fullAt, sizes, chains, resolved } = runtime.sellerAds;
    const data = { ads, picked, quickAt, fullAt, sizes, chains, resolved: [...resolved] };

    return sendSellerAdsMessage({ action: 'sellerAds:save', data, token: runtime.sellerAdsLeaseToken })
        .then(({ version }) => {
            runtime.sellerAdsVersion = version;
        })
        .catch(error => {
            console.warn('Cleanplaats: Failed to save the ads of blocked sellers', error);
        });
}

function releaseSellerAdsLease(token) {
    sendSellerAdsMessage({ action: 'sellerAds:release', token }).catch(error => {
        console.warn('Cleanplaats: Failed to hand back the ads of blocked sellers', error);
    });
}

// A change still waiting to be saved goes out before the page does: someone who
// opens an ad while a long first round is still running should not have to
// start it over on the next page. The lease goes back after it, so the next
// tab does not wait for it to run out.
window.addEventListener('pagehide', () => {
    const runtime = CLEANPLAATS.runtime;
    if (runtime.sellerAdsSaveTimer) flushSellerAds();
    if (runtime.sellerAdsLeaseToken) releaseSellerAdsLease(runtime.sellerAdsLeaseToken);
});

// Every tab used to look up and save the same sellers on its own, and put its
// own copy back over what the others had found. So one tab at a time works on
// the stored copy: it holds the lease on it from the background, takes over
// what was saved before it started, and saves before it hands the lease back.
// The token is per call, so that two calls in one tab take turns as well. With
// ifAvailable, a call that finds the copy taken does nothing and says so;
// otherwise it waits its turn.
//
// Not navigator.locks: in Firefox the page's lock manager may not touch the
// promise a content script hands it, so the lock would never be held.
async function withSellerAdsLock(work, ifAvailable = false) {
    const runtime = CLEANPLAATS.runtime;
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const claim = () => sendSellerAdsMessage({ action: 'sellerAds:claim', token }).then(answer => answer.granted);

    while (!(await claim())) {
        if (ifAvailable) return false;
        await new Promise(resolve => setTimeout(resolve, CLEANPLAATS_SELLER_ADS_CLAIM_RETRY_MS));
    }

    runtime.sellerAdsLeaseToken = token;
    try {
        if (await syncSellerAds()) scheduleCleanup();
        await work();
    } finally {
        if (runtime.sellerAdsSaveTimer) await flushSellerAds();
        if (runtime.sellerAdsLeaseToken === token) runtime.sellerAdsLeaseToken = '';
        releaseSellerAdsLease(token);
    }
    return true;
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
    const { ads, picked } = CLEANPLAATS.runtime.sellerAds;
    const itemId = getListingIdFromUrl(card.querySelector('a[href*="/v/"]')?.href);
    const photoId = getFeedCardPhotoId(card);
    const ad = [itemId, photoId].filter(Boolean).map(key => picked[key] || ads[key]).find(Array.isArray);

    return ad ? { id: ad[0], name: ad[1] || '' } : null;
}

function getFeedCardPhotoId(card) {
    return getPhotoIdFromUrl(card.querySelector('img')?.getAttribute('src'));
}

// The feed half of the seller blacklist, run from performCleanup(). Returns how
// many cards it hid, for the "Door jou verborgen" count.
function hideBlockedSellersInFeed() {
    // The photo grid on the search pages uses the same cards, but its sellers
    // come with the page's own search response: see getListingSellerName().
    if (isSearchResultsPage()) return 0;

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
// seller found under that name, and for every seller the user picked out on a
// feed card while their name was blocked already.
function getBlockedSellerIds() {
    const { picked, resolved } = CLEANPLAATS.runtime.sellerAds;
    const ids = new Set();

    getBlacklistedSellerEntries().forEach(entry => {
        if (entry.id) {
            ids.add(entry.id);
            return;
        }
        (resolved.get(entry.name)?.ids || []).forEach(id => ids.add(id));
    });

    Object.values(picked).filter(Array.isArray).forEach(([sellerId, sellerName]) => {
        if (isSellerBlacklisted(sellerId, sellerName)) ids.add(sellerId);
    });

    // One id the endpoint cannot parse fails the whole request with a 400.
    return [...ids].filter(id => /^\d+$/.test(id));
}

// Never asked about first, then the longest ago.
function getSellersDueSince(timestamps, maxAge, now) {
    return getBlockedSellerIds()
        .filter(id => !timestamps[id] || now - timestamps[id] > maxAge)
        .sort((a, b) => (timestamps[a] || 0) - (timestamps[b] || 0));
}

function getSellersDueForFullCheck(now) {
    return getSellersDueSince(CLEANPLAATS.runtime.sellerAds.fullAt, CLEANPLAATS_SELLER_ADS_FULL_MAX_AGE_MS, now);
}

function getSellersDueForQuickLook(now) {
    return getSellersDueSince(CLEANPLAATS.runtime.sellerAds.quickAt, CLEANPLAATS_SELLER_ADS_QUICK_MAX_AGE_MS, now);
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

function isSellerAdsRefreshDue(now) {
    return getSellersDueForQuickLook(now).length > 0 || getSellersDueForFullCheck(now).length > 0
        || getStaleSellerNames(now).length > 0 || getSellersAtTheirEdge().length > 0;
}

function refreshSellerAdsIfNeeded() {
    const runtime = CLEANPLAATS.runtime;
    if (runtime.sellerAdsRefreshing) return;

    const now = Date.now();
    if (now - runtime.sellerAdsFailedAt < CLEANPLAATS_SELLER_ADS_RETRY_MS) return;
    if (now < runtime.sellerAdsBusyUntil) return;
    if (!isSellerAdsRefreshDue(now)) return;

    runtime.sellerAdsRefreshing = true;
    // What looked due here can have been done by another tab since this one
    // last took over the stored copy, so it is asked again with the lease held.
    withSellerAdsLock(async () => {
        if (isSellerAdsRefreshDue(Date.now())) await refreshSellerAds();
    }, true)
        .then(ran => {
            if (!ran) runtime.sellerAdsBusyUntil = Date.now() + CLEANPLAATS_SELLER_ADS_BUSY_MS;
        })
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
        await runFullChecks();
        await runQuickLooks();

        const names = getStaleSellerNames(Date.now());
        for (const name of names) {
            const ids = await findSellerIdsByName(name);
            CLEANPLAATS.runtime.sellerAds.resolved.set(name, { ids, at: Date.now() });
            persistSellerAds();
        }

        // The sellers found under those names are new here.
        if (names.length) await runFullChecks();

        // Last, since the checks above can move where a seller's known ads end.
        // Every round goes a page further back, up to MAX_DEPTH, and only as
        // far as the feed has loaded.
        for (let [sellerId] = getSellersAtTheirEdge(); sellerId; [sellerId] = getSellersAtTheirEdge()) {
            await fetchDeeperSellerAds(sellerId);
            applySellerAdsAnswer();
        }
    } finally {
        forgetUnblockedSellers();
        persistSellerAds();
    }
}

// Applied after every answer, not once at the end, so the cards go as soon as
// they can. Saved a few seconds later, see persistSellerAds().
function applySellerAdsAnswer() {
    persistSellerAds();
    scheduleCleanup();
}

// Groups sellers so that every request comes back complete: their ads together
// fit on one page, biggest sellers placed first. A seller with more ads than a
// page gets a request of their own. Sellers whose size is not known yet go in
// groups of twenty, and the first answer sorts them out.
function planFullChecks(sellerIds) {
    const { sizes } = CLEANPLAATS.runtime.sellerAds;
    const isKnown = id => Number.isFinite(sizes[id]);
    const groups = [];

    sellerIds.filter(isKnown).sort((a, b) => sizes[b] - sizes[a]).forEach(id => {
        const group = groups.find(g => g.ids.length < CLEANPLAATS_SELLER_ADS_BATCH_SIZE
            && g.size + sizes[id] <= CLEANPLAATS_SELLER_ADS_PAGE_SIZE);

        if (group) {
            group.ids.push(id);
            group.size += sizes[id];
        } else {
            groups.push({ ids: [id], size: sizes[id] });
        }
    });

    const unknown = sellerIds.filter(id => !isKnown(id));
    for (let i = 0; i < unknown.length; i += CLEANPLAATS_SELLER_ADS_BATCH_SIZE) {
        groups.push({ ids: unknown.slice(i, i + CLEANPLAATS_SELLER_ADS_BATCH_SIZE) });
    }

    return groups.map(group => ({ ids: group.ids, round: 0 }));
}

// One request at a time.
async function runFullChecks() {
    const { fullAt } = CLEANPLAATS.runtime.sellerAds;
    const queue = planFullChecks(getSellersDueForFullCheck(Date.now()));

    while (queue.length) {
        const { ids, round } = queue.shift();
        const busy = await fetchSellerAds(ids, true);

        // It did not fit on one page. The sellers who took up more than their
        // share of it are asked about on their own, and the others again.
        if (busy.length && round < CLEANPLAATS_SELLER_ADS_MAX_SPLIT_ROUNDS) {
            const rest = ids.filter(id => !busy.includes(id));
            queue.unshift(...busy.map(id => ({ ids: [id], round: round + 1 })));
            if (rest.length) queue.push({ ids: rest, round: round + 1 });
        } else {
            // Also when it stayed incomplete: it is not asked again before the
            // next full check, and the quick looks cover it until then.
            const now = Date.now();
            ids.forEach(id => {
                fullAt[id] = now;
            });
        }

        applySellerAdsAnswer();
    }
}

// Small sellers are grouped with small sellers, so that a busy one does not
// push their new ads off the page.
async function runQuickLooks() {
    const { sizes } = CLEANPLAATS.runtime.sellerAds;
    const due = getSellersDueForQuickLook(Date.now())
        .sort((a, b) => (sizes[a] ?? Infinity) - (sizes[b] ?? Infinity));

    for (let i = 0; i < due.length; i += CLEANPLAATS_SELLER_ADS_BATCH_SIZE) {
        await fetchSellerAds(due.slice(i, i + CLEANPLAATS_SELLER_ADS_BATCH_SIZE), false);
        applySellerAdsAnswer();
    }
}

// Stores the ads of these sellers. Returns nothing when the answer held all of
// them, and otherwise the sellers who took up the page. A full check starts
// over on the sellers it follows further back, see updateSellerChains().
async function fetchSellerAds(sellerIds, full) {
    const params = new URLSearchParams({
        limit: String(CLEANPLAATS_SELLER_ADS_PAGE_SIZE),
        offset: '0',
        // Newest first, because that is what the feed leans towards.
        sortBy: 'SORT_INDEX',
        sortOrder: 'DECREASING',
        viewOptions: 'list-view'
    });
    sellerIds.forEach(id => params.append('sellerIds[]', id));

    const { listings, total } = await searchForSellerAds(params);
    const { ads, quickAt, sizes } = CLEANPLAATS.runtime.sellerAds;
    const adsOfSeller = groupSellerAds(listings, sellerIds);

    // A seller on their own gets their hundred newest, however many they have.
    const complete = sellerIds.length === 1 || total <= CLEANPLAATS_SELLER_ADS_PAGE_SIZE;
    const followed = updateSellerChains(adsOfSeller, sellerIds.length === 1 ? total : 0, full);

    // A complete answer replaces what was known, so ads that left the site drop
    // out and the stored copy stays at a hundred per seller. An incomplete one
    // only adds: it says nothing about the ads it had no room for. Neither
    // touches the older ads of a seller followed further back, as long as this
    // answer still connects to them.
    if (complete) {
        Object.keys(ads).forEach(key => {
            const sellerId = getAdSellerId(key);
            if (adsOfSeller.has(sellerId) && !followed.has(sellerId)) delete ads[key];
        });
    }

    adsOfSeller.forEach((sellerListings, sellerId) => storeSellerAds(sellerId, sellerListings));
    const adsPerSeller = new Map([...adsOfSeller].map(([sellerId, sellerListings]) => [sellerId, sellerListings.length]));

    const now = Date.now();
    sellerIds.forEach(id => {
        quickAt[id] = now;
    });

    if (sellerIds.length === 1) {
        sizes[sellerIds[0]] = total;
        return [];
    }

    if (complete) {
        adsPerSeller.forEach((count, sellerId) => {
            sizes[sellerId] = count;
        });
        return [];
    }

    // More than their share of the page, or else whoever took the most of it.
    const fairShare = CLEANPLAATS_SELLER_ADS_PAGE_SIZE / sellerIds.length;
    const byCount = [...adsPerSeller].sort((a, b) => b[1] - a[1]);
    const busy = byCount.filter(([, count]) => count > fairShare).map(([sellerId]) => sellerId);
    return busy.length ? busy : [byCount[0][0]];
}

// The ads of each of these sellers in an answer, newest first as it gave them.
function groupSellerAds(listings, sellerIds) {
    const adsOfSeller = new Map(sellerIds.map(id => [id, []]));

    listings.forEach(listing => {
        const sellerId = String(listing?.sellerInformation?.sellerId ?? '');
        adsOfSeller.get(sellerId)?.push(listing);
    });

    return adsOfSeller;
}

function storeSellerAds(sellerId, listings) {
    const { ads } = CLEANPLAATS.runtime.sellerAds;

    listings.forEach(listing => {
        const sellerName = String(listing.sellerInformation.sellerName || '').trim();
        getAdKeys(listing).forEach(key => {
            ads[key] = [sellerId, sellerName];
        });
    });
}

function getAdItemIds(listings) {
    return listings.map(listing => String(listing?.itemId || '').toLowerCase()).filter(Boolean);
}

function getChainEdge(listings) {
    return listings.slice(-CLEANPLAATS_SELLER_ADS_EDGE).flatMap(getAdKeys);
}

// Which sellers are followed further back than this answer reaches, after it.
// A seller is, once a request of their own shows they have more ads than it
// held. They stay followed while the newest ads in each later answer still
// include one of the newest of the answer before: then nothing was placed in
// between that is not known. Otherwise, after more than a page of new ads, or
// at a full check, the chain starts over from this answer, and the older ads
// go. That is also what keeps ads that left the site from piling up.
function updateSellerChains(adsOfSeller, ownTotal, full) {
    const { chains } = CLEANPLAATS.runtime.sellerAds;
    const followed = new Set();

    adsOfSeller.forEach((listings, sellerId) => {
        const chain = chains[sellerId];
        const itemIds = getAdItemIds(listings);

        if (chain && !full) {
            // A shared request that had no room for this seller says nothing.
            if (!listings.length && !ownTotal) {
                followed.add(sellerId);
                return;
            }
            if (itemIds.some(id => chain.head.includes(id))) {
                chain.head = itemIds.slice(0, CLEANPLAATS_SELLER_ADS_HEAD);
                followed.add(sellerId);
                return;
            }
        }

        delete chains[sellerId];
        if (ownTotal > listings.length && listings.length) {
            chains[sellerId] = {
                head: itemIds.slice(0, CLEANPLAATS_SELLER_ADS_HEAD),
                next: listings.length,
                edge: getChainEdge(listings),
                done: false
            };
        }
    });

    return followed;
}

// The next page of a seller's ads, further back than the ones known.
//
// The endpoint pages: it rounds the offset down to a multiple of the limit, so
// a page cannot be made to start a little earlier to overlap the last one. It
// does not need to. Every ad the seller placed since the last page pushed the
// known ones a place down, so the next page starts among those, and nothing is
// skipped. Only ads that left the site in between could leave a gap, as many
// as left, which over the minutes between two pages is next to nothing.
async function fetchDeeperSellerAds(sellerId) {
    const chain = CLEANPLAATS.runtime.sellerAds.chains[sellerId];
    const pageSize = CLEANPLAATS_SELLER_ADS_PAGE_SIZE;
    const offset = Math.floor(chain.next / pageSize) * pageSize;

    if (offset + pageSize > CLEANPLAATS_SELLER_ADS_MAX_DEPTH) {
        chain.done = true;
        return;
    }

    const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
        sortBy: 'SORT_INDEX',
        sortOrder: 'DECREASING',
        viewOptions: 'list-view'
    });
    params.append('sellerIds[]', sellerId);

    const listings = groupSellerAds((await searchForSellerAds(params)).listings, [sellerId]).get(sellerId);
    storeSellerAds(sellerId, listings);
    chain.next = offset + listings.length;
    if (listings.length) chain.edge = getChainEdge(listings);
    chain.done = listings.length < pageSize || chain.next >= CLEANPLAATS_SELLER_ADS_MAX_DEPTH;
}

// The sellers whose oldest known ads the feed has loaded, so that the cards
// after those are likely theirs as well and not known yet. Whether the user
// has scrolled to them does not matter: the feed loads ahead, and a page that
// hides most of what it loads keeps loading.
function getSellersAtTheirEdge() {
    const open = Object.entries(CLEANPLAATS.runtime.sellerAds.chains).filter(([, chain]) => !chain.done);
    if (!open.length) return [];

    const inFeed = new Set();
    document.querySelectorAll('.hz-StructuredListing').forEach(card => {
        inFeed.add(getListingIdFromUrl(card.querySelector('a[href*="/v/"]')?.href));
        inFeed.add(getFeedCardPhotoId(card));
    });
    inFeed.delete('');

    const blockedIds = new Set(getBlockedSellerIds());
    return open
        .filter(([sellerId, chain]) => blockedIds.has(sellerId) && chain.edge.some(key => inFeed.has(key)))
        .map(([sellerId]) => sellerId);
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
    (await searchForSellerAds(params)).listings.forEach(listing => {
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
    if (response.status === 204) return { listings: [], total: 0 };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const listings = [...(data?.topBlock || []), ...(data?.listings || [])];
    const total = Number(data?.totalResultCount);
    return { listings, total: Number.isFinite(total) ? total : listings.length };
}

// Sellers that are no longer blocked drop out, so the stored copy does not grow
// with every seller the user ever blocked.
function forgetUnblockedSellers() {
    const { ads, picked, quickAt, fullAt, sizes, chains, resolved } = CLEANPLAATS.runtime.sellerAds;
    const blockedNames = new Set(getBlacklistedSellerEntries().filter(entry => !entry.id).map(entry => entry.name));

    [...resolved.keys()].forEach(name => {
        if (!blockedNames.has(name)) resolved.delete(name);
    });

    Object.keys(picked).forEach(key => {
        const ad = picked[key];
        if (!Array.isArray(ad) || !isSellerBlacklisted(ad[0], ad[1])) delete picked[key];
    });

    const blockedIds = new Set(getBlockedSellerIds());

    Object.keys(ads).forEach(key => {
        if (!blockedIds.has(getAdSellerId(key))) delete ads[key];
    });

    [quickAt, fullAt, sizes, chains].forEach(bySeller => {
        Object.keys(bySeller).forEach(sellerId => {
            if (!blockedIds.has(sellerId)) delete bySeller[sellerId];
        });
    });
}

// The button on every feed card, see the top of this file. Only on the
// homepage, which is where the feed is.
function injectFeedSellerButtons() {
    if (window.location.pathname !== '/') return;

    const panelText = getPanelLocaleText();
    document.querySelectorAll('.hz-StructuredListing').forEach(card => {
        if (card.hasAttribute('data-cleanplaats-hidden') || card.querySelector('.cleanplaats-feed-seller-row')) return;
        // Still a placeholder: the feed fills its cards in while scrolling.
        if (!card.querySelector('img')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cleanplaats-blacklist-btn cleanplaats-feed-seller-btn';
        // The label lives in its own element, see the stylesheet: the button
        // unfolding around a label it clips would show the middle of the words.
        const label = document.createElement('span');
        label.className = 'cleanplaats-feed-seller-label';
        button.appendChild(label);
        setFeedSellerButtonLabel(button, panelText.hideSellerButton);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            hideSellerOfFeedCard(card, button);
        });

        // On the photo, next to the card's link rather than inside it, so a
        // click cannot open the ad.
        const row = document.createElement('div');
        row.className = 'cleanplaats-blacklist-btn-row cleanplaats-feed-seller-row';
        row.appendChild(button);
        card.appendChild(row);
    });

    maybeShowFeedSellerHint();
}

// The label is what the button unfolds into, and the only thing it is called
// where the stylesheet has folded it shut. An aria-label would go stale as the
// text changes with the lookup, so the two are set together.
function setFeedSellerButtonLabel(button, text) {
    button.querySelector('.cleanplaats-feed-seller-label').textContent = text;
    button.setAttribute('aria-label', text);
}

// Whether the label can unfold under the pointer, which is what the two media
// queries on .cleanplaats-feed-seller-btn in content.css turn on. Where it
// cannot, the icon is all there is to go on, and a tap asks first. The two have
// to agree: hover: none does not always come with pointer: coarse, and a button
// that neither unfolds nor asks is a blind click on a card-sized target.
function canUnfoldFeedSellerLabel() {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

// The eye says little on its own, so the first feed card that carries one gets
// a short note pointing at it. Once ever, and only on the homepage: the button
// is the only way to hide a seller from the feed, since a feed card does not say
// whose ad it is.
var CLEANPLAATS_FEED_HINT_MAX_AGE_MS = 14 * 1000;

function maybeShowFeedSellerHint() {
    if (CLEANPLAATS.panelState.hasSeenFeedSellerHint) return;
    if (document.getElementById('cleanplaats-feed-hint')) return;
    // The welcome modal is the first thing a new visitor sees, and it points at
    // the panel. Two notes at once is one too many; the modal asks again for
    // this one when it closes.
    if (document.querySelector('.cleanplaats-onboarding')) return;

    // The first button the user can actually see, so that the note is never
    // anchored to a card that is above the fold and about to be scrolled away.
    const button = [...document.querySelectorAll('.cleanplaats-feed-seller-btn')].find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.top > 0 && rect.bottom < window.innerHeight;
    });
    if (!button) return;

    const panelText = getPanelLocaleText();
    const hint = document.createElement('div');
    hint.className = 'cleanplaats-feed-hint';
    hint.id = 'cleanplaats-feed-hint';
    hint.innerHTML = DOMPurify.sanitize(`
        <span class="cleanplaats-feed-hint-title">${panelText.feedSellerHintTitle}</span>
        <span class="cleanplaats-feed-hint-body">${panelText.feedSellerHintBody}</span>
    `);

    let timer = 0;

    // Fixed, and following the card it belongs to: the feed keeps mutating, and
    // a card can be replaced under it.
    const place = () => {
        if (!button.isConnected) {
            dismiss();
            return;
        }
        const rect = button.getBoundingClientRect();
        // The note hangs under its button, but never off the right edge: in a
        // narrow window the feed reaches the side of the screen.
        const width = hint.offsetWidth || 232;
        hint.style.left = `${Math.round(Math.min(rect.left - 3, window.innerWidth - width - 8))}px`;
        hint.style.top = `${Math.round(rect.bottom + 10)}px`;
    };

    const dismiss = () => {
        clearTimeout(timer);
        window.removeEventListener('scroll', place);
        document.removeEventListener('click', dismiss, true);
        document.removeEventListener('keydown', onKeydown, true);
        hint.remove();
    };

    const onKeydown = event => {
        if (event.key === 'Escape') dismiss();
    };

    place();
    document.body.appendChild(hint);
    // A frame between placing it and fading it in, or it animates in from
    // wherever the note was before it had a position.
    requestAnimationFrame(() => hint.classList.add('cleanplaats-feed-hint--visible'));

    timer = setTimeout(dismiss, CLEANPLAATS_FEED_HINT_MAX_AGE_MS);
    window.addEventListener('scroll', place, { passive: true });
    // Anything the user does means they are on their way elsewhere, and a click
    // on the button itself is the one thing that makes the note pointless.
    document.addEventListener('click', dismiss, true);
    document.addEventListener('keydown', onKeydown, true);

    CLEANPLAATS.panelState.hasSeenFeedSellerHint = true;
    saveSettings().catch(error => {
        console.warn('Cleanplaats: Failed to store that the feed hint was shown', error);
    });
}

async function hideSellerOfFeedCard(card, button) {
    if (button.disabled) return;

    const panelText = getPanelLocaleText();

    // Where the label does not unfold there is no hover to aim with either, and
    // a card is easy to hit while scrolling, so ask before a whole seller goes.
    if (!canUnfoldFeedSellerLabel() && !window.confirm(panelText.feedSellerConfirm)) return;

    const photoId = getFeedCardPhotoId(card);
    const ad = getFeedCardAd(card, photoId);

    button.disabled = true;
    setFeedSellerButtonLabel(button, panelText.feedSellerLookingUp);

    try {
        if (!ad) throw new Error('No ad found for this card');

        const seller = await lookUpSellerOfAd(ad);
        const entries = {};
        new Set([ad.itemId, photoId, ...seller.keys].filter(Boolean)).forEach(key => {
            entries[key] = [seller.id, seller.name];
        });
        Object.assign(CLEANPLAATS.runtime.sellerAds.picked, entries);
        // Before the cleanup below, so that the lookups it sets off wait for
        // these to be stored.
        storePickedSellerAds(entries);

        if (isSellerBlacklisted(seller.id, seller.name)) {
            // Blocked already, this ad just slipped through: typically a block
            // by a common name, which the lookup by name did not get to. Now
            // this seller's id is known, and with it their other ads.
            performCleanup();
            showBlacklistToast(getBlacklistedSellerLabel(seller));
        } else {
            addSellerToBlacklist(seller.name, seller.id);
        }

        // Ready for when the seller is shown again.
        setFeedSellerButtonLabel(button, panelText.hideSellerButton);
    } catch (error) {
        console.warn('Cleanplaats: Failed to look up the seller of a feed card', error);
        setFeedSellerButtonLabel(button, panelText.feedSellerLookupFailed);
    } finally {
        button.disabled = false;
    }
}

// Stored with the lease held, see withSellerAdsLock(), so that they go into the
// copy the other tabs saved, and are set again should that copy replace this
// tab's while it waits.
function storePickedSellerAds(entries) {
    withSellerAdsLock(async () => {
        Object.assign(CLEANPLAATS.runtime.sellerAds.picked, entries);
        persistSellerAds();
    }).catch(error => {
        console.warn('Cleanplaats: Failed to save the seller of a feed card', error);
    });
}

// The ad behind a feed card: its item id, and the address of its page. A card
// without a link is only tied to its ad by the copy of the feed the page keeps
// in sessionStorage, which lists every item with its photo.
function getFeedCardAd(card, photoId) {
    const href = card.querySelector('a[href*="/v/"]')?.getAttribute('href') || '';
    const itemId = getListingIdFromUrl(href);
    if (itemId) return { itemId, url: href };
    if (!photoId) return null;

    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (!/^HOMEPAGE_FEED_.*_VALUE$/.test(key)) continue;

            const item = Object.values(JSON.parse(sessionStorage.getItem(key))?.feedItems || {})
                .flat()
                .find(feedItem => getPhotoIdFromUrl(feedItem?.picture?.url) === photoId);
            const feedItemId = String(item?.itemId || '').toLowerCase();
            if (/^[am]\d+$/.test(feedItemId)) return { itemId: feedItemId, url: String(item.url || '') };
        }
    } catch (error) {
        // Storage that is off limits, or a format the site has since changed.
    }

    return null;
}

// Whose ad this is. The search finds an ad by its number, which is the light
// way to ask. It does not find Admarkt ads (a-ids), or an ad that went offline
// since the feed was loaded, so for those the ad's own page is read: it names
// its seller in window.__CONFIG__.
async function lookUpSellerOfAd({ itemId, url }) {
    if (itemId.startsWith('m')) {
        const params = new URLSearchParams({ limit: '1', offset: '0', query: itemId, viewOptions: 'list-view' });
        const listing = (await searchForSellerAds(params)).listings
            .find(found => String(found?.itemId || '').toLowerCase() === itemId);
        const sellerId = String(listing?.sellerInformation?.sellerId ?? '');

        if (/^\d+$/.test(sellerId)) {
            return { id: sellerId, name: String(listing.sellerInformation.sellerName || '').trim(), keys: getAdKeys(listing) };
        }
    }

    // The site redirects /m123 to the ad as well, for when the feed gave no
    // address. The slugs in a /v/ address have to be the real ones.
    const response = await fetch(/^\/v\//.test(url) ? url : `/${itemId}`, { credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const seller = getConfigListingFromText(await response.text())?.seller;
    const sellerId = String(seller?.id ?? '');
    if (!/^\d+$/.test(sellerId)) throw new Error('No seller on the ad page');

    return { id: sellerId, name: String(seller.name || '').trim(), keys: [itemId] };
}
