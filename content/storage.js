/**
 * Content-script storage and state persistence.
 */

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

function registerSettingsStorageSync() {
    if (cleanplaatsStorageSyncRegistered || !browserAPI?.storage?.onChanged?.addListener) {
        return;
    }

    browserAPI.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.cleanplaatsSettings?.newValue) {
            if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes, CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY)) {
                setViewedListingsRuntime(changes[CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY].newValue);

                if (typeof applyViewedListingIndicators === 'function') {
                    applyViewedListingIndicators();
                }

                if (typeof syncViewedListingsControlsState === 'function') {
                    syncViewedListingsControlsState();
                }
            }
            return;
        }

        try {
            const nextSettings = JSON.parse(changes.cleanplaatsSettings.newValue);
            const darkModeEnabled = Boolean(nextSettings?.darkMode);

            if (CLEANPLAATS.settings.darkMode !== darkModeEnabled) {
                CLEANPLAATS.settings.darkMode = darkModeEnabled;
                applyDarkModeToDocument(darkModeEnabled);
                syncDarkModeToggle(darkModeEnabled);
            } else {
                persistDarkModePreference(darkModeEnabled);
            }
        } catch (error) {
            console.error('Cleanplaats: Failed to sync dark mode from storage', error);
        }

        if (Object.prototype.hasOwnProperty.call(changes, CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY)) {
            setViewedListingsRuntime(changes[CLEANPLAATS_VIEWED_LISTINGS_STORAGE_KEY].newValue);

            if (typeof applyViewedListingIndicators === 'function') {
                applyViewedListingIndicators();
            }

            if (typeof syncViewedListingsControlsState === 'function') {
                syncViewedListingsControlsState();
            }
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
                resolve();
            } catch (error) {
                console.error('Cleanplaats: Failed to parse settings from storage', error);
                reject(error);
            }
        });
    });
}

function saveSettings() {
    return new Promise((resolve, reject) => {
        try {
            persistDarkModePreference(Boolean(CLEANPLAATS.settings.darkMode));
            browserAPI.storage.local.set({
                cleanplaatsSettings: JSON.stringify(CLEANPLAATS.settings),
                panelState: JSON.stringify(CLEANPLAATS.panelState)
            }, () => {
                if (browserAPI.runtime.lastError) {
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
