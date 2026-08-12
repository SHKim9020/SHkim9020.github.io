const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));

test("manifest launches Android Chrome as a standalone app", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./?source=pwa");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.theme_color, "#152b43");
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512", "512x512"]);
});

test("page exposes install UI, icon metadata, and versioned PWA assets", () => {
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /id="pwaInstallBtn"/);
  assert.match(html, /id="pwaInstallDialog"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/icon-192\.png"/);
  assert.match(html, /app\.js\?v=1\.4\.0/);
});

test("app handles native installation and fallback instructions", () => {
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /deferredInstallPrompt\.prompt\(\)/);
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /serviceWorker\.register\("\.\/sw\.js"\)/);
});

test("service worker caches and refreshes the app shell", () => {
  assert.match(sw, /onemaker-arduino-studio-1\.4\.0/);
  assert.match(sw, /cache\.addAll\(APP_SHELL\)/);
  assert.match(sw, /event\.request\.mode === "navigate"/);
  assert.match(sw, /caches\.delete/);
});

test("required Android launcher icons exist", () => {
  for (const file of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
    const bytes = fs.readFileSync(path.join(root, "icons", file));
    assert.ok(bytes.length > 1000, `${file} is unexpectedly small`);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  }
});
