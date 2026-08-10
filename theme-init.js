(() => {
    const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
    const DARK_MODE_CLASS = 'cleanplaats-dark-mode';
    const TWH_SITE_CLASS = 'cleanplaats-site-twh';
    const THEME_STORAGE_KEY = 'cleanplaats:darkMode';
    const SORT_STORAGE_KEY = 'cleanplaats:sortMode';
    const STORAGE_KEY = 'cleanplaatsSettings';

    const SORT_PARAMS = {
        date_new_old:  { sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' },
        date_old_new:  { sortBy: 'SORT_INDEX', sortOrder: 'INCREASING' },
        price_low_high: { sortBy: 'PRICE',      sortOrder: 'INCREASING' },
        price_high_low: { sortBy: 'PRICE',      sortOrder: 'DECREASING' },
        distance:       { sortBy: 'LOCATION',   sortOrder: 'INCREASING' }
    };
    const EARLY_STYLE_ID = 'cleanplaats-early-dark-mode';
    /* Marktplaats server-renders <html data-theme="light"> and ships a matching
       dark token set they never exposed a switcher for. Flipping this attribute
       is what actually themes the site; dark-mode.css only patches the gaps.
       Their own scripts never rewrite it, so a plain set/restore is enough. */
    const NATIVE_THEME_ATTR = 'data-theme';
    const nativeThemeDefault = document.documentElement.getAttribute(NATIVE_THEME_ATTR) || 'light';
    /* Marktplaats' native dark theme (html[data-theme="dark"]) covers the modern
       pages before first paint, so this only has to bridge what it never styles:
       the legacy Mijn Marktplaats tables and the skeleton loaders. */
    const EARLY_DARK_MODE_CSS = `
html.cleanplaats-dark-mode .mymp,
html.cleanplaats-dark-mode .mymp .mp-Topbar,
html.cleanplaats-dark-mode .mymp .mp-Tab-bar,
html.cleanplaats-dark-mode .mymp .canvas,
html.cleanplaats-dark-mode .mymp .table.ad-listing-container,
html.cleanplaats-dark-mode .mymp .sticky,
html.cleanplaats-dark-mode .mymp #table-filters,
html.cleanplaats-dark-mode .mymp .table-body,
html.cleanplaats-dark-mode .mymp .row.ad-listing.compact,
html.cleanplaats-dark-mode .mymp .row.ad-listing.compact .cells,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .row,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cells,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cell,
html.cleanplaats-dark-mode .mymp .filter-option.input,
html.cleanplaats-dark-mode .mymp .filter-option.select,
html.cleanplaats-dark-mode .mymp .wrapper.mp-Select.custom,
html.cleanplaats-dark-mode .mymp #tableActionPanel,
html.cleanplaats-dark-mode .mymp #select-all-container,
html.cleanplaats-dark-mode .mymp #scroll-under-top-border,
html.cleanplaats-dark-mode .mymp .overlay-loader.overlayed,
html.cleanplaats-dark-mode .mymp .bubble-help.info {
  background: var(--hz-color--backgroundDefault, #1a1a1a) !important;
  color: var(--hz-color--textPrimary, #e7edf8) !important;
}

html.cleanplaats-dark-mode .mymp .mp-Topbar,
html.cleanplaats-dark-mode .mymp .mp-Tab-bar,
html.cleanplaats-dark-mode .mymp #table-filters,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .row,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cells,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cell,
html.cleanplaats-dark-mode .mymp .row.ad-listing.compact,
html.cleanplaats-dark-mode .mymp #scroll-under-top-border,
html.cleanplaats-dark-mode .mymp .overlay-loader.overlayed,
html.cleanplaats-dark-mode .mymp .bubble-help.info {
  border-color: var(--hz-color--borderDivider, #474746) !important;
}

html.cleanplaats-dark-mode .mymp .query.mp-Input,
html.cleanplaats-dark-mode .mymp select,
html.cleanplaats-dark-mode .mymp input[type="text"] {
  background: var(--hz-color--backgroundSurface, #252524) !important;
  color: var(--hz-color--textPrimary, #e7edf8) !important;
  border: 1px solid var(--hz-color--borderControlsDefault, #929292) !important;
  box-shadow: none !important;
}

html.cleanplaats-dark-mode .mymp .query.mp-Input::placeholder,
html.cleanplaats-dark-mode .mymp input::placeholder {
  color: var(--hz-color--textSecondary, #a8b6c8) !important;
}

html.cleanplaats-dark-mode .mymp .filter-title,
html.cleanplaats-dark-mode .mymp .filter-option.selected,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact span,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact a,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact button,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact label {
  color: var(--hz-color--textPrimary, #e7edf8) !important;
}

html.cleanplaats-dark-mode .Skeleton-noShadow,
html.cleanplaats-dark-mode .Skeleton-border,
html.cleanplaats-dark-mode .Skeleton-base,
html.cleanplaats-dark-mode .Skeleton-base.Skeleton-text,
html.cleanplaats-dark-mode [class*="Skeleton"],
html.cleanplaats-dark-mode [class*="Skeleton-"],
html.cleanplaats-dark-mode .hz-StructuredListing.Skeleton-noShadow,
html.cleanplaats-dark-mode .hz-StructuredListing .hz-StructuredListing-image.Skeleton-border,
html.cleanplaats-dark-mode .hz-StructuredListing .hz-Image-container,
html.cleanplaats-dark-mode .hz-Listing .hz-Image-container {
  background: var(--hz-color--backgroundSurface, #252524) !important;
  background-color: var(--hz-color--backgroundSurface, #252524) !important;
  background-image: none !important;
  border-color: var(--hz-color--borderDivider, #474746) !important;
  box-shadow: none !important;
}

html.cleanplaats-dark-mode .Skeleton-base::before,
html.cleanplaats-dark-mode .Skeleton-base.Skeleton-withAnimation::before,
html.cleanplaats-dark-mode [class*="Skeleton-base"]::before,
html.cleanplaats-dark-mode [class*="Skeleton-withAnimation"]::before {
  background: linear-gradient(
    90deg,
    rgba(37, 37, 36, 0) 0,
    rgba(71, 71, 70, 0.55) 50%,
    rgba(37, 37, 36, 1) 100%
  ) !important;
  background-color: var(--hz-color--backgroundSurface, #252524) !important;
  background-image: linear-gradient(
    90deg,
    rgba(37, 37, 36, 0) 0,
    rgba(71, 71, 70, 0.55) 50%,
    rgba(37, 37, 36, 1) 100%
  ) !important;
}
`;

    function ensureEarlyDarkModeStyle(enabled) {
        const existing = document.getElementById(EARLY_STYLE_ID);

        if (!enabled) {
            existing?.remove();
            return;
        }

        if (existing) {
            return;
        }

        const style = document.createElement('style');
        style.id = EARLY_STYLE_ID;
        style.textContent = EARLY_DARK_MODE_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function syncSiteThemeClass() {
        const isTwhSite = location.hostname.includes('2dehands.be') || location.hostname.includes('2ememain.be');
        document.documentElement.classList.toggle(TWH_SITE_CLASS, isTwhSite);
    }

    function applyDarkMode(enabled) {
        const isEnabled = Boolean(enabled);
        syncSiteThemeClass();
        document.documentElement.classList.toggle(DARK_MODE_CLASS, isEnabled);
        document.documentElement.setAttribute(
            NATIVE_THEME_ATTR,
            isEnabled ? 'dark' : nativeThemeDefault
        );
        ensureEarlyDarkModeStyle(isEnabled);
    }

    function readDarkModePreference() {
        try {
            const storedDarkMode = window.localStorage.getItem(THEME_STORAGE_KEY);
            if (storedDarkMode === 'true' || storedDarkMode === 'false') {
                return storedDarkMode === 'true';
            }
        } catch (error) {
            console.warn('Cleanplaats: Failed to read dark mode from localStorage during startup', error);
        }

        return false;
    }

    function registerStorageSync() {
        if (!browserAPI?.storage?.onChanged?.addListener) {
            return;
        }

        browserAPI.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !changes[STORAGE_KEY]) {
                return;
            }

            try {
                const settings = JSON.parse(changes[STORAGE_KEY].newValue || '{}');
                applyDarkMode(settings?.darkMode);
            } catch (error) {
                console.error('Cleanplaats: Failed to sync startup dark mode', error);
            }
        });
    }

    function applyDefaultSort() {
        try {
            const href = location.href;
            if (!href.includes('/q/') && !href.includes('/l/')) return;

            const sortMode = window.localStorage.getItem(SORT_STORAGE_KEY);
            if (!sortMode || sortMode === 'standard') return;

            const sortConfig = SORT_PARAMS[sortMode];
            if (!sortConfig) return;

            const hash = location.hash.replace('#', '');
            const params = {};
            hash.split('|').forEach(part => {
                const idx = part.indexOf(':');
                if (idx > 0) params[part.slice(0, idx)] = part.slice(idx + 1);
            });

            if (params.sortBy === sortConfig.sortBy && params.sortOrder === sortConfig.sortOrder) return;

            params.sortBy = sortConfig.sortBy;
            params.sortOrder = sortConfig.sortOrder;
            const newHash = '#' + Object.entries(params).map(([k, v]) => `${k}:${v}`).join('|');
            history.replaceState(null, '', location.pathname + location.search + newHash);
        } catch (e) {}
    }

    applyDarkMode(readDarkModePreference());
    applyDefaultSort();
    registerStorageSync();
})();
