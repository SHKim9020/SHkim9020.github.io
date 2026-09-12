const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const runtime = fs.readFileSync(
  path.join(__dirname, "..", "firmware", "boat_runtime", "boat_runtime.ino"),
  "utf8"
);

test("Wi-Fi Blockly blocks compile to runtime operations", () => {
  for (const block of ["wifi_connect", "wifi_disconnect", "wifi_connected", "wifi_ip"]) {
    assert.match(app, new RegExp(`type: ["']${block}["']`));
  }
  assert.match(app, /op:\s*["']wifiConnect["']/);
  assert.match(app, /op:\s*["']wifiDisconnect["']/);
  assert.match(app, /type:\s*["']wifiConnected["']/);
  assert.match(app, /type:\s*["']wifiIp["']/);
});

test("runtime connects as a station while preserving the boat access point", () => {
  assert.match(runtime, /WiFi\.mode\(webRemoteActive \? WIFI_AP_STA : WIFI_STA\)/);
  assert.match(runtime, /WiFi\.begin\(ssid\.c_str\(\), password\.c_str\(\)\)/);
  assert.match(runtime, /strcmp\(op, ["']wifiConnect["']\)/);
  assert.match(runtime, /strcmp\(type, ["']wifiConnected["']\)/);
  assert.match(runtime, /strcmp\(type, ["']wifiIp["']\)/);
});

test("web app refuses Wi-Fi blocks on an older runtime", () => {
  assert.match(app, /WIFI_BLOCKS_FIRMWARE_MIN\s*=\s*\[1,\s*5,\s*0\]/);
  assert.match(app, /Wi-Fi 연결 블록은 펌웨어 1\.5\.0이 필요합니다/);
});
