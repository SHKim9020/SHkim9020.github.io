const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { runInNewContext } = require("node:vm");

const window = {};
const root = path.join(__dirname, "..");
const read = (name) => readFileSync(path.join(root, name), "utf8");
runInNewContext(read("measurements.js"), { window, setTimeout, clearTimeout });
const { create, parse, csv } = window.OneMakerMeasurements;

test("normalizes sketch and runtime temperature/humidity lines", () => {
  for (const line of ["DATA,3,-2.5,0", "LOG,DATA,-2.5,0", "Temp:-2.5,Humi:0"]) {
    const reading = parse(line);
    assert.equal(reading.temperature, -2.5);
    assert.equal(reading.humidity, 0);
  }
  for (const line of ["READY,0,1.1.14", "DATA,2,NaN,65", "DATA,3,22,101", "DATA,,20", "DATA,x,22,45"]) {
    assert.equal(parse(line), null, line);
  }
});

test("plots the same readings that it exports, including the selected measurement place", () => {
  const nodes = Object.fromEntries(["measurePlace", "measureSummary", "measureExport", "measureReset"].map(id => [
    "#" + id, { value: "", addEventListener(name, handler) { this[name] = handler; } }
  ]));
  const charts = ["temperature", "humidity"].map(metric => ({
    dataset: { metric }, replaceChildren() { this.innerHTML = ""; }
  }));
  let exported;
  const graph = create({
    panel: {
      querySelector: id => nodes[id],
      querySelectorAll: () => charts,
      classList: { contains: () => true }
    },
    download: (_name, data) => { exported = data; }
  });
  nodes["#measurePlace"].value = '교실, "창가"';
  graph.accept("LOG,DATA,25.3,36");
  nodes["#measurePlace"].value = "복도";
  graph.accept("DATA,2,24,41");
  graph.render();
  assert.match(nodes["#measureSummary"].textContent, /2건/);
  assert.ok(charts.every(chart => chart.innerHTML.includes("<polyline")));
  nodes["#measureExport"].click();
  assert.match(exported, /^\ufeff측정시각,장소,회차,온도_C,상대습도_pct/);
  assert.match(exported, /"교실, ""창가""",1,25.3,36/);
  assert.match(exported, /"복도",2,24,41/);
  assert.match(csv([{ time: 0, place: "=1+1", sequence: 1, temperature: 0, humidity: 0 }]), /"'=1\+1",1,0,0/);
});

test("general serial opens at the chosen speed without sending runtime PING", async () => {
  const app = read("app.js").split("  async function toggleSerialConnection() {")[1].split("  function preferredSerialApi()")[0];
  const controls = {
    "#serialMode": { value: "raw" },
    "#serialBaud": { value: "9600" }
  };
  const opened = [];
  const context = {
    serialConnected: false, serialOpening: false, serialDisconnecting: false, serialSession: 0,
    sketch: null,
    preferredSerialApi: () => ({
      requestPort: async () => ({
        open: async options => opened.push(options.baudRate),
        writable: { getWriter: () => ({}) }
      })
    }),
    $: key => controls[key], setConnected() {}, readSerialLoop() {}, detectSerialTransport: () => "usb",
    toast() {}, sendLine() { throw new Error("Raw mode sent a runtime command"); }
  };
  await runInNewContext("async function toggleSerialConnection() {" + app + "\ntoggleSerialConnection();", context);
  assert.deepEqual(opened, [9600]);
  assert.equal(context.serialConnected, true);
  assert.equal(controls["#serialBaud"].disabled, true);
});
