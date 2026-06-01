# X No-Scroll — keep your place

A tiny Chrome extension that **keeps your scroll position fixed** when X (Twitter) loads new
posts above your current view — for example when you click the **"Show N posts"** / **"See new
posts"** pill at the top of the home timeline.

When you click that pill, X loads the new posts **and scrolls you up to the newest one** (its
`scrollToNewest`), so the post you were reading jumps away and you lose your place. This extension
stops that: the post you were looking at stays put, and the new posts appear *above* it (scroll up
to read them) — whether you're working up the feed or scrolling down through it.

It also covers the inline **"Show more posts"** gap button. It recognizes the load pills by their
**label** ("Show N posts" / "Show more posts" / "See new posts"), so it arms **only** on those —
never on Home, other nav, tweets, or buttons like Like. (Labels are currently English; other locales
can be added in `src/content.js`.)

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`x-no-scroll-chrome-extension`).
4. Open [x.com/home](https://x.com/home). That's it — it's always on, no settings.

Works in normal Chrome windows and in "open in app" / installed-PWA windows.

## How it works

Two things make you lose your place when a pill loads posts (both verified by inspecting X live):

1. X's timeline is a *virtualized* list — posts are absolutely-positioned cells
   (`transform: translateY(...)`) inside a fixed-height container, and off-screen posts are
   unmounted — which defeats the browser's native scroll anchoring.
2. More importantly, X **deliberately scrolls you to the top**: clicking the top "Show N posts" /
   "See new posts" pill calls X's `scrollToNewest()` → `window.scrollTo(0)` + `window.scrollBy(...)`.

`src/content.js` is **event-driven and passive by default** — it does nothing while you read,
scroll, or drag the scrollbar, so it can never cause a stray jump. It acts only in a short window
after a click:

1. **When you click a recognized load pill** ("Show N posts" / "Show more posts" / "See new posts",
   matched by its **label** — so it works whether X renders the pill as a `<button>` or an `<a>`), it
   remembers the **anchor** — the topmost in-view post (status id + on-screen offset) — and arms for a
   few seconds. Home, nav, tweets, and other buttons never match, so they're never touched.
2. **If a load arrives while armed**, a `MutationObserver` restores the anchor to exactly where it
   was (re-pinning across chunked loads), and X's `window.scrollTo` / `window.scrollBy` (its
   scroll-to-newest) are suppressed so X can't undo it. We move via `element.scrollTop` while X moves
   via `window.scrollTo`/`scrollBy` — a clean seam, so our scroll and X's never get confused. If a big
   prepend unmounts the anchor, it restores by the height the feed grew (an absolute target, correct
   even after X has already scrolled the page).
3. **If you scroll yourself** while armed, it disarms — you've moved on.

Because it intercepts X's own scroll call, the extension runs in the page's **MAIN world** (see
`manifest.json`); an isolated content script can't override the `window.scrollTo` that X's code calls.

## Testing

`test/harness.html` is an offline mock of X's virtualized timeline (window-scroll, `cellInnerDiv`
cells with `translateY`, off-screen unmounting, and a simulated `scrollToNewest`). It runs automated
assertions for: small/large/slow prepends, anchor-unmount self-heal, below-fold gating, surviving
`scrollToNewest` (including **while slightly scrolled**), **passivity with no click** (scrollbar drag
must not jump), and **disarming** when you scroll after a click.

```sh
# from this folder
python3 -m http.server 8753
# then open http://localhost:8753/test/harness.html in a FOCUSED window — the panel shows pass/fail.
# (Run it in a foreground tab; background tabs throttle timers and skew the timing-sensitive cases.)
```

## Scope

Home timeline only (`x.com/home`, `twitter.com/home`). Always on; no UI.

## Versions

### v0.1.2
- **Fix:** arms **only** on the load pills, matched by label ("Show N posts" / "Show more posts" /
  "See new posts"), instead of on any non-link click. This is more precise — Home, nav, tweets, and
  other buttons are never touched — and it works whether X renders a pill as a `<button>` or an
  `<a>` (it A/B-tests this).
- **Fix:** hold your post even when a newly-loaded post above it grows *after* loading (a late image
  or embed). Previously we only reacted to posts being added/removed, so in-place height growth could
  let small loads drift your post down (e.g. "Show 1 post" with a media tweet). We now re-pin on a
  short timer while armed, catching that.

### v0.1.1
- **Fix:** clicking the **Home** tab (or any nav link) no longer drags you back to your previous
  spot. The engine now ignores clicks on links (`<a>`) and only arms on the load-pill *buttons*, so
  Home's scroll-to-top works normally.

### v0.1.0 — first release
- Keeps your place when X loads new posts above you ("Show N posts" / "See new posts" / inline
  "Show more posts").
- **Event-driven and passive by default:** only acts in a short window after a click, so normal
  reading, scrolling, and scrollbar dragging are never touched.
- Suppresses X's `scrollToNewest` and restores your anchored post — precise when the post stays
  rendered, with a self-heal restore for big/chunked loads that virtualize it away.
- Runs in the page MAIN world; home timeline only; no UI, no settings, **no data collected**.
- Offline test harness (`test/harness.html`) covering prepends, self-heal, gating, passivity,
  disarming, and `scrollToNewest`.

## Contributing

Contributions and bug reports are welcome. It's a small, single-file extension with **no build
step** — the whole engine is `src/content.js` (dependency-free vanilla JS).

- Before changing behavior, run the offline test harness (`test/harness.html`) in a **focused**
  browser tab and keep it green — see [Testing](#testing).
- Found a case where it loses your place or fights your scrolling? Open an issue with the steps:
  which button you clicked and roughly where you were scrolled.
- For larger changes, please open an issue to discuss first.

## Acknowledgements

- Built as a [Manifest V3](https://developer.chrome.com/docs/extensions/develop) content script for
  **Google Chrome**.
- Operates on the **X** (formerly Twitter) web app.
- No third-party libraries — plain vanilla JavaScript.

**Not affiliated with, endorsed by, or sponsored by X Corp or Google LLC.** "X" and "Twitter" are
trademarks of X Corp; "Google Chrome" is a trademark of Google LLC. This is an independent,
unofficial project.

## License

MIT — see [LICENSE](LICENSE).
