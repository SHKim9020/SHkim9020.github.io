const test = require("node:test");
const assert = require("node:assert/strict");

require("../ble-transport.js");

test("BLE writes are chunked to 20 bytes and never overlap", async () => {
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const chunks = [];
  const characteristic = {
    async writeValueWithResponse(chunk) {
      activeWrites++;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await new Promise(resolve => setTimeout(resolve, 2));
      chunks.push([...chunk]);
      activeWrites--;
    }
  };
  const queue = new globalThis.BoatBleWriteQueue(characteristic);
  const first = Uint8Array.from({ length: 43 }, (_, index) => index);
  const second = Uint8Array.from({ length: 25 }, (_, index) => 100 + index);

  await Promise.all([queue.write(first), queue.write(second)]);

  assert.equal(maxActiveWrites, 1);
  assert.deepEqual(chunks.map(chunk => chunk.length), [20, 20, 3, 20, 5]);
  assert.deepEqual(chunks.flat(), [...first, ...second]);
});

test("a failed write does not block the next queued command", async () => {
  let calls = 0;
  const received = [];
  const characteristic = {
    async writeValueWithResponse(chunk) {
      calls++;
      if (calls === 1) throw new Error("temporary GATT failure");
      received.push(...chunk);
    }
  };
  const queue = new globalThis.BoatBleWriteQueue(characteristic);

  await assert.rejects(queue.write(Uint8Array.of(1)), /temporary GATT failure/);
  await queue.write(Uint8Array.of(2, 3));

  assert.deepEqual(received, [2, 3]);
});

test("three rapid controller taps remain ordered", async () => {
  const decoder = new TextDecoder();
  let stream = "";
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const characteristic = {
    async writeValueWithResponse(chunk) {
      activeWrites++;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await new Promise(resolve => setTimeout(resolve, 1));
      stream += decoder.decode(chunk, { stream: true });
      activeWrites--;
    }
  };
  const queue = new globalThis.BoatBleWriteQueue(characteristic);
  const encoder = new TextEncoder();
  const buttons = ["forward", "stop", "left", "stop", "right", "stop"];

  await Promise.all(buttons.map(button => queue.write(encoder.encode(
    `${JSON.stringify({ cmd: "remote", button, speed: 84 })}\n`
  ))));

  assert.equal(maxActiveWrites, 1);
  assert.deepEqual(
    stream.trim().split("\n").map(line => JSON.parse(line).button),
    buttons
  );
});

test("priority stop drops pending remote commands instead of waiting behind them", async () => {
  const received = [];
  let releaseActiveWrite;
  let firstWrite = true;
  const activeGate = new Promise(resolve => { releaseActiveWrite = resolve; });
  const characteristic = {
    async writeValueWithResponse(chunk) {
      if (firstWrite) {
        firstWrite = false;
        await activeGate;
      }
      received.push(...chunk);
    }
  };
  const queue = new globalThis.BoatBleWriteQueue(characteristic);

  const moving = queue.write(Uint8Array.of(1), { group: "remote" });
  const staleHeartbeat = queue.write(Uint8Array.of(2), {
    group: "remote",
    replaceKey: "remote-heartbeat"
  });
  const staleDirection = queue.write(Uint8Array.of(3), { group: "remote" });
  const stop = queue.write(Uint8Array.of(9), {
    group: "remote",
    clearGroup: "remote",
    priority: true
  });

  assert.equal(await staleHeartbeat, false);
  assert.equal(await staleDirection, false);
  releaseActiveWrite();
  assert.deepEqual(await Promise.all([moving, stop]), [true, true]);
  assert.deepEqual(received, [1, 9]);
});
