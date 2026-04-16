import type {
  CleanplaatsPanelState,
  CleanplaatsSettings,
  SortMode,
  SortModeConfig,
} from '@/shared/types/state';

export const SORT_MODES: Record<SortMode, SortModeConfig> = {
  standard: { sortBy: 'OPTIMIZED', sortOrder: 'DECREASING' },
  date_new_old: { sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' },
  date_old_new: { sortBy: 'SORT_INDEX', sortOrder: 'INCREASING' },
  price_low_high: { sortBy: 'PRICE', sortOrder: 'INCREASING' },
  price_high_low: { sortBy: 'PRICE', sortOrder: 'DECREASING' },
  distance: { sortBy: 'LOCATION', sortOrder: 'INCREASING' },
};

export const DEFAULT_SETTINGS: CleanplaatsSettings = {
  removeTopAds: true,
  removeDagtoppers: true,
  removePromotedListings: true,
  removeOpvalStickers: true,
  removeReservedListings: false,
  removeFavoriteRelatedAds: false,
  sellerAgeWarningEnabled: false,
  sellerAgeWarningThresholdValue: 3,
  sellerAgeWarningThresholdUnit: 'days',
  darkMode: false,
  blacklistedSellers: [],
  blacklistedTerms: [],
  resultsPerPage: 30,
  defaultSortMode: 'standard',
  sortPreferenceSource: 'cleanplaats',
};

export const DEFAULT_PANEL_STATE: CleanplaatsPanelState = {
  isCollapsed: false,
  hasShownWelcomeToast: false,
  lastSeenVersion: '',
  activeView: 'filters',
};

export const MARKTPLAATS_SORT_LABEL_TO_MODE: Record<string, SortMode> = {
  standaard: 'standard',
  'datum (nieuw-oud)': 'date_new_old',
  'datum (oud-nieuw)': 'date_old_new',
  'prijs (laag-hoog)': 'price_low_high',
  'prijs (hoog-laag)': 'price_high_low',
  afstand: 'distance',
};

export const BLACKLISTED_TITLE_SELECTORS = [
  '.hz-StructuredListing-title',
  '.hz-Listing-title',
  '.hz-Listing-group--title-description',
  '.hz-StructuredListing-body',
  '[class*="ListingTitle_hz-Listing-title"]',
  '[class*="ListingTitle_hz-StructuredListing-title"]',
].join(', ');
