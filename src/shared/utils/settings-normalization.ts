import { DEFAULT_PANEL_STATE, DEFAULT_SETTINGS } from '@/shared/constants/settings';
import type {
  CleanplaatsPanelState,
  CleanplaatsSettings,
  CleanplaatsSortMode,
  SellerAgeThresholdUnit,
  SortPreferenceSource,
} from '@/shared/types/state';

const VALID_SORT_MODES = new Set<CleanplaatsSortMode>([
  'standard',
  'date_new_old',
  'date_old_new',
  'price_low_high',
  'price_high_low',
  'distance',
]);

const VALID_SORT_SOURCES = new Set<SortPreferenceSource>(['cleanplaats', 'marketplace']);
const VALID_THRESHOLD_UNITS = new Set<SellerAgeThresholdUnit>([
  'days',
  'weeks',
  'months',
  'years',
]);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toResultsPerPage(value: unknown, fallback: CleanplaatsSettings['resultsPerPage']): CleanplaatsSettings['resultsPerPage'] {
  const parsed = Number.parseInt(String(value), 10);
  if (parsed === 30 || parsed === 50 || parsed === 100) {
    return parsed;
  }
  return fallback;
}

export function readBooleanString(value: string | null | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function normalizeSettings(raw: Partial<CleanplaatsSettings> | null | undefined): CleanplaatsSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const defaultSortMode = VALID_SORT_MODES.has(raw.defaultSortMode as CleanplaatsSortMode)
    ? (raw.defaultSortMode as CleanplaatsSortMode)
    : DEFAULT_SETTINGS.defaultSortMode;

  const sortPreferenceSource = VALID_SORT_SOURCES.has(raw.sortPreferenceSource as SortPreferenceSource)
    ? (raw.sortPreferenceSource as SortPreferenceSource)
    : DEFAULT_SETTINGS.sortPreferenceSource;

  const thresholdUnit = VALID_THRESHOLD_UNITS.has(raw.sellerAgeWarningThresholdUnit as SellerAgeThresholdUnit)
    ? (raw.sellerAgeWarningThresholdUnit as SellerAgeThresholdUnit)
    : DEFAULT_SETTINGS.sellerAgeWarningThresholdUnit;

  return {
    ...DEFAULT_SETTINGS,
    removeTopAds: toBoolean(raw.removeTopAds, DEFAULT_SETTINGS.removeTopAds),
    removeDagtoppers: toBoolean(raw.removeDagtoppers, DEFAULT_SETTINGS.removeDagtoppers),
    removePromotedListings: toBoolean(raw.removePromotedListings, DEFAULT_SETTINGS.removePromotedListings),
    removeOpvalStickers: toBoolean(raw.removeOpvalStickers, DEFAULT_SETTINGS.removeOpvalStickers),
    removeReservedListings: toBoolean(raw.removeReservedListings, DEFAULT_SETTINGS.removeReservedListings),
    removeFavoriteRelatedAds: toBoolean(raw.removeFavoriteRelatedAds, DEFAULT_SETTINGS.removeFavoriteRelatedAds),
    sellerAgeWarningEnabled: toBoolean(
      raw.sellerAgeWarningEnabled,
      DEFAULT_SETTINGS.sellerAgeWarningEnabled,
    ),
    sellerAgeWarningThresholdValue: toInteger(
      raw.sellerAgeWarningThresholdValue,
      DEFAULT_SETTINGS.sellerAgeWarningThresholdValue,
      1,
      99,
    ),
    sellerAgeWarningThresholdUnit: thresholdUnit,
    darkMode: toBoolean(raw.darkMode, DEFAULT_SETTINGS.darkMode),
    blacklistedSellers: asStringArray(raw.blacklistedSellers),
    blacklistedTerms: asStringArray(raw.blacklistedTerms),
    resultsPerPage: toResultsPerPage(raw.resultsPerPage, DEFAULT_SETTINGS.resultsPerPage),
    defaultSortMode,
    sortPreferenceSource,
  };
}

export function normalizePanelState(
  raw: Partial<CleanplaatsPanelState> | null | undefined,
): CleanplaatsPanelState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PANEL_STATE };
  }

  const activeView =
    raw.activeView === 'preferences' || raw.activeView === 'filters'
      ? raw.activeView
      : DEFAULT_PANEL_STATE.activeView;

  return {
    ...DEFAULT_PANEL_STATE,
    isCollapsed: toBoolean(raw.isCollapsed, DEFAULT_PANEL_STATE.isCollapsed),
    hasShownWelcomeToast: toBoolean(
      raw.hasShownWelcomeToast,
      DEFAULT_PANEL_STATE.hasShownWelcomeToast,
    ),
    lastSeenVersion:
      typeof raw.lastSeenVersion === 'string'
        ? raw.lastSeenVersion
        : DEFAULT_PANEL_STATE.lastSeenVersion,
    activeView,
  };
}

export function cloneSettings(input: CleanplaatsSettings): CleanplaatsSettings {
  return {
    ...input,
    blacklistedSellers: [...input.blacklistedSellers],
    blacklistedTerms: [...input.blacklistedTerms],
  };
}

export function clonePanelState(input: CleanplaatsPanelState): CleanplaatsPanelState {
  return {
    ...input,
  };
}

export function normalizeStoredBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}
