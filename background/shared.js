/**
 * Cleanplaats background shared state and constants.
 */

console.log('Cleanplaats background.js: Script execution started/restarted.', new Date().toISOString());

var browserAPI = typeof browser !== 'undefined' ? browser : chrome;

var resultsPerPage = '30';
var defaultSortMode = 'standard';
var sortPreferenceSource = 'cleanplaats';
var lastMarktplaatsActivity = Date.now();

var SORT_MODES = {
    standard: { sortBy: 'OPTIMIZED', sortOrder: 'DECREASING' },
    date_new_old: { sortBy: 'SORT_INDEX', sortOrder: 'DECREASING' },
    date_old_new: { sortBy: 'SORT_INDEX', sortOrder: 'INCREASING' },
    price_low_high: { sortBy: 'PRICE', sortOrder: 'INCREASING' },
    price_high_low: { sortBy: 'PRICE', sortOrder: 'DECREASING' },
    distance: { sortBy: 'LOCATION', sortOrder: 'INCREASING' }
};

var API_RULE_ID = 1;
var HASH_URL_PATTERNS = [
    'https://www.marktplaats.nl/l/',
    'https://www.marktplaats.nl/q/',
    'https://www.2dehands.be/l/',
    'https://www.2dehands.be/q/',
    'https://www.2ememain.be/l/',
    'https://www.2ememain.be/q/'
];
var API_URL_PATTERNS = [
    'https://www.marktplaats.nl/lrp/api/search*',
    'https://www.2dehands.be/lrp/api/search*',
    'https://www.2ememain.be/lrp/api/search*'
];
var THEME_INIT_SCRIPT_ID = 'cleanplaats-theme-init';
var THEME_MATCH_PATTERNS = [
    '*://*.marktplaats.nl/*',
    '*://*.2dehands.be/*',
    '*://*.2ememain.be/*'
];
var WAKEUP_NAVIGATION_FILTERS = [
    { hostSuffix: 'marktplaats.nl' },
    { hostSuffix: '2dehands.be' },
    { hostSuffix: '2ememain.be' }
];
