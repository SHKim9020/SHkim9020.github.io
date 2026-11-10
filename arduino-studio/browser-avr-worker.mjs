import { compileSketch } from "./browser-avr-core.mjs?v=1";

const assetsUrl = new URL(
  new URL(self.location.href).searchParams.get("v") === "2" ? "./browser-avr-2.json.gz" : "./browser-avr-1.json.gz",
  import.meta.url,
);

self.onmessage = async ({ data: { source, target } }) => {
  try {
    self.postMessage({ hex: await compileSketch(source, target, { assetsUrl }) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
