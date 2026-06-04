// x-no-scroll — keeps your scroll position fixed when X/Twitter loads new posts above you.
//
// WHAT X DOES (verified live):
//   When you click a "Show N posts" / "See new posts" / "Show more posts" button, X loads the
//   new posts above you AND calls scrollToNewest() -> window.scrollTo(0) + window.scrollBy(...),
//   deliberately yanking you to the top. That scroll-to-newest is what makes you lose your place.
//
// DESIGN — event-driven and passive by default:
//   The extension does NOTHING during normal use (reading, wheel, scrollbar, keyboard), so it can
//   never cause a stray jump. It only acts in a short window AFTER A CLICK:
//     1. On any click, remember the anchor = the topmost in-view tweet (status id + on-screen
//        offset) and "arm" for a few seconds.
//     2. If a load arrives while armed, suppress X's scroll-to-newest (window.scrollTo/scrollBy)
//        and restore the anchor to exactly where it was. Re-pin across chunked loads.
//     3. If you scroll yourself while armed (before the load), it disarms — you've moved on.
//   Restores use element.scrollTop (X uses window.scrollTo/scrollBy) — a clean seam, so our scroll
//   and X's scroll never get confused.

(function () {
  'use strict';

  var CELL = '[data-testid="cellInnerDiv"]';
  var HEADER_OFFSET = 56;
  var ARM_MS = 12000;   // after a click, watch for X to load posts for this long
  var DEFEND_MS = 1500; // while restoring, suppress X's scroll-to-newest this long after each fix

  function scrollEl() { return document.scrollingElement || document.documentElement; }
  function nowMs() { return Date.now(); }
  function onHome() { return window.__xnsTest === true || location.pathname === '/home'; }

  function statusIdOf(cell) {
    var a = cell.querySelector('a[href*="/status/"]');
    if (!a) return null;
    var m = (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function findContainer() {
    var cell = document.querySelector(CELL);
    return cell ? cell.parentElement : null;
  }

  // ---- state ----
  var anchor = null;          // captured at click: { id, savedTop, baseScrollTop, baseScrollHeight }
  var armedUntil = 0;         // a click happened; a load may follow
  var defendUntil = 0;        // actively restoring; block X's scroll-to-newest
  var selfScrollUntil = 0;    // we just set scrollTop (ignore the resulting scroll event)
  var xScrollUntil = 0;       // X just scrolled programmatically (ignore it too)
  var lastScrollHeight = 0;
  var container = null;
  var cellObserver = null;
  var bodyObserver = null;
  var reattachQueued = false;
  var started = false;
  var repinTimer = null;

  function isArmed() { return nowMs() < armedUntil; }
  function inDefend() { return nowMs() < defendUntil; }

  function pickAnchor() {
    var cells = document.querySelectorAll(CELL);
    var se = scrollEl();
    // Prefer the topmost tweet that actually STARTS inside the readable area (top at/below the
    // header). Anchoring to a sliver that's mostly scrolled off the top would let a mid-view
    // "Show more posts" gap-fill shove the content you're reading down. Fall back to the topmost
    // partially-visible tweet only if none start in view.
    var best = null, bestTop = Infinity;       // topmost tweet with top >= header
    var fb = null, fbTop = Infinity;           // topmost partially-visible tweet (fallback)
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var id = statusIdOf(c);
      if (!id) continue; // skip spacers / non-tweet cells
      var r = c.getBoundingClientRect();
      if (r.bottom <= HEADER_OFFSET + 1) continue; // scrolled fully above the header
      var rec = { id: id, savedTop: r.top, baseScrollTop: se.scrollTop, baseScrollHeight: se.scrollHeight };
      if (r.top < fbTop) { fbTop = r.top; fb = rec; }
      if (r.top >= HEADER_OFFSET && r.top < bestTop) { bestTop = r.top; best = rec; }
    }
    return best || fb;
  }

  function findCellById(id) {
    var cells = document.querySelectorAll(CELL);
    for (var i = 0; i < cells.length; i++) {
      if (statusIdOf(cells[i]) === id) return cells[i];
    }
    return null;
  }

  // Arm ONLY when a "load more posts" pill is clicked, identified by its LABEL — so it works whether
  // X renders the pill as a <button> or an <a> (X A/B-tests this). Everything else (Home, nav, the X
  // logo, a tweet, Like/Repost, ...) never matches, so it's never armed and your scroll is never
  // touched. Labels are English; add locales here as needed.
  var PILL_RE = /^(show\s+([\d,]+|more)\s+posts?|see\s+new\s+posts?)$/i;
  function onClick(e) {
    if (!onHome()) return;
    var t = e && e.target;
    if (!t || !t.closest) return;
    var el = t.closest('[role="button"], button, a');
    if (!el || !PILL_RE.test((el.textContent || '').trim())) return;
    var a = pickAnchor();
    if (a) { anchor = a; armedUntil = nowMs() + ARM_MS; ensureRepin(); }
  }

  // If you scroll yourself while armed-and-waiting (scrollbar / wheel / keys), you've moved on —
  // disarm so a later load doesn't snap you back. (Our restores and X's scrolls are flagged and
  // ignored here, so they never look like a user scroll.)
  function onScroll() {
    if (!isArmed() && !inDefend()) return;
    var t = nowMs();
    if (t < selfScrollUntil || t < xScrollUntil) return; // our restore, or X's scroll — not the user
    armedUntil = 0;
    defendUntil = 0;
    anchor = null;
  }

  function applyScrollTo(target) {
    selfScrollUntil = nowMs() + 150;
    var se = scrollEl();
    se.scrollTop = target;
    anchor.baseScrollTop = se.scrollTop;
    anchor.baseScrollHeight = lastScrollHeight;
    defendUntil = nowMs() + DEFEND_MS;
  }

  // Active only while armed/defending after a click; otherwise fully passive.
  function compensate() {
    var se = scrollEl();
    var sh = se.scrollHeight;
    var growth = sh - lastScrollHeight;
    lastScrollHeight = sh;

    if (!anchor || !onHome() || (!isArmed() && !inDefend())) return;

    // Re-pin the anchor. Runs on cell add/remove (cellObserver) AND on a short timer while armed,
    // so late media that grows a post above you in place (no add/remove) is caught too.
    var cell = findCellById(anchor.id);
    if (cell) {
      var delta = cell.getBoundingClientRect().top - anchor.savedTop;
      if (Math.abs(delta) > 0.5) applyScrollTo(se.scrollTop + delta);
    } else if (growth > 0) {
      // Anchor virtualized away by a large prepend. Absolute restore (correct even after X
      // has already scrolled the page away).
      applyScrollTo(anchor.baseScrollTop + (sh - anchor.baseScrollHeight));
    }
  }

  // While armed, re-pin on a timer (not just on DOM add/remove) so in-place media height growth
  // above the anchor is corrected. Self-stops when no longer armed/defending.
  function ensureRepin() {
    if (repinTimer) return;
    repinTimer = setInterval(function () {
      if (!isArmed() && !inDefend()) { clearInterval(repinTimer); repinTimer = null; return; }
      compensate();
    }, 120);
  }

  function attach(c) {
    if (cellObserver) cellObserver.disconnect();
    container = c;
    lastScrollHeight = scrollEl().scrollHeight;
    cellObserver = new MutationObserver(compensate);
    cellObserver.observe(container, { childList: true });
  }

  function ensureAttached() {
    var c = findContainer();
    if (c && c !== container) attach(c);
  }

  function queueReattach() {
    if (reattachQueued) return;
    reattachQueued = true;
    setTimeout(function () { reattachQueued = false; ensureAttached(); }, 0);
  }

  // Suppress X's programmatic scroll-to-newest only while we're actively restoring (defend window).
  function installScrollGuards() {
    var natScrollTo = window.scrollTo.bind(window);
    var natScrollBy = window.scrollBy.bind(window);
    window.scrollTo = function () { if (inDefend()) return; xScrollUntil = nowMs() + 150; return natScrollTo.apply(window, arguments); };
    window.scrollBy = function () { if (inDefend()) return; xScrollUntil = nowMs() + 150; return natScrollBy.apply(window, arguments); };
  }

  function start() {
    if (started) return;
    started = true;
    installScrollGuards();
    document.addEventListener('click', onClick, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    ensureAttached();
    if (bodyObserver) bodyObserver.disconnect();
    bodyObserver = new MutationObserver(queueReattach);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    // Test-only: let the offline harness fully reset state between cases.
    if (window.__xnsTest === true) {
      window.__xnsReset = function () {
        anchor = null; armedUntil = 0; defendUntil = 0;
        selfScrollUntil = 0; xScrollUntil = 0;
        lastScrollHeight = scrollEl().scrollHeight;
        if (repinTimer) { clearInterval(repinTimer); repinTimer = null; }
      };
    }
  }

  function isXHome() {
    var h = location.hostname;
    var onX = h === 'x.com' || h === 'twitter.com' ||
              h === 'mobile.x.com' || h === 'mobile.twitter.com';
    return onX && location.pathname === '/home';
  }

  // Exposed so the offline harness can drive the engine on a non-X page.
  window.__xnsStart = start;

  if (isXHome()) start();
})();
