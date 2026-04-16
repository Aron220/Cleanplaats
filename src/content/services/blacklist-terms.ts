import { getListingTitleText } from '@/shared/utils/selectors';

export const unhideListingsByTerm = (term: string): void => {
  document.querySelectorAll('.hz-Link').forEach((link) => {
    const title = getListingTitleText(link);
    if (title.includes(term.toLowerCase())) {
      const listingEl = link.closest('.hz-StructuredListing') || link;
      listingEl.removeAttribute('data-cleanplaats-hidden');
      (listingEl as HTMLElement).style.display = '';
    }
  });
  document.querySelectorAll('.hz-Listing').forEach((listing) => {
    const title = getListingTitleText(listing);
    if (title.includes(term.toLowerCase())) {
      listing.removeAttribute('data-cleanplaats-hidden');
      (listing as HTMLElement).style.display = '';
    }
  });
};
