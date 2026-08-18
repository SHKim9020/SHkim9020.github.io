/**
 * micro:bit BLE 내장 온도 + 내장 조도 테스트
 *
 * MakeCode 설정
 * 1. 확장 기능 → Bluetooth 추가
 * 2. 프로젝트 설정 → No Pairing Required 권장
 *
 * BLE 송신 형식
 * DATA,TEAM01,xxxxx,25,123,1
 */

// ======================================================
// ★ 16대 사용 시 TEAM01 ~ TEAM16으로 변경
// ======================================================
let 팀이름 = "TEAM01"

// ======================================================
// 변수
// ======================================================
let 블루투스연결 = false
let 온도 = 0
let 조도 = 0
let 전송번호 = 0
let 데이터 = ""
let 블루투스이름 = control.deviceName()

// ======================================================
// Bluetooth 연결
// ======================================================
bluetooth.onBluetoothConnected(function () {
    블루투스연결 = true

    bluetooth.uartWriteLine(
        "HELLO," + 팀이름 + "," + 블루투스이름
    )

    basic.showIcon(IconNames.Yes)
    basic.pause(300)
    basic.clearScreen()
})

bluetooth.onBluetoothDisconnected(function () {
    블루투스연결 = false
    basic.showIcon(IconNames.No)
    basic.pause(300)
    basic.clearScreen()
})

// ======================================================
// A 버튼: TEAM 이름 + Bluetooth 고유 이름 확인
// ======================================================
input.onButtonPressed(Button.A, function () {
    basic.showString(팀이름)
    basic.showString(블루투스이름)
    basic.clearScreen()
})

// ======================================================
// Bluetooth UART 시작
// ======================================================
bluetooth.startUartService()
bluetooth.setTransmitPower(7)

// ======================================================
// 센서값 2초마다 전송
// ======================================================
basic.forever(function () {
    if (블루투스연결) {

        // LED 화면의 불빛이 조도 측정에 영향을 주지 않도록 끔
        basic.clearScreen()
        basic.pause(250)

        // micro:bit 내장 센서
        온도 = input.temperature()
        조도 = input.lightLevel()

        전송번호 += 1

        // 예: DATA,TEAM01,guziv,26,132,15
        데이터 =
            "DATA," +
            팀이름 + "," +
            블루투스이름 + "," +
            온도 + "," +
            조도 + "," +
            전송번호

        bluetooth.uartWriteLine(데이터)

        basic.pause(1750)

    } else {
        basic.pause(300)
    }
})
