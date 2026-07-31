(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const DIGITAL_PINS = Array.from({ length: 12 }, (_, index) => index + 2);
  const PWM_PINS = [3, 5, 6, 9, 10, 11];
  const ANALOG_PINS = ["A0", "A1", "A2", "A3", "A4", "A5"];
  const STORAGE_KEY = "onemaker-arduino-studio-autosave-v1";
  const RUNTIME_VERSION = "1.0.0";
  const LIVE_LOOP_DELAY_MS = 16;
  const EXECUTION_SLICE_MS = 12;
  const EXECUTION_SLICE_STEPS = 40;
  const SERIAL_FLUSH_DELAY_MS = 100;
  const MAX_SERIAL_LINES = 400;

  let workspace;
  let serialPort;
  let serialReader;
  let serialWriter;
  let serialConnected = false;
  let runtimeReady = false;
  let serialBuffer = "";
  let selectedBlockId = null;
  let copiedBlockState = null;
  let toastTimer;
  let requestSequence = 1;
  let runCancelled = false;
  let running = false;
  let executionSliceStarted = 0;
  let executionSliceSteps = 0;
  let serialFlushTimer = null;
  const valueWaiters = new Map();
  const runtimeReadyWaiters = [];
  const liveVariables = new Map();
  const serialLogLines = [];
  const digitalOptions = DIGITAL_PINS.map(pin => [`D${pin}`, String(pin)]);
  const pwmOptions = PWM_PINS.map(pin => [`D${pin} (PWM)`, String(pin)]);
  const analogOptions = ANALOG_PINS.map((pin, index) => [pin, String(index)]);

  const blocks = [
    {
      type: "arduino_start",
      message0: "🚩 시작하면",
      nextStatement: null,
      colour: 48,
      tooltip: "보드 또는 USB 실시간 실행이 시작될 때 한 번 실행합니다."
    },
    {
      type: "arduino_loop",
      message0: "🔁 계속 실행",
      nextStatement: null,
      colour: 48,
      tooltip: "정지할 때까지 아래 블록을 반복합니다."
    },
    {
      type: "control_wait",
      message0: "%1 초 기다리기",
      args0: [{ type: "input_value", name: "SECONDS", check: "Number" }],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
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
      type: "sensor_analog",
      message0: "%1 센서 %2 값",
      args0: [
        {
          type: "field_dropdown",
          name: "SENSOR",
          options: [["조도", "light"], ["토양수분", "soil"], ["가변저항", "pot"], ["아날로그", "analog"]]
        },
        { type: "field_dropdown", name: "PIN", options: analogOptions }
      ],
      output: "Number",
      colour: 155
    },
    {
      type: "pin_digital_read",
      message0: "디지털 입력 핀 %1 값",
      args0: [{ type: "field_dropdown", name: "PIN", options: digitalOptions }],
      output: "Number",
      colour: 65,
      tooltip: "선택한 디지털 핀을 INPUT으로 설정하고 0(LOW) 또는 1(HIGH)을 읽습니다."
    },
    {
      type: "pin_analog_read",
      message0: "아날로그 입력 핀 %1 값",
      args0: [{ type: "field_dropdown", name: "PIN", options: analogOptions }],
      output: "Number",
      colour: 65,
      tooltip: "선택한 아날로그 핀에서 0~1023 값을 읽습니다."
    },
    {
      type: "pin_digital_write",
      message0: "디지털 출력 핀 %1 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: digitalOptions },
        { type: "field_dropdown", name: "STATE", options: [["HIGH", "1"], ["LOW", "0"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 65,
      tooltip: "선택한 디지털 핀을 OUTPUT으로 설정하고 HIGH 또는 LOW를 출력합니다."
    },
    {
      type: "pin_pwm_write",
      message0: "PWM 출력 핀 %1 값 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pwmOptions },
        { type: "input_value", name: "VALUE", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 65,
      tooltip: "UNO·Nano PWM 핀에 0~255 값을 출력합니다. 두 보드에는 별도의 DAC 아날로그 출력이 없습니다."
    },
    {
      type: "sensor_button",
      message0: "푸시버튼 %1 눌림?",
      args0: [{ type: "field_dropdown", name: "PIN", options: digitalOptions }],
      output: "Boolean",
      colour: 155,
      tooltip: "내부 풀업을 사용합니다. 버튼을 핀과 GND 사이에 연결하세요."
    },
    {
      type: "sensor_ultrasonic",
      message0: "초음파 거리 TRIG %1 ECHO %2 cm",
      args0: [
        { type: "field_dropdown", name: "TRIG", options: digitalOptions },
        { type: "field_dropdown", name: "ECHO", options: digitalOptions }
      ],
      output: "Number",
      inputsInline: true,
      colour: 155
    },
    {
      type: "sensor_dht",
      message0: "%1 핀 %2의 %3",
      args0: [
        { type: "field_dropdown", name: "TYPE", options: [["DHT11", "11"], ["DHT22", "22"]] },
        { type: "field_dropdown", name: "PIN", options: digitalOptions },
        { type: "field_dropdown", name: "FIELD", options: [["온도(℃)", "temperature"], ["습도(%)", "humidity"]] }
      ],
      output: "Number",
      colour: 155
    },
    {
      type: "sensor_dust",
      message0: "미세먼지 GP2Y LED %1 아날로그 %2",
      args0: [
        { type: "field_dropdown", name: "LED_PIN", options: digitalOptions },
        { type: "field_dropdown", name: "ANALOG_PIN", options: analogOptions }
      ],
      output: "Number",
      inputsInline: true,
      colour: 155,
      tooltip: "Sharp GP2Y1010 계열 센서의 원시 아날로그 값을 읽습니다."
    },
    {
      type: "led_digital",
      message0: "LED 핀 %1 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: digitalOptions },
        { type: "field_dropdown", name: "STATE", options: [["켜기", "1"], ["끄기", "0"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 110
    },
    {
      type: "led_pwm",
      message0: "LED 밝기 핀 %1 값 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: pwmOptions },
        { type: "input_value", name: "VALUE", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 110
    },
    {
      type: "motor_set",
      message0: "DC모터 IN1 %1 IN2 %2 속도 %3",
      args0: [
        { type: "field_dropdown", name: "IN1", options: pwmOptions },
        { type: "field_dropdown", name: "IN2", options: pwmOptions },
        { type: "input_value", name: "SPEED", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 205,
      tooltip: "-255~255, 0은 정지입니다."
    },
    {
      type: "motor_stop",
      message0: "DC모터 IN1 %1 IN2 %2 정지",
      args0: [
        { type: "field_dropdown", name: "IN1", options: pwmOptions },
        { type: "field_dropdown", name: "IN2", options: pwmOptions }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 205
    },
    {
      type: "servo_write",
      message0: "서보모터 핀 %1 각도 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: digitalOptions },
        { type: "input_value", name: "ANGLE", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 205
    },
    {
      type: "buzzer_tone",
      message0: "피에조 핀 %1 주파수 %2 Hz %3초",
      args0: [
        { type: "field_dropdown", name: "PIN", options: digitalOptions },
        { type: "input_value", name: "FREQ", check: "Number" },
        { type: "input_value", name: "SECONDS", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 35
    },
    {
      type: "buzzer_stop",
      message0: "피에조 핀 %1 소리 끄기",
      args0: [{ type: "field_dropdown", name: "PIN", options: digitalOptions }],
      previousStatement: null,
      nextStatement: null,
      colour: 35
    },
    {
      type: "lcd_begin",
      message0: "I²C LCD 시작 주소 %1 크기 %2",
      args0: [
        { type: "field_dropdown", name: "ADDRESS", options: [["0x27", "39"], ["0x3F", "63"]] },
        { type: "field_dropdown", name: "SIZE", options: [["16×2", "16x2"], ["20×4", "20x4"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 185
    },
    {
      type: "lcd_print",
      message0: "LCD 행 %1 열 %2에 %3 출력",
      args0: [
        { type: "input_value", name: "ROW", check: "Number" },
        { type: "input_value", name: "COL", check: "Number" },
        { type: "input_value", name: "VALUE" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 185
    },
    {
      type: "lcd_clear",
      message0: "LCD 화면 지우기",
      previousStatement: null,
      nextStatement: null,
      colour: 185
    },
    {
      type: "neo_begin",
      message0: "네오픽셀 시작 핀 %1 LED 개수 %2",
      args0: [
        { type: "field_dropdown", name: "PIN", options: digitalOptions },
        { type: "input_value", name: "COUNT", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 290
    },
    {
      type: "neo_set",
      message0: "네오픽셀 번호 %1 R %2 G %3 B %4",
      args0: [
        { type: "input_value", name: "INDEX", check: "Number" },
        { type: "input_value", name: "R", check: "Number" },
        { type: "input_value", name: "G", check: "Number" },
        { type: "input_value", name: "B", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 290
    },
    {
      type: "neo_clear",
      message0: "네오픽셀 모두 끄기",
      previousStatement: null,
      nextStatement: null,
      colour: 290
    },
    {
      type: "mp3_begin",
      message0: "DFPlayer 시작 RX %1 TX %2 볼륨 %3",
      args0: [
        { type: "field_dropdown", name: "RX", options: digitalOptions },
        { type: "field_dropdown", name: "TX", options: digitalOptions },
        { type: "input_value", name: "VOLUME", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 330
    },
    {
      type: "mp3_play",
      message0: "DFPlayer %1번 음악 재생",
      args0: [{ type: "input_value", name: "TRACK", check: "Number" }],
      previousStatement: null,
      nextStatement: null,
      colour: 330
    },
    {
      type: "mp3_volume",
      message0: "DFPlayer 볼륨 %1",
      args0: [{ type: "input_value", name: "VOLUME", check: "Number" }],
      previousStatement: null,
      nextStatement: null,
      colour: 330
    },
    {
      type: "mp3_stop",
      message0: "DFPlayer 정지",
      previousStatement: null,
      nextStatement: null,
      colour: 330
    },
    {
      type: "bt_begin",
      message0: "Bluetooth 시작 RX %1 TX %2 속도 %3",
      args0: [
        { type: "field_dropdown", name: "RX", options: digitalOptions },
        { type: "field_dropdown", name: "TX", options: digitalOptions },
        { type: "field_dropdown", name: "BAUD", options: [["9600", "9600"], ["38400", "38400"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 260
    },
    {
      type: "bt_send",
      message0: "Bluetooth로 %1 보내기",
      args0: [{ type: "input_value", name: "VALUE" }],
      previousStatement: null,
      nextStatement: null,
      colour: 260
    },
    {
      type: "bt_available",
      message0: "Bluetooth 데이터 있음?",
      output: "Boolean",
      colour: 260
    },
    {
      type: "bt_read",
      message0: "Bluetooth 받은 문자열",
      output: "String",
      colour: 260
    },
    {
      type: "serial_print",
      message0: "시리얼에 %1 출력",
      args0: [{ type: "input_value", name: "VALUE" }],
      previousStatement: null,
      nextStatement: null,
      colour: 300
    },
    {
      type: "my_function_def",
      message0: "🧩 내 블록 %1 정의",
      args0: [{ type: "field_input", name: "NAME", text: "새 동작" }],
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      colour: 300
    },
    {
      type: "my_function_def_value",
      message0: "🧩 값 내 블록 %1 정의",
      args0: [{ type: "field_input", name: "NAME", text: "새 값" }],
      message1: "실행 %1",
      args1: [{ type: "input_statement", name: "DO" }],
      message2: "결과 %1",
      args2: [{ type: "input_value", name: "RETURN" }],
      colour: 300
    }
  ];

  Blockly.defineBlocksWithJsonArray(blocks);

  function functionOptions(valueFunction) {
    if (!workspace) return [["먼저 정의하세요", "__none__"]];
    const type = valueFunction ? "my_function_def_value" : "my_function_def";
    const names = workspace.getAllBlocks(false)
      .filter(block => block.type === type)
      .map(block => String(block.getFieldValue("NAME") || "").trim())
      .filter(Boolean);
    return names.length ? [...new Set(names)].map(name => [name, name]) : [["먼저 정의하세요", "__none__"]];
  }

  Blockly.Blocks.my_function_call = {
    init() {
      this.appendDummyInput().appendField("내 블록")
        .appendField(new Blockly.FieldDropdown(() => functionOptions(false)), "NAME")
        .appendField("실행");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(300);
    }
  };

  Blockly.Blocks.my_function_call_value = {
    init() {
      this.appendDummyInput().appendField("값 내 블록")
        .appendField(new Blockly.FieldDropdown(() => functionOptions(true)), "NAME");
      this.setOutput(true);
      this.setColour(300);
    }
  };

  const numberShadow = value => ({ shadow: { type: "math_number", fields: { NUM: value } } });
  const textShadow = value => ({ shadow: { type: "text", fields: { TEXT: value } } });
  const toolbox = {
    kind: "categoryToolbox",
    contents: [
      { kind: "category", name: "시작", colour: "48", contents: [
        { kind: "block", type: "arduino_start" },
        { kind: "block", type: "arduino_loop" }
      ] },
      { kind: "category", name: "핀 입·출력", colour: "65", contents: [
        { kind: "block", type: "pin_digital_read" },
        { kind: "block", type: "pin_analog_read" },
        { kind: "block", type: "pin_digital_write" },
        { kind: "block", type: "pin_pwm_write", inputs: { VALUE: numberShadow(128) } }
      ] },
      { kind: "category", name: "입력·센서", colour: "155", contents: [
        { kind: "block", type: "sensor_analog" },
        { kind: "block", type: "sensor_button" },
        { kind: "block", type: "sensor_ultrasonic" },
        { kind: "block", type: "sensor_dht" },
        { kind: "block", type: "sensor_dust" }
      ] },
      { kind: "category", name: "LED", colour: "110", contents: [
        { kind: "block", type: "led_digital" },
        { kind: "block", type: "led_pwm", inputs: { VALUE: numberShadow(128) } }
      ] },
      { kind: "category", name: "DC모터·서보", colour: "205", contents: [
        { kind: "block", type: "motor_set", inputs: { SPEED: numberShadow(180) } },
        { kind: "block", type: "motor_stop" },
        { kind: "block", type: "servo_write", inputs: { ANGLE: numberShadow(90) } }
      ] },
      { kind: "category", name: "피에조", colour: "35", contents: [
        { kind: "block", type: "buzzer_tone", inputs: { FREQ: numberShadow(262), SECONDS: numberShadow(0.5) } },
        { kind: "block", type: "buzzer_stop" }
      ] },
      { kind: "category", name: "I²C LCD", colour: "185", contents: [
        { kind: "block", type: "lcd_begin" },
        { kind: "block", type: "lcd_print", inputs: { ROW: numberShadow(0), COL: numberShadow(0), VALUE: textShadow("안녕하세요") } },
        { kind: "block", type: "lcd_clear" }
      ] },
      { kind: "category", name: "네오픽셀", colour: "290", contents: [
        { kind: "block", type: "neo_begin", inputs: { COUNT: numberShadow(8) } },
        { kind: "block", type: "neo_set", inputs: { INDEX: numberShadow(0), R: numberShadow(255), G: numberShadow(0), B: numberShadow(0) } },
        { kind: "block", type: "neo_clear" }
      ] },
      { kind: "category", name: "MP3", colour: "330", contents: [
        { kind: "block", type: "mp3_begin", inputs: { VOLUME: numberShadow(20) } },
        { kind: "block", type: "mp3_play", inputs: { TRACK: numberShadow(1) } },
        { kind: "block", type: "mp3_volume", inputs: { VOLUME: numberShadow(20) } },
        { kind: "block", type: "mp3_stop" }
      ] },
      { kind: "category", name: "Bluetooth", colour: "260", contents: [
        { kind: "block", type: "bt_begin" },
        { kind: "block", type: "bt_send", inputs: { VALUE: textShadow("전진") } },
        { kind: "block", type: "bt_available" },
        { kind: "block", type: "bt_read" }
      ] },
      { kind: "category", name: "제어", colour: "25", contents: [
        { kind: "block", type: "control_wait", inputs: { SECONDS: numberShadow(1) } },
        { kind: "block", type: "controls_repeat_ext", inputs: { TIMES: numberShadow(10) } },
        { kind: "block", type: "control_forever" },
        { kind: "block", type: "controls_if" }
      ] },
      { kind: "category", name: "연산", colour: "230", contents: [
        { kind: "block", type: "math_number", fields: { NUM: 0 } },
        { kind: "block", type: "math_arithmetic" },
        { kind: "block", type: "logic_compare" },
        { kind: "block", type: "logic_operation" },
        { kind: "block", type: "logic_negate" },
        { kind: "block", type: "logic_boolean" },
        { kind: "block", type: "text" },
        { kind: "block", type: "text_join" }
      ] },
      { kind: "category", name: "변수", colour: "330", custom: "VARIABLE" },
      { kind: "category", name: "내 블록", colour: "300", contents: [
        { kind: "block", type: "my_function_def" },
        { kind: "block", type: "my_function_call" },
        { kind: "block", type: "my_function_def_value", inputs: { RETURN: numberShadow(0) } },
        { kind: "block", type: "my_function_call_value" }
      ] },
      { kind: "category", name: "출력", colour: "300", contents: [
        { kind: "block", type: "serial_print", inputs: { VALUE: textShadow("안녕하세요!") } }
      ] }
    ]
  };

  function init() {
    populateSelects();
    workspace = Blockly.inject("blocklyDiv", {
      toolbox,
      trashcan: true,
      renderer: "zelos",
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: false, wheel: true, startScale: 0.88, maxScale: 1.5, minScale: 0.42, scaleSpeed: 1.1 },
      grid: { spacing: 22, length: 2, colour: "#dbe4e9", snap: false }
    });
    bindEvents();
    restoreAutosave();
    if (!workspace.getAllBlocks(false).length) loadExample(false);
    refreshCode();
    updateBrowserSupport();
  }

  function populateSelects() {
    const digitalHtml = digitalOptions.map(([label, value]) => `<option value="${value}">${label}</option>`).join("");
    const analogHtml = analogOptions.map(([label, value]) => `<option value="${value}">${label}</option>`).join("");
    ["testPin", "testDigitalPin", "motorPin1", "motorPin2"].forEach(id => { $(`#${id}`).innerHTML = digitalHtml; });
    $("#testAnalogPin").innerHTML = analogHtml;
    $("#testPin").value = "13";
    $("#testDigitalPin").value = "2";
    $("#motorPin1").value = "5";
    $("#motorPin2").value = "6";
  }

  function bindEvents() {
    workspace.addChangeListener(event => {
      if (event.type === Blockly.Events.SELECTED) selectedBlockId = event.newElementId || null;
      if (event.isUiEvent) return;
      refreshCode();
      scheduleAutosave();
    });
    $$(".side-tabs button").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    $("#boardType").addEventListener("change", updateBoardTitle);
    $("#exampleBtn").addEventListener("click", () => loadExample(true));
    $("#saveBtn").addEventListener("click", saveProject);
    $("#openBtn").addEventListener("click", () => $("#openFile").click());
    $("#openFile").addEventListener("change", openProject);
    $("#firmwareBtn").addEventListener("click", openFirmwareDialog);
    $("#connectBtn").addEventListener("click", toggleSerialConnection);
    $("#runBtn").addEventListener("click", runWorkspace);
    $("#stopBtn").addEventListener("click", stopWorkspace);
    $("#undoBtn").addEventListener("click", () => workspace.undo(false));
    $("#redoBtn").addEventListener("click", () => workspace.undo(true));
    $("#copyBtn").addEventListener("click", copySelectedBlock);
    $("#pasteBtn").addEventListener("click", pasteBlock);
    $("#deleteBtn").addEventListener("click", deleteSelectedBlock);
    $("#zoomInBtn").addEventListener("click", () => workspace.zoomCenter(1));
    $("#zoomOutBtn").addEventListener("click", () => workspace.zoomCenter(-1));
    $("#zoomResetBtn").addEventListener("click", () => { workspace.setScale(0.88); Blockly.svgResize(workspace); });
    $("#centerBtn").addEventListener("click", () => workspace.scrollCenter());
    $("#clearBtn").addEventListener("click", clearWorkspace);
    $("#copyCodeBtn").addEventListener("click", copyCode);
    $("#downloadInoBtn").addEventListener("click", downloadIno);
    $("#clearSerialBtn").addEventListener("click", clearSerialOutput);
    $("#serialSendBtn").addEventListener("click", sendSerialText);
    $("#serialInput").addEventListener("keydown", event => { if (event.key === "Enter") sendSerialText(); });
    $("#testHighBtn").addEventListener("click", () => sendAction("DW", $("#testPin").value, 1));
    $("#testLowBtn").addEventListener("click", () => sendAction("DW", $("#testPin").value, 0));
    $("#testPwmBtn").addEventListener("click", () => sendAction("PW", $("#testPin").value, clamp($("#testValue").value, 0, 255)));
    $("#readDigitalBtn").addEventListener("click", async () => showTestResult(await requestValue("DR", $("#testDigitalPin").value)));
    $("#readAnalogBtn").addEventListener("click", async () => showTestResult(await requestValue("AR", $("#testAnalogPin").value)));
    $("#motorRunBtn").addEventListener("click", () => sendAction("MOTOR", $("#motorPin1").value, $("#motorPin2").value, clamp($("#motorSpeed").value, -255, 255)));
    $("#motorStopBtn").addEventListener("click", () => sendAction("MOTOR", $("#motorPin1").value, $("#motorPin2").value, 0));
    window.addEventListener("beforeunload", () => {
      runCancelled = true;
      if (serialReader) serialReader.cancel().catch(() => {});
    });
    if ("serial" in navigator) {
      navigator.serial.addEventListener("disconnect", () => closeSerialState());
    }
  }

  function activateTab(name) {
    $$(".side-tabs button").forEach(button => button.classList.toggle("active", button.dataset.tab === name));
    $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === name));
  }

  function updateBoardTitle() {
    const names = {
      uno: "Arduino UNO R3",
      nano: "Arduino Nano",
      nanoOldBootloader: "Arduino Nano 구형 부트로더"
    };
    $("#boardTitle").textContent = names[$("#boardType").value];
    scheduleAutosave();
  }

  function updateBrowserSupport() {
    const supported = "serial" in navigator;
    $("#connectBtn").disabled = !supported;
    $("#runBtn").disabled = !supported;
    if (!supported) $("#connectionStatus").textContent = "Chrome·Edge 필요";
  }

  function openFirmwareDialog() {
    if (!("serial" in navigator)) return toast("PC·크롬북의 Chrome 또는 Edge에서 설치할 수 있습니다.");
    if (serialConnected) return toast("먼저 USB 연결을 끊은 뒤 런타임을 설치하세요.");
    $("#firmwareDialog").showModal();
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 2800);
  }

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

  async function yieldToBrowser(force = false) {
    executionSliceSteps++;
    const now = performance.now();
    if (!executionSliceStarted) executionSliceStarted = now;
    if (!force && executionSliceSteps < EXECUTION_SLICE_STEPS && now - executionSliceStarted < EXECUTION_SLICE_MS) return;
    executionSliceSteps = 0;
    executionSliceStarted = performance.now();
    await sleep(0);
  }

  async function toggleSerialConnection() {
    if (serialConnected) {
      await disconnectSerial();
      return;
    }
    if (!("serial" in navigator)) return toast("Chrome 또는 Edge의 Web Serial 환경이 필요합니다.");
    try {
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: 115200, bufferSize: 1024 });
      serialWriter = serialPort.writable.getWriter();
      serialConnected = true;
      runtimeReady = false;
      setConnected(true);
      readSerialLoop();
      await sleep(800);
      const readyPromise = waitForRuntimeReady(2500);
      await sendLine("PING");
      await readyPromise;
      toast(`OneMaker Arduino Runtime ${RUNTIME_VERSION} 연결 완료`);
    } catch (error) {
      console.error(error);
      if (error.name !== "NotFoundError") toast(`USB 연결 실패: ${error.message}`);
      await disconnectSerial().catch(() => {});
    }
  }

  async function disconnectSerial() {
    runCancelled = true;
    runtimeReady = false;
    for (const waiter of valueWaiters.values()) waiter.reject(new Error("USB 연결이 끊어졌습니다."));
    valueWaiters.clear();
    if (serialReader) {
      await serialReader.cancel().catch(() => {});
      serialReader = null;
    }
    if (serialWriter) {
      serialWriter.releaseLock();
      serialWriter = null;
    }
    if (serialPort) {
      await serialPort.close().catch(() => {});
      serialPort = null;
    }
    closeSerialState();
  }

  function closeSerialState() {
    serialConnected = false;
    runtimeReady = false;
    setConnected(false);
  }

  function setConnected(connected) {
    $("#connectionStatus").textContent = connected
      ? (runtimeReady ? "런타임 연결됨" : "USB 확인 중")
      : "연결 안 됨";
    $("#connectionStatus").className = `status ${connected ? "connected" : "disconnected"}`;
    $("#connectBtn").classList.toggle("primary", connected);
    $("#connectBtn .dot").classList.toggle("on", connected);
    $("#connectBtn").lastChild.textContent = connected ? " 연결 끊기" : "② USB 연결";
  }

  async function readSerialLoop() {
    const decoder = new TextDecoder();
    try {
      while (serialPort?.readable && serialConnected) {
        serialReader = serialPort.readable.getReader();
        try {
          while (true) {
            const { value, done } = await serialReader.read();
            if (done) break;
            serialBuffer += decoder.decode(value, { stream: true });
            consumeSerialLines();
          }
        } finally {
          serialReader.releaseLock();
          serialReader = null;
        }
      }
    } catch (error) {
      if (serialConnected) appendSerial(`[USB 오류] ${error.message}`);
    } finally {
      if (serialConnected) closeSerialState();
    }
  }

  function consumeSerialLines() {
    const lines = serialBuffer.split(/\r?\n/);
    serialBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line) continue;
      appendSerial(line);
      const parts = line.split(",");
      if (parts[0] === "READY") {
        runtimeReady = true;
        setConnected(true);
        while (runtimeReadyWaiters.length) runtimeReadyWaiters.shift().resolve(line);
      } else if ((parts[0] === "V" || parts[0] === "T") && parts[1]) {
        const waiter = valueWaiters.get(parts[1]);
        if (!waiter) continue;
        clearTimeout(waiter.timer);
        valueWaiters.delete(parts[1]);
        waiter.resolve(parts[0] === "T" ? decodeHex(parts.slice(2).join("")) : Number(parts.slice(2).join(",")));
      }
    }
  }

  function waitForRuntimeReady(timeout = 2500) {
    if (runtimeReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      runtimeReadyWaiters.push(waiter);
      setTimeout(() => {
        const index = runtimeReadyWaiters.indexOf(waiter);
        if (index >= 0) runtimeReadyWaiters.splice(index, 1);
        reject(new Error("OneMaker 런타임 응답이 없습니다. 먼저 런타임을 설치하세요."));
      }, timeout);
    });
  }

  async function sendLine(line) {
    if (!serialWriter || !serialConnected) throw new Error("먼저 USB를 연결하세요.");
    await serialWriter.write(new TextEncoder().encode(`${line}\n`));
  }

  async function ensureRuntime() {
    if (!serialConnected || !serialWriter) throw new Error("먼저 USB를 연결하세요.");
    if (!runtimeReady) {
      const readyPromise = waitForRuntimeReady(1800);
      await sendLine("PING");
      await readyPromise;
    }
  }

  async function sendAction(operation, ...args) {
    try {
      await ensureRuntime();
      await sendLine(["C", operation, ...args].join(","));
    } catch (error) {
      toast(error.message);
      throw error;
    }
  }

  async function requestValue(operation, ...args) {
    await ensureRuntime();
    const id = String(requestSequence++);
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        valueWaiters.delete(id);
        reject(new Error(`${operation} 센서 응답 시간이 초과되었습니다.`));
      }, 3000);
      valueWaiters.set(id, { resolve, reject, timer });
    });
    await sendLine(["Q", id, operation, ...args].join(","));
    return result;
  }

  function encodeHex(value) {
    return [...new TextEncoder().encode(String(value))]
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function decodeHex(value) {
    const bytes = [];
    for (let index = 0; index + 1 < value.length; index += 2) bytes.push(parseInt(value.slice(index, index + 2), 16));
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  function appendSerial(text) {
    const now = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    serialLogLines.push(`[${now}] ${text}`);
    if (serialLogLines.length > MAX_SERIAL_LINES) {
      serialLogLines.splice(0, serialLogLines.length - MAX_SERIAL_LINES);
    }
    if (serialFlushTimer) return;
    serialFlushTimer = setTimeout(flushSerialOutput, SERIAL_FLUSH_DELAY_MS);
  }

  function flushSerialOutput() {
    serialFlushTimer = null;
    const output = $("#serialOutput");
    output.textContent = serialLogLines.length ? `${serialLogLines.join("\n")}\n` : "";
    output.scrollTop = output.scrollHeight;
  }

  function clearSerialOutput() {
    serialLogLines.length = 0;
    if (serialFlushTimer) {
      clearTimeout(serialFlushTimer);
      serialFlushTimer = null;
    }
    $("#serialOutput").textContent = "";
  }

  async function sendSerialText() {
    const input = $("#serialInput");
    const value = input.value.trim();
    if (!value) return;
    try {
      await sendLine(value);
      appendSerial(`[보냄] ${value}`);
      input.value = "";
    } catch (error) {
      toast(error.message);
    }
  }

  function showTestResult(value) {
    $("#testResult").textContent = `측정값: ${value}`;
  }

  function variableKey(block) {
    return block.getField("VAR")?.getVariable()?.getId()
      || block.getFieldValue("VAR")
      || "variable";
  }

  function inputBlock(block, name) {
    return block?.getInputTargetBlock(name) || null;
  }

  async function evaluate(block, functionDepth = 0) {
    if (!block) return 0;
    if (runCancelled) throw new Error("실행이 중지되었습니다.");
    switch (block.type) {
      case "math_number": return Number(block.getFieldValue("NUM")) || 0;
      case "text": return String(block.getFieldValue("TEXT") || "");
      case "logic_boolean": return block.getFieldValue("BOOL") === "TRUE";
      case "variables_get": return liveVariables.get(variableKey(block)) ?? 0;
      case "math_arithmetic": {
        const left = Number(await evaluate(inputBlock(block, "A"), functionDepth));
        const right = Number(await evaluate(inputBlock(block, "B"), functionDepth));
        switch (block.getFieldValue("OP")) {
          case "ADD": return left + right;
          case "MINUS": return left - right;
          case "MULTIPLY": return left * right;
          case "DIVIDE": return right === 0 ? 0 : left / right;
          case "POWER": return Math.pow(left, right);
          default: return 0;
        }
      }
      case "logic_compare": {
        const left = await evaluate(inputBlock(block, "A"), functionDepth);
        const right = await evaluate(inputBlock(block, "B"), functionDepth);
        switch (block.getFieldValue("OP")) {
          case "EQ": return left == right;
          case "NEQ": return left != right;
          case "LT": return Number(left) < Number(right);
          case "LTE": return Number(left) <= Number(right);
          case "GT": return Number(left) > Number(right);
          case "GTE": return Number(left) >= Number(right);
          default: return false;
        }
      }
      case "logic_operation": {
        const left = Boolean(await evaluate(inputBlock(block, "A"), functionDepth));
        if (block.getFieldValue("OP") === "AND") return left && Boolean(await evaluate(inputBlock(block, "B"), functionDepth));
        return left || Boolean(await evaluate(inputBlock(block, "B"), functionDepth));
      }
      case "logic_negate": return !Boolean(await evaluate(inputBlock(block, "BOOL"), functionDepth));
      case "text_join": {
        let result = "";
        for (let index = 0; block.getInput(`ADD${index}`); index++) {
          result += String(await evaluate(inputBlock(block, `ADD${index}`), functionDepth));
        }
        return result;
      }
      case "sensor_analog": return requestValue("AR", block.getFieldValue("PIN"));
      case "pin_digital_read": return requestValue("DR", block.getFieldValue("PIN"));
      case "pin_analog_read": return requestValue("AR", block.getFieldValue("PIN"));
      case "sensor_button": return Boolean(await requestValue("BUTTON", block.getFieldValue("PIN")));
      case "sensor_ultrasonic": return requestValue("SONAR", block.getFieldValue("TRIG"), block.getFieldValue("ECHO"));
      case "sensor_dht": return requestValue("DHT", block.getFieldValue("PIN"), block.getFieldValue("TYPE"), block.getFieldValue("FIELD") === "humidity" ? 1 : 0);
      case "sensor_dust": return requestValue("DUST", block.getFieldValue("LED_PIN"), block.getFieldValue("ANALOG_PIN"));
      case "bt_available": return Boolean(await requestValue("BTAVAIL"));
      case "bt_read": return requestValue("BTREAD");
      case "my_function_call_value": {
        if (functionDepth > 12) throw new Error("내 블록 호출이 너무 깊습니다.");
        const definition = workspace.getAllBlocks(false).find(candidate =>
          candidate.type === "my_function_def_value" &&
          candidate.getFieldValue("NAME") === block.getFieldValue("NAME")
        );
        if (!definition) return 0;
        await executeChain(definition.getInputTargetBlock("DO"), functionDepth + 1);
        return evaluate(definition.getInputTargetBlock("RETURN"), functionDepth + 1);
      }
      default: return 0;
    }
  }

  async function executeChain(firstBlock, functionDepth = 0) {
    let block = firstBlock;
    while (block && !runCancelled) {
      await executeStatement(block, functionDepth);
      await yieldToBrowser();
      block = block.getNextBlock();
    }
  }

  async function executeStatement(block, functionDepth = 0) {
    switch (block.type) {
      case "control_wait":
        await sleep(Math.max(0, Number(await evaluate(inputBlock(block, "SECONDS"), functionDepth))) * 1000);
        return;
      case "control_forever":
        while (!runCancelled) {
          await executeChain(block.getInputTargetBlock("DO"), functionDepth);
          await sleep(LIVE_LOOP_DELAY_MS);
        }
        return;
      case "controls_repeat_ext": {
        const times = clamp(await evaluate(inputBlock(block, "TIMES"), functionDepth), 0, 10000);
        for (let index = 0; index < times && !runCancelled; index++) {
          await executeChain(block.getInputTargetBlock("DO"), functionDepth);
          await yieldToBrowser();
        }
        return;
      }
      case "controls_if": {
        let branchTaken = false;
        for (let index = 0; block.getInput(`IF${index}`); index++) {
          if (Boolean(await evaluate(block.getInputTargetBlock(`IF${index}`), functionDepth))) {
            await executeChain(block.getInputTargetBlock(`DO${index}`), functionDepth);
            branchTaken = true;
            break;
          }
        }
        if (!branchTaken && block.getInput("ELSE")) await executeChain(block.getInputTargetBlock("ELSE"), functionDepth);
        return;
      }
      case "variables_set":
        liveVariables.set(variableKey(block), await evaluate(inputBlock(block, "VALUE"), functionDepth));
        return;
      case "math_change": {
        const key = variableKey(block);
        const current = Number(liveVariables.get(key) || 0);
        liveVariables.set(key, current + Number(await evaluate(inputBlock(block, "DELTA"), functionDepth)));
        return;
      }
      case "pin_digital_write":
        return sendAction("DW", block.getFieldValue("PIN"), block.getFieldValue("STATE"));
      case "pin_pwm_write":
        return sendAction("PW", block.getFieldValue("PIN"), clamp(await evaluate(inputBlock(block, "VALUE"), functionDepth), 0, 255));
      case "led_digital":
        return sendAction("DW", block.getFieldValue("PIN"), block.getFieldValue("STATE"));
      case "led_pwm":
        return sendAction("PW", block.getFieldValue("PIN"), clamp(await evaluate(inputBlock(block, "VALUE"), functionDepth), 0, 255));
      case "motor_set":
        return sendAction("MOTOR", block.getFieldValue("IN1"), block.getFieldValue("IN2"), clamp(await evaluate(inputBlock(block, "SPEED"), functionDepth), -255, 255));
      case "motor_stop":
        return sendAction("MOTOR", block.getFieldValue("IN1"), block.getFieldValue("IN2"), 0);
      case "servo_write":
        return sendAction("SERVO", block.getFieldValue("PIN"), clamp(await evaluate(inputBlock(block, "ANGLE"), functionDepth), 0, 180));
      case "buzzer_tone":
        return sendAction(
          "TONE",
          block.getFieldValue("PIN"),
          clamp(await evaluate(inputBlock(block, "FREQ"), functionDepth), 20, 20000),
          clamp(Number(await evaluate(inputBlock(block, "SECONDS"), functionDepth)) * 1000, 1, 60000)
        );
      case "buzzer_stop":
        return sendAction("NOTONE", block.getFieldValue("PIN"));
      case "lcd_begin": {
        const [columns, rows] = block.getFieldValue("SIZE").split("x");
        return sendAction("LCDBEGIN", block.getFieldValue("ADDRESS"), columns, rows);
      }
      case "lcd_print":
        return sendAction(
          "LCDPRINT",
          clamp(await evaluate(inputBlock(block, "ROW"), functionDepth), 0, 3),
          clamp(await evaluate(inputBlock(block, "COL"), functionDepth), 0, 19),
          encodeHex(await evaluate(inputBlock(block, "VALUE"), functionDepth))
        );
      case "lcd_clear":
        return sendAction("LCDCLEAR");
      case "neo_begin":
        return sendAction("NEOBEGIN", block.getFieldValue("PIN"), clamp(await evaluate(inputBlock(block, "COUNT"), functionDepth), 1, 60));
      case "neo_set":
        return sendAction(
          "NEOSET",
          clamp(await evaluate(inputBlock(block, "INDEX"), functionDepth), 0, 59),
          clamp(await evaluate(inputBlock(block, "R"), functionDepth), 0, 255),
          clamp(await evaluate(inputBlock(block, "G"), functionDepth), 0, 255),
          clamp(await evaluate(inputBlock(block, "B"), functionDepth), 0, 255)
        );
      case "neo_clear":
        return sendAction("NEOCLEAR");
      case "mp3_begin":
        await sendAction("MP3BEGIN", block.getFieldValue("RX"), block.getFieldValue("TX"));
        return sendAction("MP3VOL", clamp(await evaluate(inputBlock(block, "VOLUME"), functionDepth), 0, 30));
      case "mp3_play":
        return sendAction("MP3PLAY", clamp(await evaluate(inputBlock(block, "TRACK"), functionDepth), 1, 2999));
      case "mp3_volume":
        return sendAction("MP3VOL", clamp(await evaluate(inputBlock(block, "VOLUME"), functionDepth), 0, 30));
      case "mp3_stop":
        return sendAction("MP3STOP");
      case "bt_begin":
        return sendAction("BTBEGIN", block.getFieldValue("RX"), block.getFieldValue("TX"), block.getFieldValue("BAUD"));
      case "bt_send":
        return sendAction("BTSEND", encodeHex(await evaluate(inputBlock(block, "VALUE"), functionDepth)));
      case "serial_print":
        return sendAction("PRINT", encodeHex(await evaluate(inputBlock(block, "VALUE"), functionDepth)));
      case "my_function_call": {
        if (functionDepth > 12) throw new Error("내 블록 호출이 너무 깊습니다.");
        const definition = workspace.getAllBlocks(false).find(candidate =>
          candidate.type === "my_function_def" &&
          candidate.getFieldValue("NAME") === block.getFieldValue("NAME")
        );
        if (definition) await executeChain(definition.getInputTargetBlock("DO"), functionDepth + 1);
        return;
      }
      default:
        return;
    }
  }

  async function runWorkspace() {
    if (running) return toast("이미 블록을 실행하고 있습니다.");
    try {
      await ensureRuntime();
      const startHats = workspace.getTopBlocks(true).filter(block => block.type === "arduino_start");
      const loopHats = workspace.getTopBlocks(true).filter(block => block.type === "arduino_loop");
      if (!startHats.length && !loopHats.length) throw new Error("‘시작하면’ 또는 ‘계속 실행’ 블록을 추가하세요.");
      running = true;
      runCancelled = false;
      executionSliceStarted = performance.now();
      executionSliceSteps = 0;
      liveVariables.clear();
      await sendAction("STOP");
      setRunningUi(true);
      toast("블록 실행을 시작했습니다. 정지하려면 상단의 ‘정지’를 누르세요.");
      for (const hat of startHats) await executeChain(hat.getNextBlock());
      if (loopHats.length) {
        while (!runCancelled) {
          for (const hat of loopHats) await executeChain(hat.getNextBlock());
          await sleep(LIVE_LOOP_DELAY_MS);
        }
      }
      if (!runCancelled) toast("블록 실행을 완료했습니다.");
    } catch (error) {
      if (!runCancelled) {
        toast(error.message);
        if (/런타임/.test(error.message) && !$("#firmwareDialog").open) $("#firmwareDialog").showModal();
      }
    } finally {
      running = false;
      setRunningUi(false);
    }
  }

  async function stopWorkspace() {
    runCancelled = true;
    setRunningUi(false);
    try {
      if (runtimeReady) await sendAction("STOP");
      toast("블록과 출력 동작을 정지했습니다.");
    } catch (_) {}
  }

  function setRunningUi(active) {
    const button = $("#runBtn");
    button.textContent = active ? "● 실행 중" : "③ USB로 실행";
    button.classList.toggle("running", active);
    button.setAttribute("aria-pressed", String(active));
  }

  function projectData() {
    return {
      format: "onemaker-arduino-studio",
      version: 1,
      name: $("#projectName").value.trim() || "나의 아두이노 프로젝트",
      board: $("#boardType").value,
      workspace: Blockly.serialization.workspaces.save(workspace)
    };
  }

  function scheduleAutosave() {
    clearTimeout(scheduleAutosave.timer);
    scheduleAutosave.timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projectData())); } catch (_) {}
    }, 350);
  }

  function restoreAutosave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      loadProjectData(JSON.parse(raw));
    } catch (_) {}
  }

  function loadProjectData(data) {
    if (!data?.workspace) throw new Error("OneMaker Arduino 프로젝트 파일이 아닙니다.");
    workspace.clear();
    Blockly.serialization.workspaces.load(data.workspace, workspace);
    $("#projectName").value = data.name || "나의 아두이노 프로젝트";
    if (["uno", "nano", "nanoOldBootloader"].includes(data.board)) $("#boardType").value = data.board;
    updateBoardTitle();
    refreshCode();
  }

  function saveProject() {
    const data = projectData();
    downloadBlob(`${safeFilename(data.name)}.omarduino`, JSON.stringify(data, null, 2), "application/json");
    toast("프로젝트 파일을 저장했습니다.");
  }

  async function openProject(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      loadProjectData(JSON.parse(await file.text()));
      scheduleAutosave();
      toast("프로젝트를 열었습니다.");
    } catch (error) {
      toast(`파일 열기 실패: ${error.message}`);
    }
  }

  function safeFilename(value) {
    return String(value || "arduino-project").replace(/[\\/:*?"<>|]+/g, "-").trim() || "arduino-project";
  }

  function downloadBlob(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function copySelectedBlock() {
    const block = selectedBlockId && workspace.getBlockById(selectedBlockId);
    if (!block) return toast("복사할 블록을 먼저 선택하세요.");
    copiedBlockState = Blockly.serialization.blocks.save(block, { addCoordinates: false, addInputBlocks: true, addNextBlocks: true });
    toast("선택한 블록을 복사했습니다.");
  }

  function pasteBlock() {
    if (!copiedBlockState) return toast("먼저 블록을 복사하세요.");
    try {
      const state = JSON.parse(JSON.stringify(copiedBlockState));
      delete state.id;
      const block = Blockly.serialization.blocks.append(state, workspace);
      if (block) block.moveBy(28, 28);
      toast("블록을 붙여넣었습니다.");
    } catch (error) {
      toast(`붙여넣기 실패: ${error.message}`);
    }
  }

  function deleteSelectedBlock() {
    const block = selectedBlockId && workspace.getBlockById(selectedBlockId);
    if (!block) return toast("삭제할 블록을 먼저 선택하세요.");
    block.dispose(true);
  }

  function clearWorkspace() {
    if (!confirm("모든 블록을 지울까요?")) return;
    workspace.clear();
    refreshCode();
    scheduleAutosave();
  }

  function loadExample(showMessage) {
    workspace.clear();
    const state = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: "arduino_start", x: 40, y: 35,
            next: { block: {
              type: "lcd_begin",
              fields: { ADDRESS: "39", SIZE: "16x2" },
              next: { block: {
                type: "led_digital",
                fields: { PIN: "13", STATE: "0" }
              } }
            } }
          },
          {
            type: "arduino_loop", x: 390, y: 35,
            next: { block: {
              type: "lcd_print",
              inputs: {
                ROW: numberShadow(0),
                COL: numberShadow(0),
                VALUE: { block: { type: "sensor_analog", fields: { SENSOR: "light", PIN: "0" } } }
              },
              next: { block: {
                type: "serial_print",
                inputs: { VALUE: { block: { type: "sensor_analog", fields: { SENSOR: "light", PIN: "0" } } } },
                next: { block: {
                  type: "control_wait",
                  inputs: { SECONDS: numberShadow(0.5) }
                } }
              } }
            } }
          }
        ]
      }
    };
    Blockly.serialization.workspaces.load(state, workspace);
    workspace.scrollCenter();
    refreshCode();
    scheduleAutosave();
    if (showMessage) toast("조도센서와 LCD 예제를 불러왔습니다.");
  }

  function copyCode() {
    navigator.clipboard?.writeText($("#codeView").value)
      .then(() => toast("Arduino 코드를 복사했습니다."))
      .catch(() => toast("코드를 직접 선택해 복사해주세요."));
  }

  function downloadIno() {
    const name = safeFilename($("#projectName").value).replace(/\s+/g, "_");
    downloadBlob(`${name}.ino`, $("#codeView").value, "text/x-c++src");
    toast("Arduino INO 파일을 저장했습니다.");
  }

  function refreshCode() {
    if (!workspace) return;
    try {
      $("#codeView").value = generateArduinoCode();
    } catch (error) {
      $("#codeView").value = `// 코드 생성 오류: ${error.message}`;
    }
  }

  function cppIdentifier(value, prefix = "value") {
    const cleaned = String(value || "").normalize("NFKD")
      .replace(/[^\w\u3131-\uD79D]+/g, "_")
      .replace(/^(\d)/, "_$1");
    const ascii = cleaned.replace(/[^\x00-\x7F]/g, character => `u${character.charCodeAt(0).toString(16)}`);
    return `${prefix}_${ascii || "item"}`;
  }

  function cppVariable(block) {
    const variable = block.getField("VAR")?.getVariable();
    return cppIdentifier(variable?.name || block.getFieldValue("VAR"), "var");
  }

  function cppString(value) {
    return JSON.stringify(String(value ?? ""))
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  function cppInput(block, name, fallback = "0") {
    return cppExpression(block?.getInputTargetBlock(name)) || fallback;
  }

  function dhtName(pin, type) {
    return `dht_${pin}_${type}`;
  }

  function functionCppName(name, returnsValue = false) {
    return cppIdentifier(name, returnsValue ? "valueBlock" : "myBlock");
  }

  function cppExpression(block) {
    if (!block) return "0";
    switch (block.type) {
      case "math_number": return String(Number(block.getFieldValue("NUM")) || 0);
      case "text": return cppString(block.getFieldValue("TEXT"));
      case "logic_boolean": return block.getFieldValue("BOOL") === "TRUE" ? "true" : "false";
      case "variables_get": return cppVariable(block);
      case "math_arithmetic": {
        const left = cppInput(block, "A");
        const right = cppInput(block, "B");
        const operators = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/" };
        const operation = block.getFieldValue("OP");
        return operation === "POWER" ? `pow(${left}, ${right})` : `(${left} ${operators[operation] || "+"} ${right})`;
      }
      case "logic_compare": {
        const operators = { EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" };
        return `(${cppInput(block, "A")} ${operators[block.getFieldValue("OP")] || "=="} ${cppInput(block, "B")})`;
      }
      case "logic_operation":
        return `(${cppInput(block, "A", "false")} ${block.getFieldValue("OP") === "AND" ? "&&" : "||"} ${cppInput(block, "B", "false")})`;
      case "logic_negate": return `(!${cppInput(block, "BOOL", "false")})`;
      case "text_join": {
        const parts = [];
        for (let index = 0; block.getInput(`ADD${index}`); index++) parts.push(`String(${cppInput(block, `ADD${index}`, '""')})`);
        return parts.length ? parts.join(" + ") : 'String("")';
      }
      case "sensor_analog": return `analogRead(A${block.getFieldValue("PIN")})`;
      case "pin_digital_read": return `readDigitalPin(${block.getFieldValue("PIN")})`;
      case "pin_analog_read": return `analogRead(A${block.getFieldValue("PIN")})`;
      case "sensor_button": return `readButton(${block.getFieldValue("PIN")})`;
      case "sensor_ultrasonic": return `readUltrasonic(${block.getFieldValue("TRIG")}, ${block.getFieldValue("ECHO")})`;
      case "sensor_dht": {
        const object = dhtName(block.getFieldValue("PIN"), block.getFieldValue("TYPE"));
        return `${object}.${block.getFieldValue("FIELD") === "humidity" ? "readHumidity" : "readTemperature"}()`;
      }
      case "sensor_dust": return `readDust(${block.getFieldValue("LED_PIN")}, A${block.getFieldValue("ANALOG_PIN")})`;
      case "bt_available": return "(bluetooth.listen(), bluetooth.available() > 0)";
      case "bt_read": return "readBluetoothLine()";
      case "my_function_call_value":
        return `${functionCppName(block.getFieldValue("NAME"), true)}()`;
      default: return "0";
    }
  }

  function cppChain(firstBlock, indent = "  ") {
    let code = "";
    let block = firstBlock;
    while (block) {
      code += cppStatement(block, indent);
      block = block.getNextBlock();
    }
    return code;
  }

  function cppStatement(block, indent = "  ") {
    const line = value => `${indent}${value}\n`;
    switch (block.type) {
      case "control_wait": return line(`delay((unsigned long)(${cppInput(block, "SECONDS")}) * 1000UL);`);
      case "control_forever":
        return line("while (true) {") + cppChain(block.getInputTargetBlock("DO"), `${indent}  `) + line("}");
      case "controls_repeat_ext": {
        const index = `repeat_${block.id.replace(/\W/g, "").slice(0, 6)}`;
        return line(`for (long ${index} = 0; ${index} < (${cppInput(block, "TIMES")}); ${index}++) {`)
          + cppChain(block.getInputTargetBlock("DO"), `${indent}  `) + line("}");
      }
      case "controls_if": {
        let code = "";
        for (let index = 0; block.getInput(`IF${index}`); index++) {
          code += line(`${index ? "} else if" : "if"} (${cppInput(block, `IF${index}`, "false")}) {`);
          code += cppChain(block.getInputTargetBlock(`DO${index}`), `${indent}  `);
        }
        if (block.getInput("ELSE")) {
          code += line("} else {");
          code += cppChain(block.getInputTargetBlock("ELSE"), `${indent}  `);
        }
        return code + line("}");
      }
      case "variables_set": return line(`${cppVariable(block)} = ${cppInput(block, "VALUE")};`);
      case "math_change": return line(`${cppVariable(block)} += ${cppInput(block, "DELTA")};`);
      case "pin_digital_write":
        return line(`pinMode(${block.getFieldValue("PIN")}, OUTPUT);`)
          + line(`digitalWrite(${block.getFieldValue("PIN")}, ${block.getFieldValue("STATE") === "1" ? "HIGH" : "LOW"});`);
      case "pin_pwm_write":
        return line(`pinMode(${block.getFieldValue("PIN")}, OUTPUT);`)
          + line(`analogWrite(${block.getFieldValue("PIN")}, constrain(${cppInput(block, "VALUE")}, 0, 255));`);
      case "led_digital":
        return line(`pinMode(${block.getFieldValue("PIN")}, OUTPUT);`)
          + line(`digitalWrite(${block.getFieldValue("PIN")}, ${block.getFieldValue("STATE") === "1" ? "HIGH" : "LOW"});`);
      case "led_pwm":
        return line(`pinMode(${block.getFieldValue("PIN")}, OUTPUT);`)
          + line(`analogWrite(${block.getFieldValue("PIN")}, constrain(${cppInput(block, "VALUE")}, 0, 255));`);
      case "motor_set":
        return line(`setMotor(${block.getFieldValue("IN1")}, ${block.getFieldValue("IN2")}, ${cppInput(block, "SPEED")});`);
      case "motor_stop":
        return line(`setMotor(${block.getFieldValue("IN1")}, ${block.getFieldValue("IN2")}, 0);`);
      case "servo_write":
        return line(`${cppIdentifier(block.getFieldValue("PIN"), "servo")}.write(constrain(${cppInput(block, "ANGLE")}, 0, 180));`);
      case "buzzer_tone":
        return line(`tone(${block.getFieldValue("PIN")}, ${cppInput(block, "FREQ")}, (unsigned long)(${cppInput(block, "SECONDS")}) * 1000UL);`);
      case "buzzer_stop": return line(`noTone(${block.getFieldValue("PIN")});`);
      case "lcd_begin": return line("lcd.init();") + line("lcd.backlight();");
      case "lcd_print":
        return line(`lcd.setCursor(${cppInput(block, "COL")}, ${cppInput(block, "ROW")});`)
          + line(`lcd.print(${cppInput(block, "VALUE", '""')});`);
      case "lcd_clear": return line("lcd.clear();");
      case "neo_begin": return line("pixels.begin();") + line("pixels.clear();") + line("pixels.show();");
      case "neo_set":
        return line(`pixels.setPixelColor(${cppInput(block, "INDEX")}, pixels.Color(${cppInput(block, "R")}, ${cppInput(block, "G")}, ${cppInput(block, "B")}));`)
          + line("pixels.show();");
      case "neo_clear": return line("pixels.clear();") + line("pixels.show();");
      case "mp3_begin":
        return line("mp3Serial.begin(9600);")
          + line(`sendMp3Command(0x06, constrain(${cppInput(block, "VOLUME")}, 0, 30));`);
      case "mp3_play": return line(`sendMp3Command(0x03, ${cppInput(block, "TRACK")});`);
      case "mp3_volume": return line(`sendMp3Command(0x06, constrain(${cppInput(block, "VOLUME")}, 0, 30));`);
      case "mp3_stop": return line("sendMp3Command(0x16, 0);");
      case "bt_begin": return line(`bluetooth.begin(${block.getFieldValue("BAUD")});`);
      case "bt_send": return line(`bluetooth.println(${cppInput(block, "VALUE", '""')});`);
      case "serial_print": return line(`Serial.println(${cppInput(block, "VALUE", '""')});`);
      case "my_function_call": return line(`${functionCppName(block.getFieldValue("NAME"))}();`);
      default: return "";
    }
  }

  function firstBlockOfType(type) {
    return workspace.getAllBlocks(false).find(block => block.type === type) || null;
  }

  function numericInputValue(block, inputName, fallback) {
    const input = block?.getInputTargetBlock(inputName);
    return input?.type === "math_number" ? Number(input.getFieldValue("NUM")) || fallback : fallback;
  }

  function collectHardware() {
    const all = workspace.getAllBlocks(false);
    const types = new Set(all.map(block => block.type));
    const dht = new Map();
    const servoPins = new Set();
    all.filter(block => block.type === "sensor_dht").forEach(block => {
      const pin = block.getFieldValue("PIN");
      const type = block.getFieldValue("TYPE");
      dht.set(`${pin}:${type}`, { pin, type });
    });
    all.filter(block => block.type === "servo_write").forEach(block => servoPins.add(block.getFieldValue("PIN")));
    const lcdBlock = firstBlockOfType("lcd_begin");
    const [lcdColumns, lcdRows] = (lcdBlock?.getFieldValue("SIZE") || "16x2").split("x").map(Number);
    const neoBlock = firstBlockOfType("neo_begin");
    const btBlock = firstBlockOfType("bt_begin");
    const mp3Block = firstBlockOfType("mp3_begin");
    return {
      all,
      types,
      dht: [...dht.values()],
      servoPins: [...servoPins],
      lcd: {
        enabled: [...types].some(type => type.startsWith("lcd_")),
        address: Number(lcdBlock?.getFieldValue("ADDRESS") || 39),
        columns: lcdColumns || 16,
        rows: lcdRows || 2
      },
      neo: {
        enabled: [...types].some(type => type.startsWith("neo_")),
        pin: Number(neoBlock?.getFieldValue("PIN") || 6),
        count: numericInputValue(neoBlock, "COUNT", 8)
      },
      bluetooth: {
        enabled: [...types].some(type => type.startsWith("bt_")),
        rx: Number(btBlock?.getFieldValue("RX") || 10),
        tx: Number(btBlock?.getFieldValue("TX") || 11)
      },
      mp3: {
        enabled: [...types].some(type => type.startsWith("mp3_")),
        rx: Number(mp3Block?.getFieldValue("RX") || 8),
        tx: Number(mp3Block?.getFieldValue("TX") || 9)
      }
    };
  }

  function generateArduinoCode() {
    const hardware = collectHardware();
    const includes = [];
    if (hardware.dht.length) includes.push("#include <DHT.h>");
    if (hardware.servoPins.length) includes.push("#include <Servo.h>");
    if (hardware.lcd.enabled) includes.push("#include <Wire.h>", "#include <LiquidCrystal_I2C.h>");
    if (hardware.neo.enabled) includes.push("#include <Adafruit_NeoPixel.h>");
    if (hardware.bluetooth.enabled || hardware.mp3.enabled) includes.push("#include <SoftwareSerial.h>");

    const globals = [];
    hardware.dht.forEach(({ pin, type }) => globals.push(`DHT ${dhtName(pin, type)}(${pin}, DHT${type});`));
    hardware.servoPins.forEach(pin => globals.push(`Servo ${cppIdentifier(pin, "servo")};`));
    if (hardware.lcd.enabled) globals.push(`LiquidCrystal_I2C lcd(0x${hardware.lcd.address.toString(16).toUpperCase()}, ${hardware.lcd.columns}, ${hardware.lcd.rows});`);
    if (hardware.neo.enabled) globals.push(`Adafruit_NeoPixel pixels(${hardware.neo.count}, ${hardware.neo.pin}, NEO_GRB + NEO_KHZ800);`);
    if (hardware.bluetooth.enabled) globals.push(`SoftwareSerial bluetooth(${hardware.bluetooth.rx}, ${hardware.bluetooth.tx}); // Arduino RX, TX`);
    if (hardware.mp3.enabled) globals.push(`SoftwareSerial mp3Serial(${hardware.mp3.rx}, ${hardware.mp3.tx}); // Arduino RX, TX`);
    workspace.getVariableMap().getAllVariables().forEach(variable => {
      globals.push(`double ${cppIdentifier(variable.name, "var")} = 0;`);
    });

    const helpers = [];
    if (hardware.types.has("pin_digital_read")) helpers.push(`
int readDigitalPin(uint8_t pin) {
  pinMode(pin, INPUT);
  return digitalRead(pin);
}`);
    if (hardware.types.has("sensor_ultrasonic")) helpers.push(`
long readUltrasonic(uint8_t trigPin, uint8_t echoPin) {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  unsigned long duration = pulseIn(echoPin, HIGH, 30000UL);
  return duration ? duration / 58 : 0;
}`);
    if (hardware.types.has("sensor_button")) helpers.push(`
bool readButton(uint8_t pin) {
  pinMode(pin, INPUT_PULLUP);
  return digitalRead(pin) == LOW;
}`);
    if (hardware.types.has("sensor_dust")) helpers.push(`
int readDust(uint8_t ledPin, uint8_t analogPin) {
  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);
  delayMicroseconds(280);
  int value = analogRead(analogPin);
  delayMicroseconds(40);
  digitalWrite(ledPin, HIGH);
  delayMicroseconds(9680);
  return value;
}`);
    if (hardware.types.has("motor_set") || hardware.types.has("motor_stop")) helpers.push(`
void setMotor(uint8_t pin1, uint8_t pin2, int speedValue) {
  speedValue = constrain(speedValue, -255, 255);
  pinMode(pin1, OUTPUT);
  pinMode(pin2, OUTPUT);
  if (speedValue > 0) {
    analogWrite(pin1, speedValue);
    analogWrite(pin2, 0);
  } else if (speedValue < 0) {
    analogWrite(pin1, 0);
    analogWrite(pin2, -speedValue);
  } else {
    analogWrite(pin1, 0);
    analogWrite(pin2, 0);
  }
}`);
    if (hardware.bluetooth.enabled && hardware.types.has("bt_read")) helpers.push(`
String readBluetoothLine() {
  bluetooth.listen();
  return bluetooth.readStringUntil('\\n');
}`);
    if (hardware.mp3.enabled) helpers.push(`
void sendMp3Command(uint8_t command, uint16_t parameter) {
  uint8_t packet[10] = {0x7E, 0xFF, 0x06, command, 0x00,
    (uint8_t)(parameter >> 8), (uint8_t)parameter, 0, 0, 0xEF};
  uint16_t checksum = 0 - (0xFF + 0x06 + command + packet[4] + packet[5] + packet[6]);
  packet[7] = checksum >> 8;
  packet[8] = checksum;
  mp3Serial.listen();
  mp3Serial.write(packet, sizeof(packet));
  delay(120);
}`);

    const customFunctions = [];
    workspace.getTopBlocks(true).filter(block => block.type === "my_function_def").forEach(block => {
      customFunctions.push(`void ${functionCppName(block.getFieldValue("NAME"))}() {\n${cppChain(block.getInputTargetBlock("DO"), "  ")}}\n`);
    });
    workspace.getTopBlocks(true).filter(block => block.type === "my_function_def_value").forEach(block => {
      customFunctions.push(`double ${functionCppName(block.getFieldValue("NAME"), true)}() {\n${cppChain(block.getInputTargetBlock("DO"), "  ")}  return ${cppInput(block, "RETURN")};\n}\n`);
    });

    const setupLines = ["  Serial.begin(115200);"];
    hardware.dht.forEach(({ pin, type }) => setupLines.push(`  ${dhtName(pin, type)}.begin();`));
    hardware.servoPins.forEach(pin => setupLines.push(`  ${cppIdentifier(pin, "servo")}.attach(${pin});`));
    const startBlocks = workspace.getTopBlocks(true).filter(block => block.type === "arduino_start");
    startBlocks.forEach(block => setupLines.push(cppChain(block.getNextBlock(), "  ").trimEnd()));

    const loopBlocks = workspace.getTopBlocks(true).filter(block => block.type === "arduino_loop");
    const loopBody = loopBlocks.map(block => cppChain(block.getNextBlock(), "  ")).join("");

    return `// OneMaker Arduino UNO·Nano Studio
// 보드: ${$("#boardTitle").textContent}
// 생성일: ${new Date().toLocaleDateString("ko-KR")}

${[...new Set(includes)].join("\n")}

${globals.join("\n")}
${helpers.join("\n")}

${customFunctions.join("\n")}
void setup() {
${setupLines.filter(Boolean).join("\n")}
}

void loop() {
${loopBody || "  // ‘계속 실행’ 블록을 추가하세요.\n"}}
`;
  }

  init();
})();
