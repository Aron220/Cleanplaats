/**
 * Content-script storage and state persistence.
 */

function registerSettingsStorageSync() {
    if (cleanplaatsStorageSyncRegistered || !browserAPI?.storage?.onChanged?.addListener) {
        return;
    }

    browserAPI.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.cleanplaatsSettings?.newValue) {
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
    });

    cleanplaatsStorageSyncRegistered = true;
}

function loadSettings() {
    return new Promise((resolve, reject) => {
        browserAPI.storage.local.get(['cleanplaatsSettings', 'panelState'], (items) => {
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
