# OneMaker Arduino UNO·Nano Studio

Arduino UNO R3와 ATmega328P Nano를 위한 수업용 Blockly 웹앱입니다.

## 실행 방식

1. 보드당 처음 한 번 브라우저에서 `OneMaker Arduino Runtime` HEX를 설치합니다.
2. Web Serial로 USB를 연결합니다.
3. `보드에 저장·실행`을 누르면 블록이 작은 보드 명령으로 변환되어 UNO·Nano의 EEPROM에 저장됩니다.
4. 저장이 끝나면 프로그램이 즉시 실행되며, USB를 분리한 뒤에도 전원만 연결하면 자동 실행됩니다.
5. I²C LCD, OLED, NeoPixel, MP3, Bluetooth를 포함한 지원 블록이 모두 같은 방식으로 웹에서 바로 저장됩니다.

브라우저에서 55MB 규모의 AVR 컴파일러를 내려받지 않습니다. 런타임은 보드당 처음 한 번만 설치하고, 이후 블록 프로그램은 보통 수 초 안에 저장합니다. EEPROM 프로그램 공간은 최대 1,015바이트이므로 수업용 중소 규모 프로젝트에 적합합니다. 더 큰 프로젝트나 직접 작성한 C++ 라이브러리가 필요하면 `텍스트 코드 → INO 다운로드` 후 Arduino IDE를 사용합니다.

오른쪽의 보드·빠른 테스트·텍스트 코드·시리얼 모니터 패널은 `접기` 버튼으로 축소할 수 있으며 선택 상태는 브라우저에 저장됩니다.

## Android 앱 설치

1. Android Chrome에서 `/arduino-studio/`를 엽니다.
2. 상단의 `앱 설치`를 누르거나 Chrome의 `⋮ → 앱 설치(홈 화면에 추가)`를 선택합니다.
3. 홈 화면에 생성된 OneMaker 아이콘을 누르면 주소창 없는 독립 앱 화면으로 실행됩니다.

PWA 앱은 블록 작성·프로젝트 저장·열기를 지원합니다. Android Chrome은 Web Serial을 지원하지 않으므로 런타임 설치와 USB 보드 저장은 PC 또는 크롬북 Chrome에서 진행해야 합니다.

## 지원 블록

- 입력: 조도센서, 토양수분센서, 가변저항, 디지털 터치센서(HIGH=감지), HC-SR04, DHT11/DHT22, GP2Y1010 계열 미세먼지센서
- 출력: 디지털 LED, PWM LED, DC모터 드라이버, Servo, 피에조
- 표시·미디어: I²C LCD 16×2/20×4, 0.96인치 SSD1306 I²C OLED 128×64, NeoPixel(개별 RGB·전체 8색·밝기), DFPlayer Mini
- AI 카메라: HuskyLens I²C 모드 변경, ID 감지, X/Y 중심·너비·높이 읽기
- 통신: USB Serial, HC-05/HC-06 SoftwareSerial Bluetooth
- 코딩: 시작, 계속 실행, 반복, 조건, 연산, 변수, 내 블록, 값 내 블록

## 기본 핀 원칙

- D0·D1: USB Serial용이므로 블록 핀 목록에서 제외
- PWM: D3, D5, D6, D9, D10, D11
- I²C LCD: A4 SDA, A5 SCL
- HuskyLens: 프로토콜을 I²C로 설정하고 SDA A4, SCL A5, VCC 5V, GND에 연결
- 0.96 OLED: A4 SDA, A5 SCL, 기본 주소 0x3C(일부 제품 0x3D), 글자 크기 1배(행 0~7)·2배(행 0~3), 열 0~15
- OLED의 보드 저장·단독 실행 모드는 Nano 메모리 한계 때문에 숫자와 `. - : %` 기호에 최적화했습니다. INO 다운로드 코드는 영문도 출력할 수 있습니다.
- 아날로그 입력: A0~A5
- Bluetooth 기본 핀은 Arduino RX D2, Arduino TX D3이며 모듈 TX → D2, 모듈 RX ← D3로 교차 연결
- Bluetooth와 DFPlayer를 동시에 사용할 때는 서로 다른 RX/TX 핀을 사용
- Servo 라이브러리는 Timer1을 사용하므로 D9·D10 PWM과 동시에 사용할 때 주의

## DFPlayer Mini MP3

- 기본 핀은 Arduino RX D10, Arduino TX D11입니다.
- DFPlayer TX → Arduino D10(RX), DFPlayer RX ← Arduino D11(TX), VCC → 5V, GND → GND로 연결합니다.
- Arduino TX(D11)와 DFPlayer RX 사이에는 1kΩ 직렬 저항을 권장합니다.
- microSD는 32GB 이하 FAT16/FAT32로 포맷하고, 먼저 시험할 파일을 `0001.mp3`로 저장합니다.
- 런타임 1.1.2부터 시작 블록이 DFPlayer를 리셋하고 약 2.2초 동안 microSD 인식을 기다린 뒤 재생합니다.
- `DFPlayer n번 파일 s초 동안 재생` 블록은 지정한 파일을 재생하고 시간이 지나면 자동으로 정지합니다.
- 빠른 테스트 탭의 `초기화 후 재생`으로 배선과 파일을 먼저 확인할 수 있습니다.

## Bluetooth

- HC-05/HC-06을 SoftwareSerial로 시작하고 수신 여부·수신값·n번째 문자·값 비교·줄바꿈 전송·이어 전송 블록을 사용할 수 있습니다.
- HC-06 이름 변경은 일반적으로 다른 장치와 연결되지 않은 상태에서 9600bps로 실행합니다.
- HC-05 이름 변경은 KEY/EN을 활성화한 AT 모드(일반적으로 38400bps)가 필요합니다.
- 이름 변경 방식과 통신 속도는 모듈 펌웨어에 따라 다를 수 있으므로 모듈 설명서도 확인하세요.

## 터치센서

- 기존 `푸시버튼` 블록의 프로젝트 호환 ID를 유지한 채 화면 이름과 동작을 `터치센서`로 변경했습니다.
- 센서 OUT을 선택한 디지털 핀에 연결하며, 읽은 값이 `1(HIGH)`일 때 참입니다.
- 기존 프로젝트를 열어도 블록은 유지되지만 새 동작을 보드에 반영하려면 최신 런타임 1.1.7 설치 후 다시 저장해야 합니다.

## HuskyLens

- ESP32 Boat Studio와 동일하게 물체 추적·물체 인식·색상 인식·선 추적·얼굴 인식·태그 인식·물체 분류 모드를 지원합니다.
- `HuskyLens ID n 보임?` 블록으로 학습한 ID를 조건에 사용할 수 있습니다.
- `HuskyLens ID n의 X 중심/Y 중심/너비/높이` 블록으로 인식 결과를 숫자로 읽습니다.
- UNO·Nano 런타임 1.1.7에는 메모리 사용량을 줄인 HuskyLens I²C 통신 코드가 포함됩니다.

## 펌웨어 빌드

`arduino-studio/firmware/onemaker_runtime/onemaker_runtime.ino`를 GitHub Actions에서 UNO용으로 컴파일하여 `arduino-studio/firmware/onemaker_runtime.hex`를 생성합니다. UNO, Nano, Nano 구형 부트로더는 같은 ATmega328P 애플리케이션 HEX를 사용하며 업로더의 통신 속도만 다릅니다.

웹앱 경로: `/arduino-studio/`
