import { RUNTIME_MESSAGE_ACTIONS } from '@/shared/messages/runtime';
import { SettingsRepository } from '@/shared/storage/repository';
import type {
  BackgroundState,
  BackgroundRuntime,
  KeepAliveController,
  SettingsSnapshot,
} from '@/background/types';
import { refreshSettingsIntoState } from '@/background/services/settings';
import { updateApiRequestRules } from '@/background/services/rules';
import {
  createNavigationHandlers,
  type NavigationHandlers,
} from '@/background/services/navigation';

type BrowserApi = typeof browser;

type StorageChange = {
  oldValue?: unknown;
  newValue?: unknown;
};

type Dependencies = {
  browserApi: BrowserApi;
  state: BackgroundState;
  runtime: BackgroundRuntime;
  keepAlive: KeepAliveController;
  settingsRepository: SettingsRepository;
  updateDarkModeStartupScript: (enabled: boolean) => Promise<void>;
};

export type ListenerController = {
  initialize: () => Promise<void>;
  registerRuntimeListeners: () => void;
};

const parseStoredSettings = (raw: string | undefined): SettingsSnapshot => {
  const parsed = raw ? (JSON.parse(raw) as Partial<SettingsSnapshot>) : {};
  return {
    resultsPerPage:
      typeof parsed.resultsPerPage === 'number' || typeof parsed.resultsPerPage === 'string'
        ? String(parsed.resultsPerPage)
        : '30',
    defaultSortMode:
      parsed.defaultSortMode === 'date_new_old'
      || parsed.defaultSortMode === 'date_old_new'
      || parsed.defaultSortMode === 'price_low_high'
      || parsed.defaultSortMode === 'price_high_low'
      || parsed.defaultSortMode === 'distance'
      || parsed.defaultSortMode === 'standard'
        ? parsed.defaultSortMode
        : 'standard',
    sortPreferenceSource: parsed.sortPreferenceSource === 'marketplace' ? 'marketplace' : 'cleanplaats',
    darkMode: Boolean(parsed.darkMode),
  };
};

type StorageOnChangedParameters = Parameters<
  BrowserApi['storage']['onChanged']['addListener']
>[0] extends (changes: infer TChanges, areaName: infer TAreaName) => unknown
  ? { changes: TChanges; areaName: TAreaName }
  : { changes: Record<string, unknown>; areaName: string };

const updateStateFromSnapshot = (
  state: BackgroundState,
  snapshot: SettingsSnapshot,
): boolean => {
  let changed = false;

  if (state.resultsPerPage !== snapshot.resultsPerPage) {
    state.resultsPerPage = snapshot.resultsPerPage;
    changed = true;
  }

  if (state.defaultSortMode !== snapshot.defaultSortMode) {
    state.defaultSortMode = snapshot.defaultSortMode;
    changed = true;
  }

  if (state.sortPreferenceSource !== snapshot.sortPreferenceSource) {
    state.sortPreferenceSource = snapshot.sortPreferenceSource;
    changed = true;
  }

  return changed;
};

export const createListenerController = (dependencies: Dependencies): ListenerController => {
  const {
    browserApi,
    keepAlive,
    runtime,
    settingsRepository,
    state,
    updateDarkModeStartupScript,
  } = dependencies;

  let navigationHandlers: NavigationHandlers | null = null;

  const ensureNavigationHandlers = (): NavigationHandlers => {
    if (navigationHandlers) {
      return navigationHandlers;
    }

    navigationHandlers = createNavigationHandlers({
      browserApi,
      state,
    });
    return navigationHandlers;
  };

  const refreshSettingsAndRules = async (): Promise<void> => {
    try {
      const rawSettings = await settingsRepository.getRawSettingsValue();
      const snapshot = parseStoredSettings(rawSettings);

      const changed = updateStateFromSnapshot(state, snapshot);
      await updateDarkModeStartupScript(snapshot.darkMode);

      if (changed) {
        await updateApiRequestRules(state.resultsPerPage);
      }
    } catch (error) {
      console.error('Cleanplaats: Error refreshing settings in background', error);
    }
  };

  const handleStorageChanges = async (
    changes: StorageOnChangedParameters['changes'],
    areaName: StorageOnChangedParameters['areaName'],
  ): Promise<void> => {
    if (areaName !== 'local' || !changes.cleanplaatsSettings) {
      return;
    }

    try {
      const snapshot = parseStoredSettings(
        typeof changes.cleanplaatsSettings.newValue === 'string'
          ? changes.cleanplaatsSettings.newValue
          : undefined,
      );

      const changed = updateStateFromSnapshot(state, snapshot);
      await updateDarkModeStartupScript(snapshot.darkMode);

      if (changed) {
        await updateApiRequestRules(state.resultsPerPage);
      }
    } catch (error) {
      console.error('Cleanplaats: Error handling storage change', error);
    }
  };

  const registerMessageListener = (): void => {
    browserApi.runtime.onMessage.addListener(
      (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void): boolean => {
        const action = (message as { action?: string })?.action;

        if (action === RUNTIME_MESSAGE_ACTIONS.keepAlive) {
          keepAlive.resetToActiveMode();
          void refreshSettingsAndRules();
          sendResponse({ status: 'acknowledged', timestamp: Date.now() });
          return true;
        }

        if (action === RUNTIME_MESSAGE_ACTIONS.forceRefresh) {
          keepAlive.resetToActiveMode();
          void refreshSettingsAndRules();
          sendResponse({ status: 'refreshed', timestamp: Date.now() });
          return true;
        }

        sendResponse({ status: 'ignored' });
        return true;
      },
    );
  };

  const registerStorageListener = (): void => {
    browserApi.storage.onChanged.addListener(
      (changes: Record<string, StorageChange>, areaName: string) => {
        void handleStorageChanges(changes, areaName);
      },
    );
  };

  const registerNavigationListeners = (): void => {
    const handlers = ensureNavigationHandlers();
    const filter = { url: [...runtime.wakeupNavigationFilters] };

    browserApi.webNavigation.onBeforeNavigate.addListener(
      handlers.handleBeforeNavigate,
      filter,
    );
    browserApi.webNavigation.onHistoryStateUpdated.addListener(
      handlers.handleHistoryStateUpdated,
      filter,
    );
  };

  const setupInstallListener = (): void => {
    browserApi.runtime.onInstalled.addListener(async (details: { reason: string }) => {
      if (details.reason !== 'install' && details.reason !== 'update') {
        return;
      }

      try {
        const existingRules = await browserApi.declarativeNetRequest.getDynamicRules();
        if (!existingRules.length) return;

        await browserApi.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existingRules.map((rule: { id: number }) => rule.id),
        });
      } catch (error) {
        console.error('Cleanplaats: Failed clearing dynamic rules on install/update', error);
      }
    });
  };

  const initialize = async (): Promise<void> => {
    await refreshSettingsIntoState(state, settingsRepository);
    const rawSettings = await settingsRepository.getRawSettingsValue();
    const snapshot = parseStoredSettings(rawSettings);

    await updateDarkModeStartupScript(Boolean(snapshot.darkMode));
    await updateApiRequestRules(state.resultsPerPage);
  };

  const registerRuntimeListeners = (): void => {
    registerMessageListener();
    registerStorageListener();
    registerNavigationListeners();
    setupInstallListener();
  };

  return {
    initialize,
    registerRuntimeListeners,
  };
};
