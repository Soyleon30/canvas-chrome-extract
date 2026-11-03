(() => {
  const titleAttribute = "data-canvas-extractor-title";
  const chartSelector = "[_echarts_instance_], .echarts, .v-chart, .vue-echarts, [class*=\"echarts\"]";
  const titlesByRoot = new Map();

  for (const canvas of document.querySelectorAll("canvas")) {
    const root = canvas.closest(chartSelector) || canvas.parentElement || canvas;
    canvas.removeAttribute(titleAttribute);

    try {
      if (!titlesByRoot.has(root)) {
        titlesByRoot.set(root, findTitle(canvas, root));
      }
      const title = titlesByRoot.get(root);
      if (title) {
        canvas.setAttribute(titleAttribute, title);
      }
    } catch (_) {
      // A page component must not prevent other charts from being scanned.
    }
  }

  function findTitle(canvas, root) {
    const api = window.echarts || window.ECharts;
    if (api && typeof api.getInstanceByDom === "function") {
      try {
        const title = readSource(api.getInstanceByDom(root), new Set(), 0);
        if (title) {
          return title;
        }
      } catch (_) {
        // Vue may own an ECharts module that has no global instance.
      }
    }

    let node = canvas;
    const seen = new Set();
    for (let depth = 0; node && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
      const title = readSource(node.__vue__, seen, 0) ||
        readSource(node.__vueParentComponent, seen, 0);
      if (title) {
        return title;
      }
    }
    return "";
  }

  function readSource(source, seen, depth) {
    if (!source || typeof source !== "object" || depth > 5 || seen.has(source) || seen.size >= 60) {
      return "";
    }
    seen.add(source);

    // Read the title model or Vue props first, avoiding a clone of large series data.
    try {
      if (typeof source.getModel === "function") {
        const model = source.getModel();
        const titleModel = model && model.getComponent("title");
        if (titleModel) {
          const title = titleFromOption({ title: titleModel.option });
          if (title) {
            return title;
          }
        }
      }
    } catch (_) {
      // Older chart wrappers may only expose getOption().
    }

    for (const key of ["option", "options", "computedOptions"]) {
      try {
        const title = titleFromOption(source[key] && (source[key].value || source[key]));
        if (title) {
          return title;
        }
      } catch (_) {
        continue;
      }
    }

    try {
      if (typeof source.getOption === "function") {
        const title = titleFromOption(source.getOption());
        if (title) {
          return title;
        }
      }
    } catch (_) {
      // Try the wrapper's props or exposed component API.
    }

    for (const key of ["$props", "props", "exposed", "setupState", "ctx", "proxy", "chart", "value"]) {
      try {
        if (!(key in source)) {
          continue;
        }
        const title = readSource(source[key], seen, depth + 1);
        if (title) {
          return title;
        }
      } catch (_) {
        continue;
      }
    }
    return "";
  }

  function titleFromOption(option) {
    const titles = option && (Array.isArray(option.title) ? option.title : [option.title]);
    if (!titles) {
      return "";
    }
    for (const title of titles) {
      if (!title || title.show === false) {
        continue;
      }
      const text = normalizeText(title.text) || normalizeText(title.subtext);
      if (text) {
        return text;
      }
    }
    return "";
  }

  function normalizeText(value) {
    return typeof value === "string" || typeof value === "number"
      ? String(value).replace(/\s+/g, " ").trim().slice(0, 100)
      : "";
  }
})();
