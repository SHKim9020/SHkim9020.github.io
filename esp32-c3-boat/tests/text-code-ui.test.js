const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");

test("forever blocks are emitted as Arduino loop contents instead of while true", () => {
  assert.match(appSource, /function arduinoProgramSections\(\)/);
  assert.match(appSource, /loop:\s*cppStatements\(foreverBlock\.getInputTargetBlock\("DO"\),\s*1\)/);
  assert.doesNotMatch(appSource, /case "control_forever":\s*code \+= `[^`]*while \(true\)/s);
  assert.match(appSource, /void loop\(\) \{\n\$\{sections\.loop/);
});

test("text tab displays compact block code and hides boat runtime helpers", () => {
  const start = appSource.indexOf("function generateVisibleCpp()");
  const end = appSource.indexOf("function refreshGeneratedCode()", start);
  const visibleGenerator = appSource.slice(start, end);
  assert.match(visibleGenerator, /void setup\(\)/);
  assert.match(visibleGenerator, /void loop\(\)/);
  assert.match(visibleGenerator, /보트 제어용 내부 함수는 화면에서 숨겨집니다/);
  assert.doesNotMatch(visibleGenerator, /void setChannel|void setDrive|long readSonarCm/);
  assert.match(appSource, /#codeView"\)\.value = generateVisibleCpp\(\)/);
});

test("C++ editor has syntax highlighting and a draggable left resize handle", () => {
  assert.match(htmlSource, /id="codeHighlight"/);
  assert.match(htmlSource, /id="sideResizeHandle"/);
  assert.match(appSource, /function highlightCpp\(source\)/);
  assert.match(appSource, /function initSidePanelResize\(\)/);
  assert.match(styleSource, /\.cpp-keyword/);
  assert.match(styleSource, /--side-panel-width:390px/);
  assert.match(styleSource, /cursor:col-resize/);
});
