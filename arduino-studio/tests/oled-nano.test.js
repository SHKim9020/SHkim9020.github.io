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
});

test("OLED works in stored, live, and generated INO modes", () => {
  assert.match(app, /OLED_BEGIN: 29, OLED_PRINT: 30, OLED_CLEAR: 31/);
  assert.match(app, /sendAction\("OLEDBEGIN"/);
  assert.match(app, /sendAction\([\s\S]*"OLEDPRINT"/);
  assert.match(app, /#include <U8x8lib\.h>/);
  assert.match(runtime, /OP_OLED_BEGIN = 29/);
  assert.match(runtime, /"OLEDPRINT"/);
  assert.match(runtime, /U8X8_SSD1306_128X64_NONAME_HW_I2C/);
});

test("UNO and both Nano bootloader upload paths use runtime 1.1.4", () => {
  assert.match(app, /const RUNTIME_VERSION = "1\.1\.4"/);
  assert.match(runtime, /RUNTIME_VERSION = "1\.1\.4"/);
  assert.equal((html.match(/onemaker_runtime-1\.1\.4\.hex/g) || []).length, 3);
  for (const board of ["uno", "nano", "nanoOldBootloader"]) {
    assert.match(html, new RegExp(`board="${board}"`));
  }
  assert.match(workflow, /arduino-cli lib install "U8g2"/);
  assert.match(workflow, /--fqbn "arduino:avr:uno"/);
});
