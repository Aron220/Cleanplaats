/**
 * Background lifecycle and listener registration.
 */

async function handleStorageChanges(changes, areaName) {
    if (areaName !== 'local' || !changes.cleanplaatsSettings) return;

    console.log('Cleanplaats: handleStorageChanges triggered.', changes.cleanplaatsSettings);
    try {
        const newSettingsData = JSON.parse(changes.cleanplaatsSettings.newValue || '{}');
        const newResultsPerPage = newSettingsData.resultsPerPage?.toString() || '30';
        const newDefaultSortMode = newSettingsData.defaultSortMode || 'standard';
        const newSortPreferenceSource = newSettingsData.sortPreferenceSource || 'cleanplaats';
        const darkModeEnabled = Boolean(newSettingsData.darkMode);

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
        if (newSortPreferenceSource !== sortPreferenceSource) {
            console.log(`Cleanplaats: Sort preference source changed from ${sortPreferenceSource} to ${newSortPreferenceSource}`);
            sortPreferenceSource = newSortPreferenceSource;
            settingsActuallyChanged = true;
        }

        await updateDarkModeStartupScript(darkModeEnabled);

        if (settingsActuallyChanged) {
            await updateApiRequestRules(resultsPerPage, defaultSortMode);
        }
    } catch (error) {
        console.error('Cleanplaats: Error parsing settings in handleStorageChanges:', error);
    }
}

async function initialize() {
    console.log('Cleanplaats background.js: initialize() called.', new Date().toISOString());

    browserAPI.storage.local.get(['cleanplaatsSettings'], async (result) => {
        if (browserAPI.runtime.lastError) {
            console.error('Cleanplaats: Error loading settings during initialize:', browserAPI.runtime.lastError);
        } else {
            console.log('Cleanplaats: Settings loaded from storage:', result.cleanplaatsSettings);
            try {
                if (result.cleanplaatsSettings) {
                    const settings = JSON.parse(result.cleanplaatsSettings);
                    resultsPerPage = settings.resultsPerPage?.toString() || '30';
                    defaultSortMode = settings.defaultSortMode || 'standard';
                    sortPreferenceSource = settings.sortPreferenceSource || 'cleanplaats';
                    await updateDarkModeStartupScript(Boolean(settings.darkMode));
                } else {
                    await updateDarkModeStartupScript(false);
                }
            } catch (error) {
                console.error('Cleanplaats: Error parsing stored settings:', error, '. Using default settings.');
                await updateDarkModeStartupScript(false);
            }
        }

        console.log(`Cleanplaats: Initialized with settings - RPP: ${resultsPerPage}, Sort: ${defaultSortMode}, SortSource: ${sortPreferenceSource}`);

        await updateApiRequestRules(resultsPerPage, defaultSortMode);

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
                console.warn('Cleanplaats: Could not remove old webRequest listeners.', e);
            }
        }

        try {
            if (browserAPI.storage.onChanged.hasListener(handleStorageChanges)) {
                browserAPI.storage.onChanged.removeListener(handleStorageChanges);
            }
            browserAPI.storage.onChanged.addListener(handleStorageChanges);
            console.log('Cleanplaats: Added storage.onChanged listener.');
        } catch (error) {
            console.error('Cleanplaats: Error setting up storage listener:', error);
        }

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

        console.log('Cleanplaats: All listeners registered. Ready.');
    });
}

browserAPI.runtime.onInstalled.addListener(async (details) => {
    console.log('Cleanplaats: runtime.onInstalled event triggered, reason: ', details.reason);
    if (details.reason === 'install' || details.reason === 'update') {
        console.log('Cleanplaats: Extension installed or updated. Clearing old declarativeNetRequest rules.');
        try {
            const existingRules = await browserAPI.declarativeNetRequest.getDynamicRules();
            const ruleIdsToRemove = existingRules.map(rule => rule.id);
            if (ruleIdsToRemove.length > 0) {
                await browserAPI.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIdsToRemove });
                console.log('Cleanplaats: Successfully cleared old dynamic rules.');
            }
        } catch (error) {
            console.error('Cleanplaats: Error clearing dynamic rules on install/update:', error);
        }
    }
});

function rewriteHashRequests_MV2_compat() {}
function rewriteApiRequests_MV2_compat() {}
