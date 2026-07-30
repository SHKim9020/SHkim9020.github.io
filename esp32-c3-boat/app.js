(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const DEFAULT_PINS = { in1: 1, in2: 3, in3: 4, in4: 5, led: 8 };
  const SAFE_PINS = [0, 1, 3, 4, 5, 6, 7, 10, 20, 21];
  const ALL_PINS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21];
  const STORAGE_KEY = "onemaker-esp32-c3-boat-autosave-v1";

  let workspace;
  let serialPort;
  let serialReader;
  let serialWriter;
  let readLoopActive = false;
  let receiveBuffer = "";
  let selectedBlockId = null;
  let copiedBlockState = null;
  let codeManuallyEdited = false;
  let toastTimer;
  const messageWaiters = [];

  const blockJson = [
    {
      type: "boat_start",
      message0: "🚩 시작하면",
      nextStatement: null,
      colour: 48,
      tooltip: "보드 전원이 켜지거나 실행 명령을 받으면 시작합니다."
    },
    {
      type: "boat_move",
      message0: "스마트선박 %1 속도 %2",
      args0: [
        { type: "field_dropdown", name: "DIRECTION", options: [["전진", "forward"], ["후진", "backward"], ["좌회전", "left"], ["우회전", "right"]] },
        { type: "input_value", name: "SPEED", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 198,
      tooltip: "좌우 모터를 함께 제어합니다."
    },
    {
      type: "boat_stop",
      message0: "스마트선박 정지",
      previousStatement: null,
      nextStatement: null,
      colour: 198
    },
    {
      type: "motor_set",
      message0: "%1 모터 속도 %2",
      args0: [
        { type: "field_dropdown", name: "MOTOR", options: [["왼쪽", "left"], ["오른쪽", "right"]] },
        { type: "input_value", name: "SPEED", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 215,
      tooltip: "-255부터 255까지 입력합니다. 음수는 반대 방향입니다."
    },
    {
      type: "builtin_led",
      message0: "내장 LED %1",
      args0: [{ type: "field_dropdown", name: "STATE", options: [["켜기", "1"], ["끄기", "0"]] }],
      previousStatement: null,
      nextStatement: null,
      colour: 44
    },
    {
      type: "gpio_write",
      message0: "GPIO %1 디지털 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: ALL_PINS.map(pin => [`${pin}`, `${pin}`]) },
        { type: "field_dropdown", name: "STATE", options: [["HIGH", "1"], ["LOW", "0"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 122
    },
    {
      type: "gpio_pwm",
      message0: "GPIO %1 PWM 출력 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: SAFE_PINS.map(pin => [`${pin}`, `${pin}`]) },
        { type: "input_value", name: "VALUE", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 122
    },
    {
      type: "sensor_digital",
      message0: "GPIO %1 디지털 값",
      args0: [{ type: "field_dropdown", name: "PIN", options: ALL_PINS.map(pin => [`${pin}`, `${pin}`]) }],
      output: "Number",
      colour: 168
    },
    {
      type: "sensor_analog",
      message0: "GPIO %1 아날로그 값",
      args0: [{ type: "field_dropdown", name: "PIN", options: [0, 1, 2, 3, 4].map(pin => [`${pin}`, `${pin}`]) }],
      output: "Number",
      colour: 168
    },
    {
      type: "sensor_sonar",
      message0: "초음파 거리 TRIG %1 ECHO %2",
      args0: [
        { type: "field_dropdown", name: "TRIG", options: SAFE_PINS.map(pin => [`${pin}`, `${pin}`]) },
        { type: "field_dropdown", name: "ECHO", options: SAFE_PINS.map(pin => [`${pin}`, `${pin}`]) }
      ],
      output: "Number",
      colour: 168
    },
    {
      type: "control_wait",
      message0: "%1 초 기다리기",
      args0: [{ type: "input_value", name: "SECONDS", check: "Number" }],
      previousStatement: null,
      nextStatement: null,
      colour: 25
    },
    {
      type: "control_forever",
      message0: "계속 반복하기",
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      previousStatement: null,
      nextStatement: null,
      colour: 25
    },
    {
      type: "serial_print",
      message0: "시리얼에 %1 출력",
      args0: [{ type: "input_value", name: "VALUE" }],
      previousStatement: null,
      nextStatement: null,
      colour: 290
    }
  ];

  Blockly.defineBlocksWithJsonArray(blockJson);

  const toolbox = {
    kind: "categoryToolbox",
    contents: [
      { kind: "category", name: "시작", colour: "48", contents: [{ kind: "block", type: "boat_start" }] },
      {
        kind: "category", name: "스마트선박", colour: "198", contents: [
          { kind: "block", type: "boat_move", inputs: { SPEED: { shadow: { type: "math_number", fields: { NUM: 180 } } } } },
          { kind: "block", type: "boat_stop" }
        ]
      },
      {
        kind: "category", name: "모터", colour: "215", contents: [
          { kind: "block", type: "motor_set", inputs: { SPEED: { shadow: { type: "math_number", fields: { NUM: 150 } } } } }
        ]
      },
      {
        kind: "category", name: "핀·LED", colour: "122", contents: [
          { kind: "block", type: "builtin_led" },
          { kind: "block", type: "gpio_write" },
          { kind: "block", type: "gpio_pwm", inputs: { VALUE: { shadow: { type: "math_number", fields: { NUM: 128 } } } } }
        ]
      },
      {
        kind: "category", name: "센서", colour: "168", contents: [
          { kind: "block", type: "sensor_digital" },
          { kind: "block", type: "sensor_analog" },
          { kind: "block", type: "sensor_sonar" }
        ]
      },
      {
        kind: "category", name: "제어", colour: "25", contents: [
          { kind: "block", type: "control_wait", inputs: { SECONDS: { shadow: { type: "math_number", fields: { NUM: 1 } } } } },
          { kind: "block", type: "controls_repeat_ext", inputs: { TIMES: { shadow: { type: "math_number", fields: { NUM: 10 } } } } },
          { kind: "block", type: "control_forever" },
          { kind: "block", type: "controls_if" }
        ]
      },
      {
        kind: "category", name: "연산", colour: "230", contents: [
          { kind: "block", type: "math_number", fields: { NUM: 0 } },
          { kind: "block", type: "math_arithmetic" },
          { kind: "block", type: "logic_compare" },
          { kind: "block", type: "logic_operation" },
          { kind: "block", type: "logic_negate" },
          { kind: "block", type: "logic_boolean" },
          { kind: "block", type: "text" }
        ]
      },
      { kind: "category", name: "변수", colour: "330", custom: "VARIABLE" },
      {
        kind: "category", name: "출력", colour: "290", contents: [
          { kind: "block", type: "serial_print", inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "안녕하세요!" } } } } }
        ]
      }
    ]
  };

  function init() {
    populatePinSelects();
    workspace = Blockly.inject("blocklyDiv", {
      toolbox,
      trashcan: true,
      renderer: "zelos",
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: false, wheel: true, startScale: 0.9, maxScale: 1.5, minScale: 0.45, scaleSpeed: 1.1 },
      grid: { spacing: 22, length: 2, colour: "#dbe4e9", snap: false }
    });
    bindEvents();
    restoreAutosave();
    if (!workspace.getAllBlocks(false).length) loadExample(false);
    refreshGeneratedCode();
    updateBrowserSupport();
  }

  function populatePinSelects() {
    const ids = ["pinIn1", "pinIn2", "pinIn3", "pinIn4"];
    ids.forEach((id, index) => {
      const select = $(`#${id}`);
      select.innerHTML = SAFE_PINS.map(pin => `<option value="${pin}">GPIO${pin}</option>`).join("");
      select.value = [DEFAULT_PINS.in1, DEFAULT_PINS.in2, DEFAULT_PINS.in3, DEFAULT_PINS.in4][index];
    });
  }

  function bindEvents() {
    workspace.addChangeListener(event => {
      if (event.type === Blockly.Events.SELECTED) selectedBlockId = event.newElementId || null;
      if (event.isUiEvent) return;
      codeManuallyEdited = false;
      refreshGeneratedCode();
      scheduleAutosave();
    });

    $$(".side-tabs button").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    $("#firmwareBtn").addEventListener("click", () => $("#firmwareDialog").showModal());
    $("#connectBtn").addEventListener("click", connectSerial);
    $("#uploadBtn").addEventListener("click", uploadAndRun);
    $("#stopBtn").addEventListener("click", emergencyStop);
    $("#exampleBtn").addEventListener("click", () => loadExample(true));
    $("#saveBtn").addEventListener("click", saveProject);
    $("#openBtn").addEventListener("click", () => $("#openFile").click());
    $("#openFile").addEventListener("change", openProject);
    $("#undoBtn").addEventListener("click", () => workspace.undo(false));
    $("#redoBtn").addEventListener("click", () => workspace.undo(true));
    $("#copyBtn").addEventListener("click", copySelectedBlock);
    $("#pasteBtn").addEventListener("click", pasteBlock);
    $("#deleteBtn").addEventListener("click", deleteSelectedBlock);
    $("#zoomInBtn").addEventListener("click", () => workspace.zoomCenter(1));
    $("#zoomOutBtn").addEventListener("click", () => workspace.zoomCenter(-1));
    $("#zoomResetBtn").addEventListener("click", () => {
      workspace.setScale(0.9);
      Blockly.svgResize(workspace);
    });
    $("#centerBtn").addEventListener("click", () => workspace.scrollCenter());
    $("#clearBtn").addEventListener("click", clearWorkspace);
    $("#resetPinsBtn").addEventListener("click", resetPins);
    $("#copyCodeBtn").addEventListener("click", copyCode);
    $("#downloadInoBtn").addEventListener("click", downloadIno);
    $("#codeView").addEventListener("input", () => { codeManuallyEdited = true; });
    $("#clearSerialBtn").addEventListener("click", () => { $("#serialOutput").textContent = ""; });
    $("#serialSendBtn").addEventListener("click", sendSerialText);
    $("#serialInput").addEventListener("keydown", event => { if (event.key === "Enter") sendSerialText(); });
    $("#testSpeed").addEventListener("input", event => { $("#testSpeedValue").textContent = event.target.value; });
    $$(".drive-pad button").forEach(button => {
      button.addEventListener("pointerdown", () => quickDrive(button.dataset.drive));
      if (button.dataset.drive !== "stop") {
        button.addEventListener("pointerup", () => quickDrive("stop"));
        button.addEventListener("pointerleave", event => { if (event.buttons) quickDrive("stop"); });
      }
    });
    ["pinIn1", "pinIn2", "pinIn3", "pinIn4", "invertLeft", "invertRight"].forEach(id => {
      $(`#${id}`).addEventListener("change", () => {
        codeManuallyEdited = false;
        refreshGeneratedCode();
        scheduleAutosave();
      });
    });
    $("#progressCloseBtn").addEventListener("click", () => $("#progressDialog").close());
    window.addEventListener("beforeunload", () => {
      if (serialReader) serialReader.cancel().catch(() => {});
    });
  }

  function activateTab(tabName) {
    $$(".side-tabs button").forEach(button => button.classList.toggle("active", button.dataset.tab === tabName));
    $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === tabName));
  }

  function config() {
    return {
      pins: {
        in1: Number($("#pinIn1").value),
        in2: Number($("#pinIn2").value),
        in3: Number($("#pinIn3").value),
        in4: Number($("#pinIn4").value),
        led: DEFAULT_PINS.led
      },
      invertLeft: $("#invertLeft").checked,
      invertRight: $("#invertRight").checked,
      ledActiveLow: true
    };
  }

  function resetPins() {
    $("#pinIn1").value = DEFAULT_PINS.in1;
    $("#pinIn2").value = DEFAULT_PINS.in2;
    $("#pinIn3").value = DEFAULT_PINS.in3;
    $("#pinIn4").value = DEFAULT_PINS.in4;
    $("#invertLeft").checked = false;
    $("#invertRight").checked = true;
    refreshGeneratedCode();
    toast("DRV8833 기본 핀으로 되돌렸습니다.");
  }

  function projectData() {
    return {
      format: "onemaker-esp32-c3-boat",
      version: 1,
      name: $("#projectName").value.trim() || "나의 스마트선박",
      board: "ESP32-C3 Super Mini",
      config: config(),
      workspace: Blockly.serialization.workspaces.save(workspace),
      program: compileRuntimeProgram()
    };
  }

  function restoreAutosave() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.workspace) loadProjectData(saved);
    } catch (error) {
      console.warn("자동 저장 복원 실패", error);
    }
  }

  let autosaveTimer;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projectData())); } catch (error) { console.warn(error); }
    }, 500);
  }

  function saveProject() {
    downloadBlob(JSON.stringify(projectData(), null, 2), `${safeName($("#projectName").value)}.omc3`, "application/json");
    toast("프로젝트 파일을 저장했습니다.");
  }

  async function openProject(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== "onemaker-esp32-c3-boat") throw new Error("ESP32-C3 Boat Studio 프로젝트가 아닙니다.");
      loadProjectData(data);
      toast("프로젝트를 열었습니다.");
    } catch (error) {
      toast(error.message || "파일을 열 수 없습니다.");
    } finally {
      event.target.value = "";
    }
  }

  function loadProjectData(data) {
    workspace.clear();
    Blockly.serialization.workspaces.load(data.workspace, workspace);
    $("#projectName").value = data.name || "나의 스마트선박";
    const cfg = data.config || {};
    const pins = cfg.pins || DEFAULT_PINS;
    $("#pinIn1").value = pins.in1 ?? DEFAULT_PINS.in1;
    $("#pinIn2").value = pins.in2 ?? DEFAULT_PINS.in2;
    $("#pinIn3").value = pins.in3 ?? DEFAULT_PINS.in3;
    $("#pinIn4").value = pins.in4 ?? DEFAULT_PINS.in4;
    $("#invertLeft").checked = Boolean(cfg.invertLeft);
    $("#invertRight").checked = cfg.invertRight !== false;
    codeManuallyEdited = false;
    refreshGeneratedCode();
  }

  function loadExample(confirmFirst) {
    if (confirmFirst && workspace.getAllBlocks(false).length && !confirm("현재 블록을 지우고 스마트선박 예제를 불러올까요?")) return;
    const xml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="boat_start" x="55" y="45">
          <next><block type="boat_move">
            <field name="DIRECTION">forward</field>
            <value name="SPEED"><shadow type="math_number"><field name="NUM">180</field></shadow></value>
            <next><block type="control_wait">
              <value name="SECONDS"><shadow type="math_number"><field name="NUM">2</field></shadow></value>
              <next><block type="boat_stop">
                <next><block type="control_wait">
                  <value name="SECONDS"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
                  <next><block type="boat_move">
                    <field name="DIRECTION">right</field>
                    <value name="SPEED"><shadow type="math_number"><field name="NUM">150</field></shadow></value>
                    <next><block type="control_wait">
                      <value name="SECONDS"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
                      <next><block type="boat_stop"/></next>
                    </block></next>
                  </block></next>
                </block></next>
              </block></next>
            </block></next>
          </block></next>
        </block>
      </xml>`;
    workspace.clear();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), workspace);
    workspace.scrollCenter();
    codeManuallyEdited = false;
    refreshGeneratedCode();
  }

  function copySelectedBlock() {
    const block = selectedBlockId && workspace.getBlockById(selectedBlockId);
    if (!block) return toast("복사할 블록을 먼저 선택하세요.");
    copiedBlockState = Blockly.serialization.blocks.save(block, { addCoordinates: false, addInputBlocks: true, addNextBlocks: true });
    toast("선택한 블록을 복사했습니다.");
  }

  function pasteBlock() {
    if (!copiedBlockState) return toast("먼저 블록을 복사하세요.");
    const state = JSON.parse(JSON.stringify(copiedBlockState));
    delete state.id;
    Blockly.serialization.blocks.append(state, workspace);
    toast("블록을 붙여넣었습니다.");
  }

  function deleteSelectedBlock() {
    const block = selectedBlockId && workspace.getBlockById(selectedBlockId);
    if (!block) return toast("삭제할 블록을 먼저 선택하세요.");
    block.dispose(true);
    selectedBlockId = null;
  }

  function clearWorkspace() {
    if (!workspace.getAllBlocks(false).length) return;
    if (confirm("모든 블록을 지울까요?")) workspace.clear();
  }

  function topProgramBlock() {
    return workspace.getTopBlocks(true).find(block => block.type === "boat_start") || workspace.getTopBlocks(true)[0] || null;
  }

  function firstStatementBlock() {
    const top = topProgramBlock();
    return top?.type === "boat_start" ? top.getNextBlock() : top;
  }

  function compileRuntimeProgram() {
    return compileStatementChain(firstStatementBlock());
  }

  function compileStatementChain(firstBlock) {
    const steps = [];
    let block = firstBlock;
    while (block) {
      const step = compileStep(block);
      if (step) steps.push(step);
      block = block.getNextBlock();
    }
    return steps;
  }

  function compileStep(block) {
    switch (block.type) {
      case "boat_move":
        return { op: "move", direction: block.getFieldValue("DIRECTION"), speed: expressionAst(block.getInputTargetBlock("SPEED")) };
      case "boat_stop": return { op: "stop" };
      case "motor_set":
        return { op: "motor", motor: block.getFieldValue("MOTOR"), speed: expressionAst(block.getInputTargetBlock("SPEED")) };
      case "builtin_led": return { op: "led", value: Number(block.getFieldValue("STATE")) };
      case "gpio_write": return { op: "digitalWrite", pin: Number(block.getFieldValue("PIN")), value: Number(block.getFieldValue("STATE")) };
      case "gpio_pwm":
        return { op: "analogWrite", pin: Number(block.getFieldValue("PIN")), value: expressionAst(block.getInputTargetBlock("VALUE")) };
      case "control_wait": return { op: "wait", seconds: expressionAst(block.getInputTargetBlock("SECONDS")) };
      case "controls_repeat_ext":
        return { op: "repeat", count: expressionAst(block.getInputTargetBlock("TIMES")), steps: compileStatementChain(block.getInputTargetBlock("DO")) };
      case "control_forever":
        return { op: "forever", steps: compileStatementChain(block.getInputTargetBlock("DO")) };
      case "controls_if": {
        const branches = [];
        let index = 0;
        while (block.getInput(`IF${index}`)) {
          branches.push({
            condition: expressionAst(block.getInputTargetBlock(`IF${index}`)),
            steps: compileStatementChain(block.getInputTargetBlock(`DO${index}`))
          });
          index += 1;
        }
        const elseSteps = block.getInput("ELSE") ? compileStatementChain(block.getInputTargetBlock("ELSE")) : [];
        return { op: "if", branches, elseSteps };
      }
      case "variables_set":
        return { op: "setVar", name: variableName(block), value: expressionAst(block.getInputTargetBlock("VALUE")) };
      case "math_change":
        return { op: "changeVar", name: variableName(block), value: expressionAst(block.getInputTargetBlock("DELTA")) };
      case "serial_print": return { op: "print", value: expressionAst(block.getInputTargetBlock("VALUE")) };
      default:
        return null;
    }
  }

  function variableName(block) {
    const id = block.getFieldValue("VAR");
    return workspace.getVariableById(id)?.name || "변수";
  }

  function expressionAst(block) {
    if (!block) return { type: "number", value: 0 };
    switch (block.type) {
      case "math_number": return { type: "number", value: Number(block.getFieldValue("NUM")) || 0 };
      case "text": return { type: "text", value: block.getFieldValue("TEXT") || "" };
      case "logic_boolean": return { type: "number", value: block.getFieldValue("BOOL") === "TRUE" ? 1 : 0 };
      case "variables_get": return { type: "variable", name: variableName(block) };
      case "sensor_digital": return { type: "digitalRead", pin: Number(block.getFieldValue("PIN")) };
      case "sensor_analog": return { type: "analogRead", pin: Number(block.getFieldValue("PIN")) };
      case "sensor_sonar": return { type: "sonar", trig: Number(block.getFieldValue("TRIG")), echo: Number(block.getFieldValue("ECHO")) };
      case "math_arithmetic":
        return { type: "math", op: block.getFieldValue("OP"), a: expressionAst(block.getInputTargetBlock("A")), b: expressionAst(block.getInputTargetBlock("B")) };
      case "logic_compare":
        return { type: "compare", op: block.getFieldValue("OP"), a: expressionAst(block.getInputTargetBlock("A")), b: expressionAst(block.getInputTargetBlock("B")) };
      case "logic_operation":
        return { type: "logic", op: block.getFieldValue("OP"), a: expressionAst(block.getInputTargetBlock("A")), b: expressionAst(block.getInputTargetBlock("B")) };
      case "logic_negate": return { type: "not", value: expressionAst(block.getInputTargetBlock("BOOL")) };
      default: return { type: "number", value: 0 };
    }
  }

  function cppExpression(block) {
    if (!block) return "0";
    switch (block.type) {
      case "math_number": return `${Number(block.getFieldValue("NUM")) || 0}`;
      case "text": return `"${escapeCpp(block.getFieldValue("TEXT") || "")}"`;
      case "logic_boolean": return block.getFieldValue("BOOL") === "TRUE" ? "true" : "false";
      case "variables_get": return cppVariable(variableName(block));
      case "sensor_digital": return `digitalRead(${block.getFieldValue("PIN")})`;
      case "sensor_analog": return `analogRead(${block.getFieldValue("PIN")})`;
      case "sensor_sonar": return `readSonarCm(${block.getFieldValue("TRIG")}, ${block.getFieldValue("ECHO")})`;
      case "math_arithmetic": {
        const ops = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", POWER: "" };
        const op = block.getFieldValue("OP");
        const a = cppExpression(block.getInputTargetBlock("A"));
        const b = cppExpression(block.getInputTargetBlock("B"));
        return op === "POWER" ? `pow(${a}, ${b})` : `(${a} ${ops[op] || "+"} ${b})`;
      }
      case "logic_compare": {
        const ops = { EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" };
        return `(${cppExpression(block.getInputTargetBlock("A"))} ${ops[block.getFieldValue("OP")] || "=="} ${cppExpression(block.getInputTargetBlock("B"))})`;
      }
      case "logic_operation":
        return `(${cppExpression(block.getInputTargetBlock("A"))} ${block.getFieldValue("OP") === "AND" ? "&&" : "||"} ${cppExpression(block.getInputTargetBlock("B"))})`;
      case "logic_negate": return `(!${cppExpression(block.getInputTargetBlock("BOOL"))})`;
      default: return "0";
    }
  }

  function cppStatements(firstBlock, depth = 1) {
    let block = firstBlock;
    let code = "";
    const indent = "  ".repeat(depth);
    while (block) {
      switch (block.type) {
        case "boat_move":
          code += `${indent}driveBoat("${block.getFieldValue("DIRECTION")}", constrain(${cppExpression(block.getInputTargetBlock("SPEED"))}, 0, 255));\n`;
          break;
        case "boat_stop": code += `${indent}stopBoat();\n`; break;
        case "motor_set":
          code += `${indent}setSingleMotor("${block.getFieldValue("MOTOR")}", constrain(${cppExpression(block.getInputTargetBlock("SPEED"))}, -255, 255));\n`;
          break;
        case "builtin_led":
          code += `${indent}digitalWrite(LED_PIN, ${block.getFieldValue("STATE") === "1" ? "LED_ON" : "LED_OFF"});\n`;
          break;
        case "gpio_write":
          code += `${indent}pinMode(${block.getFieldValue("PIN")}, OUTPUT);\n${indent}digitalWrite(${block.getFieldValue("PIN")}, ${block.getFieldValue("STATE") === "1" ? "HIGH" : "LOW"});\n`;
          break;
        case "gpio_pwm":
          code += `${indent}pinMode(${block.getFieldValue("PIN")}, OUTPUT);\n${indent}analogWrite(${block.getFieldValue("PIN")}, constrain(${cppExpression(block.getInputTargetBlock("VALUE"))}, 0, 255));\n`;
          break;
        case "control_wait":
          code += `${indent}delay((unsigned long)(${cppExpression(block.getInputTargetBlock("SECONDS"))} * 1000));\n`;
          break;
        case "controls_repeat_ext":
          code += `${indent}for (int i = 0; i < ${cppExpression(block.getInputTargetBlock("TIMES"))}; i++) {\n`;
          code += cppStatements(block.getInputTargetBlock("DO"), depth + 1);
          code += `${indent}}\n`;
          break;
        case "control_forever":
          code += `${indent}while (true) {\n${cppStatements(block.getInputTargetBlock("DO"), depth + 1)}${indent}}\n`;
          break;
        case "controls_if": {
          let index = 0;
          while (block.getInput(`IF${index}`)) {
            code += `${indent}${index ? "else if" : "if"} (${cppExpression(block.getInputTargetBlock(`IF${index}`))}) {\n`;
            code += cppStatements(block.getInputTargetBlock(`DO${index}`), depth + 1);
            code += `${indent}} `;
            index += 1;
          }
          if (block.getInput("ELSE")) {
            code += `else {\n${cppStatements(block.getInputTargetBlock("ELSE"), depth + 1)}${indent}}`;
          }
          code += "\n";
          break;
        }
        case "variables_set":
          code += `${indent}${cppVariable(variableName(block))} = ${cppExpression(block.getInputTargetBlock("VALUE"))};\n`;
          break;
        case "math_change":
          code += `${indent}${cppVariable(variableName(block))} += ${cppExpression(block.getInputTargetBlock("DELTA"))};\n`;
          break;
        case "serial_print":
          code += `${indent}Serial.println(${cppExpression(block.getInputTargetBlock("VALUE"))});\n`;
          break;
      }
      block = block.getNextBlock();
    }
    return code;
  }

  function generateCpp() {
    const cfg = config();
    const variables = workspace.getAllVariables().map(variable => `double ${cppVariable(variable.name)} = 0;`).join("\n");
    const body = cppStatements(firstStatementBlock(), 1) || "  // 왼쪽에서 블록을 가져와 프로그램을 만드세요.\n";
    return `// OneMaker ESP32-C3 Boat Studio
// 보드: ESP32C3 Dev Module / USB CDC On Boot: Enabled

#include <Arduino.h>
#include <math.h>

const int IN1 = ${cfg.pins.in1};
const int IN2 = ${cfg.pins.in2};
const int IN3 = ${cfg.pins.in3};
const int IN4 = ${cfg.pins.in4};
const int LED_PIN = ${cfg.pins.led};
const int LED_ON = LOW;
const int LED_OFF = HIGH;
const bool INVERT_LEFT = ${cfg.invertLeft ? "true" : "false"};
const bool INVERT_RIGHT = ${cfg.invertRight ? "true" : "false"};

${variables || "// 사용자가 만든 변수 없음"}

void setChannel(int pinA, int pinB, int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    analogWrite(pinA, speed);
    analogWrite(pinB, 0);
  } else if (speed < 0) {
    analogWrite(pinA, 0);
    analogWrite(pinB, -speed);
  } else {
    analogWrite(pinA, 0);
    analogWrite(pinB, 0);
  }
}

void setDrive(int left, int right) {
  if (INVERT_LEFT) left = -left;
  if (INVERT_RIGHT) right = -right;
  setChannel(IN1, IN2, left);
  setChannel(IN3, IN4, right);
}

void driveBoat(const String &direction, int speed) {
  if (direction == "forward") setDrive(speed, speed);
  else if (direction == "backward") setDrive(-speed, -speed);
  else if (direction == "left") setDrive(-speed, speed);
  else if (direction == "right") setDrive(speed, -speed);
}

void stopBoat() {
  setDrive(0, 0);
}

void setSingleMotor(const String &motor, int speed) {
  if (motor == "left") {
    if (INVERT_LEFT) speed = -speed;
    setChannel(IN1, IN2, speed);
  } else {
    if (INVERT_RIGHT) speed = -speed;
    setChannel(IN3, IN4, speed);
  }
}

long readSonarCm(int trigPin, int echoPin) {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  unsigned long duration = pulseIn(echoPin, HIGH, 30000);
  return duration ? duration / 58 : 0;
}

void setup() {
  Serial.begin(115200);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LED_OFF);
  stopBoat();
  delay(500);
}

void loop() {
${body}  while (true) delay(1000); // 한 번 실행 후 대기
}
`;
  }

  function refreshGeneratedCode() {
    if (!codeManuallyEdited) $("#codeView").value = generateCpp();
  }

  async function connectSerial() {
    if (!("serial" in navigator)) {
      toast("Chrome 또는 Edge의 Web Serial 지원 환경이 필요합니다.");
      return;
    }
    if (serialPort?.readable && serialPort?.writable) {
      toast("이미 ESP32-C3와 연결되어 있습니다.");
      return;
    }
    try {
      serialPort = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
      await serialPort.open({ baudRate: Number($("#baudRate").value) });
      serialWriter = serialPort.writable.getWriter();
      setConnected(true);
      startReadLoop();
      await sleep(350);
      await writeLine(JSON.stringify({ cmd: "hello" }));
      toast("ESP32-C3 USB 연결이 완료되었습니다.");
    } catch (error) {
      console.error(error);
      setConnected(false);
      toast(error.name === "NotFoundError" ? "연결할 장치를 선택하지 않았습니다." : `연결 실패: ${error.message}`);
    }
  }

  async function startReadLoop() {
    if (!serialPort?.readable || readLoopActive) return;
    readLoopActive = true;
    const decoder = new TextDecoder();
    try {
      while (serialPort?.readable && readLoopActive) {
        serialReader = serialPort.readable.getReader();
        try {
          while (true) {
            const { value, done } = await serialReader.read();
            if (done) break;
            receiveBuffer += decoder.decode(value, { stream: true });
            consumeSerialLines();
          }
        } finally {
          serialReader.releaseLock();
          serialReader = null;
        }
      }
    } catch (error) {
      if (readLoopActive) appendSerial(`[연결 오류] ${error.message}`);
    } finally {
      readLoopActive = false;
      if (serialPort && !serialPort.readable) setConnected(false);
    }
  }

  function consumeSerialLines() {
    const lines = receiveBuffer.split(/\r?\n/);
    receiveBuffer = lines.pop() || "";
    lines.forEach(line => {
      if (!line) return;
      appendSerial(line);
      try {
        const message = JSON.parse(line);
        for (let index = messageWaiters.length - 1; index >= 0; index--) {
          const waiter = messageWaiters[index];
          if (waiter.predicate(message)) {
            clearTimeout(waiter.timer);
            messageWaiters.splice(index, 1);
            waiter.resolve(message);
          }
        }
      } catch (_) {}
    });
  }

  function waitForMessage(predicate, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          const index = messageWaiters.indexOf(waiter);
          if (index >= 0) messageWaiters.splice(index, 1);
          reject(new Error("보드의 응답 시간이 초과되었습니다."));
        }, timeout)
      };
      messageWaiters.push(waiter);
    });
  }

  async function writeLine(text) {
    if (!serialWriter) throw new Error("먼저 USB 연결을 눌러 보드와 연결하세요.");
    await serialWriter.write(new TextEncoder().encode(`${text}\n`));
  }

  async function uploadAndRun() {
    try {
      if (!serialWriter) await connectSerial();
      if (!serialWriter) return;
      const program = compileRuntimeProgram();
      if (!program.length) throw new Error("실행할 블록이 없습니다.");
      showProgress("보드에 저장 중", "블록 프로그램을 ESP32-C3로 보내고 있습니다.", 25);
      const stopPromise = waitForMessage(message => message.type === "stopped", 2500).catch(() => null);
      await writeLine(JSON.stringify({ cmd: "stop" }));
      await stopPromise;
      const payload = { cmd: "load", config: config(), program };
      const ackPromise = waitForMessage(message => message.type === "loaded", 8000);
      await writeLine(JSON.stringify(payload));
      await ackPromise;
      showProgress("실행 준비 완료", "프로그램을 시작합니다.", 80);
      const runPromise = waitForMessage(message => message.type === "started", 5000);
      await writeLine(JSON.stringify({ cmd: "run" }));
      await runPromise;
      showProgress("전송 완료", "USB를 뽑아도 저장한 프로그램이 다시 실행됩니다.", 100, true);
      toast("보드에 저장하고 실행했습니다.");
    } catch (error) {
      showProgress("전송 실패", error.message || "보드에 전송하지 못했습니다.", 0, true);
      toast(error.message || "전송하지 못했습니다.");
    }
  }

  async function emergencyStop() {
    try {
      if (!serialWriter) return toast("보드가 연결되어 있지 않습니다.");
      await writeLine(JSON.stringify({ cmd: "stop" }));
      toast("모터 정지 명령을 보냈습니다.");
    } catch (error) {
      toast(error.message);
    }
  }

  async function quickDrive(direction) {
    try {
      if (!serialWriter) return toast("빠른 테스트 전에 USB를 연결하세요.");
      await writeLine(JSON.stringify({
        cmd: "drive",
        direction,
        speed: Number($("#testSpeed").value),
        config: config()
      }));
    } catch (error) {
      toast(error.message);
    }
  }

  async function sendSerialText() {
    const input = $("#serialInput");
    if (!input.value) return;
    try {
      await writeLine(input.value);
      appendSerial(`> ${input.value}`);
      input.value = "";
    } catch (error) {
      toast(error.message);
    }
  }

  function setConnected(connected) {
    $("#connectionStatus").textContent = connected ? "ESP32-C3 연결됨" : "연결 안 됨";
    $("#connectionStatus").className = `status ${connected ? "connected" : "disconnected"}`;
    $("#connectBtn").classList.toggle("connected", connected);
    $("#connectBtn .dot").classList.toggle("on", connected);
    $("#connectBtn").lastChild.textContent = connected ? " 연결됨" : "② USB 연결";
  }

  function appendSerial(text) {
    const output = $("#serialOutput");
    const stamp = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    output.textContent += `[${stamp}] ${text}\n`;
    output.scrollTop = output.scrollHeight;
  }

  function showProgress(title, text, value, closable = false) {
    $("#progressTitle").textContent = title;
    $("#progressText").textContent = text;
    $("#progressBar").value = value;
    $("#progressCloseBtn").hidden = !closable;
    if (!$("#progressDialog").open) $("#progressDialog").showModal();
  }

  async function copyCode() {
    await navigator.clipboard.writeText($("#codeView").value);
    toast("Arduino C++ 코드를 복사했습니다.");
  }

  function downloadIno() {
    downloadBlob($("#codeView").value, `${safeName($("#projectName").value)}.ino`, "text/plain;charset=utf-8");
    toast("INO 파일을 다운로드했습니다.");
  }

  function downloadBlob(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeName(value) {
    return (value || "smart-boat").trim().replace(/[\\/:*?"<>|]+/g, "_");
  }

  function cppVariable(value) {
    const normalized = String(value || "variable").normalize("NFKD").replace(/[^\w\u3131-\uD79D]/g, "_");
    return `var_${normalized || "value"}`;
  }

  function escapeCpp(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 2400);
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function updateBrowserSupport() {
    if (!("serial" in navigator)) {
      $("#connectionStatus").textContent = "Web Serial 미지원";
      $("#connectBtn").title = "PC·크롬북의 Chrome 또는 Edge를 사용하세요.";
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
