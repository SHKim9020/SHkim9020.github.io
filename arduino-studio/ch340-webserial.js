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
  // CH340-compatible boards can report product IDs other than 0x7523.
  const USB_FILTERS = Object.freeze([{ vendorId: CH340_VENDOR_ID }]);
  // Stock Arduino UNO R3 USB-to-serial firmware (ATmega16U2).
  const UNO_R3_FILTERS = Object.freeze([
    { vendorId: 0x2341, productId: 0x0043 },
    { vendorId: 0x2a03, productId: 0x0043 }
  ]);
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

  class UsbSerialPort {
    constructor(device) {
      this.device = device;
      this.readable = null;
      this.writable = null;
      this.inEndpoint = null;
      this.outEndpoint = null;
      this.inPacketSize = 64;
      this.claimedInterfaces = [];
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

    findBulkInterface(interfaces) {
      for (const usbInterface of interfaces) {
        for (const alternate of usbInterface.alternates || []) {
          const input = alternate.endpoints?.find(endpoint => endpoint.type === "bulk" && endpoint.direction === "in");
          const output = alternate.endpoints?.find(endpoint => endpoint.type === "bulk" && endpoint.direction === "out");
          if (input && output) return { usbInterface, alternate, input, output };
        }
      }
      throw new DOMException("USB 벌크 IN/OUT 엔드포인트를 찾지 못했습니다.", "NotSupportedError");
    }

    async claimInterface(interfaceNumber, alternateSetting = 0) {
      await this.device.claimInterface(interfaceNumber);
      this.claimedInterfaces.push(interfaceNumber);
      if (alternateSetting) await this.device.selectAlternateInterface(interfaceNumber, alternateSetting);
    }

    async claimPortInterfaces() {
      const descriptor = this.findBulkInterface(this.device.configuration?.interfaces || []);
      await this.claimInterface(descriptor.usbInterface.interfaceNumber, descriptor.alternate.alternateSetting);
      return descriptor;
    }

    async setSignals(signals = {}) {
      if (Object.prototype.hasOwnProperty.call(signals, "dataTerminalReady")) {
        this.signals.dataTerminalReady = Boolean(signals.dataTerminalReady);
      }
      if (Object.prototype.hasOwnProperty.call(signals, "requestToSend")) {
        this.signals.requestToSend = Boolean(signals.requestToSend);
      }
      await this.applySignals();
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
        const descriptor = await this.claimPortInterfaces();
        this.inEndpoint = descriptor.input.endpointNumber;
        this.outEndpoint = descriptor.output.endpointNumber;
        this.inPacketSize = descriptor.input.packetSize || 64;

        await this.initialize(options);
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
            const result = assertUsbResult(await this.device.transferIn(this.inEndpoint, transferLength), "USB 시리얼 읽기");
            if (result.data?.byteLength) {
              const bytes = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
              controller.enqueue(new Uint8Array(bytes));
            }
          } catch (error) {
            if (this.opened && !this.closing) controller.error(error);
          }
        },
        // A pending WebUSB transferIn does not finish just because `closing` changes.
        // Close the USB device so reader.cancel() always settles.
        cancel: () => this.close()
      });
      this.writable = new WritableStream({
        write: async chunk => {
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          assertUsbResult(await this.device.transferOut(this.outEndpoint, bytes), "USB 시리얼 쓰기");
        }
      });
    }

    async cleanupDevice() {
      for (const interfaceNumber of this.claimedInterfaces.splice(0).reverse()) {
        if (this.device.opened) await this.device.releaseInterface(interfaceNumber).catch(() => {});
      }
      if (this.device.opened) await this.device.close().catch(() => {});
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

  class CH340Port extends UsbSerialPort {
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

    async applySignals() {
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

    async initialize(options) {
      const versionResult = await this.controlIn(REQUEST.READ_VERSION, 0, 0, 2);
      this.chipVersion = versionResult.data?.byteLength ? versionResult.data.getUint8(0) : 0x27;
      await this.controlOut(REQUEST.SERIAL_INIT, 0, 0);
      await this.configureLine(options);
    }
  }

  class UnoCdcPort extends UsbSerialPort {
    createStreams() {
      // Read one USB packet at a time so short bootloader replies return promptly.
      super.createStreams(this.inPacketSize);
    }

    async claimPortInterfaces() {
      const interfaces = this.device.configuration?.interfaces || [];
      const control = interfaces.find(usbInterface => usbInterface.alternates.some(
        alternate => alternate.interfaceClass === 0x02 && alternate.interfaceSubclass === 0x02
      ));
      const descriptor = this.findBulkInterface(interfaces.filter(usbInterface => usbInterface.alternates.some(
        alternate => alternate.interfaceClass === 0x0a
      )));
      if (!control) throw new DOMException("UNO R3 USB 제어 인터페이스를 찾지 못했습니다.", "NotSupportedError");

      this.controlInterface = control.interfaceNumber;
      await this.claimInterface(this.controlInterface);
      await this.claimInterface(descriptor.usbInterface.interfaceNumber, descriptor.alternate.alternateSetting);
      return descriptor;
    }

    async controlOut(request, value = 0, data) {
      const result = await this.device.controlTransferOut({
        requestType: "class", recipient: "interface", request, value, index: this.controlInterface
      }, data);
      return assertUsbResult(result, "UNO R3 USB 제어 명령");
    }

    async initialize({ baudRate = 9600, dataBits = 8, stopBits = 1, parity = "none" }) {
      if (dataBits !== 8 || stopBits !== 1 || parity !== "none") {
        throw new DOMException("UNO R3 USB는 8-N-1 통신만 지원합니다.", "NotSupportedError");
      }
      const lineCoding = new DataView(new ArrayBuffer(7));
      lineCoding.setUint32(0, baudRate, true);
      lineCoding.setUint8(6, dataBits);
      await this.controlOut(0x20, 0, lineCoding);
    }

    async applySignals() {
      const { dataTerminalReady, requestToSend } = this.signals;
      await this.controlOut(0x22, (dataTerminalReady ? 1 : 0) | (requestToSend ? 2 : 0));
    }
  }

  class CH340Serial extends EventTarget {
    constructor(usb, filters = USB_FILTERS) {
      super();
      this.usb = usb;
      this.filters = filters;
      this.ports = new Map();
      this.usb.addEventListener("disconnect", event => {
        const port = this.ports.get(event.device);
        if (!port) return;
        port.handleDisconnect();
        this.dispatchEvent(new Event("disconnect"));
      });
      this.usb.addEventListener("connect", event => {
        if (this.supports(event.device)) {
          this.dispatchEvent(new Event("connect"));
        }
      });
    }

    supports(device) {
      return this.filters.some(({ vendorId, productId }) =>
        device.vendorId === vendorId && (productId === undefined || device.productId === productId)
      );
    }

    portFor(device) {
      if (!this.ports.has(device)) {
        const Port = device.vendorId === CH340_VENDOR_ID ? CH340Port : UnoCdcPort;
        this.ports.set(device, new Port(device));
      }
      return this.ports.get(device);
    }

    async requestPort() {
      const device = await this.usb.requestDevice({ filters: this.filters.map(filter => ({ ...filter })) });
      return this.portFor(device);
    }

    async getPorts() {
      const devices = await this.usb.getDevices();
      return devices
        .filter(device => this.supports(device))
        .map(device => this.portFor(device));
    }
  }

  const api = {
    active: false,
    mode: "unavailable",
    isAndroid: isAndroid(),
    supported: Boolean(navigator.usb),
    filters: USB_FILTERS,
    calculateDivisor,
    CH340Port,
    UsbSerialPort,
    CH340Serial
  };

  if (api.isAndroid && navigator.usb) {
    const includeUnoR3 = typeof document !== "undefined" && document.currentScript?.hasAttribute("data-uno-r3");
    const filters = includeUnoR3 ? [...USB_FILTERS, ...UNO_R3_FILTERS] : USB_FILTERS;
    const serial = new CH340Serial(navigator.usb, filters);
    const nativeSerial = navigator.serial;
    try {
      Object.defineProperty(navigator, "serial", { configurable: true, enumerable: true, value: serial });
      api.active = navigator.serial === serial;
      if (api.active) api.mode = "navigator";
    } catch (error) {
      console.info("OneMaker CH340: navigator.serial 교체 대신 메서드 우회를 시도합니다.", error);
    }

    // Android Chrome 150에서는 Bluetooth Web Serial 객체가 교체 불가능한
    // 속성으로 노출될 수 있다. 이때 객체 자체는 유지하고 장치 선택 메서드만
    // CH340 WebUSB로 연결해 Arduino 웹 업로더도 같은 경로를 사용하게 한다.
    if (!api.active && nativeSerial) {
      const requestPort = serial.requestPort.bind(serial);
      const getPorts = serial.getPorts.bind(serial);
      const patchMethods = target => {
        Object.defineProperties(target, {
          requestPort: { configurable: true, writable: true, value: requestPort },
          getPorts: { configurable: true, writable: true, value: getPorts }
        });
        return nativeSerial.requestPort === requestPort && nativeSerial.getPorts === getPorts;
      };
      try {
        api.active = patchMethods(nativeSerial);
      } catch (instanceError) {
        try {
          api.active = patchMethods(Object.getPrototypeOf(nativeSerial));
        } catch (prototypeError) {
          console.warn("OneMaker CH340 WebUSB adapter activation failed:", instanceError, prototypeError);
        }
      }
      if (api.active) {
        try {
          api.mode = "patched";
          serial.addEventListener("disconnect", () => nativeSerial.dispatchEvent(new Event("disconnect")));
          serial.addEventListener("connect", () => nativeSerial.dispatchEvent(new Event("connect")));
        } catch (error) {
          console.info("OneMaker CH340 연결 이벤트 브리지를 사용할 수 없습니다.", error);
        }
      }
    }
    api.serial = serial;
  }

  window.OneMakerCH340 = api;
}());
