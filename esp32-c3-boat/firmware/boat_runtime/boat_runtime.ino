#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

static const char *PROGRAM_PATH = "/boat-program.json";
static const int DEFAULT_IN1 = 1;
static const int DEFAULT_IN2 = 3;
static const int DEFAULT_IN3 = 4;
static const int DEFAULT_IN4 = 5;
static const int DEFAULT_LED = 8;
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
};

struct VariableSlot {
  String name;
  double value = 0;
  bool used = false;
};

BoatConfig config;
VariableSlot variables[MAX_VARS];
bool stopRequested = false;
String inputLine;

void emit(const String &type, const String &message = "") {
  JsonDocument response;
  response["type"] = type;
  if (message.length()) response["message"] = message;
  serializeJson(response, Serial);
  Serial.println();
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

bool parseIncomingLine(const String &line, bool allowCommands);

void pollStopCommand() {
  while (Serial.available()) {
    char value = Serial.read();
    if (value == '\n') {
      inputLine.trim();
      if (inputLine.length()) parseIncomingLine(inputLine, false);
      inputLine = "";
    } else if (value != '\r' && inputLine.length() < 24000) {
      inputLine += value;
    }
  }
}

bool waitInterruptible(unsigned long milliseconds) {
  unsigned long started = millis();
  while (millis() - started < milliseconds) {
    pollStopCommand();
    if (stopRequested) return false;
    delay(2);
  }
  return true;
}

bool executeSteps(JsonArrayConst steps);

bool executeStep(JsonObjectConst step) {
  if (stopRequested) return false;
  const char *op = step["op"] | "";

  if (strcmp(op, "move") == 0) {
    int speed = constrain((int)evaluateNumber(step["speed"]), 0, 255);
    const char *direction = step["direction"] | "forward";
    if (strcmp(direction, "forward") == 0) setDrive(speed, speed);
    else if (strcmp(direction, "backward") == 0) setDrive(-speed, -speed);
    else if (strcmp(direction, "left") == 0) setDrive(-speed, speed);
    else if (strcmp(direction, "right") == 0) setDrive(speed, -speed);
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
  } else if (strcmp(op, "setVar") == 0) {
    setVariable(step["name"].as<String>(), evaluateNumber(step["value"]));
  } else if (strcmp(op, "changeVar") == 0) {
    String name = step["name"].as<String>();
    setVariable(name, getVariable(name) + evaluateNumber(step["value"]));
  } else if (strcmp(op, "print") == 0) {
    Serial.println(evaluateText(step["value"]));
  } else if (strcmp(op, "repeat") == 0) {
    long count = constrain((long)evaluateNumber(step["count"]), 0L, 100000L);
    for (long index = 0; index < count && !stopRequested; index++) {
      if (!executeSteps(step["steps"].as<JsonArrayConst>())) return false;
    }
  } else if (strcmp(op, "forever") == 0) {
    while (!stopRequested) {
      if (!executeSteps(step["steps"].as<JsonArrayConst>())) return false;
      pollStopCommand();
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
  pollStopCommand();
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

bool runSavedProgram() {
  if (!LittleFS.exists(PROGRAM_PATH)) {
    emit("error", "저장된 프로그램이 없습니다.");
    return false;
  }
  File file = LittleFS.open(PROGRAM_PATH, "r");
  if (!file) {
    emit("error", "프로그램 파일을 열 수 없습니다.");
    return false;
  }
  JsonDocument document;
  DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error) {
    emit("error", error.c_str());
    return false;
  }
  applyConfig(document["config"]);
  clearVariables();
  stopRequested = false;
  emit("started");
  bool completed = executeSteps(document["program"].as<JsonArrayConst>());
  if (stopRequested) emit("stopped");
  else if (completed) emit("completed");
  return completed;
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
  if (!allowCommands) return false;

  if (strcmp(command, "hello") == 0) {
    JsonDocument response;
    response["type"] = "hello";
    response["board"] = "ESP32-C3 Super Mini";
    response["runtime"] = "OneMaker Boat 1.0.0";
    serializeJson(response, Serial);
    Serial.println();
    return true;
  }
  if (strcmp(command, "load") == 0) {
    JsonDocument stored;
    stored["config"] = document["config"];
    stored["program"] = document["program"];
    if (saveProgram(stored)) emit("loaded");
    else emit("error", "프로그램을 저장하지 못했습니다.");
    return true;
  }
  if (strcmp(command, "run") == 0) {
    runSavedProgram();
    return true;
  }
  if (strcmp(command, "drive") == 0) {
    applyConfig(document["config"]);
    int speed = constrain(document["speed"] | 0, 0, 255);
    const char *direction = document["direction"] | "stop";
    if (strcmp(direction, "forward") == 0) setDrive(speed, speed);
    else if (strcmp(direction, "backward") == 0) setDrive(-speed, -speed);
    else if (strcmp(direction, "left") == 0) setDrive(-speed, speed);
    else if (strcmp(direction, "right") == 0) setDrive(speed, -speed);
    else stopBoat();
    emit("drive");
    return true;
  }
  emit("error", "알 수 없는 명령입니다.");
  return false;
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
  applyConfig(defaults);
  emit("ready", "OneMaker ESP32-C3 Boat Runtime");
  delay(750);
  if (LittleFS.exists(PROGRAM_PATH)) runSavedProgram();
}

void loop() {
  while (Serial.available()) {
    char value = Serial.read();
    if (value == '\n') {
      inputLine.trim();
      if (inputLine.length()) parseIncomingLine(inputLine, true);
      inputLine = "";
    } else if (value != '\r' && inputLine.length() < 24000) {
      inputLine += value;
    }
  }
  delay(2);
}
