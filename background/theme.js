/**
 * Background theme-init registration.
 */

async function updateDarkModeStartupScript(enabled) {
    // theme-init.js is now loaded statically via manifest.json at document_start.
    // Keeping this async hook as a no-op avoids browser-specific timing issues
    // with runtime content-script registration, especially in Firefox.
    console.log(`Cleanplaats: Startup dark-mode script is manifest-driven (${enabled ? 'enabled' : 'disabled'}).`);
}
