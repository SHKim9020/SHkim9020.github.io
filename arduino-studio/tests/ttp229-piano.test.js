const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
function load() {
 const events=[];
 const ctx={Blockly:{defineBlocksWithJsonArray(){},Blocks:{}},window:{},document:{querySelector:()=>({value:'uno'})},TextEncoder,TextDecoder};
 vm.createContext(ctx);
 vm.runInContext(app.replace('  init();', `window.api={blocks,EX,VM,ByteWriter,compileExpression,compileStatement,cppExpression,cppStatement,evaluate,executeStatement,TTP229_CPP};
 sendAction=async(...args)=>window.events.push(args); requestValue=async(...args)=>{window.events.push(args);return 6;};`),ctx);
 ctx.window.events=events;return {api:ctx.window.api,events};
}
const b=(type,fields={},inputs={})=>({type,getFieldValue:n=>fields[n],getInputTargetBlock:n=>inputs[n]||null});
const n=v=>b('math_number',{NUM:v});
const key=b('ttp229_key',{SCL:'2',SDO:'3'});
const freq=(v,high='0')=>b('piano_frequency',{HIGH:high},{KEY:v});
test('all keys, accidentals, release and octave agree in live and compiled piano',async()=>{
 const {api,events}=load();
 const notes=[554,622,740,831,932,523,587,659,698,784,880,988,1047,1175,1319,1397];
 for(let k=0;k<=17;k++) for(const high of ['0','1']) {
   assert.equal(await api.evaluate(freq(n(k),high)),k>=1&&k<=16?notes[k-1]*(high==='1'?4:1):0);
 }
 assert.equal(await api.evaluate(key),6);
 assert.deepEqual(JSON.parse(JSON.stringify(events)),[['TTP229','2','3']]);
 assert.deepEqual(Array.from(api.compileExpression(freq(key,'1'),{})),[5,17,2,3,18,1]);
 const hold=b('buzzer_hold',{PIN:'12'},{FREQ:freq(key,'1')});
 const writer=new api.ByteWriter();api.compileStatement(hold,writer,{});
 assert.deepEqual(Array.from(writer.bytes),[33,12,5,17,2,3,18,1]);
 await api.executeStatement(hold);
 assert.deepEqual(Array.from(events.at(-1)),['TONEHOLD','12',2092]);
 await api.executeStatement(b('buzzer_hold',{PIN:'12'},{FREQ:n(0)}));
 assert.deepEqual(Array.from(events.at(-1)),['TONEHOLD','12',0]);
 assert.match(api.cppStatement(hold),/pianoFrequency\(readTtp229\(2, 3\), 1\)/);
 assert.throws(()=>api.compileExpression(b('ttp229_key',{SCL:'2',SDO:'2'}),{}),/서로 다른/);
});
test('real C++ reader handles debounce, multiple keys, release and rollover',()=>{
 const {api}=load();
 const header=fs.readFileSync(path.join(root,'firmware/onemaker_runtime/ttp229_reader.h'),'utf8');
 assert.equal(header.replace('#pragma once\n\n','').trim(),api.TTP229_CPP);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'piano-'));
 try{
 const cpp=`#include <cstdint>
#include <cassert>
unsigned long now=0; uint16_t mask=0; int bit=0; bool low=false;
const int HIGH=1,LOW=0,OUTPUT=1,INPUT_PULLUP=2;
unsigned long millis(){return now;}
void delay(unsigned long v){now+=v;} void delayMicroseconds(int){}
void pinMode(int,int){}
void digitalWrite(int,int value){if(value==LOW)low=true;else if(low){bit=(bit+1)%16;low=false;}}
int digitalRead(int){return (mask&(1<<bit))?LOW:HIGH;}
${api.TTP229_CPP}
int main(){
 assert(readTtp229(2,2)==0);
 assert(readTtp229(2,3)==0);assert(now==600);
 mask=(1<<5)|(1<<8);now+=10;assert(readTtp229(2,3)==0);
 now+=20;assert(readTtp229(2,3)==0);now+=10;assert(readTtp229(2,3)==6);
 mask=0;now+=10;assert(readTtp229(2,3)==6);now+=30;assert(readTtp229(2,3)==0);
 mask=1;now=0xfffffff0UL;readTtp229(2,3);now+=30;assert(readTtp229(2,3)==1);
 assert(pianoFrequency(6,0)==523);assert(pianoFrequency(6,1)==2092);
 assert(pianoFrequency(1,0)==554);assert(pianoFrequency(0,1)==0);assert(pianoFrequency(17,0)==0);
}`;
 fs.writeFileSync(path.join(dir,'test.cpp'),cpp);
 cp.execFileSync('g++',['-std=c++11','-Wall','-Wextra','-Werror',path.join(dir,'test.cpp'),'-o',path.join(dir,'test')]);
 cp.execFileSync(path.join(dir,'test'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
