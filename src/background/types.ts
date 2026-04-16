import type { CleanplaatsSortMode, SortPreferenceSource } from '@/shared/types/state';
import type { WAKEUP_NAVIGATION_FILTERS } from '@/shared/constants/domains';

export type BackgroundState = {
  resultsPerPage: string;
  defaultSortMode: CleanplaatsSortMode;
  sortPreferenceSource: SortPreferenceSource;
};

export type BackgroundRuntime = {
  wakeupNavigationFilters: typeof WAKEUP_NAVIGATION_FILTERS;
};

export type BackgroundRuntimeState = BackgroundState & {
  lastMarketplaceActivity: number;
  wakeupNavigationFilters: typeof WAKEUP_NAVIGATION_FILTERS;
};

export type KeepAliveController = {
  setup: () => void;
  resetToActiveMode: () => void;
};

export type SettingsSnapshot = {
  resultsPerPage: string;
  defaultSortMode: CleanplaatsSortMode;
  sortPreferenceSource: SortPreferenceSource;
  darkMode: boolean;
};

export const createBackgroundRuntimeState = (): BackgroundRuntimeState => ({
  resultsPerPage: '30',
  defaultSortMode: 'standard',
  sortPreferenceSource: 'cleanplaats',
  lastMarketplaceActivity: Date.now(),
  wakeupNavigationFilters: [
    { hostSuffix: 'marktplaats.nl' },
    { hostSuffix: '2dehands.be' },
    { hostSuffix: '2ememain.be' },
  ] as const,
});
