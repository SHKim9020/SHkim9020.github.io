#include <Arduino.h>
#include <Wire.h>
#include <Servo.h>
#include <SoftwareSerial.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_NeoPixel.h>

// OneMaker Arduino UNO/Nano Runtime 1.0.0
static const char *RUNTIME_VERSION = "1.0.0";
static const uint8_t MAX_LINE = 180;
static const uint8_t ONEMAKER_MAX_SERVOS = 4;
static const uint8_t MAX_TRACKED_MOTORS = 4;

char inputLine[MAX_LINE];
uint8_t inputLength = 0;

Servo servos[ONEMAKER_MAX_SERVOS];
int8_t servoPins[ONEMAKER_MAX_SERVOS] = {-1, -1, -1, -1};
uint8_t motorPins[MAX_TRACKED_MOTORS] = {255, 255, 255, 255};
uint8_t motorPinCount = 0;
int8_t lastTonePin = -1;

LiquidCrystal_I2C *lcd = nullptr;
Adafruit_NeoPixel *pixels = nullptr;
SoftwareSerial *bluetooth = nullptr;
SoftwareSerial *mp3Serial = nullptr;
DHT *dht = nullptr;
int8_t dhtPin = -1;
uint8_t dhtType = 0;

int tokenInt(char *value, int fallback = 0) {
  return value ? atoi(value) : fallback;
}

String decodeHex(const char *hex) {
  String value;
  if (!hex) return value;
  size_t length = strlen(hex);
  value.reserve(length / 2);
  for (size_t index = 0; index + 1 < length; index += 2) {
    char byteText[3] = {hex[index], hex[index + 1], 0};
    value += (char)strtoul(byteText, nullptr, 16);
  }
  return value;
}

void printHex(const String &value) {
  const char symbols[] = "0123456789abcdef";
  for (size_t index = 0; index < value.length(); index++) {
    uint8_t byteValue = (uint8_t)value[index];
    Serial.print(symbols[byteValue >> 4]);
    Serial.print(symbols[byteValue & 0x0F]);
  }
}

void sendReady() {
  Serial.print(F("READY,OneMaker Arduino Runtime,"));
  Serial.println(RUNTIME_VERSION);
}

void sendNumber(const char *id, double value) {
  Serial.print(F("V,"));
  Serial.print(id);
  Serial.print(',');
  Serial.println(value, 2);
}

void sendText(const char *id, const String &value) {
  Serial.print(F("T,"));
  Serial.print(id);
  Serial.print(',');
  printHex(value);
  Serial.println();
}

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
}

int readDust(uint8_t ledPin, uint8_t analogIndex) {
  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);
  delayMicroseconds(280);
  int value = analogRead(A0 + constrain(analogIndex, 0, 5));
  delayMicroseconds(40);
  digitalWrite(ledPin, HIGH);
  delayMicroseconds(9680);
  return value;
}

void rememberMotorPin(uint8_t pin) {
  for (uint8_t index = 0; index < motorPinCount; index++) {
    if (motorPins[index] == pin) return;
  }
  if (motorPinCount < MAX_TRACKED_MOTORS) motorPins[motorPinCount++] = pin;
}

void setMotor(uint8_t pin1, uint8_t pin2, int speedValue) {
  speedValue = constrain(speedValue, -255, 255);
  rememberMotorPin(pin1);
  rememberMotorPin(pin2);
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
}

Servo *servoForPin(uint8_t pin) {
  for (uint8_t index = 0; index < ONEMAKER_MAX_SERVOS; index++) {
    if (servoPins[index] == pin) return &servos[index];
  }
  for (uint8_t index = 0; index < ONEMAKER_MAX_SERVOS; index++) {
    if (servoPins[index] < 0) {
      servoPins[index] = pin;
      servos[index].attach(pin);
      return &servos[index];
    }
  }
  return nullptr;
}

void sendMp3Command(uint8_t command, uint16_t parameter) {
  if (!mp3Serial) return;
  uint8_t packet[10] = {
    0x7E, 0xFF, 0x06, command, 0x00,
    (uint8_t)(parameter >> 8), (uint8_t)parameter, 0x00, 0x00, 0xEF
  };
  uint16_t checksum = 0 - (0xFF + 0x06 + command + packet[4] + packet[5] + packet[6]);
  packet[7] = checksum >> 8;
  packet[8] = checksum;
  mp3Serial->listen();
  mp3Serial->write(packet, sizeof(packet));
  delay(120);
}

void stopOutputs() {
  for (uint8_t index = 0; index < motorPinCount; index++) analogWrite(motorPins[index], 0);
  if (lastTonePin >= 0) noTone(lastTonePin);
  if (mp3Serial) sendMp3Command(0x16, 0);
}

void handleQuery(char *id, char *operation, char **args, uint8_t count) {
  if (!id || !operation) return;
  if (!strcmp(operation, "DR") && count >= 1) {
    uint8_t pin = tokenInt(args[0]);
    pinMode(pin, INPUT);
    sendNumber(id, digitalRead(pin));
  } else if (!strcmp(operation, "AR") && count >= 1) {
    sendNumber(id, analogRead(A0 + constrain(tokenInt(args[0]), 0, 5)));
  } else if (!strcmp(operation, "BUTTON") && count >= 1) {
    uint8_t pin = tokenInt(args[0]);
    pinMode(pin, INPUT_PULLUP);
    sendNumber(id, digitalRead(pin) == LOW ? 1 : 0);
  } else if (!strcmp(operation, "SONAR") && count >= 2) {
    sendNumber(id, readUltrasonic(tokenInt(args[0]), tokenInt(args[1])));
  } else if (!strcmp(operation, "DUST") && count >= 2) {
    sendNumber(id, readDust(tokenInt(args[0]), tokenInt(args[1])));
  } else if (!strcmp(operation, "DHT") && count >= 3) {
    uint8_t pin = tokenInt(args[0]);
    uint8_t type = tokenInt(args[1]) == 22 ? DHT22 : DHT11;
    if (!dht || dhtPin != pin || dhtType != type) {
      if (dht) delete dht;
      dht = new DHT(pin, type);
      dhtPin = pin;
      dhtType = type;
      dht->begin();
      delay(20);
    }
    float value = tokenInt(args[2]) ? dht->readHumidity() : dht->readTemperature();
    sendNumber(id, isnan(value) ? -999 : value);
  } else if (!strcmp(operation, "BTAVAIL")) {
    if (bluetooth) bluetooth->listen();
    sendNumber(id, bluetooth && bluetooth->available() ? 1 : 0);
  } else if (!strcmp(operation, "BTREAD")) {
    String value;
    if (bluetooth) {
      bluetooth->listen();
      unsigned long started = millis();
      while (millis() - started < 80) {
        while (bluetooth->available()) {
          char character = bluetooth->read();
          if (character == '\r' || character == '\n') {
            if (value.length()) break;
          } else {
            value += character;
          }
        }
      }
    }
    sendText(id, value);
  } else {
    sendNumber(id, 0);
  }
}

void handleCommand(char *operation, char **args, uint8_t count) {
  if (!operation) return;
  if (!strcmp(operation, "DW") && count >= 2) {
    uint8_t pin = tokenInt(args[0]);
    pinMode(pin, OUTPUT);
    digitalWrite(pin, tokenInt(args[1]) ? HIGH : LOW);
  } else if (!strcmp(operation, "PW") && count >= 2) {
    uint8_t pin = tokenInt(args[0]);
    pinMode(pin, OUTPUT);
    analogWrite(pin, constrain(tokenInt(args[1]), 0, 255));
  } else if (!strcmp(operation, "MOTOR") && count >= 3) {
    setMotor(tokenInt(args[0]), tokenInt(args[1]), tokenInt(args[2]));
  } else if (!strcmp(operation, "SERVO") && count >= 2) {
    Servo *servo = servoForPin(tokenInt(args[0]));
    if (servo) servo->write(constrain(tokenInt(args[1]), 0, 180));
  } else if (!strcmp(operation, "TONE") && count >= 3) {
    lastTonePin = tokenInt(args[0]);
    tone(lastTonePin, constrain(tokenInt(args[1]), 20, 20000), max(1, tokenInt(args[2])));
  } else if (!strcmp(operation, "NOTONE") && count >= 1) {
    noTone(tokenInt(args[0]));
  } else if (!strcmp(operation, "LCDBEGIN") && count >= 3) {
    if (lcd) delete lcd;
    lcd = new LiquidCrystal_I2C(tokenInt(args[0]), tokenInt(args[1]), tokenInt(args[2]));
    lcd->init();
    lcd->backlight();
    lcd->clear();
  } else if (!strcmp(operation, "LCDPRINT") && count >= 3 && lcd) {
    lcd->setCursor(tokenInt(args[1]), tokenInt(args[0]));
    lcd->print(decodeHex(args[2]));
  } else if (!strcmp(operation, "LCDCLEAR") && lcd) {
    lcd->clear();
  } else if (!strcmp(operation, "NEOBEGIN") && count >= 2) {
    if (pixels) delete pixels;
    pixels = new Adafruit_NeoPixel(constrain(tokenInt(args[1]), 1, 60), tokenInt(args[0]), NEO_GRB + NEO_KHZ800);
    pixels->begin();
    pixels->clear();
    pixels->show();
  } else if (!strcmp(operation, "NEOSET") && count >= 4 && pixels) {
    pixels->setPixelColor(
      constrain(tokenInt(args[0]), 0, pixels->numPixels() - 1),
      pixels->Color(
        constrain(tokenInt(args[1]), 0, 255),
        constrain(tokenInt(args[2]), 0, 255),
        constrain(tokenInt(args[3]), 0, 255)
      )
    );
    pixels->show();
  } else if (!strcmp(operation, "NEOCLEAR") && pixels) {
    pixels->clear();
    pixels->show();
  } else if (!strcmp(operation, "MP3BEGIN") && count >= 2) {
    if (mp3Serial) delete mp3Serial;
    mp3Serial = new SoftwareSerial(tokenInt(args[0]), tokenInt(args[1]));
    mp3Serial->begin(9600);
  } else if (!strcmp(operation, "MP3PLAY") && count >= 1) {
    sendMp3Command(0x03, max(1, tokenInt(args[0])));
  } else if (!strcmp(operation, "MP3VOL") && count >= 1) {
    sendMp3Command(0x06, constrain(tokenInt(args[0]), 0, 30));
  } else if (!strcmp(operation, "MP3STOP")) {
    sendMp3Command(0x16, 0);
  } else if (!strcmp(operation, "BTBEGIN") && count >= 3) {
    if (bluetooth) delete bluetooth;
    bluetooth = new SoftwareSerial(tokenInt(args[0]), tokenInt(args[1]));
    bluetooth->begin(tokenInt(args[2], 9600));
  } else if (!strcmp(operation, "BTSEND") && count >= 1 && bluetooth) {
    bluetooth->listen();
    bluetooth->println(decodeHex(args[0]));
  } else if (!strcmp(operation, "PRINT") && count >= 1) {
    Serial.print(F("LOG,"));
    Serial.println(decodeHex(args[0]));
  } else if (!strcmp(operation, "STOP")) {
    stopOutputs();
  }
}

void processLine(char *line) {
  if (!strcmp(line, "PING")) {
    sendReady();
    return;
  }
  char *kind = strtok(line, ",");
  char *first = strtok(nullptr, ",");
  if (!kind || !first) return;
  if (!strcmp(kind, "Q")) {
    char *id = first;
    char *operation = strtok(nullptr, ",");
    char *args[6];
    uint8_t count = 0;
    while (count < 6 && (args[count] = strtok(nullptr, ","))) count++;
    handleQuery(id, operation, args, count);
  } else if (!strcmp(kind, "C")) {
    char *operation = first;
    char *args[7];
    uint8_t count = 0;
    while (count < 7 && (args[count] = strtok(nullptr, ","))) count++;
    handleCommand(operation, args, count);
  }
}

void setup() {
  Serial.begin(115200);
  delay(350);
  sendReady();
}

void loop() {
  while (Serial.available()) {
    char character = Serial.read();
    if (character == '\r') continue;
    if (character == '\n') {
      inputLine[inputLength] = 0;
      if (inputLength) processLine(inputLine);
      inputLength = 0;
    } else if (inputLength < MAX_LINE - 1) {
      inputLine[inputLength++] = character;
    } else {
      inputLength = 0;
      Serial.println(F("ERROR,line-too-long"));
    }
  }
}
