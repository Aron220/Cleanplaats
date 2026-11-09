/**
 * Hiding whole categories from the search results: a main category ("Boeken")
 * or one subcategory of it ("Vinyl Singles").
 *
 * A card does not say which category it is in, but every listing in the
 * search payload does (categoryId is the subcategory, l1CategoryId the main
 * one), and content/search-bridge.js already hands those payloads over. So
 * matching runs off getListingFacts(), the same as the photo-grid filters: a
 * card whose listing is not known yet stays up until it is.
 *
 * Marktplaats and the two Belgian sites have their own category trees with
 * their own ids, while the settings are shared between them. Each entry
 * therefore remembers which tree it came from and only applies there.
 */

function getCategorySiteScope() {
    return is2dehandsFamilySite() ? 'be' : 'nl';
}

function normalizeBlockedCategoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = String(entry.id || '').trim();
    if (!/^\d+$/.test(id)) return null;

    return {
        id,
        name: String(entry.name || '').trim() || `#${id}`,
        parentId: /^\d+$/.test(String(entry.parentId || '')) ? String(entry.parentId) : '',
        parentName: String(entry.parentName || '').trim(),
        site: entry.site === 'be' ? 'be' : 'nl'
    };
}

function getBlockedCategoryEntries() {
    const scope = getCategorySiteScope();
    return (CLEANPLAATS.settings.blockedCategories || [])
        .map(normalizeBlockedCategoryEntry)
        .filter(entry => entry && entry.site === scope);
}

function isBlockedCategoryEntry(id) {
    return getBlockedCategoryEntries().some(entry => entry.id === String(id));
}

// A main category entry has no parent and matches on the listing's main
// category; a subcategory entry matches on its own id.
function isListingCategoryBlocked(categoryId, l1CategoryId) {
    const sub = String(categoryId || '');
    const main = String(l1CategoryId || '');
    if (!sub && !main) return false;

    return getBlockedCategoryEntries().some(entry => (entry.parentId
        ? entry.id === sub
        : entry.id === main));
}

// The cards category blocks apply to: the results of a search, or on the
// homepage the "Voor jou" / "In je buurt" feed, whose items carry their
// category in /hp/api/feed-items (see content/search-bridge.js). Scoped to
// the feed itself, so photo cards elsewhere (a carousel on an ad page) are
// never taken for it.
var CLEANPLAATS_FEED_CARD_SELECTOR = '.FeedItemList-module-container .hz-StructuredListing';

function getCategoryFilterCards() {
    return isSearchResultsPage()
        ? getSearchResultCards()
        : document.querySelectorAll(CLEANPLAATS_FEED_CARD_SELECTOR);
}

// The bridge only sees the feed pages the site fetches. The ones it loaded on
// an earlier visit (up to six hours back) it keeps in sessionStorage and
// renders from there without a request, so on a return visit the first
// hundred or more cards would never be matched. Same items as the API, read
// once per page load: anything newer comes through the bridge.
var CLEANPLAATS_FEED_CACHE_KEY_PATTERN = /^HOMEPAGE_FEED_.+_VALUE$/;

function indexHomepageFeedCache() {
    if (isSearchResultsPage() || CLEANPLAATS.runtime.feedCacheIndexed) return;
    CLEANPLAATS.runtime.feedCacheIndexed = true;

    let keys = [];
    try {
        keys = Object.keys(sessionStorage).filter(key => CLEANPLAATS_FEED_CACHE_KEY_PATTERN.test(key));
    } catch (error) {
        return;
    }

    keys.forEach(key => {
        try {
            const pages = JSON.parse(sessionStorage.getItem(key) || 'null')?.feedItems;
            Object.values(pages || {}).forEach(items => {
                (Array.isArray(items) ? items : []).forEach(item => {
                    const itemId = String(item?.itemId || '').toLowerCase();
                    const id = item?.category?.id ? String(item.category.id) : '';
                    if (!itemId || !id) return;

                    const parentId = item.category.parentId ? String(item.category.parentId) : '';
                    rememberListingFacts(itemId, { categoryId: id, l1CategoryId: parentId || id });
                    rememberListingImage(itemId, (String(item.picture?.url || '').match(CLEANPLAATS_LISTING_IMAGE_ID_PATTERN) || [])[1]);
                });
            });
        } catch (error) {
            // A cache the site changed shape of only costs the matching.
        }
    });
}

function hideBlockedCategoryListings() {
    if (getBlockedCategoryEntries().length === 0) return 0;
    indexHomepageFeedCache();

    let count = 0;
    getCategoryFilterCards().forEach(listing => {
        if (listing.hasAttribute('data-cleanplaats-hidden')) return;
        const facts = getListingFacts(listing);
        if (facts && isListingCategoryBlocked(facts.categoryId, facts.l1CategoryId) && hideElement(listing)) {
            count++;
        }
    });
    return count;
}

function getCategoryEntryLabel(entry) {
    return entry.parentName ? `${entry.parentName} › ${entry.name}` : entry.name;
}

function addBlockedCategory(entry) {
    const normalized = normalizeBlockedCategoryEntry({ ...entry, site: getCategorySiteScope() });
    if (!normalized || isBlockedCategoryEntry(normalized.id)) return;

    const panelText = getPanelLocaleText();
    CLEANPLAATS.settings.blockedCategories = [...(CLEANPLAATS.settings.blockedCategories || []), normalized];
    incrementActionCount();
    saveSettings().then(() => {
        renderCategoriesModal();
        performCleanup();
        showBubbleNotification(panelText.categoryToastHidden(getCategoryEntryLabel(normalized)),
            () => removeBlockedCategory(normalized.id));
        refreshDonationNudge();
    });
}

function removeBlockedCategory(id) {
    const scope = getCategorySiteScope();
    const entry = getBlockedCategoryEntries().find(item => item.id === String(id));
    if (!entry) return;

    const panelText = getPanelLocaleText();
    CLEANPLAATS.settings.blockedCategories = (CLEANPLAATS.settings.blockedCategories || [])
        .filter(item => !(String(item?.id) === entry.id && (item?.site === 'be' ? 'be' : 'nl') === scope));
    saveSettings().then(() => {
        renderCategoriesModal();
        // Lifting a block has to bring cards back, which only a fresh pass does.
        resetPreviousChanges();
        performCleanup();
        showBubbleNotification(panelText.categoryToastShown(getCategoryEntryLabel(entry)));
    });
}

/* ---- Where the category names come from ---------------------------------- */

var cleanplaatsCategoryRequests = {};

function fetchCategoryOptions(params) {
    const key = new URLSearchParams(params).toString();
    if (cleanplaatsCategoryRequests[key]) return cleanplaatsCategoryRequests[key];

    const request = fetch(`/lrp/api/search?${key}`, { credentials: 'same-origin' })
        .then(response => (response.ok ? response.json() : null))
        .then(data => (Array.isArray(data?.searchCategoryOptions) ? data.searchCategoryOptions : null))
        .catch(() => null)
        .then(options => {
            if (!options) delete cleanplaatsCategoryRequests[key];
            return options;
        });

    cleanplaatsCategoryRequests[key] = request;
    return request;
}

// fullName, not name: the short one drops what tells siblings apart ("Klassiek"
// is both "Cd's | Klassiek" and "Vinyl | Klassiek", "Huizen" both te koop and
// te huur).
function toCategoryOption(item) {
    return { id: String(item.id), name: String(item.fullName || item.name || item.label || '') };
}

// The page usually has them already (see readAlertMainCategoriesFromPage); a
// search for any word returns them otherwise.
function loadMainCategories() {
    const tree = CLEANPLAATS.runtime.categoryTree;
    if (tree.main) return Promise.resolve(tree.main);

    const fromPage = typeof readAlertMainCategoriesFromPage === 'function' ? readAlertMainCategoriesFromPage() : null;
    if (fromPage && fromPage.length > 1) {
        tree.main = fromPage.map(toCategoryOption);
        return Promise.resolve(tree.main);
    }

    return fetchCategoryOptions({ query: 'a', limit: '1', offset: '0' }).then(options => {
        const main = (options || []).filter(item => item.parentId === null || item.parentId === undefined);
        if (main.length > 1) tree.main = main.map(toCategoryOption);
        return tree.main;
    });
}

// A search on just the main category lists all of its subcategories.
function loadSubCategories(l1Id) {
    const tree = CLEANPLAATS.runtime.categoryTree;
    const key = String(l1Id);
    if (tree.sub[key]) return Promise.resolve(tree.sub[key]);

    return fetchCategoryOptions({ l1CategoryId: key, limit: '1', offset: '0' }).then(options => {
        const subs = (options || []).filter(item => String(item.parentId) === key).map(toCategoryOption);
        if (subs.length > 0) {
            subs.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
            tree.sub[key] = subs;
        }
        return tree.sub[key] || null;
    });
}

// What to offer for one-click hiding. First the main categories of the ads
// that are on this page right now, most ads first: those are what the user is
// looking at. Then the biggest ones of the whole search, from the site's own
// category facet. The facet alone is not enough: it only lists the largest
// subcategories of the search, so a category can have ads on the page and
// still be missing from it.
function getSearchCategorySuggestions() {
    const onSearchPage = isSearchResultsPage();
    if (!onSearchPage && !document.querySelector(CLEANPLAATS_FEED_CARD_SELECTOR)) return [];
    indexHomepageFeedCache();

    const names = new Map();
    (CLEANPLAATS.runtime.categoryTree.main || []).forEach(item => names.set(item.id, item.name));

    const totals = new Map();
    // The homepage has no search, so no facet: only what the feed has loaded.
    const facet = onSearchPage && Array.isArray(CLEANPLAATS.runtime.searchCategories)
        ? CLEANPLAATS.runtime.searchCategories
        : [];
    facet.forEach(item => {
        if (item.parentId) return;
        if (item.label && !names.has(item.id)) names.set(item.id, item.label);
        totals.set(item.id, item.count || 0);
    });
    facet.forEach(item => {
        if (item.parentId && totals.has(item.parentId)) {
            totals.set(item.parentId, totals.get(item.parentId) + (item.count || 0));
        }
    });

    const onPage = new Map();
    getCategoryFilterCards().forEach(listing => {
        if (listing.hasAttribute('data-cleanplaats-hidden')) return;
        const main = getListingFacts(listing)?.l1CategoryId;
        if (main) onPage.set(main, (onPage.get(main) || 0) + 1);
    });

    const usable = id => names.get(id) && !isBlockedCategoryEntry(id);

    const fromPage = [...onPage.entries()]
        .filter(([id]) => usable(id))
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id, name: names.get(id), onPage: count, total: 0 }));

    const fromSearch = [...totals.entries()]
        .filter(([id]) => usable(id) && !onPage.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.max(0, 10 - fromPage.length))
        .map(([id, total]) => ({ id, name: names.get(id), onPage: 0, total }));

    return [...fromPage, ...fromSearch];
}

/* ---- The modal ------------------------------------------------------------ */

var CLEANPLAATS_PANEL_MODAL_IDS = [
    'cleanplaats-blacklist-modal',
    'cleanplaats-terms-modal',
    'cleanplaats-blocked-listings-modal',
    'cleanplaats-categories-modal',
    'cleanplaats-alerts-modal'
];

function hideOtherPanelModals(keepId) {
    CLEANPLAATS_PANEL_MODAL_IDS.forEach(id => {
        if (id === keepId) return;
        const modal = document.getElementById(id);
        if (modal) modal.style.display = 'none';
    });
}

// What the user picked in the "other category" picker, so a re-render after
// a block elsewhere does not throw it away.
var cleanplaatsCategoryPicker = { main: '', sub: '' };

function showCategoriesModal(triggerButton) {
    const modal = document.getElementById('cleanplaats-categories-modal');
    if (!modal) return;

    hideOtherPanelModals('cleanplaats-categories-modal');

    if (modal.style.display === 'block') {
        modal.style.display = 'none';
        return;
    }

    cleanplaatsCategoryPicker = { main: '', sub: '' };
    cleanplaatsCategoriesModalBottom = triggerButton
        ? window.innerHeight - triggerButton.getBoundingClientRect().top + 8
        : null;
    modal.style.removeProperty('top');
    modal.style.display = 'block';
    renderCategoriesModal();

    // The names of the categories on this page come with the main list, so
    // the whole modal is drawn again once it is in, not just the picker.
    const hadMain = Boolean(CLEANPLAATS.runtime.categoryTree.main);
    loadMainCategories().then(() => (hadMain ? paintCategoryPicker() : renderCategoriesModal()));
}

// Where the modal wants to sit: just above the button that opened it. Null
// leaves it to the stylesheet.
var cleanplaatsCategoriesModalBottom = null;

// The modal hangs above its button, and this one is tall: in a short window,
// or with the button high on screen, that put its top above the viewport with
// no way to scroll to it. So it is never taller than the window, and slides
// down as far as it has to. Runs after every render, since the height changes
// with the lists.
function fitCategoriesModalToViewport() {
    const modal = document.getElementById('cleanplaats-categories-modal');
    if (!modal || modal.style.display !== 'block') return;

    const margin = 8;
    // max-height leaves the padding out, so it comes off here.
    const style = getComputedStyle(modal);
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    modal.style.maxHeight = `${Math.max(120, window.innerHeight - margin * 2 - padding)}px`;
    if (cleanplaatsCategoriesModalBottom === null) return;

    // Measured rather than calculated: what "bottom" counts from is the
    // panel's business, and it is not always the edge of the window.
    // The button can also be scrolled out of sight inside the panel, which
    // would hang the modal below the window instead of above it.
    let bottom = cleanplaatsCategoriesModalBottom;
    modal.style.bottom = `${bottom}px`;
    const rect = modal.getBoundingClientRect();
    const underBottom = rect.bottom - (window.innerHeight - margin);
    if (underBottom > 0) bottom += underBottom;
    const overTop = margin - (rect.top - Math.max(0, underBottom));
    if (overTop > 0) bottom -= overTop;
    modal.style.bottom = `${bottom}px`;
}

window.addEventListener('resize', fitCategoriesModalToViewport);

// Called when settings or the search change while the modal is open.
function updateCategoriesModal() {
    // A search response landing while a dropdown is open would close it under
    // the user's cursor; the next change repaints anyway.
    const modal = document.getElementById('cleanplaats-categories-modal');
    if (modal && modal.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    renderCategoriesModal();
}

// What the open modal last listed under "In deze zoekresultaten" / "Op de
// homepage", to tell whether a cleanup pass changed it.
var cleanplaatsCategorySuggestionsShown = '';

function getCategorySuggestionsSignature(suggestions) {
    return suggestions.map(item => `${item.id}:${item.onPage}:${item.total}`).join(',');
}

// Run after every cleanup pass. The feed keeps loading cards while the modal
// is open, and a cleanup pass is what follows them onto the page, so this is
// where the counts can change. Only redrawn when they did: a pass runs on
// every mutation of the page, and a redraw takes the focus off its buttons.
function refreshCategorySuggestions() {
    const modal = document.getElementById('cleanplaats-categories-modal');
    if (!modal || modal.style.display !== 'block') return;
    if (getCategorySuggestionsSignature(getSearchCategorySuggestions()) === cleanplaatsCategorySuggestionsShown) return;
    updateCategoriesModal();
}

function renderCategoriesModal() {
    const modal = document.getElementById('cleanplaats-categories-modal');
    if (!modal || modal.style.display !== 'block') return;
    const panelText = getPanelLocaleText();

    const blocked = getBlockedCategoryEntries();
    const suggestions = getSearchCategorySuggestions();
    cleanplaatsCategorySuggestionsShown = getCategorySuggestionsSignature(suggestions);
    const numberLocale = is2ememainLocale() ? 'fr-BE' : 'nl-NL';

    modal.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-terms-modal-content cleanplaats-categories-modal-content">
            <h4><span class="cleanplaats-modal-title-icon">${alertIcon('grid', 18)}</span>${panelText.categoriesModalTitle}</h4>

            <div class="cleanplaats-terms-section-label">${panelText.categoriesBlockedLabel}</div>
            <ul id="cleanplaats-categories-list">
                ${blocked.length === 0 ? `<li><em>${panelText.categoriesEmpty}</em></li>` : blocked.map(entry => `
                    <li>
                        <span title="${escapeHtmlText(getCategoryEntryLabel(entry))}">${escapeHtmlText(getCategoryEntryLabel(entry))}</span>
                        <button type="button" class="cleanplaats-unblock-category-btn" data-category-id="${escapeHtmlText(entry.id)}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')}
            </ul>

            ${suggestions.length > 0 ? `
            <div class="cleanplaats-terms-section">
                <div class="cleanplaats-terms-section-label">${isSearchResultsPage() ? panelText.categoriesInResultsLabel : panelText.categoriesInFeedLabel}</div>
                <ul class="cleanplaats-category-suggestions">
                    ${suggestions.map(item => `
                        <li>
                            <span title="${escapeHtmlText(item.name)}">${escapeHtmlText(item.name)}${item.onPage
                                ? `<small class="cleanplaats-category-count">${panelText.categoriesOnPageCount(item.onPage)}</small>`
                                : (item.total ? `<small class="cleanplaats-category-count">${panelText.categoriesInSearchCount(item.total.toLocaleString(numberLocale))}</small>` : '')}</span>
                            <button type="button" class="cleanplaats-inline-button cleanplaats-block-category-btn" data-category-id="${escapeHtmlText(item.id)}" data-category-name="${escapeHtmlText(item.name)}">${panelText.categoriesHideButton}</button>
                        </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}

            <div class="cleanplaats-terms-section">
                <div class="cleanplaats-terms-section-label">${panelText.categoriesPickLabel}</div>
                <select id="cleanplaats-category-main" class="cleanplaats-term-input cleanplaats-category-select" aria-label="${panelText.categoriesMainPlaceholder}">
                    <option value="">${panelText.categoriesLoading}</option>
                </select>
                <select id="cleanplaats-category-sub" class="cleanplaats-term-input cleanplaats-category-select" aria-label="${panelText.categoriesSubAll}" disabled>
                    <option value="">${panelText.categoriesSubAll}</option>
                </select>
                <button type="button" id="cleanplaats-category-add" class="cleanplaats-add-term-btn cleanplaats-category-add" disabled>${panelText.categoriesHideButton}</button>
                <div class="cleanplaats-input-help">${panelText.categoriesHelp}</div>
            </div>

            <button type="button" id="cleanplaats-categories-close" style="margin-top:12px;">${panelText.closeButton}</button>
        </div>
    `);

    document.getElementById('cleanplaats-categories-close').onclick = () => {
        modal.style.display = 'none';
    };

    modal.querySelectorAll('.cleanplaats-unblock-category-btn').forEach(btn => {
        btn.onmouseover = () => { btn.textContent = panelText.unhideButton; };
        btn.onmouseout = () => { btn.textContent = panelText.hiddenButton; };
        btn.onclick = () => removeBlockedCategory(btn.dataset.categoryId);
    });

    modal.querySelectorAll('.cleanplaats-block-category-btn').forEach(btn => {
        btn.onclick = () => addBlockedCategory({ id: btn.dataset.categoryId, name: btn.dataset.categoryName });
    });

    const mainSelect = document.getElementById('cleanplaats-category-main');
    const subSelect = document.getElementById('cleanplaats-category-sub');

    mainSelect.onchange = () => {
        cleanplaatsCategoryPicker = { main: mainSelect.value, sub: '' };
        paintCategoryPicker();
        if (mainSelect.value) loadSubCategories(mainSelect.value).then(() => paintCategoryPicker());
    };
    subSelect.onchange = () => {
        cleanplaatsCategoryPicker.sub = subSelect.value;
        paintCategoryPicker();
    };
    document.getElementById('cleanplaats-category-add').onclick = () => {
        const tree = CLEANPLAATS.runtime.categoryTree;
        const main = (tree.main || []).find(item => item.id === cleanplaatsCategoryPicker.main);
        if (!main) return;
        const sub = (tree.sub[main.id] || []).find(item => item.id === cleanplaatsCategoryPicker.sub);
        cleanplaatsCategoryPicker = { main: '', sub: '' };
        addBlockedCategory(sub
            ? { id: sub.id, name: sub.name, parentId: main.id, parentName: main.name }
            : { id: main.id, name: main.name });
    };

    paintCategoryPicker();
    fitCategoriesModalToViewport();
}

// Built as elements: the names are the site's own text, so there is no
// escaping to get wrong.
function paintCategoryPicker() {
    const mainSelect = document.getElementById('cleanplaats-category-main');
    const subSelect = document.getElementById('cleanplaats-category-sub');
    const addButton = document.getElementById('cleanplaats-category-add');
    if (!mainSelect || !subSelect || !addButton) return;
    const panelText = getPanelLocaleText();
    const tree = CLEANPLAATS.runtime.categoryTree;
    const picked = cleanplaatsCategoryPicker;

    const fill = (select, placeholder, items) => {
        select.replaceChildren();
        const first = document.createElement('option');
        first.value = '';
        first.textContent = placeholder;
        select.appendChild(first);
        (items || []).forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            option.disabled = isBlockedCategoryEntry(item.id);
            select.appendChild(option);
        });
    };

    fill(mainSelect, tree.main ? panelText.categoriesMainPlaceholder : panelText.categoriesLoading, tree.main);
    mainSelect.value = picked.main;

    const subs = picked.main ? tree.sub[picked.main] : null;
    fill(subSelect, picked.main && !subs ? panelText.categoriesLoading : panelText.categoriesSubAll, subs);
    subSelect.value = picked.sub;
    subSelect.disabled = !picked.main || !subs || isBlockedCategoryEntry(picked.main);

    const target = picked.sub || picked.main;
    addButton.disabled = !target || isBlockedCategoryEntry(target);
}
