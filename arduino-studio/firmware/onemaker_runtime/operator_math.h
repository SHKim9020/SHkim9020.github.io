float operatorInteger(float value) {
  return isfinite(value) ? truncf(value) : 0;
}
float operatorRandom(float from, float to) {
  from = operatorInteger(from);
  to = operatorInteger(to);
  float low = min(from, to), high = max(from, to);
  float value = low + floorf((high - low + 1) * (random(0x7fffffffL) / 2147483648.0f));
  return min(high, value);
}
float operatorMap(float value, float inMin, float inMax, float outMin, float outMax) {
  return inMin == inMax ? outMin : (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
