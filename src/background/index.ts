import {
  createBackgroundRuntimeState,
  type BackgroundState,
  type BackgroundRuntime,
} from '@/background/types';
import { DEFAULT_SETTINGS } from '@/shared/constants/settings';
import { KeepAliveService } from '@/background/services/keepalive';
import { SettingsRepository } from '@/shared/storage/repository';
import { createListenerController } from '@/background/services/listeners';

export async function initializeBackground(): Promise<void> {
  const state: BackgroundState = {
    resultsPerPage: String(DEFAULT_SETTINGS.resultsPerPage),
    defaultSortMode: DEFAULT_SETTINGS.defaultSortMode,
    sortPreferenceSource: DEFAULT_SETTINGS.sortPreferenceSource,
  };
  const runtimeState = createBackgroundRuntimeState();
  const runtime: BackgroundRuntime = {
    wakeupNavigationFilters: runtimeState.wakeupNavigationFilters,
  };
  const keepAlive = new KeepAliveService(runtimeState);
  const settingsRepository = new SettingsRepository();

  const listenerController = createListenerController({
    browserApi: browser,
    state,
    runtime,
    keepAlive,
    settingsRepository,
    updateDarkModeStartupScript: async (_enabled) => {
      // theme-init is loaded statically via manifest content scripts.
      // Keep async hook as no-op to preserve prior behavior.
    },
  });

  await listenerController.initialize();
  listenerController.registerRuntimeListeners();
  keepAlive.setup();
}

