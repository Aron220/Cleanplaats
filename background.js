/**
 * Cleanplaats background bootstrap (Chrome service worker only).
 *
 * Chrome runs MV3 backgrounds as a service worker and loads this single file,
 * which pulls in the modules via importScripts. Firefox runs MV3 backgrounds
 * as an event page (a document) where importScripts does not exist, so the
 * manifest lists the same modules directly under background.scripts instead.
 * Keep both lists in sync when adding/removing background modules.
 */

importScripts(
    'background/shared.js',
    'background/url-rules.js',
    'background/theme.js',
    'background/messages.js',
    'background/keepalive.js',
    'background/lifecycle.js',
    'background/init.js'
);
