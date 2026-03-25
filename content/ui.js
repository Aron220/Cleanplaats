/**
 * Content-script control panel rendering and UI event handling.
 */

function createControlPanel() {
    if (document.getElementById('cleanplaats-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'cleanplaats-panel';
    panel.className = 'cleanplaats-panel';
    panel.classList.toggle(CLEANPLAATS_DARK_MODE_CLASS, CLEANPLAATS.settings.darkMode);

    if (CLEANPLAATS.featureFlags.autoCollapse || CLEANPLAATS.panelState.isCollapsed) {
        panel.classList.add('collapsed');
        panel.classList.add('collapsed-ready');
        updateCollapsedPanelIcon(panel);
    }

    const panelText = getPanelLocaleText();
    const reviewCTA = getReviewCTAConfig();

    panel.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-header" id="cleanplaats-header">
            <div class="cleanplaats-header-main">
                <h3>
                    <img id="cleanplaats-header-logo" class="cleanplaats-header-logo" alt="Cleanplaats logo" />
                    Cleanplaats
                    <!-- Total removed badge disabled for now.
                    <span class="cleanplaats-badge" id="cleanplaats-total-count">0</span>
                    -->
                </h3>
                <div class="cleanplaats-header-actions">
                    <button
                        id="cleanplaats-theme-toggle"
                        class="cleanplaats-theme-toggle"
                        type="button"
                        role="switch"
                        aria-label="${panelText.darkModeLabel}"
                        aria-checked="${CLEANPLAATS.settings.darkMode ? 'true' : 'false'}"
                        aria-pressed="${CLEANPLAATS.settings.darkMode ? 'true' : 'false'}"
                        data-theme="${CLEANPLAATS.settings.darkMode ? 'dark' : 'light'}"
                        title="${panelText.darkModeTooltip}"
                    >
                        <span class="cleanplaats-theme-toggle-track" aria-hidden="true">
                            <span class="cleanplaats-theme-toggle-icon cleanplaats-theme-toggle-icon-moon">
                                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                    <path d="M14.8 2.2a.75.75 0 0 1 .79 1.07A8.25 8.25 0 1 0 20.73 8.4a.75.75 0 0 1 1.07.79A9.75 9.75 0 1 1 14.8 2.2Z" fill="currentColor"></path>
                                </svg>
                            </span>
                            <span class="cleanplaats-theme-toggle-icon cleanplaats-theme-toggle-icon-sun">
                                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                    <circle cx="12" cy="12" r="4.25" fill="currentColor"></circle>
                                    <path d="M12 1.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm0 17.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm10.25-7.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 .75.75ZM4.5 12.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 0 1.5Zm14.42 6.73a.75.75 0 0 1-1.06 0l-1.42-1.41a.75.75 0 0 1 1.06-1.06l1.42 1.41a.75.75 0 0 1 0 1.06Zm-11.36-11.36a.75.75 0 0 1-1.06 0L5.08 6.7a.75.75 0 1 1 1.06-1.06l1.42 1.42a.75.75 0 0 1 0 1.06Zm0 9.94-1.42 1.41a.75.75 0 1 1-1.06-1.06l1.42-1.41a.75.75 0 0 1 1.06 1.06Zm11.36-11.36-1.42 1.42a.75.75 0 0 1-1.06-1.06l1.42-1.42a.75.75 0 1 1 1.06 1.06Z" fill="currentColor"></path>
                                </svg>
                            </span>
                            <span class="cleanplaats-theme-toggle-thumb">
                                <span class="cleanplaats-theme-toggle-thumb-icon cleanplaats-theme-toggle-thumb-icon-moon">
                                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                        <path d="M14.8 2.2a.75.75 0 0 1 .79 1.07A8.25 8.25 0 1 0 20.73 8.4a.75.75 0 0 1 1.07.79A9.75 9.75 0 1 1 14.8 2.2Z" fill="currentColor"></path>
                                    </svg>
                                </span>
                                <span class="cleanplaats-theme-toggle-thumb-icon cleanplaats-theme-toggle-thumb-icon-sun">
                                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                        <circle cx="12" cy="12" r="4.25" fill="currentColor"></circle>
                                        <path d="M12 1.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm0 17.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm10.25-7.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 .75.75ZM4.5 12.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 0 1.5Zm14.42 6.73a.75.75 0 0 1-1.06 0l-1.42-1.41a.75.75 0 0 1 1.06-1.06l1.42 1.41a.75.75 0 0 1 0 1.06Zm-11.36-11.36a.75.75 0 0 1-1.06 0L5.08 6.7a.75.75 0 1 1 1.06-1.06l1.42 1.42a.75.75 0 0 1 0 1.06Zm0 9.94-1.42 1.41a.75.75 0 1 1-1.06-1.06l1.42-1.41a.75.75 0 0 1 1.06 1.06Zm11.36-11.36-1.42 1.42a.75.75 0 0 1-1.06-1.06l1.42-1.42a.75.75 0 1 1 1.06 1.06Z" fill="currentColor"></path>
                                    </svg>
                                </span>
                            </span>
                        </span>
                    </button>
                    <button id="cleanplaats-toggle" class="cleanplaats-toggle" type="button" aria-label="Paneel inklappen of uitklappen">▲</button>
                </div>
            </div>
            <div class="cleanplaats-contact-grid">
                <a
                    href="https://github.com/Aron220/Cleanplaats/issues"
                    class="cleanplaats-contact cleanplaats-external-link"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="${panelText.feedbackAriaLabel}"
                >
                    <span class="cleanplaats-contact-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.9.58.1.79-.25.79-.56v-2.17c-3.2.69-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.76 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.47.11-3.07 0 0 .97-.31 3.18 1.18a10.96 10.96 0 0 1 5.8 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.6.23 2.78.11 3.07.73.8 1.18 1.82 1.18 3.08 0 4.42-2.68 5.4-5.24 5.68.41.35.78 1.04.78 2.1v3.11c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"></path>
                        </svg>
                    </span>
                    <span class="cleanplaats-contact-copy">
                        <span class="cleanplaats-contact-title">${panelText.feedbackLabel}</span>
                        <span class="cleanplaats-contact-text">${panelText.feedbackText}</span>
                    </span>
                </a>
                <a
                    href="${reviewCTA.url}"
                    class="cleanplaats-contact cleanplaats-external-link"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="${panelText.reviewAriaLabel(reviewCTA.linkLabel)}"
                >
                    <span class="cleanplaats-contact-icon" aria-hidden="true">★</span>
                    <span class="cleanplaats-contact-copy">
                        <span class="cleanplaats-contact-title">Review</span>
                        <span class="cleanplaats-contact-text">${reviewCTA.linkLabel}</span>
                    </span>
                </a>
            </div>
        </div>
        <div class="cleanplaats-content">
            <a
                href="https://buymeacoffee.com/cleanplaats"
                class="cleanplaats-bmc-button"
                target="_blank"
                rel="noopener"
                title="${panelText.supportTitle}"
            >
                <span class="cleanplaats-bmc-emoji">☕</span>
                <span class="cleanplaats-bmc-text">${panelText.supportButton}</span>
            </a>
            <div class="cleanplaats-options">
                <div class="cleanplaats-section-title">${panelText.optionsTitle}</div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removeTopAds" ${CLEANPLAATS.settings.removeTopAds ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removeTopAds" class="cleanplaats-option-label">
                        ${panelText.topAdLabel}
                        <span class="cleanplaats-tooltip-icon" data-tooltip="${panelText.topAdTooltip}">?</span>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removeDagtoppers" ${CLEANPLAATS.settings.removeDagtoppers ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removeDagtoppers" class="cleanplaats-option-label">
                        ${panelText.dagtoppersLabel}
                        <span class="cleanplaats-tooltip-icon" data-tooltip="${panelText.dagtoppersTooltip}">?</span>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removePromotedListings" ${CLEANPLAATS.settings.removePromotedListings ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removePromotedListings" class="cleanplaats-option-label">
                        ${panelText.promotedListingsLabel}
                        <span class="cleanplaats-tooltip-icon" data-tooltip="${panelText.promotedListingsTooltip}">?</span>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removeOpvalStickers" ${CLEANPLAATS.settings.removeOpvalStickers ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removeOpvalStickers" class="cleanplaats-option-label">
                        ${panelText.stickersLabel}
                        <span class="cleanplaats-tooltip-icon" data-tooltip="${panelText.stickersTooltip}">?</span>
                    </label>
                </div>
                <div class="cleanplaats-option">
                    <label class="cleanplaats-switch">
                        <input type="checkbox" id="removeReservedListings" ${CLEANPLAATS.settings.removeReservedListings ? 'checked' : ''}>
                        <span class="cleanplaats-switch-slider"></span>
                    </label>
                    <label for="removeReservedListings" class="cleanplaats-option-label">
                        ${panelText.reservedLabel}
                        <span class="cleanplaats-tooltip-icon" data-tooltip="${panelText.reservedTooltip}">?</span>
                    </label>
                </div>
                <div class="cleanplaats-option cleanplaats-results-dropdown-row">
                    <label for="cleanplaats-results-dropdown" class="cleanplaats-option-label" style="min-width:120px;">${panelText.resultsPerPageLabel}</label>
                    <select id="cleanplaats-results-dropdown" class="cleanplaats-results-dropdown">
                        <option value="30" ${CLEANPLAATS.settings.resultsPerPage == 30 ? 'selected' : ''}>30</option>
                        <option value="50" ${CLEANPLAATS.settings.resultsPerPage == 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${CLEANPLAATS.settings.resultsPerPage == 100 ? 'selected' : ''}>100</option>
                    </select>
                </div>
                <div class="cleanplaats-option cleanplaats-results-dropdown-row">
                    <label for="cleanplaats-sort-dropdown" class="cleanplaats-option-label" style="min-width:120px;">${panelText.defaultSortLabel}</label>
                    <select id="cleanplaats-sort-dropdown" class="cleanplaats-results-dropdown">
                        <option value="standard" ${CLEANPLAATS.settings.defaultSortMode == 'standard' ? 'selected' : ''}>${panelText.sortOptions.standard}</option>
                        <option value="date_new_old" ${CLEANPLAATS.settings.defaultSortMode == 'date_new_old' ? 'selected' : ''}>${panelText.sortOptions.date_new_old}</option>
                        <option value="date_old_new" ${CLEANPLAATS.settings.defaultSortMode == 'date_old_new' ? 'selected' : ''}>${panelText.sortOptions.date_old_new}</option>
                        <option value="price_low_high" ${CLEANPLAATS.settings.defaultSortMode == 'price_low_high' ? 'selected' : ''}>${panelText.sortOptions.price_low_high}</option>
                        <option value="price_high_low" ${CLEANPLAATS.settings.defaultSortMode == 'price_high_low' ? 'selected' : ''}>${panelText.sortOptions.price_high_low}</option>
                        <option value="distance" ${CLEANPLAATS.settings.defaultSortMode == 'distance' ? 'selected' : ''}>${panelText.sortOptions.distance}</option>
                    </select>
                </div>
            </div>

            ${CLEANPLAATS.featureFlags.showStats ? `
            <div class="cleanplaats-stats cleanplaats-stats-compact" id="cleanplaats-stats">
                <div class="cleanplaats-section-title">${panelText.statsTitle}</div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">${panelText.statsTop}</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-topads-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">${panelText.statsDagtoppers}</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-dagtoppers-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">${panelText.statsBusiness}</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-promoted-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">${panelText.statsStickers}</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-stickers-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">${panelText.statsOther}</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-otherads-count">0</span>
                </div>
                <div class="cleanplaats-stat-item">
                    <span class="cleanplaats-stat-label">${panelText.statsTotal}</span>
                    <span class="cleanplaats-stat-value" id="cleanplaats-total-count-stats">0</span>
                </div>
            </div>
            ` : ''}

            <button id="cleanplaats-manage-terms" class="cleanplaats-button cleanplaats-blacklist-manage-btn">${panelText.manageTerms}</button>
            <button id="cleanplaats-manage-blacklist" class="cleanplaats-button cleanplaats-blacklist-manage-btn">${panelText.manageSellers}</button>
            <div id="cleanplaats-blacklist-modal" class="cleanplaats-blacklist-modal" style="display:none;"></div>
            <div id="cleanplaats-terms-modal" class="cleanplaats-terms-modal" style="display:none;"></div>
        </div>
    `);

    document.body.appendChild(panel);
    const logoImg = panel.querySelector('#cleanplaats-header-logo');
    if (logoImg) {
        logoImg.src = browserAPI.runtime.getURL('icons/icon128.png');
    }
    panel.querySelectorAll('.cleanplaats-external-link').forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            window.open(link.href, '_blank', 'noopener,noreferrer');
        });
    });
    setupEventListeners();
    syncDarkModeToggle(CLEANPLAATS.settings.darkMode);

    document.getElementById('cleanplaats-manage-blacklist').addEventListener('click', (e) => {
        e.preventDefault();
        showBlacklistModal();
    });

    document.getElementById('cleanplaats-manage-terms').addEventListener('click', (e) => {
        e.preventDefault();
        showTermsModal();
    });

    if (!document.getElementById('cleanplaats-global-tooltip')) {
        const tooltip = document.createElement('div');
        tooltip.id = 'cleanplaats-global-tooltip';
        tooltip.className = 'cleanplaats-global-tooltip';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);
    }

    setupGlobalTooltip();
}

function setupGlobalTooltip() {
    const tooltip = document.getElementById('cleanplaats-global-tooltip');
    if (!tooltip) return;
    document.querySelectorAll('.cleanplaats-tooltip-icon').forEach(icon => {
        icon.addEventListener('mouseenter', function () {
            const text = icon.getAttribute('data-tooltip');
            if (!text) return;
            tooltip.textContent = text;
            tooltip.style.display = 'block';
            const rect = icon.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
            left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
            let top = rect.top - tooltipRect.height - 8;
            if (top < 8) {
                top = rect.bottom + 8;
            }
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            tooltip.style.opacity = '1';
        });
        icon.addEventListener('mouseleave', function () {
            tooltip.style.opacity = '0';
            tooltip.style.display = 'none';
        });
    });
}

function setupEventListeners() {
    const panel = document.getElementById('cleanplaats-panel');
    const toggle = document.getElementById('cleanplaats-toggle');

    if (panel) {
        panel.addEventListener('click', (e) => {
            if (panel.classList.contains('animating')) {
                return;
            }

            const isPanelCollapsed = panel.classList.contains('collapsed');
            let canToggle = false;

            if (isPanelCollapsed) {
                if (e.target === panel) {
                    canToggle = true;
                }
            } else {
                const header = document.getElementById('cleanplaats-header');
                if (header && header.contains(e.target)) {
                    if (
                        e.target.id === 'cleanplaats-toggle' ||
                        !e.target.closest('input, button, a, .cleanplaats-tooltip, .cleanplaats-switch')
                    ) {
                        canToggle = true;
                    }
                }
            }

            if (canToggle) {
                e.preventDefault();
                e.stopPropagation();

                const blacklistModal = document.getElementById('cleanplaats-blacklist-modal');
                const termsModal = document.getElementById('cleanplaats-terms-modal');
                if (blacklistModal && blacklistModal.style.display === 'block') {
                    blacklistModal.style.display = 'none';
                }
                if (termsModal && termsModal.style.display === 'block') {
                    termsModal.style.display = 'none';
                }

                panel.classList.remove('collapsed-ready');
                updateCollapsedPanelIcon(panel);
                panel.classList.add('animating');

                CLEANPLAATS.panelState.isCollapsed = !CLEANPLAATS.panelState.isCollapsed;
                panel.classList.toggle('collapsed', CLEANPLAATS.panelState.isCollapsed);

                if (toggle) {
                    toggle.textContent = CLEANPLAATS.panelState.isCollapsed ? '▲' : '▼';
                }

                const fallbackTimeout = setTimeout(() => {
                    panel.classList.remove('animating');
                    if (CLEANPLAATS.panelState.isCollapsed) {
                        panel.classList.add('collapsed-ready');
                        updateCollapsedPanelIcon(panel);
                    }
                }, 600);

                const onTransitionEnd = (event) => {
                    if (CLEANPLAATS.panelState.isCollapsed && event.propertyName === 'width') {
                        panel.classList.add('collapsed-ready');
                        updateCollapsedPanelIcon(panel);
                        panel.classList.remove('animating');
                        panel.removeEventListener('transitionend', onTransitionEnd);
                        clearTimeout(fallbackTimeout);
                    } else if (!CLEANPLAATS.panelState.isCollapsed && event.propertyName === 'max-height') {
                        panel.classList.remove('animating');
                        updateCollapsedPanelIcon(panel);
                        panel.removeEventListener('transitionend', onTransitionEnd);
                        clearTimeout(fallbackTimeout);
                    }
                };
                panel.addEventListener('transitionend', onTransitionEnd);

                saveSettings();
            }
        });
    }

    ['removeTopAds', 'removeDagtoppers', 'removePromotedListings',
        'removeOpvalStickers', 'removeReservedListings'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.addEventListener('change', handleCheckboxChange);
        }
    });

    const themeToggle = document.getElementById('cleanplaats-theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', handleThemeToggle);
        themeToggle.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handleThemeToggle();
        });
    }

    setupResultsDropdownListener();
    setupSortDropdownListener();
    setupMarketplaceSortSync();
}

function handleThemeToggle() {
    const nextValue = !CLEANPLAATS.settings.darkMode;
    CLEANPLAATS.settings.darkMode = nextValue;
    applyDarkModeToDocument(nextValue);
    syncDarkModeToggle(nextValue);

    saveSettings()
        .then(() => {
            showSettingFeedback();
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to apply dark mode', error);
            CLEANPLAATS.settings.darkMode = !nextValue;
            applyDarkModeToDocument(!nextValue);
            syncDarkModeToggle(!nextValue);
        });
}

function handleCheckboxChange(event) {
    const setting = event.target.id;
    const value = event.target.checked;

    CLEANPLAATS.settings[setting] = value;

    saveSettings()
        .then(() => {
            if (setting === 'darkMode') {
                applyDarkModeToDocument(value);
                showSettingFeedback();
                return;
            }

            resetPreviousChanges();
            performCleanup();

            clearBubbleNotification();
            showSettingFeedback();
            checkForEmptyPage();
            updateStatsDisplay();
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to apply setting', error);
            event.target.checked = !value;
            if (setting === 'darkMode') {
                CLEANPLAATS.settings[setting] = !value;
                applyDarkModeToDocument(!value);
            }
        });
}

function applySettings() {
    saveSettings()
        .then(() => {
            applyDarkModeToDocument(CLEANPLAATS.settings.darkMode);
            resetPreviousChanges();
            performCleanup();
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to apply settings', error);
        });
}

function setupResultsDropdownListener() {
    const dropdown = document.getElementById('cleanplaats-results-dropdown');
    if (!dropdown) return;

    dropdown.addEventListener('change', (e) => {
        const value = parseInt(e.target.value, 10);

        CLEANPLAATS.settings.resultsPerPage = value;
        wakeUpBackground();

        saveSettings().then(() => {
            showSettingFeedback();

            if (isSearchResultsPage()) {
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        });
    });
}

function setupSortDropdownListener() {
    const dropdown = document.getElementById('cleanplaats-sort-dropdown');
    if (!dropdown) return;

    dropdown.addEventListener('change', (e) => {
        const value = e.target.value;

        CLEANPLAATS.settings.defaultSortMode = value;
        CLEANPLAATS.settings.sortPreferenceSource = 'cleanplaats';
        wakeUpBackground();

        saveSettings().then(() => {
            showSettingFeedback();

            if (isSearchResultsPage()) {
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        });
    });
}
