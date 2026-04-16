import { BLACKLISTED_TITLE_SELECTORS } from '@/shared/constants/settings';

export function getListingTitleElement(container: Element): Element | null {
  return container.querySelector(BLACKLISTED_TITLE_SELECTORS);
}

export function getListingTitleText(container: Element): string {
  return getListingTitleElement(container)?.textContent?.trim().toLowerCase() ?? '';
}
