// Read the CURRENT pulse; pulseIn skips a pulse already in progress.
static uint8_t dhtPulse(uint8_t pin, uint8_t level) {
  uint8_t cycles = 0;
  while (digitalRead(pin) == level) {
    if (++cycles == 255) return 0;
  }
  return cycles;
}

float readDhtValue(uint8_t pin, uint8_t type, bool humidity) {
  struct Cache {
    uint32_t sampled;
    uint8_t data[5], pin, type;
    bool used, valid;
  };
  static Cache cache = {};
  // UNO/Nano share digital pins 0..19; Nano A6/A7 are analog-only.
  if (pin >= 20 || (type != 11 && type != 22)) return -999;
  // Consecutive reads share a packet; switching sensors waits safely.
  Cache *entry = &cache;
  if (!entry->used || entry->pin != pin) {
    entry->used = true;
    entry->pin = pin;
    // Sensor power-up; also protects a recently evicted pin.
    pinMode(pin, INPUT_PULLUP);
    delay(2000);
  } else if ((uint32_t)(millis() - entry->sampled) < 2000UL) {
    if (entry->type != type) return -999;
    goto decode;
  }
  entry->type = type;
  entry->sampled = millis();
  entry->valid = false;
  {
  uint8_t *data = entry->data;
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
    uint8_t low = dhtPulse(pin, LOW);
    uint8_t high = dhtPulse(pin, HIGH);
    ok = low && high;
    data[bit >> 3] = (data[bit >> 3] << 1) | (high > low);
  }
  SREG = savedSreg;
  entry->valid = ok && (uint8_t)(data[0] + data[1] + data[2] + data[3]) == data[4];
  }
decode:
  if (!entry->valid) return -999;
  uint8_t *data = entry->data + (humidity ? 0 : 2);
  int16_t raw;
  bool negative;
  if (type == 22) {
    raw = ((uint16_t)(data[0] & 0x7F) << 8) | data[1];
    negative = data[0] & 0x80;
  } else {
    raw = data[0] * 10 + (data[1] & 0x7F);
    negative = data[1] & 0x80;
  }
  if (!humidity && negative) raw = -raw;
  return raw * 0.1f;
}
