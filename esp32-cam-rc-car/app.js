(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DEFAULT_PINS = { in1: 12, in2: 13, in3: 14, in4: 15 };
  const COLORS = { event: 38, motor: 210, camera: 285, output: 65 };
  const SIDE_PANEL_KEY = "onemaker-esp32cam-rc-side-collapsed";
  const REMOTE_URL = "http://192.168.4.1/";
  let workspace, port, reader, writer, readLoopActive = false, uploadWaiter = null;
  let selectedBlockId = null, copiedBlockState = null, deferredInstallPrompt = null;

  function toast(message) {
    const el = $("#toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
  }

  function defineBlocks() {
    Blockly.defineBlocksWithJsonArray([
      { type:"event_start", message0:"🚗 RC카가 시작하면 %1 %2", args0:[{type:"input_dummy"},{type:"input_statement",name:"DO"}], colour:COLORS.event, tooltip:"전원을 켜거나 프로그램을 실행할 때 한 번 실행합니다." },
      { type:"event_forever", message0:"🔁 계속 반복하기 %1 %2", args0:[{type:"input_dummy"},{type:"input_statement",name:"DO"}], colour:COLORS.event },
      { type:"remote_when", message0:"📱 Wi‑Fi 리모컨 %1 버튼을 누르면 %2 %3", args0:[{type:"field_dropdown",name:"BUTTON",options:[["전진","forward"],["후진","backward"],["좌회전","left"],["우회전","right"],["정지","stop"]]},{type:"input_dummy"},{type:"input_statement",name:"DO"}], colour:COLORS.event },
      { type:"car_drive", message0:"🚗 RC카 %1 속도 %2", args0:[{type:"field_dropdown",name:"DIR",options:[["전진","forward"],["후진","backward"],["좌회전","left"],["우회전","right"]]},{type:"input_value",name:"SPEED",check:"Number"}], previousStatement:null,nextStatement:null,colour:COLORS.motor },
      { type:"motor_pair", message0:"⚙️ 왼쪽 모터 %1 오른쪽 모터 %2", args0:[{type:"input_value",name:"LEFT",check:"Number"},{type:"input_value",name:"RIGHT",check:"Number"}], previousStatement:null,nextStatement:null,colour:COLORS.motor,tooltip:"-255는 후진, 0은 정지, 255는 전진입니다." },
      { type:"car_stop", message0:"🛑 RC카 정지", previousStatement:null,nextStatement:null,colour:COLORS.motor },
      { type:"camera_flash", message0:"💡 카메라 조명 %1", args0:[{type:"field_dropdown",name:"STATE",options:[["켜기","on"],["끄기","off"]]}], previousStatement:null,nextStatement:null,colour:COLORS.camera },
      { type:"camera_frame", message0:"📷 카메라 화질 %1", args0:[{type:"field_dropdown",name:"SIZE",options:[["QVGA 320×240","QVGA"],["VGA 640×480","VGA"],["SVGA 800×600","SVGA"]]}], previousStatement:null,nextStatement:null,colour:COLORS.camera },
      { type:"camera_flip", message0:"🔄 카메라 화면 180° 회전 %1", args0:[{type:"field_checkbox",name:"ON",checked:false}], previousStatement:null,nextStatement:null,colour:COLORS.camera },
      { type:"wait_ms", message0:"⏱️ %1 초 기다리기", args0:[{type:"input_value",name:"SECONDS",check:"Number"}], previousStatement:null,nextStatement:null,colour:120 },
      { type:"serial_print", message0:"🖥️ 시리얼에 %1 출력", args0:[{type:"input_value",name:"VALUE"}], previousStatement:null,nextStatement:null,colour:COLORS.output }
    ]);
  }

  const toolbox = {
    kind:"categoryToolbox", contents:[
      {kind:"category",name:"시작·리모컨",colour:String(COLORS.event),contents:[{kind:"block",type:"event_start"},{kind:"block",type:"event_forever"},{kind:"block",type:"remote_when"}]},
      {kind:"category",name:"RC카 모터",colour:String(COLORS.motor),contents:[
        {kind:"block",type:"car_drive",inputs:{SPEED:{shadow:{type:"math_number",fields:{NUM:150}}}}},
        {kind:"block",type:"motor_pair",inputs:{LEFT:{shadow:{type:"math_number",fields:{NUM:150}}},RIGHT:{shadow:{type:"math_number",fields:{NUM:150}}}}},
        {kind:"block",type:"car_stop"}
      ]},
      {kind:"category",name:"ESP32‑CAM",colour:String(COLORS.camera),contents:[{kind:"block",type:"camera_flash"},{kind:"block",type:"camera_frame"},{kind:"block",type:"camera_flip"}]},
      {kind:"category",name:"시간",colour:"120",contents:[{kind:"block",type:"wait_ms",inputs:{SECONDS:{shadow:{type:"math_number",fields:{NUM:1}}}}}]},
      {kind:"category",name:"제어",categorystyle:"loop_category",contents:[{kind:"block",type:"controls_repeat_ext",inputs:{TIMES:{shadow:{type:"math_number",fields:{NUM:4}}}}},{kind:"block",type:"controls_if"}]},
      {kind:"category",name:"논리",categorystyle:"logic_category",contents:[{kind:"block",type:"logic_compare"},{kind:"block",type:"logic_operation"},{kind:"block",type:"logic_boolean"}]},
      {kind:"category",name:"계산",categorystyle:"math_category",contents:[{kind:"block",type:"math_number"},{kind:"block",type:"math_arithmetic"},{kind:"block",type:"math_random_int",inputs:{FROM:{shadow:{type:"math_number",fields:{NUM:80}}},TO:{shadow:{type:"math_number",fields:{NUM:180}}}}}]},
      {kind:"category",name:"변수",categorystyle:"variable_category",custom:"VARIABLE"},
      {kind:"category",name:"출력",colour:String(COLORS.output),contents:[{kind:"block",type:"serial_print",inputs:{VALUE:{shadow:{type:"text",fields:{TEXT:"RC카 출발!"}}}}},{kind:"block",type:"text"}]}
    ]
  };

  function initBlockly() {
    defineBlocks();
    workspace = Blockly.inject("blocklyDiv", { toolbox, trashcan:true, renderer:"zelos", theme:Blockly.Themes.Zelos, grid:{spacing:20,length:3,colour:"#c9d4e5",snap:true}, zoom:{controls:false,wheel:true,startScale:.9,maxScale:1.5,minScale:.45,scaleSpeed:1.12} });
    workspace.addChangeListener(e => {
      if (e.type === Blockly.Events.SELECTED) selectedBlockId = e.newElementId || null;
      if (!e.isUiEvent) { saveLocal(); updateCode(); }
    });
    window.addEventListener("resize", () => Blockly.svgResize(workspace));
    loadLocal() || loadExample(false);
  }

  function numberOptions(select, values) { select.innerHTML = values.map(v => `<option value="${v}">GPIO ${v}</option>`).join(""); }
  function initSettings() {
    for(let i=1;i<=16;i++) $("#carNumber").add(new Option(String(i).padStart(2,"0"),i));
    ["pinIn1","pinIn2","pinIn3","pinIn4"].forEach(id => numberOptions($("#"+id),[12,13,14,15,1,3,2,4]));
    applyDefaultPins();
    $("#carNumber").addEventListener("change", updateWifiName);
    ["pinIn1","pinIn2","pinIn3","pinIn4","invertLeft","invertRight","frameSize","jpegQuality","flipCamera"].forEach(id => $("#"+id).addEventListener("change",()=>{saveLocal();updateCode()}));
    $("#testSpeed").addEventListener("input", e => $("#testSpeedValue").value=e.target.value);
  }
  function applyDefaultPins(){Object.entries(DEFAULT_PINS).forEach(([k,v])=>$("#pin"+k.slice(0,1).toUpperCase()+k.slice(1)).value=v)}
  function updateWifiName(){const n=String($("#carNumber").value).padStart(2,"0");$("#wifiNamePreview").textContent=`OneMaker‑RC‑${n}`;$("#remoteWifiName").textContent=`OneMaker‑RC‑${n}`;saveLocal()}
  function settings(){return {carNumber:Number($("#carNumber").value),pins:{in1:Number($("#pinIn1").value),in2:Number($("#pinIn2").value),in3:Number($("#pinIn3").value),in4:Number($("#pinIn4").value)},invertLeft:$("#invertLeft").checked,invertRight:$("#invertRight").checked,camera:{frameSize:$("#frameSize").value,quality:Number($("#jpegQuality").value),flip:$("#flipCamera").checked}}}

  function expr(block){
    if(!block)return {type:"number",value:0};
    switch(block.type){
      case "math_number": return {type:"number",value:Number(block.getFieldValue("NUM"))};
      case "text": return {type:"text",value:block.getFieldValue("TEXT")||""};
      case "variables_get": return {type:"variable",name:block.getField("VAR").getText()};
      case "math_random_int": return {type:"random",from:expr(block.getInputTargetBlock("FROM")),to:expr(block.getInputTargetBlock("TO"))};
      case "math_arithmetic": return {type:"math",op:block.getFieldValue("OP"),a:expr(block.getInputTargetBlock("A")),b:expr(block.getInputTargetBlock("B"))};
      case "logic_compare": return {type:"compare",op:block.getFieldValue("OP"),a:expr(block.getInputTargetBlock("A")),b:expr(block.getInputTargetBlock("B"))};
      case "logic_operation": return {type:"logic",op:block.getFieldValue("OP"),a:expr(block.getInputTargetBlock("A")),b:expr(block.getInputTargetBlock("B"))};
      case "logic_boolean": return {type:"boolean",value:block.getFieldValue("BOOL")==="TRUE"};
      default:return {type:"number",value:0};
    }
  }
  function steps(first){const out=[];for(let b=first;b;b=b.getNextBlock()){const s=step(b);if(s)out.push(s)}return out}
  function step(b){
    switch(b.type){
      case "car_drive":return {op:"drive",dir:b.getFieldValue("DIR"),speed:expr(b.getInputTargetBlock("SPEED"))};
      case "motor_pair":return {op:"motors",left:expr(b.getInputTargetBlock("LEFT")),right:expr(b.getInputTargetBlock("RIGHT"))};
      case "car_stop":return {op:"stop"};
      case "camera_flash":return {op:"flash",on:b.getFieldValue("STATE")==="on"};
      case "camera_frame":return {op:"cameraFrame",size:b.getFieldValue("SIZE")};
      case "camera_flip":return {op:"cameraFlip",on:b.getFieldValue("ON")==="TRUE"};
      case "wait_ms":return {op:"wait",ms:{type:"math",op:"MULTIPLY",a:expr(b.getInputTargetBlock("SECONDS")),b:{type:"number",value:1000}}};
      case "serial_print":return {op:"print",value:expr(b.getInputTargetBlock("VALUE"))};
      case "controls_repeat_ext":return {op:"repeat",times:expr(b.getInputTargetBlock("TIMES")),steps:steps(b.getInputTargetBlock("DO"))};
      case "controls_if":return {op:"if",condition:expr(b.getInputTargetBlock("IF0")),then:steps(b.getInputTargetBlock("DO0")),else:steps(b.getInputTargetBlock("ELSE"))};
      case "variables_set":return {op:"setVar",name:b.getField("VAR").getText(),value:expr(b.getInputTargetBlock("VALUE"))};
      case "math_change":return {op:"changeVar",name:b.getField("VAR").getText(),value:expr(b.getInputTargetBlock("DELTA"))};
      default:return null;
    }
  }
  function compileProgram(){
    const top=workspace.getTopBlocks(true), start=top.find(b=>b.type==="event_start"), forever=top.find(b=>b.type==="event_forever");
    const handlers={};top.filter(b=>b.type==="remote_when").forEach(b=>handlers[b.getFieldValue("BUTTON")]=steps(b.getInputTargetBlock("DO")));
    return {start:start?steps(start.getInputTargetBlock("DO")):[],forever:forever?steps(forever.getInputTargetBlock("DO")):[],handlers};
  }
  function cppExpr(e){if(!e)return"0";if(e.type==="number")return String(e.value);if(e.type==="text")return JSON.stringify(e.value);if(e.type==="variable")return e.name;if(e.type==="boolean")return e.value?"true":"false";if(e.type==="random")return`random(${cppExpr(e.from)}, ${cppExpr(e.to)} + 1)`;if(e.type==="math")return`(${cppExpr(e.a)} ${{ADD:"+",MINUS:"-",MULTIPLY:"*",DIVIDE:"/",POWER:"^"}[e.op]||"+"} ${cppExpr(e.b)})`;if(e.type==="compare")return`(${cppExpr(e.a)} ${{EQ:"==",NEQ:"!=",LT:"<",LTE:"<=",GT:">",GTE:">="}[e.op]} ${cppExpr(e.b)})`;if(e.type==="logic")return`(${cppExpr(e.a)} ${e.op==="AND"?"&&":"||"} ${cppExpr(e.b)})`;return"0"}
  function cppSteps(list,depth=1){const p="  ".repeat(depth);return list.map(s=>{switch(s.op){case"drive":return`${p}rcDrive("${s.dir}", ${cppExpr(s.speed)});`;case"motors":return`${p}setMotors(${cppExpr(s.left)}, ${cppExpr(s.right)});`;case"stop":return`${p}stopCar();`;case"flash":return`${p}setCameraLight(${s.on});`;case"cameraFrame":return`${p}setCameraFrame("${s.size}");`;case"cameraFlip":return`${p}setCameraFlip(${s.on});`;case"wait":return`${p}delay(${cppExpr(s.ms)});`;case"print":return`${p}Serial.println(${cppExpr(s.value)});`;case"setVar":return`${p}${s.name} = ${cppExpr(s.value)};`;case"changeVar":return`${p}${s.name} += ${cppExpr(s.value)};`;case"repeat":return`${p}for (int i=0; i<${cppExpr(s.times)}; i++) {\n${cppSteps(s.steps,depth+1)}\n${p}}`;case"if":return`${p}if (${cppExpr(s.condition)}) {\n${cppSteps(s.then,depth+1)}\n${p}}${s.else?.length?` else {\n${cppSteps(s.else,depth+1)}\n${p}}`:""}`;default:return""}}).join("\n")}
  function generateCode(){const cfg=settings(),p=compileProgram(),vars=workspace.getAllVariables().map(v=>`double ${v.name}=0;`).join("\n");return `// OneMaker ESP32-CAM RC Studio 교육용 코드\n#include <WiFi.h>\n#include <esp_camera.h>\n\nconst int IN1=${cfg.pins.in1}, IN2=${cfg.pins.in2}, IN3=${cfg.pins.in3}, IN4=${cfg.pins.in4};\n${vars||"// 사용한 변수 없음"}\n\nvoid setup() {\n  Serial.begin(115200);\n  setupCamera();\n  setupMotorDriver();\n  startRcWifi("OneMaker-RC-${String(cfg.carNumber).padStart(2,"0")}", "onemaker1");\n${cppSteps(p.start,1)||"  // 시작 블록을 연결하세요."}\n}\n\nvoid loop() {\n  serviceCameraRemote();\n${cppSteps(p.forever,1)||"  delay(10);"}\n}\n`;}
  function updateCode(){$("#codePreview code").textContent=generateCode()}

  function snapshot(){return {version:1,name:$("#projectName").value,settings:settings(),workspace:Blockly.serialization.workspaces.save(workspace)}}
  function applySnapshot(data){if(!data?.workspace)throw new Error("프로젝트 형식이 아닙니다.");$("#projectName").value=data.name||"나의 영상탐사 RC카";const c=data.settings||{};$("#carNumber").value=c.carNumber||1;Object.entries(c.pins||DEFAULT_PINS).forEach(([k,v])=>$("#pin"+k[0].toUpperCase()+k.slice(1)).value=v);$("#invertLeft").checked=!!c.invertLeft;$("#invertRight").checked=c.invertRight!==false;$("#frameSize").value=c.camera?.frameSize||"QVGA";$("#jpegQuality").value=c.camera?.quality||12;$("#flipCamera").checked=!!c.camera?.flip;Blockly.serialization.workspaces.load(data.workspace,workspace);updateWifiName();updateCode()}
  function saveLocal(){if(!workspace)return;localStorage.setItem("om-esp32cam-rc-project",JSON.stringify(snapshot()))}
  function loadLocal(){try{const raw=localStorage.getItem("om-esp32cam-rc-project");if(!raw)return false;applySnapshot(JSON.parse(raw));return true}catch(e){console.warn(e);return false}}
  function loadExample(notify=true){const xml=`<xml xmlns="https://developers.google.com/blockly/xml"><block type="event_start" x="35" y="35"><statement name="DO"><block type="camera_flash"><field name="STATE">on</field><next><block type="wait_ms"><value name="SECONDS"><shadow type="math_number"><field name="NUM">1</field></shadow></value><next><block type="camera_flash"><field name="STATE">off</field><next><block type="serial_print"><value name="VALUE"><shadow type="text"><field name="TEXT">영상탐사 RC카 준비 완료!</field></shadow></value></block></next></block></next></block></statement></block><block type="remote_when" x="390" y="35"><field name="BUTTON">forward</field><statement name="DO"><block type="car_drive"><field name="DIR">forward</field><value name="SPEED"><shadow type="math_number"><field name="NUM">150</field></shadow></value></block></statement></block><block type="remote_when" x="390" y="190"><field name="BUTTON">stop</field><statement name="DO"><block type="car_stop"/></statement></block></xml>`;workspace.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml),workspace);workspace.zoomToFit();if(notify)toast("기본 영상탐사 예제를 불러왔습니다.")}
  function download(name,text,type="application/json"){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}

  async function connectSerial(){
    if(!("serial" in navigator)){toast("PC Chrome/Edge에서 Web Serial을 사용할 수 있습니다.");return}
    try{port=await navigator.serial.requestPort();await port.open({baudRate:115200});writer=port.writable.getWriter();readLoopActive=true;readSerial();setConnected(true);await sendLine({cmd:"hello"});toast("ESP32‑CAM USB가 연결되었습니다.")}catch(e){toast("USB 연결 실패: "+e.message)}
  }
  function setConnected(on){$("#connectionStatus").textContent=on?"USB 연결됨":"USB 연결 안 됨";$("#connectionStatus").classList.toggle("connected",on);$("#connectionStatus").classList.toggle("disconnected",!on);$("#connectBtn .dot").style.background=on?"#41e0a4":"#98a5ba"}
  async function readSerial(){const decoder=new TextDecoder();let buffer="";try{reader=port.readable.getReader();while(readLoopActive){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let n;while((n=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,n).trim();buffer=buffer.slice(n+1);if(line){$("#serialOutput").textContent+=line+"\n";$("#serialOutput").scrollTop=$("#serialOutput").scrollHeight;try{const j=JSON.parse(line);if(uploadWaiter&&(j.type==="ack"||j.type==="uploadDone"||j.type==="error")){const w=uploadWaiter;uploadWaiter=null;j.type==="error"?w.reject(new Error(j.message)):w.resolve(j)}}catch{}}}}}catch(e){if(readLoopActive)toast("USB 연결이 끊어졌습니다.")}finally{reader?.releaseLock();setConnected(false)}}
  async function sendLine(obj){if(!writer)throw new Error("먼저 USB를 연결하세요.");await writer.write(new TextEncoder().encode(JSON.stringify(obj)+"\n"))}
  function waitAck(timeout=3000){return new Promise((resolve,reject)=>{uploadWaiter={resolve,reject};setTimeout(()=>{if(uploadWaiter){uploadWaiter=null;reject(new Error("보드 응답 시간 초과"))}},timeout)})}
  async function command(obj,timeout=3000){const response=waitAck(timeout);try{await sendLine(obj);return await response}catch(e){if(uploadWaiter)uploadWaiter=null;throw e}}
  function bytesToBase64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
  async function uploadProgram(){
    try{const payload={config:settings(),program:compileProgram()};const bytes=new TextEncoder().encode(JSON.stringify(payload));await command({cmd:"uploadBegin",size:bytes.length});for(let i=0,index=0;i<bytes.length;i+=384,index++){await command({cmd:"uploadChunk",index,data:bytesToBase64(bytes.slice(i,i+384))},5000)}await command({cmd:"uploadEnd"},8000);toast("RC카에 저장하고 실행했습니다.")}catch(e){toast("전송 실패: "+e.message)}
  }
  async function quickTest(dir){try{await command({cmd:"drive",dir,speed:Number($("#testSpeed").value)});}catch(e){toast(e.message)}}

  function copySelectedBlock(){const block=selectedBlockId&&workspace.getBlockById(selectedBlockId);if(!block)return toast("복사할 블록을 먼저 선택하세요.");copiedBlockState=Blockly.serialization.blocks.save(block,{addCoordinates:false,addInputBlocks:true,addNextBlocks:true});toast("선택한 블록을 복사했습니다.")}
  function pasteBlock(){if(!copiedBlockState)return toast("먼저 블록을 복사하세요.");try{const state=JSON.parse(JSON.stringify(copiedBlockState));delete state.id;const block=Blockly.serialization.blocks.append(state,workspace);if(block)block.moveBy(28,28);toast("블록을 붙여넣었습니다.")}catch(e){toast("붙여넣기 실패: "+e.message)}}
  function deleteSelectedBlock(){const block=selectedBlockId&&workspace.getBlockById(selectedBlockId);if(!block)return toast("삭제할 블록을 먼저 선택하세요.");block.dispose(true)}
  function setSidePanelCollapsed(collapsed,persist=true){const shell=$(".app-shell"),button=$("#sideCollapseBtn");shell.classList.toggle("side-collapsed",collapsed);button.setAttribute("aria-expanded",String(!collapsed));button.title=collapsed?"오른쪽 패널 펼치기":"오른쪽 패널 접기";button.querySelector(".collapse-label").textContent=collapsed?"펼치기":"접기";if(persist)localStorage.setItem(SIDE_PANEL_KEY,collapsed?"1":"0");requestAnimationFrame(()=>{Blockly.svgResize(workspace);setTimeout(()=>Blockly.svgResize(workspace),240)})}
  function initPwaInstall(){const button=$("#pwaInstallBtn"),standalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;if(/Android/i.test(navigator.userAgent)&&!standalone())button.hidden=false;addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;if(!standalone())button.hidden=false});addEventListener("appinstalled",()=>{deferredInstallPrompt=null;button.hidden=true;toast("RC Studio가 홈 화면에 설치되었습니다.")})}
  async function installPwa(){if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return}$("#pwaInstallDialog").showModal()}
  function openRemote(e){e.preventDefault();const status=$("#remoteOpenStatus");status.textContent="영상 조종기로 이동합니다… 연결되지 않으면 OneMaker‑RC Wi‑Fi를 다시 확인하세요.";status.classList.add("opening");toast("RC카 영상 조종기로 이동합니다.");setTimeout(()=>window.location.assign(REMOTE_URL),120)}
  function initResponsiveViewport(){const desktop=()=>window.innerWidth>900;let wasDesktop=desktop();const resetDesktopScroll=()=>{const isDesktop=desktop();if(isDesktop&&(window.scrollY||document.documentElement.scrollTop||document.body.scrollTop))window.scrollTo(0,0);if(isDesktop!==wasDesktop){wasDesktop=isDesktop;requestAnimationFrame(()=>{window.scrollTo(0,0);Blockly.svgResize(workspace)})}};window.addEventListener("resize",resetDesktopScroll,{passive:true});window.visualViewport?.addEventListener("resize",resetDesktopScroll,{passive:true});window.visualViewport?.addEventListener("scroll",resetDesktopScroll,{passive:true});$("#blocklyDiv").addEventListener("pointerdown",()=>{if(desktop())window.scrollTo(0,0)},{capture:true,passive:true});if(wasDesktop)requestAnimationFrame(()=>window.scrollTo(0,0))}

  function bindUi(){
    $$(".side-tabs [data-tab]").forEach(b=>b.onclick=()=>{$$(".side-tabs [data-tab]").forEach(x=>x.classList.toggle("active",x===b));$$(".tab-panel").forEach(p=>p.classList.toggle("active",p.dataset.panel===b.dataset.tab));if(b.dataset.tab==="code")updateCode()});
    $("#sideCollapseBtn").onclick=()=>setSidePanelCollapsed(!$(".app-shell").classList.contains("side-collapsed"));
    $("#pwaInstallBtn").onclick=installPwa;
    $("#openRemoteBtn").onclick=openRemote;
    $("#firmwareBtn").onclick=()=>$("#firmwareDialog").showModal();$("#connectBtn").onclick=connectSerial;$("#uploadBtn").onclick=uploadProgram;$("#stopBtn").onclick=()=>command({cmd:"stop"}).catch(e=>toast(e.message));
    $("#saveNumberBtn").onclick=()=>command({cmd:"setNumber",number:Number($("#carNumber").value)}).then(()=>toast("RC카 번호를 저장했습니다. 보드가 재시작됩니다.")).catch(e=>toast(e.message));
    $("#resetPinsBtn").onclick=()=>{applyDefaultPins();updateCode();saveLocal()};
    $$("[data-test]").forEach(b=>{b.onpointerdown=e=>{e.preventDefault();quickTest(b.dataset.test)};if(b.dataset.test!=="stop"){b.onpointerup=()=>quickTest("stop");b.onpointercancel=()=>quickTest("stop");b.onpointerleave=e=>{if(e.buttons)quickTest("stop")}}});
    $("#testFlashOnBtn").onclick=()=>command({cmd:"flash",on:true}).catch(e=>toast(e.message));$("#testFlashOffBtn").onclick=()=>command({cmd:"flash",on:false}).catch(e=>toast(e.message));$$('[data-camera-test]').forEach(b=>b.onclick=()=>command({cmd:"cameraFrame",size:b.dataset.cameraTest}).then(()=>toast(b.dataset.cameraTest+" 화질을 적용했습니다.")).catch(e=>toast(e.message)));
    $("#undoBtn").onclick=()=>workspace.undo(false);$("#redoBtn").onclick=()=>workspace.undo(true);$("#copyBtn").onclick=copySelectedBlock;$("#pasteBtn").onclick=pasteBlock;$("#deleteBtn").onclick=deleteSelectedBlock;$("#zoomInBtn").onclick=()=>workspace.zoomCenter(1);$("#zoomOutBtn").onclick=()=>workspace.zoomCenter(-1);$("#zoomResetBtn").onclick=()=>workspace.setScale(.9);$("#centerBtn").onclick=()=>workspace.scrollCenter();$("#clearBtn").onclick=()=>{if(confirm("모든 블록을 지울까요?"))workspace.clear()};
    $("#exampleBtn").onclick=()=>loadExample();$("#saveBtn").onclick=()=>download(($("#projectName").value||"rc-car")+".omrc",JSON.stringify(snapshot(),null,2));$("#openBtn").onclick=()=>$("#openFile").click();$("#openFile").onchange=async e=>{try{applySnapshot(JSON.parse(await e.target.files[0].text()));toast("프로젝트를 열었습니다.")}catch(err){toast("열기 실패: "+err.message)}e.target.value=""};
    $("#copyCodeBtn").onclick=()=>navigator.clipboard.writeText(generateCode()).then(()=>toast("코드를 복사했습니다."));$("#downloadInoBtn").onclick=()=>download(($("#projectName").value||"esp32cam_rc")+".ino",generateCode(),"text/x-c++src");$("#clearSerialBtn").onclick=()=>$("#serialOutput").textContent="";
    $("#projectName").onchange=saveLocal;
  }

  document.addEventListener("DOMContentLoaded",()=>{initSettings();initBlockly();bindUi();initPwaInstall();initResponsiveViewport();setSidePanelCollapsed(localStorage.getItem(SIDE_PANEL_KEY)==="1",false);updateWifiName();updateCode();if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{})});
})();
