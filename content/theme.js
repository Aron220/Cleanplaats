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

function syncSiteThemeClass() {
    document.documentElement.classList.toggle(CLEANPLAATS_TWH_SITE_CLASS, is2dehandsFamilySite());
}

function syncCleanplaatsSortMode(sortMode) {
    if (!sortMode) return;

    // Picking a sort in Marktplaats' own dropdown adopts it as the Cleanplaats
    // default, so it keeps being applied on later navigations too.
    if (CLEANPLAATS.settings.defaultSortMode === sortMode) return;

    CLEANPLAATS.settings.defaultSortMode = sortMode;

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
    syncSiteThemeClass();
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

/* hz-web-ui ships its SVG assets as background-image rules on
   .hz-SvgAsset.hz-SvgAsset<Name> classes, and the filenames carry a build hash we
   cannot predict. Rendering a throwaway element with the class and reading back the
   computed background-image lets the page resolve the current hashed URL for us,
   which keeps working across their rebuilds. getComputedStyle stays readable on a
   cross-origin stylesheet, unlike cssRules, so this needs no extra permissions. */
const cleanplaatsNativeAssetUrls = new Map();

function resolveNativeSvgAssetUrl(assetClass) {
    if (cleanplaatsNativeAssetUrls.has(assetClass)) {
        return cleanplaatsNativeAssetUrls.get(assetClass);
    }

    let assetUrl = '';

    try {
        const probe = document.createElement('span');
        probe.className = `hz-SvgAsset ${assetClass}`;
        probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden';

        const host = document.body || document.documentElement;
        host.appendChild(probe);
        const backgroundImage = window.getComputedStyle(probe).backgroundImage;
        probe.remove();

        const match = backgroundImage.match(/url\(["']?(.+?)["']?\)/);
        if (match) {
            assetUrl = match[1];
        }
    } catch (error) {
        console.warn('Cleanplaats: Failed to resolve native SVG asset', assetClass, error);
    }

    // An empty result usually means their stylesheet has not landed yet, so don't
    // cache it: a later call on the same page should get another chance.
    if (assetUrl) {
        cleanplaatsNativeAssetUrls.set(assetClass, assetUrl);
    }

    return assetUrl;
}

function getTwhInverseWordmarkUrl() {
    return resolveNativeSvgAssetUrl(`hz-SvgAssetBrandLogo--inverse--${getTwhBrandLocaleSuffix()}`);
}

/* Marktplaats never published a dark wordmark, so we ship our own. 2dehands and
   2ememain do publish one (brand-logo--inverse--nlbe/frbe: the navy lettering turned
   white, yellow coin untouched); they just never use it on the website. Their own
   dark theme leaves the light logo in place, so the wordmark ends up navy on a dark
   header. Only the desktop wordmark needs this: the mobile coin logo is already
   yellow, and its "inverse" variant is the navy-on-yellow one, which would be worse. */
function getDarkHeaderLogoUrl(originalSource) {
    if (MARKTPLAATS_DESKTOP_LOGO_MATCH.test(originalSource)) {
        return browserAPI.runtime.getURL(CLEANPLAATS_DARK_LOGO_PATH);
    }

    if (TWH_DESKTOP_LOGO_MATCH.test(originalSource)) {
        return getTwhInverseWordmarkUrl();
    }

    return '';
}

function syncHeaderLogoForDarkMode(enabled) {
    document.querySelectorAll('.hz-Header-logo-desktop').forEach(img => {
        if (!(img instanceof HTMLImageElement)) return;

        const currentSource = img.getAttribute('src') || '';
        const originalSource = img.dataset.cleanplaatsOriginalSrc || currentSource;

        if (!img.dataset.cleanplaatsOriginalSrc) {
            img.dataset.cleanplaatsOriginalSrc = currentSource;
        }

        const darkSource = enabled ? getDarkHeaderLogoUrl(originalSource) : '';

        // No dark counterpart (an unknown logo, or their stylesheet has not loaded
        // yet) means leaving the current one alone rather than blanking it.
        if (enabled && !darkSource) {
            return;
        }

        const nextSource = enabled ? darkSource : originalSource;

        if (currentSource !== nextSource) {
            img.setAttribute('src', nextSource);
        }
    });

    document.querySelectorAll('.mp-Header-logo').forEach(link => {
        if (!(link instanceof HTMLElement)) return;

        // The legacy "Mijn Marktplaats"/"Mijn 2dehands" header paints its logo as a
        // background image instead of an <img>.
        let legacyLogoUrl = '';
        if (enabled && isMarktplaatsSite()) {
            legacyLogoUrl = browserAPI.runtime.getURL(CLEANPLAATS_DARK_LOGO_PATH);
        } else if (enabled && is2dehandsFamilySite()) {
            legacyLogoUrl = getTwhInverseWordmarkUrl();
        }

        if (legacyLogoUrl) {
            link.style.backgroundImage = `url("${legacyLogoUrl}")`;
            link.style.backgroundRepeat = 'no-repeat';
            link.style.backgroundPosition = 'center';
            link.style.backgroundSize = 'contain';
            return;
        }

        link.style.removeProperty('background-image');
        link.style.removeProperty('background-repeat');
        link.style.removeProperty('background-position');
        link.style.removeProperty('background-size');
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
