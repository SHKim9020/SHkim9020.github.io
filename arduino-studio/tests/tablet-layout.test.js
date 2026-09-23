const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const style = fs.readFileSync(path.join(root, "style.css"), "utf8");
const driver = fs.readFileSync(path.join(root, "ch340-webserial.js"), "utf8");

test("Android USB picker accepts WCH CH340-compatible product variants", () => {
  assert.match(driver, /USB_FILTERS = Object\.freeze\(\[\{ vendorId: CH340_VENDOR_ID \}\]\)/);
  assert.match(driver, /filter\(device => device\.vendorId === CH340_VENDOR_ID\)/);
  assert.match(app, /USB 장치를 찾지 못했습니다\. OTG 젠더·데이터 케이블/);
});

test("tablet landscape uses the full viewport and resizes Blockly", () => {
  assert.match(style, /@media\(min-width:761px\) and \(max-width:1280px\)/);
  assert.match(style, /height:calc\(100dvh - 118px\)/);
  assert.match(style, /grid-template-columns:minmax\(0,1fr\) minmax\(300px,34vw\)/);
  assert.match(style, /side-collapsed\{grid-template-columns:minmax\(0,1fr\) 44px\}/);
  assert.match(app, /window\.addEventListener\("orientationchange"/);
});
