import '@/styles/dark-mode.css';
import { EARLY_DARK_MODE_CSS } from '@/content/theme/early-dark-mode-css';
import { LOCAL_STORAGE_KEYS, STORAGE_KEYS } from '@/shared/constants/storage';
import { CLEANPLAATS_DARK_MODE_CLASS, CLEANPLAATS_TWH_SITE_CLASS } from '@/content/constants/ui';

const EARLY_STYLE_ID = 'cleanplaats-early-dark-mode';

const ensureEarlyDarkModeStyle = (enabled: boolean): void => {
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
};

const syncSiteThemeClass = (): void => {
  const isTwhSite =
    location.hostname.includes('2dehands.be') || location.hostname.includes('2ememain.be');
  document.documentElement.classList.toggle(CLEANPLAATS_TWH_SITE_CLASS, isTwhSite);
};

const applyDarkMode = (enabled: boolean): void => {
  const isEnabled = Boolean(enabled);
  syncSiteThemeClass();
  document.documentElement.classList.toggle(CLEANPLAATS_DARK_MODE_CLASS, isEnabled);
  ensureEarlyDarkModeStyle(isEnabled);
};

const readDarkModePreference = (): boolean => {
  try {
    const storedDarkMode = window.localStorage.getItem(LOCAL_STORAGE_KEYS.darkMode);
    if (storedDarkMode === 'true' || storedDarkMode === 'false') {
      return storedDarkMode === 'true';
    }
  } catch (error) {
    console.warn('Cleanplaats: Failed to read dark mode from localStorage during startup', error);
  }

  return false;
};

const registerStorageSync = (): void => {
  if (!browser.storage.onChanged.addListener) {
    return;
  }

  browser.storage.onChanged.addListener(
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !changes[STORAGE_KEYS.settings]) {
        return;
      }

      try {
        const raw = changes[STORAGE_KEYS.settings]?.newValue;
        const settings = typeof raw === 'string' ? (JSON.parse(raw) as { darkMode?: boolean }) : {};
        applyDarkMode(Boolean(settings?.darkMode));
      } catch (error) {
        console.error('Cleanplaats: Failed to sync startup dark mode', error);
      }
    },
  );
};

export default defineContentScript({
  matches: ['*://*.marktplaats.nl/*', '*://*.2dehands.be/*', '*://*.2ememain.be/*'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    applyDarkMode(readDarkModePreference());
    registerStorageSync();
  },
});
