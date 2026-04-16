import { notifyStatsChanged } from '@/content/runtime/store';
import { getListingTitleText } from '@/shared/utils/selectors';
import type { CleanplaatsState } from '@/shared/types/state';

export const hideElement = (element: Element): boolean => {
  if (!element || element.hasAttribute('data-cleanplaats-hidden')) {
    return false;
  }

  try {
    element.setAttribute('data-original-style', (element as HTMLElement).style.cssText);
    element.setAttribute('data-cleanplaats-hidden', 'true');
    (element as HTMLElement).style.display = 'none !important';

    return true;
  } catch (error) {
    console.error('Cleanplaats: Error hiding element', error);
    return false;
  }
};

const findAndHideListings = (selector: string, textContent: string | string[]): number => {
  let count = 0;
  const expectedTexts = Array.isArray(textContent)
    ? textContent.map((text) => text.trim().toLowerCase())
    : [textContent.trim().toLowerCase()];

  try {
    document.querySelectorAll(selector).forEach((el) => {
      const elementText = el.textContent?.trim().toLowerCase();
      if (elementText && expectedTexts.includes(elementText)) {
        const listing = el.closest('.hz-Listing');
        if (listing && !listing.hasAttribute('data-cleanplaats-hidden') && hideElement(listing)) {
          count++;
        }
      }
    });
  } catch (error) {
    console.error(`Cleanplaats: Error finding "${String(textContent)}" listings`, error);
  }

  return count;
};

const isHomepagePartnerListing = (listing: Element): boolean => {
  const hrefs = Array.from(listing.querySelectorAll('a[href]'))
    .map((link) => (link as HTMLAnchorElement).href || link.getAttribute('href') || '')
    .filter(Boolean);

  return hrefs.some((href) => /\/a\d+(?:[-/?]|$)/i.test(href));
};

const removeTopAdvertisements = (state: CleanplaatsState): void => {
  const is2dehands = location.hostname.includes('2dehands.be');
  const is2ememain = location.hostname.includes('2ememain.be');
  const labels = is2ememain
    ? ['Pub au top']
    : is2dehands
      ? ['Topzoekertje', 'Topadvertentie']
      : ['Topadvertentie'];
  const priorityBadgeSelector = [
    '.hz-Listing-priority span',
    '.hz-Listing-priority-new',
    '[class*="hz-Listing-priority-new"]',
  ].join(', ');
  const removedCount = labels.reduce(
    (total, label) => total + findAndHideListings(priorityBadgeSelector, label),
    0,
  );
  state.stats.topAdsRemoved += removedCount;
};

const removeDagtoppers = (state: CleanplaatsState): void => {
  const priorityBadgeSelector = [
    '.hz-Listing-priority span',
    '.hz-Listing-priority-new',
    '[class*="hz-Listing-priority-new"]',
  ].join(', ');
  const removedCount = findAndHideListings(priorityBadgeSelector, 'Dagtopper');
  state.stats.dagtoppersRemoved += removedCount;
};

const removePromotedListings = (state: CleanplaatsState): void => {
  let count = 0;
  const visitWebsiteLabels = location.hostname.includes('2ememain.be')
    ? ['Visiter le site internet']
    : ['Bezoek website'];

  const selectors = ['.hz-Listing-seller-link', '.hz-Listing-seller-external-link'];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((sellerLink) => {
      try {
        const hasVisitWebsite = Array.from(sellerLink.querySelectorAll('span, a')).some((el) =>
          visitWebsiteLabels.includes(el.textContent?.trim() ?? ''),
        );

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

  document.querySelectorAll('.hz-StructuredListing').forEach((listing) => {
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

  state.stats.promotedListingsRemoved += count;
};

const removeOpvalStickerListings = (state: CleanplaatsState): void => {
  let count = 0;
  const stickerSelectors = [
    '.hz-Listing-Opvalsticker-wrapper, .hz-Listing-Opvalsticker-wrapper-new',
    '[data-testid="listing-opval-sticker"]',
  ];

  stickerSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((sticker) => {
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

  state.stats.opvalStickersRemoved += count;
};

const removeReservedListings = (state: CleanplaatsState): void => {
  const count = findAndHideListings('.hz-Listing-price, [class*="ListingPrice_hz-Listing-price"]', [
    'gereserveerd',
    'réservé',
  ]);
  state.stats.otherAdsRemoved += count;
};

const removeAllAds = (state: CleanplaatsState): void => {
  let count = 0;
  const marktplaatsMarketingBannerSelector = '.MpCard-mpCardBanner, img[alt="Marktplaats Marketing Banner"]';
  const marktplaatsMarketingBannerWrapperSelector = 'div[role="button"][tabindex]';
  const getMarktplaatsMarketingBannerContainer = (element: Element | null): Element | null => {
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

  const isMarktplaatsSponsoredNotice = (element: Element | null): boolean => {
    if (!element) return false;

    const text = (element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return text.includes('de volgorde van de resultaten wordt mede bepaald door betaalde opvalmogelijkheden');
  };

  const isMarktplaatsMarketingBanner = (element: Element | null): boolean => {
    if (!element) return false;

    if (
      element.matches?.('.MpCard-mpCardBanner')
      || element.querySelector?.(marktplaatsMarketingBannerSelector)
    ) {
      return true;
    }

    const bannerImage = element.querySelector?.('img[alt="Marktplaats Marketing Banner"]');
    return Boolean(bannerImage);
  };

  const safeHide = (selector: string): void => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
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
  };

  document.querySelectorAll('.hz-Listing-imageOverlayLabel').forEach((overlay) => {
    if (overlay.textContent?.trim() === 'Homepagina-advertentie') {
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
  ];

  adSelectors.forEach((selector) => {
    safeHide(selector);
  });

  document.querySelectorAll('.ndfc-wrapper, [data-testid="ndfc-generic-text"]').forEach((notice) => {
    if (isMarktplaatsSponsoredNotice(notice) && hideElement(notice)) {
      count++;
    }
  });

  document.querySelectorAll('.MpCard-mpCardBanner, img[alt="Marktplaats Marketing Banner"]').forEach((banner) => {
    const bannerCard = getMarktplaatsMarketingBannerContainer(banner) || banner;
    if (isMarktplaatsMarketingBanner(bannerCard) && hideElement(bannerCard)) {
      count++;
    }

    const bannerWrapper = bannerCard.parentElement;
    if (
      bannerWrapper instanceof Element
      && bannerWrapper !== bannerCard
      && bannerWrapper.childElementCount === 1
      && !bannerWrapper.hasAttribute('data-cleanplaats-hidden')
    ) {
      hideElement(bannerWrapper);
    }
  });

  state.stats.otherAdsRemoved += count;
};

export const removePersistentGoogleAds = (state: CleanplaatsState): void => {
  let count = 0;

  document
    .querySelectorAll(
      '#adsense-root, .creative, div[id^="google_ads_iframe"], div[data-google-query-id], div[aria-label="Advertisement"]',
    )
    .forEach((ad) => {
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

  document.querySelectorAll('#banner-right-container').forEach((banner) => {
    if (banner.parentNode) {
      banner.parentNode.removeChild(banner);
      count++;
    }
  });

  document.querySelectorAll('#banner-top-dt-container').forEach((container) => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
      count++;
    }
  });

  document.querySelectorAll('.BannerTop-root').forEach((banner) => {
    const hasAdContent = banner.querySelector(
      '.hz-Banner, .hz-Banner--fluid, iframe, [data-google-query-id], [id*="google_ads_iframe"], ins.adsbygoogle',
    );
    if (!hasAdContent && banner.parentNode) {
      banner.parentNode.removeChild(banner);
      count++;
    }
  });

  document.querySelectorAll('#top-banner-root').forEach((container) => {
    const hasVisibleContent = Array.from(container.children).some(
      (child) => (child as HTMLElement).offsetParent !== null,
    );
    if (!hasVisibleContent && container.parentNode) {
      container.parentNode.removeChild(container);
      count++;
    }
  });

  document.querySelectorAll('.hz-FeedBannerBlock, .Banners-bannerFeedItem').forEach((banner) => {
    if (
      banner.childElementCount === 0
      || Array.from(banner.children).every((child) => (child as HTMLElement).offsetParent === null)
    ) {
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
        count++;
      }
    }
  });

  state.stats.otherAdsRemoved += count;
};

const removeSimilarAdsSections = (state: CleanplaatsState): void => {
  let count = 0;

  document.querySelectorAll('.SimilarAdsList-related-ads-section').forEach((section) => {
    if (hideElement(section)) {
      count++;
    }
  });

  state.stats.otherAdsRemoved += count;
};

const removeNonFeatureBuyerBanner = (state: CleanplaatsState): void => {
  let count = 0;

  document
    .querySelectorAll(
      '#notifications-root, .NonFeatureBuyerBanner-root, .feature-banner[data-testid="50-percent-off-banner"]',
    )
    .forEach((element) => {
      const banner =
        element.id === 'notifications-root'
          ? element
          : element.closest('#notifications-root')
            || element.closest('.feature-banner[data-testid="50-percent-off-banner"]')
            || element;

      if (hideElement(banner)) {
        count++;
      }
    });

  state.stats.otherAdsRemoved += count;
};

const applyBlacklist = (state: CleanplaatsState): void => {
  document.querySelectorAll('.hz-Listing').forEach((listing) => {
    const sellerNameEl = listing.querySelector(
      '.hz-Listing-seller-name, .hz-Listing-seller-name-new, .hz-Listing-seller-link, .hz-Listing-sellerName, .hz-Listing-sellerName-new',
    );
    if (!sellerNameEl) return;
    const sellerName = sellerNameEl.textContent?.trim() ?? '';
    if (state.settings.blacklistedSellers.includes(sellerName)) {
      listing.setAttribute('data-cleanplaats-hidden', 'true');
      (listing as HTMLElement).style.display = 'none';
    }
  });

  document.querySelectorAll('.hz-Link').forEach((link) => {
    const title = getListingTitleText(link);
    if (!title) return;
    state.settings.blacklistedTerms.forEach((term) => {
      if (title.includes(term.toLowerCase())) {
        const listingEl = link.closest('.hz-StructuredListing') || link;
        listingEl.setAttribute('data-cleanplaats-hidden', 'true');
        (listingEl as HTMLElement).style.display = 'none';
      }
    });
  });

  document.querySelectorAll('.hz-Listing').forEach((listing) => {
    const title = getListingTitleText(listing);
    if (!title) return;
    state.settings.blacklistedTerms.forEach((term) => {
      if (title.includes(term.toLowerCase())) {
        listing.setAttribute('data-cleanplaats-hidden', 'true');
        (listing as HTMLElement).style.display = 'none';
      }
    });
  });
};

export const performCleanup = (state: CleanplaatsState): void => {
  removeAllAds(state);
  removePersistentGoogleAds(state);
  if (state.settings.removeFavoriteRelatedAds) removeSimilarAdsSections(state);
  removeNonFeatureBuyerBanner(state);

  if (state.settings.removeTopAds) removeTopAdvertisements(state);
  if (state.settings.removeDagtoppers) removeDagtoppers(state);
  if (state.settings.removePromotedListings) removePromotedListings(state);
  if (state.settings.removeOpvalStickers) removeOpvalStickerListings(state);
  if (state.settings.removeReservedListings) removeReservedListings(state);

  applyBlacklist(state);
  notifyStatsChanged();
};

export const resetPreviousChanges = (state: CleanplaatsState): void => {
  state.stats.topAdsRemoved = 0;
  state.stats.dagtoppersRemoved = 0;
  state.stats.promotedListingsRemoved = 0;
  state.stats.opvalStickersRemoved = 0;
  state.stats.otherAdsRemoved = 0;
  state.stats.totalRemoved = 0;
  notifyStatsChanged();

  document.querySelectorAll('[data-cleanplaats-hidden]').forEach((el) => {
    try {
      (el as HTMLElement).style.cssText = el.getAttribute('data-original-style') ?? '';
      el.removeAttribute('data-cleanplaats-hidden');
      el.removeAttribute('data-original-style');
    } catch (error) {
      console.error('Cleanplaats: Error restoring element', error);
    }
  });
};

export const performInitialCleanup = (state: CleanplaatsState): void => {
  try {
    performCleanup(state);
  } catch (error) {
    console.error('Cleanplaats: Initial cleanup failed', error);
  }
};
