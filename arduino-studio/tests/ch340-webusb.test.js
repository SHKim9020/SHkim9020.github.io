const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const driverSource = fs.readFileSync(path.join(root, "ch340-webserial.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

function loadDriver({ lockedSerial = false } = {}) {
  const listeners = new Map();
  const usb = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    async requestDevice(options) { this.requestOptions = options; return this.device; },
    async getDevices() { return this.device ? [this.device] : []; }
  };
  const navigator = { userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/150", usb };
  if (lockedSerial) {
    class LockedSerial extends EventTarget {}
    LockedSerial.prototype.requestPort = async () => "bluetooth";
    LockedSerial.prototype.getPorts = async () => [];
    const nativeSerial = Object.preventExtensions(new LockedSerial());
    Object.defineProperty(navigator, "serial", { configurable: false, value: nativeSerial });
  }
  const window = {};
  const context = {
    navigator, window, console: { ...console, info() {} }, setTimeout, clearTimeout,
    ReadableStream, WritableStream, EventTarget, Event, DOMException, Uint8Array, ArrayBuffer, DataView
  };
  vm.runInNewContext(driverSource, context, { filename: "ch340-webserial.js" });
  return { api: window.OneMakerCH340, navigator, usb, listeners };
}

test("Android adapter replaces Web Serial with the confirmed CH340 VID and PID", async () => {
  const { api, navigator, usb } = loadDriver();
  assert.equal(api.active, true);
  assert.equal(navigator.serial, api.serial);
  usb.device = { vendorId: 0x1a86, productId: 0x7523 };
  const port = await navigator.serial.requestPort();
  assert.equal(port.getInfo().usbVendorId, 0x1a86);
  assert.equal(port.getInfo().usbProductId, 0x7523);
  assert.equal(usb.requestOptions.filters.length, 1);
  assert.equal(usb.requestOptions.filters[0].vendorId, 0x1a86);
  assert.equal(usb.requestOptions.filters[0].productId, 0x7523);
});

test("CH340 divisor calculation covers UNO runtime and bootloader rates", () => {
  const { api } = loadDriver();
  assert.equal(api.calculateDivisor(9600), 0xb202);
  assert.equal(api.calculateDivisor(57600), 0x9803);
  assert.equal(api.calculateDivisor(115200), 0xcc03);
});

test("locked Android navigator.serial falls back to CH340 method patching", async () => {
  const { api, navigator, usb } = loadDriver({ lockedSerial: true });
  usb.device = { vendorId: 0x1a86, productId: 0x7523 };
  assert.equal(api.active, true);
  assert.equal(api.mode, "patched");
  const port = await navigator.serial.requestPort();
  assert.equal(port.getInfo().usbVendorId, 0x1a86);
  assert.equal(port.getInfo().usbProductId, 0x7523);
});

test("driver initializes CH340, discovers bulk endpoints, and pulses DTR/RTS", async () => {
  const { api, usb } = loadDriver();
  const transfers = [];
  let pendingRead;
  usb.device = {
    vendorId: 0x1a86,
    productId: 0x7523,
    opened: false,
    configuration: null,
    configurations: [{ configurationValue: 1 }],
    async open() { this.opened = true; },
    async selectConfiguration() {
      this.configuration = { interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, endpoints: [
        { type: "interrupt", direction: "in", endpointNumber: 1, packetSize: 8 },
        { type: "bulk", direction: "in", endpointNumber: 2, packetSize: 32 },
        { type: "bulk", direction: "out", endpointNumber: 2, packetSize: 32 }
      ] }] }] };
    },
    async claimInterface(number) { this.claimed = number; },
    async controlTransferIn(setup) {
      transfers.push(["in", setup.request, setup.value, setup.index]);
      return { status: "ok", data: new DataView(Uint8Array.from([0x27, 0]).buffer) };
    },
    async controlTransferOut(setup) {
      transfers.push(["out", setup.request, setup.value, setup.index]);
      return { status: "ok", bytesWritten: 0 };
    },
    transferIn() { return new Promise(resolve => { pendingRead = resolve; }); },
    async transferOut(endpoint, data) { this.lastWrite = [endpoint, [...data]]; return { status: "ok", bytesWritten: data.length }; },
    async releaseInterface() {},
    async close() { this.opened = false; }
  };

  const port = new api.CH340Port(usb.device, null);
  await port.open({ baudRate: 115200, bufferSize: 1024 });
  assert.equal(usb.device.claimed, 0);
  assert.ok(port.readable instanceof ReadableStream);
  assert.ok(port.writable instanceof WritableStream);
  assert.ok(transfers.some(item => item[0] === "out" && item[1] === 0xa1));
  assert.ok(transfers.some(item => item[0] === "out" && item[1] === 0x9a && item[2] === 0x1312 && item[3] === 0xcc03));
  assert.ok(transfers.some(item => item[0] === "out" && item[1] === 0xa4 && item[2] === 0xffff));
  assert.ok(transfers.some(item => item[0] === "out" && item[1] === 0xa4 && item[2] === 0xff9f));
  const writer = port.writable.getWriter();
  await writer.write(Uint8Array.from([0x30, 0x20]));
  writer.releaseLock();
  assert.deepEqual(usb.device.lastWrite, [2, [0x30, 0x20]]);
  await port.close();
  if (pendingRead) pendingRead({ status: "stall", data: null });
});

test("CH340 adapter loads before the uploader and is available offline", () => {
  assert.ok(html.indexOf("ch340-webserial.js") < html.indexOf("arduino-web-uploader"));
  assert.match(sw, /ch340-webserial\.js\?v=1\.0\.2/);
  assert.match(app, /OneMakerCH340\?\.active/);
  assert.match(html, /UNO CH340\(1A86:7523\)/);
});
