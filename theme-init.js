(() => {
    const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
    const DARK_MODE_CLASS = 'cleanplaats-dark-mode';
    const STORAGE_KEY = 'cleanplaatsSettings';
    const EARLY_STYLE_ID = 'cleanplaats-early-dark-mode';
    const EARLY_DARK_MODE_CSS = `
html.cleanplaats-dark-mode,
html.cleanplaats-dark-mode body,
html.cleanplaats-dark-mode .hz-Page,
html.cleanplaats-dark-mode .hz-Page-body,
html.cleanplaats-dark-mode .hz-Page-element,
html.cleanplaats-dark-mode #main-container,
html.cleanplaats-dark-mode #footer-container {
  background: #11161d !important;
  color: #e4ebf3 !important;
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
  background: rgba(31, 42, 54, 0.52) !important;
  background-color: rgba(31, 42, 54, 0.52) !important;
  background-image: none !important;
  border-color: rgba(120, 143, 166, 0.16) !important;
  box-shadow: none !important;
}

html.cleanplaats-dark-mode .Skeleton-base::before,
html.cleanplaats-dark-mode .Skeleton-base.Skeleton-withAnimation::before,
html.cleanplaats-dark-mode [class*="Skeleton-base"]::before,
html.cleanplaats-dark-mode [class*="Skeleton-withAnimation"]::before {
  background: linear-gradient(
    90deg,
    rgba(31, 42, 54, 0) 0,
    rgba(49, 65, 82, 0.45) 50%,
    rgba(31, 42, 54, 0.52) 100%
  ) !important;
  background-color: rgba(31, 42, 54, 0.52) !important;
  background-image: linear-gradient(
    90deg,
    rgba(31, 42, 54, 0) 0,
    rgba(49, 65, 82, 0.45) 50%,
    rgba(31, 42, 54, 0.52) 100%
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

    function applyDarkMode(enabled) {
        const isEnabled = Boolean(enabled);
        document.documentElement.classList.toggle(DARK_MODE_CLASS, isEnabled);
        ensureEarlyDarkModeStyle(isEnabled);
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

    applyDarkMode(true);
    registerStorageSync();
})();
