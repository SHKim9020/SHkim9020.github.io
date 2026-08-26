#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include "mbedtls/base64.h"

// OneMaker ESP32-CAM RC Runtime 0.1.8 — AI Thinker + L9110S/MX1508
static const char *PROGRAM_PATH = "/rc-program.json";
static const char *WIFI_PASSWORD = "onemaker1";
static const int FLASH_LED = 4;
static const unsigned long REMOTE_WATCHDOG_MS = 900;
static const int MOTOR_PWM_FREQ = 18000;
static const int MOTOR_PWM_BITS = 8;
static const int MOTOR_CHANNELS[4] = {4, 5, 6, 7};

// AI Thinker ESP32-CAM camera pins
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

struct RcConfig {
  int in1=12, in2=13, in3=14, in4=15;
  bool invertLeft=true, invertRight=true;
  String frameSize="QVGA";
  int quality=12;
  bool flip=false;
};

RcConfig config;
WebServer webServer(80);
httpd_handle_t streamServer=nullptr;
JsonDocument activeDocument;
String uploadBuffer;
size_t uploadExpected=0;
int uploadNextIndex=0;
int carNumber=1;
TaskHandle_t programTaskHandle=nullptr;
TaskHandle_t handlerTaskHandle=nullptr;
String pendingHandlerDirection;
volatile bool remoteUiSpeedActive=false;
volatile int remoteUiLeftSpeed=150;
volatile int remoteUiRightSpeed=150;
volatile bool programTaskStop=false;
volatile unsigned long lastRemoteAt=0;
volatile bool remoteMoving=false;
double variables[20]={0};
String variableNames[20];
int variableCount=0;
int attachedMotorPins[4]={-1,-1,-1,-1};
bool cameraReady=false;
String cameraError;

static const char REMOTE_PAGE[] PROGMEM = R"HTML(
<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="theme-color" content="#07121f"><title>OneMaker 영상탐사 RC카</title><style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0;min-height:100%;background:#07121f;color:#e9f6ff;font-family:system-ui,sans-serif;touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;overscroll-behavior:none}main{max-width:680px;margin:auto;padding:12px}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.top h1{font-size:18px;margin:0}.top span{font-size:10px;color:#75dce8}.video{position:relative;background:#02070d;border:1px solid #28475b;border-radius:17px;overflow:hidden;aspect-ratio:4/3;display:grid;place-items:center}.video img{width:100%;height:100%;object-fit:contain}.hud{position:absolute;inset:10px 12px auto;display:flex;justify-content:space-between;font:700 10px monospace;text-shadow:0 1px 4px #000}.hud i{color:#ff6370}.controls{margin-top:10px;background:#101f2d;border:1px solid #284052;border-radius:17px;padding:12px}.speed{display:grid;grid-template-columns:42px 1fr 35px;gap:8px;align-items:center;font-size:11px}.speed input{width:100%;accent-color:#22c5dc}.speed output{font-weight:900;color:#5fe5f2}.pad{display:grid;grid-template:64px 64px 64px/repeat(3,78px);gap:7px;justify-content:center;margin:9px auto}button{border:0;border-radius:15px;background:#21384a;color:#e9f6ff;font-size:25px;font-weight:900;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;box-shadow:inset 0 -3px #152938}.up{grid-column:2}.left{grid-row:2;grid-column:1}.stop{grid-row:2;grid-column:2;background:#5b2630;color:#ffced2}.right{grid-row:2;grid-column:3}.down{grid-row:3;grid-column:2}button small{display:block;font-size:9px}.on{outline:3px solid #4fe5ef;background:#205568}.resolution{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}.resolution button{font-size:10px;padding:9px 3px;background:#18384b}.resolution button.on{outline:2px solid #4fe5ef;background:#087fc5}.tools{display:flex;justify-content:center;gap:8px}.tools button{font-size:11px;padding:9px 12px;background:#1a3041}.status{text-align:center;font-size:10px;color:#8ba5b4;margin:7px}.landscape{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:10px}@media(max-width:620px){.landscape{display:block}}@media(orientation:landscape) and (max-height:560px){main{max-width:100%;padding:6px}.landscape{display:grid;grid-template-columns:minmax(0,1fr) 290px}.video{max-height:calc(100vh - 48px)}.top{margin-bottom:4px}.controls{margin-top:0}.pad{grid-template:55px 55px 55px/repeat(3,74px)}}
</style></head><body><main><div class="top"><h1>📹 OneMaker 영상탐사 RC카</h1><span id="net">● Wi‑Fi 연결됨</span></div><div class="landscape"><div class="video"><img id="stream" alt="ESP32-CAM 실시간 영상"><div class="hud"><i>● LIVE</i><b id="motion">정지</b></div></div><section class="controls"><label class="speed">왼쪽<input id="leftSpeed" type="range" min="0" max="255" value="150"><output id="lv">150</output></label><label class="speed">오른쪽<input id="rightSpeed" type="range" min="0" max="255" value="150"><output id="rv">150</output></label><div class="pad"><button class="up" data-dir="forward">▲<small>전진</small></button><button class="left" data-dir="left">◀<small>좌회전</small></button><button class="stop" data-dir="stop">■<small>정지</small></button><button class="right" data-dir="right">▶<small>우회전</small></button><button class="down" data-dir="backward">▼<small>후진</small></button></div><div class="resolution"><button data-frame="QQVGA">빠름<br>160×120</button><button data-frame="QVGA" class="on">권장<br>320×240</button><button data-frame="VGA">고화질<br>640×480</button></div><div class="tools"><button id="flash">💡 조명</button><button id="flip">🔄 화면회전</button></div><p class="status">버튼을 누르는 동안만 움직이며 연결이 끊기면 자동 정지합니다.</p></section></div></main><script>
const $=s=>document.querySelector(s),L=$('#leftSpeed'),R=$('#rightSpeed');$('#stream').src='http://'+location.hostname+':81/stream';let held='stop',timer=null,speedTimer=null,light=false,flipped=false,size='QVGA';const labels={forward:'전진 중',backward:'후진 중',left:'좌회전 중',right:'우회전 중',stop:'정지'};function speedInput(output,value){$(output).value=value;clearTimeout(speedTimer);speedTimer=setTimeout(()=>{if(held!=='stop'){show(held);send(held)}},70)}L.oninput=()=>speedInput('#lv',L.value);R.oninput=()=>speedInput('#rv',R.value);
fetch('/api/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{$('#net').textContent=s.camera?'● 카메라 정상':'● 카메라 오류 '+s.cameraError;if(!s.camera){$('#stream').alt='카메라 초기화 실패: '+s.cameraError}}).catch(()=>$('#net').textContent='● 상태 확인 실패');
function call(path){return fetch(path,{cache:'no-store'}).catch(()=>$('#net').textContent='● 연결 확인')}
function show(d){$('#motion').textContent=labels[d]+(d==='stop'?'':' · L'+L.value+' R'+R.value);document.querySelectorAll('[data-dir]').forEach(b=>b.classList.toggle('on',b.dataset.dir===d))}
function send(d){return call('/api/drive?dir='+d+'&left='+L.value+'&right='+R.value)}
function press(d){if(d==='stop')return release(true);if(held===d)return;release(false);held=d;show(d);send(d);timer=setInterval(()=>call('/api/heartbeat'),350)}
function release(force=false){if(timer)clearInterval(timer);timer=null;const moving=held!=='stop';held='stop';show('stop');if(moving||force)send('stop')}
document.addEventListener('contextmenu',e=>{if(e.target.closest?.('button'))e.preventDefault()});document.addEventListener('selectstart',e=>{if(e.target.closest?.('button'))e.preventDefault()});document.querySelectorAll('[data-dir]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);press(b.dataset.dir)};if(b.dataset.dir!=='stop'){b.onpointerup=()=>release();b.onpointercancel=()=>release();b.onpointerleave=e=>{if(e.buttons)release()}}});
$('#flash').onclick=()=>{light=!light;call('/api/flash?on='+(light?1:0))};$('#flip').onclick=()=>{flipped=!flipped;call('/api/flip?on='+(flipped?1:0))};document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>{size=b.dataset.frame;document.querySelectorAll('[data-frame]').forEach(x=>x.classList.toggle('on',x===b));call('/api/frame?size='+size)});addEventListener('pagehide',()=>navigator.sendBeacon('/api/stop'));document.addEventListener('visibilitychange',()=>{if(document.hidden)release(true)});
</script></body></html>
)HTML";

String twoDigits(){char out[3];snprintf(out,sizeof(out),"%02d",carNumber);return String(out);}
String wifiName(){return String("OneMaker-RC-")+twoDigits();}
void emit(const String &type,const String &message=""){JsonDocument d;d["type"]=type;if(message.length())d["message"]=message;serializeJson(d,Serial);Serial.println();}
void ack(const String &message="ok"){emit("ack",message);}

void setupMotorOutputs(){
  const int pins[4]={config.in1,config.in2,config.in3,config.in4};
  for(int i=0;i<4;i++){
    if(attachedMotorPins[i]>=0&&attachedMotorPins[i]!=pins[i])ledcDetachPin(attachedMotorPins[i]);
    ledcSetup(MOTOR_CHANNELS[i],MOTOR_PWM_FREQ,MOTOR_PWM_BITS);
    ledcAttachPin(pins[i],MOTOR_CHANNELS[i]);
    ledcWrite(MOTOR_CHANNELS[i],0);
    attachedMotorPins[i]=pins[i];
  }
}
void writeMotor(int channelA,int channelB,int value){
  value=constrain(value,-255,255);
  if(value>0){ledcWrite(channelA,value);ledcWrite(channelB,0);}
  else if(value<0){ledcWrite(channelA,0);ledcWrite(channelB,-value);}
  else{ledcWrite(channelA,0);ledcWrite(channelB,0);}
}
void setMotors(int left,int right){if(config.invertLeft)left=-left;if(config.invertRight)right=-right;writeMotor(MOTOR_CHANNELS[0],MOTOR_CHANNELS[1],left);writeMotor(MOTOR_CHANNELS[2],MOTOR_CHANNELS[3],right);}
void stopCar(){setMotors(0,0);remoteMoving=false;}
void drive(const String &dir,int leftSpeed,int rightSpeed){
  leftSpeed=constrain(leftSpeed,0,255);rightSpeed=constrain(rightSpeed,0,255);
  if(dir=="forward")setMotors(leftSpeed,rightSpeed);
  else if(dir=="backward")setMotors(-leftSpeed,-rightSpeed);
  else if(dir=="left")setMotors(-leftSpeed,rightSpeed);
  else if(dir=="right")setMotors(leftSpeed,-rightSpeed);
  else stopCar();
  if(dir!="stop"){remoteMoving=true;lastRemoteAt=millis();}
}

framesize_t parseFrameSize(const String &value){if(value=="QQVGA")return FRAMESIZE_QQVGA;if(value=="QVGA")return FRAMESIZE_QVGA;if(value=="SVGA")return FRAMESIZE_SVGA;return FRAMESIZE_VGA;}
void applyCameraSettings(){sensor_t *s=esp_camera_sensor_get();if(!s)return;s->set_framesize(s,parseFrameSize(config.frameSize));s->set_quality(s,constrain(config.quality,8,30));s->set_vflip(s,config.flip?1:0);s->set_hmirror(s,config.flip?1:0);}
bool setupCamera(){
  camera_config_t c={};c.ledc_channel=LEDC_CHANNEL_0;c.ledc_timer=LEDC_TIMER_0;c.pin_d0=Y2_GPIO_NUM;c.pin_d1=Y3_GPIO_NUM;c.pin_d2=Y4_GPIO_NUM;c.pin_d3=Y5_GPIO_NUM;c.pin_d4=Y6_GPIO_NUM;c.pin_d5=Y7_GPIO_NUM;c.pin_d6=Y8_GPIO_NUM;c.pin_d7=Y9_GPIO_NUM;c.pin_xclk=XCLK_GPIO_NUM;c.pin_pclk=PCLK_GPIO_NUM;c.pin_vsync=VSYNC_GPIO_NUM;c.pin_href=HREF_GPIO_NUM;c.pin_sccb_sda=SIOD_GPIO_NUM;c.pin_sccb_scl=SIOC_GPIO_NUM;c.pin_pwdn=PWDN_GPIO_NUM;c.pin_reset=RESET_GPIO_NUM;c.xclk_freq_hz=20000000;c.pixel_format=PIXFORMAT_JPEG;c.frame_size=FRAMESIZE_QVGA;c.jpeg_quality=12;c.fb_count=psramFound()?2:1;c.grab_mode=CAMERA_GRAB_LATEST;c.fb_location=psramFound()?CAMERA_FB_IN_PSRAM:CAMERA_FB_IN_DRAM;
  esp_err_t err=esp_camera_init(&c);if(err!=ESP_OK){cameraReady=false;cameraError=String("0x")+String(err,HEX);emit("error",String("camera ")+cameraError);return false;}cameraReady=true;cameraError="";applyCameraSettings();return true;
}

static esp_err_t streamHandler(httpd_req_t *req){
  if(!cameraReady){httpd_resp_set_status(req,"503 Service Unavailable");return httpd_resp_sendstr(req,"Camera initialization failed");}
  esp_err_t result=httpd_resp_set_type(req,"multipart/x-mixed-replace;boundary=frame");if(result!=ESP_OK)return result;httpd_resp_set_hdr(req,"Access-Control-Allow-Origin","*");
  char header[96];while(true){camera_fb_t *fb=esp_camera_fb_get();if(!fb){delay(30);continue;}size_t hlen=snprintf(header,sizeof(header),"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",fb->len);result=httpd_resp_send_chunk(req,header,hlen);if(result==ESP_OK)result=httpd_resp_send_chunk(req,(const char*)fb->buf,fb->len);if(result==ESP_OK)result=httpd_resp_send_chunk(req,"\r\n",2);esp_camera_fb_return(fb);if(result!=ESP_OK)break;delay(1);}return result;
}
void startStreamServer(){httpd_config_t cfg=HTTPD_DEFAULT_CONFIG();cfg.server_port=81;cfg.ctrl_port=32769;httpd_uri_t stream={.uri="/stream",.method=HTTP_GET,.handler=streamHandler,.user_ctx=nullptr};if(httpd_start(&streamServer,&cfg)==ESP_OK)httpd_register_uri_handler(streamServer,&stream);}

int variableIndex(const String &name){for(int i=0;i<variableCount;i++)if(variableNames[i]==name)return i;if(variableCount<20){variableNames[variableCount]=name;return variableCount++;}return 0;}
double eval(JsonVariantConst e){
  if(e.isNull())return 0;String type=e["type"]|"number";
  if(type=="number")return e["value"]|0.0;if(type=="boolean")return (bool)(e["value"]|false);if(type=="variable")return variables[variableIndex(e["name"]|"")];if(type=="random"){int a=(int)eval(e["from"]),b=(int)eval(e["to"]);if(a>b){int t=a;a=b;b=t;}return random(a,b+1);}double a=eval(e["a"]),b=eval(e["b"]);String op=e["op"]|"";
  if(type=="math"){if(op=="ADD")return a+b;if(op=="MINUS")return a-b;if(op=="MULTIPLY")return a*b;if(op=="DIVIDE")return b==0?0:a/b;}
  if(type=="compare"){if(op=="EQ")return a==b;if(op=="NEQ")return a!=b;if(op=="LT")return a<b;if(op=="LTE")return a<=b;if(op=="GT")return a>b;if(op=="GTE")return a>=b;}
  if(type=="logic")return op=="AND"?(a&&b):(a||b);return 0;
}
String evalText(JsonVariantConst e){if(String(e["type"]|"")=="text")return e["value"]|"";return String(eval(e));}
bool executeSteps(JsonArrayConst steps){
  for(JsonObjectConst s:steps){if(programTaskStop)return false;String op=s["op"]|"";
    if(op=="drive"){int speed=(int)eval(s["speed"]);drive(s["dir"]|"stop",remoteUiSpeedActive?remoteUiLeftSpeed:speed,remoteUiSpeedActive?remoteUiRightSpeed:speed);}
    else if(op=="motors"){if(remoteUiSpeedActive)drive(pendingHandlerDirection,remoteUiLeftSpeed,remoteUiRightSpeed);else setMotors((int)eval(s["left"]),(int)eval(s["right"]));}
    else if(op=="stop")stopCar();
    else if(op=="flash")digitalWrite(FLASH_LED,(bool)(s["on"]|false));
    else if(op=="cameraFrame"){config.frameSize=(const char*)(s["size"]|"QVGA");applyCameraSettings();}
    else if(op=="cameraFlip"){config.flip=s["on"]|false;applyCameraSettings();}
    else if(op=="wait"){unsigned long total=constrain((long)eval(s["ms"]),0L,60000L),start=millis();while(millis()-start<total){if(programTaskStop)return false;delay(10);}}
    else if(op=="print")Serial.println(evalText(s["value"]));
    else if(op=="setVar")variables[variableIndex(s["name"]|"")]=eval(s["value"]);
    else if(op=="changeVar")variables[variableIndex(s["name"]|"")]+=eval(s["value"]);
    else if(op=="repeat"){int count=constrain((int)eval(s["times"]),0,10000);for(int i=0;i<count;i++)if(!executeSteps(s["steps"].as<JsonArrayConst>()))return false;}
    else if(op=="if"){if(eval(s["condition"]))executeSteps(s["then"].as<JsonArrayConst>());else executeSteps(s["else"].as<JsonArrayConst>());}
    delay(1);
  }return true;
}
void programTask(void*){programTaskStop=false;executeSteps(activeDocument["program"]["start"].as<JsonArrayConst>());JsonArrayConst forever=activeDocument["program"]["forever"].as<JsonArrayConst>();while(!programTaskStop&&forever.size()){executeSteps(forever);delay(1);}programTaskHandle=nullptr;vTaskDelete(nullptr);}
void stopRemoteHandler(){remoteUiSpeedActive=false;if(handlerTaskHandle){vTaskDelete(handlerTaskHandle);handlerTaskHandle=nullptr;}}
void stopProgram(){programTaskStop=true;delay(2);if(programTaskHandle){vTaskDelete(programTaskHandle);programTaskHandle=nullptr;}stopCar();}
void startProgram(){stopRemoteHandler();stopProgram();programTaskStop=false;memset(variables,0,sizeof(variables));variableCount=0;xTaskCreatePinnedToCore(programTask,"rc-program",8192,nullptr,1,&programTaskHandle,0);}

String decodeBase64(const String &encoded){size_t outLen=0,cap=encoded.length();unsigned char *out=(unsigned char*)malloc(cap+1);if(!out)return"";int result=mbedtls_base64_decode(out,cap,&outLen,(const unsigned char*)encoded.c_str(),encoded.length());String decoded;if(result==0){out[outLen]=0;decoded=String((char*)out).substring(0,outLen);}free(out);return decoded;}
void applyConfig(JsonObjectConst c){JsonObjectConst p=c["pins"];config.in1=p["in1"]|12;config.in2=p["in2"]|13;config.in3=p["in3"]|14;config.in4=p["in4"]|15;config.invertLeft=c["invertLeft"]|true;config.invertRight=c["invertRight"]|true;JsonObjectConst cam=c["camera"];config.frameSize=(const char*)(cam["frameSize"]|"QVGA");config.quality=cam["quality"]|12;config.flip=cam["flip"]|false;setupMotorOutputs();stopCar();applyCameraSettings();}
bool loadProgram(){if(!LittleFS.exists(PROGRAM_PATH))return false;File f=LittleFS.open(PROGRAM_PATH,"r");DeserializationError e=deserializeJson(activeDocument,f);f.close();if(e)return false;applyConfig(activeDocument["config"]);return true;}
bool saveUploadedProgram(){JsonDocument test;DeserializationError e=deserializeJson(test,uploadBuffer);if(e){emit("error",String("JSON: ")+e.c_str());return false;}File f=LittleFS.open(PROGRAM_PATH,"w");if(!f){emit("error","file open");return false;}f.print(uploadBuffer);f.close();activeDocument.clear();deserializeJson(activeDocument,uploadBuffer);applyConfig(activeDocument["config"]);return true;}

void remoteHandlerTask(void*){String dir=pendingHandlerDirection;remoteUiSpeedActive=true;JsonArrayConst h=activeDocument["program"]["handlers"][dir].as<JsonArrayConst>();executeSteps(h);remoteUiSpeedActive=false;handlerTaskHandle=nullptr;vTaskDelete(nullptr);}
void runRemoteHandler(const String &dir){JsonArrayConst h=activeDocument["program"]["handlers"][dir].as<JsonArrayConst>();if(h.isNull()||!h.size())return;stopRemoteHandler();programTaskStop=false;pendingHandlerDirection=dir;xTaskCreatePinnedToCore(remoteHandlerTask,"rc-handler",6144,nullptr,2,&handlerTaskHandle,0);}
void setupWebRoutes(){
  webServer.on("/",HTTP_GET,[](){webServer.send_P(200,"text/html; charset=utf-8",REMOTE_PAGE);});
  webServer.on("/api/status",HTTP_GET,[](){JsonDocument d;d["camera"]=cameraReady;d["cameraError"]=cameraError;d["frameSize"]=config.frameSize;d["psram"]=psramFound();d["freeHeap"]=ESP.getFreeHeap();d["wifi"]=wifiName();d["ip"]=WiFi.softAPIP().toString();String out;serializeJson(d,out);webServer.send(200,"application/json",out);});
  webServer.on("/api/drive",HTTP_GET,[](){String dir=webServer.arg("dir");int l=constrain(webServer.arg("left").toInt(),0,255),r=constrain(webServer.arg("right").toInt(),0,255);stopProgram();stopRemoteHandler();remoteUiLeftSpeed=l;remoteUiRightSpeed=r;if(dir=="stop")stopCar();else drive(dir,l,r);runRemoteHandler(dir);webServer.send(200,"application/json","{\"ok\":true}");});
  webServer.on("/api/heartbeat",HTTP_GET,[](){lastRemoteAt=millis();webServer.send(200,"application/json","{\"ok\":true}");});
  webServer.on("/api/stop",HTTP_ANY,[](){stopProgram();stopRemoteHandler();stopCar();webServer.send(200,"application/json","{\"ok\":true}");});
  webServer.on("/api/flash",HTTP_GET,[](){digitalWrite(FLASH_LED,webServer.arg("on")=="1");webServer.send(200,"application/json","{\"ok\":true}");});
  webServer.on("/api/flip",HTTP_GET,[](){config.flip=webServer.arg("on")=="1";applyCameraSettings();webServer.send(200,"application/json","{\"ok\":true}");});
  webServer.on("/api/frame",HTTP_GET,[](){config.frameSize=webServer.arg("size");applyCameraSettings();webServer.send(200,"application/json","{\"ok\":true}");});
  webServer.onNotFound([](){webServer.sendHeader("Location","/");webServer.send(302);});webServer.begin();
}
void startWifi(){WiFi.mode(WIFI_AP);WiFi.setSleep(false);WiFi.setTxPower(WIFI_POWER_19_5dBm);WiFi.softAP(wifiName().c_str(),WIFI_PASSWORD,1,false,4);setupWebRoutes();startStreamServer();emit("wifi",wifiName()+" / http://192.168.4.1");}

void handleSerialLine(const String &line){
  JsonDocument d;DeserializationError e=deserializeJson(d,line);if(e){emit("error","JSON command");return;}String cmd=d["cmd"]|"";
  if(cmd=="hello"){stopProgram();stopCar();JsonDocument info;info["type"]="info";info["runtime"]="0.1.8";info["board"]="ESP32-CAM AI Thinker";info["wifi"]=wifiName();serializeJson(info,Serial);Serial.println();return;}
  if(cmd=="stop"){stopProgram();ack("stopped");return;}
  if(cmd=="drive"){drive(d["dir"]|"stop",d["speed"]|150,d["speed"]|150);ack();return;}
  if(cmd=="setNumber"){int n=d["number"]|1;if(n<1||n>16){emit("error","number 1-16");return;}Preferences p;p.begin("onemaker-rc",false);p.putUChar("number",n);p.end();ack("number saved");delay(200);ESP.restart();return;}
  if(cmd=="uploadBegin"){stopProgram();uploadExpected=d["size"]|0;uploadBuffer="";uploadBuffer.reserve(uploadExpected+16);uploadNextIndex=0;ack();return;}
  if(cmd=="uploadChunk"){int index=d["index"]|-1;if(index!=uploadNextIndex){emit("error","chunk index");return;}uploadBuffer+=decodeBase64(d["data"]|"");uploadNextIndex++;ack();return;}
  if(cmd=="uploadEnd"){if(uploadBuffer.length()!=uploadExpected){emit("error","upload size");return;}if(saveUploadedProgram()){emit("uploadDone","saved");startProgram();}return;}
  emit("error","unknown command");
}

void setup(){
  setupMotorOutputs();stopCar();Serial.begin(115200);delay(100);pinMode(FLASH_LED,OUTPUT);digitalWrite(FLASH_LED,LOW);Preferences p;p.begin("onemaker-rc",true);carNumber=p.getUChar("number",1);p.end();if(carNumber<1||carNumber>16)carNumber=1;
  LittleFS.begin(true);setupCamera();loadProgram();startWifi();bool usbCommandWaiting=false;unsigned long safetyStart=millis();while(millis()-safetyStart<5000){if(Serial.available()){usbCommandWaiting=true;break;}delay(10);}if(activeDocument.size()&&!usbCommandWaiting)startProgram();else stopCar();emit("ready",String("OneMaker ESP32-CAM RC Runtime 0.1.8 / camera ")+(cameraReady?"OK":cameraError));
}
void loop(){
  webServer.handleClient();if(remoteMoving&&millis()-lastRemoteAt>REMOTE_WATCHDOG_MS){stopRemoteHandler();stopCar();}static String input;while(Serial.available()){char c=Serial.read();if(c=='\n'){input.trim();if(input.length())handleSerialLine(input);input="";}else if(c!='\r'&&input.length()<2048)input+=c;}delay(2);
}
