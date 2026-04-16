import { isSearchResultsPage } from '@/content/utils/site';

declare global {
  interface Window {
    cleanplaatsWakeUpTimeout?: number;
  }
}

export const wakeUpBackground = (): void => {
  try {
    browser.runtime.sendMessage({ action: 'keepAlive' }, (response: unknown) => {
      if (browser.runtime.lastError) {
        console.log(
          'Cleanplaats: Background script not responding, this is normal if it was sleeping',
        );
        setTimeout(() => {
          try {
            browser.runtime.sendMessage({ action: 'forceRefresh' }, () => {
              if (!browser.runtime.lastError) {
                console.log('Cleanplaats: Background script force-refreshed successfully');
              }
            });
          } catch (e) {
            console.log('Cleanplaats: Force refresh also failed:', e);
          }
        }, 100);
      } else {
        console.log('Cleanplaats: Background script is awake', response);
      }
    });
  } catch (error) {
    console.log('Cleanplaats: Could not wake background script:', error);
  }
};

export const setupPeriodicWakeUp = (): void => {
  if (typeof browser === 'undefined') return;

  console.log('Cleanplaats: Setting up periodic background wake-up for Firefox');

  setInterval(() => {
    if (isSearchResultsPage()) {
      wakeUpBackground();
    }
  }, 30000);

  ['click', 'scroll', 'keydown'].forEach((eventType) => {
    document.addEventListener(
      eventType,
      () => {
        if (isSearchResultsPage()) {
          clearTimeout(window.cleanplaatsWakeUpTimeout);
          window.cleanplaatsWakeUpTimeout = window.setTimeout(wakeUpBackground, 1000);
        }
      },
      { passive: true },
    );
  });
};
