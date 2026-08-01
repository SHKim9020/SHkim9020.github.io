(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const DEFAULT_PINS = { in1: 1, in2: 3, in3: 4, in4: 5, led: 8, huskySda: 6, huskyScl: 7 };
  const SAFE_PINS = [0, 1, 3, 4, 5, 6, 7, 10, 20, 21];
  const ALL_PINS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21];
  const STORAGE_KEY = "onemaker-esp32-c3-boat-autosave-v1";
  const BLE_SERVICE_UUID = "7a1f0001-7c73-4d9b-9e4b-4f4d4b000001";
  const BLE_RX_UUID = "7a1f0002-7c73-4d9b-9e4b-4f4d4b000002";
  const BLE_TX_UUID = "7a1f0003-7c73-4d9b-9e4b-4f4d4b000003";
  const CLASSROOM_MAX_PWM = 150;
  const NUMBERED_FIRMWARE_MIN = [1, 4, 0];
  const STABLE_BLE_FIRMWARE_MIN = [1, 4, 3];

  let workspace;
  let serialPort;
  let serialReader;
  let serialWriter;
  let bleDevice;
  let bleRxCharacteristic;
  let bleTxCharacteristic;
  let bleWriteTransport;
  let remoteSafetyController;
  let readLoopActive = false;
  let receiveBuffer = "";
  let boardRuntime = "";
  let boardUploadProtocol = "";
  let boardBluetoothName = "";
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
      type: "remote_when",
      message0: "🎮 리모컨 %1 버튼을 누르면",
      args0: [{
        type: "field_dropdown",
        name: "BUTTON",
        options: [["전진", "forward"], ["후진", "backward"], ["좌회전", "left"], ["우회전", "right"], ["정지", "stop"]]
      }],
      nextStatement: null,
      colour: 315,
      tooltip: "웹 리모컨 버튼을 누를 때 아래 블록을 실행합니다."
    },
    {
      type: "remote_speed",
      message0: "리모컨 속도",
      output: "Number",
      colour: 315,
      tooltip: "수업 안정화가 적용된 웹 리모컨 속도(0~150)입니다."
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
      type: "husky_algorithm",
      message0: "HuskyLens 모드 %1",
      args0: [{
        type: "field_dropdown",
        name: "ALGORITHM",
        options: [
          ["물체 추적", "object_tracking"],
          ["물체 인식", "object_recognition"],
          ["색상 인식", "color_recognition"],
          ["선 추적", "line_tracking"],
          ["얼굴 인식", "face_recognition"],
          ["태그 인식", "tag_recognition"],
          ["물체 분류", "object_classification"]
        ]
      }],
      previousStatement: null,
      nextStatement: null,
      colour: 165
    },
    {
      type: "husky_seen",
      message0: "HuskyLens ID %1 보임?",
      args0: [{ type: "input_value", name: "ID", check: "Number" }],
      output: "Boolean",
      colour: 165
    },
    {
      type: "husky_value",
      message0: "HuskyLens ID %1의 %2",
      args0: [
        { type: "input_value", name: "ID", check: "Number" },
        { type: "field_dropdown", name: "FIELD", options: [["X 중심", "x"], ["Y 중심", "y"], ["너비", "width"], ["높이", "height"]] }
      ],
      output: "Number",
      inputsInline: true,
      colour: 165
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
    },
    {
      type: "my_function_def",
      message0: "🧩 내 블록 %1 정의",
      args0: [{ type: "field_input", name: "NAME", text: "새 동작" }],
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      colour: 290,
      tooltip: "여러 번 사용할 동작을 하나의 내 블록으로 정의합니다."
    },
    {
      type: "my_function_def_value",
      message0: "🧩 값 내 블록 %1 정의",
      args0: [{ type: "field_input", name: "NAME", text: "새 값" }],
      message1: "실행 %1",
      args1: [{ type: "input_statement", name: "DO" }],
      message2: "결과 %1",
      args2: [{ type: "input_value", name: "RETURN" }],
      colour: 290,
      tooltip: "동작을 실행한 뒤 숫자나 센서 값을 돌려주는 내 블록입니다."
    }
  ];

  Blockly.defineBlocksWithJsonArray(blockJson);

  function functionOptions(wantsValue) {
    const targetWorkspace = workspace || Blockly.getMainWorkspace?.();
    const type = wantsValue ? "my_function_def_value" : "my_function_def";
    const names = targetWorkspace?.getAllBlocks(false)
      .filter(block => block.type === type)
      .map(block => block.getFieldValue("NAME")?.trim())
      .filter(Boolean) || [];
    return names.length ? [...new Set(names)].map(name => [name, name]) : [["먼저 정의하세요", "__none__"]];
  }

  Blockly.Blocks.my_function_call = {
    init() {
      this.appendDummyInput()
        .appendField("내 블록")
        .appendField(new Blockly.FieldDropdown(() => functionOptions(false)), "NAME")
        .appendField("실행");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(290);
      this.setTooltip("정의한 내 블록의 동작을 실행합니다.");
    }
  };

  Blockly.Blocks.my_function_call_value = {
    init() {
      this.appendDummyInput()
        .appendField("값 내 블록")
        .appendField(new Blockly.FieldDropdown(() => functionOptions(true)), "NAME");
      this.setOutput(true);
      this.setColour(290);
      this.setTooltip("정의한 값 내 블록을 실행하고 결과를 가져옵니다.");
    }
  };

  const toolbox = {
    kind: "categoryToolbox",
    contents: [
      { kind: "category", name: "시작", colour: "48", contents: [{ kind: "block", type: "boat_start" }] },
      {
        kind: "category", name: "스마트선박", colour: "198", contents: [
          { kind: "block", type: "boat_move", inputs: { SPEED: { shadow: { type: "math_number", fields: { NUM: 150 } } } } },
          { kind: "block", type: "boat_stop" }
        ]
      },
      {
        kind: "category", name: "리모컨", colour: "315", contents: [
          { kind: "block", type: "remote_when" },
          { kind: "block", type: "remote_speed" }
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
        kind: "category", name: "HuskyLens", colour: "165", contents: [
          { kind: "block", type: "husky_algorithm" },
          { kind: "block", type: "husky_seen", inputs: { ID: { shadow: { type: "math_number", fields: { NUM: 1 } } } } },
          { kind: "block", type: "husky_value", inputs: { ID: { shadow: { type: "math_number", fields: { NUM: 1 } } } } }
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
        kind: "category", name: "내 블록", colour: "290", contents: [
          { kind: "block", type: "my_function_def" },
          { kind: "block", type: "my_function_call" },
          { kind: "block", type: "my_function_def_value", inputs: { RETURN: { shadow: { type: "math_number", fields: { NUM: 0 } } } } },
          { kind: "block", type: "my_function_call_value" }
        ]
      },
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
    remoteSafetyController = new BoatRemoteSafetyController(
      command => {
        if (!serialWriter && !bleRxCharacteristic) {
          throw new Error("먼저 Bluetooth 또는 USB로 보트를 연결하세요.");
        }
        return writeLine(JSON.stringify(command));
      },
      {
        maxSpeed: CLASSROOM_MAX_PWM,
        heartbeatMs: 400,
        onError: error => {
          remoteSafetyController.disconnect();
          setRemoteVisual("stop");
          toast(`안전 신호 전송 실패: ${error.message}`);
        }
      }
    );
    bindEvents();
    restoreAutosave();
    if (!workspace.getAllBlocks(false).length) loadExample(false);
    refreshGeneratedCode();
    updateBrowserSupport();
  }

  function populatePinSelects() {
    const ids = ["pinIn1", "pinIn2", "pinIn3", "pinIn4", "huskySda", "huskyScl"];
    ids.forEach((id, index) => {
      const select = $(`#${id}`);
      select.innerHTML = SAFE_PINS.map(pin => `<option value="${pin}">GPIO${pin}</option>`).join("");
      select.value = [
        DEFAULT_PINS.in1, DEFAULT_PINS.in2, DEFAULT_PINS.in3, DEFAULT_PINS.in4,
        DEFAULT_PINS.huskySda, DEFAULT_PINS.huskyScl
      ][index];
    });
    $("#boatNumber").innerHTML = Array.from(
      { length: 16 },
      (_, index) => `<option value="${index + 1}">${String(index + 1).padStart(2, "0")}</option>`
    ).join("");
    $("#boatNumber").value = "1";
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
    $("#bleConnectBtn").addEventListener("click", connectBluetooth);
    $("#bleDisconnectBtn").addEventListener("click", disconnectBluetooth);
    $("#saveBoatNumberBtn").addEventListener("click", saveBoatNumber);
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
    $("#remoteSpeed").addEventListener("input", event => {
      const safeSpeed = Math.min(CLASSROOM_MAX_PWM, Math.max(0, Number(event.target.value) || 0));
      event.target.value = safeSpeed;
      $("#remoteSpeedValue").textContent = safeSpeed;
    });
    const remotePad = $(".remote-pad");
    ["contextmenu", "selectstart", "dragstart"].forEach(eventName => {
      remotePad?.addEventListener(eventName, event => event.preventDefault());
    });
    remotePad?.addEventListener("touchstart", event => event.preventDefault(), { passive: false });
    $$(".test-card .drive-pad button").forEach(button => {
      button.addEventListener("pointerdown", () => quickDrive(button.dataset.drive));
      if (button.dataset.drive !== "stop") {
        button.addEventListener("pointerup", () => quickDrive("stop"));
        button.addEventListener("pointerleave", event => { if (event.buttons) quickDrive("stop"); });
      }
    });
    $$(".remote-pad button").forEach(button => {
      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        remoteDrive(button.dataset.remote, button.dataset.remote === "stop");
      });
      if (button.dataset.remote !== "stop") {
        button.addEventListener("pointerup", () => remoteDrive("stop"));
        button.addEventListener("pointercancel", () => remoteDrive("stop"));
        button.addEventListener("pointerleave", event => { if (event.buttons) remoteDrive("stop"); });
      }
    });
    ["boatNumber", "pinIn1", "pinIn2", "pinIn3", "pinIn4", "invertLeft", "invertRight", "huskyEnabled", "huskySda", "huskyScl"].forEach(id => {
      $(`#${id}`).addEventListener("change", () => {
        codeManuallyEdited = false;
        refreshGeneratedCode();
        scheduleAutosave();
      });
    });
    $("#progressCloseBtn").addEventListener("click", () => $("#progressDialog").close());
    window.addEventListener("beforeunload", () => {
      remoteSafetyController?.disconnect();
      if (serialReader) serialReader.cancel().catch(() => {});
      if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
    });
    if ("serial" in navigator) {
      navigator.serial.addEventListener("disconnect", () => {
        serialWriter = undefined;
        serialPort = undefined;
        readLoopActive = false;
        setConnected(false);
      });
    }
  }

  function activateTab(tabName) {
    $$(".side-tabs button").forEach(button => button.classList.toggle("active", button.dataset.tab === tabName));
    $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === tabName));
  }

  function config() {
    return {
      boatNumber: Number($("#boatNumber").value),
      pins: {
        in1: Number($("#pinIn1").value),
        in2: Number($("#pinIn2").value),
        in3: Number($("#pinIn3").value),
        in4: Number($("#pinIn4").value),
        led: DEFAULT_PINS.led
      },
      invertLeft: $("#invertLeft").checked,
      invertRight: $("#invertRight").checked,
      ledActiveLow: true,
      husky: {
        enabled: $("#huskyEnabled").checked,
        sda: Number($("#huskySda").value),
        scl: Number($("#huskyScl").value)
      }
    };
  }

  function runtimeVersion(runtime = boardRuntime) {
    const match = String(runtime).match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function runtimeVersionText(runtime = boardRuntime) {
    const version = runtimeVersion(runtime);
    return version ? version.join(".") : "확인되지 않음";
  }

  function supportsFirmware(minimum, runtime = boardRuntime) {
    const version = runtimeVersion(runtime);
    if (!version) return false;
    for (let index = 0; index < minimum.length; index++) {
      if (version[index] > minimum[index]) return true;
      if (version[index] < minimum[index]) return false;
    }
    return true;
  }

  function supportsNumberedBoats(runtime = boardRuntime) {
    return supportsFirmware(NUMBERED_FIRMWARE_MIN, runtime);
  }

  function supportsStableBluetooth(runtime = boardRuntime) {
    return supportsFirmware(STABLE_BLE_FIRMWARE_MIN, runtime);
  }

  function showFirmwareUpdateRequired() {
    const version = runtimeVersionText();
    $("#boatNumberStatus").textContent =
      `현재 펌웨어 ${version} · 번호 기능은 1.4.0 이상에서 사용할 수 있습니다.`;
    toast(`현재 펌웨어 ${version}에서는 번호를 저장할 수 없습니다. 1.4.0 펌웨어를 다시 설치하세요.`);
    if (!$("#firmwareDialog").open) $("#firmwareDialog").showModal();
  }

  function resetPins() {
    $("#pinIn1").value = DEFAULT_PINS.in1;
    $("#pinIn2").value = DEFAULT_PINS.in2;
    $("#pinIn3").value = DEFAULT_PINS.in3;
    $("#pinIn4").value = DEFAULT_PINS.in4;
    $("#invertLeft").checked = false;
    $("#invertRight").checked = true;
    $("#huskySda").value = DEFAULT_PINS.huskySda;
    $("#huskyScl").value = DEFAULT_PINS.huskyScl;
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
      program: compileRuntimeProgram(),
      handlers: compileRuntimeHandlers(),
      functions: compileRuntimeFunctions()
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
    $("#boatNumber").value = String(Math.min(16, Math.max(1, Number(cfg.boatNumber) || 1)));
    const pins = cfg.pins || DEFAULT_PINS;
    $("#pinIn1").value = pins.in1 ?? DEFAULT_PINS.in1;
    $("#pinIn2").value = pins.in2 ?? DEFAULT_PINS.in2;
    $("#pinIn3").value = pins.in3 ?? DEFAULT_PINS.in3;
    $("#pinIn4").value = pins.in4 ?? DEFAULT_PINS.in4;
    $("#invertLeft").checked = Boolean(cfg.invertLeft);
    $("#invertRight").checked = cfg.invertRight !== false;
    $("#huskyEnabled").checked = Boolean(cfg.husky?.enabled);
    $("#huskySda").value = cfg.husky?.sda ?? DEFAULT_PINS.huskySda;
    $("#huskyScl").value = cfg.husky?.scl ?? DEFAULT_PINS.huskyScl;
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
            <value name="SPEED"><shadow type="math_number"><field name="NUM">150</field></shadow></value>
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
    const topBlocks = workspace.getTopBlocks(true);
    return topBlocks.find(block => block.type === "boat_start")
      || topBlocks.find(block => block.type !== "remote_when" && !block.type.startsWith("my_function_def"))
      || null;
  }

  function firstStatementBlock() {
    const top = topProgramBlock();
    return top?.type === "boat_start" ? top.getNextBlock() : top;
  }

  function compileRuntimeProgram() {
    return compileStatementChain(firstStatementBlock());
  }

  function compileRuntimeHandlers() {
    const handlers = {};
    workspace.getTopBlocks(true)
      .filter(block => block.type === "remote_when")
      .forEach(block => {
        const button = block.getFieldValue("BUTTON");
        handlers[button] = [...(handlers[button] || []), ...compileStatementChain(block.getNextBlock())];
      });
    return handlers;
  }

  function functionName(block) {
    return block.getFieldValue("NAME") || "내 블록";
  }

  function compileRuntimeFunctions() {
    const functions = {};
    workspace.getTopBlocks(true)
      .filter(block => block.type === "my_function_def" || block.type === "my_function_def_value")
      .forEach(block => {
        const name = functionName(block);
        functions[name] = {
          params: [],
          steps: compileStatementChain(block.getInputTargetBlock("DO")),
          returns: block.type === "my_function_def_value"
            ? expressionAst(block.getInputTargetBlock("RETURN"))
            : null
        };
      });
    return functions;
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
      case "husky_algorithm": return { op: "huskyAlgorithm", algorithm: block.getFieldValue("ALGORITHM") };
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
      case "my_function_call":
        return { op: "call", name: functionName(block), args: [] };
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
      case "remote_speed": return { type: "remoteSpeed" };
      case "husky_seen": return { type: "huskySeen", id: expressionAst(block.getInputTargetBlock("ID")) };
      case "husky_value":
        return { type: "huskyValue", id: expressionAst(block.getInputTargetBlock("ID")), field: block.getFieldValue("FIELD") };
      case "my_function_call_value":
        return { type: "functionCall", name: functionName(block), args: [] };
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
      case "remote_speed": return "remoteSpeed";
      case "husky_seen": return `huskySeen(${cppExpression(block.getInputTargetBlock("ID"))})`;
      case "husky_value": return `huskyValue(${cppExpression(block.getInputTargetBlock("ID"))}, "${block.getFieldValue("FIELD")}")`;
      case "my_function_call_value":
        return `${cppFunction(functionName(block))}()`;
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
        case "husky_algorithm":
          code += `${indent}setHuskyAlgorithm("${block.getFieldValue("ALGORITHM")}");\n`;
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
        case "my_function_call":
          code += `${indent}${cppFunction(functionName(block))}();\n`;
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
    const variables = workspace.getVariableMap().getAllVariables().map(variable => `double ${cppVariable(variable.name)} = 0;`).join("\n");
    const body = cppStatements(firstStatementBlock(), 1) || "  // 왼쪽에서 블록을 가져와 프로그램을 만드세요.\n";
    const procedureBlocks = workspace.getTopBlocks(true)
      .filter(block => block.type === "my_function_def" || block.type === "my_function_def_value");
    const procedureDeclarations = procedureBlocks.map(block => {
      const returnType = block.type === "my_function_def_value" ? "double" : "void";
      return `${returnType} ${cppFunction(functionName(block))}();`;
    }).join("\n");
    const procedureDefinitions = procedureBlocks.map(block => {
      const returnType = block.type === "my_function_def_value" ? "double" : "void";
      const statements = cppStatements(block.getInputTargetBlock("DO"), 1);
      const returnLine = block.type === "my_function_def_value"
        ? `  return ${cppExpression(block.getInputTargetBlock("RETURN"))};\n`
        : "";
      return `${returnType} ${cppFunction(functionName(block))}() {\n${statements}${returnLine}}\n`;
    }).join("\n");
    const usesHusky = workspace.getAllBlocks(false).some(block => block.type.startsWith("husky_"));
    const huskyInclude = usesHusky ? "\n#include <Wire.h>\n#include <HUSKYLENS.h>" : "";
    const huskyGlobals = usesHusky ? `
const int HUSKY_SDA = ${cfg.husky.sda};
const int HUSKY_SCL = ${cfg.husky.scl};
HUSKYLENS huskylens;
bool huskyReady = false;
double remoteSpeed = 0;

bool ensureHusky() {
  if (huskyReady) return true;
  Wire.begin(HUSKY_SDA, HUSKY_SCL);
  huskyReady = huskylens.begin(Wire);
  return huskyReady;
}

bool huskySeen(int id) {
  return ensureHusky() && huskylens.requestBlocks(id) && huskylens.available();
}

int huskyValue(int id, const String &field) {
  if (!ensureHusky() || !huskylens.requestBlocks(id) || !huskylens.available()) return 0;
  HUSKYLENSResult result = huskylens.read();
  if (field == "x") return result.xCenter;
  if (field == "y") return result.yCenter;
  if (field == "width") return result.width;
  return result.height;
}

void setHuskyAlgorithm(const String &algorithm) {
  if (!ensureHusky()) return;
  if (algorithm == "object_tracking") huskylens.writeAlgorithm(ALGORITHM_OBJECT_TRACKING);
  else if (algorithm == "object_recognition") huskylens.writeAlgorithm(ALGORITHM_OBJECT_RECOGNITION);
  else if (algorithm == "color_recognition") huskylens.writeAlgorithm(ALGORITHM_COLOR_RECOGNITION);
  else if (algorithm == "line_tracking") huskylens.writeAlgorithm(ALGORITHM_LINE_TRACKING);
  else if (algorithm == "face_recognition") huskylens.writeAlgorithm(ALGORITHM_FACE_RECOGNITION);
  else if (algorithm == "tag_recognition") huskylens.writeAlgorithm(ALGORITHM_TAG_RECOGNITION);
  else if (algorithm == "object_classification") huskylens.writeAlgorithm(ALGORITHM_OBJECT_CLASSIFICATION);
}
` : "\ndouble remoteSpeed = 0;\n";
    return `// OneMaker ESP32-C3 Boat Studio
// 보드: ESP32C3 Dev Module / USB CDC On Boot: Enabled

#include <Arduino.h>
#include <math.h>${huskyInclude}

const int IN1 = ${cfg.pins.in1};
const int IN2 = ${cfg.pins.in2};
const int IN3 = ${cfg.pins.in3};
const int IN4 = ${cfg.pins.in4};
const int LED_PIN = ${cfg.pins.led};
const int LED_ON = LOW;
const int LED_OFF = HIGH;
const bool INVERT_LEFT = ${cfg.invertLeft ? "true" : "false"};
const bool INVERT_RIGHT = ${cfg.invertRight ? "true" : "false"};

${variables || "// 사용자가 만든 변수 없음"}${huskyGlobals}
${procedureDeclarations || "// 사용자가 만든 내 블록 없음"}

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

${procedureDefinitions}
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

  async function prepareBoardHandshake(preferredTransport) {
    // A saved forever-loop accepts stop/remote commands while it is running, but
    // Saved forever-loops do not answer hello until the stop command has yielded them.
    await writeLine(JSON.stringify({ cmd: "stop" }), preferredTransport);
    await sleep(300);
    return sendCommandAndWait({ cmd: "hello" }, ["hello"], 6000, preferredTransport);
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
      boardRuntime = "";
      boardUploadProtocol = "";
      boardBluetoothName = "";
      serialPort = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
      await serialPort.open({ baudRate: Number($("#baudRate").value) });
      serialWriter = serialPort.writable.getWriter();
      setConnected(true);
      startReadLoop();
      await sleep(350);
      await prepareBoardHandshake("serial");
      if (supportsNumberedBoats()) {
        toast(`ESP32-C3 USB 연결 완료 · 펌웨어 ${runtimeVersionText()}`);
      } else {
        $("#boatNumberStatus").textContent =
          `현재 펌웨어 ${runtimeVersionText()} · 번호 기능을 사용하려면 1.4.0을 다시 설치하세요.`;
        toast(`USB 연결 완료 · 펌웨어 ${runtimeVersionText()}은 번호 저장을 지원하지 않습니다.`);
      }
    } catch (error) {
      console.error(error);
      setConnected(false);
      toast(error.name === "NotFoundError" ? "연결할 장치를 선택하지 않았습니다." : `연결 실패: ${error.message}`);
    }
  }

  async function connectBluetooth() {
    if (!navigator.bluetooth) return toast("Android 또는 PC의 Chrome/Edge에서 Bluetooth 연결을 사용하세요.");
    if (bleDevice?.gatt?.connected && bleRxCharacteristic) return toast("이미 Bluetooth로 연결되어 있습니다.");
    try {
      boardRuntime = "";
      boardUploadProtocol = "";
      boardBluetoothName = "";
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "OneMaker Boat" }],
        optionalServices: [BLE_SERVICE_UUID]
      });
      bleDevice.addEventListener("gattserverdisconnected", () => setBluetoothConnected(false));
      const server = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);
      bleRxCharacteristic = await service.getCharacteristic(BLE_RX_UUID);
      bleTxCharacteristic = await service.getCharacteristic(BLE_TX_UUID);
      bleWriteTransport = new BoatBleWriteQueue(bleRxCharacteristic);
      await bleTxCharacteristic.startNotifications();
      bleTxCharacteristic.addEventListener("characteristicvaluechanged", event => {
        receiveBuffer += new TextDecoder().decode(event.target.value);
        consumeSerialLines();
      });
      setBluetoothConnected(true);
      await prepareBoardHandshake("ble");
      if (!supportsStableBluetooth()) {
        const installedVersion = runtimeVersionText();
        if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
        setBluetoothConnected(false);
        if (!$("#firmwareDialog").open) $("#firmwareDialog").showModal();
        return toast(`수업 안정화 기능을 위해 펌웨어 1.4.3이 필요합니다. 현재 ${installedVersion}입니다.`);
      }
      setBluetoothConnected(true);
      toast(`${boardBluetoothName || bleDevice?.name || "OneMaker Boat"} 연결 완료`);
    } catch (error) {
      console.error(error);
      setBluetoothConnected(false);
      toast(error.name === "NotFoundError" ? "연결할 보트를 선택하지 않았습니다." : `Bluetooth 연결 실패: ${error.message}`);
    }
  }

  async function disconnectBluetooth() {
    if (!bleDevice?.gatt?.connected) {
      setBluetoothConnected(false);
      return toast("연결된 Bluetooth 보트가 없습니다.");
    }
    try {
      await writeLine(JSON.stringify({
        cmd: "remote",
        button: "stop",
        speed: 0
      }), "ble").catch(() => {});
      bleDevice.gatt.disconnect();
      setRemoteVisual("stop");
      setBluetoothConnected(false);
      toast("Bluetooth 연결을 끊었습니다.");
    } catch (error) {
      toast(`Bluetooth 연결 해제 실패: ${error.message}`);
    }
  }

  async function saveBoatNumber() {
    if (!serialWriter) return toast("선박 번호 저장 전에 USB를 연결하세요.");
    const boatNumber = Number($("#boatNumber").value);
    if (!Number.isInteger(boatNumber) || boatNumber < 1 || boatNumber > 16) {
      return toast("선박 번호는 01~16 중에서 선택하세요.");
    }
    try {
      if (!boardRuntime) {
        await prepareBoardHandshake("serial");
      }
      if (!supportsNumberedBoats()) {
        showFirmwareUpdateRequired();
        return;
      }
      const response = await sendCommandAndWait(
        { cmd: "setBoatNumber", boatNumber },
        ["numberSaved"],
        5000,
        "serial"
      );
      const name = response.name || `OneMaker Boat ${String(boatNumber).padStart(2, "0")}`;
      $("#boatNumberStatus").textContent = `${name} 저장 완료 · 보드 재시작 중`;
      toast(`${name}으로 저장했습니다. 잠시 후 USB를 다시 연결하세요.`);
      scheduleAutosave();
    } catch (error) {
      toast(error.message || "선박 번호를 저장하지 못했습니다.");
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
        if (message.type === "hello") {
          boardRuntime = String(message.runtime || "");
          boardUploadProtocol = String(message.uploadProtocol || "");
          boardBluetoothName = String(message.bluetoothName || "");
          const connectedBoatNumber = Number(message.boatNumber);
          if (connectedBoatNumber >= 1 && connectedBoatNumber <= 16) {
            $("#boatNumber").value = String(connectedBoatNumber);
            $("#boatNumberStatus").textContent = `현재 보드: ${message.bluetoothName || `OneMaker Boat ${String(connectedBoatNumber).padStart(2, "0")}`}`;
          } else if (!supportsNumberedBoats(boardRuntime)) {
            $("#boatNumberStatus").textContent =
              `현재 펌웨어 ${runtimeVersionText(boardRuntime)} · 번호 기능을 사용하려면 1.4.0을 다시 설치하세요.`;
          }
          if (bleDevice?.gatt?.connected) setBluetoothConnected(true);
        }
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

  async function writeLine(text, preferredTransport = null) {
    const bytes = new TextEncoder().encode(`${text}\n`);
    if (preferredTransport !== "ble" && serialWriter) {
      for (let offset = 0; offset < bytes.length; offset += 64) {
        await serialWriter.write(bytes.slice(offset, offset + 64));
        if (offset + 64 < bytes.length) await sleep(5);
      }
      return;
    }
    if (bleWriteTransport && bleDevice?.gatt?.connected) {
      await bleWriteTransport.write(bytes);
      return;
    }
    throw new Error("먼저 USB 또는 Bluetooth로 보드와 연결하세요.");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  }

  async function sendCommandAndWait(command, successTypes, timeout = 5000, preferredTransport = null) {
    const responsePromise = waitForMessage(
      message => successTypes.includes(message.type) || message.type === "error",
      timeout
    );
    await writeLine(JSON.stringify(command), preferredTransport);
    const response = await responsePromise;
    if (response.type === "error") {
      const error = new Error(`보드 오류: ${response.message || "명령을 처리하지 못했습니다."}`);
      error.boardMessage = response.message || "";
      throw error;
    }
    return response;
  }

  async function sendLegacyProgram(payload) {
    showProgress("보드에 저장 중", "호환 전송 방식으로 프로그램을 보내고 있습니다.", 45);
    await sendCommandAndWait({ cmd: "load", ...payload }, ["loaded"], 15000);
  }

  async function sendChunkedProgram(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.length > 65536) throw new Error("프로그램이 64KB를 초과했습니다. 블록 수를 줄여주세요.");

    await sendCommandAndWait({ cmd: "loadBegin", size: bytes.length }, ["uploadReady"], 5000);
    const chunkSize = 96;
    const chunkCount = Math.ceil(bytes.length / chunkSize);
    for (let index = 0; index < chunkCount; index++) {
      const chunk = bytes.slice(index * chunkSize, (index + 1) * chunkSize);
      const response = await sendCommandAndWait(
        { cmd: "loadChunk", index, data: bytesToBase64(chunk) },
        ["chunk"],
        5000
      );
      if (String(response.message) !== String(index)) {
        throw new Error(`전송 조각 ${index + 1}의 확인 번호가 맞지 않습니다.`);
      }
      const progress = 30 + Math.round(((index + 1) / chunkCount) * 45);
      showProgress("보드에 저장 중", `프로그램 조각 ${index + 1}/${chunkCount} 전송 중`, progress);
    }
    await sendCommandAndWait({ cmd: "loadEnd" }, ["loaded"], 15000);
  }

  async function sendProgram(payload) {
    if (boardUploadProtocol === "chunked-v1") {
      await sendChunkedProgram(payload);
      return;
    }
    if (boardRuntime) {
      await sendLegacyProgram(payload);
      return;
    }
    try {
      await sendChunkedProgram(payload);
    } catch (error) {
      if (error.boardMessage !== "알 수 없는 명령입니다.") throw error;
      await sendLegacyProgram(payload);
    }
  }

  async function uploadAndRun() {
    try {
      if (!serialWriter && !bleRxCharacteristic) await connectSerial();
      if (!serialWriter && !bleRxCharacteristic) return;
      const program = compileRuntimeProgram();
      const handlers = compileRuntimeHandlers();
      const functions = compileRuntimeFunctions();
      if (!program.length && !Object.keys(handlers).length) throw new Error("실행할 시작 또는 리모컨 이벤트 블록이 없습니다.");
      showProgress("보드에 저장 중", "블록 프로그램을 ESP32-C3로 보내고 있습니다.", 25);
      const stopPromise = waitForMessage(message => message.type === "stopped", 2500).catch(() => null);
      await writeLine(JSON.stringify({ cmd: "stop" }));
      await stopPromise;
      await sleep(200);
      const payload = { config: config(), program, handlers, functions };
      await sendProgram(payload);
      showProgress("실행 준비 완료", "프로그램을 시작합니다.", 80);
      await sendCommandAndWait({ cmd: "run" }, ["started"], 5000);
      showProgress("전송 완료", "USB를 뽑아도 저장한 프로그램이 다시 실행됩니다.", 100, true);
      toast("보드에 저장하고 실행했습니다.");
    } catch (error) {
      showProgress("전송 실패", error.message || "보드에 전송하지 못했습니다.", 0, true);
      toast(error.message || "전송하지 못했습니다.");
    }
  }

  async function emergencyStop() {
    try {
      if (!serialWriter && !bleRxCharacteristic) return toast("보드가 연결되어 있지 않습니다.");
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
        speed: Math.min(CLASSROOM_MAX_PWM, Math.max(0, Number($("#testSpeed").value) || 0)),
        config: config()
      }));
    } catch (error) {
      toast(error.message);
    }
  }

  async function remoteDrive(button, forceStop = false) {
    setRemoteVisual(button);
    try {
      if (button === "stop") {
        await remoteSafetyController.stop(forceStop);
      } else {
        await remoteSafetyController.press(button, Number($("#remoteSpeed").value));
      }
    } catch (error) {
      remoteSafetyController.disconnect();
      setRemoteVisual("stop");
      toast(error.message);
    }
  }

  function setRemoteVisual(direction) {
    const controller = $(".remote-controller");
    if (!controller) return;
    controller.dataset.direction = direction;
    $$(".remote-pad button").forEach(button => button.classList.toggle("active", button.dataset.remote === direction));
    const labels = {
      forward: "전진 중",
      backward: "후진 중",
      left: "좌회전 중",
      right: "우회전 중",
      stop: "정지"
    };
    $("#boatMotionLabel").textContent = labels[direction] || "조종 대기";
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

  function setBluetoothConnected(connected) {
    $("#bleStatus").textContent = connected
      ? `${boardBluetoothName || bleDevice?.name || "OneMaker Boat"} 연결됨`
      : "Bluetooth 연결 안 됨";
    $("#bleStatus").className = `status ${connected ? "connected" : "disconnected"}`;
    $("#bleConnectBtn").textContent = connected ? "Bluetooth 연결됨" : "Bluetooth 보트 연결";
    $("#bleConnectBtn").classList.toggle("connected", connected);
    $("#bleConnectBtn").disabled = connected || !navigator.bluetooth;
    $("#bleDisconnectBtn").disabled = !connected;
    if (!connected) {
      remoteSafetyController?.disconnect();
      setRemoteVisual("stop");
      bleWriteTransport = null;
      bleRxCharacteristic = null;
      bleTxCharacteristic = null;
    }
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

  function cppFunction(value) {
    const normalized = String(value || "my_block").normalize("NFKD").replace(/[^\w\u3131-\uD79D]/g, "_");
    return `my_${normalized || "block"}`;
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
    if (!navigator.bluetooth) {
      $("#bleConnectBtn").disabled = true;
      $("#bleDisconnectBtn").disabled = true;
      $("#bleConnectBtn").title = "Android 또는 PC의 Chrome/Edge가 필요합니다.";
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
