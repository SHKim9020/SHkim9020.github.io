const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

test("AI toolbox exposes classroom speech blocks", () => {
  assert.match(app, /name: "인공지능", colour: "315"/);
  for (const type of ["speech_wake_word", "speech_when_heard", "speech_result", "speech_number", "speech_speak", "speech_stop"]) {
    assert.match(app, new RegExp(`type: "${type}"`));
  }
  assert.match(app, /text: "지니야"/);
  assert.match(app, /text: "선풍기 1단 켜"/);
  assert.match(app, /🎤 호출어 %1 → %2초 대기/);
  assert.match(app, /inputsInline: true/);
});

test("AI speech runs browser events and existing USB motor blocks", () => {
  assert.match(html, /id="aiRunBtn"[^>]*>④ AI 음성 실행/);
  assert.match(app, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(app, /speechRecognition\.lang = "ko-KR"/);
  assert.match(app, /handleSpeechResult\(event\.results\[index\]\[0\]\.transcript\)/);
  assert.match(app, /executeChain\(block\?\.getNextBlock\(\)\)/);
  assert.match(app, /case "dc_motor_pwm":[\s\S]*sendAction\("PW"/);
});

test("wake word gates commands and returns to wake-word waiting", () => {
  assert.match(app, /function wakeWordBlocks\(\)/);
  assert.match(app, /function openSpeechCommandWindow\(block\)/);
  assert.match(app, /if \(!speechCommandIsActive\(\)\)/);
  assert.match(app, /commandText = heard\.replace\(wake\.word, ""\)/);
  assert.match(app, /closeSpeechCommandWindow\("명령을 실행 중입니다\."\)/);
  assert.match(app, /showWakeWordWaiting\(\)/);
  assert.match(app, /speechActiveWakeBlock = block/);
  assert.match(app, /if \(wakeBlock\?\.getNextBlock\(\)\)/);
  assert.match(app, /enqueueSpeechChain\(wakeBlock/);
  assert.match(app, /hasCommandBlock && !hasWakeChain/);
});

test("AI blocks are represented in generated Arduino C++", () => {
  assert.match(app, /String aiSpeechResult = ""/);
  assert.match(app, /double aiSpeechNumber = 0/);
  assert.match(app, /void handleAiSpeech\(const String &recognizedText\)/);
  assert.match(app, /body \+= cppChain\(block\.getNextBlock\(\), "  "\)/);
  assert.match(app, /recognizedText\.indexOf/);
  assert.match(app, /case "speech_result": return "aiSpeechResult"/);
  assert.match(app, /AI 음성 명령은 웹앱에서 감지되어 handleAiSpeech/);
});

test("AI chat tab shows recognized speech, command status, and spoken replies", () => {
  assert.match(html, /data-tab="chat"[^>]*>AI 채팅/);
  assert.match(html, /id="speechChatLog"/);
  assert.match(html, /id="clearSpeechChatBtn"/);
  assert.match(app, /appendSpeechChat\("user", lastSpeechText\)/);
  assert.match(app, /appendSpeechChat\("system", `명령 실행/);
  assert.match(app, /appendSpeechChat\("assistant", spokenText\)/);
});

test("speech result, number extraction, TTS, and standalone warning are present", () => {
  assert.match(app, /case "speech_result": return lastSpeechText/);
  assert.match(app, /case "speech_number": return lastSpeechNumber/);
  assert.match(app, /new SpeechSynthesisUtterance/);
  assert.match(app, /AI 음성인식 블록은 브라우저의 마이크가 필요합니다/);
  assert.match(sw, /onemaker-arduino-studio-1\.4\.9/);
});
