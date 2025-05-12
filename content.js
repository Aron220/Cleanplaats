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
        // removeAds: true, is now always true
        removeOpvalStickers: true,
        blacklistedSellers: []
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
    },

    // Panel state
    panelState: {
        isCollapsed: false,
        hasShownWelcomeToast: false
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

    loadSettings()
        .then(() => {
            checkFirstRun()
                .then(isFirstRun => {
                    CLEANPLAATS.featureFlags.firstRun = isFirstRun;
                    
                    // Always show onboarding/welcome message
                    showOnboarding();

                    createControlPanel();
                    setupAllObservers();
                    applySettings(); // Add this line to apply settings after loading

                    // Modified this part to ensure content is loaded
                    const checkInitialContent = setInterval(() => {
                        if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
                            clearInterval(checkInitialContent);
                            performInitialCleanup();
                            injectBlacklistButtons();
                            setTimeout(checkForEmptyPage, 300);
                        }
                    }, 100);
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
        chrome.storage.local.get('firstRun', (items) => {
            let isFirstRun;
            if (items.firstRun === undefined) {
                isFirstRun = true;
            } else {
                isFirstRun = items.firstRun;
            }

            // If it's the first run, set firstRun to false for next time
            if (isFirstRun) {
                chrome.storage.local.set({ 'firstRun': false }, () => {
                    resolve(isFirstRun);
                });
            } else {
                resolve(isFirstRun);
            }
        });
    });
}

/**
 * Load settings from chrome.storage.local
 */
function loadSettings() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['cleanplaatsSettings', 'panelState'], (items) => {
            try {
                const storedSettings = items.cleanplaatsSettings;
                const storedPanelState = items.panelState;

                if (storedSettings) {
                    const settings = JSON.parse(storedSettings);
                    Object.assign(CLEANPLAATS.settings, settings);
                }

                if (storedPanelState) {
                    CLEANPLAATS.panelState = JSON.parse(storedPanelState);
                }

                resolve();
            } catch (error) {
                console.error('Cleanplaats: Failed to load settings from chrome.storage.local', error);
                reject(error);
            }
        });
    });
}

/**
 * Save settings and panel state to chrome.storage.local
 */
function saveSettings() {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.set({
                cleanplaatsSettings: JSON.stringify(CLEANPLAATS.settings),
                panelState: JSON.stringify(CLEANPLAATS.panelState)
            }, () => {
                resolve();
            });
        } catch (error) {
            console.error('Cleanplaats: Failed to save settings to chrome.storage.local', error);
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

    if (CLEANPLAATS.featureFlags.autoCollapse || CLEANPLAATS.panelState.isCollapsed) {
        panel.classList.add('collapsed');
    }

    panel.innerHTML = DOMPurify.sanitize(`
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
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removeTopAds" ${CLEANPLAATS.settings.removeTopAds ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removeTopAds" class="cleanplaats-option-label">
                        Topadvertenties
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert betaalde "Topadvertenties"</span>
                        </div>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removeDagtoppers" ${CLEANPLAATS.settings.removeDagtoppers ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removeDagtoppers" class="cleanplaats-option-label">
                        Dagtoppers
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert "Dagtopper" advertenties</span>
                        </div>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removePromotedListings" ${CLEANPLAATS.settings.removePromotedListings ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removePromotedListings" class="cleanplaats-option-label">
                        Bedrijfsadvertenties
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert advertenties van bedrijven met een "Bezoek website" link</span>
                        </div>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removeOpvalStickers" ${CLEANPLAATS.settings.removeOpvalStickers ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removeOpvalStickers" class="cleanplaats-option-label">
                        Opvalstickers
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert advertenties met opvalstickers</span>
                        </div>
                    </label>
                </div>
            </div>

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
            <button id="cleanplaats-manage-blacklist" class="cleanplaats-button cleanplaats-blacklist-manage-btn" style="margin-top:10px;">Beheer verborgen verkopers</button>
            <div id="cleanplaats-blacklist-modal" class="cleanplaats-blacklist-modal" style="display:none;"></div>
        </div>
    `);

    document.body.appendChild(panel);
    setupEventListeners();

    // Blacklist management button
    document.getElementById('cleanplaats-manage-blacklist').addEventListener('click', (e) => {
        e.preventDefault();
        showBlacklistModal();
    });
}

/**
 * Show the onboarding notification for first-time users
 */
function showOnboarding() {
    if (CLEANPLAATS.featureFlags.firstRun) {
        showFirstTimeOnboarding();
    } else {
        showWelcomeToast();
    }
}

/**
 * Show comprehensive first-time onboarding
 */
function showFirstTimeOnboarding() {
    const onboarding = document.createElement('div');
    onboarding.className = 'cleanplaats-onboarding';
    onboarding.id = 'cleanplaats-onboarding';

    onboarding.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-onboarding-content">
            <div class="cleanplaats-onboarding-header">
                <h3>🎉 Welkom bij Cleanplaats!</h3>
                <button id="cleanplaats-onboarding-close" class="cleanplaats-onboarding-close">×</button>
            </div>
            <div class="cleanplaats-onboarding-steps">
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">1</span>
                    <p>Cleanplaats verwijdert automatisch advertenties en promotionele content</p>
                </div>
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">2</span>
                    <p>Gebruik het configuratiescherm rechtsonder om de filtering aan te passen. Je opent en sluit het paneel via het pijltje bovenin.</p>
                </div>
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">3</span>
                    <p>Bekijk statistieken over verwijderde items in het configuratiescherm</p>
                </div>
            </div>
            <button id="cleanplaats-onboarding-got-it" class="cleanplaats-onboarding-button">Aan de slag!</button>
        </div>
    `);

    document.body.appendChild(onboarding);
    
    // Setup event listeners
    ['cleanplaats-onboarding-close', 'cleanplaats-onboarding-got-it'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            onboarding.classList.add('cleanplaats-fade-out');
            setTimeout(() => onboarding.remove(), 300);
        });
    });

    // Auto-remove after 15 seconds
    setTimeout(() => {
        if (onboarding.parentNode) {
            onboarding.classList.add('cleanplaats-fade-out');
            setTimeout(() => onboarding.remove(), 300);
        }
    }, 15000);
}

/**
 * Show welcome toast for returning users
 */
function showWelcomeToast() {
    // Only show on main page and if not already shown
    if (CLEANPLAATS.panelState.hasShownWelcomeToast || 
        location.pathname !== '/' || 
        location.hostname !== 'www.marktplaats.nl') {
        return;
    }

    const toast = document.createElement('div');
    toast.className = 'cleanplaats-toast';
    toast.id = 'cleanplaats-toast';

    // Add removed count if available
    const totalRemoved = CLEANPLAATS.stats.totalRemoved;
    const message = totalRemoved > 0 
        ? `Cleanplaats is actief (${totalRemoved} items verwijderd)`
        : 'Cleanplaats is actief';

    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-toast-content">
            <span class="cleanplaats-toast-icon">✨</span>
            <span class="cleanplaats-toast-message">${message}</span>
        </div>
    `);

    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 100);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);

    // Mark as shown
    CLEANPLAATS.panelState.hasShownWelcomeToast = true;
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
            showBubbleNotification('De pagina is leeg omdat deze helemaal uit advertenties bestond! Probeer een volgende pagina of wijzig de filters.');
        } else if (visibleListings.length < 5) {
            const listingWord = visibleListings.length === 1 ? 'resultaat' : 'resultaten';
            const removedWord = hiddenCount === 1 ? 'advertentie' : 'advertenties';
            showBubbleNotification(`Er ${visibleListings.length === 1 ? 'is' : 'zijn'} nog ${visibleListings.length} ${listingWord} over nadat Cleanplaats ${hiddenCount} ${removedWord} heeft verwijderd.`);
        }
    }, 1000); // Increased from 500ms to 1000ms
}

/**
 * Show a toast notification
 */
function showBubbleNotification(message) {
    let toast = document.getElementById('cleanplaats-bubble-notification');

    if (toast) {
        // If a toast is already visible, update its message
        const messageElement = toast.querySelector('.cleanplaats-toast-message span');
        if (messageElement) {
            messageElement.textContent = message;
        }
    } else {
        // If no toast is visible, create a new one
        toast = document.createElement('div');
        toast.className = 'cleanplaats-blacklist-toast';
        toast.id = 'cleanplaats-bubble-notification'; // Add an ID to find it later

        toast.innerHTML = DOMPurify.sanitize(`
            <div class="cleanplaats-blacklist-toast-content">
                <span class="cleanplaats-toast-icon">✨</span>
                <div class="cleanplaats-toast-message">
                    <span>${message}</span>
                </div>
            </div>
        `);

        document.body.appendChild(toast);
        setTimeout(() => requestAnimationFrame(() => toast.classList.add('visible')), 0);
    }

    // Clear any existing timeout
    if (toast.timeoutId) {
        clearTimeout(toast.timeoutId);
    }

    // Set a new timeout
    toast.timeoutId = setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast) {
                toast.remove();
            }
        }, 300);
    }, 5000);
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
 * Clear the bubble notification
 */
function clearBubbleNotification() {
    const toast = document.getElementById('cleanplaats-bubble-notification');
    if (toast) {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast) {
                toast.remove();
            }
        }, 300);
    }
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

            CLEANPLAATS.panelState.isCollapsed = !CLEANPLAATS.panelState.isCollapsed;
            panel.classList.toggle('collapsed', CLEANPLAATS.panelState.isCollapsed);
            toggle.textContent = CLEANPLAATS.panelState.isCollapsed ? '▼' : '▲';

            // Save panel state
            saveSettings();
        });
    }

    // Apply button
    const applyBtn = document.getElementById('cleanplaats-apply');
    if (applyBtn) {
        applyBtn.addEventListener('click', applySettings);
    }

    // Setup checkbox change listeners
    ['removeTopAds', 'removeDagtoppers', 'removePromotedListings',
        'removeOpvalStickers'].forEach(id => {
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

    // Update state
    CLEANPLAATS.settings[setting] = value;

    // Save settings and apply changes immediately
    saveSettings()
        .then(() => {
            // Reset previous changes and reapply filters
            resetPreviousChanges();
            performCleanup();
            
            // Clear the bubble notification
            clearBubbleNotification();

            // Show feedback in header
            const header = document.querySelector('.cleanplaats-header');
            const feedback = document.createElement('div');
            feedback.className = 'cleanplaats-feedback';
            feedback.textContent = '✓';
            
            // Remove any existing feedback
            header.querySelectorAll('.cleanplaats-feedback').forEach(el => el.remove());
            
            header.appendChild(feedback);
            requestAnimationFrame(() => feedback.classList.add('cleanplaats-feedback-show'));
            
            // Remove after animation
            setTimeout(() => feedback.remove(), 1500);

            // Check for empty page after applying filters
            checkForEmptyPage();
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to apply setting', error);
            event.target.checked = !value;
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
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to apply settings', error);
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
        performCleanup();
    } catch (error) {
        console.error('Cleanplaats: Initial cleanup failed', error);
    }
}

/**
 * Main cleanup function that handles all types of content removal
 */
function performCleanup() {
    // Always remove regular ads first
    removeAllAds();
    removePersistentGoogleAds();

    // Then handle optional filters
    if (CLEANPLAATS.settings.removeTopAds) removeTopAdvertisements();
    if (CLEANPLAATS.settings.removeDagtoppers) removeDagtoppers();
    if (CLEANPLAATS.settings.removePromotedListings) removePromotedListings();
    if (CLEANPLAATS.settings.removeOpvalStickers) removeOpvalStickerListings();

    // Handle blacklisted sellers
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const sellerNameEl = listing.querySelector('.hz-Listing-seller-name, .hz-Listing-seller-link');
        if (!sellerNameEl) return;
        const sellerName = sellerNameEl.textContent.trim();
        if (CLEANPLAATS.settings.blacklistedSellers.includes(sellerName)) {
            listing.setAttribute('data-cleanplaats-hidden', 'true');
            listing.style.display = 'none';
        }
    });

    updateStatsDisplay();
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
                // First hide the element itself
                if (!el.hasAttribute('data-cleanplaats-hidden') && hideElement(el)) {
                    count++;
                }
                
                // Also hide the parent li if it's a banner container
                const parentLi = el.closest('li.bannerContainerLoading');
                if (parentLi && !parentLi.hasAttribute('data-cleanplaats-hidden')) {
                    hideElement(parentLi);
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
        '.creative',
        'li.bannerContainerLoading', // Added this line to directly target the container
        '.bannerContainerLoading', // Added this as a fallback
        '.bannerContainerLoading .hz-Banner', // Added this to target banners inside containers
        '.bannerContainerLoading .hz-Banner--fluid' // Added this to target fluid banners
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
 BLACKLIST MANAGEMENT
 ====================== */

/**
 * Add a seller to the blacklist
 */
function addSellerToBlacklist(sellerName) {
    if (!CLEANPLAATS.settings.blacklistedSellers.includes(sellerName)) {
        CLEANPLAATS.settings.blacklistedSellers.push(sellerName);
        saveSettings().then(() => {
            performCleanup();
            injectBlacklistButtons();
            updateBlacklistModal();
            
            // Show toast notification
            showBlacklistToast(sellerName);
        });
    }
}

/**
 * Show a toast notification for blacklisting
 */
function showBlacklistToast(sellerName) {
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';
    
    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${sellerName} verborgen</strong>
                <span>Beheer verborgen verkopers via het paneel</span>
            </div>
        </div>
    `);

    document.body.appendChild(toast);
    // Add a small delay before adding the 'visible' class
    setTimeout(() => {
        requestAnimationFrame(() => toast.classList.add('visible'));
    }, 50);

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Show a toast notification for unblacklisting
 */
function showUnblacklistToast(sellerName) {
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';
    
    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${sellerName} niet meer verborgen</strong>
                <span>Deze verkoper is weer zichtbaar in de resultaten</span>
            </div>
        </div>
    `);

    document.body.appendChild(toast);
    // Add a small delay before adding the 'visible' class
    setTimeout(() => {
        requestAnimationFrame(() => toast.classList.add('visible'));
    }, 50);

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Remove a seller from the blacklist
 */
function removeSellerFromBlacklist(sellerName) {
    CLEANPLAATS.settings.blacklistedSellers = CLEANPLAATS.settings.blacklistedSellers.filter(s => s !== sellerName);
    saveSettings().then(() => {
        // Show all listings from this seller immediately
        document.querySelectorAll('.hz-Listing').forEach(listing => {
            const sellerNameEl = listing.querySelector('.hz-Listing-seller-name, .hz-Listing-seller-link');
            if (!sellerNameEl) return;
            if (sellerNameEl.textContent.trim() === sellerName) {
                listing.removeAttribute('data-cleanplaats-hidden');
                listing.style.display = '';
            }
        });
        performCleanup();
        injectBlacklistButtons();
        updateBlacklistModal(); // Update modal dynamically
    });
}

/**
 * Inject blacklist buttons under seller names
 */
function injectBlacklistButtons() {
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        // Remove any existing button to avoid duplicates
        const oldBtn = listing.querySelector('.cleanplaats-blacklist-btn-row');
        if (oldBtn) oldBtn.remove();

        // Find the seller name container and link
        const sellerNameContainer = listing.querySelector('.hz-Listing-seller-name-container');
        if (!sellerNameContainer) return;
        const sellerLink = sellerNameContainer.querySelector('a');
        if (!sellerLink) return;
        const sellerNameEl = sellerLink.querySelector('.hz-Listing-seller-name');
        if (!sellerNameEl) return;
        const sellerName = sellerNameEl.textContent.trim();
        if (!sellerName) return;

        // Hide if already blacklisted
        if (CLEANPLAATS.settings.blacklistedSellers.includes(sellerName)) {
            listing.setAttribute('data-cleanplaats-hidden', 'true');
            listing.style.display = 'none';
        }

        // Create the button row
        const btnRow = document.createElement('div');
        btnRow.className = 'cleanplaats-blacklist-btn-row';

        // Create the button
        const btn = document.createElement('button');
        btn.className = 'cleanplaats-blacklist-btn';
        btn.textContent = 'Verkoper verbergen';
        btn.type = 'button';
        btn.tabIndex = 0;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addSellerToBlacklist(sellerName);
        });

        btnRow.appendChild(btn);

        // Insert the button row AFTER the seller name container (not inside the link!)
        if (sellerNameContainer.parentNode) {
            sellerNameContainer.parentNode.insertBefore(btnRow, sellerNameContainer.nextSibling);
        }
    });
}

/**
 * Show the blacklist management modal
 */
function showBlacklistModal() {
    const modal = document.getElementById('cleanplaats-blacklist-modal');
    if (!modal) return;

    const sellers = CLEANPLAATS.settings.blacklistedSellers;

    modal.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-modal-content">
            <h4>Verborgen verkopers</h4>
            <ul id="cleanplaats-blacklist-list">
                ${sellers.length === 0 ? '<li><em>Geen verborgen verkopers</em></li>' : sellers.map(seller => `
                    <li>
                        <span>${seller}</span>
                        <button class="cleanplaats-unblacklist-btn" data-seller="${seller}">Verborgen</button>
                    </li>
                `).join('')}
            </ul>
            <button id="cleanplaats-blacklist-close" style="margin-top:10px;">Sluiten</button>
        </div>
    `);
    modal.style.display = 'block';

    // Close modal
    document.getElementById('cleanplaats-blacklist-close').onclick = () => {
        modal.style.display = 'none';
    };

    // Add hover effect and unblacklist functionality
    setupBlacklistModalButtons();
}

/**
 * Update the blacklist modal dynamically
 */
function updateBlacklistModal() {
    const modal = document.getElementById('cleanplaats-blacklist-modal');
    if (!modal || modal.style.display === 'none') return;

    const sellers = CLEANPLAATS.settings.blacklistedSellers;
    const list = document.getElementById('cleanplaats-blacklist-list');

    if (list) {
        list.innerHTML = DOMPurify.sanitize(
            sellers.length === 0
                ? '<li><em>Geen verborgen verkopers</em></li>'
                : sellers.map(seller => `
                    <li>
                        <span>${seller}</span>
                        <button class="cleanplaats-unblacklist-btn" data-seller="${seller}">Verborgen</button>
                    </li>
                `).join('')
        );

        setupBlacklistModalButtons();
    }
}

/**
 * Set up hover effects and unblacklist functionality for modal buttons
 */
function setupBlacklistModalButtons() {
    document.querySelectorAll('.cleanplaats-unblacklist-btn').forEach(btn => {
        btn.onmouseover = () => {
            btn.style.background = 'green';
            btn.textContent = 'Opheffen';
        };
        btn.onmouseout = () => {
            btn.style.background = 'red';
            btn.textContent = 'Verborgen';
        };
        btn.style.background = 'red';
        btn.style.color = 'white';
        btn.onclick = () => {
            const sellerName = btn.dataset.seller;
            showUnblacklistToast(sellerName);
            removeSellerFromBlacklist(sellerName);
        };
    });
}

/* ======================
 OBSERVATION & NAVIGATION
 ====================== */

/**
 * Add keyboard navigation for carousel images
 */
let keyboardNavigationSetup = false; // Flag to track if keyboard navigation is already set up

function setupKeyboardNavigation() {
    if (keyboardNavigationSetup) {
        // Remove the existing event listener
        document.removeEventListener('keydown', keyboardNavigationHandler);
    }

    // Define the event listener function
    keyboardNavigationHandler = function(event) {
        if (document.querySelector('.Carousel-navigationContainer')) {
            let nextButton = document.querySelector('.Carousel-navigationContainer button[aria-label="Volgende foto"]');
            let prevButton = document.querySelector('.Carousel-navigationContainer button[aria-label="Vorige foto"]');

            if (event.key === 'ArrowRight' && nextButton) {
                event.preventDefault(); // Prevent default arrow key behavior
                nextButton.focus(); // Focus the button
                nextButton.click(); // Trigger the click
            } else if (event.key === 'ArrowLeft' && prevButton) {
                event.preventDefault(); // Prevent default arrow key behavior
                prevButton.focus(); // Focus the button
                prevButton.click(); // Trigger the click
            }
        }
    };

    document.addEventListener('keydown', keyboardNavigationHandler);
    keyboardNavigationSetup = true; // Set the flag to true after setting up
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

    // Clear the bubble notification
    clearBubbleNotification();

    // Immediately reapply filters when new content loads
    const checkContentLoaded = setInterval(() => {
        if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
            clearInterval(checkContentLoaded);
            console.log('Cleanplaats: Running cleanup after navigation');
            performCleanup();
            injectBlacklistButtons();
            // Delay the check for empty page to ensure DOM is fully updated
            setTimeout(checkForEmptyPage, 500);
            setupKeyboardNavigation(); // Initialize keyboard navigation
        }
    }, 100);
}

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
            injectBlacklistButtons();
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
    setupKeyboardNavigation(); // Initialize keyboard navigation on initial setup
}

// Initialize keyboard navigation on initial page load
setupKeyboardNavigation();

/**
 * Get the current page number from the URL
 */
function getCurrentPage() {
    const match = window.location.pathname.match(/\/p\/(\d+)/);
    return match ? parseInt(match[1]) : 1;
}
