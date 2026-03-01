const ALLOWED_PREFIXES = ["/marketplace", "/messages"];
const AUTH_PREFIXES = ["/login", "/checkpoint", "/two_factor", "/recover"];
const SAVE_BUTTON_ID = "fbmp-save-listing-button";
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
const PRICE_WITH_GENERIC_CODE_PREFIX_RE = /\b[A-Z]{2,4}\s?\d{2,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\b/;
const PRICE_WITH_GENERIC_CODE_SUFFIX_RE = /\b\d{2,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?\s?[A-Z]{2,4}\b/;
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
  const price = extractCurrentListingPrice();

  const idMatch = url.match(/\/marketplace\/item\/(\d+)/i);
  return {
    id: idMatch ? idMatch[1] : null,
    url,
    title,
    price
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

  if (listing.price) {
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
      price: listing.price || next.price || null
    };

    if (listing.price) {
      return listing;
    }
  }

  return listing;
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

  const titleAreaPrice = extractPriceNearTitleBlock();
  if (titleAreaPrice) {
    return titleAreaPrice;
  }

  const spanPrice = extractPriceFromAllSpans(120000);
  if (spanPrice) {
    return spanPrice;
  }

  const ogDescription = document.querySelector("meta[property='og:description']")?.content || "";
  const ogPrice = extractPriceFromText(ogDescription);
  if (ogPrice) {
    return ogPrice;
  }

  const headingText = document.querySelector("h1")?.parentElement?.innerText || "";
  const headingPrice = extractPriceFromText(headingText);
  if (headingPrice) {
    return headingPrice;
  }

  const bodySnippet = (document.body?.innerText || "").slice(0, 25000);
  const bodyTextPrice = extractPriceFromText(bodySnippet);
  if (bodyTextPrice) {
    return bodyTextPrice;
  }

  return extractPriceFromPseudoContent(document.body, 50000);
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
        const price = extractPriceFromText(text.slice(0, 2200));
        if (price) {
          return price;
        }
      }

      const pseudoPrice = extractPriceFromPseudoContent(node, 2400);
      if (pseudoPrice) {
        return pseudoPrice;
      }
    }
  }

  return null;
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

  for (let i = 0; i < limit; i += 1) {
    const span = spans[i];
    if (!(span instanceof Element)) {
      continue;
    }

    const textPrice = extractPriceFromElementText(span);
    if (textPrice) {
      return textPrice;
    }

    const attributePrice = extractPriceFromAttributes(span);
    if (attributePrice) {
      return attributePrice;
    }

    const beforePrice = extractPriceFromText(readPseudoContent(span, "::before"));
    if (beforePrice) {
      return beforePrice;
    }

    const afterPrice = extractPriceFromText(readPseudoContent(span, "::after"));
    if (afterPrice) {
      return afterPrice;
    }
  }

  return null;
}

function extractPriceFromPseudoContent(rootNode, maxScan = 260) {
  const MAX_SCAN = Math.max(1, Number(maxScan) || 260);
  const queue = [rootNode];
  let scanned = 0;

  while (queue.length && scanned < MAX_SCAN) {
    const node = queue.shift();
    if (!(node instanceof Element)) {
      continue;
    }

    scanned += 1;

    const inlineTextPrice = extractPriceFromElementText(node);
    if (inlineTextPrice) {
      return inlineTextPrice;
    }

    const attributePrice = extractPriceFromAttributes(node);
    if (attributePrice) {
      return attributePrice;
    }

    const beforeContent = readPseudoContent(node, "::before");
    if (beforeContent) {
      const beforePrice = extractPriceFromText(beforeContent);
      if (beforePrice) {
        return beforePrice;
      }
    }

    const afterContent = readPseudoContent(node, "::after");
    if (afterContent) {
      const afterPrice = extractPriceFromText(afterContent);
      if (afterPrice) {
        return afterPrice;
      }
    }

    for (const child of node.children) {
      if (queue.length >= MAX_SCAN) {
        break;
      }
      queue.push(child);
    }
  }

  return null;
}

function extractPriceFromElementText(element) {
  const tagName = element.tagName || "";
  if (!/^(SPAN|DIV|P|A|STRONG|B)$/i.test(tagName)) {
    return null;
  }

  const text = normalizeSearchText(element.textContent || "");
  if (!text || text.length > 48) {
    return null;
  }

  return extractPriceFromText(text);
}

function extractPriceFromAttributes(element) {
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

function sanitizeListingTitle(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return null;
  }

  const cleaned = normalized
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
