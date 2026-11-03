(() => {
  const contentVersion = "1.4.0";
  if (window.__canvasExtractorContentReady === contentVersion) {
    return;
  }

  window.__canvasExtractorContentReady = contentVersion;

  window.__canvasExtractorScan = async (request) => {
    const options = normalizeScanOptions(request);
    if (options.exportMode === "preview") {
      await readPageChartTitles();
    }
    const canvases = collectCanvasInfo(options);

    chrome.runtime.sendMessage({
      type: "CANVAS_EXTRACTOR_RESULT",
      scanTime: Date.now(),
      canvases
    });
  };

  function readPageChartTitles() {
    return new Promise((resolve) => {
      const parent = document.head || document.documentElement;
      if (!parent) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      let timer;
      function finish() {
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        script.remove();
        resolve();
      }

      script.onload = finish;
      script.onerror = finish;
      timer = setTimeout(finish, 250);
      try {
        script.src = chrome.runtime.getURL("chart-titles.js");
        parent.appendChild(script);
      } catch (_) {
        finish();
      }
    });
  }

  function normalizeScanOptions(request) {
    const isTransparent = request === "transparent" || request && request.backgroundMode === "transparent";
    const requestedColor = request && request.backgroundColor;
    return {
      backgroundMode: isTransparent ? "transparent" : "dark",
      backgroundColor: normalizeColor(requestedColor),
      filenameSelectors: normalizeSelectorList(request && request.filenameSelectors, request && request.filenamePrefixEnabled !== false),
      exportMode: request && ["full", "zoom"].indexOf(request.exportMode) !== -1 ? request.exportMode : "preview",
      previewMaxSize: normalizePreviewSize(request && request.previewMaxSize),
      target: request && request.target ? request.target : null
    };
  }

  function normalizeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value).toLowerCase() : "#0a0d19";
  }

  function normalizePreviewSize(value) {
    const size = Number(value);
    return Number.isFinite(size) && size >= 80 && size <= 1200 ? Math.round(size) : 240;
  }

  function normalizeSelectorList(value, isEnabled) {
    if (!isEnabled) {
      return [];
    }

    const raw = Array.isArray(value) ? value.join("；") : String(value || ".newKpi2.col .title span.text-blue");
    const selectors = raw.split(/[;；]/).map((item) => item.trim()).filter(Boolean);
    return selectors.length ? selectors : [".newKpi2.col .title span.text-blue"];
  }

  function collectCanvasInfo(options) {
    const pagePrefix = getPageFilenamePrefix(options.filenameSelectors);

    return [...document.querySelectorAll("canvas")].map((canvas, index) => {
      if (options.exportMode !== "preview" && !matchesTarget(canvas, index, options.target)) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();
      const styles = getComputedStyle(canvas);
      const info = {
        index,
        sourceIndex: index,
        name: inferName(canvas, index),
        width: canvas.width,
        height: canvas.height,
        displayWidth: Math.round(rect.width),
        displayHeight: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0 && styles.display !== "none" && styles.visibility !== "hidden",
        selector: makeSelector(canvas),
        filenamePrefix: pagePrefix,
        ipAddress: pagePrefix,
        backgroundMode: options.backgroundMode,
        backgroundColor: options.backgroundColor,
        exportable: false,
        previewDataUrl: "",
        dataUrl: "",
        error: ""
      };

      try {
        if (options.exportMode === "full") {
          info.dataUrl = exportCanvas(canvas, options.backgroundMode, options.backgroundColor, 0);
        } else {
          info.previewDataUrl = exportCanvas(canvas, options.backgroundMode, options.backgroundColor, options.previewMaxSize);
        }

        info.exportable = true;
      } catch (error) {
        info.error = error && error.message ? error.message : String(error);
      }

      return info;
    }).filter(Boolean).sort((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      return areaB - areaA;
    });
  }

  function matchesTarget(canvas, index, target) {
    if (!target) {
      return true;
    }

    if (Number(target.sourceIndex) !== index) {
      return false;
    }

    return !target.selector || makeSelector(canvas) === target.selector;
  }

  function makeSelector(element) {
    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const parts = [];
    let node = element;

    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = node.localName;

      if (node.classList && node.classList.length) {
        const className = [...node.classList].slice(0, 2).map((name) => cssEscape(name)).join(".");
        part += `.${className}`;
      }

      const parent = node.parentElement;
      if (parent) {
        const sameTagSiblings = [...parent.children].filter((child) => child.localName === node.localName);
        if (sameTagSiblings.length > 1) {
          part += `:nth-of-type(${sameTagSiblings.indexOf(node) + 1})`;
        }
      }

      parts.unshift(part);
      node = parent;
    }

    return parts.join(" > ");
  }

  function inferName(canvas, index) {
    const chartRoot = canvas.closest("[_echarts_instance_], .echarts, .v-chart, .vue-echarts, [class*=\"echarts\"]");
    const chartTitle = normalizeTitleText(canvas.getAttribute("data-canvas-extractor-title"));
    const labelled = normalizeTitleText(canvas.getAttribute("title") || canvas.getAttribute("aria-label"));
    const parentLabel = chartRoot && normalizeTitleText(chartRoot.getAttribute("title") || chartRoot.getAttribute("aria-label"));
    return chartTitle || getNearbyTitle(canvas, chartRoot) || labelled || parentLabel || `Canvas ${index + 1}`;
  }

  function getNearbyTitle(canvas, chartRoot) {
    const titleSelector = "h1, h2, h3, h4, h5, h6, [role=heading], [data-title], [class*=\"title\"], [class*=\"Title\"], .el-card__header, .ivu-card-head";
    let ancestor = chartRoot || canvas.parentElement;

    for (let depth = 0; ancestor && ancestor !== document.body && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const hasOtherChart = [...ancestor.querySelectorAll("canvas")].some((other) =>
        other !== canvas && (!chartRoot || !chartRoot.contains(other))
      );
      if (hasOtherChart) {
        break;
      }

      for (const candidate of ancestor.querySelectorAll(titleSelector)) {
        if (candidate === canvas || candidate.contains(canvas) || !candidate.getClientRects().length) {
          continue;
        }

        const text = normalizeTitleText(candidate.getAttribute("data-title") || candidate.innerText || candidate.textContent);
        if (text && text.length <= 100 && !isIgnoredTitle(candidate, text)) {
          return text;
        }
      }
    }

    return "";
  }

  function isIgnoredTitle(candidate, text) {
    return candidate.matches(".text-blue") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(text);
  }

  function normalizeTitleText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function exportCanvas(canvas, backgroundMode, backgroundColor, maxSize) {
    const output = document.createElement("canvas");
    const scale = getExportScale(canvas, maxSize);
    output.width = Math.max(1, Math.round(canvas.width * scale));
    output.height = Math.max(1, Math.round(canvas.height * scale));

    const context = output.getContext("2d");
    if (backgroundMode !== "transparent") {
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, output.width, output.height);
    }

    context.drawImage(canvas, 0, 0, output.width, output.height);

    return output.toDataURL("image/png");
  }

  function getExportScale(canvas, maxSize) {
    if (!maxSize) {
      return 1;
    }

    const largestSide = Math.max(canvas.width, canvas.height);
    return largestSide > maxSize ? maxSize / largestSide : 1;
  }

  function getPageFilenamePrefix(selectors) {
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        const rawText = node ? node.textContent.trim() : "";
        if (!rawText) {
          continue;
        }

        const ipMatch = rawText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
        return ipMatch ? ipMatch[0] : rawText;
      } catch (error) {
        continue;
      }
    }

    return "";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
})();
