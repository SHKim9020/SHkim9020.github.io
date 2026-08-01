(() => {
  "use strict";

  const DIRECTIONS = new Set(["forward", "backward", "left", "right"]);

  class BoatRemoteSafetyController {
    constructor(sendCommand, options = {}) {
      this.sendCommand = sendCommand;
      this.maxSpeed = options.maxSpeed ?? 250;
      this.heartbeatMs = options.heartbeatMs ?? 400;
      this.setIntervalFn = options.setIntervalFn ?? globalThis.setInterval.bind(globalThis);
      this.clearIntervalFn = options.clearIntervalFn ?? globalThis.clearInterval.bind(globalThis);
      this.onError = options.onError ?? (() => {});
      this.direction = "stop";
      this.speed = 0;
      this.heartbeatTimer = null;
    }

    clampSpeed(speed) {
      const numeric = Number(speed);
      if (!Number.isFinite(numeric)) return 0;
      return Math.min(this.maxSpeed, Math.max(0, Math.round(numeric)));
    }

    async press(direction, speed, motorSpeeds = null) {
      if (!DIRECTIONS.has(direction)) return this.stop(true);
      if (this.direction === direction) return false;

      this.clearHeartbeat();
      this.direction = direction;
      this.speed = this.clampSpeed(speed);
      const command = { cmd: "remote", button: direction, speed: this.speed };
      if (motorSpeeds) {
        command.leftSpeed = this.clampSpeed(motorSpeeds.leftSpeed);
        command.rightSpeed = this.clampSpeed(motorSpeeds.rightSpeed);
      }
      await this.sendCommand(command);
      this.heartbeatTimer = this.setIntervalFn(() => {
        if (this.direction === "stop") return;
        Promise.resolve(this.sendCommand({ cmd: "heartbeat", button: this.direction }))
          .catch(error => this.onError(error));
      }, this.heartbeatMs);
      return true;
    }

    async stop(force = false) {
      const wasMoving = this.direction !== "stop";
      this.clearHeartbeat();
      this.direction = "stop";
      this.speed = 0;
      if (!wasMoving && !force) return false;
      await this.sendCommand({ cmd: "remote", button: "stop", speed: 0 });
      return true;
    }

    disconnect() {
      this.clearHeartbeat();
      this.direction = "stop";
      this.speed = 0;
    }

    clearHeartbeat() {
      if (this.heartbeatTimer !== null) {
        this.clearIntervalFn(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }
  }

  globalThis.BoatRemoteSafetyController = BoatRemoteSafetyController;
})();
