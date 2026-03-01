const STORAGE_KEY = "savedListings";
const ALARM_NAME = "fbmp-availability-check";
const CHECK_INTERVAL_MINUTES = 30;

const UNAVAILABLE_MARKERS = [
  "this listing isn't available anymore",
  "this listing is no longer available",
  "listing isn't available",
  "item is unavailable",
  "no longer available"
];

const GENERIC_TITLES = new Set([
  "notification",
  "notifications",
  "facebook",
  "marketplace",
  "facebook marketplace listing",
  "marketplace listing",
  "messenger"
]);

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) {
    return;
  }

  await checkAllListings();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;

  (async () => {
    if (action === "ADD_LISTING") {
      const listing = await addListing(message?.payload);
      sendResponse({ ok: true, listing });
      return;
    }

    if (action === "REMOVE_LISTING") {
      await removeListing(message?.id);
      sendResponse({ ok: true });
      return;
    }

    if (action === "GET_LISTINGS") {
      const listings = await getListings();
      sendResponse({ ok: true, listings });
      return;
    }

    if (action === "UPDATE_LISTING_TITLE") {
      const listing = await updateListingTitle(message?.id, message?.title);
      sendResponse({ ok: true, listing });
      return;
    }

    if (action === "CHECK_LISTINGS_NOW") {
      const result = await checkAllListings();
      sendResponse({ ok: true, ...result });
      return;
    }

    sendResponse({ ok: false, error: "Unknown action." });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing) {
    return;
  }

  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_INTERVAL_MINUTES
  });
}

async function getListings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const listings = stored[STORAGE_KEY];
  return Array.isArray(listings) ? listings : [];
}

async function setListings(listings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: listings });
}

function normalizeListingUrl(url) {
  if (!url) {
    throw new Error("Missing listing URL.");
  }

  const parsed = new URL(url);
  if (!/(\.|^)facebook\.com$/i.test(parsed.hostname)) {
    throw new Error("Only facebook.com listing URLs are supported.");
  }

  if (!parsed.pathname.toLowerCase().includes("/marketplace/item/")) {
    throw new Error("Not a Marketplace item URL.");
  }

  return `https://www.facebook.com${parsed.pathname.replace(/\/+$/, "")}`;
}

function extractListingId(url) {
  const match = url.match(/\/marketplace\/item\/(\d+)/i);
  return match ? match[1] : null;
}

async function addListing(payload) {
  const normalizedUrl = normalizeListingUrl(payload?.url);
  const listingId = payload?.id || extractListingId(normalizedUrl) || normalizedUrl;
  const providedTitle = sanitizeTitle(payload?.title);
  const now = new Date().toISOString();

  const listings = await getListings();
  const existingIndex = listings.findIndex((item) => item.id === listingId);
  const existing = existingIndex >= 0 ? listings[existingIndex] : null;

  const fetchedTitle = providedTitle ? null : await fetchListingTitle(normalizedUrl);
  const resolvedTitle = providedTitle || fetchedTitle || `Marketplace Listing ${listingId}`;

  const title = existing?.titleEdited ? existing.title : resolvedTitle;

  const nextEntry = {
    id: listingId,
    title,
    url: normalizedUrl,
    titleEdited: existing?.titleEdited || false,
    savedAt: existingIndex >= 0 ? listings[existingIndex].savedAt : now,
    lastCheckedAt: existingIndex >= 0 ? listings[existingIndex].lastCheckedAt : null
  };

  if (existingIndex >= 0) {
    listings[existingIndex] = nextEntry;
  } else {
    listings.push(nextEntry);
  }

  await setListings(listings);
  return nextEntry;
}

async function removeListing(id) {
  if (!id) {
    return;
  }

  const listings = await getListings();
  const next = listings.filter((item) => item.id !== id);
  await setListings(next);
}

async function updateListingTitle(id, title) {
  if (!id) {
    throw new Error("Missing listing id.");
  }

  const nextTitle = sanitizeTitle(title);
  if (!nextTitle) {
    throw new Error("Title cannot be empty.");
  }

  const listings = await getListings();
  const index = listings.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new Error("Listing not found.");
  }

  listings[index] = {
    ...listings[index],
    title: nextTitle,
    titleEdited: true
  };

  await setListings(listings);
  return listings[index];
}

async function checkAllListings() {
  const listings = await getListings();
  if (!listings.length) {
    return { removed: 0, checked: 0 };
  }

  let removed = 0;
  const now = new Date().toISOString();
  const next = [];

  for (const listing of listings) {
    const isAvailable = await checkListingAvailability(listing.url);
    if (!isAvailable) {
      removed += 1;
      continue;
    }

    next.push({
      ...listing,
      lastCheckedAt: now
    });
  }

  await setListings(next);
  return { removed, checked: listings.length };
}

async function checkListingAvailability(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });

    if (response.status === 404 || response.status === 410) {
      return false;
    }

    if (!response.ok) {
      return true;
    }

    const body = (await response.text()).toLowerCase();
    return !UNAVAILABLE_MARKERS.some((marker) => body.includes(marker));
  } catch (_error) {
    return true;
  }
}

function sanitizeTitle(input) {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const cleaned = stripFacebookSuffix(normalized);
  const lower = cleaned.toLowerCase();
  if (GENERIC_TITLES.has(lower)) {
    return null;
  }
  if (lower.startsWith("notification")) {
    return null;
  }

  return cleaned;
}

function stripFacebookSuffix(title) {
  return title
    .replace(/\s*[|]\s*facebook\s*$/i, "")
    .replace(/\s*[-]\s*facebook\s*$/i, "")
    .trim();
}

async function fetchListingTitle(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const ogTitle = findMetaContent(html, "og:title");
    const titleTag = findTitleTag(html);
    return sanitizeTitle(ogTitle) || sanitizeTitle(titleTag);
  } catch (_error) {
    return null;
  }
}

function findMetaContent(html, propertyName) {
  const propEscaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directMatch = html.match(
    new RegExp(
      `<meta[^>]*property=["']${propEscaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    )
  );
  if (directMatch?.[1]) {
    return decodeHtmlEntities(directMatch[1]);
  }

  const reverseMatch = html.match(
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${propEscaped}["'][^>]*>`,
      "i"
    )
  );
  if (reverseMatch?.[1]) {
    return decodeHtmlEntities(reverseMatch[1]);
  }

  return null;
}

function findTitleTag(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return null;
  }
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
