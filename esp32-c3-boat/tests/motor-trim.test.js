const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const html = read("index.html");
const app = read("app.js");
const runtime = read("firmware/boat_runtime/boat_runtime.ino");
const manifest = JSON.parse(read("firmware/manifest.json"));

test("remote UI can lock a left/right calibration on the connected boat", () => {
  assert.match(html, /id="motorTrimLockBtn"/);
  assert.match(html, /id="motorTrimStatus"/);
  assert.match(app, /MOTOR_TRIM_FIRMWARE_MIN\s*=\s*\[1,\s*4,\s*9\]/);
  assert.match(app, /cmd:\s*"setMotorTrim"/);
  assert.match(app, /\["motorTrimSaved"\]/);
  assert.match(app, /블록코딩에도 자동 적용/);
});

test("firmware persists calibration and reports it during hello", () => {
  assert.match(runtime, /putUChar\("trimL"/);
  assert.match(runtime, /putUChar\("trimR"/);
  assert.match(runtime, /putBool\("trimOn"/);
  assert.match(runtime, /response\["motorTrimLeft"\]/);
  assert.match(runtime, /response\["motorTrimRight"\]/);
  assert.match(runtime, /response\["motorTrimLocked"\]/);
  assert.match(runtime, /strcmp\(command,\s*"setMotorTrim"\)/);
});

test("stored programs are trimmed while explicit remote speeds are not doubled", () => {
  assert.match(runtime, /int leftSpeed = trimMotorSpeed\(speed, motorTrimLeft\)/);
  assert.match(runtime, /int rightSpeed = trimMotorSpeed\(speed, motorTrimRight\)/);
  assert.match(runtime, /speed = trimMotorSpeed\(speed, motorTrimLeft\)/);
  assert.match(runtime, /speed = trimMotorSpeed\(speed, motorTrimRight\)/);
  const dualDrive = runtime.match(/void driveDirectionDual[\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(dualDrive, /trimMotorSpeed/);
});

test("installer targets the trim-capable runtime", () => {
  assert.equal(manifest.version, "1.4.9");
  assert.match(manifest.builds[0].parts[0].path, /boat_runtime-1\.4\.9\.merged\.bin$/);
  assert.match(runtime, /OneMaker Boat 1\.4\.9/);
});
