(() => {
  "use strict";

  class BoatBleWriteQueue {
    constructor(characteristic, chunkSize = 20) {
      this.characteristic = characteristic;
      this.chunkSize = chunkSize;
      this.pending = [];
      this.active = false;
    }

    write(bytes, options = {}) {
      const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return new Promise((resolve, reject) => {
        if (options.clearGroup) this.clearPendingGroup(options.clearGroup);
        if (options.replaceKey) this.clearPendingKey(options.replaceKey);
        const item = {
          payload,
          group: options.group || null,
          replaceKey: options.replaceKey || null,
          resolve,
          reject
        };
        if (options.priority) this.pending.unshift(item);
        else this.pending.push(item);
        this.pump();
      });
    }

    clearPendingGroup(group) {
      return this.clearPending(item => item.group === group);
    }

    clearPendingKey(key) {
      return this.clearPending(item => item.replaceKey === key);
    }

    clearPending(predicate) {
      let cleared = 0;
      this.pending = this.pending.filter(item => {
        if (!predicate(item)) return true;
        cleared++;
        item.resolve(false);
        return false;
      });
      return cleared;
    }

    async pump() {
      if (this.active) return;
      this.active = true;
      try {
        while (this.pending.length) {
          const item = this.pending.shift();
          try {
            await this.writeNow(item.payload);
            item.resolve(true);
          } catch (error) {
            item.reject(error);
          }
        }
      } finally {
        this.active = false;
        if (this.pending.length) this.pump();
      }
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
