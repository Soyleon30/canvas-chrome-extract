(() => {
  if (typeof window.__canvasExtractorScan === "function") {
    window.__canvasExtractorScan({
      backgroundMode: "dark",
      backgroundColor: window.__canvasExtractorBackgroundColor || "#0a0d19",
      filenamePrefixEnabled: window.__canvasExtractorFilenamePrefixEnabled !== false,
      filenameSelectors: window.__canvasExtractorFilenameSelectors || [".newKpi2.col .title span.text-blue"]
    });
  }
})();
