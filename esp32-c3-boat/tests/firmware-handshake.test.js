const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

test("upload retries the firmware hello handshake before feature checks", () => {
  assert.match(app, /async function ensureBoardRuntime\(preferredTransport = null\)/);
  assert.match(app, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
  assert.match(app, /await ensureBoardRuntime\(serialWriter \? "serial" : "ble"\)/);
  const uploadStart = app.indexOf("async function uploadAndRun()");
  const waitFeatureCheck = app.indexOf("settings.waitForBluetoothStart", uploadStart);
  const handshakeCheck = app.indexOf("await ensureBoardRuntime", uploadStart);
  assert.ok(handshakeCheck > uploadStart && handshakeCheck < waitFeatureCheck);
});

test("an open USB port can retry version detection without reconnecting", () => {
  assert.match(app, /if \(serialPort\?\.readable && serialPort\?\.writable\) \{[\s\S]*?await ensureBoardRuntime\("serial"\)/);
  assert.match(app, /USB는 연결됐지만 보드 응답이 늦습니다/);
});
