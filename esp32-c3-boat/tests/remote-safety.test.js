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

test("controller clamps every remote speed to the classroom maximum", async () => {
  const { commands, controller } = harness();
  await controller.press("forward", 222);
  assert.deepEqual(commands, [{ cmd: "remote", button: "forward", speed: 150 }]);
});

test("holding one direction does not resend or increase the motor command", async () => {
  const { commands, controller } = harness();
  await controller.press("forward", 150);
  await controller.press("forward", 255);
  await controller.press("forward", 80);
  assert.deepEqual(commands, [{ cmd: "remote", button: "forward", speed: 150 }]);
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

test("disconnect clears hold state without sending another BLE command", async () => {
  const { commands, controller, timers } = harness();
  await controller.press("backward", 120);
  controller.disconnect();
  assert.equal(controller.direction, "stop");
  assert.equal(timers.size, 0);
  assert.equal(commands.length, 1);
});
