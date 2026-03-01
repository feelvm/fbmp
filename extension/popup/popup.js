const saveCurrentButton = document.getElementById("save-current");
const checkNowButton = document.getElementById("check-now");
const statusEl = document.getElementById("status");
const listingListEl = document.getElementById("listing-list");
const emptyStateEl = document.getElementById("empty-state");
const savedSummaryEl = document.getElementById("saved-summary");

const DOUBLE_TAP_MS = 320;
const KNOWN_CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "UAH",
  "TRY",
  "INR",
  "CNY",
  "JPY",
  "KRW",
  "HKD",
  "SGD",
  "THB",
  "VND",
  "IDR",
  "PHP",
  "TWD",
  "ZAR",
  "BRL",
  "MXN"
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

init();

function init() {
  saveCurrentButton.addEventListener("click", onSaveCurrentClick);
  checkNowButton.addEventListener("click", onCheckNowClick);
  renderListings();
}

async function onSaveCurrentClick() {
  setStatus("Saving current listing...");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    setStatus("No active tab found.");
    return;
  }

  const isFacebook = /^https:\/\/(www|m)\.facebook\.com\//i.test(tab.url);
  if (!isFacebook) {
    setStatus("Open a Facebook Marketplace listing first.");
    return;
  }

  let listing = null;

  try {
    const infoResponse = await chrome.tabs.sendMessage(tab.id, { action: "GET_LISTING_INFO" });
    if (infoResponse?.ok) {
      listing = infoResponse.listing;
    }
  } catch (_error) {
    // Ignore, fallback runs below.
  }

  if (!listing && /\/marketplace\/item\/\d+/i.test(tab.url)) {
    const idMatch = tab.url.match(/\/marketplace\/item\/(\d+)/i);
    listing = {
      id: idMatch ? idMatch[1] : null,
      url: tab.url.split("?")[0],
      title: sanitizeFallbackTitle(tab.title) || "",
      price: extractPriceFromText(tab.title)
    };
  }

  if (!listing) {
    setStatus("This tab is not a Marketplace item listing.");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    action: "ADD_LISTING",
    payload: listing
  });

  if (!response?.ok) {
    setStatus(response?.error || "Could not save listing.");
    return;
  }

  const savedPrice = sanitizeUserPrice(response?.listing?.price || listing.price);
  setStatus(savedPrice ? `Listing saved. Price: ${savedPrice}` : "Listing saved. Price not found.");
  await renderListings();
}

async function onCheckNowClick() {
  setStatus("Checking saved listings...");
  const response = await chrome.runtime.sendMessage({ action: "CHECK_LISTINGS_NOW" });
  if (!response?.ok) {
    setStatus(response?.error || "Availability check failed.");
    return;
  }

  setStatus(`Checked ${response.checked}, removed ${response.removed}.`);
  await renderListings();
}

async function renderListings() {
  const response = await chrome.runtime.sendMessage({ action: "GET_LISTINGS" });
  const listings = response?.ok && Array.isArray(response.listings) ? response.listings : [];

  listings.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));

  listingListEl.innerHTML = "";
  savedSummaryEl.textContent = `Saved Listings (${listings.length})`;
  emptyStateEl.style.display = listings.length ? "none" : "block";

  for (const item of listings) {
    const li = document.createElement("li");
    li.className = "listing-item";

    const left = document.createElement("div");
    left.className = "listing-main";

    const title = document.createElement("p");
    title.className = "listing-title";
    title.textContent = displayTitle(item);
    title.title = "Double-tap to rename";
    wireTitleRename(title, item);

    const price = document.createElement("p");
    price.className = "listing-price";
    price.textContent = displayPrice(item);

    const link = document.createElement("a");
    link.className = "listing-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = "link";

    left.appendChild(title);
    left.appendChild(price);
    left.appendChild(link);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        action: "REMOVE_LISTING",
        id: item.id
      });
      await renderListings();
    });

    li.appendChild(left);
    li.appendChild(removeButton);
    listingListEl.appendChild(li);
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function displayTitle(item) {
  const title = sanitizeDisplayTitle(item?.title);
  if (title) {
    return title;
  }
  return item?.id ? `Marketplace Listing ${item.id}` : "Marketplace Listing";
}

function displayPrice(item) {
  const price = sanitizeUserPrice(item?.price);
  return price || "Price unavailable";
}

function sanitizeUserTitle(title) {
  const cleaned = String(title || "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function sanitizeFallbackTitle(title) {
  const cleaned = sanitizeDisplayTitle(title);
  if (!cleaned) {
    return null;
  }
  return cleaned;
}

function sanitizeDisplayTitle(title) {
  const cleaned = sanitizeUserTitle(title);
  if (!cleaned) {
    return null;
  }

  const lower = cleaned.toLowerCase();
  if (lower.includes("search results")) {
    return null;
  }
  if (lower === "search" || lower === "marketplace" || lower === "facebook") {
    return null;
  }
  if (lower.startsWith("notification")) {
    return null;
  }

  return cleaned;
}

function sanitizeUserPrice(price) {
  const cleaned = normalizeSearchText(price);
  return cleaned || null;
}

function extractPriceFromText(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return null;
  }

  const symbol = normalized.match(PRICE_WITH_SYMBOL_RE);
  if (symbol?.[0]) {
    return standardizePriceString(symbol[0]);
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

function wireTitleRename(titleEl, item) {
  let lastTouchAt = 0;

  const triggerEdit = () => {
    startTitleEdit(titleEl, item);
  };

  titleEl.addEventListener("dblclick", triggerEdit);
  titleEl.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") {
      return;
    }

    const now = Date.now();
    if (now - lastTouchAt <= DOUBLE_TAP_MS) {
      event.preventDefault();
      triggerEdit();
      lastTouchAt = 0;
      return;
    }

    lastTouchAt = now;
  });
}

function startTitleEdit(titleEl, item) {
  const currentTitle = displayTitle(item);
  const input = document.createElement("input");
  input.className = "title-edit";
  input.type = "text";
  input.value = currentTitle;
  input.maxLength = 180;

  const parent = titleEl.parentElement;
  if (!parent) {
    return;
  }

  parent.replaceChild(input, titleEl);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) {
      return;
    }
    done = true;

    if (save) {
      const nextTitle = sanitizeUserTitle(input.value);
      if (!nextTitle) {
        setStatus("Title cannot be empty.");
        await renderListings();
        return;
      }

      if (nextTitle !== currentTitle) {
        const response = await chrome.runtime.sendMessage({
          action: "UPDATE_LISTING_TITLE",
          id: item.id,
          title: nextTitle
        });

        if (!response?.ok) {
          setStatus(response?.error || "Could not update title.");
          await renderListings();
          return;
        }

        setStatus("Title updated.");
      }
    }

    await renderListings();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });

  input.addEventListener("blur", () => {
    finish(true);
  });
}
