#pragma once
#include <stdint.h>

// Unsigned elapsed time also works across the millis() rollover.
struct ServoSweep {
  uint32_t started, duration;
  uint8_t pin, angle, steps, step;
  int8_t direction;
  bool active;

  void begin(uint32_t now, uint8_t outputPin, uint8_t from, uint8_t to, uint32_t milliseconds) {
    started = now;
    duration = milliseconds;
    pin = outputPin;
    angle = from;
    if (from < to) { direction = 1; steps = to - from; }
    else { direction = -1; steps = from - to; }
    step = 0;
    active = true;
  }

  template <typename Write>
  void advance(uint32_t now, Write write) {
    const uint32_t elapsed = now - started;
    while (step < steps) {
      const uint8_t next = step + 1;
      const uint32_t due = (float)duration * next / steps;
      if (elapsed < due) return;
      angle += direction;
      step = next;
      write(pin, angle);
    }
    active = elapsed < duration;
  }
};
