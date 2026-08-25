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
      this.heartbeatInFlight = false;
      this.heartbeatGeneration = 0;
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
      const generation = this.heartbeatGeneration;
      const command = { cmd: "remote", button: direction, speed: this.speed };
      if (motorSpeeds) {
        command.leftSpeed = this.clampSpeed(motorSpeeds.leftSpeed);
        command.rightSpeed = this.clampSpeed(motorSpeeds.rightSpeed);
      }
      await this.sendCommand(command);
      if (this.direction !== direction || generation !== this.heartbeatGeneration) return false;
      this.heartbeatTimer = this.setIntervalFn(() => this.sendHeartbeat(), this.heartbeatMs);
      return true;
    }

    async sendHeartbeat() {
      if (this.direction === "stop" || this.heartbeatInFlight) return false;
      const direction = this.direction;
      const generation = this.heartbeatGeneration;
      this.heartbeatInFlight = true;
      try {
        await this.sendCommand({ cmd: "heartbeat", button: direction });
        return true;
      } catch (error) {
        if (generation === this.heartbeatGeneration && this.direction !== "stop") this.onError(error);
        return false;
      } finally {
        this.heartbeatInFlight = false;
      }
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
      this.heartbeatGeneration++;
      if (this.heartbeatTimer !== null) {
        this.clearIntervalFn(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }
  }

  globalThis.BoatRemoteSafetyController = BoatRemoteSafetyController;
})();
