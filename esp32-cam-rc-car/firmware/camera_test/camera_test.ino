#include <Arduino.h>
#include <WiFi.h>
#include "esp_camera.h"
#include "esp_http_server.h"

static const char *AP_NAME = "OneMaker-CAM-TEST";
static const char *AP_PASSWORD = "onemaker1";

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

httpd_handle_t pageServer = nullptr;
httpd_handle_t streamServer = nullptr;
bool cameraReady = false;
String cameraError;
String activeFrameSize = "QVGA";

static const char PAGE[] PROGMEM = R"HTML(
<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneMaker ESP32-CAM Test</title><style>
*{box-sizing:border-box}body{margin:0;background:#07121f;color:#e9f6ff;font-family:system-ui,sans-serif}main{max-width:720px;margin:auto;padding:16px}h1{font-size:22px;margin:0 0 8px}.status,.settings{padding:12px;border-radius:12px;background:#13283a;margin-bottom:12px}.ok{color:#54e5ac}.bad{color:#ff818d}.settings b{display:block;margin-bottom:10px}.buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}button{border:1px solid #315d7a;border-radius:10px;background:#18364b;color:#dceeff;padding:11px 5px;font-weight:800;cursor:pointer}button.active{border-color:#35ddff;background:#087fc5;color:#fff}.hint{display:block;margin-top:9px;color:#9fb6c8}.video{width:100%;aspect-ratio:4/3;object-fit:contain;background:#000;border:1px solid #315066;border-radius:16px}a{display:block;margin-top:12px;padding:12px;text-align:center;border-radius:12px;background:#1677ff;color:#fff;text-decoration:none;font-weight:800}small{display:block;color:#9fb6c8;margin-top:12px;line-height:1.6}@media(max-width:480px){.buttons{grid-template-columns:1fr}button{font-size:15px}}
</style></head><body><main><h1>📷 ESP32-CAM 카메라 전용 테스트</h1><div id="status" class="status">카메라 상태 확인 중…</div><section class="settings"><b>영상 해상도</b><div class="buttons"><button data-size="QQVGA">빠름<br>160×120</button><button data-size="QVGA">권장<br>320×240</button><button data-size="VGA">고화질<br>640×480</button></div><span id="hint" class="hint">RC카 조종에는 320×240을 권장합니다.</span></section><img id="video" class="video" alt="ESP32-CAM 영상"><a href="/capture.jpg" target="_blank">사진 한 장 열기</a><small>Wi-Fi: OneMaker-CAM-TEST<br>주소: http://192.168.4.1<br>해상도가 높을수록 영상 움직임이 느려질 수 있습니다.</small></main><script>
const statusEl=document.querySelector('#status'),video=document.querySelector('#video'),hint=document.querySelector('#hint');function mark(size){document.querySelectorAll('[data-size]').forEach(b=>b.classList.toggle('active',b.dataset.size===size))}function startVideo(){video.src='http://'+location.hostname+':81/stream?t='+Date.now()}fetch('/status').then(r=>r.json()).then(s=>{if(s.camera){statusEl.classList.add('ok');statusEl.textContent='● 카메라 정상 · '+s.size+' · PSRAM '+(s.psram?'정상':'없음');mark(s.size);startVideo()}else{statusEl.classList.add('bad');statusEl.textContent='● 카메라 초기화 실패: '+s.error}}).catch(()=>statusEl.textContent='상태 확인 실패');document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{hint.textContent='해상도 변경 중…';fetch('/settings?size='+b.dataset.size).then(r=>{if(!r.ok)throw Error();return r.json()}).then(s=>{mark(s.size);statusEl.textContent='● 카메라 정상 · '+s.size;hint.textContent=s.size==='QQVGA'?'가장 빠른 영상 모드입니다.':s.size==='QVGA'?'RC카 조종 권장 모드입니다.':'화질이 높아 영상이 느려질 수 있습니다.';startVideo()}).catch(()=>hint.textContent='해상도 변경에 실패했습니다.')});
</script></body></html>
)HTML";

bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM; c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM; c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  // The camera-only diagnostic prioritizes live frame rate over resolution.
  c.frame_size = FRAMESIZE_QVGA;
  c.jpeg_quality = 15; c.fb_count = psramFound() ? 2 : 1;
  c.grab_mode = CAMERA_GRAB_LATEST; c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) { cameraError = String("0x") + String(err, HEX); return false; }
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor) sensor->set_framesize(sensor, FRAMESIZE_QVGA);
  return true;
}

static esp_err_t pageHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  return httpd_resp_send(req, PAGE, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t statusHandler(httpd_req_t *req) {
  String json = String("{\"camera\":") + (cameraReady ? "true" : "false") + ",\"error\":\"" + cameraError + "\",\"psram\":" + (psramFound() ? "true" : "false") + ",\"size\":\"" + activeFrameSize + "\"}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, json.c_str(), json.length());
}

static esp_err_t settingsHandler(httpd_req_t *req) {
  if (!cameraReady) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Camera failed");
  char query[48] = {};
  char size[16] = {};
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
      httpd_query_key_value(query, "size", size, sizeof(size)) != ESP_OK) {
    return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing size");
  }
  framesize_t frameSize;
  if (!strcmp(size, "QQVGA")) frameSize = FRAMESIZE_QQVGA;
  else if (!strcmp(size, "QVGA")) frameSize = FRAMESIZE_QVGA;
  else if (!strcmp(size, "VGA")) frameSize = FRAMESIZE_VGA;
  else return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid size");
  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor || sensor->set_framesize(sensor, frameSize) != 0) {
    return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Resolution failed");
  }
  activeFrameSize = size;
  String json = String("{\"ok\":true,\"size\":\"") + activeFrameSize + "\"}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_send(req, json.c_str(), json.length());
}

static esp_err_t captureHandler(httpd_req_t *req) {
  if (!cameraReady) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Camera failed");
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Capture failed");
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  esp_err_t result = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return result;
}

static esp_err_t streamHandler(httpd_req_t *req) {
  if (!cameraReady) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Camera failed");
  esp_err_t result = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=frame");
  char header[96];
  while (result == ESP_OK) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) { delay(20); continue; }
    size_t length = snprintf(header, sizeof(header), "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
    result = httpd_resp_send_chunk(req, header, length);
    if (result == ESP_OK) result = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    if (result == ESP_OK) result = httpd_resp_send_chunk(req, "\r\n", 2);
    esp_camera_fb_return(fb);
  }
  return result;
}

void startServers() {
  httpd_config_t pageConfig = HTTPD_DEFAULT_CONFIG();
  pageConfig.server_port = 80;
  httpd_start(&pageServer, &pageConfig);
  httpd_uri_t page = {.uri = "/", .method = HTTP_GET, .handler = pageHandler, .user_ctx = nullptr};
  httpd_uri_t status = {.uri = "/status", .method = HTTP_GET, .handler = statusHandler, .user_ctx = nullptr};
  httpd_uri_t settings = {.uri = "/settings", .method = HTTP_GET, .handler = settingsHandler, .user_ctx = nullptr};
  httpd_uri_t capture = {.uri = "/capture.jpg", .method = HTTP_GET, .handler = captureHandler, .user_ctx = nullptr};
  httpd_register_uri_handler(pageServer, &page);
  httpd_register_uri_handler(pageServer, &status);
  httpd_register_uri_handler(pageServer, &settings);
  httpd_register_uri_handler(pageServer, &capture);

  httpd_config_t streamConfig = HTTPD_DEFAULT_CONFIG();
  streamConfig.server_port = 81;
  streamConfig.ctrl_port += 1;
  httpd_start(&streamServer, &streamConfig);
  httpd_uri_t stream = {.uri = "/stream", .method = HTTP_GET, .handler = streamHandler, .user_ctx = nullptr};
  httpd_register_uri_handler(streamServer, &stream);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  cameraReady = initCamera();
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.softAP(AP_NAME, AP_PASSWORD, 1, false, 4);
  startServers();
  Serial.printf("Camera: %s %s\n", cameraReady ? "OK" : "FAIL", cameraError.c_str());
  Serial.printf("Wi-Fi: %s / http://%s\n", AP_NAME, WiFi.softAPIP().toString().c_str());
}

void loop() { delay(1000); }
