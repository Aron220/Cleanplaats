import { LOCAL_STORAGE_KEYS, STORAGE_KEYS } from '@/shared/constants/storage';
import { DEFAULT_PANEL_STATE, DEFAULT_SETTINGS } from '@/shared/constants/settings';
import { SettingsRepository } from '@/shared/storage/repository';
import type {
  CleanplaatsPanelState,
  CleanplaatsSettings,
  CleanplaatsState,
} from '@/shared/types/state';

export type StoreListener = () => void;

const createInitialRuntimeState = (): CleanplaatsState => ({
  settings: { ...DEFAULT_SETTINGS },
  stats: {
    topAdsRemoved: 0,
    dagtoppersRemoved: 0,
    promotedListingsRemoved: 0,
    opvalStickersRemoved: 0,
    otherAdsRemoved: 0,
    totalRemoved: 0,
  },
  observers: {
    mutation: null,
    ads: null,
    webchat: null,
    sellerAge: null,
  },
  runtime: {
    lastSellerAgeWarningKey: '',
    sellerAgeCheckTimer: 0,
  },
  featureFlags: {
    showStats: true,
    autoCollapse: false,
    firstRun: true,
  },
  panelState: { ...DEFAULT_PANEL_STATE },
});

let state: CleanplaatsState = createInitialRuntimeState();
let storeVersion = 0;
const listeners = new Set<StoreListener>();

export const getStoreVersion = (): number => storeVersion;

let cachedStoreSnapshot: { version: number; state: CleanplaatsState } | null = null;

/** Snapshot for React `useSyncExternalStore` (stable reference until version bumps). */
export const getStoreSnapshot = (): { version: number; state: CleanplaatsState } => {
  if (!cachedStoreSnapshot || cachedStoreSnapshot.version !== storeVersion) {
    cachedStoreSnapshot = { version: storeVersion, state };
  }
  return cachedStoreSnapshot;
};

export const getState = (): CleanplaatsState => state;

export const subscribe = (listener: StoreListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const emit = (): void => {
  storeVersion += 1;
  listeners.forEach((listener) => {
    listener();
  });
};

export const resetStats = (): void => {
  const stats = state.stats;
  stats.topAdsRemoved = 0;
  stats.dagtoppersRemoved = 0;
  stats.promotedListingsRemoved = 0;
  stats.opvalStickersRemoved = 0;
  stats.otherAdsRemoved = 0;
  stats.totalRemoved = 0;
  emit();
};

export const updateTotalRemoved = (): void => {
  const s = state.stats;
  s.totalRemoved =
    s.topAdsRemoved
    + s.dagtoppersRemoved
    + s.promotedListingsRemoved
    + s.opvalStickersRemoved
    + s.otherAdsRemoved;
};

export const patchSettings = (partial: Partial<CleanplaatsSettings>): void => {
  state.settings = { ...state.settings, ...partial };
  emit();
};

export const patchPanelState = (partial: Partial<CleanplaatsPanelState>): void => {
  state.panelState = { ...state.panelState, ...partial };
  emit();
};

export const setFirstRunFlag = (firstRun: boolean): void => {
  state.featureFlags.firstRun = firstRun;
  emit();
};

let storageSyncRegistered = false;

export const registerSettingsStorageSync = (
  onDarkModeFromSync: (enabled: boolean) => void,
): void => {
  if (storageSyncRegistered || !browser.storage.onChanged.addListener) {
    return;
  }

  browser.storage.onChanged.addListener(
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local' || !changes[STORAGE_KEYS.settings]?.newValue) {
        return;
      }

      try {
        const newValue = changes[STORAGE_KEYS.settings]?.newValue;
        const nextSettings =
          typeof newValue === 'string' ? (JSON.parse(newValue) as { darkMode?: boolean }) : {};
        const darkModeEnabled = Boolean(nextSettings?.darkMode);

        if (state.settings.darkMode !== darkModeEnabled) {
          patchSettings({ darkMode: darkModeEnabled });
          onDarkModeFromSync(darkModeEnabled);
        } else {
          persistDarkModeFromStore();
        }
      } catch (error) {
        console.error('Cleanplaats: Failed to sync dark mode from storage', error);
      }
    },
  );

  storageSyncRegistered = true;
};

const persistDarkModeFromStore = (): void => {
  try {
    window.localStorage.setItem(
      LOCAL_STORAGE_KEYS.darkMode,
      state.settings.darkMode ? 'true' : 'false',
    );
  } catch {
    /* ignore */
  }
};

export const notifyStatsChanged = (): void => {
  updateTotalRemoved();
  emit();
};

export const saveSettings = async (repository: SettingsRepository): Promise<void> => {
  await repository.saveSettings(state.settings, state.panelState);
  emit();
};

export const loadInitialState = async (repository: SettingsRepository): Promise<void> => {
  const raw = (await browser.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.panelState,
    STORAGE_KEYS.firstRun,
  ])) as Record<string, unknown>;

  const loaded = await repository.load();
  state.settings = loaded.settings;
  state.panelState = loaded.panelState;

  const firstRunKeyPresent = Object.prototype.hasOwnProperty.call(raw, STORAGE_KEYS.firstRun);
  if (!firstRunKeyPresent) {
    await repository.markFirstRunCompleted();
    state.featureFlags.firstRun = true;
  } else {
    state.featureFlags.firstRun = loaded.firstRun;
  }

  emit();
};

export const markFirstRunCompleted = async (repository: SettingsRepository): Promise<void> => {
  await repository.markFirstRunCompleted();
  state.featureFlags.firstRun = false;
  emit();
};
