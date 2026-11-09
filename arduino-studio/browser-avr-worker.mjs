import { compileSketch } from "./browser-avr-core.mjs?v=1";

self.onmessage = async ({ data: { source, target } }) => {
  try {
    self.postMessage({ hex: await compileSketch(source, target) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
