// x-no-scroll — keeps your scroll position fixed when X/Twitter inserts posts above you.
//
// WHAT X DOES (verified live, 2026-05-29):
//   X's home timeline is a virtualized list: posts are absolutely-positioned
//   [data-testid="cellInnerDiv"] cells (transform: translateY(...)) inside a fixed-height
//   container, and off-screen cells are unmounted. When you click a "Show N posts" /
//   "Show more posts" pill, X PREPENDS the posts above you AND calls scrollToNewest()
//   -> window.scrollTo(0) + window.scrollBy(...), deliberately yanking you to the top.
//   That scroll-to-newest is the main thing that makes you lose your place.
//
// HOW WE FIX IT:
//   1. Track an ANCHOR = the topmost in-view tweet (status id + on-screen offset + the
//      scrollTop/scrollHeight at capture), updated ONLY on a real user gesture.
//   2. On every DOM mutation (MutationObserver, before paint -> no flicker/timers), if the
//      feed GREW (content inserted) — or we're mid-load — hold the anchor:
//        - anchor still mounted -> scrollTop += (rect.top - savedTop)        (precise)
//        - anchor unmounted     -> scrollTop  = base + (scrollHeight growth) (self-heal,
//          an ABSOLUTE target so it's correct even after X already scrolled away)
//      We never use "scrollTop changed" to detect a user scroll, because X changes scrollTop
//      too; content insertion is detected by scrollHeight growth instead.
//   3. When we make a correction we open a short "defend window" during which X's
//      window.scrollTo / window.scrollBy (its scroll-to-newest) are suppressed, so X can't
//      undo us. (Requires running in the page's MAIN world — see manifest.)
//   4. Any real user gesture (wheel / touch / nav keys) ends the defend window and re-anchors,
//      so we never fight the user. Timers (not rAF) are used so it works in background tabs.
//
// See test/harness.html for the executable spec.

(function () {
  'use strict';

  var CELL = '[data-testid="cellInnerDiv"]';
  var HEADER_OFFSET = 56;   // sticky top bar; "in view" means below this
  var DEFEND_MS = 1000;     // suppress X's scroll-to-newest for this long after a correction

  function scrollEl() { return document.scrollingElement || document.documentElement; }
  function nowMs() { return Date.now(); }

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
  var anchor = null;          // { id, savedTop, baseScrollTop, baseScrollHeight }
  var defendUntil = 0;
  var lastScrollHeight = 0;
  var container = null;
  var cellObserver = null;
  var bodyObserver = null;
  var reattachQueued = false;
  var started = false;

  function inDefend() { return nowMs() < defendUntil; }

  function pickAnchor() {
    var cells = document.querySelectorAll(CELL);
    var best = null, bestTop = Infinity;
    var se = scrollEl();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var id = statusIdOf(c);
      if (!id) continue; // skip spacers / non-tweet cells
      var r = c.getBoundingClientRect();
      if (r.bottom > HEADER_OFFSET + 1 && r.top < bestTop) {
        bestTop = r.top;
        best = { id: id, savedTop: r.top, baseScrollTop: se.scrollTop, baseScrollHeight: se.scrollHeight };
      }
    }
    return best;
  }

  function findCellById(id) {
    var cells = document.querySelectorAll(CELL);
    for (var i = 0; i < cells.length; i++) {
      if (statusIdOf(cells[i]) === id) return cells[i];
    }
    return null;
  }

  function applyScrollTo(target) {
    var se = scrollEl();
    se.scrollTop = target;
    // Re-baseline so chunked loads accumulate correctly and a later self-heal stays exact.
    anchor.baseScrollTop = se.scrollTop;
    anchor.baseScrollHeight = lastScrollHeight;
    defendUntil = nowMs() + DEFEND_MS; // suppress X's scroll-to-newest that follows
  }

  // A real user gesture overrides everything: stop defending, re-anchor to where they are.
  function onUserGesture() {
    defendUntil = 0;
    var a = pickAnchor();
    if (a) anchor = a;
  }

  // Runs inside the MutationObserver callback (before paint).
  function compensate() {
    var se = scrollEl();
    var sh = se.scrollHeight;
    var growth = sh - lastScrollHeight;
    lastScrollHeight = sh;

    if (!anchor) { anchor = pickAnchor(); return; }

    // Only act on content insertion (scrollHeight grew) or while actively defending a load.
    // A bare scrollTop change is NOT treated as a user scroll here — X changes scrollTop too;
    // genuine user scrolls re-anchor via onUserGesture.
    if (growth > 0 || inDefend()) {
      var cell = findCellById(anchor.id);
      if (cell) {
        var delta = cell.getBoundingClientRect().top - anchor.savedTop;
        if (Math.abs(delta) > 0.5) applyScrollTo(se.scrollTop + delta);
      } else if (growth > 0) {
        // Anchor virtualized away by a large prepend. Absolute restore: put the anchor back
        // where it was even if X has since scrolled the page.
        applyScrollTo(anchor.baseScrollTop + (sh - anchor.baseScrollHeight));
      }
    }
  }

  function attach(c) {
    if (cellObserver) cellObserver.disconnect();
    container = c;
    lastScrollHeight = scrollEl().scrollHeight;
    anchor = pickAnchor();
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

  // Intercept X's programmatic scroll-to-newest during the defend window.
  function installScrollGuards() {
    var natScrollTo = window.scrollTo.bind(window);
    var natScrollBy = window.scrollBy.bind(window);
    window.scrollTo = function () { if (inDefend()) return; return natScrollTo.apply(window, arguments); };
    window.scrollBy = function () { if (inDefend()) return; return natScrollBy.apply(window, arguments); };
  }

  function start() {
    if (started) return;
    started = true;
    installScrollGuards();
    // Re-anchor ONLY on genuine user input (never on X's programmatic scrolls).
    window.addEventListener('wheel', onUserGesture, { passive: true });
    window.addEventListener('touchmove', onUserGesture, { passive: true });
    window.addEventListener('keydown', function (e) {
      if (e.key && /^(Arrow|Page|Home|End| |Spacebar)/.test(e.key)) onUserGesture();
    }, true);
    ensureAttached();
    if (bodyObserver) bodyObserver.disconnect();
    bodyObserver = new MutationObserver(queueReattach);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
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
