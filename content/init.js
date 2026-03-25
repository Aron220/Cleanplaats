/**
 * Content-script initialization and background wake-up.
 */

function wakeUpBackground() {
    try {
        browserAPI.runtime.sendMessage({ action: 'keepAlive' }, (response) => {
            if (browserAPI.runtime.lastError) {
                console.log('Cleanplaats: Background script not responding, this is normal if it was sleeping');
                setTimeout(() => {
                    try {
                        browserAPI.runtime.sendMessage({ action: 'forceRefresh' }, () => {
                            if (!browserAPI.runtime.lastError) {
                                console.log('Cleanplaats: Background script force-refreshed successfully');
                            }
                        });
                    } catch (e) {
                        console.log('Cleanplaats: Force refresh also failed:', e);
                    }
                }, 100);
            } else {
                console.log('Cleanplaats: Background script is awake', response);
            }
        });
    } catch (error) {
        console.log('Cleanplaats: Could not wake background script:', error);
    }
}

function setupPeriodicWakeUp() {
    if (typeof browser !== 'undefined') {
        console.log('Cleanplaats: Setting up periodic background wake-up for Firefox');

        setInterval(() => {
            if (isSearchResultsPage()) {
                wakeUpBackground();
            }
        }, 30000);

        ['click', 'scroll', 'keydown'].forEach(eventType => {
            document.addEventListener(eventType, () => {
                if (isSearchResultsPage()) {
                    clearTimeout(window.cleanplaatsWakeUpTimeout);
                    window.cleanplaatsWakeUpTimeout = setTimeout(wakeUpBackground, 1000);
                }
            }, { passive: true });
        });
    }
}

function checkFirstRun() {
    return new Promise(resolve => {
        browserAPI.storage.local.get('firstRun', (items) => {
            if (browserAPI.runtime.lastError) {
                console.error('Cleanplaats: Error checking first run:', browserAPI.runtime.lastError);
                resolve(true);
                return;
            }

            let isFirstRun;
            if (items.firstRun === undefined) {
                isFirstRun = true;
            } else {
                isFirstRun = items.firstRun;
            }

            if (isFirstRun) {
                browserAPI.storage.local.set({ firstRun: false }, () => {
                    if (browserAPI.runtime.lastError) {
                        console.error('Cleanplaats: Error setting first run flag:', browserAPI.runtime.lastError);
                    }
                    resolve(isFirstRun);
                });
            } else {
                resolve(isFirstRun);
            }
        });
    });
}

function getExtensionVersion() {
    try {
        if (browserAPI?.runtime?.getManifest) {
            const manifest = browserAPI.runtime.getManifest();
            if (manifest && typeof manifest.version === 'string') {
                return manifest.version;
            }
        }
    } catch (error) {
        console.error('Cleanplaats: Failed to read extension version', error);
    }

    return '';
}

function initCleanplaats() {
    console.log('Cleanplaats: Initializing...');

    const currentVersion = getExtensionVersion();

    wakeUpBackground();
    setupPeriodicWakeUp();

    loadSettings()
        .then(() => {
            registerSettingsStorageSync();
            applyDarkModeToDocument(CLEANPLAATS.settings.darkMode);

            checkFirstRun()
                .then(isFirstRun => {
                    CLEANPLAATS.featureFlags.firstRun = isFirstRun;

                    createControlPanel();
                    setupWebchatCollisionAvoidance();
                    setupAllObservers();
                    applySettings();
                    showOnboarding(currentVersion);

                    const tryCleanup = () => {
                        if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
                            performInitialCleanup();
                            injectBlacklistButtons();
                            setTimeout(checkForEmptyPage, 300);
                            setTimeout(updateStatsDisplay, 500);

                            let attempts = 0;
                            const maxAttempts = 10;
                            const interval = setInterval(() => {
                                removePersistentGoogleAds();

                                document.querySelectorAll('#banner-top-dt').forEach(banner => {
                                    if (banner.parentNode) {
                                        banner.parentNode.removeChild(banner);
                                    }
                                });

                                document.body.offsetHeight;
                                attempts++;
                                if (
                                    (!document.querySelector('#banner-right-container') && !document.querySelector('#banner-top-dt')) ||
                                    attempts >= maxAttempts
                                ) {
                                    clearInterval(interval);
                                }
                            }, 80);
                        } else {
                            setTimeout(tryCleanup, 60);
                        }
                    };
                    tryCleanup();
                });
        })
        .catch(error => {
            console.error('Cleanplaats: Initialization failed', error);
        });
}
