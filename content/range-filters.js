/**
 * Works around a site bug with range filters set to 0.
 *
 * The range filters (price, and on some categories mileage, year, ...) keep
 * their ends in the fragment as "<key>From:<value>" and "<key>To:<value>".
 * When the page fills the "van"/"tot" boxes back in from that, it treats 0 as
 * "nothing entered": a search for free items (PriceCentsFrom:0|PriceCentsTo:0)
 * comes back from an ad, or from any other filter change, with both boxes
 * empty. The search itself still has the filter, but the boxes say otherwise,
 * so to the user the filter looks gone. It happens without Cleanplaats too.
 *
 * This puts the 0 back in the box. It goes through the page's own input event
 * so React's state agrees with what is shown; that does not start a new search,
 * the site only applies a range on Enter or blur.
 */

const CLEANPLAATS_RANGE_GROUP_SELECTOR = '[role="group"][aria-labelledby^="range-"]';
const CLEANPLAATS_RANGE_RESTORE_DELAY_MS = 100;

let rangeFilterRestoreTimer = 0;

function restoreZeroRangeFilters() {
    if (!isPageHydrated()) return;

    const groups = document.querySelectorAll(CLEANPLAATS_RANGE_GROUP_SELECTOR);
    if (groups.length === 0) return;

    const hashParams = parseLocationHashParams();

    groups.forEach(group => {
        const key = group.getAttribute('aria-labelledby').slice('range-'.length);
        if (!key) return;

        [['from', 'From'], ['to', 'To']].forEach(([inputName, hashSuffix]) => {
            if (hashParams[key + hashSuffix] !== '0') return;

            const input = group.querySelector(`input[name="${inputName}"]`);
            // A focused box is being edited: leave whatever the user typed alone.
            if (!input || input.value !== '' || input === document.activeElement) return;

            input.value = '0';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
}

function scheduleZeroRangeFilterRestore() {
    clearTimeout(rangeFilterRestoreTimer);
    rangeFilterRestoreTimer = setTimeout(restoreZeroRangeFilters, CLEANPLAATS_RANGE_RESTORE_DELAY_MS);
}

// The boxes are emptied on every re-render after a filter change, and on
// mobile they only exist while the filter sheet is open, so this watches the
// page rather than waiting for one moment. Not limited to search pages: the
// site can navigate to one client-side after this script has loaded.
function watchZeroRangeFilters() {
    new MutationObserver(scheduleZeroRangeFilterRestore)
        .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });

    scheduleZeroRangeFilterRestore();
}
