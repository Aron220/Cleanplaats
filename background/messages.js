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

    if (message.action === 'getAlertsDataConsent') {
        hasAlertsDataConsent().then(granted => sendResponse({ granted }));
        return true;
    }

    if (message.action === 'openAlertsDataConsent') {
        openAlertsDataConsentPage(message.lang);
        sendResponse({ status: 'opened' });
        return true;
    }

    return true;
}

/**
 * Firefox's built-in data consent. Zoekopdrachten is the one feature that
 * sends anything to our server (the e-mail address, the searches and the
 * filters), so those data types are declared optional in the manifest and
 * asked for only when someone opens the feature, instead of putting every
 * installer through a data prompt for something most never use.
 *
 * The manifest is the one list of what we ask for. Chrome has no such system,
 * and neither does a Firefox with the feature switched off: getAll() then has
 * no data_collection key at all, and there is nothing to ask.
 */
function getOptionalDataCollection() {
    const gecko = browserAPI.runtime.getManifest().browser_specific_settings?.gecko;
    return gecko?.data_collection_permissions?.optional || [];
}

async function hasAlertsDataConsent() {
    const wanted = getOptionalDataCollection();
    if (!wanted.length || !browserAPI.permissions?.getAll) return true;
    try {
        const { data_collection: granted } = await browserAPI.permissions.getAll();
        if (!Array.isArray(granted)) return true;
        return wanted.every(type => granted.includes(type));
    } catch (error) {
        console.error('Cleanplaats: Could not read data collection consent', error);
        return false;
    }
}

/**
 * permissions.request() only works from a click inside an extension page: a
 * content script has no permissions API, and a click relayed here as a message
 * no longer counts as the user's. So the panel opens this small page, and the
 * button on it is what asks Firefox.
 */
function openAlertsDataConsentPage(lang) {
    const url = browserAPI.runtime.getURL(`pages/data-consent.html?lang=${lang === 'fr' ? 'fr' : 'nl'}`);
    // Firefox for Android has no windows API; a tab is the only way there.
    if (browserAPI.windows?.create) {
        browserAPI.windows.create({ url, type: 'popup', width: 480, height: 420 });
    } else {
        browserAPI.tabs.create({ url });
    }
}

async function refreshSettingsAndRules() {
    try {
        const result = await browserAPI.storage.local.get(['cleanplaatsSettings']);

        if (result.cleanplaatsSettings) {
            const settings = JSON.parse(result.cleanplaatsSettings);
            const newResultsPerPage = settings.resultsPerPage?.toString() || '30';
            const newDefaultSortMode = settings.defaultSortMode || 'standard';
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
