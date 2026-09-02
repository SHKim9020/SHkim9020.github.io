const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("motor toolbox exposes classroom 28BYJ-48 blocks", () => {
  assert.match(app, /type: "stepper_28byj_rotate"/);
  assert.match(app, /type: "stepper_28byj_release"/);
  assert.match(app, /28BYJ-48 IN1 %1 IN2 %2 IN3 %3 IN4 %4/);
  assert.match(app, /\["시계방향", "1"\], \["반시계방향", "-1"\]/);
  assert.match(app, /RPM: numberShadow\(10\), ANGLE: numberShadow\(360\)/);
  assert.match(app, /28BYJ-48의 IN1~IN4는 서로 다른 핀/);
  assert.match(html, /28BYJ-48/);
});

test("28BYJ-48 works in stored, USB live, and generated INO modes", () => {
  assert.match(app, /STEPPER_28BYJ: 33, STEPPER_28BYJ_RELEASE: 34/);
  assert.match(app, /writer\.u8\(VM\.STEPPER_28BYJ\)/);
  assert.match(app, /writer\.u8\(VM\.STEPPER_28BYJ_RELEASE\)/);
  assert.match(app, /sendAction\("STEP28", \.\.\.pins/);
  assert.match(app, /sendAction\("STEP28OFF", \.\.\.stepperPins\(block\)\)/);
  assert.match(app, /rotate28BYJ48\(\$\{pins\.join/);
  assert.match(app, /release28BYJ48\(\$\{stepperPins/);
});

test("runtime drives ULN2003 phases and releases all four coils", () => {
  assert.match(runtime, /OP_STEPPER_28BYJ = 33/);
  assert.match(runtime, /OP_STEPPER_28BYJ_RELEASE = 34/);
  assert.match(runtime, /static const uint8_t phases\[4\] = \{0x09, 0x03, 0x06, 0x0C\}/);
  assert.match(runtime, /2048UL \/ 360UL/);
  assert.match(runtime, /!strcmp\(operation, "STEP28"\)/);
  assert.match(runtime, /!strcmp\(operation, "STEP28OFF"\)/);
  assert.match(runtime, /digitalWrite\(pins\[index\], LOW\)/);
});
