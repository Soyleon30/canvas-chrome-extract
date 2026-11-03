const appTitle = document.getElementById("appTitle");
const statusEl = document.getElementById("status");
const pageInfoEl = document.getElementById("pageInfo");
const canvasListEl = document.getElementById("canvasList");
const refreshButton = document.getElementById("refreshButton");
const downloadAllButton = document.getElementById("downloadAllButton");
const downloadFolderButton = document.getElementById("downloadFolderButton");
const copyReportButton = document.getElementById("copyReportButton");
const backgroundColorInput = document.getElementById("backgroundColorInput");
const backgroundColorText = document.getElementById("backgroundColorText");
const filenamePrefixEnabled = document.getElementById("filenamePrefixEnabled");
const filenameSelectorInput = document.getElementById("filenameSelectorInput");
const template = document.getElementById("canvasItemTemplate");
const zoomOverlay = document.getElementById("zoomOverlay");
const zoomTitle = document.getElementById("zoomTitle");
const zoomStatus = document.getElementById("zoomStatus");
const zoomImage = document.getElementById("zoomImage");

let currentCanvases = [];
let currentTabTitle = "page";
let currentTabId = null;
let currentBackgroundColor = "#0a0d19";
let currentFilenameSelectors = ".newKpi2.col .title span.text-blue";
let isFilenamePrefixEnabled = true;
let zoomRequestId = 0;
let zoomTimer = null;
let isDirectoryExporting = false;
const supportsDirectoryExport = typeof window.showDirectoryPicker === "function";

if (!supportsDirectoryExport) {
  downloadFolderButton.title = "当前浏览器不支持直接写入文件夹，请关闭浏览器的下载前询问设置";
}

document.addEventListener("DOMContentLoaded", scanCurrentTab);
appTitle.addEventListener("dblclick", toggleReportButton);
refreshButton.addEventListener("click", scanCurrentTab);
downloadAllButton.addEventListener("click", downloadAll);
downloadFolderButton.addEventListener("click", downloadAllToFolder);
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
  hideZoom();
  setStatus("正在扫描...");
  canvasListEl.textContent = "";
  currentCanvases = [];
  downloadAllButton.disabled = true;
  downloadFolderButton.disabled = true;
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
  const isTargetExport = backgroundOptions.exportMode !== "preview";

  const collectPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(flattenCanvasBatches(batches));
    }, isTargetExport ? 8000 : 900);

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
      if (isTargetExport && canvases.length === 0) {
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
      }, isTargetExport ? 100 : 250);
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
  downloadFolderButton.disabled = downloadable.length === 0 || !supportsDirectoryExport;
  copyReportButton.disabled = false;

  for (const item of currentCanvases) {
    const node = template.content.firstElementChild.cloneNode(true);
    const preview = node.querySelector(".preview");
    const previewWrap = node.querySelector(".previewWrap");
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
      previewWrap.addEventListener("mouseenter", () => showZoom(item));
      previewWrap.addEventListener("mouseleave", hideZoom);
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

async function downloadAllToFolder() {
  if (isDirectoryExporting) {
    return;
  }

  const items = currentCanvases.filter((item) => item.exportable);
  if (!items.length) {
    return;
  }

  if (!supportsDirectoryExport) {
    setStatus("当前浏览器不支持直接写入文件夹，请关闭浏览器的下载前询问设置。", true);
    return;
  }

  isDirectoryExporting = true;
  hideZoom();
  const controls = Array.from(document.querySelectorAll("button, input"));
  const controlStates = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });

  let directoryHandle;
  let exportedCount = 0;
  try {
    // Request the directory during the click gesture, before exporting images.
    directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const dataUrl = await exportFullCanvas(item);
      setStatus(`正在导出到文件夹：${index + 1}/${items.length} ${item.name}`);
      await writeDataUrlToDirectory(directoryHandle, makeFilename(item), dataUrl);
      exportedCount += 1;
    }
    setStatus(`已导出 ${items.length} 张独立 PNG 到所选文件夹。`);
  } catch (error) {
    if (!directoryHandle && error && error.name === "AbortError") {
      setStatus("已取消文件夹导出。");
    } else {
      setStatus(`文件夹导出失败（已保存 ${exportedCount}/${items.length} 张）：${error.message}`, true);
    }
  } finally {
    isDirectoryExporting = false;
    controls.forEach((control, index) => { control.disabled = controlStates[index]; });
    updateBulkActionState();
  }
}

async function writeDataUrlToDirectory(rootDirectory, relativePath, dataUrl) {
  const pathParts = String(relativePath || "canvas.png").split("/").filter(Boolean);
  const requestedFilename = pathParts.pop() || "canvas.png";
  let directory = rootDirectory;

  for (const part of pathParts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }

  const filename = await getAvailableFilename(directory, requestedFilename);
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(dataUrlToBlob(dataUrl));
    await writable.close();
  } catch (error) {
    try {
      if (typeof writable.abort === "function") {
        await writable.abort();
      }
    } catch (_) {
      // Preserve the original write error.
    }
    throw error;
  }
}

async function getAvailableFilename(directory, filename) {
  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : "";

  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? filename : `${stem} (${index})${extension}`;
    try {
      await directory.getFileHandle(candidate);
    } catch (error) {
      if (error && error.name === "NotFoundError") {
        return candidate;
      }
      if (!error || error.name !== "TypeMismatchError") {
        throw error;
      }
    }
  }

  throw new Error("同名文件过多，无法生成新文件名");
}

function dataUrlToBlob(dataUrl) {
  const separatorIndex = String(dataUrl).indexOf(",");
  if (separatorIndex < 0) {
    throw new Error("PNG 数据格式无效");
  }

  const metadata = dataUrl.slice(0, separatorIndex);
  const payload = dataUrl.slice(separatorIndex + 1);
  const mimeMatch = metadata.match(/^data:([^;,]+)/i);
  const type = mimeMatch ? mimeMatch[1] : "image/png";

  if (!/;base64/i.test(metadata)) {
    return new Blob([decodeURIComponent(payload)], { type });
  }

  const parts = [];
  const chunkSize = 65536;
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    const binary = atob(payload.slice(offset, offset + chunkSize));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    parts.push(bytes);
  }
  return new Blob(parts, { type });
}

function updateBulkActionState() {
  const hasDownloadableCanvas = currentCanvases.some((item) => item.exportable);
  downloadAllButton.disabled = !hasDownloadableCanvas;
  downloadFolderButton.disabled = !hasDownloadableCanvas || !supportsDirectoryExport;
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

function showZoom(item) {
  if (!item.exportable || isDirectoryExporting) {
    return;
  }

  clearTimeout(zoomTimer);
  const requestId = ++zoomRequestId;
  zoomTitle.textContent = item.name || `Canvas ${item.index + 1}`;
  zoomStatus.textContent = "正在生成清晰预览...";
  zoomImage.removeAttribute("src");
  zoomImage.alt = `${item.name || "Canvas"} 的放大预览`;
  zoomOverlay.hidden = false;
  zoomOverlay.setAttribute("aria-hidden", "false");

  zoomTimer = setTimeout(async () => {
    try {
      const previewDataUrl = await exportCanvasPreview(item, 1200);
      if (requestId !== zoomRequestId) {
        return;
      }

      zoomImage.src = previewDataUrl;
      zoomStatus.textContent = `${item.width} x ${item.height}`;
    } catch (error) {
      if (requestId === zoomRequestId) {
        zoomStatus.textContent = "无法生成放大预览";
      }
    }
  }, 180);
}

function hideZoom() {
  clearTimeout(zoomTimer);
  zoomRequestId += 1;
  zoomImage.removeAttribute("src");
  zoomOverlay.hidden = true;
  zoomOverlay.setAttribute("aria-hidden", "true");
}

async function exportCanvasPreview(item, maxSize) {
  const result = await collectFromAllFrames(currentTabId, {
    ...getBackgroundOptions(),
    exportMode: "zoom",
    previewMaxSize: maxSize,
    target: {
      sourceIndex: item.sourceIndex,
      selector: item.selector
    }
  });

  const exported = result.find((candidate) =>
    candidate.frameId === item.frameId &&
    candidate.sourceIndex === item.sourceIndex &&
    candidate.previewDataUrl
  );

  if (!exported || !exported.previewDataUrl) {
    throw new Error("未能生成放大预览");
  }

  return exported.previewDataUrl;
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
