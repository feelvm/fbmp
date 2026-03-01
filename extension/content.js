const ALLOWED_PREFIXES = ["/marketplace", "/messages"];
const AUTH_PREFIXES = ["/login", "/checkpoint", "/two_factor", "/recover"];
const SAVE_BUTTON_ID = "fbmp-save-listing-button";
const ROUTE_CHECK_INTERVAL_MS = 1000;

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
  const existing = document.getElementById(SAVE_BUTTON_ID);
  if (!isMarketplaceItemPath(location.pathname)) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  if (existing) {
    return;
  }

  const button = document.createElement("button");
  button.id = SAVE_BUTTON_ID;
  button.type = "button";
  button.textContent = "Save Listing";
  button.addEventListener("click", async () => {
    const listing = extractCurrentListing();
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
  });

  document.documentElement.appendChild(button);
}

function extractCurrentListing() {
  if (!isMarketplaceItemPath(location.pathname)) {
    return null;
  }

  const canonical = document.querySelector("link[rel='canonical']")?.href || location.href;
  const url = canonical.split("?")[0];
  const title =
    document.querySelector("meta[property='og:title']")?.content ||
    document.querySelector("h1")?.textContent ||
    "Facebook Marketplace Listing";

  const idMatch = url.match(/\/marketplace\/item\/(\d+)/i);
  return {
    id: idMatch ? idMatch[1] : null,
    url,
    title: title.trim()
  };
}

function installMessageHandlers() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== "GET_LISTING_INFO") {
      return;
    }

    const listing = extractCurrentListing();
    sendResponse({ ok: Boolean(listing), listing });
    return true;
  });
}
