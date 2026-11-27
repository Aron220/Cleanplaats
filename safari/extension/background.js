/**
 * Safari only. Loaded in the background right after the script that defines
 * browserAPI (background/shared.js) and before everything that uses it.
 *
 * The other background scripts reach every extension API through browserAPI.
 * This puts a thin layer in front of it that passes everything on to Safari
 * untouched, except for the two places where Safari behaves differently from
 * Chrome and Firefox:
 *
 * 1. declarativeNetRequest.updateDynamicRules
 *
 *    Safari keeps dynamic rules in a database, plus a list in memory of the
 *    ids it has. removeRuleIds is checked against that list, not against the
 *    database, and the list is only filled a moment after the extension
 *    starts. An update at startup that removes and re-adds the same ids, which
 *    is what updateAdBlockingRules() does, then removes nothing and fails on
 *    the add, because the rules of the previous run are still in the database:
 *    "Failed to add dynamic rules. Some rules do not have unique IDs". An
 *    update that only removes does nothing at all and reports success.
 *    Two updates running at once trip over each other in the same way, and
 *    initialize() and the onInstalled handler in background/lifecycle.js do
 *    overlap.
 *
 *    So here updates run one at a time, each one is checked afterwards against
 *    what getDynamicRules() says is really stored, and one that did not take
 *    is tried again shortly after. Only when that keeps failing does the
 *    caller get the error.
 *
 * 2. webNavigation.onHistoryStateUpdated
 *
 *    Safari does not have this event. The stand-in below takes listeners the
 *    way the real one does; safari/history-bridge.js and
 *    safari/history-relay.js report from the page when history.pushState or
 *    replaceState changed the URL, and that is passed to the listeners with
 *    the details the real event carries. A Safari that does ship the event
 *    keeps its own.
 */
(() => {
    if (typeof browserAPI === 'undefined' || !browserAPI) {
        console.error('Cleanplaats (Safari): browserAPI is not defined yet, safari/background.js has to load after the script that defines it.');
        return;
    }

    const api = browserAPI;

    /**
     * An object that answers for `target`, with `overrides` in front. Methods
     * are bound to the real object: Safari's API functions refuse to be called
     * on anything else.
     */
    function layerOver(target, overrides) {
        return new Proxy({}, {
            get(_, property) {
                if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            },
            has(_, property) {
                return Object.prototype.hasOwnProperty.call(overrides, property) || property in target;
            }
        });
    }

    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

    // --- 1. Rule updates, one at a time and checked ---------------------------

    const RULE_RETRY_DELAYS = [150, 300, 600, 1200, 2400];
    let ruleUpdates = Promise.resolve();

    async function ruleUpdateTook(declarativeNetRequest, options) {
        const added = (options.addRules || []).map(rule => rule.id);
        const removed = (options.removeRuleIds || []).filter(id => !added.includes(id));
        if (!added.length && !removed.length) return true;

        const stored = new Set((await declarativeNetRequest.getDynamicRules() || []).map(rule => rule.id));
        return added.every(id => stored.has(id)) && !removed.some(id => stored.has(id));
    }

    async function applyRuleUpdate(declarativeNetRequest, options) {
        for (let attempt = 0; ; attempt++) {
            let failure = null;
            try {
                await declarativeNetRequest.updateDynamicRules(options);
                if (await ruleUpdateTook(declarativeNetRequest, options)) {
                    if (attempt > 0) console.log(`Cleanplaats (Safari): Rule update stored after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}.`);
                    return;
                }
            } catch (error) {
                failure = error;
            }

            if (attempt >= RULE_RETRY_DELAYS.length) {
                throw failure || new Error('Safari reported the rule update as done, but the rules are not stored.');
            }
            await wait(RULE_RETRY_DELAYS[attempt]);
        }
    }

    function updateDynamicRules(options) {
        const declarativeNetRequest = api.declarativeNetRequest;
        const update = ruleUpdates.then(() => applyRuleUpdate(declarativeNetRequest, options || {}));
        // The next update waits for this one either way; its failure is the
        // caller's to handle, not the queue's.
        ruleUpdates = update.catch(() => {});
        return update;
    }

    // --- 2. webNavigation.onHistoryStateUpdated -------------------------------

    function matchesUrlFilter(filter, urlString) {
        const conditions = filter && Array.isArray(filter.url) ? filter.url : null;
        if (!conditions || !conditions.length) return true;

        let url;
        try {
            url = new URL(urlString);
        } catch (error) {
            return false;
        }

        return conditions.some(condition => {
            if (!condition || typeof condition !== 'object') return false;
            // The filters in use name a hostSuffix. Anything this does not
            // know lets the event through: the listener checks the URL itself.
            if (typeof condition.hostSuffix === 'string' && !url.hostname.endsWith(condition.hostSuffix)) return false;
            if (typeof condition.hostEquals === 'string' && url.hostname !== condition.hostEquals) return false;
            if (typeof condition.hostContains === 'string' && !url.hostname.includes(condition.hostContains)) return false;
            if (typeof condition.urlPrefix === 'string' && !urlString.startsWith(condition.urlPrefix)) return false;
            if (typeof condition.urlContains === 'string' && !urlString.includes(condition.urlContains)) return false;
            return true;
        });
    }

    function createHistoryStateEvent() {
        const listeners = [];
        const indexOf = callback => listeners.findIndex(entry => entry.callback === callback);

        return {
            addListener(callback, filter) {
                if (typeof callback === 'function' && indexOf(callback) === -1) listeners.push({ callback, filter });
            },
            removeListener(callback) {
                const index = indexOf(callback);
                if (index !== -1) listeners.splice(index, 1);
            },
            hasListener(callback) {
                return indexOf(callback) !== -1;
            },
            dispatch(details) {
                listeners.slice().forEach(({ callback, filter }) => {
                    if (!matchesUrlFilter(filter, details.url)) return;
                    try {
                        Promise.resolve(callback(details)).catch(error => {
                            console.error('Cleanplaats (Safari): onHistoryStateUpdated listener failed', error);
                        });
                    } catch (error) {
                        console.error('Cleanplaats (Safari): onHistoryStateUpdated listener failed', error);
                    }
                });
            }
        };
    }

    const overrides = {
        declarativeNetRequest: api.declarativeNetRequest
            ? layerOver(api.declarativeNetRequest, { updateDynamicRules })
            : api.declarativeNetRequest
    };

    if (api.webNavigation && !api.webNavigation.onHistoryStateUpdated) {
        const historyStateEvent = createHistoryStateEvent();
        overrides.webNavigation = layerOver(api.webNavigation, { onHistoryStateUpdated: historyStateEvent });

        api.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message || message.action !== 'safari:historyStateUpdated') return false;

            const tabId = sender && sender.tab ? sender.tab.id : undefined;
            const isTopFrame = !sender || sender.frameId === undefined || sender.frameId === 0;

            if (typeof tabId === 'number' && isTopFrame && typeof message.url === 'string' && message.url) {
                historyStateEvent.dispatch({
                    tabId,
                    url: message.url,
                    frameId: 0,
                    parentFrameId: -1,
                    timeStamp: Date.now(),
                    transitionType: 'link',
                    transitionQualifiers: []
                });
            }

            sendResponse({ status: 'ok' });
            return false;
        });
    }

    // A plain assignment on purpose: browserAPI is a global of the script
    // before this one, and every script after it reads that global.
    browserAPI = layerOver(api, overrides);
})();
