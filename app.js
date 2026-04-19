const BUILD_VERSION = "2026-04-19-lookup-fix-3";
const STORAGE_KEY = "checkpoint-shelf-games";
const UPC_LOOKUP_URL = "https://api.upcitemdb.com/prod/trial/lookup";
const LOOKUP_PROXY_URL = "https://corsproxy.org/?";
const ZXING_MODULE_URL = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";

const state = {
  autoSaveOnLookup: false,
  barcodeLookupPending: false,
  barcodeScannerAvailable: false,
  barcodeScannerError: "",
  buildVersion: BUILD_VERSION,
  collection: loadCollection(),
  focusLockEnabled: true,
  hardwareModeEnabled: true,
  history: [],
  isLikelyIPhone: /iPhone|iPod/i.test(navigator.userAgent),
  lookup: null,
  pendingInteractiveTarget: null,
  queueModeEnabled: true,
  queuedBarcodes: [],
  queueProcessing: false,
  recentQueuedBarcodes: new Map(),
  reader: null,
  scanControls: null,
  selectedBarcode: "",
};

const elements = {
  autoSaveToggle: document.querySelector("#autoSaveToggle"),
  barcodeInput: document.querySelector("#barcodeInput"),
  buildStamp: document.querySelector("#buildStamp"),
  cameraPreview: document.querySelector("#cameraPreview"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  collectionCount: document.querySelector("#collectionCount"),
  collectionList: document.querySelector("#collectionList"),
  conditionInput: document.querySelector("#conditionInput"),
  coverInput: document.querySelector("#coverInput"),
  duplicateNotice: document.querySelector("#duplicateNotice"),
  emptyState: document.querySelector("#emptyState"),
  exportButton: document.querySelector("#exportButton"),
  focusLockToggle: document.querySelector("#focusLockToggle"),
  formatInput: document.querySelector("#formatInput"),
  gameCardTemplate: document.querySelector("#gameCardTemplate"),
  gameForm: document.querySelector("#gameForm"),
  hardwareModeToggle: document.querySelector("#hardwareModeToggle"),
  imageInput: document.querySelector("#imageInput"),
  lookupBarcodeButton: document.querySelector("#lookupBarcodeButton"),
  lookupImage: document.querySelector("#lookupImage"),
  lookupMeta: document.querySelector("#lookupMeta"),
  lookupResult: document.querySelector("#lookupResult"),
  lookupTitle: document.querySelector("#lookupTitle"),
  notesInput: document.querySelector("#notesInput"),
  platformCount: document.querySelector("#platformCount"),
  platformInput: document.querySelector("#platformInput"),
  queueModeToggle: document.querySelector("#queueModeToggle"),
  queuePreview: document.querySelector("#queuePreview"),
  queueStatus: document.querySelector("#queueStatus"),
  scanHistory: document.querySelector("#scanHistory"),
  scanPreview: document.querySelector("#scanPreview"),
  scannerFocusStatus: document.querySelector("#scannerFocusStatus"),
  scannerMessage: document.querySelector("#scannerMessage"),
  searchInput: document.querySelector("#searchInput"),
  selectedBarcode: document.querySelector("#selectedBarcode"),
  startScannerButton: document.querySelector("#startScannerButton"),
  stopScannerButton: document.querySelector("#stopScannerButton"),
  titleInput: document.querySelector("#titleInput"),
  yearInput: document.querySelector("#yearInput"),
};

void boot();

async function boot() {
  try {
    renderBuildStamp();
    renderCollection();
    renderScanHistory();
    attachEvents();
    syncHardwareModeUI();
    syncScannerButtons(false);
    syncScannerFocusStatus();
    syncQueueStatus();
    focusBarcodeInput();
    await unregisterServiceWorkers();
    await loadScannerModule();

    setScannerMessage(
      state.barcodeScannerAvailable
        ? "Use the HW0006 Pro in Bluetooth HID mode for fast shelf scanning, or use live/photo scanning when needed."
        : "HW0006 Pro mode is ready. Camera scanning is unavailable right now, but barcode lookup and queue mode still work."
    );
  } catch (error) {
    console.error("App boot failed", error);
    setScannerMessage("The app hit a startup issue. Hardware-scanner lookup should still work after a refresh.");
  }
}

function attachEvents() {
  elements.startScannerButton.addEventListener("click", startLiveScanner);
  elements.stopScannerButton.addEventListener("click", stopScanner);
  elements.autoSaveToggle.addEventListener("change", handleModeToggleChange);
  elements.barcodeInput.addEventListener("keydown", handleBarcodeInputKeydown);
  elements.barcodeInput.addEventListener("input", handleBarcodeInputChange);
  elements.barcodeInput.addEventListener("focus", syncScannerFocusStatus);
  elements.barcodeInput.addEventListener("blur", handleBarcodeBlur);
  elements.clearHistoryButton.addEventListener("click", clearScanHistory);
  elements.focusLockToggle.addEventListener("change", handleModeToggleChange);
  elements.lookupBarcodeButton.addEventListener("click", handleLookupButtonClick);
  elements.gameForm.addEventListener("submit", handleGameSubmit);
  elements.hardwareModeToggle.addEventListener("change", handleModeToggleChange);
  elements.imageInput.addEventListener("change", handleImageScan);
  elements.queueModeToggle.addEventListener("change", handleModeToggleChange);
  elements.searchInput.addEventListener("input", renderCollection);
  elements.exportButton.addEventListener("click", exportCollection);
  elements.scanHistory.addEventListener("click", handleHistoryActionClick);
  window.addEventListener("beforeunload", stopScanner);
  document.addEventListener("visibilitychange", syncScannerFocusStatus);
  document.addEventListener("pointerdown", handleGlobalPointerDown, true);
}

async function loadScannerModule() {
  try {
    const module = await import(ZXING_MODULE_URL);
    state.reader = new module.BrowserMultiFormatReader();
    state.NotFoundException = module.NotFoundException;
    state.barcodeScannerAvailable = true;
    state.barcodeScannerError = "";
  } catch (error) {
    console.error("Scanner module failed to load", error);
    state.barcodeScannerAvailable = false;
    state.barcodeScannerError = "Scanner module could not be loaded.";
    elements.startScannerButton.disabled = true;
  }
}

function loadCollection() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error("Could not load collection", error);
    return [];
  }
}

function saveCollection() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.collection));
}

async function startLiveScanner() {
  if (!state.barcodeScannerAvailable || !state.reader) {
    setScannerMessage("Camera scanning is unavailable on this device right now. The HW0006 Pro workflow still works.");
    return;
  }

  setScannerMessage("Starting camera...");

  if (!navigator.mediaDevices?.getUserMedia) {
    setScannerMessage("This browser does not expose camera access. Use the HW0006 Pro or type the barcode instead.");
    return;
  }

  stopScanner();

  try {
    elements.cameraPreview.style.display = "block";
    elements.startScannerButton.disabled = true;
    elements.stopScannerButton.disabled = false;

    const preferredDeviceId = await getPreferredCameraDeviceId();
    state.scanControls = await state.reader.decodeFromVideoDevice(
      preferredDeviceId,
      elements.cameraPreview,
      (result, error, controls) => {
        if (result?.getText()) {
          applyDetectedBarcode(result.getText());
          controls.stop();
          state.scanControls = null;
          syncScannerButtons(false);
          return;
        }

        if (error && state.NotFoundException && !(error instanceof state.NotFoundException)) {
          console.error("Live scan error", error);
        }
      }
    );

    setScannerMessage("Live scanner started. Hold the barcode steady and fill the frame.");
  } catch (error) {
    console.error(error);
    syncScannerButtons(false);
    setScannerMessage("Live scanning could not start. The HW0006 Pro workflow is still available.");
  }
}

function stopScanner() {
  if (state.scanControls) {
    state.scanControls.stop();
    state.scanControls = null;
  }

  elements.cameraPreview.pause();
  elements.cameraPreview.srcObject = null;
  syncScannerButtons(false);
}

async function getPreferredCameraDeviceId() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
      },
    });
    tempStream.getTracks().forEach((track) => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    const preferredCamera = cameras.find((device) => /(back|rear|environment)/i.test(device.label));
    return preferredCamera?.deviceId;
  } catch (error) {
    console.warn("Could not select a preferred camera device", error);
    return undefined;
  }
}

async function handleImageScan(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  if (!state.barcodeScannerAvailable || !state.reader) {
    setScannerMessage("Image barcode decoding is unavailable right now. Use the HW0006 Pro or type the UPC.");
    return;
  }

  stopScanner();
  elements.scanPreview.src = URL.createObjectURL(file);
  elements.scanPreview.style.display = "block";
  setScannerMessage("Photo captured. Decoding the barcode now.");

  try {
    const result = await state.reader.decodeFromImageUrl(elements.scanPreview.src);
    applyDetectedBarcode(result.getText());
  } catch (error) {
    console.error(error);
    setScannerMessage("I couldn't decode a barcode from that image. Try the HW0006 Pro or a sharper photo.");
  }
}

async function lookupSelectedBarcode(options = {}) {
  const triggeredFromQueue = Boolean(options.fromQueue);
  const barcode = elements.barcodeInput.value.trim();
  if (!barcode) {
    setScannerMessage("Enter or scan a barcode first so I know what to look up.");
    return;
  }

  if (state.barcodeLookupPending) {
    return;
  }

  state.barcodeLookupPending = true;
  state.selectedBarcode = barcode;
  elements.selectedBarcode.textContent = barcode;
  updateHistoryEntry(barcode, { status: "processing", detail: "Looking up barcode..." });
  setScannerMessage(`Looking up product info for barcode ${barcode}.`);
  clearLookupResult();

  try {
    const data = await fetchLookupData(barcode);
    const item = data.items?.[0];
    if (!item) {
      updateHistoryEntry(barcode, { status: "failed", detail: "No metadata returned for this barcode." });
      setScannerMessage("No metadata was returned for that barcode. You can still add the game manually.");
      return;
    }

    state.lookup = item;
    applyLookupToForm(item);
    const duplicates = findPotentialDuplicates(barcode, elements.titleInput.value);
    renderDuplicateNotice(duplicates);

    if (state.autoSaveOnLookup && duplicates.length === 0 && canAutoSaveCurrentRecord()) {
      updateHistoryEntry(barcode, { status: "processing", detail: "Match found. Auto-saving..." });
      saveCurrentGameFromLookup();
      if (triggeredFromQueue) {
        processQueuedBarcodes();
      }
      return;
    }

    updateHistoryEntry(barcode, {
      status: duplicates.length ? "duplicate" : "matched",
      detail: duplicates.length
        ? "Match found, but a similar game already exists."
        : `Matched ${elements.titleInput.value.trim() || "game details"}.`,
      title: elements.titleInput.value.trim(),
    });

    setScannerMessage(
      duplicates.length
        ? "Found a product match, but this game may already be in your collection."
        : "Found a product match and filled in the form where possible."
    );
  } catch (error) {
    console.error(error);
    updateHistoryEntry(barcode, { status: "failed", detail: "Lookup failed or browser blocked the request." });
    setScannerMessage("Barcode lookup failed. The browser or barcode API may be blocking the request.");
  } finally {
    state.barcodeLookupPending = false;
    if (triggeredFromQueue) {
      state.queueProcessing = false;
      syncQueueStatus();
      processQueuedBarcodes();
    }
  }
}

function handleLookupButtonClick(event) {
  event.preventDefault();
  setScannerMessage("Looking up barcode...");
  lookupSelectedBarcode({ fromQueue: false });
}

async function fetchLookupData(barcode) {
  const url = `${UPC_LOOKUP_URL}?upc=${encodeURIComponent(barcode)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Direct lookup failed with ${response.status}`);
    }

    return await response.json();
  } catch (directError) {
    console.warn("Direct lookup failed, retrying with proxy", directError);

    const proxied = await fetch(`${LOOKUP_PROXY_URL}${encodeURIComponent(url)}`);
    if (!proxied.ok) {
      throw new Error(`Proxy lookup failed with ${proxied.status}`);
    }

    return await proxied.json();
  }
}

function applyDetectedBarcode(barcode) {
  const trimmed = String(barcode).trim();
  if (!trimmed) {
    return;
  }

  elements.barcodeInput.value = trimmed;
  state.selectedBarcode = trimmed;
  elements.selectedBarcode.textContent = trimmed;
  renderDuplicateNotice(findPotentialDuplicates(trimmed, elements.titleInput.value));
  setScannerMessage(`Detected barcode ${trimmed}. Running lookup next can prefill the game details.`);
  lookupSelectedBarcode();
}

function applyLookupToForm(item) {
  const title = item.title || "";
  const description = item.description || "";
  const brand = item.brand || "";
  const category = item.category || "";
  const image = item.images?.[0] || "";
  const inferredPlatform = inferPlatform(`${title} ${description} ${category}`);
  const inferredFormat = inferFormat(`${title} ${description}`);
  const inferredYear = inferYear(`${title} ${description}`);

  if (title && !elements.titleInput.value.trim()) {
    elements.titleInput.value = cleanGameTitle(title);
  }

  if (inferredPlatform && !elements.platformInput.value.trim()) {
    elements.platformInput.value = inferredPlatform;
  }

  if (inferredFormat) {
    elements.formatInput.value = inferredFormat;
  }

  if (inferredYear && !elements.yearInput.value.trim()) {
    elements.yearInput.value = inferredYear;
  }

  if (image) {
    elements.coverInput.value = image;
  }

  const notes = [brand ? `Brand: ${brand}` : "", category ? `Category: ${category}` : ""]
    .filter(Boolean)
    .join(" | ");
  if (notes && !elements.notesInput.value.trim()) {
    elements.notesInput.value = notes;
  }

  elements.lookupTitle.textContent = cleanGameTitle(title) || "Possible product match";
  elements.lookupMeta.textContent = [inferredPlatform || "Platform unknown", brand || "Publisher unknown", inferredYear || "Year unknown"]
    .filter(Boolean)
    .join(" • ");
  elements.lookupImage.src = image || "icon.svg";
  elements.lookupImage.style.display = "block";
  elements.lookupResult.hidden = false;
}

function clearLookupResult() {
  state.lookup = null;
  elements.lookupResult.hidden = true;
  elements.lookupImage.removeAttribute("src");
}

function cleanGameTitle(rawTitle) {
  return rawTitle
    .replace(/\b(playstation|xbox|nintendo|switch|wii|gamecube|ds|3ds|ps[1-5])\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+-\s+/g, ": ")
    .trim();
}

function inferPlatform(source) {
  const normalized = source.toLowerCase();
  const platformMap = [
    ["playstation 5", "PlayStation 5"],
    ["ps5", "PlayStation 5"],
    ["playstation 4", "PlayStation 4"],
    ["ps4", "PlayStation 4"],
    ["playstation 3", "PlayStation 3"],
    ["xbox series x", "Xbox Series X"],
    ["xbox one", "Xbox One"],
    ["xbox 360", "Xbox 360"],
    ["nintendo switch", "Nintendo Switch"],
    ["switch", "Nintendo Switch"],
    ["wii u", "Wii U"],
    ["wii", "Nintendo Wii"],
    ["gamecube", "Nintendo GameCube"],
    ["3ds", "Nintendo 3DS"],
    ["nintendo ds", "Nintendo DS"],
  ];

  const match = platformMap.find(([needle]) => normalized.includes(needle));
  return match ? match[1] : "";
}

function inferFormat(source) {
  const normalized = source.toLowerCase();
  if (normalized.includes("collector")) {
    return "Collector's Edition";
  }

  if (normalized.includes("digital") || normalized.includes("download")) {
    return "Digital";
  }

  return "Physical";
}

function inferYear(source) {
  const match = source.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function handleGameSubmit(event) {
  event.preventDefault();
  saveCurrentGameFromLookup();
}

function handleBarcodeInputKeydown(event) {
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    const barcode = elements.barcodeInput.value.trim();
    if (state.queueModeEnabled && barcode) {
      enqueueBarcode(barcode, { force: true });
    } else {
      lookupSelectedBarcode();
    }
    return;
  }
}

function handleBarcodeInputChange() {
  const value = elements.barcodeInput.value.trim();
  state.selectedBarcode = value;
  elements.selectedBarcode.textContent = value || "None yet";
  renderDuplicateNotice(findPotentialDuplicates(value, elements.titleInput.value));

  if (!value) {
    return;
  }

  if (/^\d{8,14}$/.test(value) && !state.barcodeLookupPending) {
    window.clearTimeout(handleBarcodeInputChange.timeoutId);
    handleBarcodeInputChange.timeoutId = window.setTimeout(() => {
      if (state.queueModeEnabled && state.hardwareModeEnabled) {
        enqueueBarcode(value);
        return;
      }

      lookupSelectedBarcode();
    }, 180);
  }
}

function handleBarcodeBlur() {
  syncScannerFocusStatus();
  const activeElement = document.activeElement;
  const pendingTarget = state.pendingInteractiveTarget;
  state.pendingInteractiveTarget = null;

  if (pendingTarget && pendingTarget !== elements.barcodeInput) {
    return;
  }

  if (activeElement && activeElement !== elements.barcodeInput && isInteractiveElement(activeElement)) {
    return;
  }

  if (state.focusLockEnabled) {
    window.setTimeout(() => {
      focusBarcodeInput();
    }, 80);
  }
}

function handleModeToggleChange() {
  state.hardwareModeEnabled = elements.hardwareModeToggle.checked;
  state.autoSaveOnLookup = elements.autoSaveToggle.checked;
  state.focusLockEnabled = elements.focusLockToggle.checked;
  state.queueModeEnabled = elements.queueModeToggle.checked;
  syncHardwareModeUI();
  syncScannerFocusStatus();
  syncQueueStatus();

  if (state.focusLockEnabled) {
    focusBarcodeInput();
  }
}

function handleGlobalPointerDown(event) {
  state.pendingInteractiveTarget = event.target.closest("button, label, input, select, textarea, a");
}

function renderCollection() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const filteredGames = state.collection.filter((game) => {
    if (!query) {
      return true;
    }

    return [game.title, game.platform, game.barcode].join(" ").toLowerCase().includes(query);
  });

  elements.collectionList.innerHTML = "";
  elements.emptyState.style.display = filteredGames.length ? "none" : "grid";

  filteredGames.forEach((game) => {
    const fragment = elements.gameCardTemplate.content.cloneNode(true);
    fragment.querySelector(".game-title").textContent = game.title;
    fragment.querySelector(".game-platform").textContent = game.platform;
    fragment.querySelector(".game-format").textContent = game.format;
    fragment.querySelector(".game-condition").textContent = game.condition;
    fragment.querySelector(".game-year").textContent = game.year;
    fragment.querySelector(".game-barcode").textContent = `Barcode: ${game.barcode}`;
    fragment.querySelector(".game-notes").textContent = game.notes || "No notes added.";

    const cover = fragment.querySelector(".game-cover");
    if (game.cover) {
      cover.src = game.cover;
      cover.style.display = "block";
    } else {
      cover.style.display = "none";
    }

    fragment.querySelector(".delete-button").addEventListener("click", () => deleteGame(game.id));
    elements.collectionList.appendChild(fragment);
  });

  elements.collectionCount.textContent = String(state.collection.length);
  elements.platformCount.textContent = String(new Set(state.collection.map((game) => game.platform)).size);
}

function deleteGame(id) {
  state.collection = state.collection.filter((game) => game.id !== id);
  saveCollection();
  renderCollection();
  renderDuplicateNotice(findPotentialDuplicates(elements.barcodeInput.value, elements.titleInput.value));
}

function exportCollection() {
  const payload = JSON.stringify(state.collection, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "checkpoint-shelf-collection.json";
  link.click();
  URL.revokeObjectURL(url);
}

function resetFormState(savedTitle) {
  elements.gameForm.reset();
  elements.barcodeInput.value = "";
  elements.selectedBarcode.textContent = "None yet";
  elements.scanPreview.style.display = "none";
  elements.imageInput.value = "";
  clearLookupResult();
  state.selectedBarcode = "";
  renderDuplicateNotice([]);
  setScannerMessage(`Saved ${savedTitle} to your collection.`);
  focusBarcodeInput();
}

function setScannerMessage(message) {
  elements.scannerMessage.textContent = message;
}

function syncScannerButtons(isScanning) {
  elements.startScannerButton.disabled = isScanning || !state.barcodeScannerAvailable;
  elements.stopScannerButton.disabled = !isScanning;
}

function syncHardwareModeUI() {
  elements.hardwareModeToggle.checked = state.hardwareModeEnabled;
  elements.autoSaveToggle.checked = state.autoSaveOnLookup;
  elements.focusLockToggle.checked = state.focusLockEnabled;
  elements.queueModeToggle.checked = state.queueModeEnabled;
}

function syncScannerFocusStatus() {
  const focused = document.activeElement === elements.barcodeInput;
  elements.scannerFocusStatus.textContent = focused
    ? "Scanner ready"
    : state.focusLockEnabled
      ? "Refocusing scanner box..."
      : "Tap the scan box before scanning";
  elements.scannerFocusStatus.classList.toggle("is-live", focused);
}

function focusBarcodeInput() {
  if (!state.hardwareModeEnabled) {
    syncScannerFocusStatus();
    return;
  }

  elements.barcodeInput.focus({ preventScroll: true });
  syncScannerFocusStatus();
}

function isInteractiveElement(element) {
  return Boolean(element?.closest?.("button, label, input, select, textarea, a"));
}

function findPotentialDuplicates(barcode, title) {
  const normalizedBarcode = String(barcode || "").trim().toLowerCase();
  const normalizedTitle = String(title || "").trim().toLowerCase();

  return state.collection.filter((game) => {
    const sameBarcode = normalizedBarcode && game.barcode.toLowerCase() === normalizedBarcode;
    const sameTitle = normalizedTitle && game.title.toLowerCase() === normalizedTitle;
    return sameBarcode || sameTitle;
  });
}

function renderDuplicateNotice(duplicates) {
  if (!duplicates.length) {
    elements.duplicateNotice.hidden = true;
    elements.duplicateNotice.textContent = "";
    return;
  }

  const preview = duplicates.slice(0, 2).map((game) => `${game.title} (${game.platform})`).join(", ");
  elements.duplicateNotice.hidden = false;
  elements.duplicateNotice.textContent = `Possible duplicate${duplicates.length > 1 ? "s" : ""}: ${preview}`;
}

function canAutoSaveCurrentRecord() {
  return Boolean(elements.titleInput.value.trim() && elements.platformInput.value.trim());
}

function saveCurrentGameFromLookup() {
  const formData = new FormData(elements.gameForm);
  const title = String(formData.get("title") || "").trim();
  const platform = String(formData.get("platform") || "").trim();

  if (!title || !platform) {
    setScannerMessage("Title and platform are required before saving a game.");
    return;
  }

  const record = {
    id: crypto.randomUUID(),
    title,
    platform,
    format: String(formData.get("format") || "Physical"),
    condition: String(formData.get("condition") || "Good"),
    year: String(formData.get("year") || "").trim() || "Unknown year",
    notes: String(formData.get("notes") || "").trim(),
    barcode: state.selectedBarcode || elements.barcodeInput.value.trim() || "No barcode",
    cover: String(formData.get("cover") || "").trim(),
    createdAt: new Date().toISOString(),
  };

  state.collection.unshift(record);
  saveCollection();
  renderCollection();
  updateHistoryEntry(record.barcode, { status: "saved", detail: `Saved ${record.title}.`, title: record.title });
  resetFormState(record.title);
  if (state.queueProcessing) {
    state.queueProcessing = false;
    syncQueueStatus();
    processQueuedBarcodes();
  }
}

function enqueueBarcode(barcode, options = {}) {
  const trimmed = String(barcode || "").trim();
  if (!trimmed) {
    return;
  }

  const now = Date.now();
  cleanupRecentQueuedBarcodes(now);
  const lastQueuedAt = state.recentQueuedBarcodes.get(trimmed);
  if (!options.force && lastQueuedAt && now - lastQueuedAt < 1500) {
    return;
  }

  state.recentQueuedBarcodes.set(trimmed, now);
  state.queuedBarcodes.push(trimmed);
  upsertHistoryEntry(trimmed, {
    id: crypto.randomUUID(),
    barcode: trimmed,
    status: "queued",
    detail: "Waiting in queue...",
    title: "",
    createdAt: new Date().toISOString(),
  });
  elements.barcodeInput.value = "";
  state.selectedBarcode = "";
  elements.selectedBarcode.textContent = "Queued";
  syncQueueStatus();
  processQueuedBarcodes();
}

function processQueuedBarcodes() {
  if (!state.queueModeEnabled || state.queueProcessing || state.barcodeLookupPending) {
    syncQueueStatus();
    return;
  }

  const nextBarcode = state.queuedBarcodes.shift();
  if (!nextBarcode) {
    syncQueueStatus();
    return;
  }

  state.queueProcessing = true;
  elements.barcodeInput.value = nextBarcode;
  state.selectedBarcode = nextBarcode;
  elements.selectedBarcode.textContent = nextBarcode;
  renderDuplicateNotice(findPotentialDuplicates(nextBarcode, elements.titleInput.value));
  updateHistoryEntry(nextBarcode, { status: "processing", detail: "Processing queued scan..." });
  syncQueueStatus(`Processing ${nextBarcode}`);
  lookupSelectedBarcode({ fromQueue: true });
}

function cleanupRecentQueuedBarcodes(now = Date.now()) {
  state.recentQueuedBarcodes.forEach((timestamp, barcode) => {
    if (now - timestamp > 4000) {
      state.recentQueuedBarcodes.delete(barcode);
    }
  });
}

function syncQueueStatus(overrideText = "") {
  if (overrideText) {
    elements.queueStatus.textContent = overrideText;
    elements.queueStatus.classList.add("is-live");
  } else if (state.queueProcessing) {
    elements.queueStatus.textContent = `Processing • ${state.queuedBarcodes.length} waiting`;
    elements.queueStatus.classList.add("is-live");
  } else if (state.queuedBarcodes.length) {
    elements.queueStatus.textContent = `${state.queuedBarcodes.length} queued`;
    elements.queueStatus.classList.add("is-live");
  } else {
    elements.queueStatus.textContent = state.queueModeEnabled ? "Queue idle" : "Queue off";
    elements.queueStatus.classList.remove("is-live");
  }

  if (!state.queuedBarcodes.length) {
    elements.queuePreview.hidden = true;
    elements.queuePreview.textContent = "";
    return;
  }

  const preview = state.queuedBarcodes.slice(0, 4).join(", ");
  elements.queuePreview.hidden = false;
  elements.queuePreview.textContent = `Queued scans: ${preview}${state.queuedBarcodes.length > 4 ? "..." : ""}`;
}

function clearScanHistory() {
  state.history = [];
  renderScanHistory();
}

function upsertHistoryEntry(barcode, entry) {
  const existingIndex = state.history.findIndex((item) => item.barcode === barcode && item.status !== "saved");
  if (existingIndex >= 0) {
    state.history[existingIndex] = {
      ...state.history[existingIndex],
      ...entry,
    };
  } else {
    state.history.unshift(entry);
  }

  state.history = state.history.slice(0, 12);
  renderScanHistory();
}

function updateHistoryEntry(barcode, patch) {
  const historyItem = state.history.find((item) => item.barcode === barcode);
  if (!historyItem) {
    upsertHistoryEntry(barcode, {
      id: crypto.randomUUID(),
      barcode,
      status: patch.status || "queued",
      detail: patch.detail || "",
      title: patch.title || "",
      createdAt: new Date().toISOString(),
    });
    return;
  }

  Object.assign(historyItem, patch);
  renderScanHistory();
}

function renderScanHistory() {
  elements.scanHistory.innerHTML = "";

  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "history-item";
    empty.innerHTML = `<div class="history-meta">Recent queued and processed scans will appear here.</div>`;
    elements.scanHistory.appendChild(empty);
    return;
  }

  state.history.forEach((item) => {
    const historyItem = document.createElement("article");
    historyItem.className = "history-item";
    historyItem.dataset.historyId = item.id;

    const statusClass = `is-${item.status}`;
    const canRetry = item.status === "failed" || item.status === "duplicate";
    const canDismiss = item.status !== "processing";

    historyItem.innerHTML = `
      <div class="history-item__top">
        <span class="history-code">${item.barcode}</span>
        <span class="history-status ${statusClass}">${formatHistoryStatus(item.status)}</span>
      </div>
      <div class="history-meta">${item.title || item.detail || "No details yet."}</div>
      <div class="history-item__actions">
        ${canRetry ? `<button type="button" data-action="retry">Retry</button>` : ""}
        ${canDismiss ? `<button type="button" data-action="dismiss">Dismiss</button>` : ""}
      </div>
    `;

    elements.scanHistory.appendChild(historyItem);
  });
}

function handleHistoryActionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const container = button.closest("[data-history-id]");
  if (!container) {
    return;
  }

  const historyItem = state.history.find((item) => item.id === container.dataset.historyId);
  if (!historyItem) {
    return;
  }

  if (button.dataset.action === "retry") {
    enqueueBarcode(historyItem.barcode, { force: true });
    updateHistoryEntry(historyItem.barcode, { status: "queued", detail: "Queued again for retry." });
    return;
  }

  if (button.dataset.action === "dismiss") {
    state.history = state.history.filter((item) => item.id !== historyItem.id);
    renderScanHistory();
  }
}

function formatHistoryStatus(status) {
  switch (status) {
    case "queued":
      return "Queued";
    case "processing":
      return "Processing";
    case "matched":
      return "Matched";
    case "saved":
      return "Saved";
    case "duplicate":
      return "Duplicate";
    case "failed":
      return "Failed";
    default:
      return "Seen";
  }
}

async function unregisterServiceWorkers() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.error("Service worker cleanup failed", error);
  }
}

function renderBuildStamp() {
  elements.buildStamp.textContent = `Build ${BUILD_VERSION}`;
}
