/**
 * The stored copy of the ads of blocked sellers, which content/feed-sellers.js
 * recognises homepage feed cards by. Kept here, in IndexedDB, for every tab.
 *
 * It used to sit in storage.local. For someone who blocks a few common names
 * that copy runs to megabytes (40,000 ads of 1,700 sellers, 2.4 MB, in issue
 * #63), and storage.local hands every write, old value and new, to every
 * storage.onChanged listener there is: each Marktplaats tab, each frame in
 * those (theme-init.js runs in all of them) and this background. With a few
 * tabs open, each saving after every answer, the browser did little else.
 * IndexedDB has no such event, and only the tab that asks gets a copy.
 *
 * version goes up with every save, so a tab can ask whether anything changed
 * since the copy it has, and gets no copy back when nothing did.
 *
 * The lease is which tab is at work on the copy, see withSellerAdsLock() in
 * content/feed-sellers.js. It runs out unless the tab keeps saving, since a tab
 * can close halfway. It is only kept in memory: should the background stop in
 * between, two tabs at once is all that can come of it.
 */

var SELLER_ADS_DB_NAME = 'cleanplaats';
var SELLER_ADS_DB_STORE = 'sellerAds';
var SELLER_ADS_RECORD_KEY = 'current';
var SELLER_ADS_LEGACY_STORAGE_KEY = 'cleanplaatsBlockedSellerAds';

var sellerAdsDbPromise = null;
var sellerAdsRecordPromise = null;
var sellerAdsSaveChain = Promise.resolve();

var SELLER_ADS_LEASE_MS = 30 * 1000;
var sellerAdsLease = null;

function openSellerAdsDb() {
    if (!sellerAdsDbPromise) {
        sellerAdsDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(SELLER_ADS_DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(SELLER_ADS_DB_STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(error => {
            sellerAdsDbPromise = null;
            throw error;
        });
    }
    return sellerAdsDbPromise;
}

function runSellerAdsTransaction(mode, operate) {
    return openSellerAdsDb().then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction(SELLER_ADS_DB_STORE, mode);
        const request = operate(transaction.objectStore(SELLER_ADS_DB_STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    }));
}

// Read once per run of the background, and kept: every save replaces it.
function getSellerAdsRecord() {
    if (!sellerAdsRecordPromise) {
        sellerAdsRecordPromise = readSellerAdsRecord().catch(error => {
            sellerAdsRecordPromise = null;
            throw error;
        });
    }
    return sellerAdsRecordPromise;
}

// The first read after the update moves the copy out of storage.local. Removing
// it there still goes out to every listener once, and then never again.
async function readSellerAdsRecord() {
    const stored = await runSellerAdsTransaction('readonly', store => store.get(SELLER_ADS_RECORD_KEY));
    const legacy = (await browserAPI.storage.local.get(SELLER_ADS_LEGACY_STORAGE_KEY))[SELLER_ADS_LEGACY_STORAGE_KEY];

    let record = stored;
    if (!record) {
        record = { version: 1, data: legacy && typeof legacy === 'object' ? legacy : null };
        await runSellerAdsTransaction('readwrite', store => store.put(record, SELLER_ADS_RECORD_KEY));
    }

    if (legacy !== undefined) {
        await browserAPI.storage.local.remove(SELLER_ADS_LEGACY_STORAGE_KEY);
    }

    return record;
}

// One after the other, so that each save gets the next version.
function saveSellerAdsRecord(data) {
    const save = sellerAdsSaveChain.then(async () => {
        const current = await getSellerAdsRecord();
        const record = { version: current.version + 1, data };
        await runSellerAdsTransaction('readwrite', store => store.put(record, SELLER_ADS_RECORD_KEY));
        sellerAdsRecordPromise = Promise.resolve(record);
        return record.version;
    });
    sellerAdsSaveChain = save.catch(() => {});
    return save;
}

function claimSellerAdsLease(token) {
    const now = Date.now();
    if (sellerAdsLease && sellerAdsLease.token !== token && sellerAdsLease.until > now) return false;

    sellerAdsLease = { token, until: now + SELLER_ADS_LEASE_MS };
    return true;
}

function renewSellerAdsLease(token) {
    if (token && sellerAdsLease?.token === token) sellerAdsLease.until = Date.now() + SELLER_ADS_LEASE_MS;
}

function releaseSellerAdsLease(token) {
    if (sellerAdsLease?.token === token) sellerAdsLease = null;
}

function isSellerAdsMessage(message) {
    return typeof message?.action === 'string' && message.action.startsWith('sellerAds:');
}

function answerSellerAdsMessage(message) {
    switch (message.action) {
    case 'sellerAds:claim':
        return Promise.resolve({ granted: claimSellerAdsLease(message.token) });
    case 'sellerAds:release':
        releaseSellerAdsLease(message.token);
        return Promise.resolve({ released: true });
    case 'sellerAds:load':
        renewSellerAdsLease(message.token);
        return getSellerAdsRecord().then(record => (record.version === message.version ? { version: record.version } : record));
    case 'sellerAds:save':
        renewSellerAdsLease(message.token);
        return saveSellerAdsRecord(message.data).then(version => ({ version }));
    default:
        return Promise.reject(new Error(`Unknown action ${message.action}`));
    }
}

function sellerAdsMessageListener(message, sender, sendResponse) {
    if (!isSellerAdsMessage(message)) return false;

    const answer = answerSellerAdsMessage(message);

    answer
        .then(sendResponse)
        .catch(error => {
            console.error('Cleanplaats: Failed to read or save the ads of blocked sellers', error);
            sendResponse({ error: String(error?.message || error) });
        });
    return true;
}

if (browserAPI.runtime.onMessage && !browserAPI.runtime.onMessage.hasListener(sellerAdsMessageListener)) {
    browserAPI.runtime.onMessage.addListener(sellerAdsMessageListener);
}
