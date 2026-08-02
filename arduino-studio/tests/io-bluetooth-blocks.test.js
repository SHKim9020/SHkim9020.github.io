const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("timed MP3 block plays, waits, and stops in stored and live modes", () => {
  assert.match(app, /type: "mp3_play_for"/);
  assert.match(app, /DFPlayer %1번 파일 %2초 동안 재생/);
  assert.match(app, /writer\.u8\(VM\.MP3_PLAY\); expression\("TRACK"\);\s*writer\.u8\(VM\.WAIT\); expression\("SECONDS"\);\s*writer\.u8\(VM\.MP3_STOP\)/);
  assert.match(app, /sendAction\("MP3PLAY"[\s\S]*sleep\([\s\S]*sendAction\("MP3STOP"\)/);
});

test("touch sensor keeps the compatible block id and treats HIGH as detected", () => {
  assert.match(app, /type: "sensor_button"[\s\S]*message0: "터치센서 %1 감지\?"/);
  assert.match(app, /case "sensor_button": return `\(readDigitalPin\(\$\{block\.getFieldValue\("PIN"\)\}\) == 1\)`/);
  assert.match(runtime, /opcode == EX_BUTTON[\s\S]*pinMode\(pin, INPUT\);[\s\S]*digitalRead\(pin\) == HIGH/);
  assert.doesNotMatch(app, /bool readButton/);
});

test("Bluetooth toolbox exposes receive, comparison, raw send, and name blocks", () => {
  for (const type of ["bt_begin", "bt_available", "bt_read", "bt_received_item", "bt_value_equals", "bt_send", "bt_send_many", "bt_set_name"]) {
    assert.match(app, new RegExp(`type: "${type}"`));
  }
  assert.match(app, /fields: \{ RX: "2", TX: "3", BAUD: "9600" \}/);
  assert.match(app, /BT_SEND_RAW: 27, BT_SET_NAME: 28/);
  assert.match(app, /BT_ITEM: 44/);
});

test("runtime implements the extended Bluetooth bytecode and live commands", () => {
  assert.match(runtime, /OP_BT_SEND_RAW = 27/);
  assert.match(runtime, /OP_BT_SET_NAME = 28/);
  assert.match(runtime, /EX_BT_ITEM = 44/);
  assert.match(runtime, /"BTRAW"/);
  assert.match(runtime, /"BTNAME"/);
  assert.match(runtime, /void setBluetoothName/);
});
