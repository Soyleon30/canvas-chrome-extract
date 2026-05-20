(() => {
  if (window.__canvasExtractorContentReady) {
    return;
  }

  window.__canvasExtractorContentReady = true;

  window.__canvasExtractorScan = (requestedMode) => {
    const backgroundMode = requestedMode === "transparent" ? "transparent" : "dark";
    const canvases = collectCanvasInfo(backgroundMode);

    chrome.runtime.sendMessage({
      type: "CANVAS_EXTRACTOR_RESULT",
      scanTime: Date.now(),
      canvases
    });
  };

  function collectCanvasInfo(backgroundMode) {
    const pageIp = getPageIpAddress();

    return [...document.querySelectorAll("canvas")].map((canvas, index) => {
      const rect = canvas.getBoundingClientRect();
      const styles = getComputedStyle(canvas);
      const info = {
        index,
        name: inferName(canvas, index),
        width: canvas.width,
        height: canvas.height,
        displayWidth: Math.round(rect.width),
        displayHeight: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0 && styles.display !== "none" && styles.visibility !== "hidden",
        selector: makeSelector(canvas),
        ipAddress: pageIp,
        backgroundMode,
        dataUrl: "",
        error: ""
      };

      try {
        info.dataUrl = backgroundMode === "transparent"
          ? canvas.toDataURL("image/png")
          : exportCanvasWithBackground(canvas, "#0a0d19");
      } catch (error) {
        info.error = error && error.message ? error.message : String(error);
      }

      return info;
    }).sort((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      return areaB - areaA;
    });
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
    const chartRoot = canvas.closest("[_echarts_instance_], .echarts, .v-chart, [data-v-app]");
    const labelled = canvas.getAttribute("aria-label") || canvas.getAttribute("title");
    const parentLabel = chartRoot && (chartRoot.getAttribute("aria-label") || chartRoot.getAttribute("title"));
    return labelled || parentLabel || `Canvas ${index + 1}`;
  }

  function exportCanvasWithBackground(canvas, backgroundColor) {
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;

    const context = output.getContext("2d");
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(canvas, 0, 0);

    return output.toDataURL("image/png");
  }

  function getPageIpAddress() {
    const ipNode = document.querySelector(".newKpi2.col .title span.text-blue");
    const rawText = ipNode ? ipNode.textContent.trim() : "";
    const match = rawText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    return match ? match[0] : rawText;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
})();
