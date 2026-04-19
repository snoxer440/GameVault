import { BrowserMultiFormatReader, NotFoundException } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";

const STORAGE_KEY = "checkpoint-shelf-games";
const UPC_LOOKUP_URL = "https://api.upcitemdb.com/prod/trial/lookup";
const LOOKUP_PROXY_URL = "https://corsproxy.org/?";

const state = {
  collection: loadCollection(),
  lookup: null,
  reader: new BrowserMultiFormatReader(),
  scanControls: null,
  selectedBarcode: "",
};

const elements = {
  barcodeInput: document.querySelector("#barcodeInput"),
  cameraPreview: document.querySelector("#cameraPreview"),
  collectionCount: document.querySelector("#collectionCount"),
  collectionList: document.querySelector("#collectionList"),
  conditionInput: document.querySelector("#conditionInput"),
  coverInput: document.querySelector("#coverInput"),
  emptyState: document.querySelector("#emptyState"),
  exportButton: document.querySelector("#exportButton"),
  formatInput: document.querySelector("#formatInput"),
  gameCardTemplate: document.querySelector("#gameCardTemplate"),
  gameForm: document.querySelector("#gameForm"),
  imageInput: document.querySelector("#imageInput"),
  lookupBarcodeButton: document.querySelector("#lookupBarcodeButton"),
  lookupImage: document.querySelector("#lookupImage"),
  lookupMeta: document.querySelector("#lookupMeta"),
  lookupResult: document.querySelector("#lookupResult"),
  lookupTitle: document.querySelector("#lookupTitle"),
  notesInput: document.querySelector("#notesInput"),
  platformCount: document.querySelector("#platformCount"),
  platformInput: document.querySelector("#platformInput"),
  scanPreview: document.querySelector("#scanPreview"),
  scannerMessage: document.querySelector("#scannerMessage"),
  searchInput: document.querySelector("#searchInput"),
  selectedBarcode: document.querySelector("#selectedBarcode"),
  startScannerButton: document.querySelector("#startScannerButton"),
  titleInput: document.querySelector("#titleInput"),
  yearInput: document.querySelector("#yearInput"),
};

renderCollection();
attachEvents();
setScannerMessage(
  "Use Live Scan on supporting devices, or use Scan From Photo on iPhone to capture the barcode with the rear camera."
);
registerServiceWorker();

function attachEvents() {
  elements.startScannerButton.addEventListener("click", startLiveScanner);
  elements.lookupBarcodeButton.addEventListener("click", lookupSelectedBarcode);
  elements.gameForm.addEventListener("submit", handleGameSubmit);
  elements.imageInput.addEventListener("change", handleImageScan);
  elements.searchInput.addEventListener("input", renderCollection);
  elements.exportButton.addEventListener("click", exportCollection);
  window.addEventListener("beforeunload", stopScanner);
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
  if (!navigator.mediaDevices?.getUserMedia) {
    setScannerMessage("This browser does not expose camera access. Use Scan From Photo or type the barcode instead.");
    return;
  }

  stopScanner();

  try {
    elements.cameraPreview.style.display = "block";
    state.scanControls = await state.reader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
        },
      },
      elements.cameraPreview,
      (result, error, controls) => {
        if (result?.getText()) {
          applyDetectedBarcode(result.getText());
          controls.stop();
          state.scanControls = null;
          return;
        }

        if (error && !(error instanceof NotFoundException)) {
          console.error("Live scan error", error);
        }
      }
    );

    setScannerMessage("Live scanner started. If iPhone camera preview is flaky, use Scan From Photo instead.");
  } catch (error) {
    console.error(error);
    setScannerMessage("Live scanning could not start. Scan From Photo is the most reliable fallback on iPhone.");
  }
}

function stopScanner() {
  if (state.scanControls) {
    state.scanControls.stop();
    state.scanControls = null;
  }

  elements.cameraPreview.pause();
  elements.cameraPreview.srcObject = null;
}

async function handleImageScan(event) {
  const [file] = event.target.files || [];
  if (!file) {
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
    setScannerMessage("I couldn't decode a barcode from that image. Try a sharper photo with the bars filling more of the frame.");
  }
}

async function lookupSelectedBarcode() {
  const barcode = elements.barcodeInput.value.trim();
  if (!barcode) {
    setScannerMessage("Enter or scan a barcode first so I know what to look up.");
    return;
  }

  state.selectedBarcode = barcode;
  elements.selectedBarcode.textContent = barcode;
  setScannerMessage(`Looking up product info for barcode ${barcode}.`);
  clearLookupResult();

  try {
    const data = await fetchLookupData(barcode);
    const item = data.items?.[0];
    if (!item) {
      setScannerMessage("No metadata was returned for that barcode. You can still add the game manually.");
      return;
    }

    state.lookup = item;
    applyLookupToForm(item);
    setScannerMessage("Found a product match and filled in the form where possible.");
  } catch (error) {
    console.error(error);
    setScannerMessage("Barcode lookup failed. This can happen when the API has no match or the browser blocks the request.");
  }
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
  resetFormState(record.title);
}

function renderCollection() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const filteredGames = state.collection.filter((game) => {
    if (!query) {
      return true;
    }

    return [game.title, game.platform, game.barcode]
      .join(" ")
      .toLowerCase()
      .includes(query);
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
  setScannerMessage(`Saved ${savedTitle} to your collection.`);
}

function setScannerMessage(message) {
  elements.scannerMessage.textContent = message;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.error("Service worker registration failed", error);
  }
}
