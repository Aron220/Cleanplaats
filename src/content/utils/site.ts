import type { ReviewCtaConfig } from '@/shared/types/state';

export const is2ememainLocale = (): boolean => location.hostname.includes('2ememain.be');

export const is2dehandsFamilySite = (): boolean =>
  location.hostname.includes('2dehands.be') || location.hostname.includes('2ememain.be');

export const isMarktplaatsSite = (): boolean => location.hostname.includes('marktplaats.nl');

export const isProductDetailPage = (): boolean => /\/v\//.test(window.location.pathname);

export const isSearchResultsPage = (): boolean => {
  const url = window.location.href;
  return (
    url.includes('marktplaats.nl/l/')
    || url.includes('marktplaats.nl/q/')
    || url.includes('2dehands.be/l/')
    || url.includes('2dehands.be/q/')
    || url.includes('2ememain.be/l/')
    || url.includes('2ememain.be/q/')
  );
};

export const getReviewCTAConfig = (): ReviewCtaConfig => {
  const runtimeUrl = browser.runtime?.getURL ? browser.runtime.getURL('') : '';
  const isFirefox =
    runtimeUrl.startsWith('moz-extension://') || navigator.userAgent.includes('Firefox');

  if (isFirefox) {
    return {
      linkLabel: 'Firefox Add-ons',
      url: 'https://addons.mozilla.org/nl/firefox/addon/cleanplaats-marktplaats-filter/reviews/',
    };
  }

  return {
    linkLabel: 'Chrome Web Store',
    url: 'https://chromewebstore.google.com/detail/cleanplaats-marktplaats-z/peebdbeclpkljmfocjifjpjlngfpfhjp/reviews',
  };
};
