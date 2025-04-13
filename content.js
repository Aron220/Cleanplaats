/**
 * Cleanplaats - A browser extension to remove ads from Marktplaats
 * Version: 1.1.0
 */

// State management
const CLEANPLAATS = {
    // Configuration with defaults
    settings: {
        removeTopAds: true,
        removeDagtoppers: true,
        removePromotedListings: true,
        removeAds: true,
        removeOpvalStickers: true,
        pauseFiltering: false
    },

    // Stats tracking
    stats: {
        topAdsRemoved: 0,
        dagtoppersRemoved: 0,
        promotedListingsRemoved: 0,
        opvalStickersRemoved: 0,
        otherAdsRemoved: 0,
        totalRemoved: 0
    },

    // Runtime variables
    observers: {
        mutation: null,
        ads: null
    },

    // Feature flags
    featureFlags: {
        showStats: true,
        autoCollapse: false,
        firstRun: true
    }
};

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCleanplaats);
} else {
    initCleanplaats();
}

/**
 * Main initialization function
 */
function initCleanplaats() {
    console.log('Cleanplaats: Initializing...');

    // Load saved settings and initialize the extension
    loadSettings()
        .then(() => {
            checkFirstRun()
                .then(isFirstRun => {
                    CLEANPLAATS.featureFlags.firstRun = isFirstRun;

                    if (isFirstRun) {
                        showOnboarding();
                    }

                    createControlPanel();
                    setupAllObservers();
                    
                    // Modified this part to ensure content is loaded
                    const checkInitialContent = setInterval(() => {
                        if (document.querySelector('.hz-Listing')) {
                            clearInterval(checkInitialContent);
                            performInitialCleanup();
                            // Add delay before checking for empty page
                            setTimeout(checkForEmptyPage, 1000);
                        }
                    }, 100);

                    // Safety timeout after 5 seconds
                    setTimeout(() => {
                        clearInterval(checkInitialContent);
                    }, 5000);

                    // Log initialization complete
                    console.log('Cleanplaats: Initialization complete');
                });
        })
        .catch(error => {
            console.error('Cleanplaats: Initialization failed', error);
        });
}

/**
 * Check if this is the first run of the extension
 */
function checkFirstRun() {
    return new Promise(resolve => {
        chrome.storage.sync.get('firstRun', (data) => {
            const isFirstRun = data.firstRun !== false;

            // If it's the first run, set firstRun to false for next time
            if (isFirstRun) {
                chrome.storage.sync.set({ firstRun: false });
            }

            resolve(isFirstRun);
        });
    });
}

/**
 * Load settings from storage
 */
function loadSettings() {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.sync.get(CLEANPLAATS.settings, (items) => {
                Object.assign(CLEANPLAATS.settings, items);
                resolve();
            });
        } catch (error) {
            console.error('Cleanplaats: Failed to load settings', error);
            reject(error);
        }
    });
}

/**
 * Save settings to storage
 */
function saveSettings() {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.sync.set(CLEANPLAATS.settings, resolve);
        } catch (error) {
            console.error('Cleanplaats: Failed to save settings', error);
            reject(error);
        }
    });
}

/**
 * Reset stats to zero
 */
function resetStats() {
    Object.keys(CLEANPLAATS.stats).forEach(key => {
        CLEANPLAATS.stats[key] = 0;
    });

    updateStatsDisplay();
}

/* ======================
 UI COMPONENTS
 ====================== */

/**
 * Create and append the control panel to the page
 */
function createControlPanel() {
    if (document.getElementById('cleanplaats-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'cleanplaats-panel';
    panel.className = 'cleanplaats-panel';

    if (CLEANPLAATS.featureFlags.autoCollapse) {
        panel.classList.add('collapsed');
    }

    panel.innerHTML = `
        <div class="cleanplaats-header" id="cleanplaats-header">
            <h3>
                Cleanplaats
                <span class="cleanplaats-badge" id="cleanplaats-total-count">0</span>
            </h3>
            <button id="cleanplaats-toggle" class="cleanplaats-toggle">▲</button>
        </div>
        <div class="cleanplaats-content">
            <div class="cleanplaats-options">
                <div class="cleanplaats-section-title">Filteropties</div>
                <div class="cleanplaats-option">
                    <input type="checkbox" id="removeTopAds" class="cleanplaats-checkbox" ${CLEANPLAATS.settings.removeTopAds ? 'checked' : ''}>
                    <label for="removeTopAds">
                        Topadvertenties
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert betaalde "Topadvertentie" advertenties</span>
                        </div>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <input type="checkbox" id="removeDagtoppers" class="cleanplaats-checkbox" ${CLEANPLAATS.settings.removeDagtoppers ? 'checked' : ''}>
                    <label for="removeDagtoppers">
                        Dagtoppers
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert "Dagtopper" advertenties</span>
                        </div>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <input type="checkbox" id="removePromotedListings" class="cleanplaats-checkbox" ${CLEANPLAATS.settings.removePromotedListings ? 'checked' : ''}>
                    <label for="removePromotedListings">
                        Bedrijfsadvertenties
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert advertenties van bedrijven met een "Bezoek website" link</span>
                        </div>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <input type="checkbox" id="removeOpvalStickers" class="cleanplaats-checkbox" ${CLEANPLAATS.settings.removeOpvalStickers ? 'checked' : ''}>
                    <label for="removeOpvalStickers">
                        Opvalstickers
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert advertenties met opvalstickers</span>
                        </div>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <input type="checkbox" id="removeAds" class="cleanplaats-checkbox" ${CLEANPLAATS.settings.removeAds ? 'checked' : ''}>
                    <label for="removeAds">
                        Andere advertenties
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert banners, Google advertenties en andere advertenties</span>
                        </div>
                    </label>
                </div>
                <button id="pauseFilteringBtn" class="cleanplaats-button cleanplaats-pause-button">${CLEANPLAATS.settings.pauseFiltering ? 'Hervat filtering' : 'Pauzeer filtering'}</button>
            </div>

            <button id="cleanplaats-apply" class="cleanplaats-button">Toepassen</button>

            ${CLEANPLAATS.featureFlags.showStats ? `
            <div class="cleanplaats-stats" id="cleanplaats-stats">
                <div class="cleanplaats-section-title">Verwijderde items</div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">Topadvertenties:</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-topads-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">Dagtoppers:</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-dagtoppers-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">Bedrijfsadvertenties:</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-promoted-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">Opvalstickers:</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-stickers-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">Andere advertenties:</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-otherads-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">Totaal:</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-total-count-stats">0</span>
                </div>
            </div>
            ` : ''}

            <a href="https://www.buymeacoffee.com/cleanplaats" target="_blank" rel="noopener noreferrer" class="cleanplaats-bmc-button">
                    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 40px !important;width: 180px !important;">
            </a>
        </div>
    `;

    document.body.appendChild(panel);
    setupEventListeners();
}

/**
 * Show the onboarding notification for first-time users
 */
function showOnboarding() {
    const onboarding = document.createElement('div');
    onboarding.className = 'cleanplaats-onboarding';
    onboarding.id = 'cleanplaats-onboarding';

    onboarding.innerHTML = `
        <div class="cleanplaats-onboarding-header">
            <h3>Welkom bij Cleanplaats!</h3>
            <button id="cleanplaats-onboarding-close" class="cleanplaats-onboarding-close">×</button>
        </div>
        <div class="cleanplaats-onboarding-content">
            <p>Cleanplaats verwijdert advertenties en promotionele content van Marktplaats. Gebruik het configuratiescherm rechtsonder om de filtering aan te passen.</p>
        </div>
        <button id="cleanplaats-onboarding-got-it" class="cleanplaats-onboarding-button">Begrepen!</button>
    `;

    document.body.appendChild(onboarding);

    // Setup onboarding event listeners
    document.getElementById('cleanplaats-onboarding-close').addEventListener('click', () => {
        document.getElementById('cleanplaats-onboarding').remove();
    });

    document.getElementById('cleanplaats-onboarding-got-it').addEventListener('click', () => {
        document.getElementById('cleanplaats-onboarding').remove();
    });

    // Auto-remove after 12 seconds
    setTimeout(() => {
        const element = document.getElementById('cleanplaats-onboarding');
        if (element) element.remove();
    }, 12000);
}

/**
 * Show notification about empty page
 */
let notificationTimeout; // To store the timeout ID
let notificationVisible = false; // Flag to track if the notification is currently visible

/**
 * Check if the page is empty or has few listings
 */
function checkForEmptyPage() {
    clearTimeout(notificationTimeout);

    // Increase the delay to ensure all cleanups are complete
    notificationTimeout = setTimeout(() => {
        // Force a final check of all elements that should be hidden
        performCleanup();
        
        // Now check the final state
        const visibleListings = document.querySelectorAll('.hz-Listing:not([data-cleanplaats-hidden])');
        const totalListings = document.querySelectorAll('.hz-Listing');
        const hiddenCount = totalListings.length - visibleListings.length;
        
        // Only show notification if we actually removed something
        if (hiddenCount === 0) return;

        // Clear any existing notifications first
        clearAllNotifications();

        if (visibleListings.length === 0) {
            showEmptyPageNotification();
        } else if (visibleListings.length < 5) {
            showFewListingsNotification(visibleListings.length, hiddenCount);
        }
    }, 1000); // Increased from 500ms to 1000ms
}

/**
 * Show notification for completely empty page
 */
function showEmptyPageNotification() {
    const notification = document.createElement('div');
    notification.id = 'cleanplaats-empty-notification';
    notification.className = 'cleanplaats-empty-notification';
    
    notification.innerHTML = `
        <div class="cleanplaats-empty-notification-content">
            <p>De pagina is leeg omdat deze helemaal uit advertenties bestond! Probeer een volgende pagina.</p>
            <button id="cleanplaats-empty-notification-close" class="cleanplaats-empty-notification-close">OK</button>
        </div>
    `;
    
    insertNotification(notification);
}

/**
 * Show notification when few listings remain
 */
function showFewListingsNotification(remainingCount, removedCount) {
    const notification = document.createElement('div');
    notification.id = 'cleanplaats-empty-notification';
    notification.className = 'cleanplaats-empty-notification';
    
    const listingWord = remainingCount === 1 ? 'resultaat' : 'resultaten';
    const removedWord = removedCount === 1 ? 'advertentie' : 'advertenties';
    
    notification.innerHTML = `
        <div class="cleanplaats-empty-notification-content">
            <p>Er ${remainingCount === 1 ? 'is' : 'zijn'} nog ${remainingCount} ${listingWord} over nadat Cleanplaats ${removedCount} ${removedWord} heeft verwijderd.</p>
            <button id="cleanplaats-empty-notification-close" class="cleanplaats-empty-notification-close">OK</button>
        </div>
    `;
    
    insertNotification(notification);
}

/**
 * Helper to insert notification in the page
 */
function insertNotification(notification) {
    // Remove any existing notification first
    clearAllNotifications();
    
    const searchBar = document.querySelector('.hz-Header-searchBar');
    if (searchBar) {
        searchBar.parentNode.insertBefore(notification, searchBar.nextSibling);
    }
    
    // Setup close button
    document.getElementById('cleanplaats-empty-notification-close').addEventListener('click', () => {
        notification.remove();
    });
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 8000);
}

/**
 * Clear all Cleanplaats notifications
 */
function clearAllNotifications() {
    const notifications = document.querySelectorAll('[id^="cleanplaats-"]');
    notifications.forEach(notification => {
        if (notification.classList.contains('cleanplaats-empty-notification') ||
            notification.id === 'cleanplaats-loading') {
            notification.remove();
        }
    });
    notificationVisible = false;
}

/**
 * Set up all event listeners for the control panel
 */
function setupEventListeners() {
    // Panel toggle
    const header = document.getElementById('cleanplaats-header');
    const toggle = document.getElementById('cleanplaats-toggle');
    const panel = document.getElementById('cleanplaats-panel');

    if (header && panel) {
        header.addEventListener('click', (e) => {
            // Prevent toggling when clicking checkboxes
            if (e.target.tagName === 'INPUT' || e.target.closest('.cleanplaats-tooltip')) {
                return;
            }

            panel.classList.toggle('collapsed');
            toggle.textContent = panel.classList.contains('collapsed') ? '▼' : '▲';
        });
    }

    // Apply button
    const applyBtn = document.getElementById('cleanplaats-apply');
    if (applyBtn) {
        applyBtn.addEventListener('click', applySettings);
    }

    // Pause filtering button
    const pauseFilteringBtn = document.getElementById('pauseFilteringBtn');
    if (pauseFilteringBtn) {
        pauseFilteringBtn.addEventListener('click', handlePauseFiltering);
    }

    // Setup checkbox change listeners
    ['removeTopAds', 'removeDagtoppers', 'removePromotedListings',
        'removeOpvalStickers', 'removeAds'].forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.addEventListener('change', handleCheckboxChange);
            }
        });
}

/**
 * Handle checkbox change events
 */
function handleCheckboxChange(event) {
    const setting = event.target.id;
    const value = event.target.checked;

    CLEANPLAATS.settings[setting] = value;
}

/**
 * Handle pause filtering button click
 */
function handlePauseFiltering() {
    CLEANPLAATS.settings.pauseFiltering = !CLEANPLAATS.settings.pauseFiltering;
    saveSettings()
        .then(() => {
            const pauseFilteringBtn = document.getElementById('pauseFilteringBtn');
            if (pauseFilteringBtn) {
                pauseFilteringBtn.textContent = CLEANPLAATS.settings.pauseFiltering ? 'Hervat filtering' : 'Pauzeer filtering';
            }
            applySettings();
        });
}

/**
 * Apply current settings and update the UI
 */
function applySettings() {
    saveSettings()
        .then(() => {
            resetPreviousChanges();
            performCleanup();

            // Update button text temporarily
            const applyBtn = document.getElementById('cleanplaats-apply');
            if (applyBtn) {
                const originalText = applyBtn.textContent;
                applyBtn.textContent = '✓ Toegepast!';

                // Clear any existing timeout
                clearTimeout(applyBtn.timeoutId);

                // Set a new timeout
                applyBtn.timeoutId = setTimeout(() => {
                    if (applyBtn) applyBtn.textContent = originalText;
                }, 1500);
            }
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to apply settings', error);

            // Show error on button
            const applyBtn = document.getElementById('cleanplaats-apply');
            if (applyBtn) {
                applyBtn.textContent = '❌ Error!';
                setTimeout(() => {
                    if (applyBtn) applyBtn.textContent = 'Toepassen';
                }, 1500);
            }
        });
}

/**
 * Update the stats display in the UI
 */
function updateStatsDisplay() {
    if (!CLEANPLAATS.featureFlags.showStats) return;

    const stats = CLEANPLAATS.stats;

    // Update individual stat counts
    updateElementText('cleanplaats-topads-count', stats.topAdsRemoved);
    updateElementText('cleanplaats-dagtoppers-count', stats.dagtoppersRemoved);
    updateElementText('cleanplaats-promoted-count', stats.promotedListingsRemoved);
    updateElementText('cleanplaats-stickers-count', stats.opvalStickersRemoved);
    updateElementText('cleanplaats-otherads-count', stats.otherAdsRemoved);

    // Calculate and update total count
    const total = stats.topAdsRemoved + stats.dagtoppersRemoved + stats.promotedListingsRemoved + stats.opvalStickersRemoved + stats.otherAdsRemoved;
    stats.totalRemoved = total;

    updateElementText('cleanplaats-total-count-stats', total);
    updateElementText('cleanplaats-total-count', total);
}

/**
 * Helper to update element text content if the element exists
 */
function updateElementText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

/* ======================
 CORE CLEANUP FUNCTIONALITY
 ====================== */

/**
 * Perform initial cleanup on page load
 */
function performInitialCleanup() {
    try {
        if (!CLEANPLAATS.settings.pauseFiltering) {
            performCleanup();
        }
    } catch (error) {
        console.error('Cleanplaats: Initial cleanup failed', error);
    }
}

/**
 * Main cleanup function that handles all types of content removal
 */
function performCleanup() {
    if (CLEANPLAATS.settings.pauseFiltering) {
        return;
    }

    // Perform all cleanups synchronously
    if (CLEANPLAATS.settings.removeTopAds) removeTopAdvertisements();
    if (CLEANPLAATS.settings.removeDagtoppers) removeDagtoppers();
    if (CLEANPLAATS.settings.removePromotedListings) removePromotedListings();
    if (CLEANPLAATS.settings.removeOpvalStickers) removeOpvalStickerListings();
    if (CLEANPLAATS.settings.removeAds) {
        removeAllAds();
        removePersistentGoogleAds();
    }

    updateStatsDisplay();
    
    // Don't call checkForEmptyPage() here anymore
    // This prevents the cascade of multiple notifications
}

/**
 * Reset previous changes made by the extension
 */
function resetPreviousChanges() {
    resetStats();

    document.querySelectorAll('[data-cleanplaats-hidden]').forEach(el => {
        try {
            el.style.cssText = el.getAttribute('data-original-style') || '';
            el.removeAttribute('data-cleanplaats-hidden');
            el.removeAttribute('data-original-style');
        } catch (error) {
            console.error('Cleanplaats: Error restoring element', error);
        }
    });
}

/* ======================
 AD REMOVAL FUNCTIONS
 ====================== */

/**
 * Remove top advertisements
 */
function removeTopAdvertisements() {
    const removedCount = findAndHideListings('.hz-Listing-priority span', 'Topadvertentie');
    CLEANPLAATS.stats.topAdsRemoved += removedCount;
}

/**
 * Remove dagtoppers
 */
function removeDagtoppers() {
    const removedCount = findAndHideListings('.hz-Listing-priority span', 'Dagtopper');
    CLEANPLAATS.stats.dagtoppersRemoved += removedCount;
}

/**
 * Remove promoted listings with "Bezoek website" links
 */
function removePromotedListings() {
    let count = 0;

    document.querySelectorAll('.hz-Listing-seller-link').forEach(sellerLink => {
        try {
            const hasVisitWebsite = Array.from(sellerLink.querySelectorAll('span, a'))
                .some(el => el.textContent?.trim() === 'Bezoek website');

            if (hasVisitWebsite) {
                const listing = sellerLink.closest('.hz-Listing');
                if (listing && !listing.hasAttribute('data-cleanplaats-hidden') && hideElement(listing)) {
                    count++;
                }
            }
        } catch (error) {
            console.error('Cleanplaats: Error processing promoted listing', error);
        }
    });

    CLEANPLAATS.stats.promotedListingsRemoved += count;
}

/**
 * Remove listings with promotional stickers
 */
function removeOpvalStickerListings() {
    let count = 0;
    const stickerSelectors = [
        '.hz-Listing-Opvalsticker-wrapper',
        '[data-testid="listing-opval-sticker"]'
    ];

    stickerSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(sticker => {
            try {
                const listing = sticker.closest('.hz-Listing');
                if (listing && !listing.hasAttribute('data-cleanplaats-hidden') && hideElement(listing)) {
                    count++;
                }
            } catch (error) {
                console.error('Cleanplaats: Error processing sticker listing', error);
            }
        });
    });

    CLEANPLAATS.stats.opvalStickersRemoved += count;
}

/**
 * Remove all other ads (banners, Google ads, etc.)
 */
function removeAllAds() {
    let count = 0;

    function safeHide(selector) {
        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (!el.hasAttribute('data-cleanplaats-hidden') && hideElement(el)) {
                    count++;
                }
            });
        } catch (error) {
            console.log('Cleanplaats: Error hiding ads', error);
        }
    }

    const adSelectors = [
        '#adsense-container',
        '#adsense-container-bottom-lazy',
        '#adBlock',
        '.hz-Banner',
        '.hz-Banner--fluid',
        '#banner-rubrieks-dt',
        '[data-google-query-id]',
        '[id*="google_ads_iframe"]',
        '[id*="google_ads_top_frame"]',
        '[aria-label="Advertisement"]',
        '[title="3rd party ad content"]',
        '.i_.div',
        '[data-ad-container]',
        '[data-bg="true"]',
        '[class*="adsbygoogle"]',
        'ins.adsbygoogle',
        'iframe[src*="googleads"]',
        'iframe[src*="doubleclick"]',
        '[id*="div-gpt-ad"]',
        '.hz-Listings__container--cas[data-testid="BottomBlockLazyListings"]',
        '[class*="creative"]',
        '#google_ads_top_frame',
        '.creative' // Added this line
    ];

    adSelectors.forEach(selector => {
        safeHide(selector);
    });

    CLEANPLAATS.stats.otherAdsRemoved += count;
}

    /**
 * Remove persistent Google ads that resist normal hiding
 */
function removePersistentGoogleAds() {
    let count = 0;
    
    // Target the main ad container
    const selectors = [
        '.creative', // The container you're trying to remove
        'div[id^="google_ads_iframe"]', // Google ad iframes
        'div[data-google-query-id]', // Google ad markers
        'div[aria-label="Advertisement"]' // Generic ad markers
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(ad => {
            try {
                // Completely remove the ad from DOM rather than just hiding it
                if (ad.parentNode) {
                    ad.parentNode.removeChild(ad);
                    count++;
                }
            } catch (error) {
                console.error('Cleanplaats: Error removing persistent ad', error);
            }
        });
    });

    CLEANPLAATS.stats.otherAdsRemoved += count;
}

/**
 * Helper to find and hide elements with specific text content
 */
function findAndHideListings(selector, textContent) {
    let count = 0;

    try {
        document.querySelectorAll(selector).forEach(el => {
            if (el.textContent?.trim() === textContent) {
                const listing = el.closest('.hz-Listing');
                if (listing && !listing.hasAttribute('data-cleanplaats-hidden') && hideElement(listing)) {
                    count++;
                }
            }
        });
    } catch (error) {
        console.error(`Cleanplaats: Error finding "${textContent}" listings`, error);
    }

    return count;
}

/**
 * Helper to hide an element and mark it
 */
function hideElement(element) {
    if (!element || element.hasAttribute('data-cleanplaats-hidden')) {
        return false;
    }

    try {
        // Store original style
        element.setAttribute('data-original-style', element.style.cssText);

        // Hide the element
        element.setAttribute('data-cleanplaats-hidden', 'true');
        element.style.display = 'none !important';

        return true;
    } catch (error) {
        console.error('Cleanplaats: Error hiding element', error);
        return false;
    }
}

/* ======================
 OBSERVATION & NAVIGATION
 ====================== */

/**
 * Set up a combined mutation observer for DOM and URL changes
 */
function setupObservers() {
    let lastUrl = location.href;

    // Disconnect any existing observers
    if (CLEANPLAATS.observers.mutation) {
        CLEANPLAATS.observers.mutation.disconnect();
    }

    const observer = new MutationObserver(mutations => {
        // Check for URL changes
        if (lastUrl !== location.href) {
            console.log('Cleanplaats: URL changed from', lastUrl, 'to', location.href);
            lastUrl = location.href;
            performCleanupAndCheckForEmptyPage();
        }

        // Don't process mutations if filtering is paused
        if (CLEANPLAATS.settings.pauseFiltering) return;

        let shouldCleanup = false;

        // Check if any relevant elements were added
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if any ads or listings were added
                        if (
                            node.classList?.contains('hz-Listing') ||
                            node.querySelector?.('.hz-Listing') ||
                            node.id?.includes('ad') ||
                            node.classList?.contains('hz-Banner') ||
                            node.querySelector?.('[data-google-query-id]')
                        ) {
                            shouldCleanup = true;
                            break;
                        }
                    }
                }
            }

            if (shouldCleanup) break;
        }

        // Run cleanup if needed, but don't reset stats since we want to accumulate
        if (shouldCleanup) {
            performCleanup();
        }
    });

    // Start observing the entire document
    observer.observe(document, {
        childList: true,
        subtree: true
    });

    // Store the observer
    CLEANPLAATS.observers.mutation = observer;
}

/**
 * Perform cleanup and check for empty page
 */
function performCleanupAndCheckForEmptyPage() {
    // Remove the notification on navigation
    const existingNotification = document.getElementById('cleanplaats-empty-notification');
    if (existingNotification) {
        existingNotification.remove();
        notificationVisible = false;
    }

    // Immediately reapply filters when new content loads
    const checkContentLoaded = setInterval(() => {
        if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
            clearInterval(checkContentLoaded);
            if (!CLEANPLAATS.settings.pauseFiltering) {
                console.log('Cleanplaats: Running cleanup after navigation');
                performCleanup();
                // Delay the check for empty page to ensure DOM is fully updated
                setTimeout(checkForEmptyPage, 500);
            }
        }
    }, 100);
}

/**
 * Unified function to handle navigation events
 */
function handleNavigation() {
    window.dispatchEvent(new Event('navigation'));
}

/**
 * Set up event listeners for SPA navigation
 */
function setupNavigationDetection() {
    // Listen for popstate event
    window.addEventListener('popstate', handleNavigation);

    // Monkey patch history methods to detect SPA navigation
    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(this, arguments);
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
    };

    // Additional event listeners for Marktplaats-specific navigation
    document.addEventListener('click', (e) => {
        // Check if clicked element is a navigation link
        const link = e.target.closest('a[href]');
        if (link && link.hostname === window.location.hostname) {
            // Small delay to let the navigation occur
            setTimeout(() => handleNavigation(), 100);
        }
    });
}

/**
 * Set up all observers
 */
function setupAllObservers() {
    setupObservers();
    setupNavigationDetection();
}

/**
 * Get the current page number from the URL
 */
function getCurrentPage() {
    const match = window.location.pathname.match(/\/p\/(\d+)/);
    return match ? parseInt(match[1]) : 1;
}
