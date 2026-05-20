# Canvas Extractor

一个可直接加载到 Chrome 的 Manifest V3 扩展，用于从当前页面抽取 canvas 并下载为 PNG。适合 ECharts、v-chart、Chart.js 等最终渲染到 canvas 的图表页面。

## 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录：`canvas-extractor-extension`
5. 打开目标页面，等图表渲染完成后点击扩展图标

## 功能

- 扫描当前页面所有 `canvas`
- 显示预览、真实像素尺寸、页面显示尺寸和 CSS selector
- 文件名自动包含 `.newKpi2.col .title span.text-blue` 中的 IP 地址
- 单个下载 PNG，可选择 `#0a0d19` 深色背景或原始透明背景
- 一键下载全部可导出的 canvas
- 复制 canvas 报告，方便定位页面上的图表

## 注意

如果 canvas 内使用了没有 CORS 授权的跨域图片，浏览器会阻止 `toDataURL()`，对应项会显示为“受限”。纯 ECharts/v-chart 图表通常可以正常导出。
