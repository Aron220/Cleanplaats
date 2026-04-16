export type SortMode =
  | 'standard'
  | 'date_new_old'
  | 'date_old_new'
  | 'price_low_high'
  | 'price_high_low'
  | 'distance';

export type CleanplaatsSortMode = SortMode;

export type SortModeConfig = {
  sortBy: string;
  sortOrder: 'DECREASING' | 'INCREASING';
};

export type SortPreferenceSource = 'cleanplaats' | 'marketplace';

export type SellerAgeThresholdUnit = 'days' | 'weeks' | 'months' | 'years';

export interface CleanplaatsSettings {
  removeTopAds: boolean;
  removeDagtoppers: boolean;
  removePromotedListings: boolean;
  removeOpvalStickers: boolean;
  removeReservedListings: boolean;
  removeFavoriteRelatedAds: boolean;
  sellerAgeWarningEnabled: boolean;
  sellerAgeWarningThresholdValue: number;
  sellerAgeWarningThresholdUnit: SellerAgeThresholdUnit;
  darkMode: boolean;
  blacklistedSellers: string[];
  blacklistedTerms: string[];
  resultsPerPage: 30 | 50 | 100;
  defaultSortMode: CleanplaatsSortMode;
  sortPreferenceSource: SortPreferenceSource;
}

export interface CleanplaatsStats {
  topAdsRemoved: number;
  dagtoppersRemoved: number;
  promotedListingsRemoved: number;
  opvalStickersRemoved: number;
  otherAdsRemoved: number;
  totalRemoved: number;
}

export interface CleanplaatsObservers {
  mutation: MutationObserver | null;
  ads: MutationObserver | null;
  webchat: MutationObserver | null;
  sellerAge: MutationObserver | null;
}

export interface CleanplaatsRuntimeState {
  lastSellerAgeWarningKey: string;
  sellerAgeCheckTimer: number;
}

export interface CleanplaatsFeatureFlags {
  showStats: boolean;
  autoCollapse: boolean;
  firstRun: boolean;
}

export interface CleanplaatsPanelState {
  isCollapsed: boolean;
  hasShownWelcomeToast: boolean;
  lastSeenVersion: string;
  activeView: 'filters' | 'preferences';
}

export interface CleanplaatsState {
  settings: CleanplaatsSettings;
  stats: CleanplaatsStats;
  observers: CleanplaatsObservers;
  runtime: CleanplaatsRuntimeState;
  featureFlags: CleanplaatsFeatureFlags;
  panelState: CleanplaatsPanelState;
}

export interface ReviewCtaConfig {
  linkLabel: string;
  url: string;
}

export interface CleanplaatsLocaleText {
  feedbackLabel: string;
  feedbackText: string;
  feedbackAriaLabel: string;
  reviewAriaLabel: (linkLabel: string) => string;
  supportTitle: string;
  supportButton: string;
  optionsTitle: string;
  topAdLabel: string;
  topAdTooltip: string;
  topAdTooltipTwh: string;
  dagtoppersLabel: string;
  dagtoppersTooltip: string;
  promotedListingsLabel: string;
  promotedListingsTooltip: string;
  stickersLabel: string;
  stickersTooltip: string;
  reservedLabel: string;
  reservedTooltip: string;
  favoriteRelatedAdsLabel: string;
  favoriteRelatedAdsTooltip: string;
  sellerAgeWarningLabel: string;
  sellerAgeWarningTooltip: string;
  sellerAgeWarningThresholdLabel: string;
  sellerAgeWarningThresholdValueAriaLabel: string;
  sellerAgeWarningThresholdUnitAriaLabel: string;
  sellerAgeWarningThresholdUnits: Record<SellerAgeThresholdUnit, string>;
  sellerAgeWarningToastTitle: string;
  sellerAgeWarningToastMessage: (
    sellerName: string,
    sellerAgeText: string,
    thresholdLabel: string,
  ) => string;
  preferencesLabel: string;
  backLabel: string;
  preferencesIntro: string;
  darkModeLabel: string;
  darkModeTooltip: string;
  resultsPerPageLabel: string;
  defaultSortLabel: string;
  sortOptions: Record<CleanplaatsSortMode, string>;
  statsTitle: string;
  statsTop: string;
  statsDagtoppers: string;
  statsBusiness: string;
  statsStickers: string;
  statsOther: string;
  statsTotal: string;
  manageTerms: string;
  manageSellers: string;
  termsModalTitle: string;
  termsEmpty: string;
  hiddenButton: string;
  unhideButton: string;
  termInputPlaceholder: string;
  termInputHelp: string;
  addButton: string;
  closeButton: string;
  sellersModalTitle: string;
  sellersEmpty: string;
  sellerInputPlaceholder: string;
  sellerInputHelp: string;
  hideSellerButton: string;
  hiddenSellerButton: string;
  hideSellerButtonAriaLabel: string;
  blacklistToastHint: string;
  blacklistToastHiddenSuffix: string;
  blacklistToastHiddenPluralSuffix: string;
  blacklistToastShownSuffix: string;
  blacklistToastShownHint: string;
  termToastHidden: (term: string) => string;
  termToastShown: (term: string) => string;
}

export type LocaleText = CleanplaatsLocaleText;

export interface SellerAgeInfo {
  sellerName: string;
  sellerAgeText: string;
  sellerAgeDays: number;
}

export interface UpdateNote {
  intro: string;
  highlights: string[];
  note: string;
}

export type UpdateNotes = Record<string, UpdateNote>;

export type RuntimeResponseStatus = 'acknowledged' | 'refreshed' | 'ignored';

