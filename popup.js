const statusEl = document.getElementById("status");
const pageInfoEl = document.getElementById("pageInfo");
const canvasListEl = document.getElementById("canvasList");
const refreshButton = document.getElementById("refreshButton");
const downloadAllButton = document.getElementById("downloadAllButton");
const copyReportButton = document.getElementById("copyReportButton");
const backgroundColorInput = document.getElementById("backgroundColorInput");
const backgroundColorText = document.getElementById("backgroundColorText");
const template = document.getElementById("canvasItemTemplate");

let currentCanvases = [];
let currentTabTitle = "page";
let currentBackgroundColor = "#0a0d19";

document.addEventListener("DOMContentLoaded", scanCurrentTab);
refreshButton.addEventListener("click", scanCurrentTab);
downloadAllButton.addEventListener("click", downloadAll);
copyReportButton.addEventListener("click", copyReport);
document.querySelectorAll("input[name='backgroundMode']").forEach((input) => {
  input.addEventListener("change", scanCurrentTab);
});
backgroundColorInput.addEventListener("input", syncBackgroundColorFromPicker);
backgroundColorText.addEventListener("change", syncBackgroundColorFromText);

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

    currentTabTitle = tab.title || "page";
    pageInfoEl.textContent = trimText(tab.url || currentTabTitle, 58);

    const result = await collectFromAllFrames(tab.id, getBackgroundOptions());
    currentCanvases = result;
    renderCanvases();
  } catch (error) {
    setStatus(`扫描失败：${error.message}`, true);
  }
}

async function collectFromAllFrames(tabId, backgroundOptions) {
  const batches = [];
  const scanStartedAt = Date.now();

  const collectPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(flattenCanvasBatches(batches));
    }, 900);

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

      batches.push({
        frameId: sender.frameId || 0,
        frameUrl: sender.url || "",
        canvases: Array.isArray(message.canvases) ? message.canvases : []
      });

      clearTimeout(timer);
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve(flattenCanvasBatches(batches));
      }, 250);
    }

    chrome.runtime.onMessage.addListener(onMessage);
  });

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"]
  });

  const triggerFile = backgroundOptions.backgroundMode === "transparent" ? "scan-transparent.js" : "scan-dark.js";
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (backgroundColor) => {
      window.__canvasExtractorBackgroundColor = backgroundColor;
    },
    args: [backgroundOptions.backgroundColor]
  });

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [triggerFile]
  });

  return collectPromise;
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

  const downloadable = currentCanvases.filter((item) => item.dataUrl);
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
    badge.textContent = item.dataUrl ? "可导出" : "受限";
    badge.classList.toggle("isError", !item.dataUrl);
    const ipText = item.ipAddress ? `，IP ${item.ipAddress}` : "";
    meta.textContent = `${item.width}x${item.height} 像素，页面显示 ${item.displayWidth}x${item.displayHeight}，frame ${item.frameId || 0}${ipText}`;
    selector.textContent = item.selector || "canvas";

    if (item.dataUrl) {
      preview.src = item.dataUrl;
      preview.alt = item.name;
    } else {
      preview.remove();
      fallback.style.display = "block";
      error.style.display = "block";
      error.textContent = item.error || "浏览器阻止读取此 canvas";
    }

    downloadButton.disabled = !item.dataUrl;
    copyButton.disabled = !item.dataUrl;
    downloadButton.addEventListener("click", () => downloadCanvas(item));
    copyButton.addEventListener("click", () => copyDataUrl(item));

    canvasListEl.appendChild(node);
  }
}

async function downloadAll() {
  const items = currentCanvases.filter((item) => item.dataUrl);
  for (const item of items) {
    await downloadCanvas(item, false);
  }
}

async function downloadCanvas(item, showDone = true) {
  const filename = makeFilename(item);
  await chrome.downloads.download({
    url: item.dataUrl,
    filename,
    saveAs: false
  });

  if (showDone) {
    setStatus(`已开始下载：${filename}`);
  }
}

async function copyDataUrl(item) {
  await navigator.clipboard.writeText(item.dataUrl);
  setStatus(`已复制：${item.name}`);
}

async function copyReport() {
  const report = currentCanvases.map((item) => [
    `#${item.index + 1} ${item.name}`,
    `size=${item.width}x${item.height}`,
    `display=${item.displayWidth}x${item.displayHeight}`,
    `visible=${item.visible}`,
    `exportable=${Boolean(item.dataUrl)}`,
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
    backgroundColor: currentBackgroundColor
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

function normalizeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value).toLowerCase() : "#0a0d19";
}

function trimText(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value || "";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}
