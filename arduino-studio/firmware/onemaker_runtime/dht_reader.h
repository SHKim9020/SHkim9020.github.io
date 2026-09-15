// Read the CURRENT pulse; pulseIn skips a pulse already in progress.
static uint16_t dhtPulse(uint8_t pin, uint8_t level) {
  uint16_t cycles = 0;
  while (digitalRead(pin) == level) {
    if (++cycles == 1000) return 0;
  }
  return cycles;
}

float readDhtValue(uint8_t pin, uint8_t type, bool humidity) {
  struct Cache {
    uint32_t sampled;
    float temperature, humidity;
    uint8_t pin, type;
    bool used;
  };
  static Cache cache[4] = {};
  static uint8_t next = 0;
  if (pin >= NUM_DIGITAL_PINS || (type != 11 && type != 22)) return -999;
  Cache *entry = 0;
  for (uint8_t i = 0; i < 4; ++i) {
    if (cache[i].used && cache[i].pin == pin) { entry = &cache[i]; break; }
  }
  if (!entry) {
    entry = &cache[next];
    next = (next + 1) % 4;
    entry->used = true;
    entry->pin = pin;
    entry->type = type;
    entry->temperature = entry->humidity = -999;
    // Allow sensor power-up, also safe when revisiting an evicted pin.
    pinMode(pin, INPUT_PULLUP);
    delay(2000);
  } else if ((uint32_t)(millis() - entry->sampled) < 2000UL) {
    if (entry->type != type) return -999;
    return humidity ? entry->humidity : entry->temperature;
  }
  entry->type = type;
  entry->sampled = millis();
  entry->temperature = entry->humidity = -999;
  uint8_t data[5] = {};
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delay(type == 22 ? 2 : 20);
  uint8_t savedSreg = SREG;
  noInterrupts();
  digitalWrite(pin, HIGH);
  delayMicroseconds(30);
  pinMode(pin, INPUT_PULLUP);
  // We may still be in the host release high, or already in response low.
  dhtPulse(pin, HIGH);
  bool ok = dhtPulse(pin, LOW) && dhtPulse(pin, HIGH);
  for (uint8_t bit = 0; ok && bit < 40; ++bit) {
    uint16_t low = dhtPulse(pin, LOW);
    uint16_t high = dhtPulse(pin, HIGH);
    ok = low && high;
    data[bit >> 3] = (data[bit >> 3] << 1) | (high > low);
  }
  SREG = savedSreg;
  if (!ok || (uint8_t)(data[0] + data[1] + data[2] + data[3]) != data[4]) return -999;
  if (type == 22) {
    entry->humidity = (((uint16_t)data[0] << 8) | data[1]) * 0.1f;
    entry->temperature = (((uint16_t)(data[2] & 0x7F) << 8) | data[3]) * 0.1f;
    if (data[2] & 0x80) entry->temperature = -entry->temperature;
  } else {
    entry->humidity = data[0] + data[1] * 0.1f;
    entry->temperature = data[2] + (data[3] & 0x7F) * 0.1f;
    if (data[3] & 0x80) entry->temperature = -entry->temperature;
  }
  return humidity ? entry->humidity : entry->temperature;
}
