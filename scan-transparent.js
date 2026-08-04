(() => {
  if (typeof window.__canvasExtractorScan === "function") {
    window.__canvasExtractorScan({
      backgroundMode: "transparent",
      backgroundColor: window.__canvasExtractorBackgroundColor || "#0a0d19",
      filenamePrefixEnabled: window.__canvasExtractorFilenamePrefixEnabled !== false,
      filenameSelectors: window.__canvasExtractorFilenameSelectors || [".newKpi2.col .title span.text-blue"],
      exportMode: window.__canvasExtractorExportMode || "preview",
      previewMaxSize: window.__canvasExtractorPreviewMaxSize || 240,
      target: window.__canvasExtractorTarget || null
    });
  }
})();
