import { wakeUpBackground } from '@/content/services/background-wake';
import { getState, patchSettings, saveSettings } from '@/content/runtime/store';
import { getSortModeFromLabel, isMarketplaceSortDropdown } from '@/content/utils/sort';
import type { SettingsRepository } from '@/shared/storage/repository';
import type { SortMode } from '@/shared/types/state';

export const syncCleanplaatsSortMode = async (
  sortMode: SortMode | null,
  repository: SettingsRepository,
): Promise<void> => {
  if (!sortMode) return;

  const current = getState().settings;
  const modeChanged = current.defaultSortMode !== sortMode;
  const sourceChanged = current.sortPreferenceSource !== 'marketplace';
  if (!modeChanged && !sourceChanged) return;

  patchSettings({ defaultSortMode: sortMode, sortPreferenceSource: 'marketplace' });
  wakeUpBackground();
  try {
    await saveSettings(repository);
  } catch (error) {
    console.error('Cleanplaats: Failed to sync sort mode from page selection', error);
  }
};

export const setupMarketplaceSortSync = (repository: SettingsRepository): void => {
  if (document.body?.dataset.cleanplaatsSortSyncBound === 'true') return;
  if (document.body) {
    document.body.dataset.cleanplaatsSortSyncBound = 'true';
  }

  document.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (!isMarketplaceSortDropdown(target)) return;

      const selectedOption = target.options[target.selectedIndex];
      const sortMode = getSortModeFromLabel(selectedOption?.textContent ?? target.value);
      void syncCleanplaatsSortMode(sortMode, repository);
    },
    true,
  );
};
