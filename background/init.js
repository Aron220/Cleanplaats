/**
 * Cleanplaats background entry point.
 * Loaded last, both by the Chrome service worker (via importScripts in
 * background.js) and by the Firefox event page (via manifest background.scripts).
 */

initialize();
setupKeepAlive();

console.log('Cleanplaats background: Script execution finished initial top-level setup.', new Date().toISOString());
