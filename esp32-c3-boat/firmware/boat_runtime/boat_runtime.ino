#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <HUSKYLENS.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

static const char *PROGRAM_PATH = "/boat-program.json";
static const char *WIFI_SSID = "OneMaker-Boat";
static const char *WIFI_PASSWORD = "onemaker1";
static const char *BLE_SERVICE_UUID = "7a1f0001-7c73-4d9b-9e4b-4f4d4b000001";
static const char *BLE_RX_UUID = "7a1f0002-7c73-4d9b-9e4b-4f4d4b000002";
static const char *BLE_TX_UUID = "7a1f0003-7c73-4d9b-9e4b-4f4d4b000003";
static const int DEFAULT_IN1 = 1;
static const int DEFAULT_IN2 = 3;
static const int DEFAULT_IN3 = 4;
static const int DEFAULT_IN4 = 5;
static const int DEFAULT_LED = 8;
static const int DEFAULT_HUSKY_SDA = 6;
static const int DEFAULT_HUSKY_SCL = 7;
static const int MAX_VARS = 20;

struct BoatConfig {
  int in1 = DEFAULT_IN1;
  int in2 = DEFAULT_IN2;
  int in3 = DEFAULT_IN3;
  int in4 = DEFAULT_IN4;
  int led = DEFAULT_LED;
  bool invertLeft = false;
  bool invertRight = true;
  bool ledActiveLow = true;
  bool huskyEnabled = false;
  int huskySda = DEFAULT_HUSKY_SDA;
  int huskyScl = DEFAULT_HUSKY_SCL;
};

struct VariableSlot {
  String name;
  double value = 0;
  bool used = false;
};

BoatConfig config;
VariableSlot variables[MAX_VARS];
JsonDocument activeProgram;
WebServer webServer(80);
HUSKYLENS huskylens;
BLECharacteristic *bleTx = nullptr;
bool bleConnected = false;
bool huskyReady = false;
bool stopRequested = false;
double remoteSpeed = 0;
String serialInputLine;
String bleInputLine;
String blePendingData;

static const char REMOTE_PAGE[] PROGMEM = R"HTML(
<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>OneMaker Boat Remote</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef4f7;color:#12314a;font-family:system-ui,sans-serif;text-align:center}
main{max-width:430px;margin:auto;padding:24px 18px}h1{font-size:24px;margin:6px}p{font-size:13px;color:#62717d}
.card{background:#fff;border-radius:18px;padding:20px;box-shadow:0 12px 32px #12314a20}
label{display:flex;gap:12px;align-items:center}input{width:100%}output{font-weight:800;color:#2677df}
.pad{display:grid;grid-template:70px 70px 70px/repeat(3,70px);gap:10px;justify-content:center;margin:24px 0}
button{border:0;border-radius:15px;background:#dfeaf0;color:#12314a;font-size:28px;font-weight:800;touch-action:none}
button small{display:block;font-size:10px}.up{grid-column:2}.left{grid-row:2;grid-column:1}.stop{grid-row:2;grid-column:2;background:#ffe0e0;color:#b12828}.right{grid-row:2;grid-column:3}.down{grid-row:3;grid-column:2}
#status{font-size:11px;color:#16815d}.warn{font-size:11px;background:#fff5d6;border-radius:10px;padding:10px}
</style></head><body><main><h1>🚤 OneMaker Boat</h1><p id="status">Wi‑Fi 리모컨 연결됨</p><div class="card">
<label>속도 <input id="speed" type="range" min="0" max="255" value="180"><output id="value">180</output></label>
<div class="pad"><button class="up" data-b="forward">▲<small>전진</small></button><button class="left" data-b="left">◀<small>좌회전</small></button><button class="stop" data-b="stop">■<small>정지</small></button><button class="right" data-b="right">▶<small>우회전</small></button><button class="down" data-b="backward">▼<small>후진</small></button></div>
<div class="warn">방향 버튼을 누르는 동안만 움직입니다. 먼저 프로펠러를 분리하고 시험하세요.</div></div></main>
<script>
const speed=document.querySelector("#speed"),value=document.querySelector("#value");speed.oninput=()=>value.textContent=speed.value;
function send(button){fetch(`/api/remote?button=${button}&speed=${speed.value}`,{cache:"no-store"}).catch(()=>status.textContent="연결을 확인하세요.");}
document.querySelectorAll("button").forEach(b=>{b.onpointerdown=e=>{e.preventDefault();send(b.dataset.b)};if(b.dataset.b!=="stop"){b.onpointerup=()=>send("stop");b.onpointercancel=()=>send("stop");b.onpointerleave=e=>{if(e.buttons)send("stop")}}});
</script></body></html>
)HTML";

void pollIncomingCommands();
bool parseIncomingLine(const String &line, bool allowCommands);
bool executeSteps(JsonArrayConst steps);
void handleRemote(const String &button, int speed);

void sendBleLine(const String &line) {
  if (!bleConnected || !bleTx) return;
  bleTx->setValue((line + "\n").c_str());
  bleTx->notify();
}

void emit(const String &type, const String &message = "") {
  JsonDocument response;
  response["type"] = type;
  if (message.length()) response["message"] = message;
  String line;
  serializeJson(response, line);
  Serial.println(line);
  sendBleLine(line);
}

class BoatServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleConnected = true;
  }

  void onDisconnect(BLEServer *server) override {
    bleConnected = false;
    delay(50);
    server->getAdvertising()->start();
  }
};

class BoatRxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue();
    if (value.length()) blePendingData += value;
  }
};

void startBluetooth() {
  BLEDevice::init("OneMaker Boat C3");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new BoatServerCallbacks());
  BLEService *service = server->createService(BLE_SERVICE_UUID);
  BLECharacteristic *rx = service->createCharacteristic(
    BLE_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rx->setCallbacks(new BoatRxCallbacks());
  bleTx = service->createCharacteristic(BLE_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  bleTx->addDescriptor(new BLE2902());
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

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
  if (config.invertLeft) left = -left;
  if (config.invertRight) right = -right;
  setChannel(config.in1, config.in2, left);
  setChannel(config.in3, config.in4, right);
}

void stopBoat() {
  setDrive(0, 0);
}

void driveDirection(const String &direction, int speed) {
  speed = constrain(speed, 0, 255);
  if (direction == "forward") setDrive(speed, speed);
  else if (direction == "backward") setDrive(-speed, -speed);
  else if (direction == "left") setDrive(-speed, speed);
  else if (direction == "right") setDrive(speed, -speed);
  else stopBoat();
}

void applyConfig(JsonVariantConst value) {
  if (value.isNull()) return;
  JsonObjectConst pins = value["pins"];
  config.in1 = pins["in1"] | DEFAULT_IN1;
  config.in2 = pins["in2"] | DEFAULT_IN2;
  config.in3 = pins["in3"] | DEFAULT_IN3;
  config.in4 = pins["in4"] | DEFAULT_IN4;
  config.led = pins["led"] | DEFAULT_LED;
  config.invertLeft = value["invertLeft"] | false;
  config.invertRight = value["invertRight"] | true;
  config.ledActiveLow = value["ledActiveLow"] | true;
  config.huskyEnabled = value["husky"]["enabled"] | false;
  int newSda = value["husky"]["sda"] | DEFAULT_HUSKY_SDA;
  int newScl = value["husky"]["scl"] | DEFAULT_HUSKY_SCL;
  if (newSda != config.huskySda || newScl != config.huskyScl) huskyReady = false;
  config.huskySda = newSda;
  config.huskyScl = newScl;

  pinMode(config.in1, OUTPUT);
  pinMode(config.in2, OUTPUT);
  pinMode(config.in3, OUTPUT);
  pinMode(config.in4, OUTPUT);
  pinMode(config.led, OUTPUT);
  digitalWrite(config.led, config.ledActiveLow ? HIGH : LOW);
  stopBoat();
}

double getVariable(const String &name) {
  for (int index = 0; index < MAX_VARS; index++) {
    if (variables[index].used && variables[index].name == name) return variables[index].value;
  }
  return 0;
}

void setVariable(const String &name, double value) {
  for (int index = 0; index < MAX_VARS; index++) {
    if (variables[index].used && variables[index].name == name) {
      variables[index].value = value;
      return;
    }
  }
  for (int index = 0; index < MAX_VARS; index++) {
    if (!variables[index].used) {
      variables[index].used = true;
      variables[index].name = name;
      variables[index].value = value;
      return;
    }
  }
}

void clearVariables() {
  for (int index = 0; index < MAX_VARS; index++) {
    variables[index].used = false;
    variables[index].name = "";
    variables[index].value = 0;
  }
}

long sonarCm(int trigPin, int echoPin) {
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

bool ensureHusky() {
  if (!config.huskyEnabled) return false;
  if (huskyReady) return true;
  Wire.begin(config.huskySda, config.huskyScl);
  huskyReady = huskylens.begin(Wire);
  if (!huskyReady) emit("husky", "HuskyLens 연결을 확인하세요.");
  return huskyReady;
}

bool fetchHuskyResult(int id, HUSKYLENSResult &result) {
  if (!ensureHusky() || !huskylens.requestBlocks(id) || !huskylens.available()) return false;
  result = huskylens.read();
  return true;
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

double evaluateNumber(JsonVariantConst expression);

String evaluateText(JsonVariantConst expression) {
  const char *type = expression["type"] | "number";
  if (strcmp(type, "text") == 0) return expression["value"].as<String>();
  return String(evaluateNumber(expression), 2);
}

double evaluateNumber(JsonVariantConst expression) {
  if (expression.isNull()) return 0;
  const char *type = expression["type"] | "number";

  if (strcmp(type, "number") == 0) return expression["value"] | 0.0;
  if (strcmp(type, "text") == 0) return expression["value"].as<String>().toDouble();
  if (strcmp(type, "variable") == 0) return getVariable(expression["name"].as<String>());
  if (strcmp(type, "remoteSpeed") == 0) return remoteSpeed;
  if (strcmp(type, "digitalRead") == 0) {
    int pin = expression["pin"] | 0;
    pinMode(pin, INPUT);
    return digitalRead(pin);
  }
  if (strcmp(type, "analogRead") == 0) {
    int pin = expression["pin"] | 0;
    pinMode(pin, INPUT);
    return analogRead(pin);
  }
  if (strcmp(type, "sonar") == 0) return sonarCm(expression["trig"] | 0, expression["echo"] | 0);
  if (strcmp(type, "huskySeen") == 0 || strcmp(type, "huskyValue") == 0) {
    int id = constrain((int)evaluateNumber(expression["id"]), 1, 20);
    HUSKYLENSResult result;
    if (!fetchHuskyResult(id, result)) return 0;
    if (strcmp(type, "huskySeen") == 0) return 1;
    const char *field = expression["field"] | "x";
    if (strcmp(field, "x") == 0) return result.xCenter;
    if (strcmp(field, "y") == 0) return result.yCenter;
    if (strcmp(field, "width") == 0) return result.width;
    return result.height;
  }
  if (strcmp(type, "not") == 0) return !evaluateNumber(expression["value"]);

  double a = evaluateNumber(expression["a"]);
  double b = evaluateNumber(expression["b"]);
  const char *op = expression["op"] | "";
  if (strcmp(type, "math") == 0) {
    if (strcmp(op, "ADD") == 0) return a + b;
    if (strcmp(op, "MINUS") == 0) return a - b;
    if (strcmp(op, "MULTIPLY") == 0) return a * b;
    if (strcmp(op, "DIVIDE") == 0) return b == 0 ? 0 : a / b;
    if (strcmp(op, "POWER") == 0) return pow(a, b);
  }
  if (strcmp(type, "compare") == 0) {
    if (strcmp(op, "EQ") == 0) return a == b;
    if (strcmp(op, "NEQ") == 0) return a != b;
    if (strcmp(op, "LT") == 0) return a < b;
    if (strcmp(op, "LTE") == 0) return a <= b;
    if (strcmp(op, "GT") == 0) return a > b;
    if (strcmp(op, "GTE") == 0) return a >= b;
  }
  if (strcmp(type, "logic") == 0) {
    if (strcmp(op, "AND") == 0) return a && b;
    if (strcmp(op, "OR") == 0) return a || b;
  }
  return 0;
}

void consumeInput(String &buffer, const String &data, bool allowCommands) {
  buffer += data;
  int newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    String line = buffer.substring(0, newline);
    buffer.remove(0, newline + 1);
    line.trim();
    if (line.length()) parseIncomingLine(line, allowCommands);
  }
  if (buffer.length() > 24000) buffer = "";
}

void pollIncomingCommands() {
  String serialData;
  while (Serial.available()) serialData += (char)Serial.read();
  if (serialData.length()) consumeInput(serialInputLine, serialData, false);
  if (blePendingData.length()) {
    String pending = blePendingData;
    blePendingData = "";
    consumeInput(bleInputLine, pending, false);
  }
  webServer.handleClient();
}

bool waitInterruptible(unsigned long milliseconds) {
  unsigned long started = millis();
  while (millis() - started < milliseconds) {
    pollIncomingCommands();
    if (stopRequested) return false;
    delay(2);
  }
  return true;
}

bool executeStep(JsonObjectConst step) {
  if (stopRequested) return false;
  const char *op = step["op"] | "";
  if (strcmp(op, "move") == 0) {
    driveDirection(step["direction"] | "forward", (int)evaluateNumber(step["speed"]));
  } else if (strcmp(op, "stop") == 0) {
    stopBoat();
  } else if (strcmp(op, "motor") == 0) {
    int speed = constrain((int)evaluateNumber(step["speed"]), -255, 255);
    const char *motor = step["motor"] | "left";
    if (strcmp(motor, "left") == 0) {
      if (config.invertLeft) speed = -speed;
      setChannel(config.in1, config.in2, speed);
    } else {
      if (config.invertRight) speed = -speed;
      setChannel(config.in3, config.in4, speed);
    }
  } else if (strcmp(op, "led") == 0) {
    bool on = step["value"] | false;
    digitalWrite(config.led, config.ledActiveLow ? !on : on);
  } else if (strcmp(op, "digitalWrite") == 0) {
    int pin = step["pin"] | 0;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, (step["value"] | 0) ? HIGH : LOW);
  } else if (strcmp(op, "analogWrite") == 0) {
    int pin = step["pin"] | 0;
    pinMode(pin, OUTPUT);
    analogWrite(pin, constrain((int)evaluateNumber(step["value"]), 0, 255));
  } else if (strcmp(op, "wait") == 0) {
    unsigned long duration = max(0.0, evaluateNumber(step["seconds"])) * 1000;
    if (!waitInterruptible(duration)) return false;
  } else if (strcmp(op, "huskyAlgorithm") == 0) {
    setHuskyAlgorithm(step["algorithm"].as<String>());
  } else if (strcmp(op, "setVar") == 0) {
    setVariable(step["name"].as<String>(), evaluateNumber(step["value"]));
  } else if (strcmp(op, "changeVar") == 0) {
    String name = step["name"].as<String>();
    setVariable(name, getVariable(name) + evaluateNumber(step["value"]));
  } else if (strcmp(op, "print") == 0) {
    String text = evaluateText(step["value"]);
    Serial.println(text);
    sendBleLine(text);
  } else if (strcmp(op, "repeat") == 0) {
    long count = constrain((long)evaluateNumber(step["count"]), 0L, 100000L);
    for (long index = 0; index < count && !stopRequested; index++) {
      if (!executeSteps(step["steps"].as<JsonArrayConst>())) return false;
    }
  } else if (strcmp(op, "forever") == 0) {
    while (!stopRequested) {
      if (!executeSteps(step["steps"].as<JsonArrayConst>())) return false;
      pollIncomingCommands();
      delay(1);
    }
  } else if (strcmp(op, "if") == 0) {
    bool matched = false;
    for (JsonObjectConst branch : step["branches"].as<JsonArrayConst>()) {
      if (evaluateNumber(branch["condition"])) {
        matched = true;
        if (!executeSteps(branch["steps"].as<JsonArrayConst>())) return false;
        break;
      }
    }
    if (!matched && !executeSteps(step["elseSteps"].as<JsonArrayConst>())) return false;
  }
  pollIncomingCommands();
  return !stopRequested;
}

bool executeSteps(JsonArrayConst steps) {
  for (JsonObjectConst step : steps) {
    if (!executeStep(step)) return false;
  }
  return !stopRequested;
}

bool saveProgram(JsonVariantConst root) {
  File file = LittleFS.open(PROGRAM_PATH, "w");
  if (!file) return false;
  serializeJson(root, file);
  file.close();
  return true;
}

bool loadActiveProgram() {
  if (!LittleFS.exists(PROGRAM_PATH)) return false;
  File file = LittleFS.open(PROGRAM_PATH, "r");
  if (!file) return false;
  activeProgram.clear();
  DeserializationError error = deserializeJson(activeProgram, file);
  file.close();
  if (error) {
    emit("error", error.c_str());
    return false;
  }
  applyConfig(activeProgram["config"]);
  return true;
}

bool runSavedProgram() {
  if (!loadActiveProgram()) {
    emit("error", "저장된 프로그램이 없습니다.");
    return false;
  }
  clearVariables();
  stopRequested = false;
  emit("started");
  bool completed = executeSteps(activeProgram["program"].as<JsonArrayConst>());
  if (stopRequested) emit("stopped");
  else if (completed) emit("completed");
  return completed;
}

void handleRemote(const String &button, int speed) {
  remoteSpeed = constrain(speed, 0, 255);
  stopRequested = false;
  JsonArrayConst handler = activeProgram["handlers"][button.c_str()].as<JsonArrayConst>();
  if (!handler.isNull() && handler.size()) {
    executeSteps(handler);
  } else {
    driveDirection(button, (int)remoteSpeed);
  }
  emit("remote", button);
}

bool parseIncomingLine(const String &line, bool allowCommands) {
  JsonDocument document;
  DeserializationError error = deserializeJson(document, line);
  if (error) {
    if (allowCommands) emit("error", "JSON 명령을 해석할 수 없습니다.");
    return false;
  }
  const char *command = document["cmd"] | "";
  if (strcmp(command, "stop") == 0) {
    stopRequested = true;
    stopBoat();
    emit("stopped");
    return true;
  }
  if (strcmp(command, "remote") == 0) {
    applyConfig(document["config"]);
    handleRemote(document["button"] | "stop", document["speed"] | 0);
    return true;
  }
  if (!allowCommands) return false;
  if (strcmp(command, "hello") == 0) {
    JsonDocument response;
    response["type"] = "hello";
    response["board"] = "ESP32-C3 Super Mini";
    response["runtime"] = "OneMaker Boat 1.1.0";
    response["wifi"] = WIFI_SSID;
    String output;
    serializeJson(response, output);
    Serial.println(output);
    sendBleLine(output);
    return true;
  }
  if (strcmp(command, "load") == 0) {
    JsonDocument stored;
    stored["config"] = document["config"];
    stored["program"] = document["program"];
    stored["handlers"] = document["handlers"];
    if (saveProgram(stored) && loadActiveProgram()) emit("loaded");
    else emit("error", "프로그램을 저장하지 못했습니다.");
    return true;
  }
  if (strcmp(command, "run") == 0) {
    runSavedProgram();
    return true;
  }
  if (strcmp(command, "drive") == 0) {
    applyConfig(document["config"]);
    driveDirection(document["direction"] | "stop", document["speed"] | 0);
    emit("drive");
    return true;
  }
  emit("error", "알 수 없는 명령입니다.");
  return false;
}

void startWebRemote() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);
  webServer.on("/", HTTP_GET, []() {
    webServer.send_P(200, "text/html; charset=utf-8", REMOTE_PAGE);
  });
  webServer.on("/api/remote", HTTP_GET, []() {
    String button = webServer.arg("button");
    int speed = constrain(webServer.arg("speed").toInt(), 0, 255);
    handleRemote(button.length() ? button : "stop", speed);
    webServer.send(200, "application/json", "{\"ok\":true}");
  });
  webServer.on("/api/status", HTTP_GET, []() {
    webServer.send(200, "application/json", "{\"board\":\"ESP32-C3 Super Mini\",\"runtime\":\"1.1.0\"}");
  });
  webServer.onNotFound([]() {
    webServer.send(404, "text/plain; charset=utf-8", "Not found");
  });
  webServer.begin();
}

void setup() {
  Serial.begin(115200);
  delay(250);
  LittleFS.begin(true);
  JsonDocument defaults;
  JsonObject pins = defaults["pins"].to<JsonObject>();
  pins["in1"] = DEFAULT_IN1;
  pins["in2"] = DEFAULT_IN2;
  pins["in3"] = DEFAULT_IN3;
  pins["in4"] = DEFAULT_IN4;
  pins["led"] = DEFAULT_LED;
  defaults["invertLeft"] = false;
  defaults["invertRight"] = true;
  defaults["ledActiveLow"] = true;
  defaults["husky"]["enabled"] = false;
  defaults["husky"]["sda"] = DEFAULT_HUSKY_SDA;
  defaults["husky"]["scl"] = DEFAULT_HUSKY_SCL;
  applyConfig(defaults);
  startWebRemote();
  startBluetooth();
  emit("ready", "OneMaker ESP32-C3 Boat Runtime 1.1.0");
  delay(500);
  if (LittleFS.exists(PROGRAM_PATH)) runSavedProgram();
}

void loop() {
  String serialData;
  while (Serial.available()) serialData += (char)Serial.read();
  if (serialData.length()) consumeInput(serialInputLine, serialData, true);
  if (blePendingData.length()) {
    String pending = blePendingData;
    blePendingData = "";
    consumeInput(bleInputLine, pending, true);
  }
  webServer.handleClient();
  delay(2);
}
