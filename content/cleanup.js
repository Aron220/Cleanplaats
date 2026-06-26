/**
 * Content-script cleanup and filtering routines.
 */

function getListingTitleElement(container) {
    if (!(container instanceof Element)) return null;

    return container.querySelector([
        '.hz-StructuredListing-title',
        '.hz-Listing-title',
        '.hz-Listing-group--title-description',
        '.hz-StructuredListing-body',
        '[class*="ListingTitle_hz-Listing-title"]',
        '[class*="ListingTitle_hz-StructuredListing-title"]'
    ].join(', '));
}

function getListingTitleText(container) {
    const titleElement = getListingTitleElement(container);
    return titleElement?.textContent?.trim().toLowerCase() || '';
}

function getListingDescriptionText(container) {
    if (!(container instanceof Element)) return '';
    const el = container.querySelector([
        '[class*="ListingDescription_hz-Listing-description"]',
        '.hz-Listing-description'
    ].join(', '));
    return el?.textContent?.trim().toLowerCase() || '';
}

function getViewedListingCardLink(listing) {
    if (!(listing instanceof Element)) {
        return null;
    }

    return listing.querySelector('a[href*="/v/"]');
}

function removeViewedListingIndicator(listing) {
    if (!(listing instanceof Element)) {
        return;
    }

    listing.classList.remove('cleanplaats-viewed-listing');
    listing.removeAttribute('data-cleanplaats-viewed-id');
    listing.querySelector('.cleanplaats-viewed-badge')?.remove();
}

function setViewedBadgeInteractionState(badge, isUndoState) {
    if (!(badge instanceof HTMLElement)) {
        return;
    }

    const defaultLabel = badge.dataset.defaultLabel || badge.textContent || '';
    const hoverLabel = badge.dataset.hoverLabel || defaultLabel;
    badge.textContent = isUndoState ? hoverLabel : defaultLabel;
    badge.classList.toggle('is-undo-state', Boolean(isUndoState));
}

function ensureViewedListingBadge(listing, label) {
    const wrapper = listing.querySelector('.hz-Listing-item-wrapper-new') || listing;
    const panelText = getPanelLocaleText();
    let badge = wrapper.querySelector('.cleanplaats-viewed-badge');

    if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'cleanplaats-viewed-badge';
        badge.setAttribute('aria-label', panelText.viewedListingBadgeUndoTooltip);
        badge.title = panelText.viewedListingBadgeUndoTooltip;
        wrapper.appendChild(badge);
    }

    badge.dataset.defaultLabel = label;
    badge.dataset.hoverLabel = panelText.viewedListingBadgeUndo;
    setViewedBadgeInteractionState(badge, false);
}

function applyViewedListingIndicators() {
    const listings = document.querySelectorAll('.hz-Listing');

    if (!listings.length) {
        return;
    }

    if (!CLEANPLAATS.settings.showViewedListingsIndicator) {
        listings.forEach(removeViewedListingIndicator);
        return;
    }

    const panelText = getPanelLocaleText();

    listings.forEach(listing => {
        const listingLink = getViewedListingCardLink(listing);
        const listingId = getListingIdFromUrl(listingLink?.href);

        if (!listingId) {
            removeViewedListingIndicator(listing);
            return;
        }

        if (!isListingViewed(listingId)) {
            removeViewedListingIndicator(listing);
            return;
        }

        listing.classList.add('cleanplaats-viewed-listing');
        listing.setAttribute('data-cleanplaats-viewed-id', listingId);
        ensureViewedListingBadge(listing, panelText.viewedListingBadge);
    });
}

function updateStatsDisplay() {
    if (!CLEANPLAATS.featureFlags.showStats) return;

    const stats = CLEANPLAATS.stats;

    updateElementText('cleanplaats-topads-count', stats.topAdsRemoved);
    updateElementText('cleanplaats-dagtoppers-count', stats.dagtoppersRemoved);
    updateElementText('cleanplaats-promoted-count', stats.promotedListingsRemoved);
    updateElementText('cleanplaats-stickers-count', stats.opvalStickersRemoved);
    updateElementText('cleanplaats-otherads-count', stats.otherAdsRemoved);

    const total = stats.topAdsRemoved + stats.dagtoppersRemoved + stats.promotedListingsRemoved + stats.opvalStickersRemoved + stats.otherAdsRemoved;
    stats.totalRemoved = total;

    updateElementText('cleanplaats-total-count-stats', total);
    // Header total-removed badge disabled for now.
    // updateElementText('cleanplaats-total-count', total);
}

function updateElementText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function performInitialCleanup() {
    try {
        performCleanup();
    } catch (error) {
        console.error('Cleanplaats: Initial cleanup failed', error);
    }
}

function performCleanup() {
    removeAllAds();
    removePersistentGoogleAds();
    if (CLEANPLAATS.settings.removeFavoriteRelatedAds) removeSimilarAdsSections();
    removeNonFeatureBuyerBanner();

    if (CLEANPLAATS.settings.removeTopAds) removeTopAdvertisements();
    if (CLEANPLAATS.settings.removeDagtoppers) removeDagtoppers();
    if (CLEANPLAATS.settings.removePromotedListings) removePromotedListings();
    if (CLEANPLAATS.settings.removeOpvalStickers) removeOpvalStickerListings();
    if (CLEANPLAATS.settings.removeReservedListings) removeReservedListings();

    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const sellerNameEl = listing.querySelector('.hz-Listing-seller-name, .hz-Listing-seller-name-new, .hz-Listing-seller-link, .hz-Listing-sellerName, .hz-Listing-sellerName-new');
        if (!sellerNameEl) return;
        const sellerName = sellerNameEl.textContent.trim();
        if (CLEANPLAATS.settings.blacklistedSellers.includes(sellerName)) {
            listing.setAttribute('data-cleanplaats-hidden', 'true');
            listing.style.display = 'none';
        }
    });

    document.querySelectorAll('.hz-Link').forEach(link => {
        const title = getListingTitleText(link);
        if (!title) return;
        CLEANPLAATS.settings.blacklistedTerms.forEach(term => {
            if (title.includes(term.toLowerCase())) {
                const listingEl = link.closest('.hz-StructuredListing') || link;
                listingEl.setAttribute('data-cleanplaats-hidden', 'true');
                listingEl.style.display = 'none';
            }
        });
    });

    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const title = getListingTitleText(listing);
        if (!title) return;
        CLEANPLAATS.settings.blacklistedTerms.forEach(term => {
            if (title.includes(term.toLowerCase())) {
                listing.setAttribute('data-cleanplaats-hidden', 'true');
                listing.style.display = 'none';
            }
        });
    });

    if (CLEANPLAATS.settings.blacklistedDescriptionTerms?.length > 0) {
        document.querySelectorAll('.hz-Listing').forEach(listing => {
            if (listing.hasAttribute('data-cleanplaats-hidden')) return;
            const description = getListingDescriptionText(listing);
            if (!description) return;
            CLEANPLAATS.settings.blacklistedDescriptionTerms.forEach(term => {
                if (description.includes(term.toLowerCase())) {
                    listing.setAttribute('data-cleanplaats-hidden', 'true');
                    listing.style.display = 'none';
                }
            });
        });
    }

    if (CLEANPLAATS.settings.blockedListings?.length > 0) {
        document.querySelectorAll('.hz-Listing').forEach(listing => {
            if (listing.hasAttribute('data-cleanplaats-hidden')) return;
            const listingLink = listing.querySelector('a[href*="/v/"]');
            const listingId = getListingIdFromUrl(listingLink?.href);
            if (!listingId) return;
            listing.dataset.cleanplaatsListingId = listingId;
            if (CLEANPLAATS.settings.blockedListings.some(b => b.id === listingId)) {
                listing.setAttribute('data-cleanplaats-hidden', 'true');
                listing.style.display = 'none';
            }
        });
    }

    applyViewedListingIndicators();
    updateStatsDisplay();
    updateEmptyPageBanner();
}

function resetPreviousChanges() {
    resetStats();

    document.querySelectorAll('[data-cleanplaats-hidden]').forEach(el => {
        try {
            el.style.cssText = el.getAttribute('data-original-style') || '';
            el.removeAttribute('data-cleanplaats-hidden');
            el.removeAttribute('data-original-style');
        } catch (error) {
            console.error('Cleanplaats: Error restoring element', error);
        }
    });
}

function removeTopAdvertisements() {
    const is2dehands = location.hostname.includes('2dehands.be');
    const is2ememain = location.hostname.includes('2ememain.be');
    const labels = is2ememain ? ['Pub au top'] : is2dehands ? ['Topzoekertje', 'Topadvertentie'] : ['Topadvertentie'];
    const priorityBadgeSelector = [
        '.hz-Listing-priority span',
        '.hz-Listing-priority-new',
        '[class*="hz-Listing-priority-new"]'
    ].join(', ');
    const removedCount = labels.reduce((total, label) => {
        return total + findAndHideListings(priorityBadgeSelector, label);
    }, 0);
    CLEANPLAATS.stats.topAdsRemoved += removedCount;
}

function removeDagtoppers() {
    const priorityBadgeSelector = [
        '.hz-Listing-priority span',
        '.hz-Listing-priority-new',
        '[class*="hz-Listing-priority-new"]'
    ].join(', ');
    const removedCount = findAndHideListings(priorityBadgeSelector, 'Dagtopper');
    CLEANPLAATS.stats.dagtoppersRemoved += removedCount;
}

function removePromotedListings() {
    let count = 0;
    const visitWebsiteLabels = location.hostname.includes('2ememain.be')
        ? ['Visiter le site internet']
        : ['Bezoek website'];

    const selectors = [
        '.hz-Listing-seller-link',
        '.hz-Listing-seller-external-link'
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(sellerLink => {
            try {
                const hasVisitWebsite = Array.from(sellerLink.querySelectorAll('span, a'))
                    .some(el => visitWebsiteLabels.includes(el.textContent?.trim()));

                if (hasVisitWebsite) {
                    const listing = sellerLink.closest('.hz-Listing');
                    if (listing && !listing.hasAttribute('data-cleanplaats-hidden') && hideElement(listing)) {
                        count++;
                    }
                }
            } catch (error) {
                console.error('Cleanplaats: Error processing promoted listing', error);
            }
        });
    });

    document.querySelectorAll('.hz-StructuredListing').forEach(listing => {
        try {
            if (listing.hasAttribute('data-cleanplaats-hidden') || !isHomepagePartnerListing(listing)) {
                return;
            }

            if (hideElement(listing)) {
                count++;
            }
        } catch (error) {
            console.error('Cleanplaats: Error processing homepage partner listing', error);
        }
    });

    CLEANPLAATS.stats.promotedListingsRemoved += count;
}

function isHomepagePartnerListing(listing) {
    const hrefs = Array.from(listing.querySelectorAll('a[href]'))
        .map(link => link.href || link.getAttribute('href') || '')
        .filter(Boolean);

    return hrefs.some(href => /\/a\d+(?:[-/?]|$)/i.test(href));
}

function removeOpvalStickerListings() {
    let count = 0;
    const stickerSelectors = [
        '.hz-Listing-Opvalsticker-wrapper, .hz-Listing-Opvalsticker-wrapper-new',
        '[data-testid="listing-opval-sticker"]'
    ];

    stickerSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(sticker => {
            try {
                const listing = sticker.closest('.hz-Listing');
                if (listing && !listing.hasAttribute('data-cleanplaats-hidden') && hideElement(listing)) {
                    count++;
                }
            } catch (error) {
                console.error('Cleanplaats: Error processing sticker listing', error);
            }
        });
    });

    CLEANPLAATS.stats.opvalStickersRemoved += count;
}

function removeReservedListings() {
    const count = findAndHideListings('.hz-Listing-price, [class*="ListingPrice_hz-Listing-price"], .hz-StructuredListing-price', [
        'gereserveerd',
        'réservé'
    ]);
    CLEANPLAATS.stats.otherAdsRemoved += count;
}

function removeAllAds() {
    let count = 0;
    const marktplaatsMarketingBannerSelector = '.MpCard-mpCardBanner, img[alt="Marktplaats Marketing Banner"]';
    const marktplaatsMarketingBannerWrapperSelector = 'div[role="button"][tabindex]';
    const getMarktplaatsMarketingBannerContainer = element => {
        if (!(element instanceof Element)) {
            return null;
        }

        const bannerCard = element.closest('.MpCard-mpCardBanner');
        if (bannerCard) {
            const bannerWrapper = bannerCard.closest(marktplaatsMarketingBannerWrapperSelector);
            if (bannerWrapper?.querySelector(marktplaatsMarketingBannerSelector)) {
                return bannerWrapper;
            }

            return bannerCard;
        }

        const bannerWrapper = element.closest(marktplaatsMarketingBannerWrapperSelector);
        if (bannerWrapper?.querySelector(marktplaatsMarketingBannerSelector)) {
            return bannerWrapper;
        }

        return element.closest('img[alt="Marktplaats Marketing Banner"]');
    };
    const isMarktplaatsSponsoredNotice = element => {
        if (!element) return false;

        const text = (element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return text.includes('de volgorde van de resultaten wordt mede bepaald door betaalde opvalmogelijkheden');
    };
    const isMarktplaatsMarketingBanner = element => {
        if (!element) return false;

        if (
            element.matches?.('.MpCard-mpCardBanner') ||
            element.querySelector?.(marktplaatsMarketingBannerSelector)
        ) {
            return true;
        }

        const bannerImage = element.querySelector?.('img[alt="Marktplaats Marketing Banner"]');
        return Boolean(bannerImage);
    };

    function safeHide(selector) {
        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (!el.hasAttribute('data-cleanplaats-hidden') && hideElement(el)) {
                    count++;
                }

                const parentLi = el.closest('li.bannerContainerLoading');
                if (parentLi && !parentLi.hasAttribute('data-cleanplaats-hidden')) {
                    hideElement(parentLi);
                }

                const feedBanner = el.closest('.hz-FeedBannerBlock, .Banners-bannerFeedItem');
                if (feedBanner && !feedBanner.hasAttribute('data-cleanplaats-hidden')) {
                    hideElement(feedBanner);
                }

                const topBanner = el.closest('.BannerTop-root, #top-banner-root');
                if (topBanner && !topBanner.hasAttribute('data-cleanplaats-hidden')) {
                    hideElement(topBanner);
                }
            });
        } catch (error) {
            console.log('Cleanplaats: Error hiding ads', error);
        }
    }

    document.querySelectorAll('.hz-Listing-imageOverlayLabel').forEach(overlay => {
        if (overlay.textContent.trim() === 'Homepagina-advertentie') {
            const link = overlay.closest('.hz-Link.hz-Link--block');
            if (link && !link.hasAttribute('data-cleanplaats-hidden')) {
                hideElement(link);
                count++;
            }
        }
    });

    const adSelectors = [
        '#adsense-root',
        '#adsense-container',
        '#adsense-container-bottom-lazy',
        '#similar-items-root',
        '.AdmarktSimilarItemsContainer',
        '.AdmarktSimilarItems-root',
        '.AdmarktSimilarItems-headerTitle',
        '#adBlock',
        '.ndfc-wrapper[data-testid="ndfc-generic-text"]',
        '[data-testid="ndfc-close"]',
        '.MpCard-mpCardBanner',
        'div[role="button"][tabindex] > .MpCard-mpCardBanner',
        'img[alt="Marktplaats Marketing Banner"]',
        '.hz-Banner',
        '.hz-Banner--fluid',
        '.BannerTop-root',
        '#banner-rubrieks-dt',
        '#banner-top-dt',
        '#banner-top-dt-container',
        '#top-banner-root',
        '[data-google-query-id]',
        '[id*="google_ads_iframe"]',
        '[id*="google_ads_top_frame"]',
        '[aria-label="Advertisement"]',
        '[title="3rd party ad content"]',
        '.i_.div',
        '[data-ad-container]',
        '[data-bg="true"]',
        '[class*="adsbygoogle"]',
        'ins.adsbygoogle',
        'iframe[src*="googleads"]',
        'iframe[src*="doubleclick"]',
        '[id*="div-gpt-ad"]',
        '.hz-Listings__container--cas[data-testid="BottomBlockLazyListings"]',
        '[class*="creative"]',
        '#google_ads_top_frame',
        '.creative',
        'li.bannerContainerLoading',
        '.bannerContainerLoading',
        '.bannerContainerLoading .hz-Banner',
        '.bannerContainerLoading .hz-Banner--fluid',
        '.BrandTileBanner-container',
        '[data-testid="brand-tile-banner"]'
    ];

    adSelectors.forEach(selector => {
        safeHide(selector);
    });

    document.querySelectorAll('.ndfc-wrapper, [data-testid="ndfc-generic-text"]').forEach(notice => {
        if (isMarktplaatsSponsoredNotice(notice) && hideElement(notice)) {
            count++;
        }
    });

    document.querySelectorAll('.MpCard-mpCardBanner, img[alt="Marktplaats Marketing Banner"]').forEach(banner => {
        const bannerCard = getMarktplaatsMarketingBannerContainer(banner) || banner;
        if (isMarktplaatsMarketingBanner(bannerCard) && hideElement(bannerCard)) {
            count++;
        }

        const bannerWrapper = bannerCard.parentElement;
        if (
            bannerWrapper instanceof Element &&
            bannerWrapper !== bannerCard &&
            bannerWrapper.childElementCount === 1 &&
            !bannerWrapper.hasAttribute('data-cleanplaats-hidden')
        ) {
            hideElement(bannerWrapper);
        }
    });

    CLEANPLAATS.stats.otherAdsRemoved += count;
}

function removePersistentGoogleAds() {
    let count = 0;

    document.querySelectorAll('#adsense-root, .creative, div[id^="google_ads_iframe"], div[data-google-query-id], div[aria-label="Advertisement"]').forEach(ad => {
        try {
            const gridItem = ad.closest('.hz-Link.hz-Link--block');
            if (gridItem && gridItem.parentNode) {
                gridItem.parentNode.removeChild(gridItem);
                count++;
                return;
            }
            if (ad.parentNode) {
                ad.parentNode.removeChild(ad);
                count++;
            }
        } catch (error) {
            console.error('Cleanplaats: Error removing persistent ad', error);
        }
    });

    document.querySelectorAll('#banner-right-container').forEach(banner => {
        if (banner.parentNode) {
            banner.parentNode.removeChild(banner);
            count++;
        }
    });

    document.querySelectorAll('#banner-top-dt-container').forEach(container => {
        if (container.parentNode) {
            container.parentNode.removeChild(container);
            count++;
        }
    });

    document.querySelectorAll('.BannerTop-root').forEach(banner => {
        const hasAdContent = banner.querySelector(
            '.hz-Banner, .hz-Banner--fluid, iframe, [data-google-query-id], [id*="google_ads_iframe"], ins.adsbygoogle'
        );
        if (!hasAdContent && banner.parentNode) {
            banner.parentNode.removeChild(banner);
            count++;
        }
    });

    document.querySelectorAll('#top-banner-root').forEach(container => {
        const hasVisibleContent = Array.from(container.children).some(child => child.offsetParent !== null);
        if (!hasVisibleContent && container.parentNode) {
            container.parentNode.removeChild(container);
            count++;
        }
    });

    document.querySelectorAll('.hz-FeedBannerBlock, .Banners-bannerFeedItem').forEach(banner => {
        if (
            banner.childElementCount === 0 ||
            Array.from(banner.children).every(child => child.offsetParent === null)
        ) {
            if (banner.parentNode) {
                banner.parentNode.removeChild(banner);
                count++;
            }
        }
    });

    CLEANPLAATS.stats.otherAdsRemoved += count;
}

function removeSimilarAdsSections() {
    let count = 0;

    document.querySelectorAll('.SimilarAdsList-related-ads-section').forEach(section => {
        if (hideElement(section)) {
            count++;
        }
    });

    CLEANPLAATS.stats.otherAdsRemoved += count;
}

function removeNonFeatureBuyerBanner() {
    let count = 0;

    document.querySelectorAll(
        '#notifications-root, .NonFeatureBuyerBanner-root, .feature-banner[data-testid="50-percent-off-banner"]'
    ).forEach(element => {
        const banner = element.id === 'notifications-root'
            ? element
            : element.closest('#notifications-root')
                || element.closest('.feature-banner[data-testid="50-percent-off-banner"]')
                || element;

        if (hideElement(banner)) {
            count++;
        }
    });

    CLEANPLAATS.stats.otherAdsRemoved += count;
}

function findAndHideListings(selector, textContent) {
    let count = 0;
    const expectedTexts = Array.isArray(textContent)
        ? textContent.map(text => text.trim().toLowerCase())
        : [textContent.trim().toLowerCase()];

    try {
        document.querySelectorAll(selector).forEach(el => {
            const elementText = el.textContent?.trim().toLowerCase();
            if (elementText && expectedTexts.includes(elementText)) {
                const listing = el.closest('.hz-Listing, .hz-StructuredListing');
                if (listing && !listing.hasAttribute('data-cleanplaats-hidden') && hideElement(listing)) {
                    count++;
                }
            }
        });
    } catch (error) {
        console.error(`Cleanplaats: Error finding "${textContent}" listings`, error);
    }

    return count;
}

function hideElement(element) {
    if (!element || element.hasAttribute('data-cleanplaats-hidden')) {
        return false;
    }

    try {
        element.setAttribute('data-original-style', element.style.cssText);
        element.setAttribute('data-cleanplaats-hidden', 'true');
        element.style.setProperty('display', 'none', 'important');

        return true;
    } catch (error) {
        console.error('Cleanplaats: Error hiding element', error);
        return false;
    }
}

// --- Empty-page skip feature ---

const MARKTPLAATS_PAGE_SIZE = 30;

function buildSearchApiUrl(offset, limit) {
    const hash = window.location.hash.replace('#', '');
    const hashParams = {};
    hash.split('|').forEach(part => {
        const colonIdx = part.indexOf(':');
        if (colonIdx > 0) {
            hashParams[part.slice(0, colonIdx)] = part.slice(colonIdx + 1);
        }
    });

    const sortBy = hashParams.sortBy || 'SORT_INDEX';
    const sortOrder = hashParams.sortOrder || 'DECREASING';

    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('offset', offset);

    try {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
            const nextData = JSON.parse(nextDataEl.textContent);
            const q = nextData.query || {};
            if (q.searchQuery) params.set('query', q.searchQuery);
            if (q.l1CategoryId) params.set('l1CategoryId', q.l1CategoryId);
            if (q.l2CategoryId) params.set('l2CategoryId', q.l2CategoryId);
            if (q.postcode) params.set('postcode', q.postcode);
            if (q.attributesValuesIds) params.set('attributesValuesIds', q.attributesValuesIds);
            if (q.attributesValuesKeys) params.set('attributesValuesKeys', q.attributesValuesKeys);
        }
    } catch (e) {}

    // Hash postcode overrides __NEXT_DATA__ postcode
    if (hashParams.postcode) params.set('postcode', hashParams.postcode);

    params.set('sortBy', sortBy);
    params.set('sortOrder', sortOrder);
    params.set('searchInTitleAndDescription', 'true');
    params.set('viewOptions', 'list-view');

    return `/lrp/api/search?${params.toString()}`;
}

function isApiListingBlocked(apiListing) {
    const listingId = (apiListing.itemId || '').toLowerCase();
    if (listingId && CLEANPLAATS.settings.blockedListings?.some(b => b.id === listingId)) return true;

    const sellerName = apiListing.sellerInformation?.sellerName || '';
    if (sellerName && CLEANPLAATS.settings.blacklistedSellers.includes(sellerName)) return true;

    const title = (apiListing.title || '').toLowerCase();
    if (CLEANPLAATS.settings.blacklistedTerms.some(term => title.includes(term.toLowerCase()))) return true;

    if (CLEANPLAATS.settings.blacklistedDescriptionTerms?.length > 0) {
        const description = (apiListing.description || '').toLowerCase();
        if (CLEANPLAATS.settings.blacklistedDescriptionTerms.some(term => description.includes(term.toLowerCase()))) return true;
    }

    if (CLEANPLAATS.settings.removeDagtoppers && apiListing.priorityProduct === 'DAGTOPPER') return true;
    if (CLEANPLAATS.settings.removeReservedListings && apiListing.reserved === true) return true;
    if (CLEANPLAATS.settings.removeOpvalStickers && apiListing.traits?.includes('ETALAGE')) return true;

    return false;
}

async function findFirstNonEmptyOffset(startOffset, pageSize) {
    const MAX_PAGES = 100;
    const BATCH = 5;

    for (let scanned = 0; scanned < MAX_PAGES; scanned += BATCH) {
        const offsets = Array.from({ length: BATCH }, (_, i) => startOffset + (scanned + i) * MARKTPLAATS_PAGE_SIZE);

        const results = await Promise.all(offsets.map(async offset => {
            try {
                const resp = await fetch(buildSearchApiUrl(offset, pageSize));
                if (!resp.ok) return null;
                const data = await resp.json();
                if (!data.listings?.length) return null;
                return data.listings.some(l => !isApiListingBlocked(l)) ? offset : null;
            } catch (e) {
                return null;
            }
        }));

        const found = results.find(r => r != null);
        if (found != null) return found;
    }
    return null;
}

function buildPageUrl(pageNum) {
    const cleanPath = window.location.pathname.replace(/\/p\/\d+\//, '/');
    const hash = window.location.hash;
    if (pageNum <= 1) return cleanPath + hash;
    return cleanPath.replace(/\/$/, '') + `/p/${pageNum}/` + hash;
}

function removeEmptyPageBanner() {
    document.getElementById('cleanplaats-empty-page-banner')?.remove();
}

function updateEmptyPageBanner() {
    if (!isMarktplaatsSite() && !is2dehandsFamilySite()) return;

    const href = window.location.href;
    if (!href.includes('/q/') && !href.includes('/l/')) {
        removeEmptyPageBanner();
        return;
    }

    const allListings = document.querySelectorAll('.hz-Listing');
    if (allListings.length === 0) {
        removeEmptyPageBanner();
        return;
    }

    const hasVisible = document.querySelector('.hz-Listing:not([data-cleanplaats-hidden])');
    if (hasVisible) {
        removeEmptyPageBanner();
        return;
    }

    if (document.getElementById('cleanplaats-empty-page-banner')) return;

    const panelText = getPanelLocaleText();

    const banner = document.createElement('div');
    banner.id = 'cleanplaats-empty-page-banner';
    banner.innerHTML = DOMPurify.sanitize(`
        <p class="cleanplaats-empty-page-text">${panelText.emptyPageText}</p>
        <div class="cleanplaats-empty-page-actions">
            <button class="cleanplaats-empty-page-btn" id="cleanplaats-find-next-page-btn">${panelText.emptyPageFindNext}</button>
            <span class="cleanplaats-empty-page-status" id="cleanplaats-empty-page-status"></span>
        </div>
    `);

    const listingsEl = document.querySelector('.hz-Listings');
    if (listingsEl) {
        listingsEl.insertAdjacentElement('beforebegin', banner);
    }

    document.getElementById('cleanplaats-find-next-page-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('cleanplaats-find-next-page-btn');
        const status = document.getElementById('cleanplaats-empty-page-status');
        if (!btn || !status) return;

        btn.disabled = true;

        const searchingPhrases = [
            'Pagina\'s afstruinen…',
            'Oplichters overslaan…',
            'Hier misschien? Nee...',
            'Zoeken naar koopjes…',
            'Tweedehands goud zoeken…',
            'Door de zooi heen ploegen…',
            'Marktplaatsen afzoeken…',
            'Even verder kijken…',
            'Denk, denk, denk, ideetje!…',
            'Spulletjes scannen…',
        ];
        let phraseIndex = Math.floor(Math.random() * searchingPhrases.length);
        status.textContent = searchingPhrases[phraseIndex];
        status.classList.add('searching');
        const phraseInterval = setInterval(() => {
            phraseIndex = (phraseIndex + 1) % searchingPhrases.length;
            status.textContent = searchingPhrases[phraseIndex];
        }, 1800);

        const hash = window.location.hash.replace('#', '');
        const hashParams = {};
        hash.split('|').forEach(part => {
            const colonIdx = part.indexOf(':');
            if (colonIdx > 0) hashParams[part.slice(0, colonIdx)] = part.slice(colonIdx + 1);
        });
        const userLimit = parseInt(hashParams.limit) || CLEANPLAATS.settings.resultsPerPage || MARKTPLAATS_PAGE_SIZE;

        const pageMatch = window.location.pathname.match(/\/p\/(\d+)\//);
        const currentPage = pageMatch ? parseInt(pageMatch[1]) : 1;
        // Align nextOffset to page boundaries (multiples of MARKTPLAATS_PAGE_SIZE)
        // so each scanned offset exactly matches what a /p/N/ URL will load.
        const currentPageOffset = (currentPage - 1) * MARKTPLAATS_PAGE_SIZE;
        const nextOffset = Math.ceil((currentPageOffset + userLimit) / MARKTPLAATS_PAGE_SIZE) * MARKTPLAATS_PAGE_SIZE;

        const foundOffset = await findFirstNonEmptyOffset(nextOffset, userLimit);
        clearInterval(phraseInterval);
        status.classList.remove('searching');

        if (foundOffset == null) {
            status.textContent = panelText.emptyPageNotFound;
            btn.disabled = false;
            return;
        }

        status.textContent = '🎯 Gevonden! Pagina laden…';
        const targetPage = foundOffset / MARKTPLAATS_PAGE_SIZE + 1;
        setTimeout(() => { window.location.href = buildPageUrl(targetPage); }, 400);
    });
}
