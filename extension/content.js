const ALLOWED_PREFIXES = ["/marketplace", "/messages"];
const AUTH_PREFIXES = ["/login", "/checkpoint", "/two_factor", "/recover"];
const SAVE_BUTTON_ID = "fbmp-save-listing-button";
const HOST_BACKUP_STORAGE_KEY = "fbmp_savedListingsBackup";
const HOST_BACKUP_VERSION = 1;
const ROUTE_CHECK_INTERVAL_MS = 1000;
const SAVE_BUTTON_BIND_VERSION = "3";
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
const PRICE_WITH_GENERIC_CODE_PREFIX_RE = /\b[A-Z]{3}\s+\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\b/;
const PRICE_WITH_GENERIC_CODE_SUFFIX_RE = /\b\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\s+[A-Z]{3}\b/;
const CURRENCY_CODE_TOKEN_RE = new RegExp(`\\b(?:${CURRENCY_CODES_RE_PART})\\b`, "i");
const PRICE_ATTRIBUTE_NAMES = [
  "aria-label",
  "title",
  "content",
  "data-content",
  "data-text",
  "data-value",
  "value"
];
const GENERIC_LISTING_TITLES = new Set([
  "notification",
  "notifications",
  "facebook",
  "marketplace",
  "search",
  "search results",
  "results",
  "marketplace search results",
  "marketplace - search results",
  "facebook marketplace listing",
  "marketplace listing",
  "messenger"
]);

let lastKnownPath = location.pathname;
let routeObserverInitialized = false;
let navPruneQueued = false;

bootstrap();

function bootstrap() {
  enforceAllowedRoute();
  setupRouteObserver();
  installMessageHandlers();
  syncHostBackup();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady, { once: true });
  } else {
    onReady();
  }
}

function onReady() {
  enforceAllowedRoute();
  syncSaveButton();
  pruneNavigationLinks();
  observeDomChanges();
}

function setupRouteObserver() {
  if (routeObserverInitialized) {
    return;
  }
  routeObserverInitialized = true;

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    queueRouteCheck();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    queueRouteCheck();
  };

  window.addEventListener("popstate", queueRouteCheck);
  setInterval(queueRouteCheck, ROUTE_CHECK_INTERVAL_MS);
}

function queueRouteCheck() {
  if (location.pathname === lastKnownPath) {
    return;
  }

  lastKnownPath = location.pathname;
  enforceAllowedRoute();
  syncSaveButton();
  pruneNavigationLinks();
}

function isAllowedPath(pathname) {
  const lower = (pathname || "").toLowerCase();
  return [...ALLOWED_PREFIXES, ...AUTH_PREFIXES].some((prefix) => lower.startsWith(prefix));
}

function isMarketplaceItemPath(pathname) {
  return /\/marketplace\/item\/\d+/i.test(pathname || "");
}

function enforceAllowedRoute() {
  if (isAllowedPath(location.pathname)) {
    return;
  }

  location.replace("https://www.facebook.com/marketplace/");
}

function observeDomChanges() {
  const observer = new MutationObserver(() => {
    if (!navPruneQueued) {
      navPruneQueued = true;
      requestAnimationFrame(() => {
        navPruneQueued = false;
        pruneNavigationLinks();
      });
    }

    if (isMarketplaceItemPath(location.pathname)) {
      syncSaveButton();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function pruneNavigationLinks() {
  const candidates = document.querySelectorAll("header a[href], nav a[href], [role='navigation'] a[href]");
  for (const anchor of candidates) {
    if (anchor.dataset.fbmpPruned === "1") {
      continue;
    }
    anchor.dataset.fbmpPruned = "1";

    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }

    let destination;
    try {
      destination = new URL(href, location.origin);
    } catch (_error) {
      continue;
    }

    if (destination.origin !== location.origin) {
      continue;
    }

    if (isAllowedPath(destination.pathname)) {
      continue;
    }

    anchor.classList.add("fbmp-hidden-link");
  }
}

function syncSaveButton() {
  try {
    const existing = document.getElementById(SAVE_BUTTON_ID);
    if (!isMarketplaceItemPath(location.pathname)) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (existing) {
      const version = existing.dataset.fbmpBindVersion || "";
      if (version === SAVE_BUTTON_BIND_VERSION) {
        return;
      }
      existing.remove();
    }

    const button = document.createElement("button");
    button.id = SAVE_BUTTON_ID;
    button.dataset.fbmpBindVersion = SAVE_BUTTON_BIND_VERSION;
    button.type = "button";
    button.textContent = "Save Listing";
    button.addEventListener("click", async () => {
      try {
        const listing = await extractCurrentListingWithRetries();
        if (!listing) {
          button.textContent = "Listing Not Found";
          setTimeout(() => {
            button.textContent = "Save Listing";
          }, 1500);
          return;
        }

        const response = await chrome.runtime.sendMessage({
          action: "ADD_LISTING",
          payload: listing
        });

        button.textContent = response?.ok ? "Saved" : "Save Failed";
        setTimeout(() => {
          button.textContent = "Save Listing";
        }, 1200);
      } catch (error) {
        if (isContextInvalidatedError(error)) {
          button.textContent = "Reload Page";
          return;
        }

        button.textContent = "Save Failed";
        setTimeout(() => {
          button.textContent = "Save Listing";
        }, 1200);
      }
    });

    document.documentElement.appendChild(button);
  } catch (error) {
    if (!isContextInvalidatedError(error)) {
      throw error;
    }
  }
}

function extractCurrentListing() {
  if (!isMarketplaceItemPath(location.pathname)) {
    return null;
  }

  const canonical = document.querySelector("link[rel='canonical']")?.href || location.href;
  const url = canonical.split("?")[0];
  const title = extractCurrentListingTitle();
  const { price, originalPrice } = extractCurrentListingPrices();

  const idMatch = url.match(/\/marketplace\/item\/(\d+)/i);
  return {
    id: idMatch ? idMatch[1] : null,
    url,
    title,
    price,
    originalPrice
  };
}

function extractCurrentListingTitle() {
  const candidates = [];

  candidates.push(document.querySelector("meta[property='og:title']")?.content || "");
  candidates.push(document.title || "");

  const headings = document.querySelectorAll("h1");
  for (const heading of headings) {
    candidates.push(heading.textContent || "");
    candidates.push(heading.getAttribute("aria-label") || "");
  }

  for (const candidate of candidates) {
    const title = sanitizeListingTitle(candidate);
    if (title) {
      return title;
    }
  }

  return "Facebook Marketplace Listing";
}

async function extractCurrentListingWithRetries() {
  let listing = extractCurrentListing();
  if (!listing) {
    return null;
  }

  if (listing.price && listing.originalPrice) {
    return listing;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(250);
    const next = extractCurrentListing();
    if (!next) {
      continue;
    }

    listing = {
      ...listing,
      ...next,
      price: listing.price || next.price || null,
      originalPrice: listing.originalPrice || next.originalPrice || null
    };

    if (listing.price && (listing.originalPrice || attempt >= 4)) {
      return listing;
    }
  }

  return listing;
}

function extractCurrentListingPrices() {
  // Discount-first: two distinct prices in the price area means a discount
  // regardless of how the original price is rendered (strike, dimmed, aria).
  const areaCandidates = collectPriceAreaCandidates();
  const pair = chooseDiscountPair(areaCandidates);
  if (pair) {
    console.debug("[FBMP] discount pair from price area", areaCandidates, pair);
    return pair;
  }

  const price = extractCurrentListingPrice();
  const originalPrice = extractOriginalListingPrice(price);

  const priceValue = parsePriceValue(price);
  const originalValue = parsePriceValue(originalPrice);
  if (priceValue != null && originalValue != null && originalValue > priceValue) {
    console.debug("[FBMP] discount pair from strike/label scan", {
      price,
      originalPrice
    });
    return { price, originalPrice };
  }

  console.debug("[FBMP] no discount pair", {
    areaCandidates,
    price,
    originalPrice
  });
  return { price, originalPrice: null };
}

function collectTightPriceAreaRoots() {
  const roots = new Set();

  for (const heading of document.querySelectorAll("h1")) {
    if (heading.parentElement) {
      roots.add(heading.parentElement);
    }
    if (heading.nextElementSibling) {
      roots.add(heading.nextElementSibling);
    }
    if (heading.parentElement?.nextElementSibling) {
      roots.add(heading.parentElement.nextElementSibling);
    }
  }

  return Array.from(roots);
}

function collectPriceAreaCandidates() {
  const byValue = new Map();

  for (const root of collectTightPriceAreaRoots()) {
    const queue = [root];
    let scanned = 0;

    while (queue.length && scanned < 2000) {
      const node = queue.shift();
      if (!(node instanceof Element)) {
        continue;
      }

      scanned += 1;
      const struck = isStrikeThroughElement(node);

      if (!struck) {
        const text = normalizeSearchText(node.textContent || "");
        if (text && text.length <= 48) {
          const price = extractPriceFromText(text);
          if (price && !(hasMultiplePriceValues(text) && containsStrikeThrough(node))) {
            addPriceAreaCandidate(byValue, price, struck);
          }
        }
      }

      for (const attributeName of ["aria-label", "title", "data-content", "data-text"]) {
        const value = node.getAttribute(attributeName) || "";
        if (value && value.length <= 80) {
          const price = extractPriceFromText(value);
          if (price) {
            addPriceAreaCandidate(byValue, price, struck);
          }
        }
      }

      for (const child of node.children) {
        queue.push(child);
      }
    }
  }

  return Array.from(byValue.values());
}

function addPriceAreaCandidate(byValue, priceText, struck) {
  const value = parsePriceValue(priceText);
  if (value == null || value <= 0) {
    return;
  }

  const existing = byValue.get(value);
  if (!existing) {
    byValue.set(value, { text: priceText, value, struck });
    return;
  }

  // Prefer the non-struck rendering of the same amount for the sale price.
  if (existing.struck && !struck) {
    byValue.set(value, { text: priceText, value, struck: false });
  }
}

function chooseDiscountPair(candidates) {
  const positive = candidates.filter((candidate) => candidate.value > 0);
  if (!positive.length) {
    return null;
  }

  const struck = positive.filter((candidate) => candidate.struck);
  const normal = positive.filter((candidate) => !candidate.struck);

  if (struck.length && normal.length) {
    const original = struck.reduce((best, candidate) =>
      candidate.value > best.value ? candidate : best
    );
    const saleCandidates = normal.filter((candidate) => candidate.value < original.value);
    if (saleCandidates.length) {
      // Highest non-struck price below the original: the sale price, not
      // small noise like delivery fees.
      const sale = saleCandidates.reduce((best, candidate) =>
        candidate.value > best.value ? candidate : best
      );
      return { price: sale.text, originalPrice: original.text };
    }
  }

  if (normal.length >= 2) {
    const sorted = [...normal].sort((a, b) => a.value - b.value);
    const sale = sorted[0];
    const original = sorted[sorted.length - 1];
    if (original.value > sale.value && original.value <= sale.value * 8) {
      return { price: sale.text, originalPrice: original.text };
    }
  }

  return null;
}

function extractOriginalListingPrice(currentPrice) {
  const currentValue = parsePriceValue(currentPrice);
  if (currentValue == null) {
    return null;
  }

  let bestOriginal = null;
  let bestValue = currentValue;

  for (const candidate of collectLabeledOriginalPrices()) {
    const value = parsePriceValue(candidate);
    if (value != null && value > bestValue) {
      bestOriginal = candidate;
      bestValue = value;
    }
  }

  if (bestOriginal) {
    return bestOriginal;
  }

  for (const candidate of collectStrikeThroughPrices()) {
    const value = parsePriceValue(candidate);
    if (value != null && value > bestValue) {
      bestOriginal = candidate;
      bestValue = value;
    }
  }

  return bestOriginal;
}

function collectLabeledOriginalPrices() {
  const candidates = [];
  const labeled = document.querySelectorAll("[aria-label], [title], [data-content], [data-text]");

  for (const element of labeled) {
    for (const attributeName of ["aria-label", "title", "data-content", "data-text"]) {
      const value = element.getAttribute(attributeName) || "";
      if (!value || value.length > 160 || !/\boriginal\b|\bwas\b|\bbefore\b|\bcrossed\b/i.test(value)) {
        continue;
      }

      const price = extractPriceFromText(value);
      if (price) {
        candidates.push(price);
      }
    }
  }

  return candidates;
}

function collectStrikeThroughPrices() {
  const roots = collectDiscountScanRoots();
  const candidates = [];

  for (const root of roots) {
    const queue = [root];
    let scanned = 0;

    while (queue.length && scanned < 4000) {
      const node = queue.shift();
      if (!(node instanceof Element)) {
        continue;
      }

      scanned += 1;

      if (isStrikeThroughElement(node)) {
        const price = extractPriceFromText(
          normalizeSearchText(node.textContent || "").slice(0, 48)
        );
        if (price) {
          candidates.push(price);
        }
      }

      for (const child of node.children) {
        queue.push(child);
      }
    }
  }

  return candidates;
}

function collectDiscountScanRoots() {
  const roots = new Set();
  const headings = document.querySelectorAll("h1");

  for (const heading of headings) {
    const container = heading.closest("div")?.parentElement || heading.parentElement;
    if (container) {
      roots.add(container);
    }
  }

  if (!roots.size && document.body) {
    roots.add(document.body);
  }

  return Array.from(roots);
}

function parsePriceValue(priceString) {
  const raw = normalizeSearchText(priceString);
  if (!raw) {
    return null;
  }

  const match = raw.match(/\d[\d\s.,]*/);
  if (!match) {
    return null;
  }

  let digits = match[0].trim();
  let decimal = "";
  const tail = digits.match(/[.,](\d{1,2})$/);
  if (tail) {
    decimal = tail[1];
    digits = digits.slice(0, digits.length - tail[0].length);
  }

  const whole = digits.replace(/[.,\s]/g, "");
  if (!whole) {
    return null;
  }

  const value = Number(`${whole}${decimal ? `.${decimal}` : ""}`);
  return Number.isFinite(value) ? value : null;
}

function extractCurrentListingPrice() {
  const metaAmount = document.querySelector("meta[property='product:price:amount']")?.content || "";
  const metaCurrency = document.querySelector("meta[property='product:price:currency']")?.content || "";
  const metaPrice = normalizePriceCandidate(metaAmount, metaCurrency);
  if (metaPrice) {
    return metaPrice;
  }

  const jsonLdPrice = extractPriceFromJsonLd();
  if (jsonLdPrice) {
    return jsonLdPrice;
  }

  let fallbackPrice = null;

  const titleAreaPrice = extractPriceNearTitleBlock();
  if (titleAreaPrice) {
    if (!isLowConfidencePrice(titleAreaPrice)) {
      return titleAreaPrice;
    }
    fallbackPrice = pickBetterPriceCandidate(fallbackPrice, titleAreaPrice);
  }

  const spanPrice = extractPriceFromAllSpans(120000);
  if (spanPrice) {
    if (!isLowConfidencePrice(spanPrice)) {
      return spanPrice;
    }
    fallbackPrice = pickBetterPriceCandidate(fallbackPrice, spanPrice);
  }

  const ogDescription = document.querySelector("meta[property='og:description']")?.content || "";
  const ogPrice = extractPriceFromText(ogDescription);
  if (ogPrice) {
    if (!isLowConfidencePrice(ogPrice)) {
      return ogPrice;
    }
    fallbackPrice = pickBetterPriceCandidate(fallbackPrice, ogPrice);
  }

  const headingText = document.querySelector("h1")?.parentElement?.innerText || "";
  const headingPrice = extractPriceFromText(headingText);
  if (headingPrice) {
    if (!isLowConfidencePrice(headingPrice)) {
      return headingPrice;
    }
    fallbackPrice = pickBetterPriceCandidate(fallbackPrice, headingPrice);
  }

  const bodySnippet = (document.body?.innerText || "").slice(0, 25000);
  const bodyTextPrice = extractPriceFromText(bodySnippet);
  if (bodyTextPrice) {
    if (!isLowConfidencePrice(bodyTextPrice)) {
      return bodyTextPrice;
    }
    fallbackPrice = pickBetterPriceCandidate(fallbackPrice, bodyTextPrice);
  }

  const pseudoPrice = extractPriceFromPseudoContent(document.body, 50000);
  if (pseudoPrice) {
    if (!isLowConfidencePrice(pseudoPrice)) {
      return pseudoPrice;
    }
    fallbackPrice = pickBetterPriceCandidate(fallbackPrice, pseudoPrice);
  }

  return fallbackPrice;
}

function extractPriceFromJsonLd() {
  const scripts = document.querySelectorAll("script[type='application/ld+json']");
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) {
      continue;
    }

    try {
      const data = JSON.parse(raw);
      const price = findPriceInJsonLdNode(data);
      if (price) {
        return price;
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function findPriceInJsonLdNode(node, depth = 0) {
  if (depth > 12 || node == null) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const price = findPriceInJsonLdNode(child, depth + 1);
      if (price) {
        return price;
      }
    }
    return null;
  }

  if (typeof node !== "object") {
    return null;
  }

  const directPrice = normalizePriceCandidate(node.price, node.priceCurrency || node.currency);
  if (directPrice) {
    return directPrice;
  }

  if (node.offers) {
    const offerPrice = findPriceInJsonLdNode(node.offers, depth + 1);
    if (offerPrice) {
      return offerPrice;
    }
  }

  for (const value of Object.values(node)) {
    const nestedPrice = findPriceInJsonLdNode(value, depth + 1);
    if (nestedPrice) {
      return nestedPrice;
    }
  }

  return null;
}

function extractPriceNearTitleBlock() {
  const headings = Array.from(document.querySelectorAll("h1"));
  if (!headings.length) {
    return null;
  }

  let bestPrice = null;
  const seen = new Set();
  for (const heading of headings) {
    const candidates = buildHeadingCandidates(heading);
    for (const node of candidates) {
      if (!node || seen.has(node)) {
        continue;
      }
      seen.add(node);

      const text = normalizeSearchText(node.innerText || node.textContent || "");
      if (text) {
        let price = extractPriceFromText(text.slice(0, 2200));
        if (price && containsStrikeThrough(node)) {
          // Container shows both prices (e.g. "$89 $120" with the old one
          // struck through); the regex would prefer the longer original,
          // so re-extract from non-struck descendants instead.
          const salePrice = extractSalePriceWithin(node);
          if (salePrice) {
            price = salePrice;
          }
        }
        if (price) {
          if (!isLowConfidencePrice(price)) {
            return price;
          }
          bestPrice = pickBetterPriceCandidate(bestPrice, price);
        }
      }

      const pseudoPrice = extractPriceFromPseudoContent(node, 2400);
      if (pseudoPrice) {
        if (!isLowConfidencePrice(pseudoPrice)) {
          return pseudoPrice;
        }
        bestPrice = pickBetterPriceCandidate(bestPrice, pseudoPrice);
      }
    }
  }

  return bestPrice;
}

const strikeThroughCache = new WeakMap();

function isStrikeThroughElement(element) {
  if (strikeThroughCache.has(element)) {
    return strikeThroughCache.get(element);
  }

  let struck = false;
  try {
    struck = (getComputedStyle(element).textDecorationLine || "").includes("line-through");
  } catch (_error) {
    struck = false;
  }

  strikeThroughCache.set(element, struck);
  return struck;
}

function containsStrikeThrough(rootNode) {
  const queue = [rootNode];
  let scanned = 0;

  while (queue.length && scanned < 400) {
    const node = queue.shift();
    if (!(node instanceof Element)) {
      continue;
    }

    scanned += 1;
    if (isStrikeThroughElement(node)) {
      return true;
    }

    for (const child of node.children) {
      queue.push(child);
    }
  }

  return false;
}

function extractSalePriceWithin(rootNode) {
  const queue = [rootNode];
  let scanned = 0;
  let bestPrice = null;

  while (queue.length && scanned < 2000) {
    const node = queue.shift();
    if (!(node instanceof Element)) {
      continue;
    }

    scanned += 1;

    if (isStrikeThroughElement(node)) {
      continue;
    }

    const textPrice = extractPriceFromElementText(node);
    if (textPrice) {
      if (!isLowConfidencePrice(textPrice)) {
        return textPrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, textPrice);
    }

    const attributePrice = extractPriceFromAttributes(node);
    if (attributePrice) {
      if (!isLowConfidencePrice(attributePrice)) {
        return attributePrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, attributePrice);
    }

    for (const child of node.children) {
      queue.push(child);
    }
  }

  return bestPrice;
}

function buildHeadingCandidates(heading) {
  const candidates = [heading];

  if (heading.nextElementSibling) {
    candidates.push(heading.nextElementSibling);
  }

  if (heading.parentElement) {
    candidates.push(heading.parentElement);
    if (heading.parentElement.nextElementSibling) {
      candidates.push(heading.parentElement.nextElementSibling);
    }
  }

  let current = heading.parentElement;
  for (let i = 0; i < 5 && current; i += 1) {
    candidates.push(current);
    if (current.nextElementSibling) {
      candidates.push(current.nextElementSibling);
    }
    current = current.parentElement;
  }

  return candidates;
}

function extractPriceFromAllSpans(maxSpans = 30000) {
  const spans = document.getElementsByTagName("span");
  const limit = Math.min(spans.length, Math.max(1, Number(maxSpans) || 30000));
  let bestPrice = null;

  for (let i = 0; i < limit; i += 1) {
    const span = spans[i];
    if (!(span instanceof Element)) {
      continue;
    }

    const textPrice = extractPriceFromElementText(span);
    if (textPrice) {
      if (!isLowConfidencePrice(textPrice)) {
        return textPrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, textPrice);
    }

    const attributePrice = extractPriceFromAttributes(span);
    if (attributePrice) {
      if (!isLowConfidencePrice(attributePrice)) {
        return attributePrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, attributePrice);
    }

    const beforePrice = extractPriceFromText(readPseudoContent(span, "::before"));
    if (beforePrice) {
      if (!isLowConfidencePrice(beforePrice)) {
        return beforePrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, beforePrice);
    }

    const afterPrice = extractPriceFromText(readPseudoContent(span, "::after"));
    if (afterPrice) {
      if (!isLowConfidencePrice(afterPrice)) {
        return afterPrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, afterPrice);
    }
  }

  return bestPrice;
}

function extractPriceFromPseudoContent(rootNode, maxScan = 260) {
  const MAX_SCAN = Math.max(1, Number(maxScan) || 260);
  const queue = [rootNode];
  let scanned = 0;
  let bestPrice = null;

  while (queue.length && scanned < MAX_SCAN) {
    const node = queue.shift();
    if (!(node instanceof Element)) {
      continue;
    }

    scanned += 1;

    const inlineTextPrice = extractPriceFromElementText(node);
    if (inlineTextPrice) {
      if (!isLowConfidencePrice(inlineTextPrice)) {
        return inlineTextPrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, inlineTextPrice);
    }

    const attributePrice = extractPriceFromAttributes(node);
    if (attributePrice) {
      if (!isLowConfidencePrice(attributePrice)) {
        return attributePrice;
      }
      bestPrice = pickBetterPriceCandidate(bestPrice, attributePrice);
    }

    const beforeContent = readPseudoContent(node, "::before");
    if (beforeContent) {
      const beforePrice = extractPriceFromText(beforeContent);
      if (beforePrice) {
        if (!isLowConfidencePrice(beforePrice)) {
          return beforePrice;
        }
        bestPrice = pickBetterPriceCandidate(bestPrice, beforePrice);
      }
    }

    const afterContent = readPseudoContent(node, "::after");
    if (afterContent) {
      const afterPrice = extractPriceFromText(afterContent);
      if (afterPrice) {
        if (!isLowConfidencePrice(afterPrice)) {
          return afterPrice;
        }
        bestPrice = pickBetterPriceCandidate(bestPrice, afterPrice);
      }
    }

    for (const child of node.children) {
      if (queue.length >= MAX_SCAN) {
        break;
      }
      queue.push(child);
    }
  }

  return bestPrice;
}

function extractPriceFromElementText(element) {
  const tagName = element.tagName || "";
  if (!/^(SPAN|DIV|P|A|STRONG|B)$/i.test(tagName)) {
    return null;
  }

  if (isStrikeThroughElement(element)) {
    return null;
  }

  const text = normalizeSearchText(element.textContent || "");
  if (!text || text.length > 48) {
    return null;
  }

  const price = extractPriceFromText(text);
  if (price && hasMultiplePriceValues(text) && containsStrikeThrough(element)) {
    // Text mixes sale and struck-through original prices; unusable as-is.
    return null;
  }

  return price;
}

function hasMultiplePriceValues(text) {
  const candidates = [];
  collectPriceMatches(text, PRICE_WITH_SYMBOL_RE, candidates);
  collectPriceMatches(text, PRICE_WITH_CODE_PREFIX_RE, candidates);
  collectPriceMatches(text, PRICE_WITH_CODE_SUFFIX_RE, candidates);

  const values = new Set();
  for (const candidate of candidates) {
    const value = parsePriceValue(candidate);
    if (value != null) {
      values.add(value);
    }
  }

  return values.size > 1;
}

function extractPriceFromAttributes(element) {
  if (isStrikeThroughElement(element)) {
    return null;
  }

  for (const attrName of PRICE_ATTRIBUTE_NAMES) {
    const value = element.getAttribute(attrName);
    if (!value) {
      continue;
    }
    const price = extractPriceFromText(value);
    if (price) {
      return price;
    }
  }

  if (element.attributes) {
    for (const attr of element.attributes) {
      const name = String(attr.name || "");
      if (!name.startsWith("data-")) {
        continue;
      }
      const value = String(attr.value || "");
      if (!value || value.length > 80) {
        continue;
      }
      const price = extractPriceFromText(value);
      if (price) {
        return price;
      }
    }
  }

  return null;
}

function readPseudoContent(element, pseudoSelector) {
  try {
    const raw = getComputedStyle(element, pseudoSelector).getPropertyValue("content");
    return normalizePseudoContent(raw);
  } catch (_error) {
    return null;
  }
}

function normalizePseudoContent(rawContent) {
  const raw = String(rawContent || "").trim();
  if (!raw || raw === "none" || raw === "normal") {
    return null;
  }

  let text = raw;
  if (
    (text.startsWith("\"") && text.endsWith("\"")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }

  text = decodeCssEscapes(text).replace(/\s+/g, " ").trim();
  if (!text || text === "none" || text === "normal") {
    return null;
  }

  return text;
}

function decodeCssEscapes(value) {
  return String(value || "")
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_match, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (_error) {
        return "";
      }
    })
    .replace(/\\\n/g, "")
    .replace(/\\(.)/g, "$1");
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

  return extractPriceFromText(raw);
}

function extractPriceFromText(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return null;
  }

  const candidates = [];
  collectPriceMatches(normalized, PRICE_WITH_SYMBOL_RE, candidates);
  collectPriceMatches(normalized, PRICE_WITH_CODE_PREFIX_RE, candidates);
  collectPriceMatches(normalized, PRICE_WITH_CODE_SUFFIX_RE, candidates);
  collectPriceMatches(normalized, PRICE_WITH_LOCAL_PREFIX_RE, candidates);
  collectPriceMatches(normalized, PRICE_WITH_LOCAL_SUFFIX_RE, candidates);
  collectPriceMatches(normalized, PRICE_WITH_GENERIC_CODE_PREFIX_RE, candidates);
  collectPriceMatches(normalized, PRICE_WITH_GENERIC_CODE_SUFFIX_RE, candidates);

  let bestPrice = null;
  for (const candidate of candidates) {
    bestPrice = pickBetterPriceCandidate(bestPrice, candidate);
  }

  if (bestPrice) {
    return bestPrice;
  }

  if (/\bfree\b/i.test(normalized)) {
    return "Free";
  }

  return null;
}

function collectPriceMatches(text, pattern, target) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  let match = matcher.exec(text);

  while (match) {
    const standardized = standardizePriceString(match[0]);
    if (standardized) {
      target.push(standardized);
    }

    if (matcher.lastIndex === match.index) {
      matcher.lastIndex += 1;
    }
    match = matcher.exec(text);
  }
}

function isLowConfidencePrice(price) {
  return priceConfidenceScore(price) < 4;
}

function pickBetterPriceCandidate(current, candidate) {
  if (!candidate) {
    return current || null;
  }
  if (!current) {
    return candidate;
  }

  const currentScore = priceConfidenceScore(current);
  const candidateScore = priceConfidenceScore(candidate);
  if (candidateScore > currentScore) {
    return candidate;
  }
  if (candidateScore < currentScore) {
    return current;
  }

  return candidate.length > current.length ? candidate : current;
}

function priceConfidenceScore(price) {
  if (!price) {
    return -1;
  }

  const value = String(price);
  const digits = (value.match(/\d/g) || []).length;
  let score = digits;

  if (/[.,]\d{2}\b/.test(value)) {
    score += 3;
  }
  if (/[$€£]/.test(value)) {
    score += 2;
  } else if (CURRENCY_CODE_TOKEN_RE.test(value)) {
    score += 2;
  }
  if (/^[$€£]\d{1,2}$/.test(value)) {
    score -= 4;
  }
  if (/^(?:[A-Z]{3}\s\d{1,2}|\d{1,2}\s[A-Z]{3})$/.test(value)) {
    score -= 3;
  }

  return score;
}

function standardizePriceString(value) {
  return normalizeSearchText(value)
    .replace(/\s+/g, " ")
    .replace(/(\d)\s*([.,])\s*(\d)/g, "$1$2$3")
    .replace(/([A-Z]{2,4})(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z]{2,4})/g, "$1 $2")
    .replace(/([$€£])\s+/g, "$1")
    .replace(/\b([Kk])\s*([cč])\b/gu, "$1$2")
    .trim();
}

function sanitizeListingTitle(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return null;
  }

  const cleaned = normalized
    .replace(/^\s*(?:facebook\s+)?marketplace\s*[-|:]\s*/i, "")
    .replace(/\s*[|]\s*facebook\s*$/i, "")
    .replace(/\s*[-]\s*facebook\s*$/i, "")
    .replace(/\s*[|]\s*marketplace\s*$/i, "")
    .replace(/\s*[-]\s*marketplace\s*$/i, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  const lower = cleaned.toLowerCase();
  if (GENERIC_LISTING_TITLES.has(lower)) {
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

  const matchedPrice = extractPriceFromText(cleaned);
  if (matchedPrice) {
    const remainder = normalizeSearchText(cleaned.replace(matchedPrice, "").replace(/[|,:-]/g, " "));
    if (!remainder) {
      return null;
    }
  }

  return cleaned;
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function installMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === "LISTINGS_UPDATED" && Array.isArray(message.listings)) {
      writeHostBackup(message.listings);
      return;
    }

    if (message?.action !== "GET_LISTING_INFO") {
      return;
    }

    (async () => {
      const listing = await extractCurrentListingWithRetries();
      sendResponse({ ok: Boolean(listing), listing });
    })().catch((_error) => {
      sendResponse({ ok: false, listing: null });
    });

    return true;
  });
}

async function syncHostBackup() {
  const backup = readHostBackup();

  let response = null;
  try {
    response = await chrome.runtime.sendMessage({
      action: "SYNC_WITH_HOST",
      backup
    });
  } catch (_error) {
    // Extension context unavailable; nothing to sync.
    return;
  }

  if (response?.ok && Array.isArray(response.listings)) {
    writeHostBackup(response.listings);
  }
}

function readHostBackup() {
  try {
    const raw = window.localStorage.getItem(HOST_BACKUP_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed?.listings)) {
      return parsed.listings;
    }
    return [];
  } catch (_error) {
    return [];
  }
}

function writeHostBackup(listings) {
  try {
    window.localStorage.setItem(
      HOST_BACKUP_STORAGE_KEY,
      JSON.stringify({
        version: HOST_BACKUP_VERSION,
        savedAt: new Date().toISOString(),
        listings
      })
    );
  } catch (_error) {
    // Storage unavailable (quota, privacy mode); mirror is best-effort.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isContextInvalidatedError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("extension context invalidated") ||
    message.includes("receiving end does not exist") ||
    message.includes("message port closed before a response was received")
  );
}
