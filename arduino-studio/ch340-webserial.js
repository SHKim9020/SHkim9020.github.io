(function () {
  "use strict";

  const CH340_VENDOR_ID = 0x1a86;
  const CH340_PRODUCT_ID = 0x7523;
  const REQUEST = Object.freeze({
    READ_VERSION: 0x5f,
    WRITE_REGISTER: 0x9a,
    READ_REGISTER: 0x95,
    SERIAL_INIT: 0xa1,
    MODEM_CONTROL: 0xa4
  });
  const REGISTER = Object.freeze({ PRESCALER: 0x12, DIVISOR: 0x13, LCR: 0x18, LCR2: 0x25 });
  const MODEM = Object.freeze({ DTR: 1 << 5, RTS: 1 << 6 });
  const LCR_8N1 = 0x80 | 0x40 | 0x03;
  const USB_FILTERS = Object.freeze([{ vendorId: CH340_VENDOR_ID, productId: CH340_PRODUCT_ID }]);
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function assertUsbResult(result, operation) {
    if (!result || result.status !== "ok") {
      throw new DOMException(`${operation} 실패 (${result?.status || "응답 없음"})`, "NetworkError");
    }
    return result;
  }

  // Linux ch341.c의 48 MHz clock/divisor 계산과 동일한 결과를 사용한다.
  function calculateDivisor(requestedBaudRate) {
    const clockRate = 48000000;
    const speed = Math.max(46, Math.min(3000000, Number(requestedBaudRate) || 9600));
    let prescaler = 3;
    let factor = 1;

    for (; prescaler >= 0; prescaler--) {
      const clockDivisor = 2 ** (12 - (3 * prescaler) - 1);
      if (speed > clockRate / (clockDivisor * 512)) break;
    }
    if (prescaler < 0) throw new RangeError(`지원하지 않는 보레이트: ${requestedBaudRate}`);

    let clockDivisor = 2 ** (12 - (3 * prescaler) - factor);
    let divisor = Math.floor(clockRate / (clockDivisor * speed));
    if (divisor < 9 || divisor > 255) {
      divisor = Math.floor(divisor / 2);
      clockDivisor *= 2;
      factor = 0;
    }
    const currentError = Math.abs(clockRate / (clockDivisor * divisor) - speed);
    const nextError = Math.abs(clockRate / (clockDivisor * (divisor + 1)) - speed);
    if (nextError <= currentError) divisor++;
    if (factor === 1 && divisor % 2 === 0) {
      divisor /= 2;
      factor = 0;
    }
    return ((0x100 - divisor) << 8) | (factor << 2) | prescaler;
  }

  class CH340Port {
    constructor(device, owner) {
      this.device = device;
      this.owner = owner;
      this.readable = null;
      this.writable = null;
      this.interfaceNumber = null;
      this.alternateSetting = 0;
      this.inEndpoint = null;
      this.outEndpoint = null;
      this.inPacketSize = 64;
      this.chipVersion = 0x27;
      this.opened = false;
      this.closing = false;
      this.signals = { dataTerminalReady: false, requestToSend: false };
    }

    getInfo() {
      return { usbVendorId: this.device.vendorId, usbProductId: this.device.productId };
    }

    async forget() {
      if (typeof this.device.forget === "function") await this.device.forget();
    }

    async controlOut(request, value = 0, index = 0) {
      const result = await this.device.controlTransferOut({
        requestType: "vendor",
        recipient: "device",
        request,
        value: value & 0xffff,
        index: index & 0xffff
      });
      return assertUsbResult(result, `CH340 제어 명령 0x${request.toString(16)}`);
    }

    async controlIn(request, value = 0, index = 0, length = 2) {
      const result = await this.device.controlTransferIn({
        requestType: "vendor",
        recipient: "device",
        request,
        value: value & 0xffff,
        index: index & 0xffff
      }, length);
      return assertUsbResult(result, `CH340 상태 명령 0x${request.toString(16)}`);
    }

    findBulkInterface() {
      for (const usbInterface of this.device.configuration?.interfaces || []) {
        for (const alternate of usbInterface.alternates || []) {
          const input = alternate.endpoints?.find(endpoint => endpoint.type === "bulk" && endpoint.direction === "in");
          const output = alternate.endpoints?.find(endpoint => endpoint.type === "bulk" && endpoint.direction === "out");
          if (input && output) return { usbInterface, alternate, input, output };
        }
      }
      throw new DOMException("CH340 벌크 IN/OUT 엔드포인트를 찾지 못했습니다.", "NotSupportedError");
    }

    async configureLine(options) {
      const baudRate = options.baudRate || 9600;
      if ((options.dataBits || 8) !== 8 || (options.stopBits || 1) !== 1 || (options.parity || "none") !== "none") {
        throw new DOMException("현재 CH340 WebUSB는 8-N-1 통신만 지원합니다.", "NotSupportedError");
      }
      let divisor = calculateDivisor(baudRate);
      if (this.chipVersion > 0x27) divisor |= 0x80;
      await this.controlOut(REQUEST.WRITE_REGISTER, (REGISTER.DIVISOR << 8) | REGISTER.PRESCALER, divisor);
      if (this.chipVersion >= 0x30) {
        await this.controlOut(REQUEST.WRITE_REGISTER, (REGISTER.LCR2 << 8) | REGISTER.LCR, LCR_8N1);
      }
    }

    async setSignals(signals = {}) {
      if (Object.prototype.hasOwnProperty.call(signals, "dataTerminalReady")) {
        this.signals.dataTerminalReady = Boolean(signals.dataTerminalReady);
      }
      if (Object.prototype.hasOwnProperty.call(signals, "requestToSend")) {
        this.signals.requestToSend = Boolean(signals.requestToSend);
      }
      let control = 0;
      if (this.signals.dataTerminalReady) control |= MODEM.DTR;
      if (this.signals.requestToSend) control |= MODEM.RTS;
      await this.controlOut(REQUEST.MODEM_CONTROL, (~control) & 0xffff, 0);
    }

    async getSignals() {
      const result = await this.controlIn(REQUEST.READ_REGISTER, 0x0706, 0, 2);
      const status = (~result.data.getUint8(0)) & 0x0f;
      return {
        clearToSend: Boolean(status & 0x01),
        dataSetReady: Boolean(status & 0x02),
        ringIndicator: Boolean(status & 0x04),
        dataCarrierDetect: Boolean(status & 0x08)
      };
    }

    async open(options = {}) {
      if (this.opened) throw new DOMException("직렬 포트가 이미 열려 있습니다.", "InvalidStateError");
      this.closing = false;
      try {
        if (!this.device.opened) await this.device.open();
        if (!this.device.configuration) {
          const configurationValue = this.device.configurations?.[0]?.configurationValue || 1;
          await this.device.selectConfiguration(configurationValue);
        }
        const descriptor = this.findBulkInterface();
        this.interfaceNumber = descriptor.usbInterface.interfaceNumber;
        this.alternateSetting = descriptor.alternate.alternateSetting || 0;
        this.inEndpoint = descriptor.input.endpointNumber;
        this.outEndpoint = descriptor.output.endpointNumber;
        this.inPacketSize = descriptor.input.packetSize || 64;

        await this.device.claimInterface(this.interfaceNumber);
        if (this.alternateSetting) await this.device.selectAlternateInterface(this.interfaceNumber, this.alternateSetting);

        const versionResult = await this.controlIn(REQUEST.READ_VERSION, 0, 0, 2);
        this.chipVersion = versionResult.data?.byteLength ? versionResult.data.getUint8(0) : 0x27;
        await this.controlOut(REQUEST.SERIAL_INIT, 0, 0);
        await this.configureLine(options);
        await this.setSignals({ dataTerminalReady: false, requestToSend: false });
        await delay(60);
        await this.setSignals({ dataTerminalReady: true, requestToSend: true });
        await delay(220);

        this.opened = true;
        this.createStreams(options.bufferSize || 255);
      } catch (error) {
        await this.cleanupDevice();
        throw error;
      }
    }

    createStreams(bufferSize) {
      const transferLength = Math.max(this.inPacketSize, Math.min(4096, bufferSize || 255));
      this.readable = new ReadableStream({
        pull: async controller => {
          if (!this.opened || this.closing) return controller.close();
          try {
            const result = assertUsbResult(await this.device.transferIn(this.inEndpoint, transferLength), "CH340 읽기");
            if (result.data?.byteLength) {
              const bytes = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
              controller.enqueue(new Uint8Array(bytes));
            }
          } catch (error) {
            if (this.opened && !this.closing) controller.error(error);
          }
        },
        cancel: () => { this.closing = true; }
      });
      this.writable = new WritableStream({
        write: async chunk => {
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          assertUsbResult(await this.device.transferOut(this.outEndpoint, bytes), "CH340 쓰기");
        }
      });
    }

    async cleanupDevice() {
      if (this.device.opened && this.interfaceNumber !== null) {
        await this.device.releaseInterface(this.interfaceNumber).catch(() => {});
      }
      if (this.device.opened) await this.device.close().catch(() => {});
      this.interfaceNumber = null;
    }

    async close() {
      if (!this.device.opened && !this.opened) return;
      this.closing = true;
      this.opened = false;
      await this.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
      this.readable = null;
      this.writable = null;
      await this.cleanupDevice();
      this.closing = false;
    }

    handleDisconnect() {
      this.closing = true;
      this.opened = false;
      this.readable = null;
      this.writable = null;
    }
  }

  class CH340Serial extends EventTarget {
    constructor(usb) {
      super();
      this.usb = usb;
      this.ports = new Map();
      this.usb.addEventListener("disconnect", event => {
        const port = this.ports.get(event.device);
        if (!port) return;
        port.handleDisconnect();
        this.dispatchEvent(new Event("disconnect"));
      });
      this.usb.addEventListener("connect", event => {
        if (event.device.vendorId === CH340_VENDOR_ID && event.device.productId === CH340_PRODUCT_ID) {
          this.dispatchEvent(new Event("connect"));
        }
      });
    }

    portFor(device) {
      if (!this.ports.has(device)) this.ports.set(device, new CH340Port(device, this));
      return this.ports.get(device);
    }

    async requestPort() {
      const device = await this.usb.requestDevice({ filters: USB_FILTERS.map(filter => ({ ...filter })) });
      return this.portFor(device);
    }

    async getPorts() {
      const devices = await this.usb.getDevices();
      return devices
        .filter(device => device.vendorId === CH340_VENDOR_ID && device.productId === CH340_PRODUCT_ID)
        .map(device => this.portFor(device));
    }
  }

  const api = {
    active: false,
    isAndroid: isAndroid(),
    supported: Boolean(navigator.usb),
    filters: USB_FILTERS,
    calculateDivisor,
    CH340Port,
    CH340Serial
  };

  if (api.isAndroid && navigator.usb) {
    const serial = new CH340Serial(navigator.usb);
    try {
      Object.defineProperty(navigator, "serial", { configurable: true, enumerable: true, value: serial });
      api.active = navigator.serial === serial;
      api.serial = serial;
    } catch (error) {
      console.warn("OneMaker CH340 WebUSB adapter could not replace navigator.serial:", error);
    }
  }

  window.OneMakerCH340 = api;
}());
