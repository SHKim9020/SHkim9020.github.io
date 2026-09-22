const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("USB port picker selects USB and paired Bluetooth COM transports without a race", () => {
  assert.match(html, /② USB\/Bluetooth 연결/);
  assert.match(app, /serialTransport = detectSerialTransport\(serialPort\)/);
  assert.match(app, /info\.usbVendorId !== undefined \|\| info\.usbProductId !== undefined/);
  assert.match(app, /serialTransport === "usb"\) await sendLine\("PING", true\)/);
  assert.match(app, /else await sendLine\("\\x1ePING", true\)/);
  assert.doesNotMatch(app, /serialTransport = "bluetooth";[\s\S]{0,180}serialTransport = "usb"/);
  assert.match(app, /serialTransport === "bluetooth" \? `\\x1e\$\{line\}` : line/);
});

test("runtime accepts framed control commands over default HC-05\/HC-06 pins", () => {
  assert.match(runtime, /beginBluetooth\(2, 3, 9600\)/);
  assert.match(runtime, /bluetooth->peek\(\) != 0x1e/);
  assert.match(runtime, /controlOutput = bluetooth;[\s\S]*processLine\(bluetoothControlLine \+ 1\)/);
  assert.match(runtime, /controlOutput->println\(RUNTIME_VERSION\)/);
});

test("ordinary Bluetooth messages remain available to existing blocks", () => {
  assert.match(runtime, /if \(!bluetooth->available\(\) \|\| bluetooth->peek\(\) != 0x1e\) return/);
  assert.doesNotMatch(runtime, /bluetoothUserPrefix/);
  assert.match(runtime, /String readBluetoothText\(\)[\s\S]*bluetooth->available\(\)/);
  assert.match(runtime, /numeric = bluetooth && bluetooth->available\(\) \? 1 : 0/);
});
