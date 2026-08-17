const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("HuskyLens toolbox mirrors the Boat Studio classroom blocks", () => {
  assert.match(app, /name: "HuskyLens", colour: "165"/);
  for (const type of ["husky_algorithm", "husky_seen", "husky_value"]) {
    assert.match(app, new RegExp(`type: "${type}"`));
  }
  for (const mode of ["물체 추적", "물체 인식", "색상 인식", "선 추적", "얼굴 인식", "태그 인식", "물체 분류"]) {
    assert.match(app, new RegExp(mode));
  }
  for (const field of ["X 중심", "Y 중심", "너비", "높이"]) {
    assert.match(app, new RegExp(field));
  }
});

test("stored and live execution support HuskyLens mode and ID values", () => {
  assert.match(app, /HUSKY_ALGORITHM: 32/);
  assert.match(app, /HUSKY_SEEN: 12, HUSKY_X: 13, HUSKY_Y: 14, HUSKY_WIDTH: 15, HUSKY_HEIGHT: 16/);
  assert.match(app, /writer\.u8\(VM\.HUSKY_ALGORITHM\)/);
  assert.match(app, /requestValue\("HUSKY"/);
  assert.match(app, /sendAction\("HUSKYALG"/);
  assert.match(runtime, /OP_HUSKY_ALGORITHM = 32/);
  assert.match(runtime, /EX_HUSKY_SEEN = 12/);
  assert.match(runtime, /fetchHuskyValue/);
  assert.match(runtime, /"HUSKYALG"/);
  assert.match(runtime, /"HUSKY"/);
});

test("generated INO uses the official HuskyLens API on fixed UNO I2C pins", () => {
  assert.match(app, /#include <HUSKYLENS\.h>/);
  assert.match(app, /huskylens\.begin\(Wire\)/);
  assert.match(app, /huskylens\.requestBlocks\(id\)/);
  assert.match(app, /huskylens\.writeAlgorithm/);
  assert.match(html, /I²C LCD·OLED·HuskyLens는 A4\(SDA\)·A5\(SCL\)/);
});
