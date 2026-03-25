/**
 * Content-script notifications, onboarding, and lightweight feedback UI.
 */

function showFirstTimeOnboarding() {
    const onboarding = document.createElement('div');
    onboarding.className = 'cleanplaats-onboarding';
    onboarding.id = 'cleanplaats-onboarding';

    onboarding.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-onboarding-content">
            <div class="cleanplaats-onboarding-header">
                <h3>🎉 Welkom bij Cleanplaats!</h3>
                <button id="cleanplaats-onboarding-close" class="cleanplaats-onboarding-close">×</button>
            </div>
            <div class="cleanplaats-onboarding-steps">
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">1</span>
                    <p>Cleanplaats verwijdert automatisch advertenties en promotionele content</p>
                </div>
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">2</span>
                    <p>Gebruik het configuratiescherm rechtsonder om de filtering aan te passen. Je opent en sluit het paneel via het pijltje bovenin.</p>
                </div>
                <div class="cleanplaats-onboarding-step">
                    <span class="step-number">3</span>
                    <p>Bekijk statistieken over verwijderde items in het configuratiescherm</p>
                </div>
            </div>
            <button id="cleanplaats-onboarding-got-it" class="cleanplaats-onboarding-button">Aan de slag!</button>
        </div>
    `);

    document.body.appendChild(onboarding);

    ['cleanplaats-onboarding-close', 'cleanplaats-onboarding-got-it'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            onboarding.classList.add('cleanplaats-fade-out');
            setTimeout(() => onboarding.remove(), 300);
        });
    });

    setTimeout(() => {
        if (onboarding.parentNode) {
            onboarding.classList.add('cleanplaats-fade-out');
            setTimeout(() => onboarding.remove(), 300);
        }
    }, 15000);
}

function shouldShowUpdatePopup(currentVersion) {
    if (!currentVersion) {
        return false;
    }

    return CLEANPLAATS.panelState.lastSeenVersion !== currentVersion;
}

function showUpdatePopup(version) {
    const existingPopup = document.getElementById('cleanplaats-update-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const updateContent = CLEANPLAATS_UPDATE_NOTES[version] || {
        intro: 'Cleanplaats heeft een nieuwe update gekregen met verbeteringen en onderhoud aan de extensie.',
        highlights: [
            'Diverse verbeteringen en fixes voor de huidige resultaatpagina’s.',
            'Kleine verfijningen aan het paneel en de filtering.',
            'Onderhoudswerk om Cleanplaats stabiel te houden op nieuwe sitewijzigingen.'
        ],
        note: 'Zie je een probleem of heb je een idee? Gebruik de GitHub-link in het paneel.'
    };

    const popup = document.createElement('div');
    popup.className = 'cleanplaats-info-overlay cleanplaats-info-overlay--visible';
    popup.id = 'cleanplaats-update-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-hidden', 'false');

    const stepsMarkup = updateContent.highlights
        .map(step => `<li>${step}</li>`)
        .join('');

    popup.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-info-card">
            <div class="cleanplaats-info-header">
                <img id="cleanplaats-update-popup-logo" class="cleanplaats-info-logo" alt="Cleanplaats">
                <span class="cleanplaats-info-eyebrow">Nieuwe update</span>
                <h3 class="cleanplaats-info-title">Wat is er nieuw? (${version})</h3>
                <p class="cleanplaats-info-intro">${updateContent.intro}</p>
            </div>
            <ol class="cleanplaats-info-steps">${stepsMarkup}</ol>
            <p class="cleanplaats-info-note">${updateContent.note}</p>
            <div class="cleanplaats-info-footer">
                <button type="button" id="cleanplaats-update-popup-close" class="cleanplaats-info-button">Top, bedankt</button>
            </div>
        </div>
    `);

    const closePopup = () => {
        popup.classList.remove('cleanplaats-info-overlay--visible');
        popup.setAttribute('aria-hidden', 'true');
        setTimeout(() => popup.remove(), 200);
        document.removeEventListener('keydown', handleKeydown);
    };

    const handleKeydown = (event) => {
        if (event.key === 'Escape') {
            closePopup();
        }
    };

    popup.addEventListener('click', (event) => {
        if (event.target === popup) {
            closePopup();
        }
    });

    document.addEventListener('keydown', handleKeydown);
    document.body.appendChild(popup);
    const popupLogo = document.getElementById('cleanplaats-update-popup-logo');
    if (popupLogo) {
        popupLogo.src = browserAPI.runtime.getURL('icons/icon128.png');
    }
    document.getElementById('cleanplaats-update-popup-close')?.addEventListener('click', () => {
        closePopup();
        showBubbleNotification(`Veel plezier met ${version}`);
    });
}

function showWelcomeToast() {
    if (CLEANPLAATS.panelState.hasShownWelcomeToast ||
        location.pathname !== '/' ||
        location.hostname !== 'www.marktplaats.nl') {
        return;
    }

    const toast = document.createElement('div');
    toast.className = 'cleanplaats-toast';
    toast.id = 'cleanplaats-toast';

    const totalRemoved = CLEANPLAATS.stats.totalRemoved;
    const message = totalRemoved > 0
        ? `Cleanplaats is actief (${totalRemoved} items verwijderd)`
        : 'Cleanplaats is actief';

    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-toast-content">
            <span class="cleanplaats-toast-icon">✨</span>
            <span class="cleanplaats-toast-message">${message}</span>
        </div>
    `);

    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 100);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);

    CLEANPLAATS.panelState.hasShownWelcomeToast = true;
}

function showOnboarding(currentVersion = '') {
    if (CLEANPLAATS.featureFlags.firstRun) {
        if (currentVersion) {
            CLEANPLAATS.panelState.lastSeenVersion = currentVersion;
            saveSettings().catch(error => {
                console.error('Cleanplaats: Failed to store initial version state', error);
            });
        }
        showFirstTimeOnboarding();
    } else if (shouldShowUpdatePopup(currentVersion)) {
        CLEANPLAATS.panelState.lastSeenVersion = currentVersion;
        saveSettings().catch(error => {
            console.error('Cleanplaats: Failed to store seen update version', error);
        });
        showUpdatePopup(currentVersion);
    } else {
        showWelcomeToast();
    }
}

function checkForEmptyPage() {
    clearTimeout(notificationTimeout);

    notificationTimeout = setTimeout(() => {
        performCleanup();

        const visibleListings = document.querySelectorAll('.hz-Listing:not([data-cleanplaats-hidden])');
        const totalListings = document.querySelectorAll('.hz-Listing');
        const hiddenCount = totalListings.length - visibleListings.length;

        if (hiddenCount === 0) return;

        clearAllNotifications();

        if (visibleListings.length === 0) {
            showBubbleNotification('De pagina is leeg omdat deze helemaal uit advertenties bestond! Probeer een volgende pagina of wijzig de filters.');
        } else if (visibleListings.length < 5) {
            const listingWord = visibleListings.length === 1 ? 'resultaat' : 'resultaten';
            const removedWord = hiddenCount === 1 ? 'advertentie' : 'advertenties';
            showBubbleNotification(`Er ${visibleListings.length === 1 ? 'is' : 'zijn'} nog ${visibleListings.length} ${listingWord} over nadat Cleanplaats ${hiddenCount} ${removedWord} heeft verwijderd.`);
        }
    }, 1000);
}

function showBubbleNotification(message) {
    let toast = document.getElementById('cleanplaats-bubble-notification');

    if (toast) {
        const messageElement = toast.querySelector('.cleanplaats-toast-message span');
        if (messageElement) {
            messageElement.textContent = message;
        }
    } else {
        toast = document.createElement('div');
        toast.className = 'cleanplaats-blacklist-toast';
        toast.id = 'cleanplaats-bubble-notification';

        toast.innerHTML = DOMPurify.sanitize(`
            <div class="cleanplaats-blacklist-toast-content">
                <span class="cleanplaats-toast-icon">✨</span>
                <div class="cleanplaats-toast-message">
                    <span>${message}</span>
                </div>
            </div>
        `);

        document.body.appendChild(toast);
        setTimeout(() => requestAnimationFrame(() => toast.classList.add('visible')), 0);
    }

    if (toast.timeoutId) {
        clearTimeout(toast.timeoutId);
    }

    toast.timeoutId = setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast) {
                toast.remove();
            }
        }, 300);
    }, 5000);
}

function clearAllNotifications() {
    const notifications = document.querySelectorAll('[id^="cleanplaats-"]');
    notifications.forEach(notification => {
        if (notification.classList.contains('cleanplaats-empty-notification') ||
            notification.id === 'cleanplaats-loading') {
            notification.remove();
        }
    });
    notificationVisible = false;
}

function clearBubbleNotification() {
    const toast = document.getElementById('cleanplaats-bubble-notification');
    if (toast) {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast) {
                toast.remove();
            }
        }, 300);
    }
}

function showSettingFeedback() {
    return;
}

function showBlacklistToast(sellerName) {
    const panelText = getPanelLocaleText();
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';

    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon eye">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${sellerName} ${panelText.blacklistToastHiddenSuffix}</strong>
                <span>${panelText.blacklistToastHint}</span>
            </div>
        </div>
    `);

    document.body.appendChild(toast);
    setTimeout(() => {
        requestAnimationFrame(() => toast.classList.add('visible'));
    }, 50);

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showBulkBlacklistToast(count) {
    const panelText = getPanelLocaleText();
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';

    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon eye">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${count} ${panelText.blacklistToastHiddenPluralSuffix}</strong>
                <span>${panelText.blacklistToastHint}</span>
            </div>
        </div>
    `);

    document.body.appendChild(toast);
    setTimeout(() => {
        requestAnimationFrame(() => toast.classList.add('visible'));
    }, 50);

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showUnblacklistToast(sellerName) {
    const panelText = getPanelLocaleText();
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';

    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon eye">👁</span>
            <div class="cleanplaats-toast-message">
                <strong>${sellerName} ${panelText.blacklistToastShownSuffix}</strong>
                <span>${panelText.blacklistToastShownHint}</span>
            </div>
        </div>
    `);

    document.body.appendChild(toast);
    setTimeout(() => {
        requestAnimationFrame(() => toast.classList.add('visible'));
    }, 50);

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showBlacklistTermToast(term) {
    const panelText = getPanelLocaleText();
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';
    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">🔎</span>
            <div class="cleanplaats-toast-message">
                <strong>'${term}' ${panelText.blacklistToastHiddenSuffix}</strong>
                <span>${panelText.termToastHidden(term)}</span>
            </div>
        </div>
    `);
    document.body.appendChild(toast);
    setTimeout(() => { requestAnimationFrame(() => toast.classList.add('visible')); }, 50);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showUnblacklistTermToast(term) {
    const panelText = getPanelLocaleText();
    const toast = document.createElement('div');
    toast.className = 'cleanplaats-blacklist-toast';
    toast.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-toast-content">
            <span class="cleanplaats-toast-icon">🔎</span>
            <div class="cleanplaats-toast-message">
                <strong>'${term}' ${panelText.blacklistToastShownSuffix}</strong>
                <span>${panelText.termToastShown(term)}</span>
            </div>
        </div>
    `);
    document.body.appendChild(toast);
    setTimeout(() => { requestAnimationFrame(() => toast.classList.add('visible')); }, 50);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
