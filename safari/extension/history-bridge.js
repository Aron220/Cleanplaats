/**
 * Safari only. Runs in the page's own JavaScript world (manifest "world":
 * "MAIN"), like content/search-bridge.js.
 *
 * Safari has no webNavigation.onHistoryStateUpdated, the event the background
 * uses to put the results-per-page and default-sort settings back into the URL
 * after the site navigates without a page load (a new search from the results
 * page, the next page of results). history.pushState and replaceState are the
 * only things that fire that event in the other browsers, so wrapping those two
 * here gives the background the same signal. safari/history-relay.js passes it
 * on, safari/background.js answers it.
 *
 * Nothing but "the URL changed" is posted. The relay reads the URL from
 * location itself, so a page posting this message on its own gains nothing.
 */
(() => {
    if (window.top !== window) return;

    const SOURCE = 'cleanplaats-safari-history';

    function notify() {
        try {
            window.postMessage({ source: SOURCE, type: 'state-updated' }, window.location.origin);
        } catch (error) {
            // A page we cannot post to is a page without search results.
        }
    }

    ['pushState', 'replaceState'].forEach(method => {
        const original = history[method];
        if (typeof original !== 'function') return;

        history[method] = function (...args) {
            const before = window.location.href;
            const result = original.apply(this, args);
            // Next.js rewrites the current entry on every scroll and hydration
            // without changing the URL. Those are not navigations, and each
            // message would wake the background for nothing.
            if (window.location.href !== before) notify();
            return result;
        };
    });
})();
