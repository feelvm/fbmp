# fbmp

Chromium extension that:
- Keeps Facebook limited to `Marketplace` and `Messages`
- Lets you save Marketplace listings
- Shows saved listings in a dropdown panel in the extension popup (title, price, and link)
- Detects discounted listings and stores both the original (before) and sale (after) price, shown with the original struck through
- Automatically removes saved listings that are no longer available

## Installation

This extension is loaded as an unpacked extension (Developer Mode).

1. Download or clone this repo locally.
2. Open your browser extension page:
   - Chrome / Brave / Arc: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable `Developer mode` (top-right).
4. Click `Load unpacked`.
5. Select the extension folder
6. Confirm the extension appears and is enabled.
7. (Optional) Pin it from the browser toolbar extensions menu.

## After Code Changes

1. Open your browser extension page again.
2. Find `Facebook Marketplace + Messages Only`.
3. Click `Reload` to apply local file changes.

## Use

1. Open Facebook and browse Marketplace.
2. On an item page (`/marketplace/item/...`), click:
   - Floating `Save Listing` button
   - or extension popup -> `Save Current Listing`
3. Open extension popup to view the saved listings dropdown panel.
4. Double-tap (or double-click) a listing title in the popup to rename it.
5. Use `link` to open the listing, or `Remove` to delete it from saved entries.
6. Click `Refresh Availability` to run an immediate check.

## Automatic Cleanup

- A background alarm runs every 30 minutes.
- Each saved listing URL is fetched.
- If the listing page indicates unavailability (or returns `404/410`), it is removed from saved entries.

## Data Persistence

The saved listings list survives extension removal, reload, and reinstall:

- Every change to the saved list is mirrored into `localStorage` of the
  `facebook.com` origin (key `fbmp_savedListingsBackup`), written by the
  content script. This storage belongs to Facebook, not to the extension, so
  the browser keeps it even after the extension is removed.
- Whenever a Facebook tab loads, the content script sends its mirrored copy
  to the background worker (`SYNC_WITH_HOST`). If the extension's own
  `chrome.storage.local` is empty — e.g. after a fresh install or reinstall —
  the list is restored from the mirror.
- If the extension's storage still has data, it is treated as authoritative
  and the mirror is overwritten with it, so removing listings in the popup is
  never undone by a stale mirror.
- The mirror is written as `{ version, savedAt, listings }`; legacy plain
  arrays are also accepted when restoring.

Note: the restore happens the first time a Facebook tab is opened after
reinstalling (the extension also reloads open Facebook tabs on install), so
the popup will show the saved list again once that sync has run.

## Discounted Prices

- On listings showing a discount, the original price is detected via
  elements with a strikethrough style (or an explicit "original price"
  label) and stored alongside the sale price as `originalPrice`.
- The popup renders the original price struck through, followed by the
  discounted price.
- An original price is only kept when it parses to a value strictly higher
  than the sale price, so plain listings never show a phantom "before" price.

## Notes

- Facebook is a dynamic SPA; route and UI structure can change.
- This extension currently enforces allowlisted routes by redirecting non-allowed pages to Marketplace.
