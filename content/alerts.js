/**
 * Cleanplaats zoekmeldingen (search alerts) — Marktplaats only.
 *
 * The extension is only the UI: alerts live on the Cleanplaats Alerts server
 * (see server/README.md), which polls Marktplaats around the clock and
 * notifies via e-mail/Telegram. Auth is an e-mail account with passwordless
 * login codes; this device stores a session token, so alerts and premium
 * follow the account across devices.
 *
 * The UI is a full-screen overlay (not the small panel popup): it renders a
 * login view, then a dashboard with stats, alert cards and a match feed.
 */

var CLEANPLAATS_ALERTS_API_BASE = 'https://cleanplaats-alerts.aron-vanderwal-46a.workers.dev';
var CLEANPLAATS_ALERTS_TOKEN_KEY = 'cleanplaatsAlertsToken';
var CLEANPLAATS_ALERTS_API_BASE_KEY = 'cleanplaatsAlertsApiBase';

var cleanplaatsAlertsRuntime = {
    token: '',
    apiBase: '',
    me: null,
    pendingEmail: ''
};

var ALERTS_TEXT = {
    modalTitle: 'Zoekmeldingen',
    tagline: 'Nieuwe advertenties direct in je inbox — ook als je browser dicht is.',
    intro: 'Krijg een melding zodra er een nieuwe advertentie verschijnt die aan je zoekopdracht voldoet — ook als je browser dicht is. Je Cleanplaats-filters worden automatisch toegepast.',
    loginTitle: 'Inloggen of account maken',
    loginIntro: 'Met een account ontvang je meldingen per e-mail en werken je zoekmeldingen op al je apparaten.',
    emailPlaceholder: 'jouw@email.nl',
    emailButton: 'Stuur inlogcode',
    emailSending: 'Versturen…',
    codeSentTo: email => `We hebben een 6-cijferige code gestuurd naar ${email}.`,
    codePlaceholder: '000000',
    codeButton: 'Inloggen',
    codeChecking: 'Controleren…',
    codeResend: 'Stuur nieuwe code',
    codeOtherEmail: 'Ander e-mailadres',
    loggedInAs: 'Ingelogd als',
    logout: 'Uitloggen',
    tierFree: 'Gratis',
    tierPremium: 'Premium',
    statAlerts: 'Meldingen',
    statInterval: 'Controle elke',
    statFound: 'Gevonden',
    createTitle: 'Nieuwe melding',
    createButton: 'Maak melding',
    labelPlaceholder: 'Zoekterm, bijv. iphone 15 pro',
    createTermMissing: 'Vul een zoekterm in.',
    createContextHint: 'Filters van je huidige zoekopdracht (categorie, locatie) gaan mee zolang je de zoekterm niet wijzigt.',
    atLimit: 'Je gebruikt al je beschikbare meldingen. Verwijder er een om een nieuwe te maken.',
    listTitle: 'Je meldingen',
    empty: 'Nog geen meldingen. Zoek iets op Marktplaats en maak je eerste melding.',
    deleteButton: 'Verwijder',
    deleteConfirm: 'Weet je zeker dat je deze melding wilt verwijderen?',
    pausedLabel: 'Gepauzeerd',
    activeLabel: 'Actief',
    matchCount: count => `${count} gevonden`,
    lastChecked: 'Laatste controle',
    neverChecked: 'Nog niet gecontroleerd',
    validityLeft: n => `Verloopt over ${n} ${n === 1 ? 'dag' : 'dagen'}`,
    validityExpired: 'Verlopen',
    extendButton: 'Verleng',
    reactivateButton: 'Reactiveren',
    extendedToast: 'Zoekmelding verlengd.',
    reactivatedToast: 'Zoekmelding gereactiveerd.',
    channelEmail: 'E-mail',
    channelTelegram: 'Telegram',
    statusLabel: 'Actief',
    matchesTitle: 'Gevonden advertenties',
    matchesEmpty: 'Nog geen advertenties gevonden. Na de eerste controle (binnen enkele minuten) verschijnen ze hier.',
    newBadge: 'NIEUW',
    channelsTitle: 'Meldingskanalen',
    emailAlwaysOn: 'Altijd aan',
    telegramConnect: 'Koppelen',
    telegramLinked: 'Gekoppeld',
    telegramNotLinked: 'Niet gekoppeld',
    telegramRelink: 'Ander account koppelen',
    telegramUnlink: 'Ontkoppelen',
    telegramUnlinkConfirm: 'Telegram ontkoppelen? Je ontvangt dan geen meldingen meer via Telegram.',
    telegramUnlinkedToast: 'Telegram ontkoppeld.',
    telegramManualHint: (bot, code) => `Werkt de knop niet? Open Telegram (bijv. op je telefoon), zoek @${bot} en stuur dit bericht: ${code}`,
    createdToast: 'Zoekmelding aangemaakt! Binnen enkele minuten zie je hier de huidige advertenties; daarna krijg je meldingen bij nieuwe.',
    deletedToast: 'Zoekmelding verwijderd.',
    limitToast: 'Je hebt het maximum aantal meldingen bereikt.',
    errorToast: 'Er ging iets mis bij het verbinden met de meldingenserver.',
    loading: 'Laden…',
    justNow: 'Zojuist',
    minutesAgo: m => `${m} min geleden`,
    hoursAgo: h => `${h} uur geleden`,
    closeButton: 'Sluiten',
    sortNewest: 'Nieuwste eerst',
    sortPriceAsc: 'Prijs: laag-hoog',
    sortPriceDesc: 'Prijs: hoog-laag',
    // Per-alert filters
    filterButton: 'Filters',
    filterEditorTitle: 'Wat wil je overslaan?',
    filterEditorIntro: 'Vink aan welke soorten advertenties je voor deze zoekmelding níét wilt zien.',
    filterDagtoppers: 'Dagtoppers',
    filterReserved: 'Gereserveerd',
    filterOpval: 'Opvalstickers',
    filterCountActive: n => `${n} aan`,
    filterNoneActive: 'Alles tonen',
    filterAlwaysExcluded: 'Top- en bedrijfsadvertenties krijg je nooit als melding.',
    filterGlobalListsTitle: 'Geblokkeerde verkopers & woorden',
    filterGlobalListsHint: 'Deze gelden voor al je zoekmeldingen. Beheren doe je in het Cleanplaats-paneel.',
    filterListSellers: n => `${n} verkoper${n !== 1 ? 's' : ''}`,
    filterListTerms: n => `${n} woord${n !== 1 ? 'en' : ''}`,
    filterListListings: n => `${n} advertentie${n !== 1 ? 's' : ''}`,
    filterListsNone: 'Geen blokkades ingesteld',
    filterSavedToast: 'Filter opgeslagen.'
};

/**
 * The per-alert ad-type toggles. The blacklist *lists* (sellers/terms/blocked
 * listings) are global and managed in the main panel, so they are not here.
 * `setting` maps to the global Cleanplaats setting used as the default when a
 * new alert is created.
 */
var ALERT_FILTER_DEFS = [
    { key: 'removeDagtoppers', setting: 'removeDagtoppers', label: () => ALERTS_TEXT.filterDagtoppers },
    { key: 'removeOpvalStickers', setting: 'removeOpvalStickers', label: () => ALERTS_TEXT.filterOpval },
    { key: 'removeReservedListings', setting: 'removeReservedListings', label: () => ALERTS_TEXT.filterReserved }
];

function getDefaultAlertFilters() {
    const s = (typeof CLEANPLAATS !== 'undefined' && CLEANPLAATS.settings) || {};
    const filters = {};
    ALERT_FILTER_DEFS.forEach(def => { filters[def.key] = Boolean(s[def.setting]); });
    return filters;
}

function parseAlertFilters(alert) {
    if (alert && alert.filters_json) {
        try {
            const parsed = JSON.parse(alert.filters_json);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                const filters = {};
                ALERT_FILTER_DEFS.forEach(def => { filters[def.key] = Boolean(parsed[def.key]); });
                return filters;
            }
        } catch (error) {
            console.error('Cleanplaats: invalid alert filters_json', error);
        }
    }
    // Older alert without its own filters: fall back to the current globals.
    return getDefaultAlertFilters();
}

function countActiveAlertFilters(filters) {
    return ALERT_FILTER_DEFS.reduce((n, def) => n + (filters[def.key] ? 1 : 0), 0);
}

/**
 * Crisp inline SVG icons (stroke = currentColor, so they follow text color
 * and dark mode for free). Emoji rendered tiny/blurry and ignored theming.
 */
var ALERTS_ICONS = {
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    send: '<path d="m22 2-11 11"/><path d="m22 2-7 20-4-9-9-4 20-7z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    key: '<path d="m21 2-2 2"/><path d="m15.5 7.5 3 3L22 7l-3-3-3.5 3.5z"/><path d="M11.39 11.61a5.5 5.5 0 1 0 1 1z"/><path d="m11.39 11.61 4.11-4.11"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
};

function alertIcon(name, size) {
    const s = size || 16;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ALERTS_ICONS[name] || ''}</svg>`;
}

function escapeAlertText(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatAlertRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    if (diff < 90 * 1000) return ALERTS_TEXT.justNow;
    if (diff < 60 * 60 * 1000) return ALERTS_TEXT.minutesAgo(Math.round(diff / 60000));
    if (diff < 24 * 60 * 60 * 1000) return ALERTS_TEXT.hoursAgo(Math.round(diff / 3600000));
    try {
        return new Date(timestamp).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
    } catch (error) {
        return '';
    }
}

/**
 * Validity window state for an alert. Returns null when the alert never
 * expires (expires_at missing/NULL). `soon` flags the last few days so the UI
 * can nudge with a Verleng button.
 */
function getAlertValidity(alert) {
    if (!alert || !alert.expires_at) return null;
    const msLeft = alert.expires_at - Date.now();
    if (msLeft <= 0) return { expired: true, daysLeft: 0, soon: false };
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    return { expired: false, daysLeft, soon: daysLeft <= 3 };
}

function formatAlertMatchPrice(match) {
    if (Number.isFinite(match.price_cents)) {
        const euros = match.price_cents / 100;
        return Number.isInteger(euros)
            ? `€ ${euros.toLocaleString('nl-NL')}`
            : `€ ${euros.toFixed(2).replace('.', ',')}`;
    }
    const typeLabels = {
        FAST_BID: 'Bieden',
        SEE_DESCRIPTION: 'Zie omschrijving',
        NOTK: 'N.o.t.k.',
        FREE: 'Gratis',
        ON_REQUEST: 'Op aanvraag'
    };
    return typeLabels[match.price_type] || '';
}

function sortAlertMatches(matches, mode) {
    const sorted = [...matches];
    if (mode === 'price_asc') {
        return sorted.sort((a, b) => {
            const pa = Number.isFinite(a.price_cents) ? a.price_cents : Infinity;
            const pb = Number.isFinite(b.price_cents) ? b.price_cents : Infinity;
            return pa - pb;
        });
    }
    if (mode === 'price_desc') {
        return sorted.sort((a, b) => {
            const pa = Number.isFinite(a.price_cents) ? a.price_cents : -Infinity;
            const pb = Number.isFinite(b.price_cents) ? b.price_cents : -Infinity;
            return pb - pa;
        });
    }
    // newest: non-baseline first, then by found_at DESC
    return sorted.sort((a, b) => (a.is_baseline - b.is_baseline) || (b.found_at - a.found_at));
}

function buildGlobalListsSummaryHtml() {
    const s = (typeof CLEANPLAATS !== 'undefined' && CLEANPLAATS.settings) || {};
    const sellerCount = (s.blacklistedSellers || []).length;
    const termCount = (s.blacklistedTerms || []).length + (s.blacklistedDescriptionTerms || []).length;
    const listingCount = (s.blockedListings || []).length;
    const chips = [];
    if (sellerCount > 0) chips.push(ALERTS_TEXT.filterListSellers(sellerCount));
    if (termCount > 0) chips.push(ALERTS_TEXT.filterListTerms(termCount));
    if (listingCount > 0) chips.push(ALERTS_TEXT.filterListListings(listingCount));
    const body = chips.length === 0
        ? `<span class="cleanplaats-alerts-filter-none">${ALERTS_TEXT.filterListsNone}</span>`
        : chips.map(c => `<span class="cleanplaats-alerts-filter-chip">${escapeAlertText(c)}</span>`).join('');
    return `
        <div class="cleanplaats-alerts-filter-global">
            <div class="cleanplaats-alerts-filter-global-head">${ALERTS_TEXT.filterGlobalListsTitle}</div>
            <div class="cleanplaats-alerts-filter-global-chips">${body}</div>
            <div class="cleanplaats-alerts-filter-global-hint">${ALERTS_TEXT.filterGlobalListsHint}</div>
        </div>
    `;
}

function buildAlertFilterBlockHtml(alert) {
    const filters = parseAlertFilters(alert);
    const activeCount = countActiveAlertFilters(filters);
    const summary = activeCount > 0
        ? `<span class="cleanplaats-alerts-filter-count">${ALERTS_TEXT.filterCountActive(activeCount)}</span>`
        : `<span class="cleanplaats-alerts-filter-count cleanplaats-alerts-filter-count-zero">${ALERTS_TEXT.filterNoneActive}</span>`;

    const toggles = ALERT_FILTER_DEFS.map(def => `
        <label class="cleanplaats-alerts-filter-opt">
            <input type="checkbox" data-alert-id="${alert.id}" data-filter-key="${def.key}"${filters[def.key] ? ' checked' : ''}>
            <span class="cleanplaats-alerts-filter-opt-box">${alertIcon('check', 12)}</span>
            <span class="cleanplaats-alerts-filter-opt-label">${def.label()}</span>
        </label>
    `).join('');

    return `
        <div class="cleanplaats-alerts-filter-block">
            <button class="cleanplaats-alerts-filter-trigger" type="button" data-alert-id="${alert.id}" aria-expanded="false">
                <span class="cleanplaats-alerts-filter-trigger-left">
                    ${alertIcon('filter', 13)}<span>${ALERTS_TEXT.filterButton}</span>${summary}
                </span>
                <span class="cleanplaats-alerts-filter-chevron">${alertIcon('chevron', 15)}</span>
            </button>
            <div class="cleanplaats-alerts-filter-editor" hidden>
                <p class="cleanplaats-alerts-filter-editor-intro">${ALERTS_TEXT.filterEditorIntro}</p>
                <div class="cleanplaats-alerts-filter-opts">${toggles}</div>
                <div class="cleanplaats-alerts-filter-always">${alertIcon('check', 13)}<span>${ALERTS_TEXT.filterAlwaysExcluded}</span></div>
                ${buildGlobalListsSummaryHtml()}
            </div>
        </div>
    `;
}

function renderAlertMatchItems(matches) {
    if (!matches || matches.length === 0) {
        return `<div class="cleanplaats-alerts-empty">${ALERTS_TEXT.matchesEmpty}</div>`;
    }
    return matches.map(match => {
        const isNew = !match.is_baseline && (Date.now() - match.found_at) < 24 * 60 * 60 * 1000;
        const thumb = match.image_url
            ? `<img class="cleanplaats-alerts-match-thumb" src="${escapeAlertText(match.image_url)}" alt="" loading="lazy">`
            : `<span class="cleanplaats-alerts-match-thumb cleanplaats-alerts-match-thumb-empty">${alertIcon('image', 20)}</span>`;
        return `
            <a class="cleanplaats-alerts-match" href="${escapeAlertText(match.url)}">
                ${thumb}
                <span class="cleanplaats-alerts-match-info">
                    <span class="cleanplaats-alerts-match-title">${isNew ? `<span class="cleanplaats-alerts-new">${ALERTS_TEXT.newBadge}</span> ` : ''}${escapeAlertText(match.title)}</span>
                    <span class="cleanplaats-alerts-match-sub">
                        <span class="cleanplaats-alerts-match-price">${formatAlertMatchPrice(match)}</span>
                        ${match.city ? `<span>· ${escapeAlertText(match.city)}</span>` : ''}
                        <span>· ${formatAlertRelativeTime(match.found_at)}</span>
                    </span>
                    <span class="cleanplaats-alerts-match-alert-label">${escapeAlertText(match.alert_label || '')}</span>
                </span>
            </a>
        `;
    }).join('');
}

function initAlertsRuntime() {
    return new Promise(resolve => {
        browserAPI.storage.local.get([CLEANPLAATS_ALERTS_TOKEN_KEY, CLEANPLAATS_ALERTS_API_BASE_KEY], items => {
            cleanplaatsAlertsRuntime.apiBase = items[CLEANPLAATS_ALERTS_API_BASE_KEY] || CLEANPLAATS_ALERTS_API_BASE;
            cleanplaatsAlertsRuntime.token = items[CLEANPLAATS_ALERTS_TOKEN_KEY] || '';
            resolve();
        });
    });
}

function storeAlertsToken(token) {
    cleanplaatsAlertsRuntime.token = token || '';
    return new Promise(resolve => {
        if (token) {
            browserAPI.storage.local.set({ [CLEANPLAATS_ALERTS_TOKEN_KEY]: token }, resolve);
        } else {
            browserAPI.storage.local.remove(CLEANPLAATS_ALERTS_TOKEN_KEY, resolve);
        }
    });
}

function alertsApiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (cleanplaatsAlertsRuntime.token) {
        headers['Authorization'] = `Bearer ${cleanplaatsAlertsRuntime.token}`;
    }

    return fetch(`${cleanplaatsAlertsRuntime.apiBase}${path}`, { ...options, headers })
        .then(response => response.json().catch(() => ({})).then(data => {
            if (!response.ok) {
                const error = new Error(data.error || `Alerts API error ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return data;
        }));
}

/**
 * Extracts the current search as server-ready /lrp/api/search params.
 * Mirrors buildSearchApiUrl() in cleanup.js, but returns the params instead
 * of a URL so the server can re-run the search on its own schedule.
 */
function getAlertSearchContext() {
    if (!isMarktplaatsSite()) return null;

    const href = window.location.href;
    if (!href.includes('/q/') && !href.includes('/l/')) return null;

    // Query straight from the URL. Marktplaats navigates client-side between
    // searches, so the server-rendered __NEXT_DATA__ blob can still describe
    // a *previous* search; the URL always matches what the user sees.
    const urlQuery = decodeURIComponent(
        (window.location.pathname.match(/\/q\/([^/]+)/) || [, ''])[1] || ''
    ).replace(/[-+]/g, ' ').trim();

    let searchParams = {};
    let query = '';

    try {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
            const q = JSON.parse(nextDataEl.textContent).query || {};
            if (q.searchQuery) {
                query = String(q.searchQuery);
                searchParams.query = query;
            }
            ['l1CategoryId', 'l2CategoryId', 'postcode', 'distanceMeters',
                'attributesValuesIds', 'attributesValuesKeys', 'attributesById',
                'attributesByKey', 'attributeRanges'].forEach(key => {
                if (q[key] !== undefined && q[key] !== null && q[key] !== '') {
                    searchParams[key] = q[key];
                }
            });
        }
    } catch (error) {
        console.error('Cleanplaats: Failed to read search context for alert', error);
    }

    if (urlQuery && query.toLowerCase() !== urlQuery.toLowerCase()) {
        // __NEXT_DATA__ is stale (or absent): trust the URL and drop the
        // filters that belonged to the old search.
        query = urlQuery;
        searchParams = { query: urlQuery };
    }

    // Hash params override (same precedence as buildSearchApiUrl).
    const hash = window.location.hash.replace('#', '');
    hash.split('|').forEach(part => {
        const colonIdx = part.indexOf(':');
        if (colonIdx <= 0) return;
        const key = part.slice(0, colonIdx);
        const value = part.slice(colonIdx + 1);
        if (key === 'postcode' && value) searchParams.postcode = value;
        if (key === 'distanceMeters' && value) searchParams.distanceMeters = value;
    });

    if (Object.keys(searchParams).length === 0) return null;

    searchParams.searchInTitleAndDescription = 'true';

    const suggestedLabel = query || decodeURIComponent(
        (window.location.pathname.match(/\/[ql]\/([^/]+)/) || [, ''])[1] || ''
    ).replace(/[-+]/g, ' ').trim() || 'Marktplaats zoekopdracht';

    return {
        suggestedLabel: suggestedLabel.slice(0, 120),
        searchParams,
        searchUrl: href.slice(0, 500)
    };
}

function buildAlertFiltersPayload() {
    const s = CLEANPLAATS.settings;
    return {
        blacklistedSellers: s.blacklistedSellers || [],
        blacklistedTerms: s.blacklistedTerms || [],
        blacklistedDescriptionTerms: s.blacklistedDescriptionTerms || [],
        blockedListings: s.blockedListings || [],
        removeDagtoppers: Boolean(s.removeDagtoppers),
        removeReservedListings: Boolean(s.removeReservedListings),
        removeOpvalStickers: Boolean(s.removeOpvalStickers)
    };
}

function syncAlertFilters() {
    return alertsApiFetch('/api/filters', {
        method: 'PUT',
        body: JSON.stringify({ filters: buildAlertFiltersPayload() })
    }).catch(error => {
        console.error('Cleanplaats: Failed to sync filters to alerts server', error);
    });
}

/* ===== Overlay shell ===== */

function getAlertsOverlay() {
    let overlay = document.getElementById('cleanplaats-alerts-modal');
    if (overlay && !overlay.classList.contains('cleanplaats-alerts-overlay')) {
        // Stale node from an older panel render; replace it.
        overlay.remove();
        overlay = null;
    }
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cleanplaats-alerts-modal';
        overlay.className = 'cleanplaats-alerts-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) hideAlertsModal();
        });
    }
    return overlay;
}

function hideAlertsModal() {
    const overlay = document.getElementById('cleanplaats-alerts-modal');
    if (overlay) overlay.style.display = 'none';
}

function showAlertsModal() {
    const overlay = getAlertsOverlay();

    ['cleanplaats-blacklist-modal', 'cleanplaats-terms-modal', 'cleanplaats-blocked-listings-modal'].forEach(id => {
        const otherModal = document.getElementById(id);
        if (otherModal) otherModal.style.display = 'none';
    });

    if (overlay.style.display === 'flex') {
        hideAlertsModal();
        return;
    }

    renderAlertsShell(overlay);
    overlay.style.display = 'flex';

    initAlertsRuntime().then(() => {
        if (!cleanplaatsAlertsRuntime.token) {
            renderAlertsLoginView();
            return;
        }
        loadAlertsDashboard();
    });
}

function renderAlertsShell(overlay) {
    overlay.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-alerts-card" role="dialog" aria-label="${ALERTS_TEXT.modalTitle}">
            <div class="cleanplaats-alerts-header">
                <div class="cleanplaats-alerts-header-title">
                    <span class="cleanplaats-alerts-bell">${alertIcon('bell', 20)}</span>
                    <div>
                        <h3>${ALERTS_TEXT.modalTitle}</h3>
                        <span class="cleanplaats-alerts-tagline">${ALERTS_TEXT.tagline}</span>
                    </div>
                </div>
                <button class="cleanplaats-alerts-close" id="cleanplaats-alerts-close" aria-label="${ALERTS_TEXT.closeButton}">${alertIcon('close', 16)}</button>
            </div>
            <div class="cleanplaats-alerts-body" id="cleanplaats-alerts-body">
                <div class="cleanplaats-alerts-loading">${ALERTS_TEXT.loading}</div>
            </div>
        </div>
    `);
    document.getElementById('cleanplaats-alerts-close').onclick = hideAlertsModal;
}

function setAlertsBody(html) {
    const body = document.getElementById('cleanplaats-alerts-body');
    if (!body) return null;
    body.innerHTML = DOMPurify.sanitize(html);
    return body;
}

function showAlertsInlineError(message) {
    const errorEl = document.getElementById('cleanplaats-alerts-form-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

/* ===== Login views ===== */

function renderAlertsLoginView() {
    const body = setAlertsBody(`
        <div class="cleanplaats-alerts-login">
            <div class="cleanplaats-alerts-login-icon">${alertIcon('mail', 24)}</div>
            <h4>${ALERTS_TEXT.loginTitle}</h4>
            <p>${ALERTS_TEXT.loginIntro}</p>
            <div class="cleanplaats-alerts-form-row">
                <input type="email" id="cleanplaats-alerts-email-input" placeholder="${ALERTS_TEXT.emailPlaceholder}" autocomplete="email">
                <button id="cleanplaats-alerts-email-submit" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.emailButton}</button>
            </div>
            <div class="cleanplaats-alerts-form-error" id="cleanplaats-alerts-form-error" style="display:none;"></div>
        </div>
    `);
    if (!body) return;

    const input = document.getElementById('cleanplaats-alerts-email-input');
    const submit = document.getElementById('cleanplaats-alerts-email-submit');
    if (cleanplaatsAlertsRuntime.pendingEmail) input.value = cleanplaatsAlertsRuntime.pendingEmail;

    const send = () => {
        const email = input.value.trim();
        if (!email || !email.includes('@')) {
            showAlertsInlineError('Vul een geldig e-mailadres in.');
            return;
        }
        submit.disabled = true;
        submit.textContent = ALERTS_TEXT.emailSending;
        alertsApiFetch('/api/auth/request-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        }).then(() => {
            cleanplaatsAlertsRuntime.pendingEmail = email;
            renderAlertsCodeView();
        }).catch(error => {
            submit.disabled = false;
            submit.textContent = ALERTS_TEXT.emailButton;
            showAlertsInlineError(error.message || ALERTS_TEXT.errorToast);
        });
    };

    submit.onclick = send;
    input.onkeydown = event => { if (event.key === 'Enter') send(); };
    input.focus();
}

function renderAlertsCodeView() {
    const email = cleanplaatsAlertsRuntime.pendingEmail;
    const body = setAlertsBody(`
        <div class="cleanplaats-alerts-login">
            <div class="cleanplaats-alerts-login-icon">${alertIcon('key', 24)}</div>
            <h4>${ALERTS_TEXT.loginTitle}</h4>
            <p>${escapeAlertText(ALERTS_TEXT.codeSentTo(email))}</p>
            <div class="cleanplaats-alerts-form-row">
                <input type="text" id="cleanplaats-alerts-code-input" class="cleanplaats-alerts-code-input" inputmode="numeric" maxlength="6" placeholder="${ALERTS_TEXT.codePlaceholder}" autocomplete="one-time-code">
                <button id="cleanplaats-alerts-code-submit" class="cleanplaats-alerts-primary-btn">${ALERTS_TEXT.codeButton}</button>
            </div>
            <div class="cleanplaats-alerts-form-error" id="cleanplaats-alerts-form-error" style="display:none;"></div>
            <div class="cleanplaats-alerts-login-links">
                <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-resend">${ALERTS_TEXT.codeResend}</button>
                <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-other-email">${ALERTS_TEXT.codeOtherEmail}</button>
            </div>
        </div>
    `);
    if (!body) return;

    const input = document.getElementById('cleanplaats-alerts-code-input');
    const submit = document.getElementById('cleanplaats-alerts-code-submit');

    const verify = () => {
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) {
            showAlertsInlineError('Vul de 6-cijferige code in.');
            return;
        }
        submit.disabled = true;
        submit.textContent = ALERTS_TEXT.codeChecking;
        alertsApiFetch('/api/auth/verify', {
            method: 'POST',
            body: JSON.stringify({ email, code })
        }).then(data => {
            return storeAlertsToken(data.token).then(() => {
                syncAlertFilters();
                loadAlertsDashboard();
            });
        }).catch(error => {
            submit.disabled = false;
            submit.textContent = ALERTS_TEXT.codeButton;
            showAlertsInlineError(error.message || ALERTS_TEXT.errorToast);
        });
    };

    submit.onclick = verify;
    input.onkeydown = event => { if (event.key === 'Enter') verify(); };
    input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); };
    input.focus();

    document.getElementById('cleanplaats-alerts-other-email').onclick = () => renderAlertsLoginView();
    document.getElementById('cleanplaats-alerts-resend').onclick = event => {
        event.target.disabled = true;
        alertsApiFetch('/api/auth/request-code', {
            method: 'POST',
            body: JSON.stringify({ email })
        }).catch(error => showAlertsInlineError(error.message || ALERTS_TEXT.errorToast));
    };
}

/* ===== Dashboard ===== */

function loadAlertsDashboard() {
    const body = setAlertsBody(`<div class="cleanplaats-alerts-loading">${ALERTS_TEXT.loading}</div>`);
    if (!body) return;

    syncAlertFilters();

    Promise.all([
        alertsApiFetch('/api/me'),
        alertsApiFetch('/api/alerts'),
        alertsApiFetch('/api/matches')
    ]).then(([me, alertsData, matchesData]) => {
        cleanplaatsAlertsRuntime.me = me;
        renderAlertsDashboard(me, alertsData.alerts || [], matchesData.matches || []);
    }).catch(error => {
        if (error.status === 401) {
            storeAlertsToken('').then(() => renderAlertsLoginView());
            return;
        }
        console.error('Cleanplaats: Failed to load alerts', error);
        setAlertsBody(`<div class="cleanplaats-alerts-loading">${ALERTS_TEXT.errorToast}</div>`);
    });
}

function renderAlertsDashboard(me, alerts, matches) {
    const context = getAlertSearchContext();
    const atLimit = (me.alertCount || alerts.length) >= me.maxAlerts;
    const totalMatches = alerts.reduce((sum, alert) => sum + (alert.match_count || 0), 0);
    const tierLabel = me.tier === 'premium' ? ALERTS_TEXT.tierPremium : ALERTS_TEXT.tierFree;

    const accountBar = `
        <div class="cleanplaats-alerts-account">
            <div class="cleanplaats-alerts-account-id">
                <span class="cleanplaats-alerts-account-email" title="${escapeAlertText(me.email)}">${escapeAlertText(me.email)}</span>
                <span class="cleanplaats-alerts-tier cleanplaats-alerts-tier-${me.tier === 'premium' ? 'premium' : 'free'}">${tierLabel}</span>
            </div>
            <div class="cleanplaats-alerts-stats">
                <div class="cleanplaats-alerts-stat">
                    <span class="cleanplaats-alerts-stat-value">${me.alertCount || 0}<span class="cleanplaats-alerts-stat-max">/${me.maxAlerts}</span></span>
                    <span class="cleanplaats-alerts-stat-label">${ALERTS_TEXT.statAlerts}</span>
                </div>
                <div class="cleanplaats-alerts-stat">
                    <span class="cleanplaats-alerts-stat-value">${me.intervalMinutes}<span class="cleanplaats-alerts-stat-max">min</span></span>
                    <span class="cleanplaats-alerts-stat-label">${ALERTS_TEXT.statInterval}</span>
                </div>
                <div class="cleanplaats-alerts-stat">
                    <span class="cleanplaats-alerts-stat-value">${totalMatches}</span>
                    <span class="cleanplaats-alerts-stat-label">${ALERTS_TEXT.statFound}</span>
                </div>
            </div>
        </div>
    `;

    let createSection;
    if (atLimit) {
        createSection = `<div class="cleanplaats-alerts-hint">${ALERTS_TEXT.atLimit}</div>`;
    } else {
        // Always offer the create box; a search results page only prefills it
        // (and contributes its filters as long as the term isn't changed).
        createSection = `
            <div class="cleanplaats-alerts-create">
                <div class="cleanplaats-alerts-create-title">${ALERTS_TEXT.createTitle}</div>
                <div class="cleanplaats-alerts-form-row">
                    <input type="text" id="cleanplaats-alert-label-input" value="${context ? escapeAlertText(context.suggestedLabel) : ''}" placeholder="${ALERTS_TEXT.labelPlaceholder}" maxlength="120">
                    <button id="cleanplaats-alert-create" class="cleanplaats-alerts-primary-btn">＋ ${ALERTS_TEXT.createButton}</button>
                </div>
                ${context ? `<div class="cleanplaats-alerts-create-note" id="cleanplaats-alert-create-note">${ALERTS_TEXT.createContextHint}</div>` : ''}
            </div>
        `;
    }

    const alertItems = alerts.length === 0
        ? `<div class="cleanplaats-alerts-empty">${ALERTS_TEXT.empty}</div>`
        : alerts.map(alert => {
            const validity = getAlertValidity(alert);
            const statusClass = validity && validity.expired
                ? 'expired'
                : (alert.enabled ? 'active' : 'paused');
            const lastChecked = alert.last_checked_at
                ? `${ALERTS_TEXT.lastChecked}: ${formatAlertRelativeTime(alert.last_checked_at)}`
                : ALERTS_TEXT.neverChecked;
            const labelHtml = alert.search_url
                ? `<a href="${escapeAlertText(alert.search_url)}" class="cleanplaats-alerts-card-label">${escapeAlertText(alert.label)}</a>`
                : `<span class="cleanplaats-alerts-card-label">${escapeAlertText(alert.label)}</span>`;

            let validityHtml = '';
            if (validity) {
                if (validity.expired) {
                    validityHtml = ` · <span class="cleanplaats-alerts-validity cleanplaats-alerts-validity-expired">${ALERTS_TEXT.validityExpired}</span>`;
                } else {
                    const soonClass = validity.soon ? ' cleanplaats-alerts-validity-soon' : '';
                    validityHtml = ` · <span class="cleanplaats-alerts-validity${soonClass}">${ALERTS_TEXT.validityLeft(validity.daysLeft)}</span>`;
                }
            }

            // Expired alerts can only come back via Reactiveren (which resets the
            // window); re-enabling with the plain switch would just re-lapse next
            // poll, so the status switch is replaced. Active alerts get a subtle
            // Verleng nudge only in their final days.
            const extendBtn = validity && validity.expired
                ? `<button class="cleanplaats-alerts-extend-btn cleanplaats-alerts-extend-btn-primary" data-alert-id="${alert.id}" data-extend="1">${ALERTS_TEXT.reactivateButton}</button>`
                : (validity && validity.soon
                    ? `<button class="cleanplaats-alerts-extend-btn" data-alert-id="${alert.id}" data-extend="1">${ALERTS_TEXT.extendButton}</button>`
                    : '');
            const statusSwitch = validity && validity.expired
                ? ''
                : `<button class="cleanplaats-alerts-switch cleanplaats-alerts-switch-status ${alert.enabled ? 'on' : ''}" data-alert-id="${alert.id}" data-enabled="${alert.enabled ? '1' : '0'}" role="switch" aria-checked="${alert.enabled ? 'true' : 'false'}">
                                <span class="cleanplaats-alerts-switch-label">${alert.enabled ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel}</span><span class="cleanplaats-alerts-switch-track"></span>
                            </button>`;

            return `
                <div class="cleanplaats-alerts-alert cleanplaats-alerts-alert-${statusClass}" data-alert-id="${alert.id}">
                    <div class="cleanplaats-alerts-alert-top">
                        <span class="cleanplaats-alerts-status-dot"></span>
                        ${labelHtml}
                        <span class="cleanplaats-alerts-match-badge">${ALERTS_TEXT.matchCount(alert.match_count || 0)}</span>
                    </div>
                    <div class="cleanplaats-alerts-alert-bottom">
                        <span class="cleanplaats-alerts-meta">${lastChecked}${validityHtml}</span>
                        <span class="cleanplaats-alerts-alert-actions">
                            <button class="cleanplaats-alerts-switch ${alert.notify_email ? 'on' : ''}" data-channel="email" data-alert-id="${alert.id}" data-value="${alert.notify_email ? '1' : '0'}" role="switch" aria-checked="${alert.notify_email ? 'true' : 'false'}">
                                ${alertIcon('mail', 14)}<span class="cleanplaats-alerts-switch-label">${ALERTS_TEXT.channelEmail}</span><span class="cleanplaats-alerts-switch-track"></span>
                            </button>
                            <button class="cleanplaats-alerts-switch ${alert.notify_telegram ? 'on' : ''}" data-channel="telegram" data-alert-id="${alert.id}" data-value="${alert.notify_telegram ? '1' : '0'}" role="switch" aria-checked="${alert.notify_telegram ? 'true' : 'false'}">
                                ${alertIcon('send', 14)}<span class="cleanplaats-alerts-switch-label">${ALERTS_TEXT.channelTelegram}</span><span class="cleanplaats-alerts-switch-track"></span>
                            </button>
                            ${statusSwitch}
                            ${extendBtn}
                            <button class="cleanplaats-alerts-delete" data-alert-id="${alert.id}" title="${ALERTS_TEXT.deleteButton}" aria-label="${ALERTS_TEXT.deleteButton}">${alertIcon('trash', 15)}</button>
                        </span>
                    </div>
                    ${buildAlertFilterBlockHtml(alert)}
                </div>
            `;
        }).join('');

    cleanplaatsAlertsRuntime.cachedMatches = matches;
    const matchItems = renderAlertMatchItems(sortAlertMatches(matches, 'newest'));

    const telegramActions = me.telegramLinked
        ? `<button class="cleanplaats-alerts-text-btn" id="cleanplaats-alert-telegram-relink">${ALERTS_TEXT.telegramRelink}</button>
           <button class="cleanplaats-alerts-text-btn cleanplaats-alerts-text-btn-danger" id="cleanplaats-alert-telegram-unlink">${ALERTS_TEXT.telegramUnlink}</button>`
        : `<button id="cleanplaats-alert-telegram-link" class="cleanplaats-alerts-secondary-btn">${ALERTS_TEXT.telegramConnect}</button>`;

    const channelsSection = `
        <div class="cleanplaats-alerts-section-title">${ALERTS_TEXT.channelsTitle}</div>
        <div class="cleanplaats-alerts-channel-list">
            <div class="cleanplaats-alerts-channel-row">
                <span class="cleanplaats-alerts-channel-icon on">${alertIcon('mail', 18)}</span>
                <span class="cleanplaats-alerts-channel-info">
                    <span class="cleanplaats-alerts-channel-name">${ALERTS_TEXT.channelEmail}</span>
                    <span class="cleanplaats-alerts-channel-sub">${escapeAlertText(me.email)}</span>
                </span>
                <span class="cleanplaats-alerts-channel-actions">
                    <span class="cleanplaats-alerts-channel-state">${ALERTS_TEXT.emailAlwaysOn}</span>
                </span>
            </div>
            <div class="cleanplaats-alerts-channel-row">
                <span class="cleanplaats-alerts-channel-icon ${me.telegramLinked ? 'on' : ''}">${alertIcon('send', 18)}</span>
                <span class="cleanplaats-alerts-channel-info">
                    <span class="cleanplaats-alerts-channel-name">${ALERTS_TEXT.channelTelegram}</span>
                    <span class="cleanplaats-alerts-channel-sub ${me.telegramLinked ? 'cleanplaats-alerts-channel-sub-on' : ''}">${me.telegramLinked ? ALERTS_TEXT.telegramLinked : ALERTS_TEXT.telegramNotLinked}</span>
                </span>
                <span class="cleanplaats-alerts-channel-actions">${telegramActions}</span>
            </div>
        </div>
        <div class="cleanplaats-alerts-telegram-hint" id="cleanplaats-alert-telegram-hint" style="display:none;"></div>
    `;

    setAlertsBody(`
        ${accountBar}
        ${createSection}
        <div class="cleanplaats-alerts-section-title">${ALERTS_TEXT.listTitle}</div>
        <div class="cleanplaats-alerts-list">${alertItems}</div>
        <div class="cleanplaats-alerts-section-header">
            <span class="cleanplaats-alerts-section-title">${ALERTS_TEXT.matchesTitle}</span>
            <select id="cleanplaats-alerts-sort" class="cleanplaats-alerts-sort-select">
                <option value="newest">${ALERTS_TEXT.sortNewest}</option>
                <option value="price_asc">${ALERTS_TEXT.sortPriceAsc}</option>
                <option value="price_desc">${ALERTS_TEXT.sortPriceDesc}</option>
            </select>
        </div>
        <div class="cleanplaats-alerts-matches" id="cleanplaats-alerts-matches-list">${matchItems}</div>
        ${channelsSection}
        <div class="cleanplaats-alerts-footer">
            <button class="cleanplaats-alerts-text-btn" id="cleanplaats-alerts-logout">${ALERTS_TEXT.logout} (${escapeAlertText(me.email)})</button>
        </div>
    `);

    wireAlertsDashboardEvents();
}

function wireAlertsDashboardEvents() {
    const body = document.getElementById('cleanplaats-alerts-body');
    if (!body) return;

    const createButton = document.getElementById('cleanplaats-alert-create');
    if (createButton) {
        const labelInput = document.getElementById('cleanplaats-alert-label-input');
        const createNote = document.getElementById('cleanplaats-alert-create-note');
        const suggestedTerm = (labelInput?.value || '').trim().toLowerCase();
        if (labelInput && createNote) {
            labelInput.addEventListener('input', () => {
                createNote.style.display =
                    labelInput.value.trim().toLowerCase() === suggestedTerm ? '' : 'none';
            });
        }

        createButton.onclick = () => {
            const term = (labelInput?.value || '').trim();
            if (!term) {
                showBubbleNotification(ALERTS_TEXT.createTermMissing);
                if (labelInput) labelInput.focus();
                return;
            }

            // Reuse the page's search context (category/location filters)
            // only while the term still matches it; an edited term is a new,
            // plain search.
            const context = getAlertSearchContext();
            const usesContext = Boolean(context) &&
                term.toLowerCase() === context.suggestedLabel.trim().toLowerCase();
            const searchParams = usesContext
                ? context.searchParams
                : { query: term, searchInTitleAndDescription: 'true' };
            const searchUrl = usesContext
                ? context.searchUrl
                : `https://www.marktplaats.nl/q/${encodeURIComponent(term).replace(/%20/g, '+')}/`;

            createButton.disabled = true;
            alertsApiFetch('/api/alerts', {
                method: 'POST',
                body: JSON.stringify({ label: term, searchParams, searchUrl, filters: getDefaultAlertFilters() })
            }).then(() => {
                showBubbleNotification(ALERTS_TEXT.createdToast);
                loadAlertsDashboard();
            }).catch(error => {
                createButton.disabled = false;
                showBubbleNotification(error.status === 403 ? ALERTS_TEXT.limitToast : (error.message || ALERTS_TEXT.errorToast));
            });
        };
    }

    body.querySelectorAll('.cleanplaats-alerts-delete').forEach(button => {
        button.onclick = () => {
            if (!window.confirm(ALERTS_TEXT.deleteConfirm)) return;
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, { method: 'DELETE' })
                .then(() => {
                    showBubbleNotification(ALERTS_TEXT.deletedToast);
                    loadAlertsDashboard();
                })
                .catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });

    body.querySelectorAll('.cleanplaats-alerts-switch-status').forEach(button => {
        button.onclick = () => {
            const nextEnabled = button.dataset.enabled !== '1';
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: nextEnabled })
            }).then(() => {
                button.dataset.enabled = nextEnabled ? '1' : '0';
                button.setAttribute('aria-checked', String(nextEnabled));
                button.classList.toggle('on', nextEnabled);
                const label = button.querySelector('.cleanplaats-alerts-switch-label');
                if (label) label.textContent = nextEnabled ? ALERTS_TEXT.activeLabel : ALERTS_TEXT.pausedLabel;
                const card = button.closest('.cleanplaats-alerts-alert');
                if (card) {
                    card.classList.toggle('cleanplaats-alerts-alert-active', nextEnabled);
                    card.classList.toggle('cleanplaats-alerts-alert-paused', !nextEnabled);
                }
            }).catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });

    body.querySelectorAll('.cleanplaats-alerts-extend-btn').forEach(button => {
        button.onclick = () => {
            const wasExpired = button.classList.contains('cleanplaats-alerts-extend-btn-primary');
            button.disabled = true;
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ extend: true })
            }).then(() => {
                showBubbleNotification(wasExpired ? ALERTS_TEXT.reactivatedToast : ALERTS_TEXT.extendedToast);
                loadAlertsDashboard();
            }).catch(() => {
                button.disabled = false;
                showBubbleNotification(ALERTS_TEXT.errorToast);
            });
        };
    });

    body.querySelectorAll('.cleanplaats-alerts-switch[data-channel]').forEach(button => {
        button.onclick = () => {
            const next = button.dataset.value !== '1';
            const field = button.dataset.channel === 'email' ? 'notifyEmail' : 'notifyTelegram';
            alertsApiFetch(`/api/alerts/${button.dataset.alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ [field]: next })
            }).then(() => {
                button.dataset.value = next ? '1' : '0';
                button.setAttribute('aria-checked', String(next));
                button.classList.toggle('on', next);
            }).catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    });

    const startTelegramLink = () => {
        alertsApiFetch('/api/telegram/link', { method: 'POST' })
            .then(data => {
                if (!data.url) return;
                window.open(data.url, '_blank', 'noopener,noreferrer');

                // The t.me button needs the Telegram app; offer a manual
                // fallback so phone-only users can link too.
                const hint = document.getElementById('cleanplaats-alert-telegram-hint');
                if (hint && data.bot && data.code) {
                    hint.textContent = ALERTS_TEXT.telegramManualHint(data.bot, data.code);
                    hint.style.display = 'block';
                }
            })
            .catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
    };

    // "Koppelen" and "Ander account koppelen" are the same flow: a fresh link
    // code, and the webhook overwrites telegram_chat_id with whichever chat
    // sends it.
    ['cleanplaats-alert-telegram-link', 'cleanplaats-alert-telegram-relink'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.onclick = startTelegramLink;
    });

    const telegramUnlinkButton = document.getElementById('cleanplaats-alert-telegram-unlink');
    if (telegramUnlinkButton) {
        telegramUnlinkButton.onclick = () => {
            if (!window.confirm(ALERTS_TEXT.telegramUnlinkConfirm)) return;
            alertsApiFetch('/api/telegram/unlink', { method: 'POST' })
                .then(() => {
                    showBubbleNotification(ALERTS_TEXT.telegramUnlinkedToast);
                    loadAlertsDashboard();
                })
                .catch(() => showBubbleNotification(ALERTS_TEXT.errorToast));
        };
    }

    const logoutButton = document.getElementById('cleanplaats-alerts-logout');
    if (logoutButton) {
        logoutButton.onclick = () => {
            alertsApiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
            storeAlertsToken('').then(() => renderAlertsLoginView());
        };
    }

    wireAlertMatchLinks(body);

    const sortSelect = document.getElementById('cleanplaats-alerts-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            const matchesList = document.getElementById('cleanplaats-alerts-matches-list');
            if (!matchesList || !cleanplaatsAlertsRuntime.cachedMatches) return;
            const sorted = sortAlertMatches(cleanplaatsAlertsRuntime.cachedMatches, sortSelect.value);
            matchesList.innerHTML = DOMPurify.sanitize(renderAlertMatchItems(sorted));
            wireAlertMatchLinks(matchesList);
        });
    }

    wireAlertFilterControls(body);
}

function wireAlertFilterControls(body) {
    // Expand/collapse a card's filter editor.
    body.querySelectorAll('.cleanplaats-alerts-filter-trigger').forEach(trigger => {
        trigger.addEventListener('click', () => {
            const block = trigger.closest('.cleanplaats-alerts-filter-block');
            const editor = block?.querySelector('.cleanplaats-alerts-filter-editor');
            if (!editor) return;
            const isOpen = !editor.hasAttribute('hidden');
            if (isOpen) {
                editor.setAttribute('hidden', '');
            } else {
                editor.removeAttribute('hidden');
            }
            trigger.setAttribute('aria-expanded', String(!isOpen));
            block.classList.toggle('cleanplaats-alerts-filter-block-open', !isOpen);
        });
    });

    // Toggling a per-alert filter checkbox: persist just that alert's filters.
    body.querySelectorAll('.cleanplaats-alerts-filter-opt input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const alertId = checkbox.dataset.alertId;
            const block = checkbox.closest('.cleanplaats-alerts-filter-block');
            if (!block) return;

            const filters = {};
            block.querySelectorAll('.cleanplaats-alerts-filter-opt input[type="checkbox"]').forEach(cb => {
                filters[cb.dataset.filterKey] = cb.checked;
            });

            // Update the collapsed summary count immediately.
            const activeCount = Object.values(filters).filter(Boolean).length;
            const countEl = block.querySelector('.cleanplaats-alerts-filter-count');
            if (countEl) {
                if (activeCount > 0) {
                    countEl.textContent = ALERTS_TEXT.filterCountActive(activeCount);
                    countEl.classList.remove('cleanplaats-alerts-filter-count-zero');
                } else {
                    countEl.textContent = ALERTS_TEXT.filterNoneActive;
                    countEl.classList.add('cleanplaats-alerts-filter-count-zero');
                }
            }

            checkbox.disabled = true;
            alertsApiFetch(`/api/alerts/${alertId}`, {
                method: 'PATCH',
                body: JSON.stringify({ filters })
            }).then(() => {
                checkbox.disabled = false;
            }).catch(() => {
                checkbox.disabled = false;
                checkbox.checked = !checkbox.checked;
                showBubbleNotification(ALERTS_TEXT.errorToast);
            });
        });
    });
}

function wireAlertMatchLinks(container) {
    (container || document).querySelectorAll('.cleanplaats-alerts-match, .cleanplaats-alerts-card-label[href]').forEach(link => {
        if (!link.getAttribute('href')) return;
        link.addEventListener('click', event => {
            event.preventDefault();
            window.open(link.href, '_blank', 'noopener,noreferrer');
        });
    });
}
