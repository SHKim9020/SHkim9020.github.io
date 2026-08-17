const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("motor toolbox matches the requested classroom blocks and defaults", () => {
  assert.match(app, /name: "모터", colour: "285"/);
  for (const type of ["servo_write", "servo_write_for", "servo_detach", "dc_motor_digital", "dc_motor_pwm"]) {
    assert.match(app, new RegExp(`type: "${type}"`));
  }
  assert.match(app, /type: "servo_write_for", fields: \{ PIN: "8" \}, inputs: \{ FROM: numberShadow\(0\), TO: numberShadow\(180\), SECONDS: numberShadow\(1\) \}/);
  assert.match(app, /type: "dc_motor_pwm", fields: \{ PIN: "5" \}, inputs: \{ VALUE: numberShadow\(255\) \}/);
});

test("input toolbox exposes the seven requested sensor blocks and pins", () => {
  assert.match(app, /name: "입력", colour: "250"/);
  for (const type of ["sensor_light", "sensor_ultrasonic", "sensor_dht_simple", "sensor_dust", "sensor_soil", "sensor_push_button", "sensor_tact_button"]) {
    assert.match(app, new RegExp(`type: "${type}"`));
  }
  assert.match(app, /type: "sensor_ultrasonic", fields: \{ TRIG: "13", ECHO: "12" \}/);
  assert.match(app, /type: "sensor_dht_simple", fields: \{ PIN: "4", FIELD: "temperature" \}/);
  assert.match(app, /type: "sensor_soil", fields: \{ PIN: "1" \}/);
});

test("new blocks work in stored, live, and generated Arduino modes", () => {
  assert.match(app, /case "servo_write_for":[\s\S]*writer\.u8\(VM\.SERVO\)/);
  assert.match(app, /case "servo_detach":[\s\S]*numberExpression\(-1\)/);
  assert.match(app, /sendAction\("SERVO", block\.getFieldValue\("PIN"\), -1\)/);
  assert.match(app, /\.detach\(\);/);
  assert.match(runtime, /if \(angle < 0\) servo->detach\(\)/);
});
