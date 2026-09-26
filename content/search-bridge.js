/**
 * Runs in the page's own JavaScript world (manifest "world": "MAIN"), not in
 * the content script's isolated one. It has two jobs, one per block below.
 *
 * Seller blocks match on seller id, and a listing card does not carry that id
 * anywhere in its markup. __NEXT_DATA__ has it, but only for the result set the
 * server rendered: every client-side page, filter or sort change, and every
 * search with hash parameters (our own results-per-page and sort settings
 * included) is fetched from /lrp/api/search afterwards and never written back
 * into it. This reads those responses as the page receives them and hands the
 * item id -> seller id pairs to the content script, so the cards on screen can
 * always be matched without a request of our own.
 *
 * Only ids go across. Anything posting a fake pair can at most decide which
 * listing a block applies to on this page, which the page could do anyway.
 */
(() => {
    const SOURCE = 'cleanplaats-search-bridge';
    const SEARCH_PATH = '/lrp/api/search';
    // Enough to cover a 100-result page plus its top block several times over.
    const MAX_BUFFERED = 500;

    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') return;

    // The content script loads at document_end and the first search response
    // can arrive before that, so it asks for a replay of what it missed.
    let buffered = [];

    function post(sellers) {
        window.postMessage({ source: SOURCE, type: 'sellers', sellers }, window.location.origin);
    }

    function collectSellers(data) {
        const listings = [...(data?.listings || []), ...(data?.topBlock || [])];

        return listings
            .map(listing => ({
                itemId: listing?.itemId,
                sellerId: listing?.sellerInformation?.sellerId
            }))
            .filter(({ itemId, sellerId }) => itemId && sellerId !== null && sellerId !== undefined && sellerId !== '')
            .map(({ itemId, sellerId }) => ({ itemId: String(itemId), sellerId: String(sellerId) }));
    }

    function getRequestUrl(input) {
        try {
            if (typeof input === 'string') return input;
            if (input && typeof input.url === 'string') return input.url;
            return String(input || '');
        } catch (error) {
            return '';
        }
    }

    window.fetch = function (...args) {
        const responsePromise = originalFetch.apply(window, args);

        if (!getRequestUrl(args[0]).includes(SEARCH_PATH)) {
            return responsePromise;
        }

        // Read a clone so the page gets its response body untouched, and swallow
        // every failure here: the page handles its own errors on the original.
        responsePromise.then(response => {
            if (!response.ok) return;

            response.clone().json().then(data => {
                const sellers = collectSellers(data);
                if (!sellers.length) return;

                buffered = buffered.concat(sellers).slice(-MAX_BUFFERED);
                post(sellers);
            }).catch(() => {});
        }, () => {});

        return responsePromise;
    };

    window.addEventListener('message', event => {
        if (event.source !== window || event.data?.source !== SOURCE || event.data.type !== 'replay') return;
        if (buffered.length) post(buffered);
    });
})();

/**
 * Search and category pages are Next.js: the server sends the results as
 * finished HTML, and React takes that markup over afterwards (hydration). The
 * content script holds back everything it adds inside the page until then (see
 * isPageHydrated()). Next.js records this performance measure when it is done.
 */
(() => {
    const SOURCE = 'cleanplaats-search-bridge';
    const HYDRATION_MEASURE = 'Next.js-hydration';
    let hydrated = false;

    function post() {
        window.postMessage({ source: SOURCE, type: 'hydrated' }, window.location.origin);
    }

    try {
        const observer = new PerformanceObserver(list => {
            if (hydrated || !list.getEntriesByName(HYDRATION_MEASURE).length) return;
            hydrated = true;
            observer.disconnect();
            post();
        });
        observer.observe({ type: 'measure', buffered: true });
    } catch (error) {
        // The content script falls back on a timeout.
    }

    // Same replay as above: the content script can load after hydration.
    window.addEventListener('message', event => {
        if (event.source !== window || event.data?.source !== SOURCE || event.data.type !== 'replay') return;
        if (hydrated) post();
    });
})();
