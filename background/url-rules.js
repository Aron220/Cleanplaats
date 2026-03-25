/**
 * Background URL rewriting and DNR rule management.
 */

function parseHashOptions(hashStr) {
    const options = {};
    if (!hashStr || hashStr.length < 2) return options;
    const hashKeysValues = hashStr.substring(1).split('|');
    for (let i = 0; i < hashKeysValues.length; ++i) {
        const keyValue = hashKeysValues[i].split(':');
        if (keyValue.length !== 2) continue;
        options[keyValue[0]] = keyValue[1];
    }
    return options;
}

function buildHashOptions(options) {
    const entries = Object.entries(options).filter(([_, v]) => v && v !== '');
    if (entries.length === 0) return '';
    let hashStr = '#';
    for (const key in options) {
        if (options[key] && options[key] !== '') {
            hashStr += key + ':' + options[key] + '|';
        }
    }
    if (hashStr.endsWith('|')) {
        hashStr = hashStr.substring(0, hashStr.length - 1);
    }
    return hashStr;
}

function getModifiedUrlIfNeeded(urlString, currentResultsPerPage, currentDefaultSortMode, currentSortPreferenceSource) {
    const url = new URL(urlString);
    const options = parseHashOptions(url.hash);
    let needsRewrite = false;
    const hasExplicitSort = Boolean(options.sortBy && options.sortOrder);
    const shouldApplyCleanplaatsSort = currentSortPreferenceSource !== 'marketplace';

    if (!Object.prototype.hasOwnProperty.call(options, 'limit') || options.limit !== currentResultsPerPage) {
        options.limit = currentResultsPerPage;
        needsRewrite = true;
    }

    if (shouldApplyCleanplaatsSort && currentDefaultSortMode !== 'standard') {
        const sortConfig = SORT_MODES[currentDefaultSortMode];
        if (sortConfig && (!hasExplicitSort || options.sortBy !== sortConfig.sortBy || options.sortOrder !== sortConfig.sortOrder)) {
            options.sortBy = sortConfig.sortBy;
            options.sortOrder = sortConfig.sortOrder;
            needsRewrite = true;
        }
    } else if (shouldApplyCleanplaatsSort && currentDefaultSortMode === 'standard' && hasExplicitSort) {
        delete options.sortBy;
        delete options.sortOrder;
        needsRewrite = true;
    }

    if (needsRewrite) {
        url.hash = buildHashOptions(options);
        return url.href;
    }
    return null;
}

async function updateApiRequestRules(currentResultsPerPage, currentDefaultSortMode) {
    console.log(`Cleanplaats: updateApiRequestRules called with RPP: ${currentResultsPerPage}, Sort: ${currentDefaultSortMode}`);
    const rulesToRemove = [API_RULE_ID];
    const rulesToAdd = [];
    const shouldModifyApi = currentResultsPerPage !== '30';

    if (shouldModifyApi) {
        const rule = {
            id: API_RULE_ID,
            priority: 1,
            action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: [], addOrReplaceParams: [] } } } },
            condition: { urlFilter: API_URL_PATTERNS.map(p => p.replace('*', '')).join('|'), resourceTypes: ['xmlhttprequest'] }
        };
        if (currentResultsPerPage !== '30') {
            rule.action.redirect.transform.queryTransform.addOrReplaceParams.push({ key: 'limit', value: currentResultsPerPage });
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

function handleHashNavigation(details) {
    if (details.frameId !== 0 || details.parentFrameId !== -1) return;

    console.log('Cleanplaats: handleHashNavigation triggered.', `URL: ${details.url}`, `Transition: ${details.transitionType}`);

    const urlMatches = HASH_URL_PATTERNS.some(pattern => details.url.startsWith(pattern));
    if (!urlMatches) {
        console.log('Cleanplaats: handleHashNavigation - URL does not match HASH_URL_PATTERNS, skipping.', details.url);
        return;
    }

    const newUrl = getModifiedUrlIfNeeded(details.url, resultsPerPage, defaultSortMode, sortPreferenceSource);
    console.log(`Cleanplaats: handleHashNavigation - Original URL: ${details.url}, Processed newUrl: ${newUrl}`);

    if (newUrl && newUrl !== details.url) {
        console.log(`Cleanplaats: Rewriting URL via onBeforeNavigate from ${details.url} to ${newUrl}`);
        browserAPI.tabs.update(details.tabId, { url: newUrl });
        if (details.transitionType === undefined) {
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

function handleHistoryStateUpdated(details) {
    if (details.frameId !== 0 || details.parentFrameId !== -1) return;

    console.log('Cleanplaats: handleHistoryStateUpdated triggered.', `URL: ${details.url}`, `Transition: ${details.transitionType}`);

    const urlMatches = HASH_URL_PATTERNS.some(pattern => details.url.startsWith(pattern));
    if (!urlMatches) {
        console.log('Cleanplaats: handleHistoryStateUpdated - URL does not match HASH_URL_PATTERNS, skipping.', details.url);
        return;
    }

    const newUrl = getModifiedUrlIfNeeded(details.url, resultsPerPage, defaultSortMode, sortPreferenceSource);
    console.log(`Cleanplaats: handleHistoryStateUpdated - Original URL: ${details.url}, Processed newUrl: ${newUrl}`);

    if (newUrl && newUrl !== details.url) {
        console.log(`Cleanplaats: Correcting URL via onHistoryStateUpdated from ${details.url} to ${newUrl}`);
        browserAPI.tabs.update(details.tabId, { url: newUrl });
    }
}
