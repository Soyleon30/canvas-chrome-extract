const appTitle = document.getElementById("appTitle");
const statusEl = document.getElementById("status");
const pageInfoEl = document.getElementById("pageInfo");
const canvasListEl = document.getElementById("canvasList");
const refreshButton = document.getElementById("refreshButton");
const downloadAllButton = document.getElementById("downloadAllButton");
const copyReportButton = document.getElementById("copyReportButton");
const backgroundColorInput = document.getElementById("backgroundColorInput");
const backgroundColorText = document.getElementById("backgroundColorText");
const filenamePrefixEnabled = document.getElementById("filenamePrefixEnabled");
const filenameSelectorInput = document.getElementById("filenameSelectorInput");
const template = document.getElementById("canvasItemTemplate");

let currentCanvases = [];
let currentTabTitle = "page";
let currentTabId = null;
let currentBackgroundColor = "#0a0d19";
let currentFilenameSelectors = ".newKpi2.col .title span.text-blue";
let isFilenamePrefixEnabled = true;

document.addEventListener("DOMContentLoaded", scanCurrentTab);
appTitle.addEventListener("dblclick", toggleReportButton);
refreshButton.addEventListener("click", scanCurrentTab);
downloadAllButton.addEventListener("click", downloadAll);
copyReportButton.addEventListener("click", copyReport);
document.querySelectorAll("input[name='backgroundMode']").forEach((input) => {
  input.addEventListener("change", scanCurrentTab);
});
backgroundColorInput.addEventListener("input", syncBackgroundColorFromPicker);
backgroundColorText.addEventListener("change", syncBackgroundColorFromText);
filenamePrefixEnabled.addEventListener("change", syncFilenamePrefixEnabled);
filenameSelectorInput.addEventListener("change", syncFilenameSelectors);

function toggleReportButton(event) {
  if (!event.altKey) {
    return;
  }

  copyReportButton.hidden = !copyReportButton.hidden;
  if (!copyReportButton.hidden) {
    copyReportButton.disabled = currentCanvases.length === 0;
  }
}

async function scanCurrentTab() {
  setStatus("正在扫描...");
  canvasListEl.textContent = "";
  currentCanvases = [];
  downloadAllButton.disabled = true;
  copyReportButton.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error("没有找到当前标签页");
    }

    currentTabId = tab.id;
    currentTabTitle = tab.title || "page";
    pageInfoEl.textContent = trimText(tab.url || currentTabTitle, 58);

    const result = await collectFromAllFrames(tab.id, getScanOptions());
    currentCanvases = result;
    renderCanvases();
  } catch (error) {
    setStatus(`扫描失败：${error.message}`, true);
  }
}

async function collectFromAllFrames(tabId, backgroundOptions) {
  const batches = [];
  const scanStartedAt = Date.now();
  const isFullExport = backgroundOptions.exportMode === "full";

  const collectPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(flattenCanvasBatches(batches));
    }, isFullExport ? 8000 : 900);

    function onMessage(message, sender) {
      if (!message || message.type !== "CANVAS_EXTRACTOR_RESULT") {
        return;
      }

      if (!sender.tab || sender.tab.id !== tabId) {
        return;
      }

      if (message.scanTime < scanStartedAt) {
        return;
      }

      const canvases = Array.isArray(message.canvases) ? message.canvases : [];
      if (isFullExport && canvases.length === 0) {
        return;
      }

      batches.push({
        frameId: sender.frameId || 0,
        frameUrl: sender.url || "",
        canvases
      });

      clearTimeout(timer);
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve(flattenCanvasBatches(batches));
      }, isFullExport ? 100 : 250);
    }

    chrome.runtime.onMessage.addListener(onMessage);
  });

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"]
  });

  const triggerFile = backgroundOptions.backgroundMode === "transparent" ? "scan-transparent.js" : "scan-dark.js";
  await setScanOptions(backgroundOptions);

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [triggerFile]
  });

  return collectPromise;
}

function setScanOptions(options) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ canvasExtractorOptions: options }, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || String(runtimeError)));
        return;
      }

      resolve();
    });
  });
}

function flattenCanvasBatches(batches) {
  return batches.flatMap((batch) => batch.canvases.map((item) => ({
    ...item,
    frameId: batch.frameId,
    frameUrl: batch.frameUrl
  }))).sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    return areaB - areaA;
  }).map((item, index) => ({
    ...item,
    index
  }));
}

function renderCanvases() {
  canvasListEl.textContent = "";

  if (!currentCanvases.length) {
    setStatus("当前页面没有找到 canvas。确认图表已经渲染完成后再点重新扫描。");
    return;
  }

  const downloadable = currentCanvases.filter((item) => item.exportable);
  setStatus(`找到 ${currentCanvases.length} 个 canvas，其中 ${downloadable.length} 个可导出。`);
  downloadAllButton.disabled = downloadable.length === 0;
  copyReportButton.disabled = false;

  for (const item of currentCanvases) {
    const node = template.content.firstElementChild.cloneNode(true);
    const preview = node.querySelector(".preview");
    const fallback = node.querySelector(".previewFallback");
    const title = node.querySelector(".itemTitle");
    const badge = node.querySelector(".badge");
    const meta = node.querySelector(".meta");
    const selector = node.querySelector(".selector");
    const error = node.querySelector(".error");
    const downloadButton = node.querySelector(".downloadButton");
    const copyButton = node.querySelector(".copyButton");

    title.textContent = item.name;
    badge.textContent = item.exportable ? "可导出" : "受限";
    badge.classList.toggle("isError", !item.exportable);
    const ipText = item.ipAddress ? `，IP ${item.ipAddress}` : "";
    meta.textContent = `${item.width}x${item.height} 像素，页面显示 ${item.displayWidth}x${item.displayHeight}，frame ${item.frameId || 0}${ipText}`;
    selector.textContent = item.selector || "canvas";

    if (item.previewDataUrl) {
      preview.src = item.previewDataUrl;
      preview.alt = `${item.name || "Canvas"} 的图像预览`;
    } else {
      preview.remove();
      fallback.style.display = "block";
      error.style.display = "block";
      error.textContent = item.error || "浏览器阻止读取此 canvas";
    }

    downloadButton.disabled = !item.exportable;
    copyButton.disabled = !item.exportable;
    downloadButton.addEventListener("click", () => downloadCanvas(item));
    copyButton.addEventListener("click", () => copyDataUrl(item));

    canvasListEl.appendChild(node);
  }
}

async function downloadAll() {
  const items = currentCanvases.filter((item) => item.exportable);
  for (const item of items) {
    await downloadCanvas(item, false);
  }
}

async function downloadCanvas(item, showDone = true) {
  try {
    const dataUrl = await exportFullCanvas(item);
    const filename = makeFilename(item);
    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false
    });

    if (showDone) {
      setStatus(`已开始下载：${filename}`);
    }
  } catch (error) {
    setStatus(`导出失败：${error.message}`, true);
  }
}

async function copyDataUrl(item) {
  try {
    const dataUrl = await exportFullCanvas(item);
    await navigator.clipboard.writeText(dataUrl);
    setStatus(`已复制：${item.name}`);
  } catch (error) {
    setStatus(`导出失败：${error.message}`, true);
  }
}

async function exportFullCanvas(item) {
  if (!currentTabId) {
    throw new Error("没有可用的当前标签页");
  }

  setStatus(`正在导出：${item.name}`);
  const result = await collectFromAllFrames(currentTabId, {
    ...getBackgroundOptions(),
    exportMode: "full",
    target: {
      sourceIndex: item.sourceIndex,
      selector: item.selector
    }
  });

  const exported = result.find((candidate) =>
    candidate.frameId === item.frameId &&
    candidate.sourceIndex === item.sourceIndex &&
    candidate.dataUrl
  ) || result.find((candidate) => candidate.dataUrl);

  if (!exported || !exported.dataUrl) {
    throw new Error(item.error || "未能导出完整 canvas");
  }

  return exported.dataUrl;
}

async function copyReport() {
  const report = currentCanvases.map((item) => [
    `#${item.index + 1} ${item.name}`,
    `size=${item.width}x${item.height}`,
    `display=${item.displayWidth}x${item.displayHeight}`,
    `visible=${item.visible}`,
    `exportable=${Boolean(item.exportable)}`,
    item.filenamePrefix ? `filenamePrefix=${item.filenamePrefix}` : "",
    item.ipAddress ? `ip=${item.ipAddress}` : "",
    `frame=${item.frameId || 0}`,
    item.frameUrl ? `frameUrl=${item.frameUrl}` : "",
    `selector=${item.selector}`,
    item.error ? `error=${item.error}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");

  await navigator.clipboard.writeText(report);
  setStatus("已复制 canvas 报告");
}

function makeFilename(item) {
  const title = sanitizeFilename(currentTabTitle).slice(0, 70) || "page";
  const name = sanitizeFilename(item.name).slice(0, 40) || `canvas-${item.index + 1}`;
  const ipPart = item.ipAddress ? `${sanitizeFilename(item.ipAddress)}-` : "";
  const mode = item.backgroundMode === "transparent" ? "transparent" : normalizeColor(item.backgroundColor).slice(1);
  return `canvas-extractor/${title}/${ipPart}${String(item.index + 1).padStart(2, "0")}-${name}-${mode}-${item.width}x${item.height}.png`;
}

function sanitizeFilename(value) {
  return String(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("isError", isError);
}

function getBackgroundOptions() {
  const checked = document.querySelector("input[name='backgroundMode']:checked");
  return {
    backgroundMode: checked ? checked.value : "dark",
    backgroundColor: currentBackgroundColor,
    filenamePrefixEnabled: isFilenamePrefixEnabled,
    filenameSelectors: isFilenamePrefixEnabled ? normalizeSelectorList(currentFilenameSelectors) : []
  };
}

function getScanOptions() {
  return {
    ...getBackgroundOptions(),
    exportMode: "preview",
    previewMaxSize: 240
  };
}

function syncBackgroundColorFromPicker() {
  setBackgroundColor(backgroundColorInput.value);
  scanCurrentTab();
}

function syncBackgroundColorFromText() {
  setBackgroundColor(backgroundColorText.value);
  scanCurrentTab();
}

function setBackgroundColor(value) {
  currentBackgroundColor = normalizeColor(value);
  backgroundColorInput.value = currentBackgroundColor;
  backgroundColorText.value = currentBackgroundColor;
}

function syncFilenamePrefixEnabled() {
  isFilenamePrefixEnabled = filenamePrefixEnabled.checked;
  filenameSelectorInput.disabled = !isFilenamePrefixEnabled;
  scanCurrentTab();
}

function syncFilenameSelectors() {
  currentFilenameSelectors = normalizeSelectorList(filenameSelectorInput.value).join("；");
  filenameSelectorInput.value = currentFilenameSelectors;
  scanCurrentTab();
}

function normalizeSelectorList(value) {
  const selectors = String(value || ".newKpi2.col .title span.text-blue")
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return selectors.length ? selectors : [".newKpi2.col .title span.text-blue"];
}

function normalizeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value).toLowerCase() : "#0a0d19";
}

function trimText(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value || "";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}
