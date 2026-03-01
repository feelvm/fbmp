# fbmp

Chromium extension that:
- Keeps Facebook limited to `Marketplace` and `Messages`
- Lets you save Marketplace listings
- Shows saved listings in a dropdown panel in the extension popup (title, price, and link)
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

## Notes

- Facebook is a dynamic SPA; route and UI structure can change.
- This extension currently enforces allowlisted routes by redirecting non-allowed pages to Marketplace.
