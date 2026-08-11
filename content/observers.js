/**
 * Content-script observers and navigation handling.
 */

function performCleanupAndCheckForEmptyPage() {
    const existingNotification = document.getElementById('cleanplaats-empty-notification');
    if (existingNotification) {
        existingNotification.remove();
        notificationVisible = false;
    }

    clearBubbleNotification();
    scheduleSellerAgeWarningCheck({ resetState: true });

    // Marktplaats pages client-side, so this is the only moment we learn we are
    // looking at a different result set. Without this the counters keep summing
    // across every page visited and report far more removals than the page holds.
    resetStats();

    let attempts = 0;
    const checkContentLoaded = setInterval(() => {
        const hasContent = document.querySelector(CLEANPLAATS_LISTING_SELECTOR)
            || document.querySelector('#adsense-container');

        // Give up after ~10s instead of polling for the lifetime of the tab: some
        // pages (a listing detail page, an empty search) never render a card at all.
        if (!hasContent && ++attempts < 100) {
            return;
        }

        clearInterval(checkContentLoaded);

        if (!hasContent) {
            return;
        }

        console.log('Cleanplaats: Running cleanup after navigation');
        performCleanup();
        injectBlacklistButtons();

        setTimeout(checkForEmptyPage, 500);
    }, 100);
}

// Debounce so a burst of mutations collapses into one pass (a full cleanup per
// mutation froze the page on mobile viewports), but with a hard ceiling: the
// homepage feed mutates continuously while the user scrolls, and a plain trailing
// debounce keeps getting pushed forward so the cleanup never actually runs.
const CLEANPLAATS_CLEANUP_DEBOUNCE_MS = 80;
const CLEANPLAATS_CLEANUP_MAX_DELAY_MS = 500;

const CLEANPLAATS_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
};

function runScheduledCleanup() {
    clearTimeout(CLEANPLAATS.runtime.cleanupTimer);
    CLEANPLAATS.runtime.cleanupTimer = 0;
    CLEANPLAATS.runtime.lastCleanupAt = Date.now();

    // Hiding listings and injecting our own buttons happens *inside* listing cards,
    // which is exactly what triggers a cleanup now. Stop observing for the duration
    // of the pass so our own writes cannot schedule the next one forever.
    const observer = CLEANPLAATS.observers.mutation;
    observer?.disconnect();

    try {
        performCleanup();
        injectBlacklistButtons();
    } finally {
        observer?.observe(document, CLEANPLAATS_OBSERVER_OPTIONS);
    }
}

function scheduleCleanup() {
    const now = Date.now();

    if (!CLEANPLAATS.runtime.lastCleanupAt) {
        CLEANPLAATS.runtime.lastCleanupAt = now;
    }

    if (now - CLEANPLAATS.runtime.lastCleanupAt >= CLEANPLAATS_CLEANUP_MAX_DELAY_MS) {
        runScheduledCleanup();
        return;
    }

    clearTimeout(CLEANPLAATS.runtime.cleanupTimer);
    CLEANPLAATS.runtime.cleanupTimer = setTimeout(runScheduledCleanup, CLEANPLAATS_CLEANUP_DEBOUNCE_MS);
}

function setupObservers() {
    let lastUrl = location.href;

    if (CLEANPLAATS.observers.mutation) {
        CLEANPLAATS.observers.mutation.disconnect();
    }

    const observer = new MutationObserver(mutations => {
        if (lastUrl !== location.href) {
            console.log('Cleanplaats: URL changed from', lastUrl, 'to', location.href);
            lastUrl = location.href;
            CLEANPLAATS.runtime.lastSellerAgeWarningKey = '';
            performCleanupAndCheckForEmptyPage();
        }

        let shouldCleanup = false;
        let shouldSyncHeaderLogo = false;

        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
                // Marktplaats regularly rewrites the *inside* of a card that is already
                // in the DOM instead of replacing the card node: the homepage feed appends
                // empty .hz-StructuredListing skeletons while scrolling and only fills in
                // the link, title and price afterwards, and the mobile layout re-renders
                // listing bodies in place. Neither shows up as an added listing node, so
                // without this the filters only ever see the empty shell and the finished
                // card is never re-checked.
                const listingMutationTarget = mutation.target?.nodeType === Node.ELEMENT_NODE
                    ? mutation.target.closest?.(CLEANPLAATS_LISTING_SELECTOR)
                    : null;

                if (listingMutationTarget) {
                    shouldCleanup = true;
                    break;
                }

                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (
                            node.classList?.contains('hz-Header-logo-desktop') ||
                            node.classList?.contains('mp-Header-logo') ||
                            node.querySelector?.('.hz-Header-logo-desktop, .mp-Header-logo')
                        ) {
                            shouldSyncHeaderLogo = true;
                        }

                        if (
                            node.classList?.contains('SellerInfoSmall-root') ||
                            node.querySelector?.('.SellerInfoSmall-root')
                        ) {
                            scheduleSellerAgeWarningCheck();
                        }

                        if (
                            node.classList?.contains('hz-Listing') ||
                            node.classList?.contains('hz-StructuredListing') ||
                            node.querySelector?.('.hz-Listing') ||
                            node.querySelector?.('.hz-StructuredListing') ||
                            node.classList?.contains('MpCard-mpCardBanner') ||
                            node.querySelector?.('.MpCard-mpCardBanner, img[alt="Marktplaats Marketing Banner"]') ||
                            node.classList?.contains('SimilarAdsList-related-ads-section') ||
                            node.querySelector?.('.SimilarAdsList-related-ads-section') ||
                            node.id === 'notifications-root' ||
                            node.classList?.contains('NonFeatureBuyerBanner-root') ||
                            node.classList?.contains('feature-banner') ||
                            node.querySelector?.('#notifications-root, .NonFeatureBuyerBanner-root, .feature-banner[data-testid="50-percent-off-banner"]') ||
                            node.id?.includes('ad') ||
                            node.id === 'similar-items-root' ||
                            node.querySelector?.('#similar-items-root, .AdmarktSimilarItemsContainer, .AdmarktSimilarItems-root') ||
                            node.classList?.contains('hz-Banner') ||
                            node.querySelector?.('[data-google-query-id]') ||
                            node.classList?.contains('hz-FeedBannerBlock') ||
                            node.classList?.contains('Banners-bannerFeedItem') ||
                            node.id === 'banner-top-dt-container' ||
                            node.querySelector?.('#banner-top-dt, #banner-top-dt-container')
                        ) {
                            shouldCleanup = true;
                            break;
                        }
                    }
                }
            }

            if (mutation.type === 'attributes') {
                const target = mutation.target;
                if (
                    target?.classList?.contains('SellerInfoSmall-root')
                ) {
                    scheduleSellerAgeWarningCheck();
                }

                if (
                    target?.classList?.contains('hz-StructuredListing') ||
                    target?.classList?.contains('hz-FeedBannerBlock') ||
                    target?.classList?.contains('Banners-bannerFeedItem') ||
                    target?.classList?.contains('MpCard-mpCardBanner') ||
                    target?.classList?.contains('SimilarAdsList-related-ads-section') ||
                    target?.classList?.contains('NonFeatureBuyerBanner-root') ||
                    target?.classList?.contains('feature-banner') ||
                    target?.classList?.contains('AdmarktSimilarItemsContainer') ||
                    target?.classList?.contains('AdmarktSimilarItems-root') ||
                    target?.id === 'notifications-root' ||
                    target?.id === 'similar-items-root' ||
                    target?.id === 'banner-right-container' ||
                    target?.id === 'banner-top-dt-container'
                ) {
                    shouldCleanup = true;
                }
            }

            if (shouldCleanup) break;
        }

        if (CLEANPLAATS.settings.darkMode && shouldSyncHeaderLogo) {
            syncHeaderLogoForDarkMode(true);
        }

        if (shouldCleanup) {
            scheduleCleanup();
        }
    });

    CLEANPLAATS.observers.mutation = observer;
    observer.observe(document, CLEANPLAATS_OBSERVER_OPTIONS);
}

function handleNavigation() {
    wakeUpBackground();
    window.dispatchEvent(new Event('navigation'));
}

function handleViewedListingInteraction(event) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hostname !== window.location.hostname) {
        return;
    }

    const listingId = getListingIdFromUrl(link.href);
    if (!listingId) {
        return;
    }

    markListingAsViewed(listingId)
        .then(() => {
            if (typeof applyViewedListingIndicators === 'function') {
                applyViewedListingIndicators();
            }
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to track viewed listing interaction', error);
        });
}

function handleViewedListingBadgeToggle(event) {
    const badge = event.target instanceof Element ? event.target.closest('.cleanplaats-viewed-badge') : null;
    if (!badge) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const listing = badge.closest('.hz-Listing');
    const listingId = listing?.getAttribute('data-cleanplaats-viewed-id')
        || getListingIdFromUrl(listing?.querySelector('a[href*="/v/"]')?.href);

    if (!listingId) {
        return;
    }

    removeViewedListing(listingId)
        .then((didRemove) => {
            if (!didRemove) {
                return;
            }

            applyViewedListingIndicators();
            syncViewedListingsControlsState?.();
            showBubbleNotification(getPanelLocaleText().viewedListingRemovedToast);
        })
        .catch(error => {
            console.error('Cleanplaats: Failed to remove viewed listing flag', error);
        });
}

function handleViewedListingBadgeState(event, isUndoState) {
    const badge = event.target instanceof Element ? event.target.closest('.cleanplaats-viewed-badge') : null;
    if (!badge || typeof setViewedBadgeInteractionState !== 'function') {
        return;
    }

    setViewedBadgeInteractionState(badge, isUndoState);
}

function setupNavigationDetection() {
    window.addEventListener('popstate', handleNavigation);

    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(this, arguments);
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
    };

    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (link && link.hostname === window.location.hostname) {
            setTimeout(() => handleNavigation(), 100);
        }
    });

    document.addEventListener('click', handleViewedListingInteraction, true);
    document.addEventListener('click', handleViewedListingBadgeToggle, true);
    document.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
            handleViewedListingInteraction(event);
        }
    }, true);
    document.addEventListener('mouseover', (event) => {
        handleViewedListingBadgeState(event, true);
    }, true);
    document.addEventListener('mouseout', (event) => {
        handleViewedListingBadgeState(event, false);
    }, true);
    document.addEventListener('focusin', (event) => {
        handleViewedListingBadgeState(event, true);
    }, true);
    document.addEventListener('focusout', (event) => {
        handleViewedListingBadgeState(event, false);
    }, true);
}

function setupAllObservers() {
    setupObservers();
    setupNavigationDetection();
}

function isSearchResultsPage() {
    const url = window.location.href;
    return url.includes('marktplaats.nl/l/') ||
        url.includes('marktplaats.nl/q/') ||
        url.includes('2dehands.be/l/') ||
        url.includes('2dehands.be/q/') ||
        url.includes('2ememain.be/l/') ||
        url.includes('2ememain.be/q/');
}
