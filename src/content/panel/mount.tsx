import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { CleanplaatsPanel } from '@/content/panel/CleanplaatsPanel';
import type { SettingsRepository } from '@/shared/storage/repository';

import '@/styles/dark-mode.css';

export type MountOptions = {
  repository: SettingsRepository;
  onMounted?: (panel: HTMLDivElement) => void;
};

let root: Root | null = null;

export const mountControlPanel = (options: MountOptions): void => {
  if (document.getElementById('cleanplaats-panel')) {
    return;
  }

  const container = document.createElement('div');
  container.id = 'cleanplaats-panel-root';
  document.body.appendChild(container);

  root = createRoot(container);
  const panelProps =
    options.onMounted === undefined
      ? { repository: options.repository }
      : { repository: options.repository, onMounted: options.onMounted };
  root.render(createPortal(<CleanplaatsPanel {...panelProps} />, document.body));
};

export const unmountControlPanel = (): void => {
  root?.unmount();
  root = null;
  document.getElementById('cleanplaats-panel-root')?.remove();
};
