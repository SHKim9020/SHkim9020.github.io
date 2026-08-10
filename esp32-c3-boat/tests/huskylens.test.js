const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const runtimeSource = fs.readFileSync(
  path.join(__dirname, "..", "firmware", "boat_runtime", "boat_runtime.ino"),
  "utf8"
);

test("HuskyLens blocks automatically enable the stored-program sensor config", () => {
  assert.match(appSource, /enabled:\s*\$\("#huskyEnabled"\)\.checked\s*\|\|\s*usesHusky/);
  assert.match(appSource, /workspaceUsesHusky\(\).*type\.startsWith\("husky_"\)/s);
});

test("face recognition reads fresh blocks and matches the requested learned ID", () => {
  for (const source of [appSource, runtimeSource]) {
    assert.match(source, /huskylens\.request\(\)/);
    assert.match(source, /candidate\.command\s*==\s*COMMAND_RETURN_BLOCK/);
    assert.match(source, /candidate\.ID\s*==\s*id/);
    assert.doesNotMatch(source, /requestBlocks\(id\)/);
  }
});

test("HuskyLens polling is throttled and algorithm switching is cached", () => {
  for (const source of [appSource, runtimeSource]) {
    assert.match(source, /Wire\.setClock\(100000\)/);
    assert.match(source, /activeHuskyAlgorithm\s*==\s*algorithm/);
    assert.match(source, /delay\(50\)/);
  }
});

test("runtime and installer consistently target firmware 1.4.8", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "firmware", "manifest.json"),
    "utf8"
  ));
  assert.equal(manifest.version, "1.4.8");
  assert.match(manifest.builds[0].parts[0].path, /boat_runtime-1\.4\.8\.merged\.bin$/);
  assert.match(runtimeSource, /OneMaker Boat 1\.4\.8/);
  assert.match(appSource, /HUSKYLENS_FIRMWARE_MIN\s*=\s*\[1,\s*4,\s*7\]/);
  assert.match(appSource, /HuskyLens 얼굴 인식 기능은 펌웨어 1\.4\.7이 필요합니다/);
});
