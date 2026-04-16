import {
  CLEANPLAATS_DARK_LOGO_PATH,
  CLEANPLAATS_DARK_MODE_CLASS,
  CLEANPLAATS_FLOATING_OFFSET_VAR,
  CLEANPLAATS_TWH_SITE_CLASS,
  MARKTPLAATS_DESKTOP_LOGO_MATCH,
} from '@/content/constants/ui';
import { is2dehandsFamilySite, isMarktplaatsSite } from '@/content/utils/site';
import { LOCAL_STORAGE_KEYS } from '@/shared/constants/storage';
import type { CleanplaatsSettings } from '@/shared/types/state';

export const persistDarkModePreference = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.darkMode, enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('Cleanplaats: Failed to persist dark mode in localStorage', error);
  }
};

export const syncSiteThemeClass = (): void => {
  document.documentElement.classList.toggle(CLEANPLAATS_TWH_SITE_CLASS, is2dehandsFamilySite());
};

export const getCollapsedPanelIconUrl = (darkMode: boolean): string => {
  const iconPath = darkMode ? 'icons/darkmode_icon_128.png' : 'icons/icon128.png';
  return browser.runtime.getURL(iconPath);
};

export const updateCollapsedPanelIcon = (
  panel: HTMLElement | null,
  settings: CleanplaatsSettings,
): void => {
  if (!panel) return;

  if (panel.classList.contains('collapsed-ready')) {
    panel.style.backgroundImage = `url('${getCollapsedPanelIconUrl(settings.darkMode)}')`;
    return;
  }

  panel.style.backgroundImage = '';
};

export const syncHeaderLogoForDarkMode = (enabled: boolean): void => {
  document.querySelectorAll('.hz-Header-logo-desktop').forEach((img) => {
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
      ? browser.runtime.getURL(CLEANPLAATS_DARK_LOGO_PATH)
      : originalSource;

    if (currentSource !== nextSource) {
      img.setAttribute('src', nextSource);
    }
  });

  document.querySelectorAll('.mp-Header-logo').forEach((link) => {
    if (!(link instanceof HTMLElement)) return;

    if (enabled && isMarktplaatsSite()) {
      link.style.backgroundImage = `url("${browser.runtime.getURL(CLEANPLAATS_DARK_LOGO_PATH)}")`;
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
};

export const applyDarkModeToDocument = (
  enabled: boolean,
  panel: HTMLElement | null,
  settings: CleanplaatsSettings,
): void => {
  const isEnabled = Boolean(enabled);
  syncSiteThemeClass();
  document.documentElement.classList.toggle(CLEANPLAATS_DARK_MODE_CLASS, isEnabled);
  persistDarkModePreference(isEnabled);
  syncHeaderLogoForDarkMode(isEnabled);

  if (panel) {
    panel.classList.toggle(CLEANPLAATS_DARK_MODE_CLASS, isEnabled);
    updateCollapsedPanelIcon(panel, settings);
  }
};

const isElementVisuallyVisible = (element: Element): boolean => {
  if (!(element instanceof Element)) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0
    && rect.height > 0
    && rect.bottom > 0
    && rect.right > 0
    && rect.top < window.innerHeight
    && rect.left < window.innerWidth
  );
};

export const updateFloatingUiOffsetForWebchat = (): void => {
  const webchatToggle = document.querySelector(
    '[data-cognigy-webchat-toggle="true"], #webchatWindowToggleButton',
  );

  let offset = 0;

  if (webchatToggle && isElementVisuallyVisible(webchatToggle)) {
    const rect = webchatToggle.getBoundingClientRect();
    const gap = 16;
    offset = Math.max(0, Math.ceil(rect.height + gap));
  }

  document.documentElement.style.setProperty(CLEANPLAATS_FLOATING_OFFSET_VAR, `${offset}px`);
};

export type WebchatObserverHandle = {
  disconnect: () => void;
};

export const setupWebchatCollisionAvoidance = (
  existing: MutationObserver | null,
): { observer: MutationObserver; handle: WebchatObserverHandle } => {
  updateFloatingUiOffsetForWebchat();

  if (existing) {
    existing.disconnect();
  }

  let rafId = 0;
  const scheduleOffsetUpdate = (): void => {
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
    attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
  });

  window.addEventListener('resize', scheduleOffsetUpdate, { passive: true });

  return {
    observer,
    handle: {
      disconnect: () => {
        observer.disconnect();
        window.removeEventListener('resize', scheduleOffsetUpdate);
      },
    },
  };
};
