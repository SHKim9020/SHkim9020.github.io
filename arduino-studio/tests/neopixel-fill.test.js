const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("NeoPixel toolbox exposes all-LED color and brightness control", () => {
  assert.match(app, /type: "neo_fill"/);
  assert.match(app, /네오픽셀 모든 LED 색 %1 밝기 %2/);
  assert.match(app, /name: "BRIGHTNESS"/);
  for (const color of ["빨강", "주황", "노랑", "초록", "하늘", "파랑", "보라", "흰색"]) {
    assert.match(app, new RegExp(color));
  }
});

test("all-LED block works in stored, live, and generated INO modes", () => {
  assert.match(app, /writer\.u8\(VM\.NEO_SET\); numberExpression\(255\)/);
  assert.match(app, /sendAction\("NEOSET", 255/);
  assert.match(app, /pixels\.fill\(pixels\.Color/);
  assert.match(runtime, /if \(index == 255\) pixels->fill\(color\)/);
  assert.match(runtime, /else pixels->setPixelColor/);
});
