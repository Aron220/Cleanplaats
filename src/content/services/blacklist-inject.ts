import { getPanelLocaleText } from '@/content/locale/panel-text';
import { getState, patchSettings, saveSettings } from '@/content/runtime/store';
import { performCleanup } from '@/content/services/cleanup';
import {
  showBlacklistToast,
  showBulkBlacklistToast,
} from '@/content/services/notifications';
import type { SettingsRepository } from '@/shared/storage/repository';
import { isProductDetailPage } from '@/content/utils/site';

let repositoryRef!: SettingsRepository;

export const bindBlacklistRepository = (repository: SettingsRepository): void => {
  repositoryRef = repository;
};

export const addSellersToBlacklist = async (sellerNames: string[]): Promise<void> => {
  const { settings } = getState();
  const normalizedSellerNames = sellerNames
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .filter((name) => !settings.blacklistedSellers.includes(name));

  if (normalizedSellerNames.length === 0) return;

  patchSettings({
    blacklistedSellers: [...settings.blacklistedSellers, ...normalizedSellerNames],
  });
  await saveSettings(repositoryRef);
  performCleanup(getState());
  injectBlacklistButtons();

  if (normalizedSellerNames.length === 1) {
    showBlacklistToast(normalizedSellerNames[0] ?? '');
    return;
  }

  showBulkBlacklistToast(normalizedSellerNames.length);
};

export const injectProductDetailBlacklistButton = (): void => {
  const panelText = getPanelLocaleText();
  const sellerRoot = document.querySelector('.SellerInfoSmall-root');
  const sellerNameElement = sellerRoot?.querySelector(
    '.SellerInfoSmall-name a, .SellerInfoSmall-name',
  );
  const existingRow = document.querySelector('.cleanplaats-detail-blacklist-row');

  if (!isProductDetailPage() || !sellerRoot || !sellerNameElement) {
    existingRow?.remove();
    return;
  }

  const sellerName = sellerNameElement.textContent?.trim();
  if (!sellerName) {
    existingRow?.remove();
    return;
  }

  const { settings } = getState();
  const isBlacklisted = settings.blacklistedSellers.includes(sellerName);
  const detailRow = existingRow ?? document.createElement('div');
  detailRow.className = 'cleanplaats-detail-blacklist-row';

  const button = document.createElement('button');
  button.className = 'cleanplaats-blacklist-btn cleanplaats-detail-blacklist-btn';
  button.type = 'button';
  button.tabIndex = 0;
  button.textContent = isBlacklisted ? panelText.hiddenSellerButton : panelText.hideSellerButton;
  button.disabled = isBlacklisted;
  button.setAttribute('aria-disabled', isBlacklisted ? 'true' : 'false');

  if (!isBlacklisted) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void addSellersToBlacklist([sellerName]);
    });
  }

  detailRow.replaceChildren(button);

  if (!existingRow) {
    sellerRoot.insertAdjacentElement('afterend', detailRow);
  }
};

export const injectBlacklistButtons = (): void => {
  const panelText = getPanelLocaleText();
  const { settings } = getState();

  document.querySelectorAll('.hz-Listing').forEach((listingEl) => {
    const listing = listingEl as HTMLElement;
    const oldBtn = listing.querySelector('.cleanplaats-blacklist-btn-row');
    const oldTopRight = listing.querySelector('.cleanplaats-seller-topright-mobile');
    const oldInlineBtn = listing.querySelector('.cleanplaats-inline-btn');

    let sellerName: string | null = listing.dataset.cleanplaatsSellerName || null;
    let sellerElement: Element | null = null;
    let isCarAdvert = false;

    const carSellerElement = listing.querySelector(
      '.hz-Listing-sellerName, .hz-Listing-sellerName-new',
    );
    if (carSellerElement) {
      sellerName = carSellerElement.textContent?.trim() ?? null;
      sellerElement = carSellerElement;
      isCarAdvert = true;
    } else {
      const sellerNameEl = listing.querySelector(
        '.hz-Listing-seller-name, .hz-Listing-seller-name-new',
      );
      if (sellerNameEl) {
        sellerName = sellerNameEl.textContent?.trim() ?? null;
        const sellerLink = sellerNameEl.closest('a');
        sellerElement = sellerLink ? sellerLink.parentElement || sellerLink : sellerNameEl;
        isCarAdvert = false;
      }
    }

    if (sellerName) {
      listing.dataset.cleanplaatsSellerName = sellerName;
    }

    if (!sellerName) return;

    if (settings.blacklistedSellers.includes(sellerName)) {
      listing.setAttribute('data-cleanplaats-hidden', 'true');
      listing.style.display = 'none';
      return;
    }

    if (window.innerWidth < 700) {
      if (oldTopRight && (oldTopRight as HTMLElement).dataset.cleanplaatsSellerName === sellerName) {
        return;
      }

      if (oldBtn) oldBtn.remove();
      if (oldInlineBtn) oldInlineBtn.remove();
      if (oldTopRight) oldTopRight.remove();

      const topRow = document.createElement('div');
      topRow.className = 'cleanplaats-seller-topright-mobile';
      topRow.dataset.cleanplaatsSellerName = sellerName;
      topRow.innerHTML = `
                <span class="cleanplaats-seller-name-mobile">${sellerName}</span>
                <button class="cleanplaats-blacklist-btn-mobile" title="${panelText.hideSellerButtonAriaLabel}" aria-label="${panelText.hideSellerButtonAriaLabel}">
                  <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20C7 20 2.73 16.11 1 12c.74-1.61 1.81-3.09 3.06-4.31"/>
                    <path d="M22.54 12.88A10.06 10.06 0 0 0 12 4c-1.61 0-3.16.31-4.59.88"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
            `;
      const content = listing.querySelector(
        '.hz-Listing-listview-content, .hz-Listing-listview-content-new',
      );
      if (content?.firstChild) {
        content.insertBefore(topRow, content.firstChild);
      } else if (content) {
        content.appendChild(topRow);
      }
      topRow.querySelector('.cleanplaats-blacklist-btn-mobile')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.confirm(`Wil je alle advertenties van ${sellerName} verbergen?`)) {
          void addSellersToBlacklist([sellerName]);
        }
      });
      return;
    }

    if (!sellerElement) return;

    if (oldBtn) oldBtn.remove();
    if (oldTopRight) oldTopRight.remove();
    if (oldInlineBtn) oldInlineBtn.remove();

    if (isCarAdvert && carSellerElement) {
      const carEl = carSellerElement as HTMLElement;
      carEl.style.display = 'inline-flex';
      carEl.style.alignItems = 'center';
      carEl.style.gap = '8px';

      const btn = document.createElement('button');
      btn.className = 'cleanplaats-blacklist-btn cleanplaats-inline-btn';
      btn.textContent = panelText.hideSellerButton;
      btn.type = 'button';
      btn.tabIndex = 0;
      (btn as HTMLElement).style.marginLeft = '8px';

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void addSellersToBlacklist([sellerName]);
      });

      carSellerElement.appendChild(btn);
    } else {
      const btnRow = document.createElement('div');
      btnRow.className = 'cleanplaats-blacklist-btn-row';

      const btn = document.createElement('button');
      btn.className = 'cleanplaats-blacklist-btn';
      btn.textContent = panelText.hideSellerButton;
      btn.type = 'button';
      btn.tabIndex = 0;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void addSellersToBlacklist([sellerName]);
      });

      btnRow.appendChild(btn);

      if (sellerElement.parentNode) {
        sellerElement.parentNode.insertBefore(btnRow, sellerElement.nextSibling);
      }
    }
  });

  injectProductDetailBlacklistButton();
};

export const removeSellerFromBlacklist = async (sellerName: string): Promise<void> => {
  const { settings } = getState();
  patchSettings({
    blacklistedSellers: settings.blacklistedSellers.filter((s) => s !== sellerName),
  });
  await saveSettings(repositoryRef);

  document.querySelectorAll('.hz-Listing').forEach((listingEl) => {
    const listing = listingEl as HTMLElement;
    const sellerNameEl = listing.querySelector(
      '.hz-Listing-seller-name, .hz-Listing-seller-name-new, .hz-Listing-seller-link, .hz-Listing-sellerName, .hz-Listing-sellerName-new',
    );
    if (!sellerNameEl) return;
    if (sellerNameEl.textContent?.trim() === sellerName) {
      listing.removeAttribute('data-cleanplaats-hidden');
      listing.style.display = '';
    }
  });
  performCleanup(getState());
  injectBlacklistButtons();
};
