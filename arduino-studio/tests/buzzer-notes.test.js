const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function load() {
  const events = [];
  const ctx = { Blockly: { defineBlocksWithJsonArray(){}, Blocks:{} }, window:{}, document:{querySelector:()=>({value:'uno'})}, TextEncoder, TextDecoder };
  vm.createContext(ctx);
  vm.runInContext(source.replace('  init();', `
    window.testApi = { blocks, compileStatement, ByteWriter, VM, EX, cppStatement, executeStatement };
    sendAction = async (...args) => window.events.push(args);
    executionSleep = async ms => window.events.push(['WAIT', ms]);
  `), ctx);
  ctx.window.events = events;
  return { api: ctx.window.testApi, events };
}
const note = (frequency, seconds = 0.5) => ({type:'buzzer_note', getFieldValue: n => ({PIN:'8', NOTE:String(frequency), SECONDS:seconds})[n]});
const frequencies = [2093,2349,2637,2794,3136,3520,3951,4186];
test('all eight notes use the same pitches in board bytecode and Arduino export', () => {
  const {api} = load();
  for (const frequency of frequencies) {
    const writer = new api.ByteWriter();
    api.compileStatement(note(frequency), writer, {});
    const bytes = Buffer.from(writer.bytes);
    // TONE pin + two numeric expressions, followed by WAIT with the same duration.
    assert.equal(bytes[0], api.VM.TONE);
    assert.equal(bytes[1], 8);
    assert.equal(bytes[2], 5); assert.equal(bytes[3], api.EX.NUMBER);
    assert.equal(bytes.readFloatLE(4), frequency);
    assert.equal(bytes.readFloatLE(10), 0.5);
    assert.equal(bytes[14], api.VM.WAIT);
    assert.equal(bytes.readFloatLE(17), 0.5);
    assert.equal(bytes.length, 21);
    assert.equal(api.cppStatement(note(frequency)), `  tone(8, ${frequency}, 500UL);\n  delay(500UL);\n`);
  }
  assert.match(api.cppStatement(note(2093, 0.01)), /10UL/);
});
test('USB live playback waits between notes so a melody is not overwritten', async () => {
  const {api, events} = load();
  for (const frequency of frequencies) await api.executeStatement(note(frequency));
  assert.deepEqual(JSON.parse(JSON.stringify(events)), frequencies.flatMap(hz => [['TONE','8',hz,500],['WAIT',500]]));
});
test('note dropdown and duration survive normal Blockly fields and shell version agrees', () => {
  const {api} = load();
  const definition = api.blocks.find(b => b.type === 'buzzer_note');
  assert.deepEqual(Array.from(definition.args0[1].options, pair => Number(pair[1])), frequencies);
  assert.equal(definition.args0[2].min, 0.01);
  assert.equal(definition.args0[2].max, 60);
  assert.ok(definition.previousStatement === null && definition.nextStatement === null);
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw = fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const version = html.match(/app.js\?v=([\d.]+)/)[1];
  assert.ok(sw.includes(`./app.js?v=${version}`));
});
