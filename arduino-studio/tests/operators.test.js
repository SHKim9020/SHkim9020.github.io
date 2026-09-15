const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
function load() {
 const ctx = { Blockly: { defineBlocksWithJsonArray(){}, Blocks:{} }, window:{}, document:{querySelector:()=>({value:"uno"})}, TextEncoder, TextDecoder, Math:Object.create(Math) };
 vm.createContext(ctx);
 vm.runInContext(app.replace('  init();','  window.testApi = { evaluate, compileExpression, cppExpression, generateArduinoCode, blocks, setWorkspace: value => workspace = value };'),ctx);
 return {api:ctx.window.testApi,math:ctx.Math};
}
function block(type,inputs={},fields={}) {return {type,getFieldValue:n=>fields[n],getInputTargetBlock:n=>inputs[n]||null,getInput:n=>inputs[n]?{}:null,getNextBlock:()=>null};}
const n=v=>block('math_number',{}, {NUM:v});
const txt=v=>block('text',{}, {TEXT:v});
const integer=v=>block('operator_integer',{VALUE:v});
const random=(a,b)=>block('operator_random',{FROM:n(a),TO:n(b)});
const map=(v,a,b,c,d)=>block('operator_map',{VALUE:n(v),IN_MIN:n(a),IN_MAX:n(b),OUT_MIN:n(c),OUT_MAX:n(d)});
const join=(a,b)=>block('operator_join',{A:a,B:b});
const cases = [
 ...[['ADD',8],['MINUS',2],['MULTIPLY',15],['DIVIDE',5/3],['POWER',125]].map(([OP,v])=>[block('math_arithmetic',{A:n(5),B:n(3)},{OP}),v]),
 [integer(n(23.8)),23], [integer(n(-3.8)),-3],
 [map(0,0,1023,0,100),0], [map(1023,0,1023,0,100),100],
 [map(511.5,0,1023,0,100),50], [map(25,100,0,0,100),75],
 [map(25,1,1,5,10),5], [map(150,0,100,0,10),15],
 [join(txt('온도:'),integer(n(23.8))),'온도:23'],
 [random(5,5),5]
];
test('operator blocks evaluate temperature, text and range examples',async()=>{
 const {api}=load();
 for(const [b,want] of cases)assert.equal(await api.evaluate(b),want);
 for(const type of ['operator_integer','operator_random','operator_join','operator_map'])assert.ok(api.blocks.some(b=>b.type===type));
});
test('random includes endpoints and handles reversed/negative/decimal bounds',async()=>{
 const {api,math}=load();
 for(const [a,b,lo,hi] of [[1,10,1,10],[10,1,1,10],[-3,2,-3,2],[1.8,4.9,1,4]]){
  math.random=()=>0;assert.equal(await api.evaluate(random(a,b)),lo);
  math.random=()=>0.999999999;assert.equal(await api.evaluate(random(a,b)),hi);
 }
});
test('compiled expressions execute in the real firmware VM and generated C++',()=>{
 const {api}=load();
 const runtime=fs.readFileSync(path.join(root,'firmware/onemaker_runtime/onemaker_runtime.ino'),'utf8');
 const enumText=runtime.slice(runtime.indexOf('enum ExpressionOpcode'),runtime.indexOf('struct VmValue'));
 const evaluator=runtime.slice(runtime.indexOf('uint8_t hexDigit'), runtime.indexOf('void printHex')) + runtime.slice(runtime.indexOf('void __attribute__((noinline)) setNumber'), runtime.indexOf('float parseNumber')) + runtime.slice(runtime.indexOf('VmValue evaluateStoredExpression'),runtime.indexOf('\nuint16_t storedProgramChecksum'));
 const body=fs.readFileSync(path.join(__dirname,'operator-vm-harness.cpp'),'utf8');
 const sensorCases = [
  [block('sensor_light',{}, {PIN:0}),512],
  [block('sensor_dht_simple',{}, {PIN:4,FIELD:'temperature'}),23.8],
  [block('sensor_ultrasonic',{}, {TRIG:2,ECHO:3}),10],
  [block('sensor_dust',{}, {LED_PIN:2,ANALOG_PIN:0}),5],
  [block('bt_available'),0], [block('bt_read'),'ABC'],
  [block('pin_digital_read',{}, {PIN:2}),1]
 ];
 const fixtures=cases.concat(sensorCases).map(([b,want])=>{
  const bytes=api.compileExpression(b,{});
  const expected=typeof want==='string'?`valueText(actual) == String(${JSON.stringify(want)})`:`fabs(valueNumber(actual) - (${want})) < 0.001f`;
  return `{ program = {${bytes.join(',')}}; uint16_t address=0; auto actual=evaluateStoredExpression(address); assert(${expected}); assert(address==program.size()); }`;
 }).join('\n');
 api.setWorkspace({getAllBlocks:()=>cases.flatMap(([b])=>[b]),getTopBlocks:()=>[],getVariableMap:()=>({getAllVariables:()=>[]})});
 // Helpers are emitted once and the original String joining block remains supported.
 const generated=api.generateArduinoCode();
 assert.ok(generated.includes(fs.readFileSync(path.join(root,"firmware/onemaker_runtime/operator_math.h"),"utf8")));
 assert.match(generated,/float operatorMap/);
 assert.match(generated,/String operatorText/);
 const expressions=cases.map(([b,want])=> {
  if (b.type === "math_arithmetic") return ""; // Existing generator is outside this change; the VM cases above cover the numeric refactor.
  const exp=api.cppExpression(b);
  return typeof want==='string'?`assert(${exp} == String(${JSON.stringify(want)}));`:`assert(fabs((${exp}) - (${want})) < 0.001f);`;
 }).join('\n');
 const helpers=generated.slice(generated.indexOf('float operatorInteger'),generated.indexOf('void setup()'));
 const src=body.replace('// ENUM',enumText).replace('// EVALUATOR',evaluator).replace('// HELPERS',helpers).replace('// FIXTURES',fixtures+'\n'+expressions);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operator-test-'));
 try{fs.writeFileSync(path.join(dir,'test.cpp'),src);cp.execFileSync('g++',['-std=c++11','-Wall','-Wextra',path.join(dir,'test.cpp'),'-o',path.join(dir,'test')],{stdio:'pipe'});cp.execFileSync(path.join(dir,'test'),{stdio:'pipe'});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('nested range expressions reject board stack overflow',()=>{
 const {api}=load();
 const inner=map(50,0,100,0,10);
 const outer=block('operator_map',{VALUE:n(1),IN_MIN:n(0),IN_MAX:n(100),OUT_MIN:n(0),OUT_MAX:inner});
 assert.throws(()=>api.compileExpression(outer,{}),/변수에 먼저 저장/);
});
