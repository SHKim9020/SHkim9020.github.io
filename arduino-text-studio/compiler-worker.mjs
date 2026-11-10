import { compileSketch } from "../arduino-studio/browser-avr-core.mjs?v=1";

const assetsUrl = new URL("../arduino-studio/browser-avr-2.json.gz", import.meta.url);
self.onmessage = async ({ data: { source, target } }) => {
  try {
    self.postMessage({ hex: await compileSketch(source, target, { assetsUrl }) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
