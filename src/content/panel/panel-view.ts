import type { CleanplaatsPanelState } from '@/shared/types/state';

type PanelView = CleanplaatsPanelState['activeView'];

const clearPanelViewAnimationState = (viewElement: HTMLElement | null): void => {
  if (!viewElement) {
    return;
  }
  viewElement.classList.remove(
    'active',
    'is-entering',
    'is-leaving',
    'is-entering-down',
    'is-entering-up',
    'is-leaving-down',
    'is-leaving-up',
  );
};

const getPanelViewDirection = (fromView: PanelView, toView: PanelView): 'up' | 'down' | 'none' => {
  if (fromView === toView) {
    return 'none';
  }
  return toView === 'preferences' ? 'down' : 'up';
};

const syncPanelViewContainerHeight = (viewsContainer: HTMLElement | null, activeView: HTMLElement | null): void => {
  if (!viewsContainer || !activeView) {
    return;
  }
  viewsContainer.style.height = `${activeView.scrollHeight}px`;
};

const measurePanelViewHeight = (
  viewElement: HTMLElement,
  viewsContainer: HTMLElement,
): number => {
  const clone = viewElement.cloneNode(true) as HTMLElement;
  const measurementWrapper = document.createElement('div');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((element) => {
    element.removeAttribute('id');
  });

  clearPanelViewAnimationState(clone);
  clone.classList.add('active');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.position = 'relative';
  clone.style.visibility = 'hidden';
  clone.style.pointerEvents = 'none';
  clone.style.opacity = '0';
  clone.style.transform = 'translateY(0)';

  measurementWrapper.setAttribute('aria-hidden', 'true');
  measurementWrapper.style.position = 'absolute';
  measurementWrapper.style.top = '0';
  measurementWrapper.style.right = '0';
  measurementWrapper.style.left = '0';
  measurementWrapper.style.visibility = 'hidden';
  measurementWrapper.style.pointerEvents = 'none';
  measurementWrapper.style.opacity = '0';
  measurementWrapper.style.overflow = 'visible';

  measurementWrapper.appendChild(clone);
  viewsContainer.appendChild(measurementWrapper);
  const height = clone.getBoundingClientRect().height;
  measurementWrapper.remove();

  return height;
};

export const setActivePanelViewDom = (options: {
  activeView: PanelView;
  nextView: PanelView;
  filtersView: HTMLElement | null;
  preferencesView: HTMLElement | null;
  viewsContainer: HTMLElement | null;
  animated: boolean;
  onComplete: (nextView: PanelView) => void;
}): void => {
  const {
    activeView: currentView,
    nextView,
    filtersView,
    preferencesView,
    viewsContainer,
    animated,
    onComplete,
  } = options;

  if (!filtersView || !preferencesView || !viewsContainer) {
    return;
  }

  const currentElement = currentView === 'preferences' ? preferencesView : filtersView;
  const nextElement = nextView === 'preferences' ? preferencesView : filtersView;

  if (currentView === nextView) {
    clearPanelViewAnimationState(filtersView);
    clearPanelViewAnimationState(preferencesView);
    nextElement.classList.add('active');
    syncPanelViewContainerHeight(viewsContainer, nextElement);
    onComplete(nextView);
    return;
  }

  if (!animated) {
    clearPanelViewAnimationState(filtersView);
    clearPanelViewAnimationState(preferencesView);
    nextElement.classList.add('active');
    syncPanelViewContainerHeight(viewsContainer, nextElement);
    onComplete(nextView);
    return;
  }

  const direction = getPanelViewDirection(currentView, nextView);
  const fromHeight = currentElement.scrollHeight;
  const nextHeight = measurePanelViewHeight(nextElement, viewsContainer);

  clearPanelViewAnimationState(filtersView);
  clearPanelViewAnimationState(preferencesView);

  currentElement.classList.add(
    'active',
    'is-leaving',
    direction === 'down' ? 'is-leaving-up' : 'is-leaving-down',
  );
  nextElement.classList.add(
    'active',
    'is-entering',
    direction === 'down' ? 'is-entering-down' : 'is-entering-up',
  );

  viewsContainer.style.height = `${fromHeight}px`;
  void viewsContainer.offsetHeight;

  requestAnimationFrame(() => {
    viewsContainer.style.height = `${nextHeight}px`;
    currentElement.classList.remove(direction === 'down' ? 'is-leaving-up' : 'is-leaving-down');
    nextElement.classList.remove(direction === 'down' ? 'is-entering-down' : 'is-entering-up');
  });

  window.clearTimeout(
    (viewsContainer as HTMLElement & { _cleanplaatsViewAnimationTimer?: number })
      ._cleanplaatsViewAnimationTimer,
  );
  (viewsContainer as HTMLElement & { _cleanplaatsViewAnimationTimer?: number })._cleanplaatsViewAnimationTimer =
    window.setTimeout(() => {
      clearPanelViewAnimationState(currentElement);
      clearPanelViewAnimationState(nextElement);
      nextElement.classList.add('active');
      syncPanelViewContainerHeight(viewsContainer, nextElement);
      onComplete(nextView);
    }, 340);
};
