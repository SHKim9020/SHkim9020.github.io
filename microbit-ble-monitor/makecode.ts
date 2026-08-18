/**
 * micro:bit + IoT:bit + BLE 환경 센서 모니터
 *
 * MakeCode 확장 기능
 * 1) Bluetooth
 * 2) OneMaker IoT BLE
 *    https://github.com/SHKim9020/project1
 *
 * 프로젝트 설정
 * - No Pairing Required 권장
 *
 * IoT:bit 연결
 * - BME280     : IIC
 * - 빛 센서    : P1
 * - 토양수분   : P2
 * - 미세먼지   : LED=P9 / OUT=P10
 */

let 팀이름 = "TEAM01"
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

bluetooth.onBluetoothConnected(function () {
    블루투스연결 = true
    bluetooth.uartWriteLine("HELLO," + 팀이름 + "," + 블루투스이름)
})

bluetooth.onBluetoothDisconnected(function () {
    블루투스연결 = false
})

input.onButtonPressed(Button.A, function () {
    이름표시중 = true
    led.enable(true)
    basic.showString(팀이름)
    basic.showString(블루투스이름)
    basic.clearScreen()
    led.enable(false)
    이름표시중 = false
})

bluetooth.startUartService()
bluetooth.setTransmitPower(7)

// P9/P10을 미세먼지 센서가 사용하므로 평소 LED Matrix OFF
led.enable(false)

basic.forever(function () {
    if (블루투스연결 && !이름표시중) {
        온도 = OneMakerIoT.bme280(OneMakerIoT.BME280Value.Temperature)
        습도 = OneMakerIoT.bme280(OneMakerIoT.BME280Value.Humidity)
        기압 = OneMakerIoT.bme280(OneMakerIoT.BME280Value.Pressure)

        미세먼지 = OneMakerIoT.dust(DigitalPin.P9, AnalogPin.P10)
        토양수분 = OneMakerIoT.soilMoisture(AnalogPin.P2)
        빛 = OneMakerIoT.lightLevel(AnalogPin.P1)

        전송번호 += 1

        데이터 = "DATA," +
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
