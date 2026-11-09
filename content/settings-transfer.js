/**
 * Settings to a file and back, for moving Cleanplaats to another computer.
 *
 * Only what the user chose travels: filters, preferences and the lists of
 * blocked sellers, terms, ads and categories. Counters, nudges, the panel's
 * own state and the Zoekopdrachten account stay behind, they belong to this
 * browser.
 *
 * Importing adds to what is already here rather than replacing it. Somebody
 * who blocked a few sellers on the new laptop before importing would not
 * expect to lose them.
 */

var CLEANPLAATS_EXPORT_FORMAT = 'cleanplaats-settings';

var CLEANPLAATS_EXPORT_SCALAR_KEYS = [
    'removeTopAds',
    'removeDagtoppers',
    'removePromotedListings',
    'removeOpvalStickers',
    'removeReservedListings',
    'removeListingsWithBids',
    'removeFavoriteRelatedAds',
    'showViewedListingsIndicator',
    'sellerAgeWarningEnabled',
    'sellerAgeWarningThresholdValue',
    'sellerAgeWarningThresholdUnit',
    'sellerVerificationPanelEnabled',
    'darkMode',
    'resultsPerPage',
    'defaultSortMode',
    'expandPanelOnPageLoad',
    'showUpdatePopups'
];

var CLEANPLAATS_EXPORT_LIST_KEYS = [
    'blacklistedSellers',
    'blacklistedTerms',
    'blacklistedDescriptionTerms',
    'blockedListings',
    'blockedCategories'
];

var CLEANPLAATS_IMPORT_ALLOWED_VALUES = {
    resultsPerPage: value => [30, 50, 100].includes(value),
    defaultSortMode: value => ['standard', 'date_new_old', 'date_old_new', 'price_low_high', 'price_high_low', 'distance'].includes(value),
    sellerAgeWarningThresholdUnit: value => ['days', 'weeks', 'months', 'years'].includes(value),
    sellerAgeWarningThresholdValue: value => Number.isInteger(value) && value >= 1 && value <= 99
};

function buildSettingsExport() {
    const settings = {};
    CLEANPLAATS_EXPORT_SCALAR_KEYS.forEach(key => {
        settings[key] = CLEANPLAATS.settings[key];
    });
    CLEANPLAATS_EXPORT_LIST_KEYS.forEach(key => {
        settings[key] = Array.isArray(CLEANPLAATS.settings[key]) ? CLEANPLAATS.settings[key] : [];
    });

    return {
        format: CLEANPLAATS_EXPORT_FORMAT,
        version: 1,
        extensionVersion: browserAPI.runtime.getManifest?.().version || '',
        exportedAt: new Date().toISOString(),
        settings
    };
}

function exportSettingsToFile() {
    const json = JSON.stringify(buildSettingsExport(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);

    const link = document.createElement('a');
    link.href = url;
    link.download = `cleanplaats-instellingen-${date}.json`;
    link.style.display = 'none';
    // Firefox only follows a click on a link that is in the document.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    showBubbleNotification(getPanelLocaleText().settingsExportedToast);
}

// Adds the entries of `incoming` that are not in `current` yet, by key, after
// normalizing both. Entries that do not normalize are dropped: a file is
// outside input, and a malformed entry would otherwise sit in the list forever.
function mergeSettingsList(current, incoming, normalize, keyOf) {
    const result = [];
    const seen = new Set();
    let added = 0;

    [...(current || []), ...(incoming || [])].forEach((entry, index) => {
        const normalized = normalize(entry);
        if (!normalized) return;
        const key = keyOf(normalized);
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(normalized);
        if (index >= (current || []).length) added++;
    });

    return { list: result, added };
}

function normalizeImportedTerm(term) {
    if (typeof term !== 'string') return null;
    const trimmed = term.trim();
    return trimmed ? trimmed.slice(0, 200) : null;
}

function normalizeImportedBlockedListing(entry) {
    if (!entry || typeof entry !== 'object') return null;
    // Kept as it is: an id is either an item id or a card fingerprint, and
    // both are matched literally.
    const id = String(entry.id || '').trim();
    if (!id) return null;
    return { id, title: String(entry.title || id).slice(0, 80) };
}

// Returns the merged settings and how many list entries were new, or null when
// the file is not a Cleanplaats export.
function mergeImportedSettings(data) {
    const incoming = data && data.format === CLEANPLAATS_EXPORT_FORMAT && data.settings;
    if (!incoming || typeof incoming !== 'object') return null;

    const current = CLEANPLAATS.settings;
    const next = { ...current };

    CLEANPLAATS_EXPORT_SCALAR_KEYS.forEach(key => {
        // Same type as what is here, or it is not taken: the panel and the
        // filters assume these shapes. The few settings with a fixed set of
        // values also have to be one of them, since a file can be edited by
        // hand and resultsPerPage goes straight into the site's own request.
        if (!(key in incoming) || typeof incoming[key] !== typeof current[key]) return;
        const allowed = CLEANPLAATS_IMPORT_ALLOWED_VALUES[key];
        if (allowed && !allowed(incoming[key])) return;
        next[key] = incoming[key];
    });

    const counts = {};
    const merge = (key, normalize, keyOf) => {
        const result = mergeSettingsList(current[key], Array.isArray(incoming[key]) ? incoming[key] : [], normalize, keyOf);
        next[key] = result.list;
        counts[key] = result.added;
    };

    merge('blacklistedSellers', normalizeBlacklistedSellerEntry, getBlacklistedSellerKey);
    merge('blacklistedTerms', normalizeImportedTerm, term => term);
    merge('blacklistedDescriptionTerms', normalizeImportedTerm, term => term);
    merge('blockedListings', normalizeImportedBlockedListing, entry => entry.id);
    merge('blockedCategories', normalizeBlockedCategoryEntry, entry => `${entry.site}:${entry.id}`);

    return { settings: next, counts };
}

function importSettingsFromFile(file) {
    const panelText = getPanelLocaleText();
    if (!file) return;

    // An export is a few hundred KB at the very most.
    if (file.size > 5 * 1024 * 1024) {
        showBubbleNotification(panelText.settingsImportFailedToast);
        return;
    }

    file.text().then(text => {
        let merged = null;
        try {
            merged = mergeImportedSettings(JSON.parse(text));
        } catch (error) {
            merged = null;
        }

        if (!merged) {
            showBubbleNotification(panelText.settingsImportFailedToast);
            return;
        }

        // Takes the same route as a save from another tab: it applies dark
        // mode, the panel switches, the modals and a fresh cleanup pass.
        applySettingsFromOtherTab(JSON.stringify(merged.settings));
        return saveSettings().then(() => {
            const added = Object.values(merged.counts).reduce((sum, value) => sum + value, 0);
            showBubbleNotification(panelText.settingsImportedToast(added));
        });
    }).catch(error => {
        console.error('Cleanplaats: Failed to import settings', error);
        showBubbleNotification(panelText.settingsImportFailedToast);
    });
}

function wireSettingsTransferEvents() {
    const exportButton = document.getElementById('cleanplaats-export-settings');
    const importButton = document.getElementById('cleanplaats-import-settings');
    const fileInput = document.getElementById('cleanplaats-import-settings-file');
    if (!exportButton || !importButton || !fileInput) return;

    exportButton.addEventListener('click', event => {
        event.preventDefault();
        exportSettingsToFile();
    });

    importButton.addEventListener('click', event => {
        event.preventDefault();
        fileInput.value = '';
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        importSettingsFromFile(fileInput.files && fileInput.files[0]);
    });
}
