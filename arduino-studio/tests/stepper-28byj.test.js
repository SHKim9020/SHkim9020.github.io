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
  assert.match(app, /28BYJ-48 D8~D11 %1 속도 %2 RPM 각도 %3° 회전/);
  assert.match(app, /\["시계방향", "1"\], \["반시계방향", "-1"\]/);
  assert.match(app, /name: "RPM", value: 10, min: 1, max: 15/);
  assert.match(app, /IN1→D8, IN2→D9, IN3→D10, IN4→D11/);
  assert.match(app, /fields: \{ DIRECTION: "1", RPM: 10 \}/);
  assert.match(html, /28BYJ-48/);
});

test("28BYJ-48 works in stored, USB live, and generated INO modes", () => {
  assert.match(app, /writer\.u8\(VM\.REPEAT_START\)/);
  assert.match(app, /writer\.u8\(VM\.DIGITAL_WRITE\); writer\.u8\(8 \+ bit\)/);
  assert.match(app, /await sendAction\("DW", 8 \+ bit/);
  assert.match(app, /await sendAction\("DW", pinNumber, 0\)/);
  assert.match(app, /rotate28BYJ48\(\$\{block\.getFieldValue\("DIRECTION"\)\}/);
  assert.match(app, /return line\("release28BYJ48\(\);"\)/);
});

test("runtime drives ULN2003 phases and releases all four coils", () => {
  assert.match(app, /\[9, 3, 6, 12\]/);
  assert.match(app, /\[9, 12, 6, 3\]/);
  assert.match(app, /angle \* 2048 \/ 360/);
  assert.match(runtime, /PORTB &= 0xF0/);
});
