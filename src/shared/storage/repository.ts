import type { CleanplaatsPanelState, CleanplaatsSettings } from '@/shared/types/state';
import {
  LOCAL_STORAGE_KEYS,
  STORAGE_KEYS,
} from '@/shared/constants/storage';
import {
  DEFAULT_PANEL_STATE,
  DEFAULT_SETTINGS,
} from '@/shared/constants/settings';
import {
  clonePanelState,
  cloneSettings,
  normalizePanelState,
  normalizeSettings,
  normalizeStoredBoolean,
  readBooleanString,
} from '@/shared/utils/settings-normalization';
import {
  parseStoredJson,
  stringifyStoredJson,
} from '@/shared/utils/serialization';

const browserApi = browser;

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type LoadedState = {
  settings: CleanplaatsSettings;
  panelState: CleanplaatsPanelState;
  firstRun: boolean;
};

const readDarkModePreference = (storageLike?: LocalStorageLike): boolean | undefined => {
  if (!storageLike) return undefined;

  try {
    return readBooleanString(storageLike.getItem(LOCAL_STORAGE_KEYS.darkMode));
  } catch (error) {
    console.warn('Cleanplaats: Failed reading dark mode from localStorage', error);
    return undefined;
  }
};

const persistDarkModePreference = (enabled: boolean, storageLike?: LocalStorageLike): void => {
  if (!storageLike) return;

  try {
    storageLike.setItem(LOCAL_STORAGE_KEYS.darkMode, enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('Cleanplaats: Failed writing dark mode to localStorage', error);
  }
};

const getStorageItems = async (keys: string[]): Promise<Record<string, unknown>> =>
  browserApi.storage.local.get(keys) as Promise<Record<string, unknown>>;

const setStorageItems = async (items: Record<string, unknown>): Promise<void> => {
  await browserApi.storage.local.set(items);
};

export class SettingsRepository {
  async load(storageLike: LocalStorageLike | undefined = window.localStorage): Promise<LoadedState> {
    const items = await getStorageItems([
      STORAGE_KEYS.settings,
      STORAGE_KEYS.panelState,
      STORAGE_KEYS.firstRun,
    ]);

    const rawSettings = parseStoredJson<Record<string, unknown>>(items[STORAGE_KEYS.settings]);
    const rawPanelState = parseStoredJson<Record<string, unknown>>(items[STORAGE_KEYS.panelState]);

    const settings = normalizeSettings(rawSettings);
    const panelState = normalizePanelState(rawPanelState);

    const darkModeFromLocalStorage = readDarkModePreference(storageLike);
    if (typeof darkModeFromLocalStorage === 'boolean') {
      settings.darkMode = darkModeFromLocalStorage;
    }

    const firstRun = normalizeStoredBoolean(items[STORAGE_KEYS.firstRun], true);

    return {
      settings,
      panelState,
      firstRun,
    };
  }

  async saveSettings(
    settings: CleanplaatsSettings,
    panelState: CleanplaatsPanelState,
    storageLike: LocalStorageLike | undefined = window.localStorage,
  ): Promise<void> {
    const normalizedSettings = normalizeSettings(settings);
    const normalizedPanelState = normalizePanelState(panelState);

    persistDarkModePreference(Boolean(normalizedSettings.darkMode), storageLike);

    await setStorageItems({
      [STORAGE_KEYS.settings]: stringifyStoredJson(normalizedSettings),
      [STORAGE_KEYS.panelState]: stringifyStoredJson(normalizedPanelState),
    });
  }

  async markFirstRunCompleted(): Promise<void> {
    await setStorageItems({
      [STORAGE_KEYS.firstRun]: false,
    });
  }

  async getRawSettingsValue(): Promise<string | undefined> {
    const items = await getStorageItems([STORAGE_KEYS.settings]);
    const value = items[STORAGE_KEYS.settings];
    return typeof value === 'string' ? value : undefined;
  }

  async getRawPanelStateValue(): Promise<string | undefined> {
    const items = await getStorageItems([STORAGE_KEYS.panelState]);
    const value = items[STORAGE_KEYS.panelState];
    return typeof value === 'string' ? value : undefined;
  }

  cloneDefaults(): LoadedState {
    return {
      settings: cloneSettings(DEFAULT_SETTINGS),
      panelState: clonePanelState(DEFAULT_PANEL_STATE),
      firstRun: true,
    };
  }

  parseStorageSettingsValue(rawValue: unknown): CleanplaatsSettings {
    const parsed = parseStoredJson<Record<string, unknown>>(rawValue);
    return normalizeSettings(parsed);
  }

  parseStoragePanelStateValue(rawValue: unknown): CleanplaatsPanelState {
    const parsed = parseStoredJson<Record<string, unknown>>(rawValue);
    return normalizePanelState(parsed);
  }

  parseStorageFirstRunValue(rawValue: unknown): boolean {
    return normalizeStoredBoolean(rawValue, true);
  }
}
