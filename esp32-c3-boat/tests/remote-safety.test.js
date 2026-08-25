const test = require("node:test");
const assert = require("node:assert/strict");

require("../remote-safety.js");

function harness() {
  const commands = [];
  const timers = new Map();
  let nextTimer = 1;
  const controller = new globalThis.BoatRemoteSafetyController(
    async command => commands.push(command),
    {
      setIntervalFn(callback) {
        const id = nextTimer++;
        timers.set(id, callback);
        return id;
      },
      clearIntervalFn(id) { timers.delete(id); }
    }
  );
  return { commands, controller, timers };
}

test("controller clamps every remote speed to the 250 test maximum", async () => {
  const { commands, controller } = harness();
  await controller.press("forward", 300);
  assert.deepEqual(commands, [{ cmd: "remote", button: "forward", speed: 250 }]);
});

test("holding one direction does not resend or increase the motor command", async () => {
  const { commands, controller } = harness();
  await controller.press("forward", 150);
  await controller.press("forward", 255);
  await controller.press("forward", 80);
  assert.deepEqual(commands, [{ cmd: "remote", button: "forward", speed: 150 }]);
});

test("controller sends independent left and right motor speeds", async () => {
  const { commands, controller } = harness();
  await controller.press("forward", 155, { leftSpeed: 140, rightSpeed: 170 });
  assert.deepEqual(commands, [{
    cmd: "remote",
    button: "forward",
    speed: 155,
    leftSpeed: 140,
    rightSpeed: 170
  }]);
});

test("heartbeat is lightweight and releasing sends one stop", async () => {
  const { commands, controller, timers } = harness();
  await controller.press("left", 140);
  assert.equal(timers.size, 1);
  await [...timers.values()][0]();
  await controller.stop();
  await controller.stop();
  assert.deepEqual(commands, [
    { cmd: "remote", button: "left", speed: 140 },
    { cmd: "heartbeat", button: "left" },
    { cmd: "remote", button: "stop", speed: 0 }
  ]);
  assert.equal(timers.size, 0);
});

test("a slow BLE heartbeat never accumulates more heartbeat writes", async () => {
  const commands = [];
  const timers = new Map();
  let releaseHeartbeat;
  const heartbeatGate = new Promise(resolve => { releaseHeartbeat = resolve; });
  const controller = new globalThis.BoatRemoteSafetyController(
    async command => {
      commands.push(command);
      if (command.cmd === "heartbeat") await heartbeatGate;
    },
    {
      setIntervalFn(callback) { timers.set(1, callback); return 1; },
      clearIntervalFn(id) { timers.delete(id); }
    }
  );

  await controller.press("right", 130);
  const tick = [...timers.values()][0];
  const firstHeartbeat = tick();
  const skippedHeartbeat = await tick();
  assert.equal(skippedHeartbeat, false);
  assert.equal(commands.filter(command => command.cmd === "heartbeat").length, 1);

  releaseHeartbeat();
  await firstHeartbeat;
  await controller.stop();
  assert.deepEqual(commands.at(-1), { cmd: "remote", button: "stop", speed: 0 });
});

test("disconnect clears hold state without sending another BLE command", async () => {
  const { commands, controller, timers } = harness();
  await controller.press("backward", 120);
  controller.disconnect();
  assert.equal(controller.direction, "stop");
  assert.equal(timers.size, 0);
  assert.equal(commands.length, 1);
});
