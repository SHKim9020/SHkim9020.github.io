(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const DIGITAL_PINS = Array.from({ length: 12 }, (_, index) => index + 2);
  const PWM_PINS = [3, 5, 6, 9, 10, 11];
  const ANALOG_PINS = ["A0", "A1", "A2", "A3", "A4", "A5"];
  const STORAGE_KEY = "onemaker-arduino-studio-autosave-v1";
  const SIDE_PANEL_KEY = "onemaker-arduino-studio-side-collapsed";
  const RUNTIME_VERSION = "1.1.4";
  const EEPROM_PROGRAM_LIMIT = 1015;
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
  let runtimeVersion = "";
  let serialBuffer = "";
  let selectedBlockId = null;
  let copiedBlockState = null;
  let toastTimer;
  let deferredInstallPrompt = null;
  let requestSequence = 1;
  let runCancelled = false;
  let running = false;
  let executionSliceStarted = 0;
  let executionSliceSteps = 0;
  let serialFlushTimer = null;
  const valueWaiters = new Map();
  const lineWaiters = [];
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
      message0: "터치센서 %1 감지?",
      args0: [{ type: "field_dropdown", name: "PIN", options: digitalOptions }],
      output: "Boolean",
      colour: 155,
      tooltip: "터치센서의 디지털 출력이 HIGH(1)이면 참이 됩니다."
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
      type: "oled_begin",
      message0: "0.96 OLED 시작 주소 %1",
      args0: [
        { type: "field_dropdown", name: "ADDRESS", options: [["0x3C", "60"], ["0x3D", "61"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 195,
      tooltip: "SSD1306 128×64 I²C OLED를 시작합니다. UNO·Nano는 SDA A4, SCL A5에 연결합니다."
    },
    {
      type: "oled_print",
      message0: "OLED 행 %1 열 %2에 %3 출력",
      args0: [
        { type: "input_value", name: "ROW", check: "Number" },
        { type: "input_value", name: "COL", check: "Number" },
        { type: "input_value", name: "VALUE" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 195,
      tooltip: "행 0~7, 열 0~15에 영문·숫자를 표시합니다."
    },
    {
      type: "oled_clear",
      message0: "OLED 화면 지우기",
      previousStatement: null,
      nextStatement: null,
      colour: 195
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
      message0: "DFPlayer 시작 모듈 TX → RX %1 모듈 RX ← TX %2 볼륨 %3",
      args0: [
        { type: "field_dropdown", name: "RX", options: digitalOptions },
        { type: "field_dropdown", name: "TX", options: digitalOptions },
        { type: "input_value", name: "VOLUME", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 330,
      tooltip: "DFPlayer TX를 선택한 Arduino RX 핀에, DFPlayer RX를 선택한 Arduino TX 핀에 연결합니다."
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
      type: "mp3_play_for",
      message0: "DFPlayer %1번 파일 %2초 동안 재생",
      args0: [
        { type: "input_value", name: "TRACK", check: "Number" },
        { type: "input_value", name: "SECONDS", check: "Number" }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
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
      message0: "Bluetooth 시작 Arduino RX %1 TX %2 속도 %3",
      args0: [
        { type: "field_dropdown", name: "RX", options: digitalOptions },
        { type: "field_dropdown", name: "TX", options: digitalOptions },
        { type: "field_dropdown", name: "BAUD", options: [["9600", "9600"], ["38400", "38400"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 14,
      tooltip: "Bluetooth TX를 Arduino RX에, Bluetooth RX를 Arduino TX에 연결합니다."
    },
    {
      type: "bt_send",
      message0: "Bluetooth로 %1 보내기",
      args0: [{ type: "input_value", name: "VALUE" }],
      previousStatement: null,
      nextStatement: null,
      colour: 14
    },
    {
      type: "bt_available",
      message0: "Bluetooth 수신이 들어왔는가?",
      output: "Boolean",
      colour: 14
    },
    {
      type: "bt_read",
      message0: "Bluetooth 수신값 읽기",
      output: "String",
      colour: 14
    },
    {
      type: "bt_received_item",
      message0: "Bluetooth 수신된 %1개의 값 중 %2번째 값",
      args0: [
        { type: "input_value", name: "COUNT", check: "Number" },
        { type: "input_value", name: "INDEX", check: "Number" }
      ],
      output: "String",
      inputsInline: true,
      colour: 14
    },
    {
      type: "bt_value_equals",
      message0: "Bluetooth 수신값 = %1",
      args0: [{ type: "input_value", name: "VALUE" }],
      output: "Boolean",
      inputsInline: true,
      colour: 14
    },
    {
      type: "bt_send_many",
      message0: "Bluetooth로 %1 전송하기 (이어 보내기)",
      args0: [{ type: "input_value", name: "VALUE" }],
      previousStatement: null,
      nextStatement: null,
      colour: 14,
      tooltip: "줄바꿈 없이 전송하므로 여러 블록을 이어서 보낼 수 있습니다."
    },
    {
      type: "bt_set_name",
      message0: "Bluetooth 이름 변경 %1 방식 %2",
      args0: [
        { type: "input_value", name: "NAME" },
        { type: "field_dropdown", name: "MODE", options: [["HC-06 기본", "0"], ["HC-05 AT모드", "1"]] }
      ],
      previousStatement: null,
      nextStatement: null,
      inputsInline: true,
      colour: 14,
      tooltip: "연결되지 않은 명령 모드에서 사용합니다. HC-05 AT모드는 KEY/EN 설정과 38400bps가 필요합니다."
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
      { kind: "category", name: "0.96 OLED", colour: "195", contents: [
        { kind: "block", type: "oled_begin" },
        { kind: "block", type: "oled_print", inputs: { ROW: numberShadow(0), COL: numberShadow(0), VALUE: textShadow("HELLO") } },
        { kind: "block", type: "oled_clear" }
      ] },
      { kind: "category", name: "네오픽셀", colour: "290", contents: [
        { kind: "block", type: "neo_begin", inputs: { COUNT: numberShadow(8) } },
        { kind: "block", type: "neo_set", inputs: { INDEX: numberShadow(0), R: numberShadow(255), G: numberShadow(0), B: numberShadow(0) } },
        { kind: "block", type: "neo_clear" }
      ] },
      { kind: "category", name: "MP3", colour: "330", contents: [
        { kind: "block", type: "mp3_begin", fields: { RX: "10", TX: "11" }, inputs: { VOLUME: numberShadow(20) } },
        { kind: "block", type: "mp3_play", inputs: { TRACK: numberShadow(1) } },
        { kind: "block", type: "mp3_play_for", inputs: { TRACK: numberShadow(1), SECONDS: numberShadow(5) } },
        { kind: "block", type: "mp3_volume", inputs: { VOLUME: numberShadow(20) } },
        { kind: "block", type: "mp3_stop" }
      ] },
      { kind: "category", name: "Bluetooth", colour: "14", contents: [
        { kind: "block", type: "bt_begin", fields: { RX: "2", TX: "3", BAUD: "9600" } },
        { kind: "block", type: "bt_available" },
        { kind: "block", type: "bt_read" },
        { kind: "block", type: "bt_received_item", inputs: { COUNT: numberShadow(1), INDEX: numberShadow(1) } },
        { kind: "block", type: "bt_value_equals", inputs: { VALUE: textShadow("1") } },
        { kind: "block", type: "bt_send", inputs: { VALUE: textShadow("전진") } },
        { kind: "block", type: "bt_send_many", inputs: { VALUE: textShadow("값") } },
        { kind: "block", type: "bt_set_name", inputs: { NAME: textShadow("OneMaker") } }
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
    restoreSidePanel();
    restoreAutosave();
    if (!workspace.getAllBlocks(false).length) loadExample(false);
    refreshCode();
    updateBrowserSupport();
    initPwaInstall();
  }

  function populateSelects() {
    const digitalHtml = digitalOptions.map(([label, value]) => `<option value="${value}">${label}</option>`).join("");
    const analogHtml = analogOptions.map(([label, value]) => `<option value="${value}">${label}</option>`).join("");
    ["testPin", "testDigitalPin", "motorPin1", "motorPin2", "mp3RxPin", "mp3TxPin"].forEach(id => { $(`#${id}`).innerHTML = digitalHtml; });
    $("#testAnalogPin").innerHTML = analogHtml;
    $("#testPin").value = "13";
    $("#testDigitalPin").value = "2";
    $("#motorPin1").value = "5";
    $("#motorPin2").value = "6";
    $("#mp3RxPin").value = "10";
    $("#mp3TxPin").value = "11";
  }

  function bindEvents() {
    workspace.addChangeListener(event => {
      if (event.type === Blockly.Events.SELECTED) selectedBlockId = event.newElementId || null;
      if (event.isUiEvent) return;
      refreshCode();
      scheduleAutosave();
    });
    $$(".side-tabs [data-tab]").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    $("#sideCollapseBtn").addEventListener("click", toggleSidePanel);
    $("#boardType").addEventListener("change", updateBoardTitle);
    $("#exampleBtn").addEventListener("click", () => loadExample(true));
    $("#saveBtn").addEventListener("click", saveProject);
    $("#openBtn").addEventListener("click", () => $("#openFile").click());
    $("#openFile").addEventListener("change", openProject);
    $("#firmwareBtn").addEventListener("click", openFirmwareDialog);
    $("#pwaInstallBtn").addEventListener("click", installPwa);
    $("#closePwaInstallDialogBtn").addEventListener("click", () => $("#pwaInstallDialog").close());
    $("#confirmPwaInstallDialogBtn").addEventListener("click", () => $("#pwaInstallDialog").close());
    $("#connectBtn").addEventListener("click", toggleSerialConnection);
    $("#saveBoardBtn").addEventListener("click", saveProgramToBoard);
    $("#closeSaveBoardDialogBtn").addEventListener("click", () => $("#saveBoardDialog").close());
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
    $("#mp3PlayBtn").addEventListener("click", testMp3Playback);
    $("#mp3StopBtn").addEventListener("click", () => sendAction("MP3STOP"));
    window.addEventListener("beforeunload", () => {
      runCancelled = true;
      if (serialReader) serialReader.cancel().catch(() => {});
    });
    if ("serial" in navigator) {
      navigator.serial.addEventListener("disconnect", () => closeSerialState());
    }
  }

  function isStandaloneApp() {
    return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || window.navigator.standalone === true;
  }

  function initPwaInstall() {
    const installButton = $("#pwaInstallBtn");
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid && !isStandaloneApp()) installButton.hidden = false;

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (!isStandaloneApp()) installButton.hidden = false;
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      installButton.hidden = true;
      toast("OneMaker Arduino Studio가 홈 화면에 설치되었습니다.");
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(error => console.warn("PWA service worker:", error));
      });
    }
  }

  async function installPwa() {
    if (isStandaloneApp()) return toast("이미 앱으로 실행 중입니다.");
    if (!deferredInstallPrompt) {
      $("#pwaInstallDialog").showModal();
      return;
    }
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (choice.outcome !== "accepted") $("#pwaInstallDialog").showModal();
  }

  function activateTab(name) {
    $$(".side-tabs [data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === name));
    $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === name));
  }

  function restoreSidePanel() {
    setSidePanelCollapsed(localStorage.getItem(SIDE_PANEL_KEY) === "1", false);
  }

  function toggleSidePanel() {
    setSidePanelCollapsed(!$(".app-shell").classList.contains("side-collapsed"));
  }

  function setSidePanelCollapsed(collapsed, persist = true) {
    const shell = $(".app-shell");
    const button = $("#sideCollapseBtn");
    shell.classList.toggle("side-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", collapsed ? "오른쪽 패널 펼치기" : "오른쪽 패널 접기");
    button.title = collapsed ? "오른쪽 패널 펼치기" : "오른쪽 패널 접기";
    button.querySelector(".collapse-label").textContent = collapsed ? "펼치기" : "접기";
    if (persist) localStorage.setItem(SIDE_PANEL_KEY, collapsed ? "1" : "0");
    requestAnimationFrame(() => {
      Blockly.svgResize(workspace);
      setTimeout(() => Blockly.svgResize(workspace), 240);
    });
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
    const androidCh340 = window.OneMakerCH340?.active;
    $("#connectBtn").disabled = !supported;
    $("#saveBoardBtn").disabled = !supported;
    if (androidCh340) {
      $("#connectBtn").lastChild.textContent = "② CH340 USB 연결";
      $("#connectionStatus").textContent = `Android CH340 준비${window.OneMakerCH340.mode === "patched" ? " · 호환 모드" : ""}`;
    } else if (window.OneMakerCH340?.isAndroid && window.OneMakerCH340?.supported) {
      $("#connectBtn").lastChild.textContent = "② CH340 USB 점검";
      $("#connectionStatus").textContent = "CH340 활성화 실패";
    } else if (!supported) {
      $("#connectionStatus").textContent = "Chrome·Edge 필요";
    }
  }

  function openFirmwareDialog() {
    if (!("serial" in navigator)) return toast("Chrome에서 USB 기능을 사용할 수 없습니다.");
    if (serialConnected) return toast("먼저 USB 연결을 끊은 뒤 런타임을 설치하세요.");
    $("#firmwareDialog").showModal();
  }

  const VM = Object.freeze({
    END: 0, WAIT: 1, SET_VAR: 2, CHANGE_VAR: 3, DIGITAL_WRITE: 4, PWM_WRITE: 5,
    MOTOR: 6, SERVO: 7, TONE: 8, NO_TONE: 9, LCD_BEGIN: 10, LCD_PRINT: 11,
    LCD_CLEAR: 12, NEO_BEGIN: 13, NEO_SET: 14, NEO_CLEAR: 15, MP3_BEGIN: 16,
    MP3_PLAY: 17, MP3_VOLUME: 18, MP3_STOP: 19, BT_BEGIN: 20, BT_SEND: 21,
    SERIAL_PRINT: 22, JUMP: 23, JUMP_IF_FALSE: 24, REPEAT_START: 25, REPEAT_END: 26,
    BT_SEND_RAW: 27, BT_SET_NAME: 28, OLED_BEGIN: 29, OLED_PRINT: 30, OLED_CLEAR: 31
  });

  const EX = Object.freeze({
    NUMBER: 1, TEXT: 2, VARIABLE: 3, ANALOG: 4, DIGITAL: 5, BUTTON: 6,
    ULTRASONIC: 7, DHT: 8, DUST: 9, BT_AVAILABLE: 10, BT_READ: 11,
    ADD: 20, SUBTRACT: 21, MULTIPLY: 22, DIVIDE: 23, POWER: 24,
    EQUAL: 30, NOT_EQUAL: 31, LESS: 32, LESS_EQUAL: 33, GREATER: 34,
    GREATER_EQUAL: 35, AND: 40, OR: 41, NOT: 42, CONCAT: 43, BT_ITEM: 44
  });

  class ByteWriter {
    constructor() {
      this.bytes = [];
    }

    get position() {
      return this.bytes.length;
    }

    u8(value) {
      this.bytes.push(Number(value) & 0xff);
    }

    u16(value) {
      this.u8(value);
      this.u8(Number(value) >> 8);
    }

    f32(value) {
      const buffer = new ArrayBuffer(4);
      new DataView(buffer).setFloat32(0, Number(value) || 0, true);
      this.bytes.push(...new Uint8Array(buffer));
    }

    append(values) {
      this.bytes.push(...values);
    }

    patchU16(position, value) {
      this.bytes[position] = value & 0xff;
      this.bytes[position + 1] = (value >> 8) & 0xff;
    }
  }

  function compileExpression(block, context) {
    const writer = new ByteWriter();
    writeExpressionValue(writer, block, context);
    if (writer.position > 255) throw new Error("수식이나 한 개의 출력 문장이 너무 깁니다.");
    return [writer.position, ...writer.bytes];
  }

  function writeTextValue(writer, value) {
    const bytes = [...new TextEncoder().encode(String(value ?? ""))];
    if (bytes.length > 120) throw new Error("한 개의 텍스트는 UTF-8 기준 120바이트까지 저장할 수 있습니다.");
    writer.u8(EX.TEXT);
    writer.u8(bytes.length);
    writer.append(bytes);
  }

  function writeExpressionValue(writer, block, context) {
    if (!block) {
      writer.u8(EX.NUMBER);
      writer.f32(0);
      return;
    }
    const binary = (leftName, rightName, opcode) => {
      writeExpressionValue(writer, inputBlock(block, leftName), context);
      writeExpressionValue(writer, inputBlock(block, rightName), context);
      writer.u8(opcode);
    };
    switch (block.type) {
      case "math_number":
        writer.u8(EX.NUMBER);
        writer.f32(block.getFieldValue("NUM"));
        return;
      case "text":
        writeTextValue(writer, block.getFieldValue("TEXT"));
        return;
      case "logic_boolean":
        writer.u8(EX.NUMBER);
        writer.f32(block.getFieldValue("BOOL") === "TRUE" ? 1 : 0);
        return;
      case "variables_get":
        writer.u8(EX.VARIABLE);
        writer.u8(variableIndex(block, context));
        return;
      case "math_arithmetic":
        binary("A", "B", {
          ADD: EX.ADD, MINUS: EX.SUBTRACT, MULTIPLY: EX.MULTIPLY,
          DIVIDE: EX.DIVIDE, POWER: EX.POWER
        }[block.getFieldValue("OP")] ?? EX.ADD);
        return;
      case "logic_compare":
        binary("A", "B", {
          EQ: EX.EQUAL, NEQ: EX.NOT_EQUAL, LT: EX.LESS, LTE: EX.LESS_EQUAL,
          GT: EX.GREATER, GTE: EX.GREATER_EQUAL
        }[block.getFieldValue("OP")] ?? EX.EQUAL);
        return;
      case "logic_operation":
        binary("A", "B", block.getFieldValue("OP") === "AND" ? EX.AND : EX.OR);
        return;
      case "logic_negate":
        writeExpressionValue(writer, inputBlock(block, "BOOL"), context);
        writer.u8(EX.NOT);
        return;
      case "text_join": {
        const inputs = [];
        for (let index = 0; block.getInput(`ADD${index}`); index++) inputs.push(inputBlock(block, `ADD${index}`));
        if (!inputs.length) return writeTextValue(writer, "");
        writeExpressionValue(writer, inputs[0], context);
        for (let index = 1; index < inputs.length; index++) {
          writeExpressionValue(writer, inputs[index], context);
          writer.u8(EX.CONCAT);
        }
        return;
      }
      case "sensor_analog":
      case "pin_analog_read":
        writer.u8(EX.ANALOG);
        writer.u8(block.getFieldValue("PIN"));
        return;
      case "pin_digital_read":
        writer.u8(EX.DIGITAL);
        writer.u8(block.getFieldValue("PIN"));
        return;
      case "sensor_button":
        writer.u8(EX.BUTTON);
        writer.u8(block.getFieldValue("PIN"));
        return;
      case "sensor_ultrasonic":
        writer.u8(EX.ULTRASONIC);
        writer.u8(block.getFieldValue("TRIG"));
        writer.u8(block.getFieldValue("ECHO"));
        return;
      case "sensor_dht":
        writer.u8(EX.DHT);
        writer.u8(block.getFieldValue("PIN"));
        writer.u8(block.getFieldValue("TYPE"));
        writer.u8(block.getFieldValue("FIELD") === "humidity" ? 1 : 0);
        return;
      case "sensor_dust":
        writer.u8(EX.DUST);
        writer.u8(block.getFieldValue("LED_PIN"));
        writer.u8(block.getFieldValue("ANALOG_PIN"));
        return;
      case "bt_available":
        writer.u8(EX.BT_AVAILABLE);
        return;
      case "bt_read":
        writer.u8(EX.BT_READ);
        return;
      case "bt_received_item":
        writeExpressionValue(writer, inputBlock(block, "COUNT"), context);
        writeExpressionValue(writer, inputBlock(block, "INDEX"), context);
        writer.u8(EX.BT_ITEM);
        return;
      case "bt_value_equals":
        writer.u8(EX.BT_READ);
        writeExpressionValue(writer, inputBlock(block, "VALUE"), context);
        writer.u8(EX.EQUAL);
        return;
      case "my_function_call_value": {
        const definition = context.valueFunctions.get(block.getFieldValue("NAME"));
        if (!definition) {
          writer.u8(EX.NUMBER);
          writer.f32(0);
          return;
        }
        if (definition.getInputTargetBlock("DO")) {
          throw new Error(`값 내 블록 ‘${block.getFieldValue("NAME")}’의 실행 부분은 저장 모드에서 사용할 수 없습니다.`);
        }
        if (context.functionDepth >= 12) throw new Error("내 블록 호출이 너무 깊습니다.");
        context.functionDepth++;
        writeExpressionValue(writer, definition.getInputTargetBlock("RETURN"), context);
        context.functionDepth--;
        return;
      }
      default:
        writer.u8(EX.NUMBER);
        writer.f32(0);
    }
  }

  function writeCompiledExpression(writer, block, context) {
    writer.append(compileExpression(block, context));
  }

  function variableIndex(block, context) {
    const key = variableKey(block);
    if (!context.variables.has(key)) {
      if (context.variables.size >= 8) throw new Error("보드 저장 모드에서는 변수를 최대 8개 사용할 수 있습니다.");
      context.variables.set(key, context.variables.size);
    }
    return context.variables.get(key);
  }

  function compileStatementChain(firstBlock, writer, context) {
    let block = firstBlock;
    while (block) {
      compileStatement(block, writer, context);
      block = block.getNextBlock();
    }
  }

  function compileSetupChain(firstBlock, writer, context) {
    let block = firstBlock;
    while (block) {
      if (block.type === "control_forever") {
        const body = block.getInputTargetBlock("DO");
        if (body) context.foreverBodies.push(body);
        return;
      }
      compileStatement(block, writer, context);
      block = block.getNextBlock();
    }
  }

  function compileStatement(block, writer, context) {
    const expression = name => writeCompiledExpression(writer, inputBlock(block, name), context);
    const pin = name => writer.u8(block.getFieldValue(name));
    switch (block.type) {
      case "control_wait":
        writer.u8(VM.WAIT); expression("SECONDS"); return;
      case "control_forever": {
        const start = writer.position;
        compileStatementChain(block.getInputTargetBlock("DO"), writer, context);
        writer.u8(VM.JUMP); writer.u16(start);
        return;
      }
      case "controls_repeat_ext": {
        writer.u8(VM.REPEAT_START);
        expression("TIMES");
        const endPatch = writer.position;
        writer.u16(0);
        const body = writer.position;
        compileStatementChain(block.getInputTargetBlock("DO"), writer, context);
        writer.u8(VM.REPEAT_END);
        writer.u16(body);
        writer.patchU16(endPatch, writer.position);
        return;
      }
      case "controls_if": {
        const endPatches = [];
        let index = 0;
        while (block.getInput(`IF${index}`)) {
          writer.u8(VM.JUMP_IF_FALSE);
          writeCompiledExpression(writer, block.getInputTargetBlock(`IF${index}`), context);
          const nextPatch = writer.position;
          writer.u16(0);
          compileStatementChain(block.getInputTargetBlock(`DO${index}`), writer, context);
          writer.u8(VM.JUMP);
          endPatches.push(writer.position);
          writer.u16(0);
          writer.patchU16(nextPatch, writer.position);
          index++;
        }
        if (block.getInput("ELSE")) compileStatementChain(block.getInputTargetBlock("ELSE"), writer, context);
        for (const patch of endPatches) writer.patchU16(patch, writer.position);
        return;
      }
      case "variables_set":
        writer.u8(VM.SET_VAR); writer.u8(variableIndex(block, context)); expression("VALUE"); return;
      case "math_change":
        writer.u8(VM.CHANGE_VAR); writer.u8(variableIndex(block, context)); expression("DELTA"); return;
      case "pin_digital_write":
      case "led_digital":
        writer.u8(VM.DIGITAL_WRITE); pin("PIN"); writer.u8(block.getFieldValue("STATE")); return;
      case "pin_pwm_write":
      case "led_pwm":
        writer.u8(VM.PWM_WRITE); pin("PIN"); expression("VALUE"); return;
      case "motor_set":
        writer.u8(VM.MOTOR); pin("IN1"); pin("IN2"); expression("SPEED"); return;
      case "motor_stop":
        writer.u8(VM.MOTOR); pin("IN1"); pin("IN2");
        writeCompiledExpression(writer, null, context); return;
      case "servo_write":
        writer.u8(VM.SERVO); pin("PIN"); expression("ANGLE"); return;
      case "buzzer_tone":
        writer.u8(VM.TONE); pin("PIN"); expression("FREQ"); expression("SECONDS"); return;
      case "buzzer_stop":
        writer.u8(VM.NO_TONE); pin("PIN"); return;
      case "lcd_begin": {
        const [columns, rows] = block.getFieldValue("SIZE").split("x");
        writer.u8(VM.LCD_BEGIN); pin("ADDRESS"); writer.u8(columns); writer.u8(rows); return;
      }
      case "lcd_print":
        writer.u8(VM.LCD_PRINT); expression("ROW"); expression("COL"); expression("VALUE"); return;
      case "lcd_clear":
        writer.u8(VM.LCD_CLEAR); return;
      case "oled_begin":
        writer.u8(VM.OLED_BEGIN); pin("ADDRESS"); return;
      case "oled_print":
        writer.u8(VM.OLED_PRINT); expression("ROW"); expression("COL"); expression("VALUE"); return;
      case "oled_clear":
        writer.u8(VM.OLED_CLEAR); return;
      case "neo_begin":
        writer.u8(VM.NEO_BEGIN); pin("PIN"); expression("COUNT"); return;
      case "neo_set":
        writer.u8(VM.NEO_SET); expression("INDEX"); expression("R"); expression("G"); expression("B"); return;
      case "neo_clear":
        writer.u8(VM.NEO_CLEAR); return;
      case "mp3_begin":
        if (block.getFieldValue("RX") === block.getFieldValue("TX")) {
          throw new Error("DFPlayer RX와 TX는 서로 다른 핀을 선택하세요.");
        }
        writer.u8(VM.MP3_BEGIN); pin("RX"); pin("TX"); expression("VOLUME"); return;
      case "mp3_play":
        writer.u8(VM.MP3_PLAY); expression("TRACK"); return;
      case "mp3_play_for":
        writer.u8(VM.MP3_PLAY); expression("TRACK");
        writer.u8(VM.WAIT); expression("SECONDS");
        writer.u8(VM.MP3_STOP); return;
      case "mp3_volume":
        writer.u8(VM.MP3_VOLUME); expression("VOLUME"); return;
      case "mp3_stop":
        writer.u8(VM.MP3_STOP); return;
      case "bt_begin":
        if (block.getFieldValue("RX") === block.getFieldValue("TX")) {
          throw new Error("Bluetooth RX와 TX는 서로 다른 핀을 선택하세요.");
        }
        writer.u8(VM.BT_BEGIN); pin("RX"); pin("TX"); writer.u16(block.getFieldValue("BAUD")); return;
      case "bt_send":
        writer.u8(VM.BT_SEND); expression("VALUE"); return;
      case "bt_send_many":
        writer.u8(VM.BT_SEND_RAW); expression("VALUE"); return;
      case "bt_set_name":
        writer.u8(VM.BT_SET_NAME); writer.u8(block.getFieldValue("MODE")); expression("NAME"); return;
      case "serial_print":
        writer.u8(VM.SERIAL_PRINT); expression("VALUE"); return;
      case "my_function_call": {
        const definition = context.functions.get(block.getFieldValue("NAME"));
        if (!definition) return;
        if (context.functionDepth >= 12) throw new Error("내 블록 호출이 너무 깊습니다.");
        context.functionDepth++;
        compileStatementChain(definition.getInputTargetBlock("DO"), writer, context);
        context.functionDepth--;
        return;
      }
      default:
        if (!["my_function_def", "my_function_def_value"].includes(block.type)) {
          throw new Error(`‘${block.type}’ 블록은 아직 보드 저장 모드에서 지원되지 않습니다.`);
        }
    }
  }

  function compileStoredProgram() {
    const context = {
      variables: new Map(),
      functions: new Map(),
      valueFunctions: new Map(),
      functionDepth: 0,
      foreverBodies: []
    };
    for (const block of workspace.getAllBlocks(false)) {
      if (block.type === "my_function_def") context.functions.set(block.getFieldValue("NAME"), block);
      if (block.type === "my_function_def_value") context.valueFunctions.set(block.getFieldValue("NAME"), block);
    }
    const topBlocks = workspace.getTopBlocks(true);
    const starts = topBlocks.filter(block => block.type === "arduino_start");
    const loops = topBlocks.filter(block => block.type === "arduino_loop");
    if (!starts.length && !loops.length) throw new Error("‘시작하면’ 또는 ‘계속 실행’ 블록을 추가하세요.");

    const writer = new ByteWriter();
    for (const block of starts) compileSetupChain(block.getNextBlock(), writer, context);
    writer.u8(VM.END);
    const setupLength = writer.position;
    for (const body of context.foreverBodies) compileStatementChain(body, writer, context);
    for (const block of loops) compileStatementChain(block.getNextBlock(), writer, context);
    writer.u8(VM.END);
    if (writer.position > EEPROM_PROGRAM_LIMIT) {
      throw new Error(`프로그램이 ${writer.position}바이트입니다. UNO·Nano 저장 한도 ${EEPROM_PROGRAM_LIMIT}바이트보다 ${writer.position - EEPROM_PROGRAM_LIMIT}바이트 줄여주세요.`);
    }
    return { bytes: writer.bytes, setupLength };
  }

  function bytesToHex(bytes) {
    return bytes.map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function waitForSerialLine(predicate, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      waiter.timer = setTimeout(() => {
        const index = lineWaiters.indexOf(waiter);
        if (index >= 0) lineWaiters.splice(index, 1);
        reject(new Error("보드의 응답 시간이 초과되었습니다."));
      }, timeout);
      lineWaiters.push(waiter);
    });
  }

  function setSaveBoardResult(state, message) {
    const result = $("#saveBoardResult");
    result.dataset.state = state;
    result.textContent = message;
  }

  async function saveProgramToBoard() {
    if (!serialConnected) return toast("먼저 ② USB 연결을 눌러 보드와 연결하세요.");
    const dialog = $("#saveBoardDialog");
    const closeButton = $("#closeSaveBoardDialogBtn");
    dialog.showModal();
    closeButton.disabled = true;
    $("#saveBoardProgress").value = 2;
    $("#saveBoardTitle").textContent = "블록 프로그램 준비 중";
    $("#saveBoardMessage").textContent = "블록을 보드용 명령으로 바꾸고 있습니다.";
    setSaveBoardResult("working", "USB 연결을 유지하세요.");

    try {
      await ensureRuntime();
      if (runtimeVersion !== RUNTIME_VERSION) {
        throw new Error(`현재 런타임은 ${runtimeVersion || "이전 버전"}입니다. USB 연결을 끊고 ① 런타임 설치에서 ${RUNTIME_VERSION}을 다시 설치하세요.`);
      }
      const program = compileStoredProgram();
      const checksum = program.bytes.reduce((sum, value) => (sum + value) & 0xffff, 0);
      $("#saveBoardTitle").textContent = "보드에 저장 중";
      $("#saveBoardMessage").textContent = `${program.bytes.length}바이트 프로그램을 EEPROM으로 보내고 있습니다.`;
      $("#saveBoardProgress").value = 8;

      let response = waitForSerialLine(line => line === "PROGRAM_READY");
      await sendLine(`P,BEGIN,${program.bytes.length},${program.setupLength},${checksum}`);
      await response;

      const chunkSize = 48;
      for (let offset = 0; offset < program.bytes.length; offset += chunkSize) {
        const chunk = program.bytes.slice(offset, offset + chunkSize);
        const end = offset + chunk.length;
        response = waitForSerialLine(line => line === `PROGRAM_DATA,${end}`, 6000);
        await sendLine(`P,DATA,${offset},${bytesToHex(chunk)}`);
        await response;
        $("#saveBoardProgress").value = 10 + Math.round(end / program.bytes.length * 82);
      }

      response = waitForSerialLine(line => line === `SAVED,${program.bytes.length}`, 8000);
      await sendLine("P,SAVE");
      await response;
      $("#saveBoardProgress").value = 100;
      $("#saveBoardTitle").textContent = "저장 및 실행 완료";
      $("#saveBoardMessage").textContent = "이제 USB를 분리해도 전원을 켜면 프로그램이 자동으로 실행됩니다.";
      setSaveBoardResult("success", `저장 크기 ${program.bytes.length}/${EEPROM_PROGRAM_LIMIT}바이트 · I²C LCD, OLED, 네오픽셀, MP3, Bluetooth 포함`);
      toast("보드에 저장했습니다. 프로그램이 바로 실행됩니다.");
    } catch (error) {
      console.error(error);
      $("#saveBoardTitle").textContent = "저장 실패";
      $("#saveBoardMessage").textContent = error.message;
      setSaveBoardResult("error", "USB 연결과 런타임 버전을 확인한 뒤 다시 시도하세요.");
      toast(error.message);
    } finally {
      closeButton.disabled = false;
    }
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
    if (!("serial" in navigator)) return toast("Chrome의 Web Serial 또는 CH340 WebUSB 환경이 필요합니다.");
    try {
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: 115200, bufferSize: 1024 });
      serialWriter = serialPort.writable.getWriter();
      serialConnected = true;
      runtimeReady = false;
      runtimeVersion = "";
      setConnected(true);
      readSerialLoop();
      const deadline = Date.now() + 8000;
      while (!runtimeReady && Date.now() < deadline) {
        await sleep(500);
        await sendLine("PING");
        await sleep(250);
      }
      if (!runtimeReady) throw new Error("OneMaker 런타임 응답이 없습니다. 먼저 런타임을 다시 설치하세요.");
      if (runtimeVersion !== RUNTIME_VERSION) {
        toast(`현재 런타임 ${runtimeVersion || "확인 불가"} · ${RUNTIME_VERSION} 재설치가 필요합니다.`);
        if (!$("#firmwareDialog").open) $("#firmwareDialog").showModal();
      } else {
        toast(`OneMaker Arduino Runtime ${runtimeVersion} 연결 완료`);
      }
    } catch (error) {
      console.error(error);
      if (error.name !== "NotFoundError") toast(formatUsbError(error));
      await disconnectSerial().catch(() => {});
    }
  }

  function formatUsbError(error) {
    const androidCh340 = window.OneMakerCH340?.active;
    if (!androidCh340) return `USB 연결 실패: ${error.message}`;
    if (error.name === "SecurityError") return "CH340 USB 권한이 거부되었습니다. Android USB 창을 닫고 앱에서 다시 연결하세요.";
    if (error.name === "NetworkError") return "CH340를 열지 못했습니다. 다른 USB 앱을 완전히 종료하고 케이블을 다시 연결하세요.";
    if (error.name === "NotSupportedError") return `지원하지 않는 CH340 구성입니다: ${error.message}`;
    return `CH340 USB 연결 실패: ${error.message}`;
  }

  async function disconnectSerial() {
    runCancelled = true;
    runtimeReady = false;
    runtimeVersion = "";
    for (const waiter of valueWaiters.values()) waiter.reject(new Error("USB 연결이 끊어졌습니다."));
    valueWaiters.clear();
    while (lineWaiters.length) {
      const waiter = lineWaiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(new Error("USB 연결이 끊어졌습니다."));
    }
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
    runtimeVersion = "";
    setConnected(false);
  }

  function setConnected(connected) {
    $("#connectionStatus").textContent = connected
      ? (runtimeReady ? `런타임 ${runtimeVersion || ""} 연결됨` : "USB 확인 중")
      : "연결 안 됨";
    $("#connectionStatus").className = `status ${connected ? "connected" : "disconnected"}`;
    $("#connectBtn").classList.toggle("primary", connected);
    $("#connectBtn .dot").classList.toggle("on", connected);
    $("#connectBtn").lastChild.textContent = connected
      ? " 연결 끊기"
      : (window.OneMakerCH340?.active ? "② CH340 USB 연결" : "② USB 연결");
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
      for (let index = lineWaiters.length - 1; index >= 0; index--) {
        const waiter = lineWaiters[index];
        if (!waiter.predicate(line)) continue;
        lineWaiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(line);
      }
      const parts = line.split(",");
      if (parts[0] === "READY") {
        runtimeReady = true;
        runtimeVersion = parts[2] || "";
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

  async function testMp3Playback() {
    const rx = $("#mp3RxPin").value;
    const tx = $("#mp3TxPin").value;
    if (rx === tx) return toast("MP3 RX와 TX는 서로 다른 핀을 선택하세요.");
    try {
      await ensureRuntime();
      if (runtimeVersion !== RUNTIME_VERSION) {
        throw new Error(`MP3 안정화가 포함된 런타임 ${RUNTIME_VERSION}을 먼저 설치하세요.`);
      }
      const ready = waitForSerialLine(line => line === "MP3_READY", 6500);
      await sendLine(["C", "MP3BEGIN", rx, tx, clamp($("#mp3Volume").value, 0, 30)].join(","));
      await ready;
      await sendAction("MP3PLAY", clamp($("#mp3Track").value, 1, 2999));
      $("#mp3TestResult").textContent = "재생 명령을 보냈습니다. 소리가 없으면 배선·5V 전원·microSD·파일을 확인하세요.";
      toast("DFPlayer 초기화 후 재생 명령을 보냈습니다.");
    } catch (error) {
      $("#mp3TestResult").textContent = error.message;
      toast(error.message);
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
      case "bt_received_item": {
        const value = String(await requestValue("BTREAD"));
        const count = clamp(await evaluate(inputBlock(block, "COUNT"), functionDepth), 1, 64);
        const index = clamp(await evaluate(inputBlock(block, "INDEX"), functionDepth), 1, count);
        return value.slice(0, count).charAt(index - 1);
      }
      case "bt_value_equals":
        return String(await requestValue("BTREAD")) === String(await evaluate(inputBlock(block, "VALUE"), functionDepth));
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
      case "oled_begin":
        return sendAction("OLEDBEGIN", block.getFieldValue("ADDRESS"));
      case "oled_print":
        return sendAction(
          "OLEDPRINT",
          clamp(await evaluate(inputBlock(block, "ROW"), functionDepth), 0, 7),
          clamp(await evaluate(inputBlock(block, "COL"), functionDepth), 0, 15),
          encodeHex(await evaluate(inputBlock(block, "VALUE"), functionDepth))
        );
      case "oled_clear":
        return sendAction("OLEDCLEAR");
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
        if (block.getFieldValue("RX") === block.getFieldValue("TX")) {
          throw new Error("DFPlayer RX와 TX는 서로 다른 핀을 선택하세요.");
        }
        return sendAction(
          "MP3BEGIN",
          block.getFieldValue("RX"),
          block.getFieldValue("TX"),
          clamp(await evaluate(inputBlock(block, "VOLUME"), functionDepth), 0, 30)
        );
      case "mp3_play":
        return sendAction("MP3PLAY", clamp(await evaluate(inputBlock(block, "TRACK"), functionDepth), 1, 2999));
      case "mp3_play_for":
        await sendAction("MP3PLAY", clamp(await evaluate(inputBlock(block, "TRACK"), functionDepth), 1, 2999));
        await sleep(clamp(await evaluate(inputBlock(block, "SECONDS"), functionDepth), 0, 3600) * 1000);
        if (!runCancelled) await sendAction("MP3STOP");
        return;
      case "mp3_volume":
        return sendAction("MP3VOL", clamp(await evaluate(inputBlock(block, "VOLUME"), functionDepth), 0, 30));
      case "mp3_stop":
        return sendAction("MP3STOP");
      case "bt_begin":
        if (block.getFieldValue("RX") === block.getFieldValue("TX")) {
          throw new Error("Bluetooth RX와 TX는 서로 다른 핀을 선택하세요.");
        }
        return sendAction("BTBEGIN", block.getFieldValue("RX"), block.getFieldValue("TX"), block.getFieldValue("BAUD"));
      case "bt_send":
        return sendAction("BTSEND", encodeHex(await evaluate(inputBlock(block, "VALUE"), functionDepth)));
      case "bt_send_many":
        return sendAction("BTRAW", encodeHex(await evaluate(inputBlock(block, "VALUE"), functionDepth)));
      case "bt_set_name":
        return sendAction(
          "BTNAME",
          block.getFieldValue("MODE"),
          encodeHex(await evaluate(inputBlock(block, "NAME"), functionDepth))
        );
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

  async function stopWorkspace() {
    runCancelled = true;
    try {
      if (runtimeReady) await sendAction("STOP");
      toast("블록과 출력 동작을 정지했습니다.");
    } catch (_) {}
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
      case "sensor_button": return `(readDigitalPin(${block.getFieldValue("PIN")}) == 1)`;
      case "sensor_ultrasonic": return `readUltrasonic(${block.getFieldValue("TRIG")}, ${block.getFieldValue("ECHO")})`;
      case "sensor_dht": {
        const object = dhtName(block.getFieldValue("PIN"), block.getFieldValue("TYPE"));
        return `${object}.${block.getFieldValue("FIELD") === "humidity" ? "readHumidity" : "readTemperature"}()`;
      }
      case "sensor_dust": return `readDust(${block.getFieldValue("LED_PIN")}, A${block.getFieldValue("ANALOG_PIN")})`;
      case "bt_available": return "(bluetooth.listen(), bluetooth.available() > 0)";
      case "bt_read": return "readBluetoothLine()";
      case "bt_received_item": return `readBluetoothItem(${cppInput(block, "COUNT")}, ${cppInput(block, "INDEX")})`;
      case "bt_value_equals": return `(readBluetoothLine() == String(${cppInput(block, "VALUE", '""')}))`;
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
      case "oled_begin":
        return line(`oled.setI2CAddress(${block.getFieldValue("ADDRESS")} << 1);`)
          + line("oled.begin();")
          + line("oled.setFont(u8x8_font_chroma48medium8_r);")
          + line("oled.clearDisplay();");
      case "oled_print":
        return line(`oled.setCursor(constrain(${cppInput(block, "COL")}, 0, 15), constrain(${cppInput(block, "ROW")}, 0, 7));`)
          + line(`oled.print(${cppInput(block, "VALUE", '\"\"')});`);
      case "oled_clear": return line("oled.clearDisplay();");
      case "neo_begin": return line("pixels.begin();") + line("pixels.clear();") + line("pixels.show();");
      case "neo_set":
        return line(`pixels.setPixelColor(${cppInput(block, "INDEX")}, pixels.Color(${cppInput(block, "R")}, ${cppInput(block, "G")}, ${cppInput(block, "B")}));`)
          + line("pixels.show();");
      case "neo_clear": return line("pixels.clear();") + line("pixels.show();");
      case "mp3_begin":
        return line("initializeMp3();")
          + line(`sendMp3Command(0x06, constrain(${cppInput(block, "VOLUME")}, 0, 30));`);
      case "mp3_play": return line(`sendMp3Command(0x03, ${cppInput(block, "TRACK")});`);
      case "mp3_play_for":
        return line(`sendMp3Command(0x03, ${cppInput(block, "TRACK")});`)
          + line(`delay((unsigned long)max(0.0, (double)(${cppInput(block, "SECONDS")})) * 1000UL);`)
          + line("sendMp3Command(0x16, 0);");
      case "mp3_volume": return line(`sendMp3Command(0x06, constrain(${cppInput(block, "VOLUME")}, 0, 30));`);
      case "mp3_stop": return line("sendMp3Command(0x16, 0);");
      case "bt_begin": return line(`bluetooth.begin(${block.getFieldValue("BAUD")});`);
      case "bt_send": return line(`bluetooth.println(${cppInput(block, "VALUE", '""')});`);
      case "bt_send_many": return line(`bluetooth.print(${cppInput(block, "VALUE", '""')});`);
      case "bt_set_name": return line(`setBluetoothName(String(${cppInput(block, "NAME", '""')}), ${block.getFieldValue("MODE")});`);
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
      oled: {
        enabled: [...types].some(type => type.startsWith("oled_"))
      },
      neo: {
        enabled: [...types].some(type => type.startsWith("neo_")),
        pin: Number(neoBlock?.getFieldValue("PIN") || 6),
        count: numericInputValue(neoBlock, "COUNT", 8)
      },
      bluetooth: {
        enabled: [...types].some(type => type.startsWith("bt_")),
        rx: Number(btBlock?.getFieldValue("RX") || 2),
        tx: Number(btBlock?.getFieldValue("TX") || 3)
      },
      mp3: {
        enabled: [...types].some(type => type.startsWith("mp3_")),
        rx: Number(mp3Block?.getFieldValue("RX") || 10),
        tx: Number(mp3Block?.getFieldValue("TX") || 11)
      }
    };
  }

  function generateArduinoCode() {
    const hardware = collectHardware();
    const includes = [];
    if (hardware.dht.length) includes.push("#include <DHT.h>");
    if (hardware.servoPins.length) includes.push("#include <Servo.h>");
    if (hardware.lcd.enabled) includes.push("#include <Wire.h>", "#include <LiquidCrystal_I2C.h>");
    if (hardware.oled.enabled) includes.push("#include <Wire.h>", "#include <U8x8lib.h>");
    if (hardware.neo.enabled) includes.push("#include <Adafruit_NeoPixel.h>");
    if (hardware.bluetooth.enabled || hardware.mp3.enabled) includes.push("#include <SoftwareSerial.h>");

    const globals = [];
    hardware.dht.forEach(({ pin, type }) => globals.push(`DHT ${dhtName(pin, type)}(${pin}, DHT${type});`));
    hardware.servoPins.forEach(pin => globals.push(`Servo ${cppIdentifier(pin, "servo")};`));
    if (hardware.lcd.enabled) globals.push(`LiquidCrystal_I2C lcd(0x${hardware.lcd.address.toString(16).toUpperCase()}, ${hardware.lcd.columns}, ${hardware.lcd.rows});`);
    if (hardware.oled.enabled) globals.push("U8X8_SSD1306_128X64_NONAME_HW_I2C oled(U8X8_PIN_NONE);");
    if (hardware.neo.enabled) globals.push(`Adafruit_NeoPixel pixels(${hardware.neo.count}, ${hardware.neo.pin}, NEO_GRB + NEO_KHZ800);`);
    if (hardware.bluetooth.enabled) globals.push(`SoftwareSerial bluetooth(${hardware.bluetooth.rx}, ${hardware.bluetooth.tx}); // Arduino RX, TX`);
    if (hardware.mp3.enabled) globals.push(`SoftwareSerial mp3Serial(${hardware.mp3.rx}, ${hardware.mp3.tx}); // Arduino RX, TX`);
    workspace.getVariableMap().getAllVariables().forEach(variable => {
      globals.push(`double ${cppIdentifier(variable.name, "var")} = 0;`);
    });

    const helpers = [];
    if (hardware.types.has("pin_digital_read") || hardware.types.has("sensor_button")) helpers.push(`
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
    if (hardware.bluetooth.enabled && ["bt_read", "bt_received_item", "bt_value_equals"].some(type => hardware.types.has(type))) helpers.push(`
String readBluetoothLine() {
  bluetooth.listen();
  return bluetooth.readStringUntil('\\n');
}

String readBluetoothItem(int count, int index) {
  String value = readBluetoothLine();
  count = constrain(count, 1, 64);
  index = constrain(index, 1, count);
  value = value.substring(0, min(count, (int)value.length()));
  return index <= value.length() ? value.substring(index - 1, index) : String("");
}`);
    if (hardware.bluetooth.enabled && hardware.types.has("bt_set_name")) helpers.push(`
void setBluetoothName(const String &name, uint8_t mode) {
  bluetooth.listen();
  if (mode == 1) {
    bluetooth.print("AT+NAME=");
    bluetooth.print(name);
    bluetooth.print("\\r\\n");
  } else {
    bluetooth.print("AT+NAME");
    bluetooth.print(name);
  }
  delay(1000);
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
}

void initializeMp3() {
  mp3Serial.begin(9600);
  mp3Serial.listen();
  delay(100);
  sendMp3Command(0x0C, 0);  // DFPlayer reset
  delay(2200);              // Wait for the microSD card to become ready
  sendMp3Command(0x09, 2);  // Select TF/microSD card
  delay(300);
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
