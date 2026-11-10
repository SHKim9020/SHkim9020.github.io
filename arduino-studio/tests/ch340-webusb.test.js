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

function loadDriver({ lockedSerial = false, unoR3 = false } = {}) {
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
    navigator, window, document: { currentScript: { hasAttribute: name => unoR3 && name === "data-uno-r3" } },
    console: { ...console, info() {} }, setTimeout, clearTimeout,
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
  assert.equal(usb.requestOptions.filters[0].productId, undefined);
  usb.device = { vendorId: 0x2341, productId: 0x0043 };
  assert.equal((await navigator.serial.getPorts()).length, 0);
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
  assert.match(sw, /ch340-webserial\.js\?v=1\.0\.3/);
  assert.match(app, /OneMakerCH340\?\.active/);
  assert.match(app, /function preferredSerialApi\(\)/);
  assert.match(app, /ch340\?\.isAndroid && ch340\?\.supported && ch340\?\.serial/);
  assert.match(app, /return serialApi\.requestPort\(\{ filters: USB_SERIAL_FILTERS \}\)/);
  assert.match(app, /isCh340Port\(port\)/);
  assert.match(html, /UNO CH340\(1A86:7523\)/);
});

function unoR3Usb({ failDataClaim = false } = {}) {
  const commands = [];
  const device = {
    vendorId: 0x2341,
    productId: 0x0043,
    opened: false,
    configuration: {
      interfaces: [
        { interfaceNumber: 0, alternates: [{ interfaceClass: 0x02, interfaceSubclass: 0x02, endpoints: [] }] },
        { interfaceNumber: 1, alternates: [{ interfaceClass: 0x0a, endpoints: [
          { type: "bulk", direction: "in", endpointNumber: 3, packetSize: 64 },
          { type: "bulk", direction: "out", endpointNumber: 4, packetSize: 64 }
        ] }] }
      ]
    },
    async open() { this.opened = true; },
    async claimInterface(number) {
      if (number === 1 && failDataClaim) throw new DOMException("Interface unavailable", "NetworkError");
      commands.push(["claim", number]);
    },
    async controlTransferOut(setup, data) {
      assert.equal(setup.requestType, "class");
      assert.equal(setup.recipient, "interface");
      assert.equal(setup.index, 0);
      commands.push([setup.request, setup.value, data && [...new Uint8Array(data.buffer)]]);
      return { status: "ok" };
    },
    async transferIn(endpoint, length) {
      assert.equal(endpoint, 3);
      assert.equal(length, 64);
      return { status: "ok", data: new DataView(Uint8Array.from([0x14, 0x10]).buffer) };
    },
    async transferOut(endpoint, bytes) {
      commands.push(["write", endpoint, [...bytes]]);
      return { status: "ok" };
    },
    async releaseInterface(number) { commands.push(["release", number]); },
    async close() { this.opened = false; }
  };
  return { device, commands };
}

test("Text Studio Android chooser supports UNO R3 and CH340 through navigator.serial", async () => {
  const { usb, navigator } = loadDriver({ unoR3: true, lockedSerial: true });
  const { device } = unoR3Usb();
  usb.device = device;
  const port = await navigator.serial.requestPort();
  assert.equal(port.getInfo().usbVendorId, 0x2341);
  assert.deepEqual(JSON.parse(JSON.stringify(usb.requestOptions.filters)), [
    { vendorId: 0x1a86 },
    { vendorId: 0x2341, productId: 0x0043 },
    { vendorId: 0x2a03, productId: 0x0043 }
  ]);
  assert.equal((await navigator.serial.getPorts())[0], port);
  usb.device = { vendorId: 0x2341, productId: 0x805a };
  assert.equal((await navigator.serial.getPorts()).length, 0);
});

test("UNO R3 configures CDC and pulses DTR for upload, then reopens for monitoring", async () => {
  const { usb, navigator } = loadDriver({ unoR3: true });
  const { device, commands } = unoR3Usb();
  usb.device = device;
  const port = await navigator.serial.requestPort();

  await port.open({ baudRate: 115200 });
  assert.deepEqual(commands.slice(0, 5), [
    ["claim", 0], ["claim", 1], [0x20, 0, [0x00, 0xc2, 0x01, 0x00, 0, 0, 8]],
    [0x22, 0, undefined], [0x22, 3, undefined]
  ]);
  const writer = port.writable.getWriter();
  await writer.write(Uint8Array.from([0x30, 0x20]));
  writer.releaseLock();
  assert.ok(commands.some(command => command[0] === "write" && command[1] === 4));
  const reader = port.readable.getReader();
  assert.deepEqual([...(await reader.read()).value], [0x14, 0x10]);
  await reader.cancel();
  reader.releaseLock();
  assert.deepEqual(commands.slice(-2), [["release", 1], ["release", 0]]);
  assert.equal(device.opened, false);

  await port.open({ baudRate: 9600 });
  assert.ok(commands.some(([request, , data]) => request === 0x20 && data[0] === 0x80 && data[1] === 0x25));
  await port.close();
});

test("UNO R3 releases the control interface if claiming the data interface fails", async () => {
  const { usb, navigator } = loadDriver({ unoR3: true });
  const { device, commands } = unoR3Usb({ failDataClaim: true });
  usb.device = device;
  const port = await navigator.serial.requestPort();
  await assert.rejects(port.open({ baudRate: 9600 }), { name: "NetworkError" });
  assert.deepEqual(commands, [["claim", 0], ["release", 0]]);
  assert.equal(device.opened, false);
});
