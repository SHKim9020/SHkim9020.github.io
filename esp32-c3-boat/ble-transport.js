(() => {
  "use strict";

  class BoatBleWriteQueue {
    constructor(characteristic, chunkSize = 20) {
      this.characteristic = characteristic;
      this.chunkSize = chunkSize;
      this.tail = Promise.resolve();
    }

    write(bytes) {
      const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const operation = this.tail.catch(() => {}).then(() => this.writeNow(payload));
      this.tail = operation;
      return operation;
    }

    async writeNow(bytes) {
      for (let offset = 0; offset < bytes.length; offset += this.chunkSize) {
        const chunk = bytes.slice(offset, offset + this.chunkSize);
        if (typeof this.characteristic.writeValueWithResponse === "function") {
          await this.characteristic.writeValueWithResponse(chunk);
        } else if (typeof this.characteristic.writeValue === "function") {
          await this.characteristic.writeValue(chunk);
        } else if (typeof this.characteristic.writeValueWithoutResponse === "function") {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          throw new Error("Bluetooth 쓰기를 지원하지 않는 장치입니다.");
        }
      }
    }
  }

  globalThis.BoatBleWriteQueue = BoatBleWriteQueue;
})();
