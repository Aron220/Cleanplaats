/** Inlined critical dark-mode rules (same as legacy theme-init.js) for document_start paint. */
export const EARLY_DARK_MODE_CSS = `
html.cleanplaats-dark-mode,
html.cleanplaats-dark-mode body,
html.cleanplaats-dark-mode .hz-Page,
html.cleanplaats-dark-mode .hz-Page-body,
html.cleanplaats-dark-mode .hz-Page-element,
html.cleanplaats-dark-mode #main-container,
html.cleanplaats-dark-mode #footer-container,
html.cleanplaats-dark-mode mp-header,
html.cleanplaats-dark-mode .mp-Header,
html.cleanplaats-dark-mode .hz-Header,
html.cleanplaats-dark-mode .hz-Header-navBar,
html.cleanplaats-dark-mode .mp-Header-navBar,
html.cleanplaats-dark-mode .mp-Header-ribbonBottom,
html.cleanplaats-dark-mode .mp-Nav-dropdown-menu,
html.cleanplaats-dark-mode .mp-HamburgerMenu,
html.cleanplaats-dark-mode .mymp,
html.cleanplaats-dark-mode .mymp .mp-Topbar,
html.cleanplaats-dark-mode .mymp .mp-Tab-bar,
html.cleanplaats-dark-mode .mymp .canvas,
html.cleanplaats-dark-mode .mymp .table.ad-listing-container,
html.cleanplaats-dark-mode .mymp .sticky,
html.cleanplaats-dark-mode .mymp #table-filters,
html.cleanplaats-dark-mode .mymp .table-body,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .row,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cells,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cell,
html.cleanplaats-dark-mode .mymp .filter-option.input,
html.cleanplaats-dark-mode .mymp .filter-option.select,
html.cleanplaats-dark-mode .mymp .wrapper.mp-Select.custom,
html.cleanplaats-dark-mode .mymp #tableActionPanel,
html.cleanplaats-dark-mode .mymp #select-all-container,
html.cleanplaats-dark-mode .mymp #scroll-under-top-border,
html.cleanplaats-dark-mode .mymp .overlay-loader.overlayed,
html.cleanplaats-dark-mode .mymp .bubble-help.info {
  background: #11161d !important;
  color: #e4ebf3 !important;
}

html.cleanplaats-dark-mode .hz-Header-navBar,
html.cleanplaats-dark-mode mp-header,
html.cleanplaats-dark-mode .mp-Header,
html.cleanplaats-dark-mode .mp-Header-navBar,
html.cleanplaats-dark-mode .mp-Header-ribbonBottom,
html.cleanplaats-dark-mode .mymp .mp-Topbar,
html.cleanplaats-dark-mode .mymp .mp-Tab-bar,
html.cleanplaats-dark-mode .mymp #table-filters,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .row,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cells,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact .cell,
html.cleanplaats-dark-mode .mymp #scroll-under-top-border,
html.cleanplaats-dark-mode .mymp .overlay-loader.overlayed,
html.cleanplaats-dark-mode .mymp .bubble-help.info {
  border-color: rgba(120, 143, 166, 0.16) !important;
}

html.cleanplaats-dark-mode .mymp .query.mp-Input,
html.cleanplaats-dark-mode .mymp select,
html.cleanplaats-dark-mode .mymp input[type="text"] {
  background: #1f2a36 !important;
  color: #e4ebf3 !important;
  border: 1px solid rgba(120, 143, 166, 0.22) !important;
  box-shadow: none !important;
}

html.cleanplaats-dark-mode .mymp .query.mp-Input::placeholder,
html.cleanplaats-dark-mode .mymp input::placeholder {
  color: #9aa8b8 !important;
}

html.cleanplaats-dark-mode .mymp .filter-title,
html.cleanplaats-dark-mode .mymp .filter-option.selected,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact span,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact a,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact button,
html.cleanplaats-dark-mode .mymp .table-head.ad-listing.compact label {
  color: #e4ebf3 !important;
}

html.cleanplaats-dark-mode .Skeleton-noShadow,
html.cleanplaats-dark-mode .Skeleton-border,
html.cleanplaats-dark-mode .Skeleton-base,
html.cleanplaats-dark-mode .Skeleton-base.Skeleton-text,
html.cleanplaats-dark-mode [class*="Skeleton"],
html.cleanplaats-dark-mode [class*="Skeleton-"],
html.cleanplaats-dark-mode .hz-StructuredListing.Skeleton-noShadow,
html.cleanplaats-dark-mode .hz-StructuredListing .hz-StructuredListing-image.Skeleton-border,
html.cleanplaats-dark-mode .hz-StructuredListing .hz-Image-container,
html.cleanplaats-dark-mode .hz-Listing .hz-Image-container {
  background: rgba(31, 42, 54, 0.52) !important;
  background-color: rgba(31, 42, 54, 0.52) !important;
  background-image: none !important;
  border-color: rgba(120, 143, 166, 0.16) !important;
  box-shadow: none !important;
}

html.cleanplaats-dark-mode .Skeleton-base::before,
html.cleanplaats-dark-mode .Skeleton-base.Skeleton-withAnimation::before,
html.cleanplaats-dark-mode [class*="Skeleton-base"]::before,
html.cleanplaats-dark-mode [class*="Skeleton-withAnimation"]::before {
  background: linear-gradient(
    90deg,
    rgba(31, 42, 54, 0) 0,
    rgba(49, 65, 82, 0.45) 50%,
    rgba(31, 42, 54, 0.52) 100%
  ) !important;
  background-color: rgba(31, 42, 54, 0.52) !important;
  background-image: linear-gradient(
    90deg,
    rgba(31, 42, 54, 0) 0,
    rgba(49, 65, 82, 0.45) 50%,
    rgba(31, 42, 54, 0.52) 100%
  ) !important;
}
`;
