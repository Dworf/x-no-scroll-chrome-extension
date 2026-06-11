// x-no-scroll settings bridge (runs in the ISOLATED world).
//
// content.js runs in the page's MAIN world (it has to, to override window.scrollTo), and the MAIN
// world has NO access to chrome.storage. This tiny isolated-world script is the seam: it reads the
// user's options from chrome.storage and hands them to the MAIN script.
//
// Channel: a plain attribute on <html> (data-xns-dismiss-x = "1"|"0") plus an "xns:settings" notify
// event. An attribute is plain shared DOM, so it crosses the world boundary cleanly (unlike a
// CustomEvent detail, which can get nulled between worlds). The MAIN script reads the attribute.

(function () {
  'use strict';

  var ATTR = 'data-xns-dismiss-x';

  function apply(on) {
    var root = document.documentElement;
    if (!root) return;
    root.setAttribute(ATTR, on ? '1' : '0');
    // Notify the MAIN script that the setting changed (it re-reads the attribute).
    document.dispatchEvent(new Event('xns:settings'));
  }

  function readAndApply() {
    try {
      // Default ON: a missing/unset value reads as true.
      chrome.storage.sync.get({ showDismissX: true }, function (items) {
        if (chrome.runtime && chrome.runtime.lastError) { apply(true); return; }
        apply(items.showDismissX !== false);
      });
    } catch (e) {
      apply(true); // storage unavailable for any reason -> keep the default (on)
    }
  }

  // Initial push (document_start -> <html> exists; content.js, at document_idle, reads it later).
  readAndApply();

  // The MAIN script asks for settings on startup, in case it loaded before our initial push.
  document.addEventListener('xns:request-settings', readAndApply);

  // Live updates: toggling the option takes effect without a page reload.
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes.showDismissX) {
        apply(changes.showDismissX.newValue !== false);
      }
    });
  } catch (e) {}
})();
