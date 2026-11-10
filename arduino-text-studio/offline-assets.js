(() => {
  "use strict";
  const base = new URL("./", self.location.href);
  const resolve = path => new URL(path, base).href;
  const toolRoot = "https://cdn.jsdelivr.net/npm/@horang-corp/avr-gcc-wasm@0.2.0/tools/";
  const uploader = "https://github.com/dbuezas/arduino-web-uploader/releases/download/v1.0.0/main.js";
  const parserRoot = "https://cdn.jsdelivr.net/npm/web-tree-sitter@0.25.10/";
  self.OneMakerOffline = {
    cachePrefix: "onemaker-arduino-text-offline-",
    cacheName: "onemaker-arduino-text-offline-v3",
    page: resolve("index.html"),
    ready: resolve(".offline-ready"),
    uploader,
    urls: [
      "index.html", "style.css?v=4", "app.js?v=4", "plotter.js?v=1", "editor.js?v=1", "offline.js?v=3",
      "offline-assets.js?v=3", "compiler-worker.mjs?v=1",
      "vendor/prism-cpp.js?v=1.30.0", uploader,
      "../arduino-studio/ch340-webserial.js?v=1.0.3", "../arduino-studio/measurements.js?v=1.0.0",
      "../arduino-studio/sketch.js?v=1.3.0", "../arduino-studio/browser-avr-core.mjs?v=1",
      "../arduino-studio/browser-avr-2.json.gz",
      ...["cc1plus", "avr-as", "avr-ld", "avr-objcopy"].flatMap(tool =>
        [toolRoot + tool + ".mjs", toolRoot + tool + ".wasm"]
      ),
      parserRoot + "tree-sitter.js", parserRoot + "tree-sitter.wasm",
      "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out/tree-sitter-cpp.wasm",
    ].map(resolve),
  };
})();
