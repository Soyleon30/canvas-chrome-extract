(() => {
  const fallbackOptions = {
    backgroundMode: "transparent",
    backgroundColor: "#0a0d19",
    filenamePrefixEnabled: true,
    filenameSelectors: [".newKpi2.col .title span.text-blue"]
  };

  function scan(options) {
    if (typeof window.__canvasExtractorScan === "function") {
      window.__canvasExtractorScan({
        ...fallbackOptions,
        ...options,
        backgroundMode: "transparent"
      });
    }
  }

  if (!chrome.storage || !chrome.storage.local) {
    scan(fallbackOptions);
    return;
  }

  chrome.storage.local.get(["canvasExtractorOptions"], (result) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      scan(fallbackOptions);
      return;
    }

    scan(result && result.canvasExtractorOptions);
  });
})();
