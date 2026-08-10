const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const runtimeSource = fs.readFileSync(
  path.join(__dirname, "..", "firmware", "boat_runtime", "boat_runtime.ino"),
  "utf8"
);

test("runtime accepts deeply nested Blockly program JSON at every parse point", () => {
  assert.match(runtimeSource, /PROGRAM_JSON_NESTING_LIMIT\s*=\s*32/);
  assert.equal(
    (runtimeSource.match(/DeserializationOption::NestingLimit\(PROGRAM_JSON_NESTING_LIMIT\)/g) || []).length,
    3
  );
});

test("web app requires firmware 1.4.8 before sending a deeply nested program", () => {
  assert.match(appSource, /DEEP_PROGRAM_FIRMWARE_MIN\s*=\s*\[1,\s*4,\s*8\]/);
  assert.match(appSource, /function jsonNestingDepth\(value\)/);
  assert.match(appSource, /jsonNestingDepth\(payload\)\s*>\s*10/);
  assert.match(appSource, /중첩된 조건·계산 블록은 펌웨어 1\.4\.8이 필요합니다/);
});
