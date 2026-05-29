# X No-Scroll — keep your place

A tiny Chrome extension that **keeps your scroll position fixed** when X (Twitter) loads new
posts above your current view — when you click the **"Show N posts"** pill at the top, an inline
**"Show more posts"** gap button, or any background load.

Normally those loads insert posts *above* you and leave your scroll position untouched, so the
content you were reading slides down and you lose your place. This extension re-pins it: the post
you were looking at stays exactly where it is, and the new posts appear above it (scroll up to read
them) — works whether you're reading up the feed or scrolling down through it.

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
2. More importantly, X **deliberately scrolls you to the top**: clicking a pill calls X's
   `scrollToNewest()` → `window.scrollTo(0)` + `window.scrollBy(...)`.

`src/content.js` handles both:

- Tracks an **anchor** — the topmost in-view post (its status id + on-screen offset) — updated only
  while *you* scroll.
- On every DOM insertion, inside a `MutationObserver` callback (which runs **before the browser
  paints**, so there's no flicker and no timers):
  - if the anchor is still mounted, it nudges `scrollTop` so the anchor returns to its exact spot;
  - if a large prepend pushed the anchor out of the render window, it scrolls by the height the feed
    grew (the anchor then re-mounts near the top and precise tracking resumes).
  - We move via `element.scrollTop`; X moves via `window.scrollTo`/`scrollBy` — a clean seam.
- Right after a correction it opens a short **defend window** during which X's
  `window.scrollTo`/`scrollBy` (its scroll-to-newest) are suppressed, so X can't undo us. This is why
  the extension runs in the page's **MAIN world** (see `manifest.json`) — an isolated content script
  can't override the `window.scrollTo` that X's own code calls.
- Any real user gesture (wheel / touch / nav keys) ends the defend window and re-anchors, so it
  never fights your own scrolling.
- It re-pins on **every** mutation, so fast, slow, and chunked loads all behave identically.

No buttons are hooked and no text is matched, so it's resilient to X's redesigns and works in any
language.

## Testing

`test/harness.html` is an offline mock of X's virtualized timeline (window-scroll, `cellInnerDiv`
cells with `translateY`, off-screen unmounting). It runs automated assertions for small/large/slow
prepends, anchor-unmount self-heal, below-fold gating, and "doesn't fight normal scrolling".

```sh
# from this folder
python3 -m http.server 8753
# then open http://localhost:8753/test/harness.html — the panel shows pass/fail
```

## Scope

Home timeline only (`x.com/home`, `twitter.com/home`). Always on; no UI.

## License

MIT — see [LICENSE](LICENSE).
