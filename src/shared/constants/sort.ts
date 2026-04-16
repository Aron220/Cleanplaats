import type { CleanplaatsSortMode } from '@/shared/types/state';

export type SortTransform = {
  sortBy: string;
  sortOrder: 'DECREASING' | 'INCREASING';
};

export const SORT_MODES: Record<CleanplaatsSortMode, SortTransform | null> = {
  standard: null,
  date_new_old: { sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' },
  date_old_new: { sortBy: 'SORT_INDEX', sortOrder: 'INCREASING' },
  price_low_high: { sortBy: 'PRICE', sortOrder: 'INCREASING' },
  price_high_low: { sortBy: 'PRICE', sortOrder: 'DECREASING' },
  distance: { sortBy: 'LOCATION', sortOrder: 'INCREASING' },
};

export const SORT_LABEL_TO_MODE: Record<string, CleanplaatsSortMode> = {
  standaard: 'standard',
  'datum (nieuw-oud)': 'date_new_old',
  'datum (oud-nieuw)': 'date_old_new',
  'prijs (laag-hoog)': 'price_low_high',
  'prijs (hoog-laag)': 'price_high_low',
  afstand: 'distance',
};
