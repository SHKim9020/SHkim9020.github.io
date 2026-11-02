const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
function load(cancel = false) {
  let now = 0;
  const events = [];
  const ctx = {Blockly:{defineBlocksWithJsonArray(){},Blocks:{}},window:{},document:{querySelector:()=>({value:'uno'})},TextEncoder,TextDecoder,performance:{now:()=>now}};
  vm.createContext(ctx);
  ctx.window.send = async (...args) => {events.push({args,time:now}); now += 2;};
  ctx.window.wait = async ms => {now += ms;};
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8').replace('  init();', `
    window.api = {compileStatement,ByteWriter,VM,cppStatement,executeStatement};
    sendAction = window.send;
    executionSleep = async ms => { await window.wait(ms); ${cancel ? 'runCancelled = true;' : ''} };
  `),ctx);
  return {api:ctx.window.api,events};
}
const number = n => ({type:'math_number',getFieldValue:()=>String(n)});
const sweep = (from,to,seconds) => ({type:'servo_write_for',id:'sweep1',getFieldValue:()=> '8',getInputTargetBlock:n=>number({FROM:from,TO:to,SECONDS:seconds}[n])});
test('live sweep sends every degree at absolute deadlines, including reverse and equal endpoints',async()=>{
  for(const [from,to,seconds] of [[0,180,3],[180,0,3],[42,42,0.5],[0,3,0]]) {
    const {api,events}=load();
    await api.executeStatement(sweep(from,to,seconds));
    const count=Math.abs(to-from);
    assert.equal(events.length,count+1);
    assert.equal(events[0].args[2],from);
    assert.equal(events.at(-1).args[2],to);
    events.slice(1).forEach((e,i)=>assert.equal(e.args[2],from+Math.sign(to-from)*(i+1)));
    if(count && seconds) assert.equal(events.at(-1).time,seconds*1000+2);
  }
});
test('stop during sleep sends no further servo position',async()=>{
  const {api,events}=load(true);
  await api.executeStatement(sweep(0,180,3));
  assert.equal(events.length,1);
});
test('board bytecode captures the complete sweep in one compact instruction',()=>{
  const {api}=load();const writer=new api.ByteWriter();
  api.compileStatement(sweep(0,180,3),writer,{});
  const b=Buffer.from(writer.bytes);
  assert.equal(b.length,20);assert.equal(b[0],api.VM.SERVO_SWEEP);assert.equal(b[1],8);
  assert.equal(b.readFloatLE(4),0);assert.equal(b.readFloatLE(10),180);assert.equal(b.readFloatLE(16),3);
});
test('real firmware scheduler and exported Arduino code move one degree and reach 180 at 3000 ms',()=>{
  const {api}=load();const generated=api.cppStatement(sweep(0,180,3));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'servo-test-'));
  const source=`
#include <cassert>
#include <cmath>
#include <algorithm>
#include <vector>
#include "${path.join(root,'firmware/onemaker_runtime/servo_sweep.h')}"
using std::max;
#define constrain(x,a,b) std::min(std::max((x),(a)),(b))
uint32_t clockMs=0; unsigned long millis(){return clockMs;} void delay(unsigned long ms){clockMs+=ms;}
struct FakeServo {std::vector<int> values; void write(int angle){values.push_back(angle);}} servo__8;
void exported(){${generated}}
int main(){
 ServoSweep s; std::vector<int> values;
 for(int reverse=0;reverse<2;reverse++){
  values.clear();s.begin(100,8,reverse?180:0,reverse?0:180,3000);
  for(uint32_t ms=0;ms<=3000;ms++) {
   s.advance(100+ms,[&](uint8_t pin,uint8_t angle){assert(pin==8);values.push_back(angle);});
   if(ms<3000) assert(s.active);
  }
  assert(!s.active);assert(values.size()==180);
  for(int i=0;i<180;i++)assert(values[i]==(reverse?179-i:1+i));
 }
 s.begin(UINT32_MAX-100,8,0,180,3000);s.advance(uint32_t(UINT32_MAX-100+3000),[](uint8_t,uint8_t){});assert(!s.active);
 s.begin(0,8,42,42,3000);s.advance(2999,[](uint8_t,uint8_t){assert(false);});assert(s.active);s.advance(3000,[](uint8_t,uint8_t){assert(false);});assert(!s.active);
 s.begin(0,8,0,180,0);s.advance(0,[](uint8_t,uint8_t){});assert(!s.active);
 exported();assert(clockMs==3000);assert(servo__8.values.size()==181);for(int i=0;i<=180;i++)assert(servo__8.values[i]==i);
}
`;
  try {fs.writeFileSync(path.join(dir,'test.cpp'),source);cp.execFileSync('g++',['-std=c++11','-Wall','-Wextra',path.join(dir,'test.cpp'),'-o',path.join(dir,'test')]);cp.execFileSync(path.join(dir,'test'));} finally {fs.rmSync(dir,{recursive:true,force:true});}
});
