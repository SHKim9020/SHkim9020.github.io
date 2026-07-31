# OneMaker Arduino UNO·Nano Studio

Arduino UNO R3와 ATmega328P Nano를 위한 수업용 Blockly 웹앱입니다.

## 실행 방식

1. 보드당 처음 한 번 브라우저에서 `OneMaker Arduino Runtime` HEX를 설치합니다.
2. Web Serial로 USB를 연결합니다.
3. `보드에 저장·실행`을 누르면 블록이 작은 보드 명령으로 변환되어 UNO·Nano의 EEPROM에 저장됩니다.
4. 저장이 끝나면 프로그램이 즉시 실행되며, USB를 분리한 뒤에도 전원만 연결하면 자동 실행됩니다.
5. I²C LCD, NeoPixel, MP3, Bluetooth를 포함한 지원 블록이 모두 같은 방식으로 웹에서 바로 저장됩니다.

브라우저에서 55MB 규모의 AVR 컴파일러를 내려받지 않습니다. 런타임은 보드당 처음 한 번만 설치하고, 이후 블록 프로그램은 보통 수 초 안에 저장합니다. EEPROM 프로그램 공간은 최대 1,015바이트이므로 수업용 중소 규모 프로젝트에 적합합니다. 더 큰 프로젝트나 직접 작성한 C++ 라이브러리가 필요하면 `텍스트 코드 → INO 다운로드` 후 Arduino IDE를 사용합니다.

오른쪽의 보드·빠른 테스트·텍스트 코드·시리얼 모니터 패널은 `접기` 버튼으로 축소할 수 있으며 선택 상태는 브라우저에 저장됩니다.

## 지원 블록

- 입력: 조도센서, 토양수분센서, 가변저항, 푸시버튼, HC-SR04, DHT11/DHT22, GP2Y1010 계열 미세먼지센서
- 출력: 디지털 LED, PWM LED, DC모터 드라이버, Servo, 피에조
- 표시·미디어: I²C LCD 16×2/20×4, NeoPixel, DFPlayer Mini
- 통신: USB Serial, HC-05/HC-06 SoftwareSerial Bluetooth
- 코딩: 시작, 계속 실행, 반복, 조건, 연산, 변수, 내 블록, 값 내 블록

## 기본 핀 원칙

- D0·D1: USB Serial용이므로 블록 핀 목록에서 제외
- PWM: D3, D5, D6, D9, D10, D11
- I²C LCD: A4 SDA, A5 SCL
- 아날로그 입력: A0~A5
- Bluetooth와 DFPlayer를 동시에 사용할 때는 서로 다른 RX/TX 핀을 사용
- Servo 라이브러리는 Timer1을 사용하므로 D9·D10 PWM과 동시에 사용할 때 주의

## 펌웨어 빌드

`arduino-studio/firmware/onemaker_runtime/onemaker_runtime.ino`를 GitHub Actions에서 UNO용으로 컴파일하여 `arduino-studio/firmware/onemaker_runtime.hex`를 생성합니다. UNO, Nano, Nano 구형 부트로더는 같은 ATmega328P 애플리케이션 HEX를 사용하며 업로더의 통신 속도만 다릅니다.

웹앱 경로: `/arduino-studio/`
