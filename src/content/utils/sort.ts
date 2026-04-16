import { MARKTPLAATS_SORT_LABEL_TO_MODE } from '@/shared/constants/settings';
import type { SortMode } from '@/shared/types/state';

export const normalizeSortLabel = (label: string): string => label.trim().toLowerCase();

export const getSortModeFromLabel = (label: string): SortMode | null =>
  MARKTPLAATS_SORT_LABEL_TO_MODE[normalizeSortLabel(label)] ?? null;

export const isMarketplaceSortDropdown = (element: EventTarget | null): element is HTMLSelectElement => {
  if (!(element instanceof HTMLSelectElement)) return false;

  const ariaLabel = normalizeSortLabel(element.getAttribute('aria-label') ?? '');
  if (ariaLabel === 'sorteer op') return true;

  return Array.from(element.options ?? []).some(
    (option) => normalizeSortLabel(option.textContent ?? '') === 'datum (nieuw-oud)',
  );
};
