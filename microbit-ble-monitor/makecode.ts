/**
 * micro:bit + IoT:bit + BLE 환경 센서 모니터
 *
 * MakeCode 확장 기능
 * 1) Bluetooth
 * 2) iot-environment-kit
 *
 * 프로젝트 설정
 * - No Pairing Required 권장
 *
 * IoT:bit 연결
 * - BME280     : IIC (SCL P19 / SDA P20)
 * - 빛 센서    : P1
 * - 토양수분   : P2
 * - 미세먼지   : LED IN P9 / OUT P10
 *
 * BLE 송신 형식
 * DATA,TEAM01,guziv,26,58,1012,25,64,73,1
 */

// ======================================================
// ★ 16대 사용 시 TEAM01 ~ TEAM16으로 변경
// ======================================================
let 팀이름 = "TEAM01"

// ======================================================
// 변수
// ======================================================
let 블루투스연결 = false
let 이름표시중 = false

let 온도 = 0
let 습도 = 0
let 기압 = 0
let 미세먼지 = 0
let 토양수분 = 0
let 빛 = 0

let 전송번호 = 0
let 데이터 = ""
let 블루투스이름 = control.deviceName()

// ======================================================
// 핀 설정
// ======================================================
let 빛핀 = AnalogPin.P1
let 토양핀 = AnalogPin.P2
let 먼지LED핀 = DigitalPin.P9
let 먼지OUT핀 = AnalogPin.P10

// ======================================================
// Bluetooth 연결
// ======================================================
bluetooth.onBluetoothConnected(function () {
    블루투스연결 = true

    bluetooth.uartWriteLine(
        "HELLO," + 팀이름 + "," + 블루투스이름
    )
})

bluetooth.onBluetoothDisconnected(function () {
    블루투스연결 = false
})

// ======================================================
// A 버튼
// TEAM 이름 + Bluetooth 고유 이름 표시
//
// P9/P10은 미세먼지 센서가 사용하므로
// 표시할 때만 LED Matrix를 잠시 켭니다.
// ======================================================
input.onButtonPressed(Button.A, function () {
    이름표시중 = true

    led.enable(true)
    basic.showString(팀이름)
    basic.showString(블루투스이름)
    basic.clearScreen()
    led.enable(false)

    basic.pause(300)
    이름표시중 = false
})

// ======================================================
// Bluetooth UART 시작
// ======================================================
bluetooth.startUartService()
bluetooth.setTransmitPower(7)

// P9/P10을 미세먼지 센서용으로 사용
led.enable(false)

// ======================================================
// 센서값 약 2초마다 전송
// ======================================================
basic.forever(function () {
    if (블루투스연결 && !이름표시중) {

        // BME280
        온도 = Environment.octopus_BME280(
            Environment.BME280_state.BME280_temperature_C
        )

        습도 = Environment.octopus_BME280(
            Environment.BME280_state.BME280_humidity
        )

        기압 = Environment.octopus_BME280(
            Environment.BME280_state.BME280_pressure
        )

        // 미세먼지
        미세먼지 = Environment.ReadDust(
            먼지LED핀,
            먼지OUT핀
        )

        // 토양수분 0~100
        토양수분 = Environment.ReadSoilHumidity(
            토양핀
        )

        // 외부 빛센서 0~100
        빛 = Environment.ReadLightIntensity(
            빛핀
        )

        전송번호 += 1

        // 예:
        // DATA,TEAM01,guziv,26,58,1012,25,64,73,1
        데이터 =
            "DATA," +
            팀이름 + "," +
            블루투스이름 + "," +
            온도 + "," +
            습도 + "," +
            기압 + "," +
            미세먼지 + "," +
            토양수분 + "," +
            빛 + "," +
            전송번호

        bluetooth.uartWriteLine(데이터)

        basic.pause(2000)

    } else {
        basic.pause(300)
    }
})
