const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");
const workflow = fs.readFileSync(path.join(root, "../.github/workflows/build-arduino-studio-firmware.yml"), "utf8");

test("OLED toolbox exposes begin, print, and clear blocks", () => {
  for (const type of ["oled_begin", "oled_print", "oled_clear"]) {
    assert.match(app, new RegExp(`type: "${type}"`));
  }
  assert.match(app, /name: "0\.96 OLED"/);
  assert.match(app, /\[\["0x3C", "60"\], \["0x3D", "61"\]\]/);
  assert.match(app, /name: "SIZE", options: \[\["1배", "1"\], \["2배", "2"\]\]/);
});

test("OLED works in stored, live, and generated INO modes", () => {
  assert.match(app, /OLED_BEGIN: 29, OLED_PRINT: 30, OLED_CLEAR: 31/);
  assert.match(app, /sendAction\("OLEDBEGIN"/);
  assert.match(app, /oled\.set\$\{block\.getFieldValue\("SIZE"\) === "2" \? "2" : "1"\}X/);
  assert.match(app, /sendAction\([\s\S]*"OLEDPRINT"/);
  assert.match(app, /#include <SSD1306Ascii\.h>/);
  assert.match(runtime, /OP_OLED_BEGIN = 29/);
  assert.match(runtime, /"OLEDPRINT"/);
  assert.match(runtime, /OLED_FONT_3X5/);
  assert.match(runtime, /void oledBegin/);
  assert.match(runtime, /oledScale = scale == 2 \? 2 : 1/);
  assert.match(runtime, /expanded \|= expanded << 1/);
  assert.doesNotMatch(runtime, /character >= 'A'/);
});

test("UNO and both Nano bootloader upload paths use runtime 1.1.8", () => {
  assert.match(app, /const RUNTIME_VERSION = "1\.1\.8"/);
  assert.match(runtime, /RUNTIME_VERSION = "1\.1\.8"/);
  assert.equal((html.match(/onemaker_runtime-1\.1\.8\.hex/g) || []).length, 3);
  for (const board of ["uno", "nano", "nanoOldBootloader"]) {
    assert.match(html, new RegExp(`board="${board}"`));
  }
  assert.doesNotMatch(workflow, /U8g2/);
  assert.doesNotMatch(runtime, /#include <DHT\.h>/);
  assert.doesNotMatch(runtime, /#include <LiquidCrystal_I2C\.h>/);
  assert.match(runtime, /pulseIn\(pin, LOW, 1000UL\)/);
  assert.match(workflow, /--fqbn "arduino:avr:uno"/);
  assert.match(workflow, /--fqbn "arduino:avr:nano:cpu=atmega328"/);
});
