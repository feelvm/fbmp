const saveCurrentButton = document.getElementById("save-current");
const checkNowButton = document.getElementById("check-now");
const statusEl = document.getElementById("status");
const listingListEl = document.getElementById("listing-list");
const emptyStateEl = document.getElementById("empty-state");
const savedSummaryEl = document.getElementById("saved-summary");

const DOUBLE_TAP_MS = 320;

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
      title: sanitizeUserTitle(tab.title) || ""
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

  setStatus("Listing saved.");
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

    const link = document.createElement("a");
    link.className = "listing-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = "link";

    left.appendChild(title);
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
  const title = sanitizeUserTitle(item?.title);
  if (title) {
    return title;
  }
  return item?.id ? `Marketplace Listing ${item.id}` : "Marketplace Listing";
}

function sanitizeUserTitle(title) {
  const cleaned = String(title || "").replace(/\s+/g, " ").trim();
  return cleaned || null;
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
