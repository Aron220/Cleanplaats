import { getPanelLocaleText } from '@/content/locale/panel-text';
import { getState, patchPanelState, saveSettings } from '@/content/runtime/store';
import { parseSellerAgeToDays, thresholdToDays } from '@/shared/utils/seller-age';
import { CLEANPLAATS_UPDATE_NOTES } from '@/shared/constants/update-notes';
import type { SettingsRepository } from '@/shared/storage/repository';
import { isProductDetailPage } from '@/content/utils/site';

import { performCleanup } from '@/content/services/cleanup';

let notificationTimeout = 0;

export const getExtensionVersion = (): string => {
  try {
    const manifest = browser.runtime.getManifest();
    if (manifest && typeof manifest.version === 'string') {
      return manifest.version;
    }
  } catch (error) {
    console.error('Cleanplaats: Failed to read extension version', error);
  }
  return '';
};

const clearSellerAgeWarningToast = (): void => {
  const toast = document.getElementById('cleanplaats-seller-age-warning-toast');
  if (toast) {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }
};

const getSellerAgeWarningThresholdLabel = (): string => {
  const panelText = getPanelLocaleText();
  const { settings } = getState();
  const value = Math.max(1, parseInt(String(settings.sellerAgeWarningThresholdValue), 10) || 1);
  const unit = settings.sellerAgeWarningThresholdUnit;
  const unitLabel =
    panelText.sellerAgeWarningThresholdUnits[unit]
    ?? panelText.sellerAgeWarningThresholdUnits.months;

  return `${value} ${unitLabel}`;
};

const getSellerAgeInfoFromPage = () => {
  const sellerRows = Array.from(
    document.querySelectorAll('.SellerInfoSmall-root .SellerInfoSmall-row'),
  );
  const sellerAgeRow = sellerRows.find((row) => parseSellerAgeToDays(row.textContent ?? '') !== null);
  const sellerNameElement = document.querySelector(
    '.SellerInfoSmall-root .SellerInfoSmall-name a, .SellerInfoSmall-root .SellerInfoSmall-name',
  );
  const sellerAgeText = sellerAgeRow?.textContent?.trim() ?? '';
  const sellerName = sellerNameElement?.textContent?.trim() ?? 'Deze verkoper';
  const sellerAgeDays = parseSellerAgeToDays(sellerAgeText);

  if (!sellerAgeText || sellerAgeDays === null) {
    return null;
  }

  return {
    sellerName,
    sellerAgeText,
    sellerAgeDays,
  };
};

const showSellerAgeWarningToast = ({
  sellerName,
  sellerAgeText,
}: {
  sellerName: string;
  sellerAgeText: string;
}): void => {
  const panelText = getPanelLocaleText();
  const thresholdLabel = getSellerAgeWarningThresholdLabel();

  clearSellerAgeWarningToast();

  const toast = document.createElement('div');
  toast.className = 'cleanplaats-blacklist-toast cleanplaats-blacklist-toast-warning';
  toast.id = 'cleanplaats-seller-age-warning-toast';

  toast.innerHTML = `
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">!</span>
            <div class="cleanplaats-toast-message">
                <strong>${panelText.sellerAgeWarningToastTitle}</strong>
                <span>${panelText.sellerAgeWarningToastMessage(sellerName, sellerAgeText, thresholdLabel)}</span>
            </div>
        </div>
    `;

  document.body.appendChild(toast);
  setTimeout(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  }, 50);

  window.setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 5200);
};

const maybeShowSellerAgeWarning = (options: { force?: boolean } = {}): void => {
  const force = options.force === true;
  const { settings, runtime } = getState();

  if (!isProductDetailPage()) {
    clearSellerAgeWarningToast();
    return;
  }

  if (!settings.sellerAgeWarningEnabled) {
    clearSellerAgeWarningToast();
    return;
  }

  const sellerAgeInfo = getSellerAgeInfoFromPage();
  if (!sellerAgeInfo) {
    clearSellerAgeWarningToast();
    return;
  }

  const thresholdDays = thresholdToDays(
    settings.sellerAgeWarningThresholdValue,
    settings.sellerAgeWarningThresholdUnit,
  );
  if (sellerAgeInfo.sellerAgeDays >= thresholdDays) {
    clearSellerAgeWarningToast();
    return;
  }

  const warningKey = `${location.pathname}|${sellerAgeInfo.sellerAgeText}|${String(thresholdDays)}`;
  if (!force && runtime.lastSellerAgeWarningKey === warningKey) {
    return;
  }

  runtime.lastSellerAgeWarningKey = warningKey;
  showSellerAgeWarningToast(sellerAgeInfo);
};

export const scheduleSellerAgeWarningCheck = (options: {
  force?: boolean;
  resetState?: boolean;
} = {}): void => {
  const force = options.force === true;
  const resetState = options.resetState === true;
  const { runtime } = getState();

  if (resetState) {
    runtime.lastSellerAgeWarningKey = '';
  }

  window.clearTimeout(runtime.sellerAgeCheckTimer);
  runtime.sellerAgeCheckTimer = window.setTimeout(() => {
    maybeShowSellerAgeWarning({ force });
  }, 180);
};

export const clearAllNotifications = (): void => {
  const notifications = document.querySelectorAll('[id^="cleanplaats-"]');
  notifications.forEach((notification) => {
    if (
      notification.classList.contains('cleanplaats-empty-notification')
      || notification.id === 'cleanplaats-loading'
      || notification.id === 'cleanplaats-seller-age-warning-toast'
    ) {
      notification.remove();
    }
  });
};

export const clearBubbleNotification = (): void => {
  const toast = document.getElementById('cleanplaats-bubble-notification');
  if (toast) {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }
};

export const showBubbleNotification = (message: string): void => {
  let toast = document.getElementById('cleanplaats-bubble-notification');

  if (toast) {
    const messageElement = toast.querySelector('.cleanplaats-toast-message span');
    if (messageElement) {
      messageElement.textContent = message;
    }
  } else {
    toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';
    toast.id = 'cleanplaats-bubble-notification';

    toast.innerHTML = `
            <div class="cleanplaats-blacklist-toast-content">
                <span class="cleanplaats-toast-icon">✨</span>
                <div class="cleanplaats-toast-message">
                    <span>${message}</span>
                </div>
            </div>
        `;

    document.body.appendChild(toast);
    setTimeout(() => requestAnimationFrame(() => toast?.classList.add('visible')), 0);
  }

  const t = toast as HTMLElement & { timeoutId?: number };
  if (t.timeoutId) {
    clearTimeout(t.timeoutId);
  }

  t.timeoutId = window.setTimeout(() => {
    toast?.classList.remove('visible');
    setTimeout(() => {
      toast?.remove();
    }, 300);
  }, 5000);
};

export const showBlacklistToast = (sellerName: string): void => {
  const panelText = getPanelLocaleText();
  const toast = document.createElement('div');
  toast.className = 'cleanplaats-blacklist-toast';

  toast.innerHTML = `
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon eye">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${sellerName} ${panelText.blacklistToastHiddenSuffix}</strong>
                <span>${panelText.blacklistToastHint}</span>
            </div>
        </div>
    `;

  document.body.appendChild(toast);
  setTimeout(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  }, 50);

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

export const showBulkBlacklistToast = (count: number): void => {
  const panelText = getPanelLocaleText();
  const toast = document.createElement('div');
  toast.className = 'cleanplaats-blacklist-toast';

  toast.innerHTML = `
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon eye">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${count} ${panelText.blacklistToastHiddenPluralSuffix}</strong>
                <span>${panelText.blacklistToastHint}</span>
            </div>
        </div>
    `;

  document.body.appendChild(toast);
  setTimeout(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  }, 50);

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

export const showUnblacklistToast = (sellerName: string): void => {
  const panelText = getPanelLocaleText();
  const toast = document.createElement('div');
  toast.className = 'cleanplaats-blacklist-toast';

  toast.innerHTML = `
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon eye">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${sellerName} ${panelText.blacklistToastShownSuffix}</strong>
                <span>${panelText.blacklistToastShownHint}</span>
            </div>
        </div>
    `;

  document.body.appendChild(toast);
  setTimeout(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  }, 50);

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

export const showBlacklistTermToast = (term: string): void => {
  const panelText = getPanelLocaleText();
  const toast = document.createElement('div');
  toast.className = 'cleanplaats-blacklist-toast';
  toast.innerHTML = `
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">🔎</span>
            <div class="cleanplaats-toast-message">
                <strong>'${term}' ${panelText.blacklistToastHiddenSuffix}</strong>
                <span>${panelText.termToastHidden(term)}</span>
            </div>
        </div>
    `;
  document.body.appendChild(toast);
  setTimeout(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  }, 50);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

export const showUnblacklistTermToast = (term: string): void => {
  const panelText = getPanelLocaleText();
  const toast = document.createElement('div');
  toast.className = 'cleanplaats-blacklist-toast';
  toast.innerHTML = `
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">🔎</span>
            <div class="cleanplaats-toast-message">
                <strong>'${term}' ${panelText.blacklistToastShownSuffix}</strong>
                <span>${panelText.termToastShown(term)}</span>
            </div>
        </div>
    `;
  document.body.appendChild(toast);
  setTimeout(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  }, 50);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

const showFirstTimeOnboarding = (): void => {
  const onboarding = document.createElement('div');
  onboarding.className = 'cleanplaats-onboarding';
  onboarding.id = 'cleanplaats-onboarding';

  onboarding.innerHTML = `
        <div class="cleanplaats-onboarding-content">
            <div class="cleanplaats-onboarding-header">
                <h3>🎉 Welkom bij Cleanplaats!</h3>
                <button id="cleanplaats-onboarding-close" class="cleanplaats-onboarding-close">×</button>
            </div>
            <div class="cleanplaats-onboarding-steps">
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">1</span>
                    <p>Cleanplaats verwijdert automatisch advertenties en promotionele content</p>
                </div>
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">2</span>
                    <p>Gebruik het configuratiescherm rechtsonder om de filtering aan te passen. Je opent en sluit het paneel via het pijltje bovenin.</p>
                </div>
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">3</span>
                    <p>Bekijk statistieken over verwijderde items in het configuratiescherm</p>
                </div>
            </div>
            <button id="cleanplaats-onboarding-got-it" class="cleanplaats-onboarding-button">Aan de slag!</button>
        </div>
    `;

  document.body.appendChild(onboarding);

  ['cleanplaats-onboarding-close', 'cleanplaats-onboarding-got-it'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => {
      onboarding.classList.add('cleanplaats-fade-out');
      setTimeout(() => onboarding.remove(), 300);
    });
  });

  setTimeout(() => {
    if (onboarding.parentNode) {
      onboarding.classList.add('cleanplaats-fade-out');
      setTimeout(() => onboarding.remove(), 300);
    }
  }, 15000);
};

const shouldShowUpdatePopup = (currentVersion: string): boolean => {
  if (!currentVersion) {
    return false;
  }

  return getState().panelState.lastSeenVersion !== currentVersion;
};

const showUpdatePopup = (version: string): void => {
  const existingPopup = document.getElementById('cleanplaats-update-popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  const updateContent = CLEANPLAATS_UPDATE_NOTES[version] ?? {
    intro:
      'Cleanplaats heeft een nieuwe update gekregen met verbeteringen en onderhoud aan de extensie.',
    highlights: [
      'Diverse verbeteringen en fixes voor de huidige resultaatpagina’s.',
      'Kleine verfijningen aan het paneel en de filtering.',
      'Onderhoudswerk om Cleanplaats stabiel te houden op nieuwe sitewijzigingen.',
    ],
    note: 'Zie je een probleem of heb je een idee? Gebruik de GitHub-link in het paneel.',
  };

  const popup = document.createElement('div');
  popup.className = 'cleanplaats-info-overlay cleanplaats-info-overlay--visible';
  popup.id = 'cleanplaats-update-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-hidden', 'false');

  const stepsMarkup = updateContent.highlights.map((step) => `<li>${step}</li>`).join('');

  popup.innerHTML = `
        <div class="cleanplaats-info-card">
            <div class="cleanplaats-info-header">
                <img id="cleanplaats-update-popup-logo" class="cleanplaats-info-logo" alt="Cleanplaats">
                <span class="cleanplaats-info-eyebrow">Nieuwe update</span>
                <h3 class="cleanplaats-info-title">Wat is er nieuw? (${version})</h3>
                <p class="cleanplaats-info-intro">${updateContent.intro}</p>
            </div>
            <ol class="cleanplaats-info-steps">${stepsMarkup}</ol>
            <p class="cleanplaats-info-note">${updateContent.note}</p>
            <div class="cleanplaats-info-footer">
                <button type="button" id="cleanplaats-update-popup-close" class="cleanplaats-info-button">Top, bedankt</button>
            </div>
        </div>
    `;

  const closePopup = (): void => {
    popup.classList.remove('cleanplaats-info-overlay--visible');
    popup.setAttribute('aria-hidden', 'true');
    setTimeout(() => popup.remove(), 200);
    document.removeEventListener('keydown', handleKeydown);
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      closePopup();
    }
  };

  popup.addEventListener('click', (event) => {
    if (event.target === popup) {
      closePopup();
    }
  });

  document.addEventListener('keydown', handleKeydown);
  document.body.appendChild(popup);
  const popupLogo = document.getElementById('cleanplaats-update-popup-logo');
  if (popupLogo instanceof HTMLImageElement) {
    popupLogo.src = browser.runtime.getURL('icons/icon128.png');
  }
  document.getElementById('cleanplaats-update-popup-close')?.addEventListener('click', () => {
    closePopup();
    showBubbleNotification(`Veel plezier met ${version}`);
  });
};

const showWelcomeToast = (): void => {
  const { panelState, stats } = getState();
  if (
    panelState.hasShownWelcomeToast
    || location.pathname !== '/'
    || location.hostname !== 'www.marktplaats.nl'
  ) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'cleanplaats-toast';
  toast.id = 'cleanplaats-toast';

  const totalRemoved = stats.totalRemoved;
  const message =
    totalRemoved > 0
      ? `Cleanplaats is actief (${totalRemoved} items verwijderd)`
      : 'Cleanplaats is actief';

  toast.innerHTML = `
        <div class="cleanplaats-toast-content">
            <span class="cleanplaats-toast-icon">✨</span>
            <span class="cleanplaats-toast-message">${message}</span>
        </div>
    `;

  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 100);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);

  patchPanelState({ hasShownWelcomeToast: true });
  void saveSettings(repositoryRef);
};

let repositoryRef!: SettingsRepository;

export const bindNotificationsRepository = (repository: SettingsRepository): void => {
  repositoryRef = repository;
};

export const showOnboarding = (currentVersion = ''): void => {
  const { featureFlags } = getState();
  if (featureFlags.firstRun) {
    if (currentVersion) {
      patchPanelState({ lastSeenVersion: currentVersion });
      void saveSettings(repositoryRef).catch((error) => {
        console.error('Cleanplaats: Failed to store initial version state', error);
      });
    }
    showFirstTimeOnboarding();
  } else if (shouldShowUpdatePopup(currentVersion)) {
    patchPanelState({ lastSeenVersion: currentVersion });
    void saveSettings(repositoryRef).catch((error) => {
      console.error('Cleanplaats: Failed to store seen update version', error);
    });
    showUpdatePopup(currentVersion);
  } else {
    showWelcomeToast();
  }
};

export const checkForEmptyPage = (): void => {
  clearTimeout(notificationTimeout);

  notificationTimeout = window.setTimeout(() => {
    performCleanup(getState());

    const visibleListings = document.querySelectorAll('.hz-Listing:not([data-cleanplaats-hidden])');
    const totalListings = document.querySelectorAll('.hz-Listing');
    const hiddenCount = totalListings.length - visibleListings.length;

    if (hiddenCount === 0) return;

    clearAllNotifications();

    if (visibleListings.length === 0) {
      showBubbleNotification(
        'De pagina is leeg omdat deze helemaal uit advertenties bestond! Probeer een volgende pagina of wijzig de filters.',
      );
    } else if (visibleListings.length < 5) {
      const listingWord = visibleListings.length === 1 ? 'resultaat' : 'resultaten';
      const removedWord = hiddenCount === 1 ? 'advertentie' : 'advertenties';
      showBubbleNotification(
        `Er ${visibleListings.length === 1 ? 'is' : 'zijn'} nog ${visibleListings.length} ${listingWord} over nadat Cleanplaats ${hiddenCount} ${removedWord} heeft verwijderd.`,
      );
    }
  }, 1000);
};
