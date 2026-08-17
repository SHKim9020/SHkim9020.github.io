#include <Arduino.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Servo.h>
#include <SoftwareSerial.h>
#include <Adafruit_NeoPixel.h>

// OneMaker Arduino UNO/Nano Runtime 1.1.7
static const char *RUNTIME_VERSION = "1.1.7";
static const uint8_t MAX_LINE = 180;
static const uint8_t ONEMAKER_MAX_SERVOS = 4;
static const uint8_t MAX_TRACKED_MOTORS = 4;
static const uint8_t PROGRAM_HEADER_SIZE = 9;
static const uint8_t PROGRAM_MAGIC_0 = 0x4F;
static const uint8_t PROGRAM_MAGIC_1 = 0x4D;
static const uint8_t PROGRAM_FORMAT_VERSION = 1;
static const uint8_t VM_MAX_VARIABLES = 8;
static const uint8_t VM_MAX_STACK = 8;
static const uint8_t VM_MAX_REPEAT_DEPTH = 4;

enum StatementOpcode : uint8_t {
  OP_END = 0,
  OP_WAIT = 1,
  OP_SET_VAR = 2,
  OP_CHANGE_VAR = 3,
  OP_DIGITAL_WRITE = 4,
  OP_PWM_WRITE = 5,
  OP_MOTOR = 6,
  OP_SERVO = 7,
  OP_TONE = 8,
  OP_NO_TONE = 9,
  OP_LCD_BEGIN = 10,
  OP_LCD_PRINT = 11,
  OP_LCD_CLEAR = 12,
  OP_NEO_BEGIN = 13,
  OP_NEO_SET = 14,
  OP_NEO_CLEAR = 15,
  OP_MP3_BEGIN = 16,
  OP_MP3_PLAY = 17,
  OP_MP3_VOLUME = 18,
  OP_MP3_STOP = 19,
  OP_BT_BEGIN = 20,
  OP_BT_SEND = 21,
  OP_SERIAL_PRINT = 22,
  OP_JUMP = 23,
  OP_JUMP_IF_FALSE = 24,
  OP_REPEAT_START = 25,
  OP_REPEAT_END = 26,
  OP_BT_SEND_RAW = 27,
  OP_BT_SET_NAME = 28,
  OP_OLED_BEGIN = 29,
  OP_OLED_PRINT = 30,
  OP_OLED_CLEAR = 31,
  OP_HUSKY_ALGORITHM = 32
};

enum ExpressionOpcode : uint8_t {
  EX_NUMBER = 1,
  EX_TEXT = 2,
  EX_VARIABLE = 3,
  EX_ANALOG = 4,
  EX_DIGITAL = 5,
  EX_BUTTON = 6,
  EX_ULTRASONIC = 7,
  EX_DHT = 8,
  EX_DUST = 9,
  EX_BT_AVAILABLE = 10,
  EX_BT_READ = 11,
  EX_HUSKY_SEEN = 12,
  EX_HUSKY_X = 13,
  EX_HUSKY_Y = 14,
  EX_HUSKY_WIDTH = 15,
  EX_HUSKY_HEIGHT = 16,
  EX_ADD = 20,
  EX_SUBTRACT = 21,
  EX_MULTIPLY = 22,
  EX_DIVIDE = 23,
  EX_POWER = 24,
  EX_EQUAL = 30,
  EX_NOT_EQUAL = 31,
  EX_LESS = 32,
  EX_LESS_EQUAL = 33,
  EX_GREATER = 34,
  EX_GREATER_EQUAL = 35,
  EX_AND = 40,
  EX_OR = 41,
  EX_NOT = 42,
  EX_CONCAT = 43,
  EX_BT_ITEM = 44
};

struct VmValue {
  float number;
  String text;
  bool isText;
};

struct RepeatFrame {
  uint16_t bodyAddress;
  long remaining;
};

char inputLine[MAX_LINE];
uint8_t inputLength = 0;

Servo servos[ONEMAKER_MAX_SERVOS];
int8_t servoPins[ONEMAKER_MAX_SERVOS] = {-1, -1, -1, -1};
uint8_t motorPins[MAX_TRACKED_MOTORS] = {255, 255, 255, 255};
uint8_t motorPinCount = 0;
int8_t lastTonePin = -1;
float vmVariables[VM_MAX_VARIABLES] = {0};
RepeatFrame repeatFrames[VM_MAX_REPEAT_DEPTH];
uint8_t repeatDepth = 0;
bool storedProgramValid = false;
bool storedSetupComplete = false;
uint16_t storedProgramLength = 0;
uint16_t storedSetupLength = 0;
uint16_t vmProgramCounter = 0;
unsigned long vmWaitUntil = 0;

uint16_t incomingProgramLength = 0;
uint16_t incomingSetupLength = 0;
uint16_t incomingChecksum = 0;
bool receivingProgram = false;

uint8_t lcdAddress = 0x27;
uint8_t lcdColumns = 16;
bool lcdReady = false;
uint8_t oledAddress = 0x3C;
bool oledReady = false;
uint8_t oledScale = 1;
Adafruit_NeoPixel *pixels = nullptr;
SoftwareSerial *bluetooth = nullptr;
SoftwareSerial *mp3Serial = nullptr;

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
  Serial.print(F("READY,OM,"));
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

void sendHuskyCommand(uint8_t command, int16_t value) {
  uint8_t frame[8] = {0x55, 0xAA, 0x11, 2, command, (uint8_t)value, (uint8_t)(value >> 8), 0};
  for (uint8_t index = 0; index < 7; index++) frame[7] += frame[index];
  Wire.begin();
  Wire.beginTransmission(0x32);
  Wire.write(frame, 8);
  Wire.endTransmission();
}

bool readHuskyFrame(uint8_t expectedCommand, int16_t values[5]) {
  for (uint8_t attempt = 0; attempt < 12; attempt++) {
    delay(5);
    Wire.requestFrom((uint8_t)0x32, (uint8_t)16);
    if (Wire.available() < 6) continue;
    bool matches = Wire.read() == 0x55;
    matches = Wire.read() == 0xAA && matches;
    matches = Wire.read() == 0x11 && matches;
    uint8_t valueCount = min((uint8_t)5, (uint8_t)(Wire.read() / 2));
    matches = Wire.read() == expectedCommand && matches;
    for (uint8_t index = 0; index < valueCount; index++) {
      uint8_t low = Wire.read();
      values[index] = low | ((int16_t)Wire.read() << 8);
    }
    while (Wire.available()) Wire.read();
    if (matches) return true;
  }
  return false;
}

void setHuskyAlgorithm(uint8_t algorithm) {
  sendHuskyCommand(0x2D, constrain(algorithm, 0, 6));
  delay(300);
}

bool fetchHuskyValue(int16_t id, uint8_t field, int16_t &value) {
  sendHuskyCommand(0x27, id);
  int16_t values[5];
  if (!readHuskyFrame(0x29, values) || values[0] < 1) return false;
  if (!readHuskyFrame(0x2A, values) || values[4] != id) return false;
  value = field ? values[field - 1] : 1;
  return true;
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

bool initializeMp3(uint8_t rx, uint8_t tx) {
  if (rx == tx) return false;
  if (mp3Serial) delete mp3Serial;
  mp3Serial = new SoftwareSerial(rx, tx);
  if (!mp3Serial) return false;
  mp3Serial->begin(9600);
  mp3Serial->listen();
  delay(100);
  sendMp3Command(0x0C, 0);  // Reset, matching DFRobotDFPlayerMini begin().
  delay(2200);              // DFPlayer and microSD cold-start time.
  sendMp3Command(0x09, 2);  // Select TF/microSD card as the playback source.
  delay(300);
  return true;
}

uint8_t programByte(uint16_t address) {
  if (address >= storedProgramLength) return 0;
  return EEPROM.read(PROGRAM_HEADER_SIZE + address);
}

// Tiny 3x5 digit font keeps the UNO/Nano runtime inside 32 KB flash.
// Entries are three vertical columns, least-significant bit at the top.
const uint8_t OLED_FONT_3X5[][3] PROGMEM = {
  {31,17,31},{0,31,0},{29,21,23},{21,21,31},{7,4,31},
  {23,21,29},{31,21,29},{1,1,31},{31,21,31},{23,21,31}
};

void oledCommand(uint8_t command) {
  Wire.beginTransmission(oledAddress);
  Wire.write(0x00);
  Wire.write(command);
  Wire.endTransmission();
}

void oledRawCursor(uint8_t x, uint8_t page) {
  oledCommand(0xB0 | page);
  oledCommand(x & 0x0F);
  oledCommand(0x10 | (x >> 4));
}

void oledClear() {
  if (!oledReady) return;
  for (uint8_t page = 0; page < 8; page++) {
    oledRawCursor(0, page);
    for (uint8_t chunk = 0; chunk < 8; chunk++) {
      Wire.beginTransmission(oledAddress);
      Wire.write(0x40);
      for (uint8_t index = 0; index < 16; index++) Wire.write(0);
      Wire.endTransmission();
    }
  }
  oledRawCursor(0, 0);
}

void oledBegin(uint8_t address, uint8_t scale) {
  static const uint8_t initCommands[] PROGMEM = {
    0xAE,0xD5,0x80,0xA8,0x3F,0xD3,0x00,0x40,0x8D,0x14,0x20,0x02,
    0xA1,0xC8,0xDA,0x12,0x81,0xCF,0xD9,0xF1,0xDB,0x40,0xA4,0xA6,0xAF
  };
  oledAddress = address;
  oledScale = scale == 2 ? 2 : 1;
  Wire.begin();
  for (uint8_t index = 0; index < sizeof(initCommands); index++) oledCommand(pgm_read_byte(&initCommands[index]));
  oledReady = true;
  oledClear();
}

void oledPrint(const String &value, uint8_t column, uint8_t row) {
  if (!oledReady) return;
  uint8_t x = constrain(column, 0, 15) * 4 * oledScale;
  uint8_t page = oledScale == 2 ? constrain(row, 0, 3) * 2 : constrain(row, 0, 7);
  oledRawCursor(x, page);
  for (uint8_t index = 0; index < value.length(); index++) {
    char character = value[index];
    uint8_t glyph[3] = {0, 0, 0};
    if (character >= '0' && character <= '9') {
      for (uint8_t column = 0; column < 3; column++) glyph[column] = pgm_read_byte(&OLED_FONT_3X5[character - '0'][column]);
    } else if (character == '-') glyph[0] = glyph[1] = glyph[2] = 4;
    else if (character == '.') glyph[1] = 16;
    else if (character == ':') glyph[1] = 10;
    else if (character == '%') { glyph[0] = 25; glyph[1] = 4; glyph[2] = 19; }
    if (oledScale == 1) {
      Wire.beginTransmission(oledAddress);
      Wire.write(0x40);
      Wire.write(glyph, 3);
      Wire.write(0);
      Wire.endTransmission();
    } else {
      for (uint8_t half = 0; half < 2; half++) {
        oledRawCursor(x, page + half);
        Wire.beginTransmission(oledAddress);
        Wire.write(0x40);
        for (uint8_t column = 0; column < 3; column++) {
          uint8_t expanded = glyph[column] & 15;
          expanded = (expanded | expanded << 2) & 0x33;
          expanded = (expanded | expanded << 1) & 0x55;
          expanded |= expanded << 1;
          if (half) expanded = glyph[column] & 16 ? 3 : 0;
          Wire.write(expanded);
          Wire.write(expanded);
        }
        Wire.write(0); Wire.write(0);
        Wire.endTransmission();
      }
      x += 8;
    }
  }
}

void neoSet(int index, int red, int green, int blue) {
  if (!pixels || !pixels->numPixels()) return;
  uint8_t first = index == 255 ? 0 : constrain(index, 0, pixels->numPixels() - 1);
  uint8_t end = index == 255 ? pixels->numPixels() : first + 1;
  uint32_t color = pixels->Color(constrain(red, 0, 255), constrain(green, 0, 255), constrain(blue, 0, 255));
  while (first < end) pixels->setPixelColor(first++, color);
  pixels->show();
}

void lcdExpander(uint8_t value) {
  Wire.beginTransmission(lcdAddress);
  Wire.write(value | 0x08); // Backlight on.
  Wire.endTransmission();
}

void lcdPulse(uint8_t value) {
  lcdExpander(value | 0x04);
  delayMicroseconds(1);
  lcdExpander(value & ~0x04);
  delayMicroseconds(50);
}

void lcdWrite4(uint8_t value, uint8_t mode = 0) {
  uint8_t output = (value & 0xF0) | mode;
  lcdExpander(output);
  lcdPulse(output);
}

void lcdSend(uint8_t value, uint8_t mode = 0) {
  lcdWrite4(value, mode);
  lcdWrite4(value << 4, mode);
}

void lcdClear() {
  if (!lcdReady) return;
  lcdSend(0x01);
  delayMicroseconds(2000);
}

void lcdBegin(uint8_t address, uint8_t columns, uint8_t rows) {
  lcdAddress = address;
  lcdColumns = columns;
  Wire.begin();
  delay(50);
  lcdWrite4(0x30); delayMicroseconds(4500);
  lcdWrite4(0x30); delayMicroseconds(4500);
  lcdWrite4(0x30); delayMicroseconds(150);
  lcdWrite4(0x20);
  lcdSend(rows > 1 ? 0x28 : 0x20);
  lcdSend(0x0C);
  lcdSend(0x06);
  lcdReady = true;
  lcdClear();
}

void lcdSetCursor(uint8_t column, uint8_t row) {
  static const uint8_t rowOffsets[] = {0x00, 0x40, 0x14, 0x54};
  lcdSend(0x80 | (constrain(column, 0, lcdColumns - 1) + rowOffsets[constrain(row, 0, 3)]));
}

void lcdPrint(const String &value) {
  if (!lcdReady) return;
  for (uint8_t index = 0; index < value.length(); index++) lcdSend(value[index], 0x01);
}

uint16_t programWord(uint16_t &address) {
  uint16_t value = programByte(address++);
  value |= (uint16_t)programByte(address++) << 8;
  return value;
}

float programFloat(uint16_t &address) {
  union {
    float value;
    uint8_t bytes[4];
  } data;
  for (uint8_t index = 0; index < 4; index++) data.bytes[index] = programByte(address++);
  return data.value;
}

VmValue numberValue(float value) {
  VmValue result;
  result.number = value;
  result.isText = false;
  return result;
}

VmValue textValue(const String &value) {
  VmValue result;
  result.number = value.toFloat();
  result.text = value;
  result.isText = true;
  return result;
}

long clampLong(long value, long minimum, long maximum) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

float nonNegative(float value) {
  return value < 0 ? 0 : value;
}

float vmPower(float base, float exponent) {
  long power = (long)exponent;
  if (fabs(exponent - power) > 0.00001f) return 0;
  bool inverse = power < 0;
  if (inverse) power = -power;
  float result = 1;
  while (power) {
    if (power & 1) result *= base;
    base *= base;
    power >>= 1;
  }
  return inverse && fabs(result) > 0.00001f ? 1.0f / result : (inverse ? 0 : result);
}

float valueNumber(const VmValue &value) {
  return value.isText ? value.text.toFloat() : value.number;
}

bool valueBoolean(const VmValue &value) {
  return value.isText ? value.text.length() > 0 : fabs(value.number) > 0.00001f;
}

String valueText(const VmValue &value) {
  if (value.isText) return value.text;
  float rounded = round(value.number);
  if (fabs(value.number - rounded) < 0.001f) return String((long)rounded);
  String result(value.number, 2);
  while (result.endsWith("0")) result.remove(result.length() - 1);
  if (result.endsWith(".")) result.remove(result.length() - 1);
  return result;
}

float readDhtValue(uint8_t pin, uint8_t type, bool humidity) {
  uint8_t data[5] = {0, 0, 0, 0, 0};
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delay(type == 22 ? 2 : 20);
  digitalWrite(pin, HIGH);
  delayMicroseconds(30);
  pinMode(pin, INPUT_PULLUP);
  if (!pulseIn(pin, LOW, 1000UL) || !pulseIn(pin, HIGH, 1000UL)) return -999;
  for (uint8_t bit = 0; bit < 40; bit++) {
    if (!pulseIn(pin, LOW, 1000UL)) return -999;
    unsigned long highTime = pulseIn(pin, HIGH, 1000UL);
    if (!highTime) return -999;
    data[bit >> 3] <<= 1;
    if (highTime > 40) data[bit >> 3] |= 1;
  }
  if ((uint8_t)(data[0] + data[1] + data[2] + data[3]) != data[4]) return -999;
  if (type == 22) {
    uint16_t raw = ((uint16_t)data[humidity ? 0 : 2] << 8) | data[humidity ? 1 : 3];
    float value = (raw & 0x7FFF) * 0.1f;
    return (!humidity && (raw & 0x8000)) ? -value : value;
  }
  return humidity ? data[0] + data[1] * 0.1f : data[2] + data[3] * 0.1f;
}

String readBluetoothText() {
  String value;
  if (!bluetooth) return value;
  bluetooth->listen();
  unsigned long started = millis();
  while (millis() - started < 80) {
    while (bluetooth->available()) {
      char character = bluetooth->read();
      if (character == '\r' || character == '\n') {
        if (value.length()) return value;
      } else {
        value += character;
      }
    }
  }
  return value;
}

void setBluetoothName(const String &name, uint8_t mode) {
  if (!bluetooth || !name.length()) return;
  bluetooth->listen();
  if (mode == 1) {
    bluetooth->print(F("AT+NAME="));
    bluetooth->print(name);
    bluetooth->print(F("\r\n"));
  } else {
    bluetooth->print(F("AT+NAME"));
    bluetooth->print(name);
  }
  delay(1000);
}

VmValue evaluateStoredExpression(uint16_t &address) {
  uint8_t expressionLength = programByte(address++);
  uint16_t expressionEnd = address + expressionLength;
  VmValue stack[VM_MAX_STACK];
  uint8_t stackSize = 0;

  while (address < expressionEnd) {
    uint8_t opcode = programByte(address++);
    if (opcode == EX_NUMBER) {
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(programFloat(address));
    } else if (opcode == EX_TEXT) {
      uint8_t length = programByte(address++);
      String value;
      value.reserve(length);
      while (length-- && address < expressionEnd) value += (char)programByte(address++);
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = textValue(value);
    } else if (opcode == EX_VARIABLE) {
      uint8_t index = programByte(address++);
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(index < VM_MAX_VARIABLES ? vmVariables[index] : 0);
    } else if (opcode == EX_ANALOG) {
      uint8_t analogPin = programByte(address++);
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(analogRead(A0 + clampLong(analogPin, 0, 5)));
    } else if (opcode == EX_DIGITAL) {
      uint8_t pin = programByte(address++);
      pinMode(pin, INPUT);
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(digitalRead(pin));
    } else if (opcode == EX_BUTTON) {
      uint8_t pin = programByte(address++);
      pinMode(pin, INPUT);
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(digitalRead(pin) == HIGH ? 1 : 0);
    } else if (opcode == EX_ULTRASONIC) {
      uint8_t trig = programByte(address++);
      uint8_t echo = programByte(address++);
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(readUltrasonic(trig, echo));
    } else if (opcode == EX_DHT) {
      uint8_t pin = programByte(address++);
      uint8_t type = programByte(address++);
      bool humidity = programByte(address++) != 0;
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(readDhtValue(pin, type, humidity));
    } else if (opcode == EX_DUST) {
      uint8_t ledPin = programByte(address++);
      uint8_t analogPin = programByte(address++);
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(readDust(ledPin, analogPin));
    } else if (opcode == EX_BT_AVAILABLE) {
      if (bluetooth) bluetooth->listen();
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = numberValue(bluetooth && bluetooth->available() ? 1 : 0);
    } else if (opcode == EX_BT_READ) {
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = textValue(readBluetoothText());
    } else if (opcode >= EX_HUSKY_SEEN && opcode <= EX_HUSKY_HEIGHT && stackSize >= 1) {
      int16_t id = constrain((int)valueNumber(stack[stackSize - 1]), 0, 32767);
      int16_t value = 0;
      uint8_t field = opcode == EX_HUSKY_SEEN ? 0 : opcode - EX_HUSKY_SEEN;
      bool seen = fetchHuskyValue(id, field, value);
      stack[stackSize - 1] = numberValue(seen ? value : 0);
    } else if (opcode == EX_NOT && stackSize >= 1) {
      stack[stackSize - 1] = numberValue(!valueBoolean(stack[stackSize - 1]));
    } else if (stackSize >= 2) {
      VmValue right = stack[--stackSize];
      VmValue left = stack[--stackSize];
      VmValue result = numberValue(0);
      float a = valueNumber(left);
      float b = valueNumber(right);
      switch (opcode) {
        case EX_ADD: result = numberValue(a + b); break;
        case EX_SUBTRACT: result = numberValue(a - b); break;
        case EX_MULTIPLY: result = numberValue(a * b); break;
        case EX_DIVIDE: result = numberValue(fabs(b) < 0.00001f ? 0 : a / b); break;
        case EX_POWER: result = numberValue(vmPower(a, b)); break;
        case EX_EQUAL:
          result = numberValue(left.isText || right.isText ? valueText(left) == valueText(right) : fabs(a - b) < 0.00001f);
          break;
        case EX_NOT_EQUAL:
          result = numberValue(left.isText || right.isText ? valueText(left) != valueText(right) : fabs(a - b) >= 0.00001f);
          break;
        case EX_LESS: result = numberValue(a < b); break;
        case EX_LESS_EQUAL: result = numberValue(a <= b); break;
        case EX_GREATER: result = numberValue(a > b); break;
        case EX_GREATER_EQUAL: result = numberValue(a >= b); break;
        case EX_AND: result = numberValue(valueBoolean(left) && valueBoolean(right)); break;
        case EX_OR: result = numberValue(valueBoolean(left) || valueBoolean(right)); break;
        case EX_CONCAT: result = textValue(valueText(left) + valueText(right)); break;
        case EX_BT_ITEM: {
          int count = constrain((int)a, 1, 64);
          int index = constrain((int)b, 1, count);
          String value = readBluetoothText();
          value = value.substring(0, min(count, (int)value.length()));
          result = index <= value.length() ? textValue(value.substring(index - 1, index)) : textValue("");
          break;
        }
        default: break;
      }
      if (stackSize < VM_MAX_STACK) stack[stackSize++] = result;
    }
  }
  address = expressionEnd;
  return stackSize ? stack[stackSize - 1] : numberValue(0);
}

uint16_t storedProgramChecksum(uint16_t length) {
  uint16_t checksum = 0;
  for (uint16_t index = 0; index < length; index++) checksum += EEPROM.read(PROGRAM_HEADER_SIZE + index);
  return checksum;
}

void loadStoredProgram() {
  storedProgramValid = false;
  storedProgramLength = EEPROM.read(3) | ((uint16_t)EEPROM.read(4) << 8);
  storedSetupLength = EEPROM.read(5) | ((uint16_t)EEPROM.read(6) << 8);
  uint16_t checksum = EEPROM.read(7) | ((uint16_t)EEPROM.read(8) << 8);
  if (EEPROM.read(0) != PROGRAM_MAGIC_0 || EEPROM.read(1) != PROGRAM_MAGIC_1
      || EEPROM.read(2) != PROGRAM_FORMAT_VERSION) return;
  if (!storedProgramLength || storedProgramLength > EEPROM.length() - PROGRAM_HEADER_SIZE
      || storedSetupLength > storedProgramLength) return;
  if (storedProgramChecksum(storedProgramLength) != checksum) return;
  memset(vmVariables, 0, sizeof(vmVariables));
  repeatDepth = 0;
  vmWaitUntil = 0;
  storedSetupComplete = storedSetupLength == 0;
  vmProgramCounter = storedSetupComplete ? storedSetupLength : 0;
  storedProgramValid = true;
}

void stopOutputs() {
  for (uint8_t index = 0; index < motorPinCount; index++) analogWrite(motorPins[index], 0);
  if (lastTonePin >= 0) noTone(lastTonePin);
  if (mp3Serial) sendMp3Command(0x16, 0);
}

void executeStoredProgramStep() {
  if (!storedProgramValid) return;
  if (vmWaitUntil && (long)(millis() - vmWaitUntil) < 0) return;
  vmWaitUntil = 0;

  uint16_t segmentEnd = storedSetupComplete ? storedProgramLength : storedSetupLength;
  if (vmProgramCounter >= segmentEnd) {
    repeatDepth = 0;
    if (!storedSetupComplete) {
      storedSetupComplete = true;
      vmProgramCounter = storedSetupLength;
    } else {
      vmProgramCounter = storedSetupLength;
    }
    if (vmProgramCounter >= storedProgramLength) return;
  }

  uint8_t opcode = programByte(vmProgramCounter++);
  if (opcode == OP_END) {
    vmProgramCounter = segmentEnd;
  } else if (opcode == OP_WAIT) {
    float seconds = valueNumber(evaluateStoredExpression(vmProgramCounter));
    unsigned long milliseconds = nonNegative(seconds) * 1000.0f;
    vmWaitUntil = millis() + milliseconds;
  } else if (opcode == OP_SET_VAR || opcode == OP_CHANGE_VAR) {
    uint8_t index = programByte(vmProgramCounter++);
    float value = valueNumber(evaluateStoredExpression(vmProgramCounter));
    if (index < VM_MAX_VARIABLES) {
      if (opcode == OP_SET_VAR) vmVariables[index] = value;
      else vmVariables[index] += value;
    }
  } else if (opcode == OP_DIGITAL_WRITE) {
    uint8_t pin = programByte(vmProgramCounter++);
    uint8_t state = programByte(vmProgramCounter++);
    pinMode(pin, OUTPUT);
    digitalWrite(pin, state ? HIGH : LOW);
  } else if (opcode == OP_PWM_WRITE) {
    uint8_t pin = programByte(vmProgramCounter++);
    pinMode(pin, OUTPUT);
    long value = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    analogWrite(pin, clampLong(value, 0, 255));
  } else if (opcode == OP_MOTOR) {
    uint8_t pin1 = programByte(vmProgramCounter++);
    uint8_t pin2 = programByte(vmProgramCounter++);
    long speed = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    setMotor(pin1, pin2, clampLong(speed, -255, 255));
  } else if (opcode == OP_SERVO) {
    uint8_t pin = programByte(vmProgramCounter++);
    Servo *servo = servoForPin(pin);
    long angle = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    if (servo) servo->write(clampLong(angle, 0, 180));
  } else if (opcode == OP_TONE) {
    uint8_t pin = programByte(vmProgramCounter++);
    long frequencyValue = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    int frequency = clampLong(frequencyValue, 20, 20000);
    float seconds = valueNumber(evaluateStoredExpression(vmProgramCounter));
    unsigned long duration = nonNegative(seconds) * 1000.0f;
    lastTonePin = pin;
    tone(pin, frequency, max(1UL, duration));
  } else if (opcode == OP_NO_TONE) {
    noTone(programByte(vmProgramCounter++));
  } else if (opcode == OP_LCD_BEGIN) {
    uint8_t address = programByte(vmProgramCounter++);
    uint8_t columns = programByte(vmProgramCounter++);
    uint8_t rows = programByte(vmProgramCounter++);
    lcdBegin(address, columns, rows);
  } else if (opcode == OP_LCD_PRINT) {
    long rowValue = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    long columnValue = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    uint8_t row = clampLong(rowValue, 0, 3);
    uint8_t column = clampLong(columnValue, 0, 19);
    String value = valueText(evaluateStoredExpression(vmProgramCounter));
    if (lcdReady) { lcdSetCursor(column, row); lcdPrint(value); }
  } else if (opcode == OP_LCD_CLEAR) {
    lcdClear();
  } else if (opcode == OP_OLED_BEGIN) {
    uint8_t address = programByte(vmProgramCounter++);
    oledBegin(address, programByte(vmProgramCounter++));
  } else if (opcode == OP_OLED_PRINT) {
    long row = clampLong((long)valueNumber(evaluateStoredExpression(vmProgramCounter)), 0, 7);
    long column = clampLong((long)valueNumber(evaluateStoredExpression(vmProgramCounter)), 0, 15);
    String value = valueText(evaluateStoredExpression(vmProgramCounter));
    oledPrint(value, column, row);
  } else if (opcode == OP_OLED_CLEAR) {
    oledClear();
  } else if (opcode == OP_HUSKY_ALGORITHM) {
    setHuskyAlgorithm(programByte(vmProgramCounter++));
  } else if (opcode == OP_NEO_BEGIN) {
    uint8_t pin = programByte(vmProgramCounter++);
    long countValue = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    uint8_t count = clampLong(countValue, 1, 60);
    if (pixels) delete pixels;
    pixels = new Adafruit_NeoPixel(count, pin, NEO_GRB + NEO_KHZ800);
    pixels->begin();
    pixels->clear();
    pixels->show();
  } else if (opcode == OP_NEO_SET) {
    int index = valueNumber(evaluateStoredExpression(vmProgramCounter));
    int red = valueNumber(evaluateStoredExpression(vmProgramCounter));
    int green = valueNumber(evaluateStoredExpression(vmProgramCounter));
    int blue = valueNumber(evaluateStoredExpression(vmProgramCounter));
    neoSet(index, red, green, blue);
  } else if (opcode == OP_NEO_CLEAR) {
    if (pixels) {
      pixels->clear();
      pixels->show();
    }
  } else if (opcode == OP_MP3_BEGIN) {
    uint8_t rx = programByte(vmProgramCounter++);
    uint8_t tx = programByte(vmProgramCounter++);
    long volume = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    if (initializeMp3(rx, tx)) sendMp3Command(0x06, clampLong(volume, 0, 30));
  } else if (opcode == OP_MP3_PLAY) {
    long track = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    sendMp3Command(0x03, track < 1 ? 1 : track);
  } else if (opcode == OP_MP3_VOLUME) {
    long volume = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    sendMp3Command(0x06, clampLong(volume, 0, 30));
  } else if (opcode == OP_MP3_STOP) {
    sendMp3Command(0x16, 0);
  } else if (opcode == OP_BT_BEGIN) {
    uint8_t rx = programByte(vmProgramCounter++);
    uint8_t tx = programByte(vmProgramCounter++);
    uint16_t baud = programWord(vmProgramCounter);
    if (bluetooth) delete bluetooth;
    bluetooth = new SoftwareSerial(rx, tx);
    bluetooth->begin(baud);
  } else if (opcode == OP_BT_SEND) {
    if (bluetooth) {
      bluetooth->listen();
      bluetooth->println(valueText(evaluateStoredExpression(vmProgramCounter)));
    } else {
      evaluateStoredExpression(vmProgramCounter);
    }
  } else if (opcode == OP_BT_SEND_RAW) {
    if (bluetooth) {
      bluetooth->listen();
      bluetooth->print(valueText(evaluateStoredExpression(vmProgramCounter)));
    } else {
      evaluateStoredExpression(vmProgramCounter);
    }
  } else if (opcode == OP_BT_SET_NAME) {
    uint8_t mode = programByte(vmProgramCounter++);
    setBluetoothName(valueText(evaluateStoredExpression(vmProgramCounter)), mode);
  } else if (opcode == OP_SERIAL_PRINT) {
    Serial.print(F("LOG,"));
    Serial.println(valueText(evaluateStoredExpression(vmProgramCounter)));
  } else if (opcode == OP_JUMP) {
    vmProgramCounter = programWord(vmProgramCounter);
  } else if (opcode == OP_JUMP_IF_FALSE) {
    bool condition = valueBoolean(evaluateStoredExpression(vmProgramCounter));
    uint16_t target = programWord(vmProgramCounter);
    if (!condition) vmProgramCounter = target;
  } else if (opcode == OP_REPEAT_START) {
    long count = (long)valueNumber(evaluateStoredExpression(vmProgramCounter));
    if (count < 0) count = 0;
    uint16_t endAddress = programWord(vmProgramCounter);
    if (!count) {
      vmProgramCounter = endAddress;
    } else if (repeatDepth < VM_MAX_REPEAT_DEPTH) {
      repeatFrames[repeatDepth].bodyAddress = vmProgramCounter;
      repeatFrames[repeatDepth].remaining = count;
      repeatDepth++;
    } else {
      vmProgramCounter = endAddress;
    }
  } else if (opcode == OP_REPEAT_END) {
    uint16_t bodyAddress = programWord(vmProgramCounter);
    if (repeatDepth && --repeatFrames[repeatDepth - 1].remaining > 0) {
      vmProgramCounter = bodyAddress;
    } else if (repeatDepth) {
      repeatDepth--;
    }
  } else {
    storedProgramValid = false;
  }
}

void handleProgramCommand(char *operation, char **args, uint8_t count) {
  if (!operation) return;
  if (!strcmp(operation, "BEGIN") && count >= 3) {
    incomingProgramLength = tokenInt(args[0]);
    incomingSetupLength = tokenInt(args[1]);
    incomingChecksum = tokenInt(args[2]);
    receivingProgram = incomingProgramLength > 0
      && incomingProgramLength <= EEPROM.length() - PROGRAM_HEADER_SIZE
      && incomingSetupLength <= incomingProgramLength;
    storedProgramValid = false;
    EEPROM.update(0, 0);
    if (receivingProgram) Serial.println(F("PROGRAM_READY"));
  } else if (!strcmp(operation, "DATA") && count >= 2 && receivingProgram) {
    uint16_t offset = tokenInt(args[0]);
    const char *hex = args[1];
    uint16_t byteCount = strlen(hex) / 2;
    if (offset + byteCount > incomingProgramLength) {
      receivingProgram = false;
      return;
    }
    for (uint16_t index = 0; index < byteCount; index++) {
      char byteText[3] = {hex[index * 2], hex[index * 2 + 1], 0};
      EEPROM.update(PROGRAM_HEADER_SIZE + offset + index, strtoul(byteText, nullptr, 16));
    }
    Serial.print(F("PROGRAM_DATA,"));
    Serial.println(offset + byteCount);
  } else if (!strcmp(operation, "SAVE") && receivingProgram) {
    if (storedProgramChecksum(incomingProgramLength) != incomingChecksum) {
      receivingProgram = false;
      return;
    }
    EEPROM.update(1, PROGRAM_MAGIC_1);
    EEPROM.update(2, PROGRAM_FORMAT_VERSION);
    EEPROM.update(3, incomingProgramLength & 0xFF);
    EEPROM.update(4, incomingProgramLength >> 8);
    EEPROM.update(5, incomingSetupLength & 0xFF);
    EEPROM.update(6, incomingSetupLength >> 8);
    EEPROM.update(7, incomingChecksum & 0xFF);
    EEPROM.update(8, incomingChecksum >> 8);
    EEPROM.update(0, PROGRAM_MAGIC_0);
    receivingProgram = false;
    stopOutputs();
    loadStoredProgram();
    Serial.print(F("SAVED,"));
    Serial.println(storedProgramLength);
  } else if (!strcmp(operation, "RUN")) {
    stopOutputs();
    loadStoredProgram();
    Serial.println(storedProgramValid ? F("OK") : F("ERR"));
  } else if (!strcmp(operation, "CLEAR")) {
    EEPROM.update(0, 0);
    storedProgramValid = false;
    stopOutputs();
    Serial.println(F("OK"));
  }
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
    pinMode(pin, INPUT);
    sendNumber(id, digitalRead(pin) == HIGH ? 1 : 0);
  } else if (!strcmp(operation, "SONAR") && count >= 2) {
    sendNumber(id, readUltrasonic(tokenInt(args[0]), tokenInt(args[1])));
  } else if (!strcmp(operation, "DUST") && count >= 2) {
    sendNumber(id, readDust(tokenInt(args[0]), tokenInt(args[1])));
  } else if (!strcmp(operation, "DHT") && count >= 3) {
    uint8_t pin = tokenInt(args[0]);
    sendNumber(id, readDhtValue(pin, tokenInt(args[1]), tokenInt(args[2]) != 0));
  } else if (!strcmp(operation, "HUSKY") && count >= 2) {
    int16_t value = 0;
    fetchHuskyValue(constrain(tokenInt(args[0]), 0, 32767), constrain(tokenInt(args[1]), 0, 4), value);
    sendNumber(id, value);
  } else if (!strcmp(operation, "BTAVAIL")) {
    if (bluetooth) bluetooth->listen();
    sendNumber(id, bluetooth && bluetooth->available() ? 1 : 0);
  } else if (!strcmp(operation, "BTREAD")) {
    sendText(id, readBluetoothText());
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
    lcdBegin(tokenInt(args[0]), tokenInt(args[1]), tokenInt(args[2]));
  } else if (!strcmp(operation, "LCDPRINT") && count >= 3 && lcdReady) {
    lcdSetCursor(tokenInt(args[1]), tokenInt(args[0]));
    lcdPrint(decodeHex(args[2]));
  } else if (!strcmp(operation, "LCDCLEAR") && lcdReady) {
    lcdClear();
  } else if (!strcmp(operation, "OLEDBEGIN") && count >= 2) {
    oledBegin(tokenInt(args[0], 60), tokenInt(args[1], 1));
  } else if (!strcmp(operation, "OLEDPRINT") && count >= 3 && oledReady) {
    oledPrint(decodeHex(args[2]), tokenInt(args[1]), tokenInt(args[0]));
  } else if (!strcmp(operation, "OLEDCLEAR") && oledReady) {
    oledClear();
  } else if (!strcmp(operation, "HUSKYALG") && count >= 1) {
    setHuskyAlgorithm(constrain(tokenInt(args[0]), 0, 6));
  } else if (!strcmp(operation, "NEOBEGIN") && count >= 2) {
    if (pixels) delete pixels;
    pixels = new Adafruit_NeoPixel(constrain(tokenInt(args[1]), 1, 60), tokenInt(args[0]), NEO_GRB + NEO_KHZ800);
    pixels->begin();
    pixels->clear();
    pixels->show();
  } else if (!strcmp(operation, "NEOSET") && count >= 4 && pixels) {
    neoSet(tokenInt(args[0]), tokenInt(args[1]), tokenInt(args[2]), tokenInt(args[3]));
  } else if (!strcmp(operation, "NEOCLEAR") && pixels) {
    pixels->clear();
    pixels->show();
  } else if (!strcmp(operation, "MP3BEGIN") && count >= 2) {
    int volume = count >= 3 ? constrain(tokenInt(args[2]), 0, 30) : 20;
    if (initializeMp3(tokenInt(args[0]), tokenInt(args[1]))) {
      sendMp3Command(0x06, volume);
      Serial.println(F("MP3_READY"));
    }
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
  } else if (!strcmp(operation, "BTRAW") && count >= 1 && bluetooth) {
    bluetooth->listen();
    bluetooth->print(decodeHex(args[0]));
  } else if (!strcmp(operation, "BTNAME") && count >= 2) {
    setBluetoothName(decodeHex(args[1]), constrain(tokenInt(args[0]), 0, 1));
  } else if (!strcmp(operation, "PRINT") && count >= 1) {
    Serial.print(F("LOG,"));
    Serial.println(decodeHex(args[0]));
  } else if (!strcmp(operation, "STOP")) {
    storedProgramValid = false;
    vmWaitUntil = 0;
    repeatDepth = 0;
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
  } else if (!strcmp(kind, "P")) {
    char *operation = first;
    char *args[4];
    uint8_t count = 0;
    while (count < 4 && (args[count] = strtok(nullptr, ","))) count++;
    handleProgramCommand(operation, args, count);
  }
}

void setup() {
  Serial.begin(115200);
  delay(350);
  sendReady();
  loadStoredProgram();
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
    } else inputLength = 0;
  }
  executeStoredProgramStep();
}
