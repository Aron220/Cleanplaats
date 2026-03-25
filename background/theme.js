/**
 * Background theme-init registration.
 */

async function updateDarkModeStartupScript(enabled) {
    if (!browserAPI.scripting?.registerContentScripts || !browserAPI.scripting?.unregisterContentScripts) {
        console.warn('Cleanplaats: scripting content script registration is unavailable.');
        return;
    }

    try {
        await browserAPI.scripting.unregisterContentScripts({ ids: [THEME_INIT_SCRIPT_ID] });
    } catch (error) {
        console.warn('Cleanplaats: Failed to unregister theme startup script.', error);
    }

    if (!enabled) {
        console.log('Cleanplaats: Startup dark-mode script disabled.');
        return;
    }

    try {
        await browserAPI.scripting.registerContentScripts([{
            id: THEME_INIT_SCRIPT_ID,
            js: ['theme-init.js'],
            matches: THEME_MATCH_PATTERNS,
            runAt: 'document_start',
            persistAcrossSessions: true
        }]);
        console.log('Cleanplaats: Startup dark-mode script enabled.');
    } catch (error) {
        console.error('Cleanplaats: Failed to register theme startup script.', error);
    }
}
