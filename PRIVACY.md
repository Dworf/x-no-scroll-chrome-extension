# Privacy Policy — X No-Scroll

_Last updated: 2026-06-11_

**X No-Scroll** ("the extension") keeps your scroll position fixed on the X (formerly Twitter) home
timeline when new posts load.

## Data collection

The extension **does not collect, transmit, sell, or share any personal or browsing data**. It
contains no analytics, no tracking, no accounts, no remote servers, and makes no network requests of
its own.

The **only** thing it stores is a single on/off preference — whether to show the ✕ that dismisses
X's "See new posts" pill. This is saved with Chrome's `storage` API (Chrome may sync it to your own
Google account if you have Chrome Sync enabled). It is just your setting; it is never sent to us or
any third party.

## How it works

All processing happens **locally in your browser**. To keep your place, the extension reads only the
on-screen position of posts in the X home timeline (and adjusts the page's scroll position). It does
**not** read, store, or transmit the content of posts, your account information, your browsing
history, or any other information.

## Permissions

The extension requests only the **`storage`** permission (to remember the one on/off preference
above) and **no host permissions** beyond running its content scripts on `x.com` / `twitter.com`
(home timeline only). It has no background service worker and no popup.

## Changes

If this policy ever changes, the updated version will be posted at this URL with a new "last updated"
date.

## Contact

Questions or concerns? Open an issue:
<https://github.com/Dworf/x-no-scroll-chrome-extension/issues>
