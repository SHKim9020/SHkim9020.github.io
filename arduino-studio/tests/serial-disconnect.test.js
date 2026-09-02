const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const ch340 = fs.readFileSync(path.join(root, "ch340-webserial.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

test("disconnect updates UI before waiting for USB shutdown", () => {
  const start = app.indexOf("async function disconnectSerial()");
  const end = app.indexOf("function closeSerialState()", start);
  const body = app.slice(start, end);
  assert.ok(body.indexOf("closeSerialState();") < body.indexOf("reader?.cancel()"));
  assert.match(body, /Promise\.race\([\s\S]*sleep\(1500\)/);
});

test("serial read loop releases its own reader without a shared-state race", () => {
  assert.match(app, /const reader = serialPort\.readable\.getReader\(\);[\s\S]*reader\.read\(\)[\s\S]*reader\.releaseLock\(\)/);
  assert.match(app, /if \(serialReader === reader\) serialReader = null/);
});

test("CH340 stream cancellation closes the USB device", () => {
  assert.match(ch340, /cancel: \(\) => this\.close\(\)/);
});

test("disconnect fix cache version is consistent", () => {
  assert.match(index, /app\.js\?v=1\.5\.4/);
  assert.match(index, /ch340-webserial\.js\?v=1\.0\.2/);
  assert.match(sw, /onemaker-arduino-studio-1\.5\.4/);
  assert.match(sw, /ch340-webserial\.js\?v=1\.0\.2/);
});
