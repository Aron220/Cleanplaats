/**
 * Safari only. Releases a scroll lock that the page left behind.
 *
 * The site locks page scrolling while something lies over the page: the
 * full-screen photo viewer on a listing, a dialog, the cookie wall. In Safari
 * the lock sometimes stays after the overlay is gone (reported after closing
 * the photo viewer with its cross), and the page will not scroll again until
 * it is reloaded.
 *
 * For the photo viewer the lock is not script at all but one rule in the
 * site's own stylesheet:
 *
 *     html:has(> body.ReactModal__Body--open .hz-Modal) { overflow: hidden }
 *
 * Closing the viewer removes that class and that element in one go, and the
 * rule should stop matching by itself. Nothing in the extension is part of
 * that; the viewer does not touch history or the wheel either. What is left
 * is a page whose <html> still computes to overflow: hidden with no overlay
 * to show for it.
 *
 * This releases a lock that nothing on screen accounts for. It acts only when
 * the page is locked AND no overlay is visible AND that has been so for a
 * moment, and it steps back as soon as an overlay shows up again, so a lock
 * that is doing its job is left alone.
 *
 * Two kinds of lock are handled:
 * - a style on <html>/<body> (overflow: hidden, or <body> set to
 *   position: fixed, which is how the cookie wall does it), whether it came
 *   from an inline style, a class or a rule like the one above;
 * - a wheel listener that cancels every wheel event.
 *
 * Self-contained: it uses nothing from the other content scripts.
 */
(() => {
    'use strict';

    if (window.top !== window || window.__cleanplaatsScrollGuard) return;
    window.__cleanplaatsScrollGuard = true;

    // How long a lock has to sit there with nothing on screen to explain it
    // before it is released. Covers overlays that fade in or load a bit late.
    const GRACE_MS = 500;
    // When to look after a click or key press. A viewer needs a moment to open
    // or close, and some do it with an animation.
    const CHECK_DELAYS_MS = [250, 900, 2000];
    // A fixed layer counts as an overlay from this share of the window.
    const OVERLAY_MIN_COVERAGE = 0.5;
    const SAMPLE_POINTS = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    // Cancelled wheel events in a row, with the page not moving, before the
    // wheel is taken to be locked.
    const BLOCKED_WHEELS_BEFORE_BYPASS = 3;
    // Things that use the wheel themselves (map zoom). Never bypassed.
    const WHEEL_WIDGETS = '.gm-style, canvas, iframe, [role="application"]';
    // Releases in a row, with no overlay in between, before this gives up. A
    // lock that comes straight back is one this cannot win from, and trying
    // forever would only fill the console.
    const MAX_RELEASES_IN_A_ROW = 3;

    const html = document.documentElement;
    const clips = value => value === 'hidden' || value === 'clip';

    // Inline styles this script has set, and what was there before:
    // { el, prop, value, previous: { value, priority } }.
    let overrides = [];
    let lockedSince = 0;
    let overlaySeen = false;
    let releasesInARow = 0;
    // An overlay has just closed: watch whether the wheel still gets cancelled.
    let suspectWheel = false;
    let blockedWheels = 0;
    // The wheel is locked with nothing to show for it: keep wheel events away
    // from the page's listeners so the browser scrolls normally.
    let bypassWheel = false;
    let lastHref = location.href;
    let lastWheelCheck = 0;

    function log(message) {
        console.info(`Cleanplaats (Safari): ${message}`);
    }

    // What the lock looked like, for whoever reads the console line.
    function describeLock() {
        const body = document.body;
        const htmlStyle = getComputedStyle(html);
        const bodyStyle = getComputedStyle(body);
        return `html overflow-y: ${htmlStyle.overflowY}, body overflow-y: ${bodyStyle.overflowY}, ` +
            `body position: ${bodyStyle.position}, body class: "${body.className}"`;
    }

    // ---- Is the page locked? -------------------------------------------

    function isStyleLocked() {
        const body = document.body;
        if (!body) return false;

        const htmlStyle = getComputedStyle(html);
        const bodyStyle = getComputedStyle(body);
        const locked =
            clips(htmlStyle.overflowY) ||
            // <body>'s overflow only reaches the window while <html> leaves
            // its own at visible.
            (htmlStyle.overflowY === 'visible' && clips(bodyStyle.overflowY)) ||
            bodyStyle.position === 'fixed';
        if (!locked) return false;

        // A page that fits the window has nothing to scroll, locked or not.
        return Math.max(html.scrollHeight, body.scrollHeight) > window.innerHeight + 4;
    }

    // ---- Is there something on screen that explains a lock? --------------

    function isShown(el) {
        if (typeof el.checkVisibility === 'function') {
            // Both spellings: the first pair is the older name of the second.
            return el.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
                opacityProperty: true,
                visibilityProperty: true
            });
        }
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
    }

    function visibleShare(el) {
        const rect = el.getBoundingClientRect();
        const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
        const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (width <= 0 || height <= 0) return 0;
        return (width * height) / (window.innerWidth * window.innerHeight);
    }

    function isOverlayVisible() {
        if (document.fullscreenElement) return true;

        // A dialog says so itself, whatever its size.
        for (const el of document.querySelectorAll('dialog[open], [aria-modal="true"]')) {
            if (visibleShare(el) > 0 && isShown(el)) return true;
        }

        // Otherwise: whatever is on top, at a few points spread over the
        // window, sits inside a fixed layer that covers most of the window.
        // Only the topmost element counts, so a fixed background behind the
        // page is not mistaken for an overlay.
        const seen = new Set();
        for (const [x, y] of SAMPLE_POINTS) {
            let el = document.elementFromPoint(window.innerWidth * x, window.innerHeight * y);
            for (; el && el !== html && el !== document.body; el = el.parentElement) {
                if (seen.has(el)) break;
                seen.add(el);

                const style = getComputedStyle(el);
                if (
                    style.position === 'fixed' &&
                    style.pointerEvents !== 'none' &&
                    visibleShare(el) >= OVERLAY_MIN_COVERAGE &&
                    isShown(el)
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    // ---- Releasing and stepping back -------------------------------------

    function override(el, prop, value) {
        if (overrides.some(entry => entry.el === el && entry.prop === prop)) {
            // Already ours: only make sure it still says what it should.
            el.style.setProperty(prop, value, 'important');
            return;
        }
        const previous = {
            value: el.style.getPropertyValue(prop),
            priority: el.style.getPropertyPriority(prop)
        };
        // Inline and !important: wins from a class or attribute rule too.
        el.style.setProperty(prop, value, 'important');
        overrides.push({ el, prop, value, previous });
    }

    // Takes back only what is still ours, and puts back the inline value it
    // replaced: an overlay is on screen again, so that lock has a reason now.
    // If the site has written its own value over ours in the meantime, that
    // value stays.
    function dropOverrides() {
        for (const { el, prop, value, previous } of overrides) {
            if (el.style.getPropertyValue(prop) !== value || el.style.getPropertyPriority(prop) !== 'important') {
                continue;
            }
            if (previous.value) {
                el.style.setProperty(prop, previous.value, previous.priority);
            } else {
                el.style.removeProperty(prop);
            }
        }
        overrides = [];
    }

    function release() {
        const body = document.body;
        const found = describeLock();

        if (clips(getComputedStyle(html).overflowY)) {
            override(html, 'overflow-y', 'visible');
        }
        if (getComputedStyle(html).overflowY === 'visible' && clips(getComputedStyle(body).overflowY)) {
            override(body, 'overflow-y', 'visible');
        }

        // The other way to lock: <body> pinned in place, shifted up by the
        // scroll position it was locked at. Unpin it and go back there.
        const bodyStyle = getComputedStyle(body);
        if (bodyStyle.position === 'fixed') {
            const offset = parseFloat(bodyStyle.top) || 0;
            override(body, 'position', 'static');
            if (offset < 0) window.scrollTo({ top: -offset, behavior: 'instant' });
        }

        log(`Page scrolling was still locked with no overlay on screen. Released. (${found})`);
    }

    // ---- The check -------------------------------------------------------

    function evaluate() {
        if (!document.body) return;

        if (location.href !== lastHref) {
            lastHref = location.href;
            suspectWheel = false;
            bypassWheel = false;
            releasesInARow = 0;
        }

        if (isOverlayVisible()) {
            // Any lock right now belongs to what is on screen. Step back.
            overlaySeen = true;
            lockedSince = 0;
            releasesInARow = 0;
            suspectWheel = false;
            bypassWheel = false;
            dropOverrides();
            return;
        }

        if (overlaySeen) {
            // An overlay has just gone: the moment a lock gets left behind.
            overlaySeen = false;
            suspectWheel = true;
            blockedWheels = 0;
        }

        if (!isStyleLocked()) {
            lockedSince = 0;
            return;
        }

        if (releasesInARow >= MAX_RELEASES_IN_A_ROW) return;

        const now = Date.now();
        if (!lockedSince) lockedSince = now;
        if (now - lockedSince < GRACE_MS) {
            check(GRACE_MS + 20);
            return;
        }

        lockedSince = 0;
        releasesInARow++;
        release();
        if (releasesInARow === MAX_RELEASES_IN_A_ROW) {
            log('The lock keeps coming back, leaving it alone until the page changes.');
        }
    }

    // At most one pending check per delay, so a burst of triggers costs one.
    const pending = new Map();

    function check(delay) {
        if (pending.has(delay)) return;
        pending.set(delay, setTimeout(() => {
            pending.delete(delay);
            evaluate();
        }, delay));
    }

    function checkAfterInput() {
        CHECK_DELAYS_MS.forEach(delay => {
            clearTimeout(pending.get(delay));
            pending.delete(delay);
            check(delay);
        });
    }

    // ---- Wheel -----------------------------------------------------------

    function inWheelWidget(target) {
        return target instanceof Element && Boolean(target.closest(WHEEL_WIDGETS));
    }

    // Whether the page cancelled this wheel event is only known once every
    // listener has had it, so look again a moment later.
    function watchWheel(event) {
        const before = window.scrollY;
        const room = event.deltaY > 0
            ? html.scrollHeight - window.innerHeight - before > 1
            : before > 1;
        if (!room) return;

        setTimeout(() => {
            if (!suspectWheel) return;

            if (!event.defaultPrevented) {
                // The wheel gets through: no listener is holding it.
                suspectWheel = false;
                blockedWheels = 0;
                return;
            }
            // Cancelled, but the page moved anyway: it scrolls by itself.
            if (window.scrollY !== before) return;

            blockedWheels++;
            if (blockedWheels >= BLOCKED_WHEELS_BEFORE_BYPASS && !isOverlayVisible()) {
                suspectWheel = false;
                bypassWheel = true;
                log('The scroll wheel was still being cancelled with no overlay on screen. Released.');
            }
        }, 80);
    }

    function onWheel(event) {
        if (bypassWheel) {
            if (!inWheelWidget(event.target)) event.stopImmediatePropagation();
            return;
        }

        // Pinch-zoom and sideways swipes are not page scrolling.
        if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

        // Scrolling against a lock is itself a reason to look.
        const now = Date.now();
        if (now - lastWheelCheck > 300) {
            lastWheelCheck = now;
            if (isStyleLocked()) check(0);
        }

        if (suspectWheel && !inWheelWidget(event.target)) watchWheel(event);
    }

    // ---- Triggers --------------------------------------------------------

    // A lock is left behind exactly when nothing changes on <html>/<body>, so
    // mutations alone would miss it: what the user does is the main trigger.
    window.addEventListener('click', checkAfterInput, true);
    window.addEventListener('keydown', checkAfterInput, true);
    window.addEventListener('popstate', checkAfterInput);
    window.addEventListener('pageshow', checkAfterInput);
    // On window, in the capture phase: ahead of any listener on document.
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });

    // Locks are put on and taken off as a class, style or attribute here.
    const observer = new MutationObserver(() => check(80));
    observer.observe(html, { attributes: true });
    if (document.body) {
        observer.observe(document.body, { attributes: true, childList: true });
    }
})();
