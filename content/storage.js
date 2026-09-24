/**
 * Content-script storage and state persistence.
 */

var CLEANPLAATS_HIDES_LISTINGS_STORAGE_KEY = 'cleanplaats:hidesListings';

function normalizeViewedListings(viewedListings) {
    if (!viewedListings || typeof viewedListings !== 'object') {
        return {};
    }

    const normalizedEntries = Object.entries(viewedListings).reduce((accumulator, [key, value]) => {
        const listingId = getListingIdFromUrl(key);
        const timestamp = Number(value);

        if (!listingId || !Number.isFinite(timestamp) || timestamp <= 0) {
            return accumulator;
        }

        accumulator.push([listingId, timestamp]);
        return accumulator;
    }, []);

    normalizedEntries.sort((left, right) => right[1] - left[1]);
    return Object.fromEntries(normalizedEntries.slice(0, CLEANPLAATS_MAX_VIEWED_LISTINGS));
}

function setViewedListingsRuntime(viewedListings) {
    CLEANPLAATS.runtime.viewedListings = normalizeViewedListings(viewedListings);
}

function persistViewedListings() {
    return new Promise((resolve, reject) => {
        browserAPI.storage.local.set({
            [CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY]: CLEANPLAATS.runtime.viewedListings
        }, () => {
            if (browserAPI.runtime.lastError) {
                console.error('Cleanplaats: Failed to save viewed listings', browserAPI.runtime.lastError);
                reject(browserAPI.runtime.lastError);
                return;
            }

            resolve();
        });
    });
}

function isListingViewed(listingId) {
    return Boolean(listingId && CLEANPLAATS.runtime.viewedListings?.[listingId]);
}

function getViewedListingsCount() {
    return Object.keys(CLEANPLAATS.runtime.viewedListings || {}).length;
}

function markListingAsViewed(listingId) {
    const normalizedId = getListingIdFromUrl(listingId);
    if (!normalizedId) {
        return Promise.resolve(false);
    }

    CLEANPLAATS.runtime.viewedListings = normalizeViewedListings({
        ...CLEANPLAATS.runtime.viewedListings,
        [normalizedId]: Date.now()
    });

    return persistViewedListings().then(() => true);
}

function removeViewedListing(listingId) {
    const normalizedId = getListingIdFromUrl(listingId);
    if (!normalizedId || !CLEANPLAATS.runtime.viewedListings?.[normalizedId]) {
        return Promise.resolve(false);
    }

    const nextViewedListings = { ...CLEANPLAATS.runtime.viewedListings };
    delete nextViewedListings[normalizedId];
    CLEANPLAATS.runtime.viewedListings = normalizeViewedListings(nextViewedListings);

    return persistViewedListings().then(() => true);
}

function clearViewedListings() {
    CLEANPLAATS.runtime.viewedListings = {};
    return persistViewedListings().then(() => true);
}

function rememberCurrentListingVisit() {
    const listingId = getListingIdFromUrl(window.location.href);
    if (!listingId) {
        return Promise.resolve(false);
    }

    return markListingAsViewed(listingId).catch(error => {
        console.error('Cleanplaats: Failed to remember current listing visit', error);
        return false;
    });
}

function applyViewedListingsFromStorage(viewedListings) {
    setViewedListingsRuntime(viewedListings);

    if (typeof applyViewedListingIndicators === 'function') {
        applyViewedListingIndicators();
    }

    if (typeof syncViewedListingsControlsState === 'function') {
        syncViewedListingsControlsState();
    }
}

// saveSettings() writes the whole settings object, so a tab that kept its own
// copy from page load would put that copy back on its next save and silently
// undo everything done in other tabs since: block a seller in one tab, collapse
// the panel in another, and the block is gone. Every tab therefore takes over
// whatever another tab saved, the moment it is saved.
function applySettingsFromOtherTab(serializedSettings) {
    const pendingWrites = CLEANPLAATS.runtime.pendingSettingsWrites;
    const ownWriteIndex = pendingWrites.indexOf(serializedSettings);
    if (ownWriteIndex !== -1) {
        // Our own save coming back. Anything before it in the list was
        // superseded by it and will not be reported separately.
        pendingWrites.splice(0, ownWriteIndex + 1);
        return;
    }

    if (serializedSettings === JSON.stringify(CLEANPLAATS.settings)) {
        return;
    }

    let nextSettings;
    try {
        nextSettings = JSON.parse(serializedSettings);
    } catch (error) {
        console.error('Cleanplaats: Failed to read settings saved by another tab', error);
        return;
    }
    if (!nextSettings || typeof nextSettings !== 'object') return;

    const darkModeEnabled = Boolean(nextSettings.darkMode);
    const darkModeChanged = CLEANPLAATS.settings.darkMode !== darkModeEnabled;

    Object.assign(CLEANPLAATS.settings, nextSettings);

    if (darkModeChanged) {
        applyDarkModeToDocument(darkModeEnabled);
        syncDarkModeToggle(darkModeEnabled);
    } else {
        persistDarkModePreference(darkModeEnabled);
    }

    persistSortPreference();
    persistHidesListingsPreference();

    if (typeof syncPanelControlsToSettings === 'function') {
        syncPanelControlsToSettings();
    }

    // Blocks can have been lifted as well as added, so start from a clean page
    // rather than only hiding more, the same way a filter toggle does.
    if (typeof runScheduledCleanup === 'function') {
        resetPreviousChanges();
        runScheduledCleanup();
    }

    updateBlacklistModal();
    updateTermsModal();
    updateBlockedListingsModal();
}

function applyPanelStateFromOtherTab(serializedPanelState) {
    try {
        const nextPanelState = JSON.parse(serializedPanelState);
        if (nextPanelState && typeof nextPanelState === 'object') {
            // Only adopted, not applied: collapsing the panel in one tab should
            // not fold it away in front of the user in another. It just must not
            // be written back stale (a lost lastSeenVersion shows the update
            // popup again).
            Object.assign(CLEANPLAATS.panelState, nextPanelState);
        }
    } catch (error) {
        console.error('Cleanplaats: Failed to read panel state saved by another tab', error);
    }
}

function registerSettingsStorageSync() {
    if (cleanplaatsStorageSyncRegistered || !browserAPI?.storage?.onChanged?.addListener) {
        return;
    }

    browserAPI.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes.cleanplaatsSettings?.newValue) {
            applySettingsFromOtherTab(changes.cleanplaatsSettings.newValue);
        }

        if (changes.panelState?.newValue) {
            applyPanelStateFromOtherTab(changes.panelState.newValue);
        }

        if (Object.prototype.hasOwnProperty.call(changes, CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY)) {
            applyViewedListingsFromStorage(changes[CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY].newValue);
        }
    });

    cleanplaatsStorageSyncRegistered = true;
}

function loadSettings() {
    return new Promise((resolve, reject) => {
        browserAPI.storage.local.get(['cleanplaatsSettings', 'panelState', CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY], (items) => {
            if (browserAPI.runtime.lastError) {
                console.error('Cleanplaats: Failed to load settings from storage', browserAPI.runtime.lastError);
                reject(browserAPI.runtime.lastError);
                return;
            }

            try {
                const storedSettings = items.cleanplaatsSettings;
                const storedPanelState = items.panelState;

                if (storedSettings) {
                    const settings = JSON.parse(storedSettings);
                    Object.assign(CLEANPLAATS.settings, settings);
                }

                try {
                    const storedDarkMode = window.localStorage.getItem(CLEANPLAATS_THEME_STORAGE_KEY);
                    if (storedDarkMode === 'true' || storedDarkMode === 'false') {
                        CLEANPLAATS.settings.darkMode = storedDarkMode === 'true';
                    }
                } catch (error) {
                    console.warn('Cleanplaats: Failed to read dark mode from localStorage', error);
                }

                if (storedPanelState) {
                    CLEANPLAATS.panelState = JSON.parse(storedPanelState);
                }

                setViewedListingsRuntime(items[CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY]);
                persistSortPreference();
                persistHidesListingsPreference();
                resolve();
            } catch (error) {
                console.error('Cleanplaats: Failed to parse settings from storage', error);
                reject(error);
            }
        });
    });
}

function persistSortPreference() {
    try {
        window.localStorage.setItem(CLEANPLAATS_SORT_STORAGE_KEY, CLEANPLAATS.settings.defaultSortMode || 'standard');
    } catch (error) {
        console.warn('Cleanplaats: Failed to persist sort preference in localStorage', error);
    }
}

// theme-init.js masks the results list at document_start when this says the
// cleanup pass is going to hide something. It runs long before storage.local is
// readable, so localStorage is the only place that answer can live. The key
// name is repeated there for the same reason the theme and sort keys are.
function persistHidesListingsPreference() {
    try {
        const settings = CLEANPLAATS.settings;
        const hidesSomething = Boolean(
            settings.removeTopAds
            || settings.removeDagtoppers
            || settings.removePromotedListings
            || settings.removeOpvalStickers
            || settings.removeReservedListings
            || settings.blacklistedTerms?.length
            || settings.blacklistedDescriptionTerms?.length
            || settings.blacklistedSellers?.length
            || settings.blockedListings?.length
        );
        window.localStorage.setItem(CLEANPLAATS_HIDES_LISTINGS_STORAGE_KEY, hidesSomething ? 'true' : 'false');
    } catch (error) {
        console.warn('Cleanplaats: Failed to persist listing mask hint in localStorage', error);
    }
}

function saveSettings() {
    return new Promise((resolve, reject) => {
        try {
            persistDarkModePreference(Boolean(CLEANPLAATS.settings.darkMode));
            persistSortPreference();
            persistHidesListingsPreference();
            const serializedSettings = JSON.stringify(CLEANPLAATS.settings);
            CLEANPLAATS.runtime.pendingSettingsWrites.push(serializedSettings);
            browserAPI.storage.local.set({
                cleanplaatsSettings: serializedSettings,
                panelState: JSON.stringify(CLEANPLAATS.panelState)
            }, () => {
                if (browserAPI.runtime.lastError) {
                    const pendingWrites = CLEANPLAATS.runtime.pendingSettingsWrites;
                    const failedIndex = pendingWrites.lastIndexOf(serializedSettings);
                    if (failedIndex !== -1) pendingWrites.splice(failedIndex, 1);

                    console.error('Cleanplaats: Failed to save settings to storage', browserAPI.runtime.lastError);
                    reject(browserAPI.runtime.lastError);
                    return;
                }
                resolve();
            });
        } catch (error) {
            console.error('Cleanplaats: Failed to save settings to storage', error);
            reject(error);
        }
    });
}

function resetStats() {
    Object.keys(CLEANPLAATS.stats).forEach(key => {
        CLEANPLAATS.stats[key] = 0;
    });

    updateStatsDisplay();
}
