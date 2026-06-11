// Options page logic — a single setting, persisted to chrome.storage.sync (default ON).
// Runs in the extension context, so chrome.storage is available here (unlike content.js's MAIN world).

(function () {
  'use strict';

  var box = document.getElementById('showDismissX');
  var saved = document.getElementById('saved');
  var savedTimer = null;

  // Load current value (default ON).
  chrome.storage.sync.get({ showDismissX: true }, function (items) {
    box.checked = items.showDismissX !== false;
  });

  function flashSaved() {
    saved.classList.add('show');
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { saved.classList.remove('show'); }, 1200);
  }

  box.addEventListener('change', function () {
    chrome.storage.sync.set({ showDismissX: box.checked }, flashSaved);
  });
})();
