/**
 * Content-script seller and term blacklist management.
 */

function showTermsModal() {
    const modal = document.getElementById('cleanplaats-terms-modal');
    if (!modal) return;
    const panelText = getPanelLocaleText();

    const blacklistModal = document.getElementById('cleanplaats-blacklist-modal');
    if (blacklistModal) {
        blacklistModal.style.display = 'none';
    }

    if (modal.style.display === 'block') {
        modal.style.display = 'none';
        return;
    }

    const terms = CLEANPLAATS.settings.blacklistedTerms;

    modal.innerHTML = DOMPurify.sanitize(`
        <div class="cleanplaats-terms-modal-content">
            <h4>${panelText.termsModalTitle}</h4>
            <ul id="cleanplaats-terms-list">
                ${terms.length === 0 ? `<li><em>${panelText.termsEmpty}</em></li>` : terms.map(term => `
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
            <button id="cleanplaats-terms-close" style="margin-top:12px;">${panelText.closeButton}</button>
        </div>
    `);
    modal.style.display = 'block';

    document.getElementById('cleanplaats-terms-close').onclick = () => {
        modal.style.display = 'none';
    };

    const addTerm = () => {
        const input = document.getElementById('cleanplaats-term-input');
        const term = input.value.trim();
        if (term && !CLEANPLAATS.settings.blacklistedTerms.includes(term)) {
            CLEANPLAATS.settings.blacklistedTerms.push(term);
            saveSettings().then(() => {
                input.value = '';
                updateTermsModal();
                performCleanup();
                showBlacklistTermToast(term);
            });
        }
    };

    document.getElementById('cleanplaats-add-term').onclick = addTerm;

    document.getElementById('cleanplaats-term-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTerm();
        }
    });

    setupTermsModalButtons();
}

function updateTermsModal() {
    const modal = document.getElementById('cleanplaats-terms-modal');
    if (!modal || modal.style.display === 'none') return;
    const panelText = getPanelLocaleText();

    const terms = CLEANPLAATS.settings.blacklistedTerms;
    const list = document.getElementById('cleanplaats-terms-list');

    if (list) {
        list.innerHTML = DOMPurify.sanitize(
            terms.length === 0
                ? `<li><em>${panelText.termsEmpty}</em></li>`
                : terms.map(term => `
                    <li>
                        <span>${term}</span>
                        <button class="cleanplaats-unblacklist-term-btn" data-term="${term}">${panelText.hiddenButton}</button>
                    </li>
                `).join('')
        );

        setupTermsModalButtons();
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
    saveSettings().then(() => {
        performCleanup();
        injectBlacklistButtons();
        updateBlacklistModal();

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

    injectProductDetailBlacklistButton();
}

function showBlacklistModal() {
    const modal = document.getElementById('cleanplaats-blacklist-modal');
    if (!modal) return;
    const panelText = getPanelLocaleText();

    const termsModal = document.getElementById('cleanplaats-terms-modal');
    if (termsModal) {
        termsModal.style.display = 'none';
    }

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
