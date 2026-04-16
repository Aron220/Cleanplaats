import { useSyncExternalStore } from 'react';
import { getStoreSnapshot, subscribe, type StoreListener } from '@/content/runtime/store';
import type { CleanplaatsState } from '@/shared/types/state';

export const useCleanplaatsStore = (): CleanplaatsState => {
  const snapshot = useSyncExternalStore(
    subscribe as (onStoreChange: StoreListener) => () => void,
    getStoreSnapshot,
    getStoreSnapshot,
  );
  return snapshot.state;
};
