import { bindBlacklistRepository, injectBlacklistButtons } from '@/content/services/blacklist-inject';
import { wakeUpBackground, setupPeriodicWakeUp } from '@/content/services/background-wake';
import {
  performCleanup,
  performInitialCleanup,
  removePersistentGoogleAds,
  resetPreviousChanges,
} from '@/content/services/cleanup';
import {
  bindNotificationsRepository,
  checkForEmptyPage,
  getExtensionVersion,
  showOnboarding,
  scheduleSellerAgeWarningCheck,
} from '@/content/services/notifications';
import { setupAllObservers } from '@/content/services/observers';
import { setupMarketplaceSortSync } from '@/content/services/sort-sync';
import { applyDarkModeToDocument, setupWebchatCollisionAvoidance } from '@/content/services/theme';
import {
  getState,
  loadInitialState,
  patchSettings,
  registerSettingsStorageSync,
  saveSettings,
} from '@/content/runtime/store';
import { mountControlPanel } from '@/content/panel/mount';
import { SettingsRepository } from '@/shared/storage/repository';

const applyDarkModeFromSync = (enabled: boolean): void => {
  patchSettings({ darkMode: enabled });
  const panel = document.getElementById('cleanplaats-panel');
  applyDarkModeToDocument(enabled, panel, getState().settings);
};

export const initCleanplaats = async (): Promise<void> => {
  console.log('Cleanplaats: Initializing...');

  const repository = new SettingsRepository();
  bindNotificationsRepository(repository);
  bindBlacklistRepository(repository);

  await loadInitialState(repository);

  applyDarkModeToDocument(getState().settings.darkMode, null, getState().settings);

  registerSettingsStorageSync(applyDarkModeFromSync);

  wakeUpBackground();
  setupPeriodicWakeUp();

  const currentVersion = getExtensionVersion();

  mountControlPanel({
    repository,
    onMounted: (panel) => {
      applyDarkModeToDocument(getState().settings.darkMode, panel, getState().settings);
    },
  });

  const stateAfterMount = getState();
  const { observer: webchatObserver } = setupWebchatCollisionAvoidance(stateAfterMount.observers.webchat);
  stateAfterMount.observers.webchat = webchatObserver;

  setupAllObservers();
  setupMarketplaceSortSync(repository);

  void saveSettings(repository)
    .then(() => {
      applyDarkModeToDocument(
        getState().settings.darkMode,
        document.getElementById('cleanplaats-panel'),
        getState().settings,
      );
      resetPreviousChanges(getState());
      performCleanup(getState());
    })
    .catch((error) => {
      console.error('Cleanplaats: Failed to apply settings', error);
    });

  scheduleSellerAgeWarningCheck({ resetState: true });
  showOnboarding(currentVersion);

  const tryCleanup = (): void => {
    if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
      performInitialCleanup(getState());
      injectBlacklistButtons();
      setTimeout(checkForEmptyPage, 300);

      let attempts = 0;
      const maxAttempts = 10;
      const interval = window.setInterval(() => {
        removePersistentGoogleAds(getState());

        document.querySelectorAll('#banner-top-dt').forEach((banner) => {
          if (banner.parentNode) {
            banner.parentNode.removeChild(banner);
          }
        });

        document.body.offsetHeight;
        attempts++;
        if (
          (!document.querySelector('#banner-right-container')
            && !document.querySelector('#banner-top-dt'))
          || attempts >= maxAttempts
        ) {
          clearInterval(interval);
        }
      }, 80);
    } else {
      setTimeout(tryCleanup, 60);
    }
  };

  tryCleanup();
};
