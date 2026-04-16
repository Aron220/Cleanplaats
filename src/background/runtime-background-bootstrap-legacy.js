/**
 * Cleanplaats background bootstrap.
 */

importScripts(
    'background/shared.js',
    'background/url-rules.js',
    'background/theme.js',
    'background/messages.js',
    'background/keepalive.js',
    'background/lifecycle.js'
);

initialize();
setupKeepAlive();

console.log('Cleanplaats background.js: Script execution finished initial top-level setup.', new Date().toISOString());
