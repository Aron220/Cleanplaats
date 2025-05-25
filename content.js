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
        blacklistedSellers: [],
        blacklistedTerms: [] // Added blacklisted terms
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
                    applySettings();

                    // Modified this part to ensure content is loaded
                    const tryCleanup = () => {
                        if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
                            performInitialCleanup();
                            injectBlacklistButtons();
                            setTimeout(checkForEmptyPage, 300);

                            // --- Force ad removal and layout update for Firefox ---
                            // Run multiple times to catch late-rendered ad containers
                            let attempts = 0;
                            const maxAttempts = 10;
                            const interval = setInterval(() => {
                                removePersistentGoogleAds();

                                // Also remove #banner-top-dt if present (fixes grid gap in Firefox)
                                document.querySelectorAll('#banner-top-dt').forEach(banner => {
                                    if (banner.parentNode) {
                                        banner.parentNode.removeChild(banner);
                                    }
                                });

                                // Force reflow
                                document.body.offsetHeight;
                                attempts++;
                                // Stop after a few tries or if the ad containers are gone
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
        panel.classList.add('collapsed-ready');
        // Set background image for minimized state (cross-browser)
        panel.style.backgroundImage = `url('${chrome.runtime.getURL('icons/icon128.png')}')`;
    }

    const is2dehands = location.hostname.includes('2dehands.be');
    const topAdLabel = is2dehands ? 'Topzoekertjes' : 'Topadvertenties';

    panel.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-header" id="cleanplaats-header">
            <h3>
                <img id="cleanplaats-header-logo" class="cleanplaats-header-logo" alt="Cleanplaats logo" />
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
                        ${topAdLabel}
                        <div class="cleanplaats-tooltip">
                            <span class="cleanplaats-tooltip-icon">?</span>
                            <span class="cleanplaats-tooltip-text">Verwijdert betaalde \"${topAdLabel}\" advertenties</span>
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
                            <span class="cleanplaats-tooltip-text">Verwijdert \"Dagtopper\" advertenties</span>
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
                            <span class="cleanplaats-tooltip-text">Verwijdert advertenties van bedrijven met een \"Bezoek website\" link</span>
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

            <button id="cleanplaats-manage-terms" class="cleanplaats-button cleanplaats-blacklist-manage-btn">Beheer blacklist termen</button>
            <button id="cleanplaats-manage-blacklist" class="cleanplaats-button cleanplaats-blacklist-manage-btn">Beheer verborgen verkopers</button>
            <div id="cleanplaats-blacklist-modal" class="cleanplaats-blacklist-modal" style="display:none;"></div>
            <div id="cleanplaats-terms-modal" class="cleanplaats-terms-modal" style="display:none;"></div>

            <a
                href="https://buymeacoffee.com/cleanplaats"
                class="cleanplaats-bmc-button"
                target="_blank"
                rel="noopener"
                title="Steun Cleanplaats – Buy me a coffee!"
            >
                <span class="cleanplaats-bmc-emoji">☕</span>
                <span class="cleanplaats-bmc-text">Buy me a coffee</span>
            </a>
        </div>
    `);

    document.body.appendChild(panel);
    // Set logo src after DOM insertion to avoid DOMPurify issues
    const logoImg = panel.querySelector('#cleanplaats-header-logo');
    if (logoImg) {
      logoImg.src = chrome.runtime.getURL('icons/icon128.png');
    }
    setupEventListeners();

    // Blacklist management button
    document.getElementById('cleanplaats-manage-blacklist').addEventListener('click', (e) => {
        e.preventDefault();
        showBlacklistModal();
    });

    // Blacklist terms management button
    document.getElementById('cleanplaats-manage-terms').addEventListener('click', (e) => {
        e.preventDefault();
        showTermsModal();
    });
}

/**
 * Show the blacklist terms management modal
 */
function showTermsModal() {
    const modal = document.getElementById('cleanplaats-terms-modal');
    if (!modal) return;

    // Close the blacklist modal if it's open
    const blacklistModal = document.getElementById('cleanplaats-blacklist-modal');
    if (blacklistModal) {
        blacklistModal.style.display = 'none';
    }

    // Toggle modal visibility
    if (modal.style.display === 'block') {
        modal.style.display = 'none';
        return;
    }

    const terms = CLEANPLAATS.settings.blacklistedTerms;

    modal.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-terms-modal-content">
            <h4>Blacklist termen</h4>
            <ul id="cleanplaats-terms-list">
                ${terms.length === 0 ? '<li><em>Geen termen toegevoegd</em></li>' : terms.map(term => `
                    <li>
                        <span>${term}</span>
                        <button class="cleanplaats-unblacklist-term-btn" data-term="${term}">Verborgen</button>
                    </li>
                `).join('')}
            </ul>
            <div class="cleanplaats-terms-input-row">
                <input type="text" id="cleanplaats-term-input" class="cleanplaats-term-input" placeholder="Voer een term in">
                <button id="cleanplaats-add-term" class="cleanplaats-add-term-btn">Toevoegen</button>
            </div>
            <button id="cleanplaats-terms-close" style="margin-top:12px;">Sluiten</button>
        </div>
    `);
    modal.style.display = 'block';

    // Close modal
    document.getElementById('cleanplaats-terms-close').onclick = () => {
        modal.style.display = 'none';
    };

    // Add term logic
    const addTerm = () => {
        const input = document.getElementById('cleanplaats-term-input');
        const term = input.value.trim();
        if (term && !CLEANPLAATS.settings.blacklistedTerms.includes(term)) {
            CLEANPLAATS.settings.blacklistedTerms.push(term);
            saveSettings().then(() => {
                input.value = '';
                updateTermsModal();
                performCleanup();
                showBlacklistTermToast(term);
            });
        }
    };

    // Add term on button click
    document.getElementById('cleanplaats-add-term').onclick = addTerm;

    // Add term on Enter key
    document.getElementById('cleanplaats-term-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTerm();
        }
    });

    // Remove term
    setupTermsModalButtons();
}

/**
 * Update the blacklist terms modal dynamically
 */
function updateTermsModal() {
    const modal = document.getElementById('cleanplaats-terms-modal');
    if (!modal || modal.style.display === 'none') return;

    const terms = CLEANPLAATS.settings.blacklistedTerms;
    const list = document.getElementById('cleanplaats-terms-list');

    if (list) {
        list.innerHTML = DOMPurify.sanitize(
            terms.length === 0
                ? '<li><em>Geen termen toegevoegd</em></li>'
                : terms.map(term => `
                    <li>
                        <span>${term}</span>
                        <button class="cleanplaats-unblacklist-term-btn" data-term="${term}">Verborgen</button>
                    </li>
                `).join('')
        );

        setupTermsModalButtons();
    }
}

/**
 * Set up hover effects and remove functionality for terms modal buttons
 */
function setupTermsModalButtons() {
    document.querySelectorAll('.cleanplaats-unblacklist-term-btn').forEach(btn => {
        btn.onmouseover = () => {
            btn.style.background = 'green';
            btn.textContent = 'Opheffen';
        };
        btn.onmouseout = () => {
            btn.style.background = '#ff4d4d';
            btn.textContent = 'Verborgen';
        };
        btn.style.background = '#ff4d4d';
        btn.style.color = 'white';
        btn.onclick = () => {
            const term = btn.dataset.term;
            CLEANPLAATS.settings.blacklistedTerms = CLEANPLAATS.settings.blacklistedTerms.filter(t => t !== term);
            saveSettings().then(() => {
                updateTermsModal();
                unhideListingsByTerm(term);
                performCleanup();
                showUnblacklistTermToast(term);
            });
        };
    });
}

/**
 * Unhide listings that match a removed blacklist term
 */
function unhideListingsByTerm(term) {
    // Unhide .hz-Link (in je buurt tab) and .hz-Listing (normal)
    document.querySelectorAll('.hz-Link').forEach(link => {
        const titleEl = link.querySelector('.hz-Listing-title');
        if (titleEl && titleEl.textContent.toLowerCase().includes(term.toLowerCase())) {
            link.removeAttribute('data-cleanplaats-hidden');
            link.style.display = '';
        }
    });
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const titleEl = listing.querySelector('.hz-Listing-title');
        if (titleEl && titleEl.textContent.toLowerCase().includes(term.toLowerCase())) {
            listing.removeAttribute('data-cleanplaats-hidden');
            listing.style.display = '';
        }
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
    const panel = document.getElementById('cleanplaats-panel'); // Target the panel
    const toggle = document.getElementById('cleanplaats-toggle'); // Chevron button

    if (panel) { // Listen on the panel itself
        panel.addEventListener('click', (e) => {
            // Block toggling while animating
            if (panel.classList.contains('animating')) {
                // Optionally, you could log or provide feedback here
                return;
            }

            const isPanelCollapsed = panel.classList.contains('collapsed');
            let canToggle = false;

            // Determine if the click should trigger a toggle
            if (isPanelCollapsed) {
                // If collapsed (icon mode), any click directly on the panel/icon should expand it.
                if (e.target === panel) {
                    canToggle = true;
                }
            } else {
                // If expanded, toggle only if the click is on the header area,
                // but not on other specific interactive elements (inputs, buttons, links, tooltips, switches).
                const header = document.getElementById('cleanplaats-header');
                if (header && header.contains(e.target)) { // Click is within the header
                    if (
                        e.target.id === 'cleanplaats-toggle' ||
                        !e.target.closest('input, button, a, .cleanplaats-tooltip, .cleanplaats-switch')
                    ) {
                        canToggle = true;
                    }
                }
            }

            if (canToggle) {
                e.preventDefault(); // Prevent default action if 'a' tag was somehow involved in header
                e.stopPropagation(); // Stop event from bubbling further

                // Close any open modals before toggling panel
                const blacklistModal = document.getElementById('cleanplaats-blacklist-modal');
                const termsModal = document.getElementById('cleanplaats-terms-modal');
                if (blacklistModal && blacklistModal.style.display === 'block') {
                    blacklistModal.style.display = 'none';
                }
                if (termsModal && termsModal.style.display === 'block') {
                    termsModal.style.display = 'none';
                }

                // --- Begin new logic for collapsed-ready and animating ---
                // Remove collapsed-ready immediately before any toggle
                panel.classList.remove('collapsed-ready');
                // Remove background image when not collapsed-ready
                panel.style.backgroundImage = '';
                // Add animating class before starting transition
                panel.classList.add('animating');

                CLEANPLAATS.panelState.isCollapsed = !CLEANPLAATS.panelState.isCollapsed;
                panel.classList.toggle('collapsed', CLEANPLAATS.panelState.isCollapsed);

                if (toggle) {
                    toggle.textContent = CLEANPLAATS.panelState.isCollapsed ? '▲' : '▼';
                }

                // Fallback timeout in case transitionend is missed
                let fallbackTimeout = setTimeout(() => {
                    panel.classList.remove('animating');
                    if (CLEANPLAATS.panelState.isCollapsed) {
                        panel.classList.add('collapsed-ready');
                        // Set background image for minimized state (cross-browser)
                        panel.style.backgroundImage = `url('${chrome.runtime.getURL('icons/icon128.png')}')`;
                    }
                }, 600); // Slightly longer than the longest transition (0.4s)

                // If collapsing, add collapsed-ready after width transition, remove animating after width transition
                // If expanding, remove animating after max-height transition
                const onTransitionEnd = (event) => {
                    if (CLEANPLAATS.panelState.isCollapsed && event.propertyName === 'width') {
                        panel.classList.add('collapsed-ready');
                        // Set background image for minimized state (cross-browser)
                        panel.style.backgroundImage = `url('${chrome.runtime.getURL('icons/icon128.png')}')`;
                        panel.classList.remove('animating');
                        panel.removeEventListener('transitionend', onTransitionEnd);
                        clearTimeout(fallbackTimeout);
                    } else if (!CLEANPLAATS.panelState.isCollapsed && event.propertyName === 'max-height') {
                        panel.classList.remove('animating');
                        // Remove background image when expanded
                        panel.style.backgroundImage = '';
                        panel.removeEventListener('transitionend', onTransitionEnd);
                        clearTimeout(fallbackTimeout);
                    }
                };
                panel.addEventListener('transitionend', onTransitionEnd);

                saveSettings();
            }
        });
    }

    // Apply button (This seems to be missing from original code, or was 'cleanplaats-apply'?)
    // const applyBtn = document.getElementById('cleanplaats-apply');
    // if (applyBtn) {
    //     applyBtn.addEventListener('click', applySettings);
    // }

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
        // No need to remove #banner-top-dt-container here, it's handled in removePersistentGoogleAds
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

    // Handle blacklisted terms in titles
    // For "in je buurt" tab: hide the <a.hz-Link> if the title matches
    document.querySelectorAll('.hz-Link').forEach(link => {
        const titleEl = link.querySelector('.hz-Listing-title');
        if (!titleEl) return;
        const title = titleEl.textContent.trim().toLowerCase();
        CLEANPLAATS.settings.blacklistedTerms.forEach(term => {
            if (title.includes(term.toLowerCase())) {
                link.setAttribute('data-cleanplaats-hidden', 'true');
                link.style.display = 'none';
            }
        });
    });
    // For normal listings: hide the .hz-Listing
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const titleEl = listing.querySelector('.hz-Listing-title');
        if (!titleEl) return;
        const title = titleEl.textContent.trim().toLowerCase();
        CLEANPLAATS.settings.blacklistedTerms.forEach(term => {
            if (title.includes(term.toLowerCase())) {
                listing.setAttribute('data-cleanplaats-hidden', 'true');
                listing.style.display = 'none';
            }
        });
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
    const is2dehands = location.hostname.includes('2dehands.be');
    const label = is2dehands ? 'Topzoekertje' : 'Topadvertentie';
    const removedCount = findAndHideListings('.hz-Listing-priority span', label);
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

    // First handle homepage ads with overlay label
    document.querySelectorAll('.hz-Listing-imageOverlayLabel').forEach(overlay => {
        if (overlay.textContent.trim() === 'Homepagina-advertentie') {
            const link = overlay.closest('.hz-Link.hz-Link--block');
            if (link && !link.hasAttribute('data-cleanplaats-hidden')) {
                hideElement(link);
                count++;
            }
        }
    });

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
 * Remove persistent Google ads and empty ad containers that resist normal hiding.
 * This is called on every cleanup and navigation, so grid gaps are always collapsed.
 */
function removePersistentGoogleAds() {
    let count = 0;
    // Remove large ad containers in the grid (e.g. in je buurt tab)
    document.querySelectorAll('.creative, div[id^="google_ads_iframe"], div[data-google-query-id], div[aria-label="Advertisement"]').forEach(ad => {
        try {
            const gridItem = ad.closest('.hz-Link.hz-Link--block');
            if (gridItem && gridItem.parentNode) {
                gridItem.parentNode.removeChild(gridItem);
                count++;
                return;
            }
            if (ad.parentNode) {
                ad.parentNode.removeChild(ad);
                count++;
            }
        } catch (error) {
            console.error('Cleanplaats: Error removing persistent ad', error);
        }
    });

    // Remove banner-right-container and its children (fix grid gap)
    document.querySelectorAll('#banner-right-container').forEach(banner => {
        if (banner.parentNode) {
            banner.parentNode.removeChild(banner);
            count++;
        }
    });

    // Remove #banner-top-dt-container (and its children) if present (fixes grid gap instantly on tab switch)
    document.querySelectorAll('#banner-top-dt-container').forEach(container => {
        if (container.parentNode) {
            container.parentNode.removeChild(container);
            count++;
        }
    });

    // Remove empty banner containers that cause grid gaps
    document.querySelectorAll('.hz-FeedBannerBlock, .Banners-bannerFeedItem').forEach(banner => {
        if (
            banner.childElementCount === 0 ||
            Array.from(banner.children).every(child => child.offsetParent === null)
        ) {
            if (banner.parentNode) {
                banner.parentNode.removeChild(banner);
                count++;
            }
        }
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
            <span class="cleanplaats-toast-icon eye">👁</span>
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
            <span class="cleanplaats-toast-icon eye">👁</span>
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
        const oldTopRight = listing.querySelector('.cleanplaats-seller-topright-mobile');
        if (oldTopRight) oldTopRight.remove();

        // --- MOBILE ONLY: Seller + hide button in top right ---
        if (window.innerWidth < 700) {
            const sellerNameContainer = listing.querySelector('.hz-Listing-seller-name-container');
            let sellerName = null;
            if (sellerNameContainer) {
                const sellerLink = sellerNameContainer.querySelector('a');
                if (sellerLink) {
                    const sellerNameEl = sellerLink.querySelector('.hz-Listing-seller-name');
                    if (sellerNameEl) sellerName = sellerNameEl.textContent.trim();
                }
            }
            if (sellerName) {
                // Create the top row container
                const topRow = document.createElement('div');
                topRow.className = 'cleanplaats-seller-topright-mobile';
                topRow.innerHTML = `
                    <span class="cleanplaats-seller-name-mobile">${sellerName}</span>
                    <button class="cleanplaats-blacklist-btn-mobile" title="Verberg deze verkoper" aria-label="Verberg deze verkoper">
                      <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20C7 20 2.73 16.11 1 12c.74-1.61 1.81-3.09 3.06-4.31"/>
                        <path d="M22.54 12.88A10.06 10.06 0 0 0 12 4c-1.61 0-3.16.31-4.59.88"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    </button>
                `;
                // Insert as first child of the main content column
                const content = listing.querySelector('.hz-Listing-listview-content');
                if (content && content.firstChild) {
                    content.insertBefore(topRow, content.firstChild);
                } else if (content) {
                    content.appendChild(topRow);
                }
                // Add click handler
                topRow.querySelector('.cleanplaats-blacklist-btn-mobile').onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm(`Wil je alle advertenties van ${sellerName} verbergen?`)) {
                        addSellerToBlacklist(sellerName);
                    }
                };
            }
            // Do NOT inject the desktop button on mobile
            return;
        }
        // --- DESKTOP: original logic ---
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

    // Close the terms modal if it's open
    const termsModal = document.getElementById('cleanplaats-terms-modal');
    if (termsModal) {
        termsModal.style.display = 'none';
    }

    // Toggle modal visibility
    if (modal.style.display === 'block') {
        modal.style.display = 'none';
        return;
    }

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
            btn.style.background = '#ff4d4d';
            btn.textContent = 'Verborgen';
        };
        btn.style.background = '#ff4d4d';
        btn.style.color = 'white';
        btn.onclick = () => {
            const sellerName = btn.dataset.seller;
            showUnblacklistToast(sellerName);
            removeSellerFromBlacklist(sellerName);
        };
    });
}

/**
 * Show a toast notification for blacklisting a term
 */
function showBlacklistTermToast(term) {
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';
    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">🔎</span>
            <div class="cleanplaats-toast-message">
                <strong>'${term}' verborgen</strong>
                <span>Alle advertenties met de term '${term}' zijn nu verborgen.</span>
            </div>
        </div>
    `);
    document.body.appendChild(toast);
    setTimeout(() => { requestAnimationFrame(() => toast.classList.add('visible')); }, 50);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Show a toast notification for unblacklisting a term
 */
function showUnblacklistTermToast(term) {
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';
    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">🔎</span>
            <div class="cleanplaats-toast-message">
                <strong>'${term}' niet meer verborgen</strong>
                <span>Advertenties met de term '${term}' worden weer getoond.</span>
            </div>
        </div>
    `);
    document.body.appendChild(toast);
    setTimeout(() => { requestAnimationFrame(() => toast.classList.add('visible')); }, 50);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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
