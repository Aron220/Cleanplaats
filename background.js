/**
 * Cleanplaats Background Script
 * Handles URL rewriting for results per page functionality and badge updates
 */

// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

let isIntercepting = false;
let resultsPerPage = "30"; // Default value
let defaultSortMode = "standard"; // Default sort mode

// Sort mode mapping
const SORT_MODES = {
    'standard': { sortBy: 'OPTIMIZED', sortOrder: 'DECREASING' },
    'date_new_old': { sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' },
    'date_old_new': { sortBy: 'SORT_INDEX', sortOrder: 'INCREASING' },
    'price_low_high': { sortBy: 'PRICE', sortOrder: 'INCREASING' },
    'price_high_low': { sortBy: 'PRICE', sortOrder: 'DECREASING' },
    'distance': { sortBy: 'LOCATION', sortOrder: 'INCREASING' }
};

/**
 * Parse options from the hash part of a marktplaats url
 * Example: #distanceMeters:75000|postcode:0000XX
 */
function parseHashOptions(hashStr) {
    const options = {};
    if (!hashStr || hashStr.length < 2) return options;
    
    const hashKeysValues = hashStr.substring(1).split("|");
    
    for (let i = 0; i < hashKeysValues.length; ++i) {
        const keyValue = hashKeysValues[i].split(":");
        
        if (keyValue.length !== 2) {
            continue;
        }
        
        options[keyValue[0]] = keyValue[1];
    }
    
    return options;
}

/**
 * Build url hash from options
 */
function buildHashOptions(options) {
    const entries = Object.entries(options).filter(([k, v]) => v && v !== '');
    if (entries.length === 0) return '';
    
    let hashStr = "#";
    for (let key in options) {
        if (options[key] && options[key] !== '') {
            hashStr += key + ":" + options[key] + "|";
        }
    }
    // Remove trailing `|`
    if (hashStr.endsWith('|')) {
        hashStr = hashStr.substring(0, hashStr.length - 1);
    }
    return hashStr;
}

/**
 * Rewrite hash-based requests (for page navigation)
 */
function rewriteHashRequests(requestDetails) {
    const url = new URL(requestDetails.url);
    let options = {};
    let needsRewrite = false;

    if (url.hash) {
        options = parseHashOptions(url.hash);
    }

    // Check if we need to update the limit
    if (!options.hasOwnProperty("limit") || options["limit"] !== resultsPerPage) {
        options["limit"] = resultsPerPage;
        needsRewrite = true;
    }

    // Check if we need to update the sort mode (only if not standard)
    if (defaultSortMode !== 'standard') {
        const sortConfig = SORT_MODES[defaultSortMode];
        if (sortConfig) {
            // Only apply sort if not already set or different from our target
            if (!options.hasOwnProperty("sortBy") || 
                options["sortBy"] !== sortConfig.sortBy || 
                options["sortOrder"] !== sortConfig.sortOrder) {
                
                options["sortBy"] = sortConfig.sortBy;
                options["sortOrder"] = sortConfig.sortOrder;
                needsRewrite = true;
            }
        }
    }

    // Only rewrite if something actually changed
    if (!needsRewrite) {
        return;
    }

    url.hash = buildHashOptions(options);
    
    console.log(`Cleanplaats: Rewriting hash URL from ${requestDetails.url} to ${url.href}`);
    
    return {
        redirectUrl: url.href
    };
}

/**
 * Rewrite API requests
 */
function rewriteApiRequests(requestDetails) {
    const url = new URL(requestDetails.url);
    const searchParams = url.searchParams;
    let needsRewrite = false;

    // Check if we need to update the limit
    const currentLimit = searchParams.get("limit");
    if (currentLimit !== resultsPerPage) {
        searchParams.set("limit", resultsPerPage);
        needsRewrite = true;
    }

    // Check if we need to update the sort mode (only if not standard)
    if (defaultSortMode !== 'standard') {
        const sortConfig = SORT_MODES[defaultSortMode];
        if (sortConfig) {
            const currentSortBy = searchParams.get("sortBy");
            const currentSortOrder = searchParams.get("sortOrder");
            
            if (currentSortBy !== sortConfig.sortBy || currentSortOrder !== sortConfig.sortOrder) {
                searchParams.set("sortBy", sortConfig.sortBy);
                searchParams.set("sortOrder", sortConfig.sortOrder);
                needsRewrite = true;
            }
        }
    }

    // Only rewrite if something actually changed
    if (!needsRewrite) {
        return;
    }
    
    console.log(`Cleanplaats: Rewriting API URL from ${requestDetails.url} to ${url.href}`);

    return {
        redirectUrl: url.href
    };
}

/**
 * Start intercepting requests
 */
function startIntercepting() {
    if (isIntercepting) return;
    
    isIntercepting = true;

    // Intercept hash-based navigation
    browserAPI.webRequest.onBeforeRequest.addListener(
        rewriteHashRequests,
        {
            urls: [
                "https://www.marktplaats.nl/l/*",
                "https://www.marktplaats.nl/q/*",
                "https://www.2dehands.be/l/*",
                "https://www.2dehands.be/q/*"
            ]
        },
        ["blocking"]
    );

    // Intercept API requests
    browserAPI.webRequest.onBeforeRequest.addListener(
        rewriteApiRequests,
        {
            urls: [
                "https://www.marktplaats.nl/lrp/api/search*",
                "https://www.2dehands.be/lrp/api/search*"
            ]
        },
        ["blocking"]
    );
}

/**
 * Stop intercepting requests
 */
function stopIntercepting() {
    if (!isIntercepting) return;
    
    isIntercepting = false;
    
    try {
        browserAPI.webRequest.onBeforeRequest.removeListener(rewriteHashRequests);
        browserAPI.webRequest.onBeforeRequest.removeListener(rewriteApiRequests);
    } catch (error) {
        console.log('Cleanplaats: Error removing listeners:', error);
    }
}

/**
 * Update interception based on current setting
 */
function updateInterception() {
    // Intercept when results per page is not 30 OR sort mode is not standard
    const shouldIntercept = resultsPerPage !== "30" || defaultSortMode !== "standard";
    
    console.log(`Cleanplaats: Updating interception. Results per page: ${resultsPerPage}, Sort mode: ${defaultSortMode}, Should intercept: ${shouldIntercept}, Currently intercepting: ${isIntercepting}`);
    
    if (!shouldIntercept) {
        if (isIntercepting) {
            console.log('Cleanplaats: Stopping interception (back to defaults)');
            stopIntercepting();
        }
    } else {
        if (!isIntercepting) {
            console.log(`Cleanplaats: Starting interception for ${resultsPerPage} results per page and ${defaultSortMode} sort mode`);
            startIntercepting();
        }
    }
}

/**
 * Handle storage changes
 */
function handleStorageChanges(changes, areaName) {
    if (areaName !== 'local') return;
    
    // Check if cleanplaatsSettings changed
    if (changes.cleanplaatsSettings) {
        try {
            const newSettings = JSON.parse(changes.cleanplaatsSettings.newValue || '{}');
            const newResultsPerPage = newSettings.resultsPerPage?.toString() || "30";
            const newDefaultSortMode = newSettings.defaultSortMode || "standard";
            
            let settingsChanged = false;
            
            if (newResultsPerPage !== resultsPerPage) {
                console.log(`Cleanplaats: Results per page changed from ${resultsPerPage} to ${newResultsPerPage}`);
                resultsPerPage = newResultsPerPage;
                settingsChanged = true;
            }
            
            if (newDefaultSortMode !== defaultSortMode) {
                console.log(`Cleanplaats: Default sort mode changed from ${defaultSortMode} to ${newDefaultSortMode}`);
                defaultSortMode = newDefaultSortMode;
                settingsChanged = true;
            }
            
            if (settingsChanged) {
                updateInterception();
            }
        } catch (error) {
            console.error('Cleanplaats: Error parsing settings:', error);
        }
    }
}

/**
 * Initialize the background script
 */
function initialize() {
    // Load current settings
    browserAPI.storage.local.get(['cleanplaatsSettings'], (result) => {
        if (browserAPI.runtime.lastError) {
            console.error('Cleanplaats: Error loading settings:', browserAPI.runtime.lastError);
            return;
        }
        
        try {
            if (result.cleanplaatsSettings) {
                const settings = JSON.parse(result.cleanplaatsSettings);
                resultsPerPage = settings.resultsPerPage?.toString() || "30";
                defaultSortMode = settings.defaultSortMode || "standard";
            }
            
            updateInterception();
            
            // Listen for storage changes
            browserAPI.storage.onChanged.addListener(handleStorageChanges);
            
        } catch (error) {
            console.error('Cleanplaats: Error initializing background script:', error);
        }
    });
}



// Initialize when the background script starts
initialize(); 