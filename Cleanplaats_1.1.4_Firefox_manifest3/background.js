/**
 * Cleanplaats Background Script
 * Handles URL rewriting for results per page functionality and badge updates
 */

console.log('Cleanplaats background.js: Script execution started/restarted.', new Date().toISOString());

// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

let resultsPerPage = "30"; // Default value, will be overwritten by storage
let defaultSortMode = "standard"; // Default value, will be overwritten by storage

// Sort mode mapping
const SORT_MODES = {
    'standard': { sortBy: 'OPTIMIZED', sortOrder: 'DECREASING' },
    'date_new_old': { sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' },
    'date_old_new': { sortBy: 'SORT_INDEX', sortOrder: 'INCREASING' },
    'price_low_high': { sortBy: 'PRICE', sortOrder: 'INCREASING' },
    'price_high_low': { sortBy: 'PRICE', sortOrder: 'DECREASING' },
    'distance': { sortBy: 'LOCATION', sortOrder: 'INCREASING' }
};

const API_RULE_ID = 1;
const HASH_URL_PATTERNS = [
    "https://www.marktplaats.nl/l/",
    "https://www.marktplaats.nl/q/",
    "https://www.2dehands.be/l/",
    "https://www.2dehands.be/q/"
];
const API_URL_PATTERNS = [
    "https://www.marktplaats.nl/lrp/api/search*",
    "https://www.2dehands.be/lrp/api/search*"
];

// Use simpler filters for webNavigation listener registration to maximize wake-up chance.
// Precise filtering will happen inside the handlers.
const WAKEUP_NAVIGATION_FILTERS = [
    { hostSuffix: 'marktplaats.nl' }, 
    { hostSuffix: '2dehands.be' }
];

/**
 * Parse options from the hash part of a marktplaats url
 */
function parseHashOptions(hashStr) {
    const options = {};
    if (!hashStr || hashStr.length < 2) return options;
    const hashKeysValues = hashStr.substring(1).split("|");
    for (let i = 0; i < hashKeysValues.length; ++i) {
        const keyValue = hashKeysValues[i].split(":");
        if (keyValue.length !== 2) continue;
        options[keyValue[0]] = keyValue[1];
    }
    return options;
}

/**
 * Build url hash from options
 */
function buildHashOptions(options) {
    const entries = Object.entries(options).filter(([_, v]) => v && v !== '');
    if (entries.length === 0) return '';
    let hashStr = "#";
    for (let key in options) {
        if (options[key] && options[key] !== '') {
            hashStr += key + ":" + options[key] + "|";
        }
    }
    if (hashStr.endsWith('|')) {
        hashStr = hashStr.substring(0, hashStr.length - 1);
    }
    return hashStr;
}

/**
 * Given a URL string, checks if its hash needs modification based on current
 * resultsPerPage and defaultSortMode settings (passed as arguments).
 * Returns the modified URL string if changes are needed, otherwise null.
 */
function getModifiedUrlIfNeeded(urlString, currentResultsPerPage, currentDefaultSortMode) {
    const url = new URL(urlString);
    let options = parseHashOptions(url.hash);
    let needsRewrite = false;

    if (!options.hasOwnProperty("limit") || options["limit"] !== currentResultsPerPage) {
        options["limit"] = currentResultsPerPage;
        needsRewrite = true;
    }

    if (currentDefaultSortMode !== 'standard') {
        const sortConfig = SORT_MODES[currentDefaultSortMode];
        if (sortConfig && (!options.hasOwnProperty("sortBy") || options["sortBy"] !== sortConfig.sortBy || options["sortOrder"] !== sortConfig.sortOrder)) {
            options["sortBy"] = sortConfig.sortBy;
            options["sortOrder"] = sortConfig.sortOrder;
            needsRewrite = true;
        }
    } else {
        // If mode is standard, and sort params are present that look like ours, remove them.
        // This is a simplification; ideally, we'd only remove params we know we added.
        if (options.hasOwnProperty("sortBy") && Object.values(SORT_MODES).find(m => m.sortBy === options["sortBy"])) {
            delete options["sortBy"];
            delete options["sortOrder"];
            needsRewrite = true; // Needs rewrite to remove them
        }
    }
    // Rebuild options to ensure clean hash if sort was removed
    if(needsRewrite && currentDefaultSortMode === 'standard'){
         url.hash = buildHashOptions(options); // options will not have sortBy/Order here
         return url.href;
    } else if (needsRewrite) {
        url.hash = buildHashOptions(options);
        return url.href;
    }
    return null;
}

/**
 * Updates declarativeNetRequest rules for API requests.
 */
async function updateApiRequestRules(currentResultsPerPage, currentDefaultSortMode) {
    console.log(`Cleanplaats: updateApiRequestRules called with RPP: ${currentResultsPerPage}, Sort: ${currentDefaultSortMode}`);
    const rulesToRemove = [API_RULE_ID];
    const rulesToAdd = [];
    const shouldModifyApi = currentResultsPerPage !== "30" || currentDefaultSortMode !== "standard";

    if (shouldModifyApi) {
        const rule = {
            id: API_RULE_ID, priority: 1,
            action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: [], addOrReplaceParams: [] } } } },
            condition: { urlFilter: API_URL_PATTERNS.map(p => p.replace('*','')).join('|'), resourceTypes: ["xmlhttprequest"] }
        };
        if (currentResultsPerPage !== "30") {
            rule.action.redirect.transform.queryTransform.addOrReplaceParams.push({ key: "limit", value: currentResultsPerPage });
        }
        if (currentDefaultSortMode !== 'standard') {
            const sortConfig = SORT_MODES[currentDefaultSortMode];
            if (sortConfig) {
                rule.action.redirect.transform.queryTransform.addOrReplaceParams.push(
                    { key: "sortBy", value: sortConfig.sortBy }, { key: "sortOrder", value: sortConfig.sortOrder }
                );
            }
        }
        rulesToAdd.push(rule);
        console.log('Cleanplaats: Adding declarativeNetRequest rule:', JSON.parse(JSON.stringify(rule)));
    } else {
        console.log('Cleanplaats: Removing declarativeNetRequest rule as settings are default.');
    }
    try {
        await browserAPI.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rulesToRemove, addRules: rulesToAdd });
        console.log('Cleanplaats: declarativeNetRequest rules updated successfully.');
    } catch (error) {
        console.error('Cleanplaats: Error updating declarativeNetRequest rules:', error, JSON.stringify(rulesToAdd));
    }
}

/**
 * Handle hash-based navigation changes using webNavigation.onBeforeNavigate
 */
function handleHashNavigation(details) {
    if (details.frameId !== 0 || details.parentFrameId !== -1) return;

    console.log('Cleanplaats: handleHashNavigation triggered.', `URL: ${details.url}`, `Transition: ${details.transitionType}`);

    const urlMatches = HASH_URL_PATTERNS.some(pattern => details.url.startsWith(pattern)); // Simpler check for startsWith
    if (!urlMatches) {
        console.log('Cleanplaats: handleHashNavigation - URL does not match HASH_URL_PATTERNS, skipping.', details.url);
        return;
    }
    
    // Critical: resultsPerPage and defaultSortMode must be up-to-date here.
    // This handler runs after initialize() has repopulated them from storage (due to listener registration timing).
    const newUrl = getModifiedUrlIfNeeded(details.url, resultsPerPage, defaultSortMode);
    console.log(`Cleanplaats: handleHashNavigation - Original URL: ${details.url}, Processed newUrl: ${newUrl}`);

    if (newUrl && newUrl !== details.url) {
        console.log(`Cleanplaats: Rewriting URL via onBeforeNavigate from ${details.url} to ${newUrl}`);
        browserAPI.tabs.update(details.tabId, { url: newUrl });
        if (details.transitionType === undefined) { // Handle quirky reloads
            console.log(`Cleanplaats: TransitionType was undefined. Attempting follow-up reload for ${newUrl}`);
            setTimeout(() => {
                browserAPI.tabs.get(details.tabId, (tab) => {
                    if (browserAPI.runtime.lastError) {
                        console.warn(`Cleanplaats: Error getting tab ${details.tabId} for reload: ${browserAPI.runtime.lastError.message}`);
                        return;
                    }
                    if (tab && tab.url === newUrl) {
                        console.log(`Cleanplaats: Tab ${details.tabId} URL matches, proceeding with reload.`);
                        browserAPI.tabs.reload(details.tabId);
                    } else {
                        console.log(`Cleanplaats: Tab ${details.tabId} URL changed or tab closed (current: ${tab ? tab.url : 'N/A'}), skipping reload.`);
                    }
                });
            }, 150);
        }
    }
}

/**
 * Handle client-side hash changes or history.pushState updates (e.g., pagination)
 */
function handleHistoryStateUpdated(details) {
    if (details.frameId !== 0 || details.parentFrameId !== -1) return;

    console.log('Cleanplaats: handleHistoryStateUpdated triggered.', `URL: ${details.url}`, `Transition: ${details.transitionType}`);

    const urlMatches = HASH_URL_PATTERNS.some(pattern => details.url.startsWith(pattern)); // Simpler check for startsWith
    if (!urlMatches) {
        console.log('Cleanplaats: handleHistoryStateUpdated - URL does not match HASH_URL_PATTERNS, skipping.', details.url);
        return;
    }

    // Critical: resultsPerPage and defaultSortMode must be up-to-date here.
    const newUrl = getModifiedUrlIfNeeded(details.url, resultsPerPage, defaultSortMode);
    console.log(`Cleanplaats: handleHistoryStateUpdated - Original URL: ${details.url}, Processed newUrl: ${newUrl}`);

    if (newUrl && newUrl !== details.url) {
        console.log(`Cleanplaats: Correcting URL via onHistoryStateUpdated from ${details.url} to ${newUrl}`);
        browserAPI.tabs.update(details.tabId, { url: newUrl });
    }
}

/**
 * Handle storage changes
 */
async function handleStorageChanges(changes, areaName) {
    if (areaName !== 'local' || !changes.cleanplaatsSettings) return;

    console.log('Cleanplaats: handleStorageChanges triggered.', changes.cleanplaatsSettings);
    try {
        const newSettingsData = JSON.parse(changes.cleanplaatsSettings.newValue || '{}');
        const newResultsPerPage = newSettingsData.resultsPerPage?.toString() || "30";
        const newDefaultSortMode = newSettingsData.defaultSortMode || "standard";

        let settingsActuallyChanged = false;
        if (newResultsPerPage !== resultsPerPage) {
            console.log(`Cleanplaats: Results per page changed from ${resultsPerPage} to ${newResultsPerPage}`);
            resultsPerPage = newResultsPerPage;
            settingsActuallyChanged = true;
        }
        if (newDefaultSortMode !== defaultSortMode) {
            console.log(`Cleanplaats: Default sort mode changed from ${defaultSortMode} to ${newDefaultSortMode}`);
            defaultSortMode = newDefaultSortMode;
            settingsActuallyChanged = true;
        }

        if (settingsActuallyChanged) {
            // Pass the newly updated global variables directly
            await updateApiRequestRules(resultsPerPage, defaultSortMode);
        }
    } catch (error) {
        console.error('Cleanplaats: Error parsing settings in handleStorageChanges:', error);
    }
}

/**
 * Initialize the background script
 */
async function initialize() {
    console.log('Cleanplaats background.js: initialize() called.', new Date().toISOString());
    
    browserAPI.storage.local.get(['cleanplaatsSettings'], async (result) => {
        if (browserAPI.runtime.lastError) {
            console.error('Cleanplaats: Error loading settings during initialize:', browserAPI.runtime.lastError);
            // Cannot proceed reliably without settings, but basic listeners might still be useful for debugging.
            // Or, decide if you want to register listeners even if settings load fails, using defaults.
        } else {
            console.log('Cleanplaats: Settings loaded from storage:', result.cleanplaatsSettings);
            try {
                if (result.cleanplaatsSettings) {
                    const settings = JSON.parse(result.cleanplaatsSettings);
                    resultsPerPage = settings.resultsPerPage?.toString() || "30";
                    defaultSortMode = settings.defaultSortMode || "standard";
                }
                // If settings are undefined/corrupt, resultsPerPage & defaultSortMode retain their script-defined defaults.
            } catch (error) {
                console.error('Cleanplaats: Error parsing stored settings:', error, '. Using default settings.');
                // Globals resultsPerPage & defaultSortMode already have defaults.
            }
        }

        console.log(`Cleanplaats: Initialized with settings - RPP: ${resultsPerPage}, Sort: ${defaultSortMode}`);

        // Update declarativeNetRequest rules with the now loaded (or default) settings.
        // Pass the current values of globals to ensure it uses the settings loaded in *this* init cycle.
        await updateApiRequestRules(resultsPerPage, defaultSortMode);

        // --- Register event listeners AFTER settings are loaded and DNR rules are updated --- 

        // WebRequest cleanup (mostly for safety during dev/migration, less critical for MV3 operation)
        if (browserAPI.webRequest) {
            try {
                if (typeof browserAPI.webRequest.onBeforeRequest.hasListener === 'function') {
                    if (browserAPI.webRequest.onBeforeRequest.hasListener(rewriteHashRequests_MV2_compat)) {
                        browserAPI.webRequest.onBeforeRequest.removeListener(rewriteHashRequests_MV2_compat);
                    }
                    if (browserAPI.webRequest.onBeforeRequest.hasListener(rewriteApiRequests_MV2_compat)) {
                        browserAPI.webRequest.onBeforeRequest.removeListener(rewriteApiRequests_MV2_compat);
                    }
                }
            } catch (e) {
                console.warn("Cleanplaats: Could not remove old webRequest listeners.", e);
            }
        }

        // Storage listener
        try {
            if (browserAPI.storage.onChanged.hasListener(handleStorageChanges)) {
                browserAPI.storage.onChanged.removeListener(handleStorageChanges); // Remove first to be safe
            }
            browserAPI.storage.onChanged.addListener(handleStorageChanges);
            console.log('Cleanplaats: Added storage.onChanged listener.');
        } catch (error) {
            console.error('Cleanplaats: Error setting up storage listener:', error);
        }

        // WebNavigation listeners - using simpler filters for wake-up reliability
        // Remove potentially existing listeners before adding, to handle script re-initialization cleanly.
        try {
            if (browserAPI.webNavigation.onBeforeNavigate.hasListener(handleHashNavigation)) {
                browserAPI.webNavigation.onBeforeNavigate.removeListener(handleHashNavigation);
            }
            browserAPI.webNavigation.onBeforeNavigate.addListener(handleHashNavigation, {
                url: WAKEUP_NAVIGATION_FILTERS 
            });
            console.log('Cleanplaats: Added webNavigation.onBeforeNavigate listener with wakeup filters.');
        } catch (error) {
            console.error('Cleanplaats: Error setting up onBeforeNavigate listener:', error);
        }

        try {
            if (browserAPI.webNavigation.onHistoryStateUpdated.hasListener(handleHistoryStateUpdated)) {
                browserAPI.webNavigation.onHistoryStateUpdated.removeListener(handleHistoryStateUpdated);
            }
            browserAPI.webNavigation.onHistoryStateUpdated.addListener(handleHistoryStateUpdated, {
                url: WAKEUP_NAVIGATION_FILTERS 
            });
            console.log('Cleanplaats: Added webNavigation.onHistoryStateUpdated listener with wakeup filters.');
        } catch (error) {
            console.error('Cleanplaats: Error setting up onHistoryStateUpdated listener:', error);
        }
        
        console.log(`Cleanplaats: All listeners registered. Ready.`);
    });
}

// --- Runtime event listeners --- //

// Listener for extension installation or update.
browserAPI.runtime.onInstalled.addListener(async (details) => {
    console.log("Cleanplaats: runtime.onInstalled event triggered, reason: ", details.reason);
    if (details.reason === "install" || details.reason === "update") {
        console.log("Cleanplaats: Extension installed or updated. Clearing old declarativeNetRequest rules.");
        try {
            const existingRules = await browserAPI.declarativeNetRequest.getDynamicRules();
            const ruleIdsToRemove = existingRules.map(rule => rule.id);
            if (ruleIdsToRemove.length > 0) {
                await browserAPI.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIdsToRemove });
                console.log("Cleanplaats: Successfully cleared old dynamic rules.");
            }
            // initialize() will be called by the top-level script execution anyway when the script starts/restarts.
            // If we call it here again, ensure it's truly needed for specific onInstalled tasks not covered by normal init.
            // For now, relying on the main initialize() call.
        } catch (error) {
            console.error("Cleanplaats: Error clearing dynamic rules on install/update:", error);
        }
    }
});

// Enhanced message listener for wake-up and keep-alive
if (browserAPI.runtime.onMessage) {
    if (!browserAPI.runtime.onMessage.hasListener(messageListener)){
        browserAPI.runtime.onMessage.addListener(messageListener);
    }
}

function messageListener(message, sender, sendResponse) {
    console.log("Cleanplaats: messageListener received message: ", message);
    
    if (message.action === "keepAlive") {
        console.log("Cleanplaats: Background script woken up by content script");
        
        // Reset keep-alive to active mode since user is on Marktplaats
        resetKeepAliveToActiveMode();
        
        sendResponse({ status: "acknowledged", timestamp: Date.now() });
        
        // Refresh settings and rules when woken up
        refreshSettingsAndRules();
        return true;
    }
    
    if (message.action === "forceRefresh") {
        console.log("Cleanplaats: Force refresh requested");
        
        // Reset keep-alive to active mode since user is on Marktplaats
        resetKeepAliveToActiveMode();
        
        refreshSettingsAndRules();
        sendResponse({ status: "refreshed" });
        return true;
    }
    
    return true; // Keep channel open for async response
}

/**
 * Refresh settings and update rules - useful when background script wakes up
 */
async function refreshSettingsAndRules() {
    try {
        const result = await new Promise((resolve) => {
            browserAPI.storage.local.get(['cleanplaatsSettings'], resolve);
        });
        
        if (result.cleanplaatsSettings) {
            const settings = JSON.parse(result.cleanplaatsSettings);
            const newResultsPerPage = settings.resultsPerPage?.toString() || "30";
            const newDefaultSortMode = settings.defaultSortMode || "standard";
            
            let settingsChanged = false;
            if (newResultsPerPage !== resultsPerPage) {
                console.log(`Cleanplaats: Refreshing RPP from ${resultsPerPage} to ${newResultsPerPage}`);
                resultsPerPage = newResultsPerPage;
                settingsChanged = true;
            }
            if (newDefaultSortMode !== defaultSortMode) {
                console.log(`Cleanplaats: Refreshing sort mode from ${defaultSortMode} to ${newDefaultSortMode}`);
                defaultSortMode = newDefaultSortMode;
                settingsChanged = true;
            }
            
            if (settingsChanged) {
                await updateApiRequestRules(resultsPerPage, defaultSortMode);
                console.log("Cleanplaats: Settings and rules refreshed after wake-up");
            }
        }
    } catch (error) {
        console.error("Cleanplaats: Error refreshing settings:", error);
    }
}


// Helper/compatibility names for any old functions if they were referenced in the try-catch for removal.
function rewriteHashRequests_MV2_compat() {}
function rewriteApiRequests_MV2_compat() {}

/**
 * Set up smart keep-alive mechanism for Firefox
 */
let lastMarktplaatsActivity = Date.now();
let keepAliveInterval = null;

function setupKeepAlive() {
    // Firefox-specific keep-alive mechanism
    if (typeof browser !== 'undefined') {
        console.log('Cleanplaats: Setting up smart Firefox keep-alive mechanism');
        
        // Start with a shorter interval alarm
        browserAPI.alarms.create('cleanplaats-keepalive', { 
            delayInMinutes: 2, 
            periodInMinutes: 2 
        });
        
        // Listen for the alarm
        if (!browserAPI.alarms.onAlarm.hasListener(handleKeepAliveAlarm)) {
            browserAPI.alarms.onAlarm.addListener(handleKeepAliveAlarm);
        }
        
        // Track Marktplaats activity through webNavigation
        if (browserAPI.webNavigation && browserAPI.webNavigation.onBeforeNavigate) {
            browserAPI.webNavigation.onBeforeNavigate.addListener((details) => {
                if (details.frameId === 0 && 
                    (details.url.includes('marktplaats.nl') || details.url.includes('2dehands.be'))) {
                    lastMarktplaatsActivity = Date.now();
                    console.log('Cleanplaats: Marktplaats activity detected, updating timestamp');
                }
            });
        }
    }
}

function handleKeepAliveAlarm(alarm) {
    if (alarm.name === 'cleanplaats-keepalive') {
        const timeSinceActivity = Date.now() - lastMarktplaatsActivity;
        const minutesSinceActivity = timeSinceActivity / (1000 * 60);
        
        console.log(`Cleanplaats: Keep-alive check - ${minutesSinceActivity.toFixed(1)} minutes since last Marktplaats activity`);
        
        // If user hasn't been on Marktplaats for more than 30 minutes, reduce frequency
        if (minutesSinceActivity > 30) {
            console.log('Cleanplaats: User inactive for 30+ minutes, switching to low-frequency mode');
            
            // Clear current alarm and create a less frequent one
            browserAPI.alarms.clear('cleanplaats-keepalive');
            browserAPI.alarms.create('cleanplaats-keepalive', { 
                delayInMinutes: 10, 
                periodInMinutes: 10 
            });
        } else if (minutesSinceActivity > 10) {
            console.log('Cleanplaats: User inactive for 10+ minutes, switching to medium-frequency mode');
            
            // Clear current alarm and create a medium frequency one
            browserAPI.alarms.clear('cleanplaats-keepalive');
            browserAPI.alarms.create('cleanplaats-keepalive', { 
                delayInMinutes: 5, 
                periodInMinutes: 5 
            });
        } else {
            // User is active, keep normal frequency
            console.log('Cleanplaats: User recently active, maintaining normal frequency');
        }
    }
}

/**
 * Reset keep-alive to active mode when user returns
 */
function resetKeepAliveToActiveMode() {
    if (typeof browser !== 'undefined') {
        lastMarktplaatsActivity = Date.now();
        
        // Reset to active frequency
        browserAPI.alarms.clear('cleanplaats-keepalive');
        browserAPI.alarms.create('cleanplaats-keepalive', { 
            delayInMinutes: 2, 
            periodInMinutes: 2 
        });
        
        console.log('Cleanplaats: Reset keep-alive to active mode');
    }
}

// Initialize the script when it starts/restarts.
initialize();

// Set up keep-alive mechanism
setupKeepAlive();

console.log('Cleanplaats background.js: Script execution finished initial top-level setup.', new Date().toISOString()); 