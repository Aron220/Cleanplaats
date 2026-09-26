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
// picked is the same for the ads the user hid a seller from, with the button on
// a feed card. Those were looked up one by one, so a full check that no longer
// lists one (it is older than the seller's hundred newest) does not drop it.
//
// quickAt and fullAt hold when each seller last had each kind of request, and
// sizes how many ads they had at the last complete answer, which is what the
// full checks are grouped by.
//
// resolved (blocked name -> the sellers found under it) is a Map because seller
// names are free text, and a seller called "__proto__" would do odd things to a
// plain object. It is stored as a list of pairs for the same reason.
function setSellerAdsFromStorage(stored) {
    const sellerAds = { ads: {}, picked: {}, quickAt: {}, fullAt: {}, sizes: {}, resolved: new Map() };

    if (stored && typeof stored === 'object') {
        ['ads', 'picked', 'quickAt', 'fullAt', 'sizes'].forEach(key => {
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
    const { ads, picked, quickAt, fullAt, sizes, resolved } = CLEANPLAATS.runtime.sellerAds;

    try {
        browserAPI.storage.local.set({
            [CLEANPLAATS_SELLER_ADS_STORAGE_KEY]: { ads, picked, quickAt, fullAt, sizes, resolved: [...resolved] }
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

function refreshSellerAdsIfNeeded() {
    const runtime = CLEANPLAATS.runtime;
    if (runtime.sellerAdsRefreshing) return;

    const now = Date.now();
    if (now - runtime.sellerAdsFailedAt < CLEANPLAATS_SELLER_ADS_RETRY_MS) return;
    if (!getSellersDueForQuickLook(now).length && !getSellersDueForFullCheck(now).length && !getStaleSellerNames(now).length) return;

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
    } finally {
        forgetUnblockedSellers();
        persistSellerAds();
    }
}

// Saved and applied after every answer, not once at the end: someone who opens
// an ad while a long first round is still running should not have to start it
// over on the next page, and the cards should go as soon as they can.
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
        const busy = await fetchSellerAds(ids);

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
        await fetchSellerAds(due.slice(i, i + CLEANPLAATS_SELLER_ADS_BATCH_SIZE));
        applySellerAdsAnswer();
    }
}

// Stores the ads of these sellers. Returns nothing when the answer held all of
// them, and otherwise the sellers who took up the page.
async function fetchSellerAds(sellerIds) {
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
    const adsPerSeller = new Map(sellerIds.map(id => [id, 0]));

    // A seller on their own gets their hundred newest, however many they have.
    const complete = sellerIds.length === 1 || total <= CLEANPLAATS_SELLER_ADS_PAGE_SIZE;

    // A complete answer replaces what was known, so ads that left the site drop
    // out and the stored copy stays at a hundred per seller. An incomplete one
    // only adds: it says nothing about the ads it had no room for.
    if (complete) {
        Object.keys(ads).forEach(key => {
            if (adsPerSeller.has(getAdSellerId(key))) delete ads[key];
        });
    }

    listings.forEach(listing => {
        const sellerId = String(listing?.sellerInformation?.sellerId ?? '');
        if (!adsPerSeller.has(sellerId)) return;

        adsPerSeller.set(sellerId, adsPerSeller.get(sellerId) + 1);
        const sellerName = String(listing.sellerInformation.sellerName || '').trim();
        getAdKeys(listing).forEach(key => {
            ads[key] = [sellerId, sellerName];
        });
    });

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
    const { ads, picked, quickAt, fullAt, sizes, resolved } = CLEANPLAATS.runtime.sellerAds;
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

    [quickAt, fullAt, sizes].forEach(bySeller => {
        Object.keys(bySeller).forEach(sellerId => {
            if (!blockedIds.has(sellerId)) delete bySeller[sellerId];
        });
    });
}

// The button under every feed card, see the top of this file. Only on the
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
        button.textContent = panelText.hideSellerButton;
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            hideSellerOfFeedCard(card, button);
        });

        // Next to the card's link, not inside it, so a click cannot open the ad.
        const row = document.createElement('div');
        row.className = 'cleanplaats-blacklist-btn-row cleanplaats-feed-seller-row';
        row.appendChild(button);
        card.appendChild(row);
    });
}

async function hideSellerOfFeedCard(card, button) {
    if (button.disabled) return;

    const panelText = getPanelLocaleText();
    const photoId = getFeedCardPhotoId(card);
    const ad = getFeedCardAd(card, photoId);

    button.disabled = true;
    button.textContent = panelText.feedSellerLookingUp;

    try {
        if (!ad) throw new Error('No ad found for this card');

        const seller = await lookUpSellerOfAd(ad);
        const { picked } = CLEANPLAATS.runtime.sellerAds;
        new Set([ad.itemId, photoId, ...seller.keys].filter(Boolean)).forEach(key => {
            picked[key] = [seller.id, seller.name];
        });

        if (isSellerBlacklisted(seller.id, seller.name)) {
            // Blocked already, this ad just slipped through: typically a block
            // by a common name, which the lookup by name did not get to. Now
            // this seller's id is known, and with it their other ads.
            persistSellerAds();
            performCleanup();
            showBlacklistToast(getBlacklistedSellerLabel(seller));
        } else {
            addSellerToBlacklist(seller.name, seller.id);
            persistSellerAds();
        }

        // Ready for when the seller is shown again.
        button.textContent = panelText.hideSellerButton;
    } catch (error) {
        console.warn('Cleanplaats: Failed to look up the seller of a feed card', error);
        button.textContent = panelText.feedSellerLookupFailed;
    } finally {
        button.disabled = false;
    }
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
