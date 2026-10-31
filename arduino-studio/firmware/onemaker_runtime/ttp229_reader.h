#pragma once

uint8_t readTtp229(uint8_t scl, uint8_t sdo) {
  // One module, 16-key active-LOW two-wire mode. Do not touch during calibration.
  static uint8_t oldScl = 255, oldSdo = 255, raw = 0, stable = 0;
  static unsigned long scanned = 0, changed = 0;
  if (scl == sdo || scl < 2 || scl > 13 || sdo < 2 || sdo > 13) return 0;
  if (scl != oldScl || sdo != oldSdo) {
    oldScl = scl; oldSdo = sdo; raw = stable = 0;
    digitalWrite(scl, HIGH); pinMode(scl, OUTPUT); pinMode(sdo, INPUT_PULLUP);
    delay(600);
    scanned = millis() - 10; changed = millis();
  }
  unsigned long now = millis();
  if (now - scanned < 10) return stable;
  scanned = now;
  uint8_t key = 0;
  for (uint8_t i = 0; i < 16; ++i) {
    digitalWrite(scl, LOW); delayMicroseconds(20);
    if (digitalRead(sdo) == LOW && !key) key = i + 1;
    digitalWrite(scl, HIGH); delayMicroseconds(20);
  }
  if (key != raw) { raw = key; changed = now; }
  if (now - changed >= 25) stable = raw;
  return stable;
}
uint16_t pianoFrequency(int key, uint8_t high) {
  static const uint16_t notes[16] = {554,622,740,831,932,523,587,659,698,784,880,988,1047,1175,1319,1397};
  return key >= 1 && key <= 16 ? notes[key - 1] * (high ? 4 : 1) : 0;
}
