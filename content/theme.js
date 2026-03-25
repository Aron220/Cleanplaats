/**
 * Content-script dark mode and sort synchronization helpers.
 */

function persistDarkModePreference(enabled) {
    try {
        window.localStorage.setItem(CLEANPLAATS_THEME_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (error) {
        console.warn('Cleanplaats: Failed to persist dark mode in localStorage', error);
    }
}

function syncCleanplaatsSortMode(sortMode) {
    if (!sortMode) return;

    const modeChanged = CLEANPLAATS.settings.defaultSortMode !== sortMode;
    const sourceChanged = CLEANPLAATS.settings.sortPreferenceSource !== 'marketplace';
    if (!modeChanged && !sourceChanged) return;

    CLEANPLAATS.settings.defaultSortMode = sortMode;
    CLEANPLAATS.settings.sortPreferenceSource = 'marketplace';

    const cleanplaatsDropdown = document.getElementById('cleanplaats-sort-dropdown');
    if (cleanplaatsDropdown && cleanplaatsDropdown.value !== sortMode) {
        cleanplaatsDropdown.value = sortMode;
    }

    wakeUpBackground();
    saveSettings().catch(error => {
        console.error('Cleanplaats: Failed to sync sort mode from page selection', error);
    });
}

function setupMarketplaceSortSync() {
    if (document.body?.dataset.cleanplaatsSortSyncBound === 'true') return;
    if (document.body) {
        document.body.dataset.cleanplaatsSortSyncBound = 'true';
    }

    document.addEventListener('change', (event) => {
        const target = event.target;
        if (!isMarketplaceSortDropdown(target)) return;

        const selectedOption = target.options[target.selectedIndex];
        const sortMode = getSortModeFromLabel(selectedOption?.textContent || target.value);
        syncCleanplaatsSortMode(sortMode);
    }, true);
}

function applyDarkModeToDocument(enabled) {
    const isEnabled = Boolean(enabled);
    document.documentElement.classList.toggle(CLEANPLAATS_DARK_MODE_CLASS, isEnabled);
    persistDarkModePreference(isEnabled);
    syncHeaderLogoForDarkMode(isEnabled);

    const panel = document.getElementById('cleanplaats-panel');
    if (panel) {
        panel.classList.toggle(CLEANPLAATS_DARK_MODE_CLASS, isEnabled);
        updateCollapsedPanelIcon(panel);
    }
}

function getCollapsedPanelIconUrl() {
    const iconPath = CLEANPLAATS.settings.darkMode ? 'icons/darkmode_icon_128.png' : 'icons/icon128.png';
    return browserAPI.runtime.getURL(iconPath);
}

function syncHeaderLogoForDarkMode(enabled) {
    document.querySelectorAll('.hz-Header-logo-desktop').forEach(img => {
        if (!(img instanceof HTMLImageElement)) return;

        const currentSource = img.getAttribute('src') || '';
        const originalSource = img.dataset.cleanplaatsOriginalSrc || currentSource;

        if (!img.dataset.cleanplaatsOriginalSrc) {
            img.dataset.cleanplaatsOriginalSrc = currentSource;
        }

        if (!MARKTPLAATS_DESKTOP_LOGO_MATCH.test(originalSource)) {
            return;
        }

        const nextSource = enabled
            ? browserAPI.runtime.getURL(CLEANPLAATS_DARK_LOGO_PATH)
            : originalSource;

        if (currentSource !== nextSource) {
            img.setAttribute('src', nextSource);
        }
    });
}

function updateCollapsedPanelIcon(panel = document.getElementById('cleanplaats-panel')) {
    if (!panel) return;

    if (panel.classList.contains('collapsed-ready')) {
        panel.style.backgroundImage = `url('${getCollapsedPanelIconUrl()}')`;
        return;
    }

    panel.style.backgroundImage = '';
}

function syncDarkModeToggle(enabled) {
    const toggle = document.getElementById('cleanplaats-theme-toggle');
    if (!toggle) return;

    const isEnabled = Boolean(enabled);
    toggle.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
    toggle.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
    toggle.dataset.theme = isEnabled ? 'dark' : 'light';
}

function isElementVisuallyVisible(element) {
    if (!(element instanceof Element)) return false;

    const style = window.getComputedStyle(element);
    if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
    ) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
}

function updateFloatingUiOffsetForWebchat() {
    const webchatToggle = document.querySelector(
        '[data-cognigy-webchat-toggle="true"], #webchatWindowToggleButton'
    );

    let offset = 0;

    if (isElementVisuallyVisible(webchatToggle)) {
        const rect = webchatToggle.getBoundingClientRect();
        const gap = 16;
        offset = Math.max(0, Math.ceil(rect.height + gap));
    }

    document.documentElement.style.setProperty(CLEANPLAATS_FLOATING_OFFSET_VAR, `${offset}px`);
}

function setupWebchatCollisionAvoidance() {
    updateFloatingUiOffsetForWebchat();

    if (CLEANPLAATS.observers.webchat) {
        CLEANPLAATS.observers.webchat.disconnect();
    }

    let rafId = 0;
    const scheduleOffsetUpdate = () => {
        if (rafId) return;
        rafId = window.requestAnimationFrame(() => {
            rafId = 0;
            updateFloatingUiOffsetForWebchat();
        });
    };

    const observer = new MutationObserver(scheduleOffsetUpdate);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden']
    });

    window.addEventListener('resize', scheduleOffsetUpdate, { passive: true });
    CLEANPLAATS.observers.webchat = observer;
}
