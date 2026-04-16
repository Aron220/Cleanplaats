import type { BackgroundState } from '@/background/types';
import { HASH_URL_PATTERNS } from '@/shared/constants/domains';
import { getModifiedUrlIfNeeded } from '@/background/services/hash-url';

type BrowserApi = typeof browser;
type BeforeNavigateDetails = Parameters<
  BrowserApi['webNavigation']['onBeforeNavigate']['addListener']
>[0] extends (details: infer Details) => unknown
  ? Details
  : never;
type HistoryStateUpdatedDetails = Parameters<
  BrowserApi['webNavigation']['onHistoryStateUpdated']['addListener']
>[0] extends (details: infer Details) => unknown
  ? Details
  : never;

export type NavigationHandlers = {
  handleBeforeNavigate: (details: BeforeNavigateDetails) => void;
  handleHistoryStateUpdated: (details: HistoryStateUpdatedDetails) => void;
};

type Dependencies = {
  browserApi: BrowserApi;
  state: BackgroundState;
};

const isTopFrame = (details: { frameId: number; parentFrameId: number }): boolean =>
  details.frameId === 0 && details.parentFrameId === -1;

const isSupportedHashNavigation = (url: string): boolean =>
  HASH_URL_PATTERNS.some((pattern) => url.startsWith(pattern));

const rewriteUrlIfNeeded = (
  browserApi: BrowserApi,
  details: BeforeNavigateDetails | HistoryStateUpdatedDetails,
  state: BackgroundState,
): void => {
  if (!isTopFrame(details)) return;
  if (!isSupportedHashNavigation(details.url)) return;

  const rewrittenUrl = getModifiedUrlIfNeeded({
    urlString: details.url,
    resultsPerPage: state.resultsPerPage,
    defaultSortMode: state.defaultSortMode,
    sortPreferenceSource: state.sortPreferenceSource,
  });

  if (!rewrittenUrl || rewrittenUrl === details.url) {
    return;
  }

  void browserApi.tabs.update(details.tabId, { url: rewrittenUrl });

  if (
    'transitionType' in details &&
    typeof details.transitionType === 'undefined'
  ) {
    setTimeout(() => {
      void browserApi.tabs
        .get(details.tabId)
        .then((tab: { url?: string }) => {
          if (tab?.url === rewrittenUrl) {
            void browserApi.tabs.reload(details.tabId);
          }
        })
        .catch((error: unknown) => {
          console.warn('Cleanplaats: Failed checking tab before reload', error);
        });
    }, 150);
  }
};

export const createNavigationHandlers = (
  dependencies: Dependencies,
): NavigationHandlers => {
  const { browserApi, state } = dependencies;

  return {
    handleBeforeNavigate: (details) => {
      rewriteUrlIfNeeded(browserApi, details, state);
    },
    handleHistoryStateUpdated: (details) => {
      rewriteUrlIfNeeded(browserApi, details, state);
    },
  };
};
