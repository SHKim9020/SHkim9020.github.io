const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "firmware/onemaker_runtime/onemaker_runtime.ino"), "utf8");

test("DFPlayer blocks default to separate D10 RX and D11 TX pins", () => {
  assert.match(app, /fields: \{ RX: "10", TX: "11" \}/);
  assert.match(app, /DFPlayer RX와 TX는 서로 다른 핀을 선택하세요/);
});

test("runtime performs reset, cold-start wait, and microSD selection", () => {
  assert.match(runtime, /sendMp3Command\(0x0C, 0\)/);
  assert.match(runtime, /delay\(2200\)/);
  assert.match(runtime, /sendMp3Command\(0x09, 2\)/);
  assert.match(runtime, /MP3_READY/);
});

test("web app and firmware require runtime 1.1.8", () => {
  assert.match(app, /const RUNTIME_VERSION = "1\.1\.8"/);
  assert.match(runtime, /RUNTIME_VERSION = "1\.1\.8"/);
  assert.match(html, /onemaker_runtime-1\.1\.8\.hex/g);
  assert.match(html, /app\.js\?v=1\.4\.8/);
  assert.match(html, /https:\/\/raw\.githubusercontent\.com\/SHKim9020\/SHkim9020\.github\.io\/main\/arduino-studio\/firmware\/onemaker_runtime-1\.1\.8\.hex/);
});

test("quick test exposes independent pins, track, volume, play, and stop", () => {
  for (const id of ["mp3RxPin", "mp3TxPin", "mp3Track", "mp3Volume", "mp3PlayBtn", "mp3StopBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
