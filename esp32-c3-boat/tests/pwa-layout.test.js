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

test("installed desktop app restores the top controls after a responsive scroll", () => {
  assert.doesNotMatch(JSON.stringify(manifest), /window-controls-overlay/);
  assert.match(app, /function resetDesktopViewport\(\)/);
  assert.match(app, /history\.scrollRestoration = "manual"/);
  assert.match(app, /document\.body\.addEventListener\("scroll", reset/);
  assert.match(app, /blocklyArea\?\.addEventListener\("pointerdown", resetAfterFocus, true\)/);
  assert.match(app, /blocklyArea\?\.addEventListener\("focusin", resetAfterFocus, true\)/);
  assert.match(css, /html,body\{overflow:clip;scroll-behavior:auto/);
  assert.match(css, /@media\(display-mode:window-controls-overlay\)/);
});

test("app is installable as a standalone PWA with icons", () => {
  assert.match(html, /rel="manifest"/);
  assert.match(html, /id="installAppBtn"/);
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable"));
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /serviceWorker\.register/);
  assert.match(serviceWorker, /onemaker-boat-studio-1\.4\.23/);
});

test("remote control stops when Android loses the button release event", () => {
  assert.match(app, /lostpointercapture/);
  assert.match(app, /window\.addEventListener\("pointerup", stopHeldRemote, true\)/);
  assert.match(app, /window\.addEventListener\("pointercancel", stopHeldRemote, true\)/);
  assert.match(app, /window\.addEventListener\("blur", stopHeldRemote\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
});

test("board, remote control, and serial monitor expose stable scrollbars", () => {
  assert.match(css, /\.app-shell\{[^}]*grid-template-rows:minmax\(0,1fr\)[^}]*min-height:0/);
  assert.match(css, /\.editor-pane,\.side-pane\{[^}]*height:100%[^}]*min-height:0/);
  assert.match(css, /\.side-tabs\{[^}]*flex:0 0 44px/);
  assert.match(css, /\.tab-panel\[data-panel="board"\],\.tab-panel\[data-panel="remote"\]\{[^}]*overflow-y:scroll[^}]*scrollbar-gutter:stable/);
  assert.match(css, /#serialOutput\{[^}]*overflow-y:scroll[^}]*scrollbar-gutter:stable/);
  assert.match(css, /#serialOutput::\-webkit-scrollbar\{width:12px/);
});
