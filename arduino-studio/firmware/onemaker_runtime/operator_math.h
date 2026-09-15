float operatorInteger(float value) {
  return isfinite(value) ? truncf(value) : 0;
}
float operatorRandom(float from, float to) {
  from = operatorInteger(from);
  to = operatorInteger(to);
  float low = min(from, to), high = max(from, to);
  static uint32_t state = 0;
  if (!state) state = micros() | 1UL;
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  float unit = (state >> 8) * (1.0f / 16777216.0f);
  float value = low + truncf((high - low + 1) * unit);
  return min(high, value);
}
float operatorMap(float value, float inMin, float inMax, float outMin, float outMax) {
  return inMin == inMax ? outMin : (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
