import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { getPanelLocaleText } from '@/content/locale/panel-text';
import { getState, patchPanelState, patchSettings, saveSettings } from '@/content/runtime/store';
import { useCleanplaatsStore } from '@/content/panel/use-cleanplaats-store';
import { setActivePanelViewDom } from '@/content/panel/panel-view';
import {
  addSellersToBlacklist,
  removeSellerFromBlacklist,
} from '@/content/services/blacklist-inject';
import {
  performCleanup,
  resetPreviousChanges,
} from '@/content/services/cleanup';
import { unhideListingsByTerm } from '@/content/services/blacklist-terms';
import {
  applyDarkModeToDocument,
  updateCollapsedPanelIcon,
} from '@/content/services/theme';
import {
  checkForEmptyPage,
  clearBubbleNotification,
  scheduleSellerAgeWarningCheck,
  showBlacklistTermToast,
  showUnblacklistTermToast,
  showUnblacklistToast,
} from '@/content/services/notifications';
import { wakeUpBackground } from '@/content/services/background-wake';
import { getReviewCTAConfig, isSearchResultsPage } from '@/content/utils/site';
import type { CleanplaatsPanelState, CleanplaatsSettings, SortMode } from '@/shared/types/state';
import type { SettingsRepository } from '@/shared/storage/repository';
import { CLEANPLAATS_DARK_MODE_CLASS } from '@/content/constants/ui';

type Props = {
  repository: SettingsRepository;
  onMounted?: (panel: HTMLDivElement) => void;
};

const SORT_MODES: SortMode[] = [
  'standard',
  'date_new_old',
  'date_old_new',
  'price_low_high',
  'price_high_low',
  'distance',
];

export function CleanplaatsPanel({ repository, onMounted }: Props) {
  const { settings, panelState, featureFlags, stats } = useCleanplaatsStore();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const preferencesRef = useRef<HTMLDivElement | null>(null);
  const viewsRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [termsOpen, setTermsOpen] = useState(false);
  const [sellersOpen, setSellersOpen] = useState(false);
  const [termInput, setTermInput] = useState('');
  const [sellerInput, setSellerInput] = useState('');

  const panelText = getPanelLocaleText();
  const reviewCTA = getReviewCTAConfig();

  useLayoutEffect(() => {
    if (panelRef.current) {
      onMounted?.(panelRef.current);
    }
  }, [onMounted]);

  useEffect(() => {
    const panel = panelRef.current;
    const tooltip = tooltipRef.current;
    if (!panel || !tooltip) return;

    const showTip = (text: string, icon: HTMLElement): void => {
      tooltip.textContent = text;
      tooltip.style.display = 'block';
      const rect = icon.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
      let top = rect.top - tooltipRect.height - 8;
      if (top < 8) {
        top = rect.bottom + 8;
      }
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.opacity = '1';
    };

    const hideTip = (): void => {
      tooltip.style.opacity = '0';
      tooltip.style.display = 'none';
    };

    const onEnter = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const icon = target?.closest?.('.cleanplaats-tooltip-icon') as HTMLElement | null;
      if (!icon) return;
      const text = icon.getAttribute('data-tooltip');
      if (!text) return;
      showTip(text, icon);
    };

    const onLeave = (): void => {
      hideTip();
    };

    panel.addEventListener('mouseenter', onEnter, true);
    panel.addEventListener('mouseleave', onLeave, true);
    return () => {
      panel.removeEventListener('mouseenter', onEnter, true);
      panel.removeEventListener('mouseleave', onLeave, true);
    };
  }, []);

  const persist = useCallback(async (): Promise<void> => {
    await saveSettings(repository);
  }, [repository]);

  const setView = useCallback(
    (view: CleanplaatsPanelState['activeView'], animated = true): void => {
      const current = getState().panelState.activeView;
      patchPanelState({ activeView: view });
      setActivePanelViewDom({
        activeView: current,
        nextView: view,
        filtersView: filtersRef.current,
        preferencesView: preferencesRef.current,
        viewsContainer: viewsRef.current,
        animated,
        onComplete: () => {
          void persist();
        },
      });
    },
    [persist],
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const collapsed = featureFlags.autoCollapse || panelState.isCollapsed;
    panel.classList.toggle('collapsed', collapsed);
    if (collapsed) {
      panel.classList.add('collapsed-ready');
      updateCollapsedPanelIcon(panel, settings);
    } else {
      panel.classList.remove('collapsed-ready');
      updateCollapsedPanelIcon(panel, settings);
    }
  }, [featureFlags.autoCollapse, panelState.isCollapsed, settings]);

  const handlePanelClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const panel = panelRef.current;
    if (!panel || panel.classList.contains('animating')) return;

    const isPanelCollapsed = panel.classList.contains('collapsed');
    let canToggle = false;

    if (isPanelCollapsed) {
      if (e.target === panel) {
        canToggle = true;
      }
    } else {
      const header = document.getElementById('cleanplaats-header');
      const target = e.target as Node;
      if (header?.contains(target)) {
        if (
          (e.target as HTMLElement).id === 'cleanplaats-toggle'
          || !(e.target as HTMLElement).closest?.('input, button, a, .cleanplaats-tooltip, .cleanplaats-switch')
        ) {
          canToggle = true;
        }
      }
    }

    if (!canToggle) return;

    e.preventDefault();
    e.stopPropagation();

    setTermsOpen(false);
    setSellersOpen(false);

    panel.classList.remove('collapsed-ready');
    updateCollapsedPanelIcon(panel, settings);
    panel.classList.add('animating');

    const nextCollapsed = !getState().panelState.isCollapsed;
    patchPanelState({ isCollapsed: nextCollapsed });
    panel.classList.toggle('collapsed', nextCollapsed);

    const toggle = document.getElementById('cleanplaats-toggle');
    if (toggle) {
      toggle.textContent = nextCollapsed ? '▲' : '▼';
    }

    const fallbackTimeout = window.setTimeout(() => {
      panel.classList.remove('animating');
      if (nextCollapsed) {
        panel.classList.add('collapsed-ready');
        updateCollapsedPanelIcon(panel, getState().settings);
      }
    }, 600);

    const onTransitionEnd = (event: TransitionEvent): void => {
      if (nextCollapsed && event.propertyName === 'width') {
        panel.classList.add('collapsed-ready');
        updateCollapsedPanelIcon(panel, getState().settings);
        panel.classList.remove('animating');
        panel.removeEventListener('transitionend', onTransitionEnd);
        clearTimeout(fallbackTimeout);
      } else if (!nextCollapsed && event.propertyName === 'max-height') {
        panel.classList.remove('animating');
        updateCollapsedPanelIcon(panel, getState().settings);
        panel.removeEventListener('transitionend', onTransitionEnd);
        clearTimeout(fallbackTimeout);
      }
    };
    panel.addEventListener('transitionend', onTransitionEnd);

    void persist();
  };

  const handleThemeToggle = (): void => {
    const next = !settings.darkMode;
    patchSettings({ darkMode: next });
    applyDarkModeToDocument(next, panelRef.current, getState().settings);
    void persist().catch((error) => {
      console.error('Cleanplaats: Failed to apply dark mode', error);
      patchSettings({ darkMode: !next });
      applyDarkModeToDocument(!next, panelRef.current, getState().settings);
    });
  };

  const applyFilterSetting = async (key: keyof CleanplaatsSettings, value: boolean): Promise<void> => {
    patchSettings({ [key]: value } as Partial<CleanplaatsSettings>);
    if (key === 'sellerAgeWarningEnabled') {
      getState().runtime.lastSellerAgeWarningKey = '';
    }
    try {
      await persist();
      if (key === 'sellerAgeWarningEnabled') {
        scheduleSellerAgeWarningCheck({ force: true });
        return;
      }
      resetPreviousChanges(getState());
      performCleanup(getState());
      clearBubbleNotification();
      checkForEmptyPage();
    } catch (error) {
      console.error('Cleanplaats: Failed to apply setting', error);
    }
  };

  const handleCheckbox =
    (key: keyof CleanplaatsSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
      void applyFilterSetting(key, e.target.checked);
    };

  const handleResultsChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const value = Number.parseInt(e.target.value, 10) as CleanplaatsSettings['resultsPerPage'];
    patchSettings({ resultsPerPage: value });
    wakeUpBackground();
    void persist().then(() => {
      if (isSearchResultsPage()) {
        setTimeout(() => window.location.reload(), 1000);
      }
    });
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const value = e.target.value as SortMode;
    patchSettings({ defaultSortMode: value, sortPreferenceSource: 'cleanplaats' });
    wakeUpBackground();
    void persist().then(() => {
      if (isSearchResultsPage()) {
        setTimeout(() => window.location.reload(), 1000);
      }
    });
  };

  const handleThresholdChange = (): void => {
    const valueInput = document.getElementById(
      'cleanplaats-seller-age-threshold-value',
    ) as HTMLInputElement | null;
    const unitSelect = document.getElementById(
      'cleanplaats-seller-age-threshold-unit',
    ) as HTMLSelectElement | null;
    if (!valueInput || !unitSelect) return;

    const nextValue = Math.min(99, Math.max(1, Number.parseInt(valueInput.value, 10) || 1));
    valueInput.value = String(nextValue);
    patchSettings({
      sellerAgeWarningThresholdValue: nextValue,
      sellerAgeWarningThresholdUnit: unitSelect.value as CleanplaatsSettings['sellerAgeWarningThresholdUnit'],
    });
    getState().runtime.lastSellerAgeWarningKey = '';
    void persist().then(() => {
      scheduleSellerAgeWarningCheck({ force: true });
    });
  };

  const handleThresholdInput = (e: React.FormEvent<HTMLInputElement>): void => {
    const raw = String(e.currentTarget.value || '').replace(/\D/g, '');
    if (!raw) return;
    const nextValue = Math.min(99, Math.max(1, Number.parseInt(raw, 10) || 1));
    e.currentTarget.value = String(nextValue);
    patchSettings({ sellerAgeWarningThresholdValue: nextValue });
    getState().runtime.lastSellerAgeWarningKey = '';
    void persist();
  };

  const addTerm = (e?: FormEvent): void => {
    e?.preventDefault();
    const term = termInput.trim();
    if (!term || settings.blacklistedTerms.includes(term)) return;
    patchSettings({ blacklistedTerms: [...settings.blacklistedTerms, term] });
    setTermInput('');
    void persist().then(() => {
      performCleanup(getState());
      showBlacklistTermToast(term);
    });
  };

  const removeTerm = (term: string): void => {
    patchSettings({
      blacklistedTerms: settings.blacklistedTerms.filter((t) => t !== term),
    });
    void persist().then(() => {
      unhideListingsByTerm(term);
      performCleanup(getState());
      showUnblacklistTermToast(term);
    });
  };

  const addSellersFromInput = (): void => {
    const names = sellerInput
      .split(/[;,]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    setSellerInput('');
    void addSellersToBlacklist(names);
  };

  const removeSeller = (sellerName: string): void => {
    showUnblacklistToast(sellerName);
    void removeSellerFromBlacklist(sellerName);
  };

  const logoUrl = browser.runtime.getURL('icons/icon128.png');

  return (
    <>
      <div
        ref={panelRef}
        id="cleanplaats-panel"
        className={`cleanplaats-panel ${settings.darkMode ? CLEANPLAATS_DARK_MODE_CLASS : ''}`}
        onClick={handlePanelClick}
      >
        <div className="cleanplaats-header" id="cleanplaats-header">
          <div className="cleanplaats-header-main">
            <h3>
              <img
                id="cleanplaats-header-logo"
                className="cleanplaats-header-logo"
                alt="Cleanplaats logo"
                src={logoUrl}
              />
              Cleanplaats
            </h3>
            <div className="cleanplaats-header-actions">
              <button
                id="cleanplaats-theme-toggle"
                className="cleanplaats-theme-toggle"
                type="button"
                role="switch"
                aria-label={panelText.darkModeLabel}
                aria-checked={settings.darkMode ? 'true' : 'false'}
                aria-pressed={settings.darkMode ? 'true' : 'false'}
                data-theme={settings.darkMode ? 'dark' : 'light'}
                title={panelText.darkModeTooltip}
                onClick={(e) => {
                  e.stopPropagation();
                  handleThemeToggle();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleThemeToggle();
                  }
                }}
              >
                <span className="cleanplaats-theme-toggle-track" aria-hidden="true">
                  <span className="cleanplaats-theme-toggle-icon cleanplaats-theme-toggle-icon-moon">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path
                        d="M14.8 2.2a.75.75 0 0 1 .79 1.07A8.25 8.25 0 1 0 20.73 8.4a.75.75 0 0 1 1.07.79A9.75 9.75 0 1 1 14.8 2.2Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span className="cleanplaats-theme-toggle-icon cleanplaats-theme-toggle-icon-sun">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <circle cx="12" cy="12" r="4.25" fill="currentColor" />
                      <path
                        d="M12 1.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm0 17.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm10.25-7.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 .75.75ZM4.5 12.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 0 1.5Zm14.42 6.73a.75.75 0 0 1-1.06 0l-1.42-1.41a.75.75 0 0 1 1.06-1.06l1.42 1.41a.75.75 0 0 1 0 1.06Zm-11.36-11.36a.75.75 0 0 1-1.06 0L5.08 6.7a.75.75 0 1 1 1.06-1.06l1.42 1.42a.75.75 0 0 1 0 1.06Zm0 9.94-1.42 1.41a.75.75 0 1 1-1.06-1.06l1.42-1.41a.75.75 0 0 1 1.06 1.06Zm11.36-11.36-1.42 1.42a.75.75 0 0 1-1.06-1.06l1.42-1.42a.75.75 0 1 1 1.06 1.06Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span className="cleanplaats-theme-toggle-thumb">
                    <span className="cleanplaats-theme-toggle-thumb-icon cleanplaats-theme-toggle-thumb-icon-moon">
                      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                        <path
                          d="M14.8 2.2a.75.75 0 0 1 .79 1.07A8.25 8.25 0 1 0 20.73 8.4a.75.75 0 0 1 1.07.79A9.75 9.75 0 1 1 14.8 2.2Z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                    <span className="cleanplaats-theme-toggle-thumb-icon cleanplaats-theme-toggle-thumb-icon-sun">
                      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                        <circle cx="12" cy="12" r="4.25" fill="currentColor" />
                        <path
                          d="M12 1.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm0 17.75a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 1 .75-.75Zm10.25-7.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 .75.75ZM4.5 12.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 0 1.5Zm14.42 6.73a.75.75 0 0 1-1.06 0l-1.42-1.41a.75.75 0 0 1 1.06-1.06l1.42 1.41a.75.75 0 0 1 0 1.06Zm-11.36-11.36a.75.75 0 0 1-1.06 0L5.08 6.7a.75.75 0 1 1 1.06-1.06l1.42 1.42a.75.75 0 0 1 0 1.06Zm0 9.94-1.42 1.41a.75.75 0 1 1-1.06-1.06l1.42-1.41a.75.75 0 0 1 1.06 1.06Zm11.36-11.36-1.42 1.42a.75.75 0 0 1-1.06-1.06l1.42-1.42a.75.75 0 1 1 1.06 1.06Z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                  </span>
                </span>
              </button>
              <button
                id="cleanplaats-toggle"
                className="cleanplaats-toggle"
                type="button"
                aria-label="Paneel inklappen of uitklappen"
              >
                {panelState.isCollapsed ? '▲' : '▼'}
              </button>
            </div>
          </div>
          <div className="cleanplaats-contact-grid">
            <a
              href="https://github.com/Aron220/Cleanplaats/issues"
              className="cleanplaats-contact cleanplaats-external-link"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={panelText.feedbackAriaLabel}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(e.currentTarget.href, '_blank', 'noopener,noreferrer');
              }}
            >
              <span className="cleanplaats-contact-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.9.58.1.79-.25.79-.56v-2.17c-3.2.69-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.76 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.47.11-3.07 0 0 .97-.31 3.18 1.18a10.96 10.96 0 0 1 5.8 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.6.23 2.78.11 3.07.73.8 1.18 1.82 1.18 3.08 0 4.42-2.68 5.4-5.24 5.68.41.35.78 1.04.78 2.1v3.11c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                </svg>
              </span>
              <span className="cleanplaats-contact-copy">
                <span className="cleanplaats-contact-title">{panelText.feedbackLabel}</span>
                <span className="cleanplaats-contact-text">{panelText.feedbackText}</span>
              </span>
            </a>
            <a
              href={reviewCTA.url}
              className="cleanplaats-contact cleanplaats-external-link"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={panelText.reviewAriaLabel(reviewCTA.linkLabel)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(e.currentTarget.href, '_blank', 'noopener,noreferrer');
              }}
            >
              <span className="cleanplaats-contact-icon" aria-hidden="true">
                ★
              </span>
              <span className="cleanplaats-contact-copy">
                <span className="cleanplaats-contact-title">Review</span>
                <span className="cleanplaats-contact-text">{reviewCTA.linkLabel}</span>
              </span>
            </a>
          </div>
        </div>

        <div className="cleanplaats-content">
          <div className="cleanplaats-panel-views" id="cleanplaats-panel-views" ref={viewsRef}>
            <div
              className={`cleanplaats-panel-view ${panelState.activeView === 'filters' ? 'active' : ''}`}
              id="cleanplaats-view-filters"
              ref={filtersRef}
            >
              <a
                href="https://buymeacoffee.com/cleanplaats"
                className="cleanplaats-bmc-button"
                target="_blank"
                rel="noopener"
                title={panelText.supportTitle}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <span className="cleanplaats-bmc-emoji">☕</span>
                <span className="cleanplaats-bmc-text">{panelText.supportButton}</span>
              </a>
              <div className="cleanplaats-options">
                <div className="cleanplaats-section-title">{panelText.optionsTitle}</div>

                {(
                  [
                    ['removeTopAds', panelText.topAdLabel, panelText.topAdTooltip],
                    ['removeDagtoppers', panelText.dagtoppersLabel, panelText.dagtoppersTooltip],
                    ['removePromotedListings', panelText.promotedListingsLabel, panelText.promotedListingsTooltip],
                    ['removeOpvalStickers', panelText.stickersLabel, panelText.stickersTooltip],
                    ['removeReservedListings', panelText.reservedLabel, panelText.reservedTooltip],
                  ] as const
                ).map(([id, label, tip]) => (
                  <div key={id} className="cleanplaats-option">
                    <label className="cleanplaats-switch">
                      <input
                        type="checkbox"
                        id={id}
                        checked={Boolean(settings[id])}
                        onChange={handleCheckbox(id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="cleanplaats-switch-slider" />
                    </label>
                    <label htmlFor={id} className="cleanplaats-option-label">
                      {label}
                      <span className="cleanplaats-tooltip-icon" data-tooltip={tip}>
                        ?
                      </span>
                    </label>
                  </div>
                ))}

                <button
                  id="cleanplaats-open-preferences"
                  className="cleanplaats-button secondary cleanplaats-panel-nav-button"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setView('preferences');
                  }}
                >
                  {panelText.preferencesLabel}
                </button>

                <div className="cleanplaats-option cleanplaats-results-dropdown-row">
                  <label htmlFor="cleanplaats-results-dropdown" className="cleanplaats-option-label" style={{ minWidth: 120 }}>
                    {panelText.resultsPerPageLabel}
                  </label>
                  <select
                    id="cleanplaats-results-dropdown"
                    className="cleanplaats-results-dropdown"
                    value={String(settings.resultsPerPage)}
                    onChange={handleResultsChange}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="30">30</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>

                <div className="cleanplaats-option cleanplaats-results-dropdown-row">
                  <label htmlFor="cleanplaats-sort-dropdown" className="cleanplaats-option-label" style={{ minWidth: 120 }}>
                    {panelText.defaultSortLabel}
                  </label>
                  <select
                    id="cleanplaats-sort-dropdown"
                    className="cleanplaats-results-dropdown"
                    value={settings.defaultSortMode}
                    onChange={handleSortChange}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {SORT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {panelText.sortOptions[mode]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {featureFlags.showStats ? (
                <div className="cleanplaats-stats cleanplaats-stats-compact" id="cleanplaats-stats">
                  <div className="cleanplaats-section-title">{panelText.statsTitle}</div>
                  <div className="cleanplaats-stat-item">
                    <span className="cleanplaats-stat-label">{panelText.statsTop}</span>
                    <span className="cleanplaats-stat-value" id="cleanplaats-topads-count">
                      {stats.topAdsRemoved}
                    </span>
                  </div>
                  <div className="cleanplaats-stat-item">
                    <span className="cleanplaats-stat-label">{panelText.statsDagtoppers}</span>
                    <span className="cleanplaats-stat-value" id="cleanplaats-dagtoppers-count">
                      {stats.dagtoppersRemoved}
                    </span>
                  </div>
                  <div className="cleanplaats-stat-item">
                    <span className="cleanplaats-stat-label">{panelText.statsBusiness}</span>
                    <span className="cleanplaats-stat-value" id="cleanplaats-promoted-count">
                      {stats.promotedListingsRemoved}
                    </span>
                  </div>
                  <div className="cleanplaats-stat-item">
                    <span className="cleanplaats-stat-label">{panelText.statsStickers}</span>
                    <span className="cleanplaats-stat-value" id="cleanplaats-stickers-count">
                      {stats.opvalStickersRemoved}
                    </span>
                  </div>
                  <div className="cleanplaats-stat-item">
                    <span className="cleanplaats-stat-label">{panelText.statsOther}</span>
                    <span className="cleanplaats-stat-value" id="cleanplaats-otherads-count">
                      {stats.otherAdsRemoved}
                    </span>
                  </div>
                  <div className="cleanplaats-stat-item">
                    <span className="cleanplaats-stat-label">{panelText.statsTotal}</span>
                    <span className="cleanplaats-stat-value" id="cleanplaats-total-count-stats">
                      {stats.totalRemoved}
                    </span>
                  </div>
                </div>
              ) : null}

              <button
                id="cleanplaats-manage-terms"
                type="button"
                className="cleanplaats-button cleanplaats-blacklist-manage-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSellersOpen(false);
                  setTermsOpen((o) => !o);
                }}
              >
                {panelText.manageTerms}
              </button>
              <button
                id="cleanplaats-manage-blacklist"
                type="button"
                className="cleanplaats-button cleanplaats-blacklist-manage-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTermsOpen(false);
                  setSellersOpen((o) => !o);
                }}
              >
                {panelText.manageSellers}
              </button>
            </div>

            <div
              className={`cleanplaats-panel-view ${panelState.activeView === 'preferences' ? 'active' : ''}`}
              id="cleanplaats-view-preferences"
              ref={preferencesRef}
            >
              <div className="cleanplaats-panel-view-header">
                <div className="cleanplaats-panel-view-topline">
                  <button
                    id="cleanplaats-back-to-filters"
                    className="cleanplaats-panel-back"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setView('filters');
                    }}
                  >
                    {panelText.backLabel}
                  </button>
                  <div className="cleanplaats-panel-view-title">{panelText.preferencesLabel}</div>
                </div>
              </div>
              <div className="cleanplaats-options">
                <div className="cleanplaats-option cleanplaats-option-preference">
                  <label className="cleanplaats-switch">
                    <input
                      type="checkbox"
                      id="removeFavoriteRelatedAds"
                      checked={settings.removeFavoriteRelatedAds}
                      onChange={handleCheckbox('removeFavoriteRelatedAds')}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="cleanplaats-switch-slider" />
                  </label>
                  <label htmlFor="removeFavoriteRelatedAds" className="cleanplaats-option-label">
                    <span className="cleanplaats-option-label-text">
                      {panelText.favoriteRelatedAdsLabel}
                      <span className="cleanplaats-tooltip-icon" data-tooltip={panelText.favoriteRelatedAdsTooltip}>
                        ?
                      </span>
                    </span>
                  </label>
                </div>

                <div className="cleanplaats-option cleanplaats-option-preference cleanplaats-option-preference-block">
                  <div className="cleanplaats-option-main">
                    <label className="cleanplaats-switch">
                      <input
                        type="checkbox"
                        id="sellerAgeWarningEnabled"
                        checked={settings.sellerAgeWarningEnabled}
                        onChange={handleCheckbox('sellerAgeWarningEnabled')}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="cleanplaats-switch-slider" />
                    </label>
                    <label htmlFor="sellerAgeWarningEnabled" className="cleanplaats-option-label">
                      <span className="cleanplaats-option-label-text">
                        {panelText.sellerAgeWarningLabel}
                        <span className="cleanplaats-tooltip-icon" data-tooltip={panelText.sellerAgeWarningTooltip}>
                          ?
                        </span>
                      </span>
                    </label>
                  </div>
                  <div
                    className={`cleanplaats-threshold-controls ${settings.sellerAgeWarningEnabled ? '' : 'is-disabled'}`}
                    id="cleanplaats-seller-age-threshold-controls"
                  >
                    <label htmlFor="cleanplaats-seller-age-threshold-value" className="cleanplaats-threshold-label">
                      {panelText.sellerAgeWarningThresholdLabel}
                    </label>
                    <input
                      key={`th-val-${settings.sellerAgeWarningThresholdValue}`}
                      type="number"
                      min={1}
                      max={99}
                      step={1}
                      id="cleanplaats-seller-age-threshold-value"
                      className="cleanplaats-threshold-input"
                      aria-label={panelText.sellerAgeWarningThresholdValueAriaLabel}
                      defaultValue={Math.max(1, settings.sellerAgeWarningThresholdValue)}
                      disabled={!settings.sellerAgeWarningEnabled}
                      onInput={handleThresholdInput}
                      onChange={handleThresholdChange}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <select
                      key={`th-unit-${settings.sellerAgeWarningThresholdUnit}`}
                      id="cleanplaats-seller-age-threshold-unit"
                      className="cleanplaats-results-dropdown cleanplaats-threshold-unit"
                      aria-label={panelText.sellerAgeWarningThresholdUnitAriaLabel}
                      defaultValue={settings.sellerAgeWarningThresholdUnit}
                      disabled={!settings.sellerAgeWarningEnabled}
                      onChange={handleThresholdChange}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(Object.keys(panelText.sellerAgeWarningThresholdUnits) as Array<
                        keyof typeof panelText.sellerAgeWarningThresholdUnits
                      >).map((unit) => (
                        <option key={unit} value={unit}>
                          {panelText.sellerAgeWarningThresholdUnits[unit]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            id="cleanplaats-blacklist-modal"
            className="cleanplaats-blacklist-modal"
            style={{ display: sellersOpen ? 'block' : 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {sellersOpen ? (
              <div className="cleanplaats-blacklist-modal-content">
                <h4>{panelText.sellersModalTitle}</h4>
                <ul id="cleanplaats-blacklist-list">
                  {settings.blacklistedSellers.length === 0 ? (
                    <li>
                      <em>{panelText.sellersEmpty}</em>
                    </li>
                  ) : (
                    settings.blacklistedSellers.map((seller) => (
                      <li key={seller}>
                        <span>{seller}</span>
                        <button
                          type="button"
                          className="cleanplaats-unblacklist-btn"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'green';
                            e.currentTarget.textContent = panelText.unhideButton;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#ff4d4d';
                            e.currentTarget.textContent = panelText.hiddenButton;
                          }}
                          style={{ background: '#ff4d4d', color: 'white' }}
                          onClick={() => removeSeller(seller)}
                        >
                          {panelText.hiddenButton}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="cleanplaats-terms-input-row">
                  <input
                    type="text"
                    id="cleanplaats-seller-input"
                    className="cleanplaats-term-input"
                    placeholder={panelText.sellerInputPlaceholder}
                    value={sellerInput}
                    onChange={(e) => setSellerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addSellersFromInput();
                      }
                    }}
                  />
                  <button type="button" id="cleanplaats-add-seller" className="cleanplaats-add-term-btn" onClick={addSellersFromInput}>
                    {panelText.addButton}
                  </button>
                </div>
                <div className="cleanplaats-input-help">{panelText.sellerInputHelp}</div>
                <button type="button" id="cleanplaats-blacklist-close" style={{ marginTop: 10 }} onClick={() => setSellersOpen(false)}>
                  {panelText.closeButton}
                </button>
              </div>
            ) : null}
          </div>

          <div
            id="cleanplaats-terms-modal"
            className="cleanplaats-terms-modal"
            style={{ display: termsOpen ? 'block' : 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {termsOpen ? (
              <div className="cleanplaats-terms-modal-content">
                <h4>{panelText.termsModalTitle}</h4>
                <ul id="cleanplaats-terms-list">
                  {settings.blacklistedTerms.length === 0 ? (
                    <li>
                      <em>{panelText.termsEmpty}</em>
                    </li>
                  ) : (
                    settings.blacklistedTerms.map((term) => (
                      <li key={term}>
                        <span>{term}</span>
                        <button
                          type="button"
                          className="cleanplaats-unblacklist-term-btn"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'green';
                            e.currentTarget.textContent = panelText.unhideButton;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#ff4d4d';
                            e.currentTarget.textContent = panelText.hiddenButton;
                          }}
                          style={{ background: '#ff4d4d', color: 'white' }}
                          onClick={() => removeTerm(term)}
                        >
                          {panelText.hiddenButton}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <form
                  className="cleanplaats-terms-input-row"
                  onSubmit={addTerm}
                >
                  <input
                    type="text"
                    id="cleanplaats-term-input"
                    className="cleanplaats-term-input"
                    placeholder={panelText.termInputPlaceholder}
                    value={termInput}
                    onChange={(e) => setTermInput(e.target.value)}
                  />
                  <button type="submit" id="cleanplaats-add-term" className="cleanplaats-add-term-btn">
                    {panelText.addButton}
                  </button>
                </form>
                <div className="cleanplaats-input-help">{panelText.termInputHelp}</div>
                <button type="button" id="cleanplaats-terms-close" style={{ marginTop: 12 }} onClick={() => setTermsOpen(false)}>
                  {panelText.closeButton}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        ref={tooltipRef}
        id="cleanplaats-global-tooltip"
        className="cleanplaats-global-tooltip"
        style={{ display: 'none' }}
      />
    </>
  );
}
