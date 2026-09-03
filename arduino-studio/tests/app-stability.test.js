const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("block edits debounce full Arduino code generation", () => {
  assert.match(app, /if \(event\.isUiEvent\) return;[\s\S]*scheduleCodeRefresh\(\)/);
  assert.match(app, /function scheduleCodeRefresh\(\)[\s\S]*setTimeout\([\s\S]*refreshCode\(\)[\s\S]*90/);
});

test("USB writes are serialized and time out safely", () => {
  assert.match(app, /let serialWriteQueue = Promise\.resolve\(\)/);
  assert.match(app, /withTimeout\(writer\.write\(bytes\), SERIAL_WRITE_TIMEOUT_MS/);
  assert.match(app, /USB 응답이 지연되어 연결을 안전하게 해제했습니다/);
});

test("speech synthesis and command queue cannot wait forever", () => {
  assert.match(app, /MAX_SPEECH_COMMAND_QUEUE = 2/);
  assert.match(app, /이전 명령을 처리 중입니다\. 잠시 후 다시 시도하세요/);
  assert.match(app, /const speechTimeout = setTimeout\([\s\S]*speechSynthesis\.cancel\(\)/);
});

test("long waits remain responsive to stop", () => {
  assert.match(app, /async function executionSleep\(milliseconds\)[\s\S]*while \(!runCancelled/);
  assert.match(app, /case "control_wait":[\s\S]*await executionSleep/);
});
