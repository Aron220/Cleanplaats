/**
 * The page the zoekopdrachten panel opens to ask Firefox for data consent.
 *
 * It exists only because permissions.request() has to be called from a click
 * in an extension page: the panel is a content script, which has no
 * permissions API at all. See openAlertsDataConsentPage() in
 * background/messages.js.
 */

var browserAPI = typeof browser !== 'undefined' ? browser : chrome;

var CONSENT_TEXT = {
    nl: {
        title: 'Toestemming voor zoekopdrachten',
        body: 'Zoekopdrachten draaien op de server van Cleanplaats. Daarvoor heeft die je e-mailadres, je zoekopdrachten en je filters nodig. Klik hieronder, dan vraagt Firefox je om toestemming.',
        button: 'Doorgaan',
        granted: 'Gelukt. Dit venster sluit vanzelf.',
        declined: 'Geen toestemming gegeven. Zoekopdrachten werken dan niet, de rest van Cleanplaats wel.',
        failed: 'Dat ging niet goed. Probeer het nog eens.'
    },
    fr: {
        title: 'Autorisation pour les recherches',
        body: 'Les recherches tournent sur le serveur de Cleanplaats. Il a besoin pour cela de votre adresse e-mail, de vos recherches et de vos filtres. Cliquez ci-dessous et Firefox vous demandera votre accord.',
        button: 'Continuer',
        granted: 'C’est fait. Cette fenêtre va se fermer.',
        declined: 'Aucune autorisation donnée. Les recherches ne fonctionnent pas sans, le reste de Cleanplaats bien.',
        failed: 'Une erreur s’est produite. Réessayez.'
    }
};

var lang = new URLSearchParams(location.search).get('lang') === 'fr' ? 'fr' : 'nl';
var text = CONSENT_TEXT[lang];

document.documentElement.lang = lang;
document.getElementById('consent-title').textContent = text.title;
document.getElementById('consent-body').textContent = text.body;

var button = document.getElementById('consent-button');
var status = document.getElementById('consent-status');
button.textContent = text.button;

function showStatus(message, kind) {
    status.textContent = message;
    status.className = kind ? `is-${kind}` : '';
}

function closeSelf() {
    // window.close() is not reliable for a tab the user could also have opened
    // by hand; removing our own tab is, and closes the popup window with it.
    browserAPI.tabs.getCurrent()
        .then(tab => (tab ? browserAPI.tabs.remove(tab.id) : window.close()))
        .catch(() => window.close());
}

button.addEventListener('click', () => {
    const wanted = browserAPI.runtime.getManifest()
        .browser_specific_settings?.gecko?.data_collection_permissions?.optional || [];

    button.disabled = true;
    // Called straight from the click, before anything else is awaited: Firefox
    // only lets request() through while it still counts as the user's action.
    browserAPI.permissions.request({ data_collection: wanted })
        .then(granted => {
            if (granted) {
                button.hidden = true;
                showStatus(text.granted, 'ok');
                setTimeout(closeSelf, 1200);
                return;
            }
            button.disabled = false;
            showStatus(text.declined, 'declined');
        })
        .catch(error => {
            console.error('Cleanplaats: Data consent request failed', error);
            button.disabled = false;
            showStatus(text.failed, 'declined');
        });
});
