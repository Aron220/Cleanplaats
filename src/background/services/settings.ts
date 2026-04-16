import { SettingsRepository } from '@/shared/storage/repository';
import type { CleanplaatsSettings } from '@/shared/types/state';
import { DEFAULT_SETTINGS } from '@/shared/constants/settings';
import type { BackgroundState } from '@/background/types';

export async function loadInitialSettings(
  repository: SettingsRepository,
): Promise<CleanplaatsSettings> {
  try {
    const { settings } = await repository.load(undefined);
    return settings;
  } catch (error) {
    console.error('Cleanplaats: Failed to load initial background settings', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function refreshSettingsIntoState(
  state: BackgroundState,
  repository: SettingsRepository,
): Promise<void> {
  const settings = await loadInitialSettings(repository);
  state.resultsPerPage = String(settings.resultsPerPage);
  state.defaultSortMode = settings.defaultSortMode;
  state.sortPreferenceSource = settings.sortPreferenceSource;
}

