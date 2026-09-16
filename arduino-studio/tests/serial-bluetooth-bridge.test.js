const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("USB port picker also probes a paired Bluetooth COM port", () => {
  assert.match(html, /② USB\/Bluetooth 연결/);
  assert.match(app, /await sendLine\("OM:PING", true\)/);
  assert.match(app, /parts\[3\] === "BT" \? "bluetooth" : "usb"/);
  assert.match(app, /serialTransport === "bluetooth" \? `OM:\$\{line\}` : line/);
});

test("runtime accepts framed control commands over default HC-05\/HC-06 pins", () => {
  assert.match(runtime, /beginBluetooth\(2, 3, 9600\)/);
  assert.match(runtime, /!strncmp\(bluetoothControlLine, "OM:", 3\)/);
  assert.match(runtime, /controlOutput = bluetooth;[\s\S]*processLine\(bluetoothControlLine \+ 3\)/);
  assert.match(runtime, /controlOutput == bluetooth \? F\(",BT"\) : F\(",USB"\)/);
});

test("ordinary Bluetooth messages remain available to existing blocks", () => {
  assert.match(runtime, /bluetooth->peek\(\) != 'O'/);
  assert.match(runtime, /bluetoothUserPrefixLength > 0/);
  assert.match(runtime, /String readBluetoothText\(\)[\s\S]*bluetoothUserPrefixLength/);
  assert.match(runtime, /numeric = bluetoothDataAvailable\(\) \? 1 : 0/);
});
