/**
 * Verkoper-check: surfaces what the site verified about the seller of the
 * listing you are looking at, next to the contact buttons.
 *
 * The site already has this data. It renders it far down the page, under
 * "Verkoper", and only ever phrased positively: a seller with one of three
 * checks done reads as "gecontroleerd op telefoonnummer", which looks like a
 * pass unless you happen to know the full list. What is missing is never named.
 * This panel names it, and puts it where the decision to message the seller is
 * actually made.
 *
 * The booleans are not in the page. The detail page ships showVerifications,
 * which only says a verification block belongs here, and fetches the rest
 * separately. So this asks the same endpoint the page itself asks.
 */

var CLEANPLAATS_SELLER_VERIFICATION_ID = 'cleanplaats-seller-verification';

// The panel sits in Marktplaats' own sidebar and looks at home there, which is
// the point visually and a problem editorially: it passes judgement on a seller
// and nobody should read that as the site's own verdict. So it signs its name.
// Same mark as the control panel, inlined because a content script cannot count
// on loading an extension file into a page.
var CLEANPLAATS_SELLER_VERIFICATION_LOGO = `
    <svg class="cleanplaats-seller-verification-logo" viewBox="8 8 112 112" width="14" height="14" aria-hidden="true">
        <circle cx="64" cy="64" r="56" fill="#eda566"></circle>
        <path d="M 32 36.5 H 96 L 71 70.5 V 84 L 57.5 94.5 V 67.5 Z" fill="none" stroke="#2d3c4d" stroke-width="6.75" stroke-linejoin="round"></path>
    </svg>`;

// Order matters: this is the order the rows are read in. KvK is deliberately
// last because it only shows up for the business sellers that have it.
var CLEANPLAATS_SELLER_VERIFICATION_CHECKS = ['bankAccount', 'phoneNumber', 'identification'];

function removeSellerVerificationPanel() {
    document.getElementById(CLEANPLAATS_SELLER_VERIFICATION_ID)?.remove();
}

/**
 * The endpoint is public and answers without a session, so ask for it without
 * one. Cleanplaats has no reason to attach the user's cookies to a request the
 * user did not make.
 */
async function fetchSellerVerification(sellerId, sellerName) {
    const cache = CLEANPLAATS.runtime.sellerVerificationProfiles;
    if (Object.prototype.hasOwnProperty.call(cache, sellerId)) {
        return cache[sellerId];
    }

    const params = sellerName ? `?sellerName=${encodeURIComponent(sellerName)}` : '';

    try {
        const response = await fetch(`/v/api/seller-profile/${encodeURIComponent(sellerId)}${params}`, {
            credentials: 'omit',
            headers: { Accept: 'application/json' }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const profile = await response.json();
        cache[sellerId] = profile;
        return profile;
    } catch (error) {
        console.warn('Cleanplaats: Failed to load seller verification', error);
        // Cache the failure too, so a seller whose profile 404s does not get
        // re-requested on every mutation of the sidebar.
        cache[sellerId] = null;
        return null;
    }
}

/**
 * An unknown seller id still answers 200, with an object that simply omits the
 * verification booleans. Rendering that would read as "niets gecontroleerd",
 * which is an accusation, not a missing field. Only trust a response that
 * actually states at least one of the three.
 */
function isUsableSellerProfile(profile) {
    if (!profile || typeof profile !== 'object') return false;

    return CLEANPLAATS_SELLER_VERIFICATION_CHECKS.some(key => typeof profile[key] === 'boolean');
}

/**
 * Which rows to show. The KvK row only appears once the site reports it as done.
 *
 * smbVerified true is real and worth showing. smbVerified false says nothing
 * usable: it does not separate "company number never verified" from "not in
 * this programme". Of 19 car dealers sampled, zero had it set, and those are
 * about as professional as sellers get. A cross there would land on nearly
 * every dealership on the site, and a row that cries wolf costs us the three
 * rows above it that are accurate. So credit the check when it is earned and
 * stay quiet otherwise. A private seller has no KvK number to begin with.
 */
function getSellerVerificationRows(profile) {
    const keys = CLEANPLAATS_SELLER_VERIFICATION_CHECKS.slice();

    if (profile.smbVerified === true) {
        keys.push('smbVerified');
    }

    return keys.map(key => ({ key, ok: profile[key] === true }));
}

function getSellerVerificationReviewText(profile) {
    const panelText = getPanelLocaleText();
    const review = Array.isArray(profile.reviews) ? profile.reviews[0] : null;
    const count = Number(review?.numberOfReviews) || 0;

    if (!review || count < 1) return panelText.sellerVerificationNoReviews;

    return panelText.sellerVerificationReviews(review.rating, count);
}

function buildSellerVerificationMarkup(profile) {
    const panelText = getPanelLocaleText();
    const rows = getSellerVerificationRows(profile);
    const done = rows.filter(row => row.ok).length;

    let summaryText = panelText.sellerVerificationSummaryPartial(done, rows.length);
    let tone = 'partial';

    if (done === rows.length) {
        summaryText = panelText.sellerVerificationSummaryAll;
        tone = 'all';
    } else if (done === 0) {
        summaryText = panelText.sellerVerificationSummaryNone;
        tone = 'none';
    }

    const rowsMarkup = rows.map(row => `
        <li class="cleanplaats-seller-check ${row.ok ? 'is-ok' : 'is-missing'}">
            <span class="cleanplaats-seller-check-mark" aria-hidden="true">${row.ok ? '✓' : '✕'}</span>
            <span class="cleanplaats-seller-check-label">
                ${panelText.sellerVerificationChecks[row.key]}
                <span class="cleanplaats-seller-check-state">${row.ok ? panelText.sellerVerificationCheckedSuffix : panelText.sellerVerificationUncheckedSuffix}</span>
            </span>
        </li>
    `).join('');

    // Only the fully unverified case gets advice. On a seller with two of three
    // checks done it would read as a warning the data does not support, and a
    // line that shows up everywhere stops being read at all.
    const adviceMarkup = tone === 'none'
        ? `<p class="cleanplaats-seller-verification-advice">${panelText.sellerVerificationAdvice}</p>`
        : '';

    return `
        <div class="cleanplaats-seller-verification-brand">
            ${CLEANPLAATS_SELLER_VERIFICATION_LOGO}
            <span>Cleanplaats</span>
        </div>
        <div class="cleanplaats-seller-verification-head">
            <span class="cleanplaats-seller-verification-title">${panelText.sellerVerificationTitle}</span>
            <span class="cleanplaats-seller-verification-summary cleanplaats-tone-${tone}">${summaryText}</span>
        </div>
        <ul class="cleanplaats-seller-checks">${rowsMarkup}</ul>
        <p class="cleanplaats-seller-verification-reviews">${getSellerVerificationReviewText(profile)}</p>
        ${adviceMarkup}
    `;
}

function mountSellerVerificationPanel(markup) {
    const sellerRoot = document.querySelector(CLEANPLAATS_SELLER_INFO_SELECTOR);
    if (!sellerRoot) return null;

    let panel = document.getElementById(CLEANPLAATS_SELLER_VERIFICATION_ID);
    if (!panel) {
        panel = document.createElement('section');
        panel.id = CLEANPLAATS_SELLER_VERIFICATION_ID;
        panel.className = 'cleanplaats-seller-verification';
    }

    panel.innerHTML = DOMPurify.sanitize(markup);

    // Between the seller box and the contact buttons: last thing read before
    // "Stuur bericht" gets clicked. The hide-seller button claims the same spot
    // and is injected on its own schedule, so anchor to it when it is already
    // there. Without that the two swap places depending on which ran first.
    const anchor = document.querySelector('.cleanplaats-detail-blacklist-row') || sellerRoot;
    if (panel.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', panel);
    }

    return panel;
}

async function maybeShowSellerVerificationPanel() {
    const state = CLEANPLAATS.runtime.sellerVerification;

    if (!isProductDetailPage() || !CLEANPLAATS.settings.sellerVerificationPanelEnabled) {
        removeSellerVerificationPanel();
        return;
    }

    const seller = getDetailPageSeller();

    // showVerifications false means the site publishes no verification block for
    // this seller at all. Building one anyway would state as fact something
    // Marktplaats itself declines to say.
    if (!seller?.id || !seller.showVerifications) {
        removeSellerVerificationPanel();
        return;
    }

    if (!document.querySelector(CLEANPLAATS_SELLER_INFO_SELECTOR)) {
        removeSellerVerificationPanel();
        return;
    }

    const requestKey = `${window.location.pathname}|${seller.id}`;

    // The sidebar re-renders on its own while the page settles, and every one of
    // those mutations lands here. Nothing to do while a request for this seller
    // is in flight, or once we have decided there is nothing worth showing.
    if (state.key === requestKey) {
        if (state.status === 'pending' || state.status === 'empty') return;
        if (state.status === 'ready') {
            // Only rebuild if the site re-rendered our panel away.
            if (document.getElementById(CLEANPLAATS_SELLER_VERIFICATION_ID)) return;
            mountSellerVerificationPanel(buildSellerVerificationMarkup(state.profile));
            return;
        }
    }

    state.key = requestKey;
    state.status = 'pending';
    state.profile = null;

    const profile = await fetchSellerVerification(seller.id, seller.name);

    // The user navigated while the request was in flight.
    if (state.key !== requestKey) return;

    // Nothing trustworthy to say. Say nothing: an error box parked next to the
    // contact buttons on every listing is worse than no panel at all.
    if (!isUsableSellerProfile(profile)) {
        state.status = 'empty';
        removeSellerVerificationPanel();
        return;
    }

    state.status = 'ready';
    state.profile = profile;
    mountSellerVerificationPanel(buildSellerVerificationMarkup(profile));
}

function scheduleSellerVerificationCheck(options = {}) {
    if (options.resetState === true || options.force === true) {
        CLEANPLAATS.runtime.sellerVerification = { key: '', status: 'idle', profile: null };
    }

    if (options.force === true) {
        removeSellerVerificationPanel();
    }

    window.clearTimeout(CLEANPLAATS.runtime.sellerVerificationTimer);
    CLEANPLAATS.runtime.sellerVerificationTimer = window.setTimeout(() => {
        maybeShowSellerVerificationPanel();
    }, 180);
}
