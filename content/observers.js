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

    const checkContentLoaded = setInterval(() => {
        if (document.querySelector('.hz-Listing') || document.querySelector('#adsense-container')) {
            clearInterval(checkContentLoaded);
            console.log('Cleanplaats: Running cleanup after navigation');
            performCleanup();
            injectBlacklistButtons();

            setTimeout(checkForEmptyPage, 500);
        }
    }, 100);
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
            performCleanupAndCheckForEmptyPage();
        }

        let shouldCleanup = false;
        let shouldSyncHeaderLogo = false;

        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length) {
                const listingMutationTarget = mutation.target?.nodeType === Node.ELEMENT_NODE
                    ? mutation.target.closest?.('.hz-Listing')
                    : null;

                if (window.innerWidth < 700 && listingMutationTarget) {
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
                            node.classList?.contains('hz-Listing') ||
                            node.querySelector?.('.hz-Listing') ||
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
                    target?.classList?.contains('hz-FeedBannerBlock') ||
                    target?.classList?.contains('Banners-bannerFeedItem') ||
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
            performCleanup();
            injectBlacklistButtons();
        }
    });

    observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });

    CLEANPLAATS.observers.mutation = observer;
}

function handleNavigation() {
    wakeUpBackground();
    window.dispatchEvent(new Event('navigation'));
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
