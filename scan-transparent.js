(() => {
  if (typeof window.__canvasExtractorScan === "function") {
    window.__canvasExtractorScan({
      backgroundMode: "transparent",
      backgroundColor: window.__canvasExtractorBackgroundColor || "#0a0d19"
    });
  }
})();
