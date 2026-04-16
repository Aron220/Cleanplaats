import { getState } from '@/content/runtime/store';
import { performCleanup } from '@/content/services/cleanup';
import {
  checkForEmptyPage,
  clearBubbleNotification,
  scheduleSellerAgeWarningCheck,
} from '@/content/services/notifications';
import { injectBlacklistButtons } from '@/content/services/blacklist-inject';
import { syncHeaderLogoForDarkMode } from '@/content/services/theme';
import { wakeUpBackground } from '@/content/services/background-wake';

let lastUrl = location.href;

const performCleanupAndCheckForEmptyPage = (): void => {
  const existingNotification = document.getElementById('cleanplaats-empty-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  clearBubbleNotification();
  scheduleSellerAgeWarningCheck({ resetState: true });

  const checkContentLoaded = window.setInterval(() => {
    if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
      clearInterval(checkContentLoaded);
      console.log('Cleanplaats: Running cleanup after navigation');
      performCleanup(getState());
      injectBlacklistButtons();

      setTimeout(checkForEmptyPage, 500);
    }
  }, 100);
};

export const setupObservers = (): void => {
  const state = getState();

  if (state.observers.mutation) {
    state.observers.mutation.disconnect();
  }

  const observer = new MutationObserver((mutations) => {
    if (lastUrl !== location.href) {
      console.log('Cleanplaats: URL changed from', lastUrl, 'to', location.href);
      lastUrl = location.href;
      state.runtime.lastSellerAgeWarningKey = '';
      performCleanupAndCheckForEmptyPage();
    }

    let shouldCleanup = false;
    let shouldSyncHeaderLogo = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length) {
        const listingMutationTarget =
          mutation.target?.nodeType === Node.ELEMENT_NODE
            ? (mutation.target as Element).closest?.('.hz-Listing')
            : null;

        if (window.innerWidth < 700 && listingMutationTarget) {
          shouldCleanup = true;
          break;
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (
              el.classList?.contains('hz-Header-logo-desktop')
              || el.classList?.contains('mp-Header-logo')
              || el.querySelector?.('.hz-Header-logo-desktop, .mp-Header-logo')
            ) {
              shouldSyncHeaderLogo = true;
            }

            if (
              el.classList?.contains('SellerInfoSmall-root')
              || el.querySelector?.('.SellerInfoSmall-root')
            ) {
              scheduleSellerAgeWarningCheck();
            }

            if (
              el.classList?.contains('hz-Listing')
              || el.querySelector?.('.hz-Listing')
              || el.classList?.contains('MpCard-mpCardBanner')
              || el.querySelector?.('.MpCard-mpCardBanner, img[alt="Marktplaats Marketing Banner"]')
              || el.classList?.contains('SimilarAdsList-related-ads-section')
              || el.querySelector?.('.SimilarAdsList-related-ads-section')
              || el.id === 'notifications-root'
              || el.classList?.contains('NonFeatureBuyerBanner-root')
              || el.classList?.contains('feature-banner')
              || el.querySelector?.(
                '#notifications-root, .NonFeatureBuyerBanner-root, .feature-banner[data-testid="50-percent-off-banner"]',
              )
              || el.id?.includes('ad')
              || el.id === 'similar-items-root'
              || el.querySelector?.(
                '#similar-items-root, .AdmarktSimilarItemsContainer, .AdmarktSimilarItems-root',
              )
              || el.classList?.contains('hz-Banner')
              || el.querySelector?.('[data-google-query-id]')
              || el.classList?.contains('hz-FeedBannerBlock')
              || el.classList?.contains('Banners-bannerFeedItem')
              || el.id === 'banner-top-dt-container'
              || el.querySelector?.('#banner-top-dt, #banner-top-dt-container')
            ) {
              shouldCleanup = true;
              break;
            }
          }
        }
      }

      if (mutation.type === 'attributes') {
        const target = mutation.target as Element;
        if (target?.classList?.contains('SellerInfoSmall-root')) {
          scheduleSellerAgeWarningCheck();
        }

        if (
          target?.classList?.contains('hz-FeedBannerBlock')
          || target?.classList?.contains('Banners-bannerFeedItem')
          || target?.classList?.contains('MpCard-mpCardBanner')
          || target?.classList?.contains('SimilarAdsList-related-ads-section')
          || target?.classList?.contains('NonFeatureBuyerBanner-root')
          || target?.classList?.contains('feature-banner')
          || target?.classList?.contains('AdmarktSimilarItemsContainer')
          || target?.classList?.contains('AdmarktSimilarItems-root')
          || target?.id === 'notifications-root'
          || target?.id === 'similar-items-root'
          || target?.id === 'banner-right-container'
          || target?.id === 'banner-top-dt-container'
        ) {
          shouldCleanup = true;
        }
      }

      if (shouldCleanup) break;
    }

    if (state.settings.darkMode && shouldSyncHeaderLogo) {
      syncHeaderLogoForDarkMode(true);
    }

    if (shouldCleanup) {
      performCleanup(state);
      injectBlacklistButtons();
    }
  });

  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
  });

  state.observers.mutation = observer;
};

const handleNavigation = (): void => {
  wakeUpBackground();
  window.dispatchEvent(new Event('navigation'));
};

export const setupNavigationDetection = (): void => {
  window.addEventListener('popstate', handleNavigation);

  const originalPushState = history.pushState;
  history.pushState = function pushStateWithHook(...args: Parameters<History['pushState']>) {
    originalPushState.apply(this, args);
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function replaceStateWithHook(
    ...args: Parameters<History['replaceState']>
  ) {
    originalReplaceState.apply(this, args);
  };

  document.addEventListener('click', (e) => {
    const link = (e.target as Element | null)?.closest?.('a[href]');
    if (link instanceof HTMLAnchorElement && link.hostname === window.location.hostname) {
      setTimeout(() => handleNavigation(), 100);
    }
  });
};

export const setupAllObservers = (): void => {
  setupObservers();
  setupNavigationDetection();
};
