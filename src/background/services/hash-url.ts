import { SORT_MODES } from '@/shared/constants/settings';
import type { SortMode, SortPreferenceSource } from '@/shared/types/state';

export function parseHashOptions(hashStr: string): Record<string, string> {
  const options: Record<string, string> = {};
  if (!hashStr || hashStr.length < 2) {
    return options;
  }

  const hashKeysValues = hashStr.substring(1).split('|');
  for (const hashKeyValue of hashKeysValues) {
    const keyValue = hashKeyValue.split(':');
    if (keyValue.length !== 2) {
      continue;
    }

    const [key, value] = keyValue;
    if (!key || !value) {
      continue;
    }

    options[key] = value;
  }

  return options;
}

export function buildHashOptions(options: Record<string, string>): string {
  const entries = Object.entries(options).filter(([, value]) => Boolean(value && value !== ''));
  if (entries.length === 0) {
    return '';
  }

  const serialized = entries
    .map(([key, value]) => `${key}:${value}`)
    .join('|');

  return `#${serialized}`;
}

export type ModifyUrlInput = {
  urlString: string;
  resultsPerPage: string;
  defaultSortMode: SortMode;
  sortPreferenceSource: SortPreferenceSource;
};

export function getModifiedUrlIfNeeded({
  urlString,
  resultsPerPage,
  defaultSortMode,
  sortPreferenceSource,
}: ModifyUrlInput): string | null {
  const url = new URL(urlString);
  const options = parseHashOptions(url.hash);
  let needsRewrite = false;
  const hasExplicitSort = Boolean(options.sortBy && options.sortOrder);
  const shouldApplyCleanplaatsSort = sortPreferenceSource !== 'marketplace';

  if (!Object.prototype.hasOwnProperty.call(options, 'limit') || options.limit !== resultsPerPage) {
    options.limit = resultsPerPage;
    needsRewrite = true;
  }

  if (shouldApplyCleanplaatsSort && defaultSortMode !== 'standard') {
    const sortConfig = SORT_MODES[defaultSortMode];
    if (
      sortConfig
      && (
        !hasExplicitSort
        || options.sortBy !== sortConfig.sortBy
        || options.sortOrder !== sortConfig.sortOrder
      )
    ) {
      options.sortBy = sortConfig.sortBy;
      options.sortOrder = sortConfig.sortOrder;
      needsRewrite = true;
    }
  } else if (shouldApplyCleanplaatsSort && defaultSortMode === 'standard' && hasExplicitSort) {
    delete options.sortBy;
    delete options.sortOrder;
    needsRewrite = true;
  }

  if (needsRewrite) {
    url.hash = buildHashOptions(options);
    return url.href;
  }

  return null;
}
