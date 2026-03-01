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
  "search results",
  "results",
  "marketplace search results",
  "marketplace - search results",
  "search",
  "facebook marketplace listing",
  "marketplace listing",
  "messenger"
]);
const KNOWN_CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "UAH",
  "TRY",
  "ILS",
  "AED",
  "SAR",
  "QAR",
  "INR",
  "CNY",
  "JPY",
  "KRW",
  "HKD",
  "SGD",
  "MYR",
  "THB",
  "VND",
  "IDR",
  "PHP",
  "TWD",
  "ZAR",
  "BRL",
  "MXN",
  "ARS",
  "CLP",
  "COP",
  "PEN"
];
const CURRENCY_CODES_RE_PART = KNOWN_CURRENCY_CODES.join("|");
const PRICE_WITH_SYMBOL_RE = /([$€£])\s?\d[\d\s.,]*(?:[.,]\d{1,2})?/;
const PRICE_WITH_CODE_PREFIX_RE = new RegExp(
  `\\b(?:${CURRENCY_CODES_RE_PART})\\s?\\d[\\d\\s.,]*(?:[.,]\\d{1,2})?\\b`,
  "i"
);
const PRICE_WITH_CODE_SUFFIX_RE = new RegExp(
  `\\b\\d[\\d\\s.,]*(?:[.,]\\d{1,2})?\\s?(?:${CURRENCY_CODES_RE_PART})\\b`,
  "i"
);
const PRICE_WITH_LOCAL_PREFIX_RE = /\b(?:K[cč]|Ft|kr|lei|ron|zl)\s?\d[\d\s.,]*(?:[.,]\d{1,2})?\b/iu;
const PRICE_WITH_LOCAL_SUFFIX_RE = /\b\d[\d\s.,]*(?:[.,]\d{1,2})?\s?(?:K[cč]|Ft|kr|lei|ron|zl)\b/iu;
const PRICE_WITH_GENERIC_CODE_PREFIX_RE = /\b[A-Z]{2,4}\s?\d{2,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\b/;
const PRICE_WITH_GENERIC_CODE_SUFFIX_RE = /\b\d{2,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\s?[A-Z]{2,4}\b/;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await reloadFacebookTabs();
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

async function reloadFacebookTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://www.facebook.com/*", "https://m.facebook.com/*"]
    });

    for (const tab of tabs) {
      if (!tab.id) {
        continue;
      }
      try {
        await chrome.tabs.reload(tab.id);
      } catch (_error) {
        // Ignore individual tab reload failures.
      }
    }
  } catch (_error) {
    // Ignore query failures.
  }
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
  const providedPrice = sanitizePrice(payload?.price);
  const now = new Date().toISOString();

  const listings = await getListings();
  const existingIndex = listings.findIndex((item) => item.id === listingId);
  const existing = existingIndex >= 0 ? listings[existingIndex] : null;

  const fetchedDetails =
    providedTitle && providedPrice
      ? { title: null, price: null }
      : await fetchListingDetails(normalizedUrl);
  const fetchedTitle = fetchedDetails.title;
  const fetchedPrice = fetchedDetails.price;
  const resolvedTitle = providedTitle || fetchedTitle || `Marketplace Listing ${listingId}`;
  const resolvedPrice = providedPrice || fetchedPrice || existing?.price || null;

  const title = existing?.titleEdited ? existing.title : resolvedTitle;

  const nextEntry = {
    id: listingId,
    title,
    price: resolvedPrice,
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

    let nextPrice = listing.price || null;
    if (!nextPrice) {
      const details = await fetchListingDetails(listing.url);
      nextPrice = details.price || null;
    }

    next.push({
      ...listing,
      price: nextPrice,
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
  const normalized = normalizeSearchText(input);
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
  if (lower.includes("search results")) {
    return null;
  }
  if (lower === "marketplace" || lower === "facebook marketplace") {
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

async function fetchListingDetails(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });

    if (!response.ok) {
      return { title: null, price: null };
    }

    const html = await response.text();
    const ogTitle = findMetaContent(html, "og:title");
    const titleTag = findTitleTag(html);
    const h1Titles = findH1Tags(html);
    let title = sanitizeTitle(ogTitle) || sanitizeTitle(titleTag);
    if (!title) {
      for (const h1Title of h1Titles) {
        title = sanitizeTitle(h1Title);
        if (title) {
          break;
        }
      }
    }

    const priceAmount = findMetaContent(html, "product:price:amount");
    const priceCurrency = findMetaContent(html, "product:price:currency");
    const metaPrice = normalizePriceCandidate(priceAmount, priceCurrency);
    const ogDescriptionPrice = extractPriceFromText(findMetaContent(html, "og:description"));
    const titlePrice = extractPriceFromText(titleTag);
    const price = sanitizePrice(metaPrice || ogDescriptionPrice || titlePrice);

    return { title, price };
  } catch (_error) {
    return { title: null, price: null };
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

function findH1Tags(html) {
  const matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  const results = [];

  for (const match of matches) {
    const inner = match.replace(/^<h1[^>]*>/i, "").replace(/<\/h1>$/i, "");
    const withoutTags = inner.replace(/<[^>]+>/g, " ");
    const decoded = decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
    if (decoded) {
      results.push(decoded);
    }
  }

  return results;
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

function sanitizePrice(input) {
  const normalized = normalizeSearchText(input);
  if (!normalized) {
    return null;
  }

  return extractPriceFromText(normalized) || normalizePriceCandidate(normalized) || null;
}

function normalizePriceCandidate(priceValue, currencyCode) {
  const raw = normalizeSearchText(priceValue);
  if (!raw) {
    return null;
  }

  if (/^free$/i.test(raw)) {
    return "Free";
  }

  const symbolMatch = raw.match(PRICE_WITH_SYMBOL_RE);
  if (symbolMatch?.[0]) {
    return standardizePriceString(symbolMatch[0]);
  }

  const numeric = raw.match(/^\d[\d\s,]*(?:[.,]\d{1,2})?$/);
  if (numeric) {
    const amount = Number(raw.replace(/[,\s]/g, ""));
    const currency = String(currencyCode || "").toUpperCase();
    if (Number.isFinite(amount) && currency) {
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          maximumFractionDigits: 2
        }).format(amount);
      } catch (_error) {
        return `${currency} ${raw}`;
      }
    }
  }

  const codedPrefix = raw.match(PRICE_WITH_CODE_PREFIX_RE);
  if (codedPrefix?.[0]) {
    return standardizePriceString(codedPrefix[0]);
  }

  const codedSuffix = raw.match(PRICE_WITH_CODE_SUFFIX_RE);
  if (codedSuffix?.[0]) {
    return standardizePriceString(codedSuffix[0]);
  }

  const localPrefix = raw.match(PRICE_WITH_LOCAL_PREFIX_RE);
  if (localPrefix?.[0]) {
    return standardizePriceString(localPrefix[0]);
  }

  const localSuffix = raw.match(PRICE_WITH_LOCAL_SUFFIX_RE);
  if (localSuffix?.[0]) {
    return standardizePriceString(localSuffix[0]);
  }

  const genericPrefix = raw.match(PRICE_WITH_GENERIC_CODE_PREFIX_RE);
  if (genericPrefix?.[0]) {
    return standardizePriceString(genericPrefix[0]);
  }

  const genericSuffix = raw.match(PRICE_WITH_GENERIC_CODE_SUFFIX_RE);
  if (genericSuffix?.[0]) {
    return standardizePriceString(genericSuffix[0]);
  }

  return null;
}

function extractPriceFromText(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return null;
  }

  const direct = normalized.match(PRICE_WITH_SYMBOL_RE);
  if (direct?.[0]) {
    return standardizePriceString(direct[0]);
  }

  const codedPrefix = normalized.match(PRICE_WITH_CODE_PREFIX_RE);
  if (codedPrefix?.[0]) {
    return standardizePriceString(codedPrefix[0]);
  }

  const codedSuffix = normalized.match(PRICE_WITH_CODE_SUFFIX_RE);
  if (codedSuffix?.[0]) {
    return standardizePriceString(codedSuffix[0]);
  }

  const localPrefix = normalized.match(PRICE_WITH_LOCAL_PREFIX_RE);
  if (localPrefix?.[0]) {
    return standardizePriceString(localPrefix[0]);
  }

  const localSuffix = normalized.match(PRICE_WITH_LOCAL_SUFFIX_RE);
  if (localSuffix?.[0]) {
    return standardizePriceString(localSuffix[0]);
  }

  const genericPrefix = normalized.match(PRICE_WITH_GENERIC_CODE_PREFIX_RE);
  if (genericPrefix?.[0]) {
    return standardizePriceString(genericPrefix[0]);
  }

  const genericSuffix = normalized.match(PRICE_WITH_GENERIC_CODE_SUFFIX_RE);
  if (genericSuffix?.[0]) {
    return standardizePriceString(genericSuffix[0]);
  }

  if (/\bfree\b/i.test(normalized)) {
    return "Free";
  }

  return null;
}

function standardizePriceString(value) {
  return normalizeSearchText(value)
    .replace(/\s+/g, " ")
    .replace(/([A-Z]{2,4})(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z]{2,4})/g, "$1 $2")
    .replace(/([$€£])\s+/g, "$1")
    .replace(/\b([Kk])\s*([cč])\b/gu, "$1$2")
    .trim();
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
