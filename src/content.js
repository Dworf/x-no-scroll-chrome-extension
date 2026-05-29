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
//   1. Track an ANCHOR = the topmost in-view tweet (status id + on-screen offset),
//      updated only while YOU scroll.
//   2. On every DOM insertion (MutationObserver, before paint -> no flicker/timers):
//        - anchor still mounted -> scrollTop += (rect.top - savedTop)     (precise)
//        - anchor unmounted     -> scrollTop += scrollHeight growth        (big-prepend self-heal)
//      We move via element.scrollTop; X moves via window.scrollTo/scrollBy — a clean seam.
//   3. When we make a correction we open a short "defend window" during which X's
//      window.scrollTo / window.scrollBy (its scroll-to-newest) are suppressed, so X
//      can't undo us. (Requires running in the page's MAIN world — see manifest.)
//   4. Any real user gesture (wheel / touch / nav keys) ends the defend window and
//      re-anchors, so we never fight the user.
//
// See test/harness.html for the executable spec.

(function () {
  'use strict';

  var CELL = '[data-testid="cellInnerDiv"]';
  var HEADER_OFFSET = 56;   // sticky top bar; "in view" means below this
  var DEFEND_MS = 1000;     // how long to suppress X's scroll-to-newest after a correction

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
  var anchor = null;          // { id, savedTop, baseScrollTop }
  var correcting = false;     // true while applying our own scroll
  var defendUntil = 0;        // suppress X's programmatic scroll until this time
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
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var id = statusIdOf(c);
      if (!id) continue; // skip spacers / non-tweet cells
      var r = c.getBoundingClientRect();
      if (r.bottom > HEADER_OFFSET + 1 && r.top < bestTop) {
        bestTop = r.top;
        best = { id: id, savedTop: r.top, baseScrollTop: scrollEl().scrollTop };
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

  function clearCorrectingSoon() {
    // Not rAF: rAF is paused in background tabs; a timer always fires.
    setTimeout(function () { correcting = false; }, 0);
  }

  function applyScroll(delta) {
    correcting = true;
    scrollEl().scrollTop += delta;
    anchor.baseScrollTop = scrollEl().scrollTop;
    defendUntil = nowMs() + DEFEND_MS; // suppress X's scroll-to-newest that follows
    clearCorrectingSoon();
  }

  // Captured only on genuine user scroll.
  function onScroll() {
    if (correcting || inDefend()) return;
    var a = pickAnchor();
    if (a) anchor = a;
  }

  // A real user gesture overrides everything: stop defending, re-anchor to where they are.
  function onUserGesture() {
    defendUntil = 0;
    correcting = false;
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

    // If scrollTop moved since capture and we're NOT defending, the user scrolled — re-anchor.
    if (!inDefend() && Math.abs(se.scrollTop - anchor.baseScrollTop) > 0.5) {
      anchor = pickAnchor();
      return;
    }

    var cell = findCellById(anchor.id);
    if (cell) {
      var delta = cell.getBoundingClientRect().top - anchor.savedTop;
      if (Math.abs(delta) > 0.5) applyScroll(delta);
    } else if (growth > 0) {
      // Anchor virtualized away by a large prepend above the viewport.
      applyScroll(growth);
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
    window.addEventListener('scroll', onScroll, { passive: true });
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
