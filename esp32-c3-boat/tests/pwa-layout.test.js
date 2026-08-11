const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const html = read("index.html");
const css = read("style.css");
const app = read("app.js");
const manifest = JSON.parse(read("manifest.webmanifest"));
const serviceWorker = read("sw.js");

test("selected text remains visible in the highlighted C++ editor", () => {
  assert.match(css, /#codeView::selection\{[^}]*color:#fff[^}]*-webkit-text-fill-color:#fff/);
});

test("side panel preserves a usable block editor width", () => {
  assert.match(app, /minimumEditorWidth = window\.innerWidth <= 1180 \? 420 : 460/);
  assert.match(app, /shellWidth - minimumEditorWidth - 10/);
  assert.match(app, /window\.addEventListener\("resize"/);
});

test("app is installable as a standalone PWA with icons", () => {
  assert.match(html, /rel="manifest"/);
  assert.match(html, /id="installAppBtn"/);
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable"));
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /serviceWorker\.register/);
  assert.match(serviceWorker, /onemaker-boat-studio-1\.4\.17/);
});
