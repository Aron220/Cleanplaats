/**
 * Safari only. The isolated-world half of safari/history-bridge.js: the page
 * world has no extension API, so the "URL changed" signal crosses here and
 * goes on to the background as a runtime message.
 */
(() => {
    if (window.top !== window) return;

    const api = typeof browser !== 'undefined' ? browser : chrome;
    const SOURCE = 'cleanplaats-safari-history';

    window.addEventListener('message', event => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        if (event.data?.source !== SOURCE || event.data.type !== 'state-updated') return;

        try {
            // The URL is read here rather than taken from the message, so the
            // page cannot name one of its own choosing.
            const sent = api.runtime.sendMessage({
                action: 'safari:historyStateUpdated',
                url: window.location.href
            });
            if (sent && typeof sent.catch === 'function') sent.catch(() => {});
        } catch (error) {
            // The extension was reloaded or switched off under this page.
        }
    });
})();
