# OneMaker ESP32-C3 Boat Studio

ESP32-C3 Super Mini와 DRV8833, 8520 모터 2개를 사용하는 스마트선박 수업용 블록 코딩 웹앱입니다.

## 기본 배선

| ESP32-C3 | DRV8833 | 용도 |
|---|---|---|
| GPIO1 | IN1 | 왼쪽 모터 |
| GPIO3 | IN2 | 왼쪽 모터 |
| GPIO4 | IN3 | 오른쪽 모터 |
| GPIO5 | IN4 | 오른쪽 모터 |
| 3V3 | VCC | 로직 전원 |
| GND | GND | 공통 접지 |

- OUT1·OUT2: 왼쪽 8520 모터
- OUT3·OUT4: 오른쪽 8520 모터
- 모터 전원은 1S 3.7V 배터리를 DRV8833 모터 전원 입력에 연결
- GPIO2는 스트래핑 핀, GPIO8은 내장 LED이므로 기본 모터 핀에서 제외

## 수업 흐름

1. Chrome 또는 Edge에서 페이지를 연다.
2. 보드당 처음 한 번 `펌웨어 설치`를 실행한다.
3. 블록을 연결하고 `USB 연결`을 누른다.
4. `보드에 저장·실행`을 누른다.
5. 프로젝트는 브라우저에 자동 저장되며 `.omc3` 파일로 내보낼 수 있다.

## 기술 구조

- Blockly 12 기반 Scratch형 블록 편집기
- Web Serial을 사용한 프로그램·센서 데이터 통신
- ESP Web Tools를 사용한 초기 펌웨어 설치
- LittleFS에 프로그램을 저장하여 USB를 분리한 뒤에도 실행
- Arduino C++ 코드 자동 생성 및 `.ino` 다운로드

웹앱 경로: `/esp32-c3-boat/`
