/**
 * Background message handling and settings refresh.
 */

function messageListener(message, sender, sendResponse) {
    console.log('Cleanplaats: messageListener received message: ', message);

    if (message.action === 'keepAlive') {
        console.log('Cleanplaats: Background script woken up by content script');
        resetKeepAliveToActiveMode();
        sendResponse({ status: 'acknowledged', timestamp: Date.now() });
        refreshSettingsAndRules();
        return true;
    }

    if (message.action === 'forceRefresh') {
        console.log('Cleanplaats: Force refresh requested');
        resetKeepAliveToActiveMode();
        refreshSettingsAndRules();
        sendResponse({ status: 'refreshed' });
        return true;
    }

    return true;
}

async function refreshSettingsAndRules() {
    try {
        const result = await new Promise((resolve) => {
            browserAPI.storage.local.get(['cleanplaatsSettings'], resolve);
        });

        if (result.cleanplaatsSettings) {
            const settings = JSON.parse(result.cleanplaatsSettings);
            const newResultsPerPage = settings.resultsPerPage?.toString() || '30';
            const newDefaultSortMode = settings.defaultSortMode || 'standard';
            const newSortPreferenceSource = settings.sortPreferenceSource || 'cleanplaats';
            const darkModeEnabled = Boolean(settings.darkMode);

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
            if (newSortPreferenceSource !== sortPreferenceSource) {
                console.log(`Cleanplaats: Refreshing sort source from ${sortPreferenceSource} to ${newSortPreferenceSource}`);
                sortPreferenceSource = newSortPreferenceSource;
                settingsChanged = true;
            }

            await updateDarkModeStartupScript(darkModeEnabled);

            if (settingsChanged) {
                await updateApiRequestRules(resultsPerPage, defaultSortMode);
                console.log('Cleanplaats: Settings and rules refreshed after wake-up');
            }
        }
    } catch (error) {
        console.error('Cleanplaats: Error refreshing settings:', error);
    }
}

if (browserAPI.runtime.onMessage) {
    if (!browserAPI.runtime.onMessage.hasListener(messageListener)) {
        browserAPI.runtime.onMessage.addListener(messageListener);
    }
}
