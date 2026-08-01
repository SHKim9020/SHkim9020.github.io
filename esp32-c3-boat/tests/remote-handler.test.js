const test = require("node:test");
const assert = require("node:assert/strict");

require("../remote-handler.js");

test("remote handlers replace boat movement speeds with the current slider speed", () => {
  const source = [
    { op: "move", direction: "forward", speed: { type: "number", value: 150 } },
    {
      op: "if",
      branches: [{ condition: { type: "number", value: 1 }, steps: [
        { op: "move", direction: "left", speed: { type: "number", value: 80 } }
      ] }],
      elseSteps: [{ op: "move", direction: "right", speed: { type: "number", value: 220 } }]
    },
    { op: "led", value: 1 }
  ];

  const compiled = globalThis.bindRemoteSpeedToMoves(source);

  assert.deepEqual(compiled[0].speed, { type: "remoteSpeed" });
  assert.deepEqual(compiled[1].branches[0].steps[0].speed, { type: "remoteSpeed" });
  assert.deepEqual(compiled[1].elseSteps[0].speed, { type: "remoteSpeed" });
  assert.deepEqual(compiled[2], { op: "led", value: 1 });
  assert.deepEqual(source[0].speed, { type: "number", value: 150 });
});
