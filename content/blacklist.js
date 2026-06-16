/**
 * Content-script seller and term blacklist management.
 */

function incrementActionCount(n = 1) {
    CLEANPLAATS.settings.totalActionsCount = (CLEANPLAATS.settings.totalActionsCount || 0) + n;
}

function showTermsModal(triggerButton) {
    const modal = document.getElementById('cleanplaats-terms-modal');
    if (!modal) return;
    const panelText = getPanelLocaleText();

    const blacklistModal = document.getElementById('cleanplaats-blacklist-modal');
    if (blacklistModal) blacklistModal.style.display = 'none';
    const blockedListingsModal = document.getElementById('cleanplaats-blocked-listings-modal');
    if (blockedListingsModal) blockedListingsModal.style.display = 'none';
    const alertsModalFromTerms = document.getElementById('cleanplaats-alerts-modal');
    if (alertsModalFromTerms) alertsModalFromTerms.style.display = 'none';

    if (modal.style.display === 'block') {
        modal.style.display = 'none';
        return;
    }

    const titleTerms = CLEANPLAATS.settings.blacklistedTerms;
    const descTerms = CLEANPLAATS.settings.blacklistedDescriptionTerms;

    modal.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-terms-modal-content">
            <h4>${panelText.termsModalTitle}</h4>

            <div class="cleanplaats-terms-section-label">${panelText.termsTitleSectionLabel}</div>
            <ul id="cleanplaats-terms-list">
                ${titleTerms.length === 0 ? `<li><em>${panelText.termsEmpty}</em></li>` : titleTerms.map(term => `
                    <li>
                        <span>${term}</span>
                        <button class="cleanplaats-unblacklist-term-btn" data-term="${term}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')}
            </ul>
            <div class="cleanplaats-terms-input-row">
                <input type="text" id="cleanplaats-term-input" class="cleanplaats-term-input" placeholder="${panelText.termInputPlaceholder}">
                <button id="cleanplaats-add-term" class="cleanplaats-add-term-btn">${panelText.addButton}</button>
            </div>
            <div class="cleanplaats-input-help">${panelText.termInputHelp}</div>

            <div class="cleanplaats-terms-section">
                <div class="cleanplaats-terms-section-label">${panelText.termsDescriptionSectionLabel}</div>
                <ul id="cleanplaats-description-terms-list">
                    ${descTerms.length === 0 ? `<li><em>${panelText.descriptionTermsEmpty}</em></li>` : descTerms.map(term => `
                        <li>
                            <span>${term}</span>
                            <button class="cleanplaats-unblacklist-description-term-btn" data-term="${term}">${panelText.hiddenButton}</button>
                        </li>
                    `).join('')}
                </ul>
                <div class="cleanplaats-terms-input-row">
                    <input type="text" id="cleanplaats-description-term-input" class="cleanplaats-term-input" placeholder="${panelText.descriptionTermInputPlaceholder}">
                    <button id="cleanplaats-add-description-term" class="cleanplaats-add-term-btn">${panelText.addButton}</button>
                </div>
                <div class="cleanplaats-input-help">${panelText.descriptionTermInputHelp}</div>
            </div>

            <button id="cleanplaats-terms-close" style="margin-top:12px;">${panelText.closeButton}</button>
        </div>
    `);
    if (triggerButton) {
        const rect = triggerButton.getBoundingClientRect();
        modal.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        modal.style.removeProperty('top');
    }
    modal.style.display = 'block';

    document.getElementById('cleanplaats-terms-close').onclick = () => {
        modal.style.display = 'none';
    };

    const addTitleTerm = () => {
        const input = document.getElementById('cleanplaats-term-input');
        const term = input.value.trim();
        if (term && !CLEANPLAATS.settings.blacklistedTerms.includes(term)) {
            CLEANPLAATS.settings.blacklistedTerms.push(term);
            incrementActionCount();
            saveSettings().then(() => {
                input.value = '';
                updateTermsModal();
                performCleanup();
                showBlacklistTermToast(term);
                refreshDonationNudge();
            });
        }
    };

    const addDescriptionTerm = () => {
        const input = document.getElementById('cleanplaats-description-term-input');
        const term = input.value.trim();
        if (term && !CLEANPLAATS.settings.blacklistedDescriptionTerms.includes(term)) {
            CLEANPLAATS.settings.blacklistedDescriptionTerms.push(term);
            incrementActionCount();
            saveSettings().then(() => {
                input.value = '';
                updateTermsModal();
                performCleanup();
                showBubbleNotification(panelText.descriptionTermToastHidden(term));
                refreshDonationNudge();
            });
        }
    };

    document.getElementById('cleanplaats-add-term').onclick = addTitleTerm;
    document.getElementById('cleanplaats-term-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addTitleTerm(); }
    });

    document.getElementById('cleanplaats-add-description-term').onclick = addDescriptionTerm;
    document.getElementById('cleanplaats-description-term-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addDescriptionTerm(); }
    });

    setupTermsModalButtons();
    setupDescriptionTermsModalButtons();
}

function updateTermsModal() {
    const modal = document.getElementById('cleanplaats-terms-modal');
    if (!modal || modal.style.display === 'none') return;
    const panelText = getPanelLocaleText();

    const titleList = document.getElementById('cleanplaats-terms-list');
    if (titleList) {
        titleList.innerHTML = DOMPurify.sanitize(
            CLEANPLAATS.settings.blacklistedTerms.length === 0
                ? `<li><em>${panelText.termsEmpty}</em></li>`
                : CLEANPLAATS.settings.blacklistedTerms.map(term => `
                    <li>
                        <span>${term}</span>
                        <button class="cleanplaats-unblacklist-term-btn" data-term="${term}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')
        );
        setupTermsModalButtons();
    }

    const descList = document.getElementById('cleanplaats-description-terms-list');
    if (descList) {
        descList.innerHTML = DOMPurify.sanitize(
            CLEANPLAATS.settings.blacklistedDescriptionTerms.length === 0
                ? `<li><em>${panelText.descriptionTermsEmpty}</em></li>`
                : CLEANPLAATS.settings.blacklistedDescriptionTerms.map(term => `
                    <li>
                        <span>${term}</span>
                        <button class="cleanplaats-unblacklist-description-term-btn" data-term="${term}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')
        );
        setupDescriptionTermsModalButtons();
    }
}

function setupTermsModalButtons() {
    const panelText = getPanelLocaleText();
    document.querySelectorAll('.cleanplaats-unblacklist-term-btn').forEach(btn => {
        btn.onmouseover = () => {
            btn.style.background = 'green';
            btn.textContent = panelText.unhideButton;
        };
        btn.onmouseout = () => {
            btn.style.background = '#ff4d4d';
            btn.textContent = panelText.hiddenButton;
        };
        btn.style.background = '#ff4d4d';
        btn.style.color = 'white';
        btn.onclick = () => {
            const term = btn.dataset.term;
            CLEANPLAATS.settings.blacklistedTerms = CLEANPLAATS.settings.blacklistedTerms.filter(t => t !== term);
            saveSettings().then(() => {
                updateTermsModal();
                unhideListingsByTerm(term);
                performCleanup();
                showUnblacklistTermToast(term);
            });
        };
    });
}

function setupDescriptionTermsModalButtons() {
    const panelText = getPanelLocaleText();
    document.querySelectorAll('.cleanplaats-unblacklist-description-term-btn').forEach(btn => {
        btn.onmouseover = () => {
            btn.style.background = 'green';
            btn.textContent = panelText.unhideButton;
        };
        btn.onmouseout = () => {
            btn.style.background = '#ff4d4d';
            btn.textContent = panelText.hiddenButton;
        };
        btn.style.background = '#ff4d4d';
        btn.style.color = 'white';
        btn.onclick = () => {
            const term = btn.dataset.term;
            CLEANPLAATS.settings.blacklistedDescriptionTerms = CLEANPLAATS.settings.blacklistedDescriptionTerms.filter(t => t !== term);
            saveSettings().then(() => {
                updateTermsModal();
                unhideListingsByDescriptionTerm(term);
                performCleanup();
                showBubbleNotification(panelText.descriptionTermToastShown(term));
            });
        };
    });
}

function unhideListingsByDescriptionTerm(term) {
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const description = getListingDescriptionText(listing);
        if (description.includes(term.toLowerCase())) {
            listing.removeAttribute('data-cleanplaats-hidden');
            listing.style.display = '';
        }
    });
}

function unhideListingsByTerm(term) {
    document.querySelectorAll('.hz-Link').forEach(link => {
        const title = getListingTitleText(link);
        if (title.includes(term.toLowerCase())) {
            const listingEl = link.closest('.hz-StructuredListing') || link;
            listingEl.removeAttribute('data-cleanplaats-hidden');
            listingEl.style.display = '';
        }
    });
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const title = getListingTitleText(listing);
        if (title.includes(term.toLowerCase())) {
            listing.removeAttribute('data-cleanplaats-hidden');
            listing.style.display = '';
        }
    });
}

function addSellerToBlacklist(sellerName) {
    addSellersToBlacklist([sellerName]);
}

function addSellersToBlacklist(sellerNames) {
    const normalizedSellerNames = sellerNames
        .map(name => name.trim())
        .filter(Boolean)
        .filter((name, index, arr) => arr.indexOf(name) === index)
        .filter(name => !CLEANPLAATS.settings.blacklistedSellers.includes(name));

    if (normalizedSellerNames.length === 0) return;

    CLEANPLAATS.settings.blacklistedSellers.push(...normalizedSellerNames);
    incrementActionCount(normalizedSellerNames.length);
    saveSettings().then(() => {
        performCleanup();
        injectBlacklistButtons();
        updateBlacklistModal();
        refreshDonationNudge();

        if (normalizedSellerNames.length === 1) {
            showBlacklistToast(normalizedSellerNames[0]);
            return;
        }

        showBulkBlacklistToast(normalizedSellerNames.length);
    });
}

function removeSellerFromBlacklist(sellerName) {
    CLEANPLAATS.settings.blacklistedSellers = CLEANPLAATS.settings.blacklistedSellers.filter(s => s !== sellerName);
    saveSettings().then(() => {
        document.querySelectorAll('.hz-Listing').forEach(listing => {
            const sellerNameEl = listing.querySelector('.hz-Listing-seller-name, .hz-Listing-seller-name-new, .hz-Listing-seller-link, .hz-Listing-sellerName, .hz-Listing-sellerName-new');
            if (!sellerNameEl) return;
            if (sellerNameEl.textContent.trim() === sellerName) {
                listing.removeAttribute('data-cleanplaats-hidden');
                listing.style.display = '';
            }
        });
        performCleanup();
        injectBlacklistButtons();
        updateBlacklistModal();
    });
}

function injectProductDetailBlacklistButton() {
    const panelText = getPanelLocaleText();
    const sellerRoot = document.querySelector('.SellerInfoSmall-root');
    const sellerNameElement = sellerRoot?.querySelector('.SellerInfoSmall-name a, .SellerInfoSmall-name');
    const existingRow = document.querySelector('.cleanplaats-detail-blacklist-row');

    if (!isProductDetailPage() || !sellerRoot || !sellerNameElement) {
        existingRow?.remove();
        return;
    }

    const sellerName = sellerNameElement.textContent?.trim();
    if (!sellerName) {
        existingRow?.remove();
        return;
    }

    const isBlacklisted = CLEANPLAATS.settings.blacklistedSellers.includes(sellerName);
    const detailRow = existingRow || document.createElement('div');
    detailRow.className = 'cleanplaats-detail-blacklist-row';

    const button = document.createElement('button');
    button.className = 'cleanplaats-blacklist-btn cleanplaats-detail-blacklist-btn';
    button.type = 'button';
    button.tabIndex = 0;
    button.textContent = isBlacklisted ? panelText.hiddenSellerButton : panelText.hideSellerButton;
    button.disabled = isBlacklisted;
    button.setAttribute('aria-disabled', isBlacklisted ? 'true' : 'false');

    if (!isBlacklisted) {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            addSellerToBlacklist(sellerName);
        });
    }

    detailRow.replaceChildren(button);

    if (!existingRow) {
        sellerRoot.insertAdjacentElement('afterend', detailRow);
    }
}

function injectBlacklistButtons() {
    const panelText = getPanelLocaleText();
    document.querySelectorAll('.hz-Listing').forEach(listing => {
        const oldBtn = listing.querySelector('.cleanplaats-blacklist-btn-row');
        const oldTopRight = listing.querySelector('.cleanplaats-seller-topright-mobile');
        const oldInlineBtn = listing.querySelector('.cleanplaats-inline-btn');

        let sellerName = listing.dataset.cleanplaatsSellerName || null;
        let sellerElement = null;
        let isCarAdvert = false;

        const carSellerElement = listing.querySelector('.hz-Listing-sellerName, .hz-Listing-sellerName-new');
        if (carSellerElement) {
            sellerName = carSellerElement.textContent.trim();
            sellerElement = carSellerElement;
            isCarAdvert = true;
        } else {
            const sellerNameEl = listing.querySelector('.hz-Listing-seller-name, .hz-Listing-seller-name-new');
            if (sellerNameEl) {
                sellerName = sellerNameEl.textContent.trim();
                const sellerLink = sellerNameEl.closest('a');
                sellerElement = sellerLink ? (sellerLink.parentElement || sellerLink) : sellerNameEl;
                isCarAdvert = false;
            }
        }

        if (sellerName) {
            listing.dataset.cleanplaatsSellerName = sellerName;
        }

        if (!sellerName) return;

        if (CLEANPLAATS.settings.blacklistedSellers.includes(sellerName)) {
            listing.setAttribute('data-cleanplaats-hidden', 'true');
            listing.style.display = 'none';
            return;
        }

        if (window.innerWidth < 700) {
            if (oldTopRight && oldTopRight.dataset.cleanplaatsSellerName === sellerName) {
                return;
            }

            if (oldBtn) oldBtn.remove();
            if (oldInlineBtn) oldInlineBtn.remove();
            if (oldTopRight) oldTopRight.remove();

            const topRow = document.createElement('div');
            topRow.className = 'cleanplaats-seller-topright-mobile';
            topRow.dataset.cleanplaatsSellerName = sellerName;
            topRow.innerHTML = DOMPurify.sanitize(`
                <span class="cleanplaats-seller-name-mobile">${sellerName}</span>
                <button class="cleanplaats-blacklist-btn-mobile" title="${panelText.hideSellerButtonAriaLabel}" aria-label="${panelText.hideSellerButtonAriaLabel}">
                  <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20C7 20 2.73 16.11 1 12c.74-1.61 1.81-3.09 3.06-4.31"/>
                    <path d="M22.54 12.88A10.06 10.06 0 0 0 12 4c-1.61 0-3.16.31-4.59.88"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
            `);
            const content = listing.querySelector('.hz-Listing-listview-content, .hz-Listing-listview-content-new');
            if (content && content.firstChild) {
                content.insertBefore(topRow, content.firstChild);
            } else if (content) {
                content.appendChild(topRow);
            }
            topRow.querySelector('.cleanplaats-blacklist-btn-mobile').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm(`Wil je alle advertenties van ${sellerName} verbergen?`)) {
                    addSellerToBlacklist(sellerName);
                }
            };
            return;
        }

        if (!sellerElement) return;

        if (oldBtn) oldBtn.remove();
        if (oldTopRight) oldTopRight.remove();
        if (oldInlineBtn) oldInlineBtn.remove();

        if (isCarAdvert) {
            carSellerElement.style.display = 'inline-flex';
            carSellerElement.style.alignItems = 'center';
            carSellerElement.style.gap = '8px';

            const btn = document.createElement('button');
            btn.className = 'cleanplaats-blacklist-btn cleanplaats-inline-btn';
            btn.textContent = panelText.hideSellerButton;
            btn.type = 'button';
            btn.tabIndex = 0;
            btn.style.marginLeft = '8px';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                addSellerToBlacklist(sellerName);
            });

            carSellerElement.appendChild(btn);
        } else {
            const btnRow = document.createElement('div');
            btnRow.className = 'cleanplaats-blacklist-btn-row';

            const btn = document.createElement('button');
            btn.className = 'cleanplaats-blacklist-btn';
            btn.textContent = panelText.hideSellerButton;
            btn.type = 'button';
            btn.tabIndex = 0;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                addSellerToBlacklist(sellerName);
            });

            btnRow.appendChild(btn);

            if (sellerElement.parentNode) {
                sellerElement.parentNode.insertBefore(btnRow, sellerElement.nextSibling);
            }
        }
    });

    injectListingBlockButtons();
    injectProductDetailBlacklistButton();
}

function showBlacklistModal(triggerButton) {
    const modal = document.getElementById('cleanplaats-blacklist-modal');
    if (!modal) return;
    const panelText = getPanelLocaleText();

    const termsModal = document.getElementById('cleanplaats-terms-modal');
    const descriptionTermsModal = document.getElementById('cleanplaats-description-terms-modal');
    const blockedListingsModal2 = document.getElementById('cleanplaats-blocked-listings-modal');
    if (termsModal) termsModal.style.display = 'none';
    if (descriptionTermsModal) descriptionTermsModal.style.display = 'none';
    if (blockedListingsModal2) blockedListingsModal2.style.display = 'none';
    const alertsModalFromBlacklist = document.getElementById('cleanplaats-alerts-modal');
    if (alertsModalFromBlacklist) alertsModalFromBlacklist.style.display = 'none';

    if (modal.style.display === 'block') {
        modal.style.display = 'none';
        return;
    }

    const sellers = CLEANPLAATS.settings.blacklistedSellers;

    modal.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-modal-content">
            <h4>${panelText.sellersModalTitle}</h4>
            <ul id="cleanplaats-blacklist-list">
                ${sellers.length === 0 ? `<li><em>${panelText.sellersEmpty}</em></li>` : sellers.map(seller => `
                    <li>
                        <span>${seller}</span>
                        <button class="cleanplaats-unblacklist-btn" data-seller="${seller}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')}
            </ul>
            <div class="cleanplaats-terms-input-row">
                <input type="text" id="cleanplaats-seller-input" class="cleanplaats-term-input" placeholder="${panelText.sellerInputPlaceholder}">
                <button id="cleanplaats-add-seller" class="cleanplaats-add-term-btn">${panelText.addButton}</button>
            </div>
            <div class="cleanplaats-input-help">${panelText.sellerInputHelp}</div>
            <button id="cleanplaats-blacklist-close" style="margin-top:10px;">${panelText.closeButton}</button>
        </div>
    `);
    if (triggerButton) {
        const rect = triggerButton.getBoundingClientRect();
        modal.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        modal.style.removeProperty('top');
    }
    modal.style.display = 'block';

    document.getElementById('cleanplaats-blacklist-close').onclick = () => {
        modal.style.display = 'none';
    };

    const addSeller = () => {
        const input = document.getElementById('cleanplaats-seller-input');
        const sellerNames = input.value
            .split(/[;,]+/)
            .map(name => name.trim())
            .filter(Boolean);

        if (sellerNames.length === 0) return;

        addSellersToBlacklist(sellerNames);
        input.value = '';
    };

    document.getElementById('cleanplaats-add-seller').onclick = addSeller;

    document.getElementById('cleanplaats-seller-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSeller();
        }
    });

    setupBlacklistModalButtons();
}

function updateBlacklistModal() {
    const modal = document.getElementById('cleanplaats-blacklist-modal');
    if (!modal || modal.style.display === 'none') return;
    const panelText = getPanelLocaleText();

    const sellers = CLEANPLAATS.settings.blacklistedSellers;
    const list = document.getElementById('cleanplaats-blacklist-list');

    if (list) {
        list.innerHTML = DOMPurify.sanitize(
            sellers.length === 0
                ? `<li><em>${panelText.sellersEmpty}</em></li>`
                : sellers.map(seller => `
                    <li>
                        <span>${seller}</span>
                        <button class="cleanplaats-unblacklist-btn" data-seller="${seller}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')
        );

        setupBlacklistModalButtons();
    }
}

function setupBlacklistModalButtons() {
    const panelText = getPanelLocaleText();
    document.querySelectorAll('.cleanplaats-unblacklist-btn').forEach(btn => {
        btn.onmouseover = () => {
            btn.style.background = 'green';
            btn.textContent = panelText.unhideButton;
        };
        btn.onmouseout = () => {
            btn.style.background = '#ff4d4d';
            btn.textContent = panelText.hiddenButton;
        };
        btn.style.background = '#ff4d4d';
        btn.style.color = 'white';
        btn.onclick = () => {
            const sellerName = btn.dataset.seller;
            showUnblacklistToast(sellerName);
            removeSellerFromBlacklist(sellerName);
        };
    });
}

function addListingToBlocklist(listingId, title) {
    if (!listingId) return;
    const blockedListings = CLEANPLAATS.settings.blockedListings || [];
    if (blockedListings.some(b => b.id === listingId)) return;

    const displayTitle = (title || listingId).substring(0, 80);
    CLEANPLAATS.settings.blockedListings = [...blockedListings, { id: listingId, title: displayTitle }];
    incrementActionCount();
    saveSettings().then(() => {
        performCleanup();
        updateBlockedListingsModal();
        refreshDonationNudge();
        const panelText = getPanelLocaleText();
        showBubbleNotification(panelText.listingToastHidden(displayTitle));
    });
}

function removeListingFromBlocklist(listingId) {
    const entry = (CLEANPLAATS.settings.blockedListings || []).find(b => b.id === listingId);
    CLEANPLAATS.settings.blockedListings = (CLEANPLAATS.settings.blockedListings || []).filter(b => b.id !== listingId);
    saveSettings().then(() => {
        document.querySelectorAll(`[data-cleanplaats-listing-id="${CSS.escape(listingId)}"]`).forEach(listing => {
            listing.removeAttribute('data-cleanplaats-hidden');
            listing.style.display = '';
        });
        performCleanup();
        injectBlacklistButtons();
        updateBlockedListingsModal();
        const panelText = getPanelLocaleText();
        showBubbleNotification(panelText.listingToastShown(entry?.title || listingId));
    });
}

function injectListingBlockButtons() {
    const panelText = getPanelLocaleText();
    const blockedListings = CLEANPLAATS.settings.blockedListings || [];

    document.querySelectorAll('.hz-Listing').forEach(listing => {
        if (listing.hasAttribute('data-cleanplaats-hidden')) return;

        const listingLink = listing.querySelector('a[href*="/v/"]');
        const listingId = getListingIdFromUrl(listingLink?.href);
        if (!listingId) return;

        listing.dataset.cleanplaatsListingId = listingId;

        if (blockedListings.some(b => b.id === listingId)) {
            listing.setAttribute('data-cleanplaats-hidden', 'true');
            listing.style.display = 'none';
            return;
        }

        if (listing.querySelector('.cleanplaats-listing-block-btn')) return;

        const title = getListingTitleText(listing);

        const btn = document.createElement('button');
        btn.className = 'cleanplaats-blacklist-btn cleanplaats-listing-block-btn';
        btn.textContent = panelText.hideListingButton;
        btn.type = 'button';
        btn.tabIndex = 0;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addListingToBlocklist(listingId, title);
        });

        const topRightMobile = listing.querySelector('.cleanplaats-seller-topright-mobile');
        if (topRightMobile) {
            topRightMobile.appendChild(btn);
            return;
        }

        const carSellerEl = listing.querySelector('.hz-Listing-sellerName, .hz-Listing-sellerName-new');
        if (carSellerEl && carSellerEl.querySelector('.cleanplaats-inline-btn')) {
            carSellerEl.appendChild(btn);
            return;
        }

        const sellerBtnRow = listing.querySelector('.cleanplaats-blacklist-btn-row');
        if (sellerBtnRow) {
            sellerBtnRow.appendChild(btn);
            return;
        }

        const row = document.createElement('div');
        row.className = 'cleanplaats-blacklist-btn-row';
        row.appendChild(btn);

        const sellerEl = listing.querySelector('.hz-Listing-seller-name, .hz-Listing-seller-name-new, .hz-Listing-sellerName, .hz-Listing-sellerName-new');
        const injectionParent = sellerEl?.closest('a')?.parentElement || sellerEl?.parentElement;
        if (injectionParent) {
            injectionParent.insertBefore(row, sellerEl.nextSibling);
            return;
        }

        const content = listing.querySelector('.hz-Listing-listview-content, .hz-Listing-listview-content-new');
        if (content) content.appendChild(row);
    });
}

function showBlockedListingsModal(triggerButton) {
    const modal = document.getElementById('cleanplaats-blocked-listings-modal');
    if (!modal) return;
    const panelText = getPanelLocaleText();

    const blacklistModal = document.getElementById('cleanplaats-blacklist-modal');
    const termsModal = document.getElementById('cleanplaats-terms-modal');
    if (blacklistModal) blacklistModal.style.display = 'none';
    if (termsModal) termsModal.style.display = 'none';
    const alertsModalFromBlocked = document.getElementById('cleanplaats-alerts-modal');
    if (alertsModalFromBlocked) alertsModalFromBlocked.style.display = 'none';

    if (modal.style.display === 'block') {
        modal.style.display = 'none';
        return;
    }

    const listings = CLEANPLAATS.settings.blockedListings || [];

    modal.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-blacklist-modal-content">
            <h4>${panelText.blockedListingsModalTitle}</h4>
            <ul id="cleanplaats-blocked-listings-list">
                ${listings.length === 0 ? `<li><em>${panelText.blockedListingsEmpty}</em></li>` : listings.map(item => `
                    <li>
                        <span>${item.title || item.id}</span>
                        <button class="cleanplaats-unblock-listing-btn" data-listing-id="${item.id}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')}
            </ul>
            <button id="cleanplaats-blocked-listings-close" style="margin-top:10px;">${panelText.closeButton}</button>
        </div>
    `);

    if (triggerButton) {
        const rect = triggerButton.getBoundingClientRect();
        modal.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        modal.style.removeProperty('top');
    }
    modal.style.display = 'block';

    document.getElementById('cleanplaats-blocked-listings-close').onclick = () => {
        modal.style.display = 'none';
    };

    setupBlockedListingsModalButtons();
}

function updateBlockedListingsModal() {
    const modal = document.getElementById('cleanplaats-blocked-listings-modal');
    if (!modal || modal.style.display === 'none') return;
    const panelText = getPanelLocaleText();

    const listings = CLEANPLAATS.settings.blockedListings || [];
    const list = document.getElementById('cleanplaats-blocked-listings-list');

    if (list) {
        list.innerHTML = DOMPurify.sanitize(
            listings.length === 0
                ? `<li><em>${panelText.blockedListingsEmpty}</em></li>`
                : listings.map(item => `
                    <li>
                        <span>${item.title || item.id}</span>
                        <button class="cleanplaats-unblock-listing-btn" data-listing-id="${item.id}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')
        );
        setupBlockedListingsModalButtons();
    }
}

function setupBlockedListingsModalButtons() {
    const panelText = getPanelLocaleText();
    document.querySelectorAll('.cleanplaats-unblock-listing-btn').forEach(btn => {
        btn.onmouseover = () => {
            btn.style.background = 'green';
            btn.textContent = panelText.unhideButton;
        };
        btn.onmouseout = () => {
            btn.style.background = '#ff4d4d';
            btn.textContent = panelText.hiddenButton;
        };
        btn.style.background = '#ff4d4d';
        btn.style.color = 'white';
        btn.onclick = () => {
            const listingId = btn.dataset.listingId;
            removeListingFromBlocklist(listingId);
        };
    });
}
