/**
 * micro:bit + IoT:bit + BLE 환경 센서 모니터
 *
 * 중요: 확장 기능은 Bluetooth만 추가하세요.
 * Environment-and-Science-IoT는 Bluetooth와 충돌하므로 사용하지 않습니다.
 * 필요한 BME280/미세먼지/토양수분/빛 센서 코드를 이 파일에 직접 포함했습니다.
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
// BLE / 센서 변수
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

let 빛핀 = AnalogPin.P1
let 토양핀 = AnalogPin.P2
let 먼지LED핀 = DigitalPin.P9
let 먼지OUT핀 = AnalogPin.P10

// ======================================================
// BME280 드라이버 - 별도 확장 기능 불필요
// ======================================================
let BME280_ADDR = 0x76
let bmeReady = false

let dig_T1 = 0
let dig_T2 = 0
let dig_T3 = 0
let dig_P1 = 0
let dig_P2 = 0
let dig_P3 = 0
let dig_P4 = 0
let dig_P5 = 0
let dig_P6 = 0
let dig_P7 = 0
let dig_P8 = 0
let dig_P9 = 0
let dig_H1 = 0
let dig_H2 = 0
let dig_H3 = 0
let dig_H4 = 0
let dig_H5 = 0
let dig_H6 = 0

let BME_T = 0
let BME_P = 0
let BME_H = 0

function bmeSetReg(reg: number, value: number) {
    let buf = pins.createBuffer(2)
    buf[0] = reg
    buf[1] = value
    pins.i2cWriteBuffer(BME280_ADDR, buf)
}

function bmeGetReg(reg: number): number {
    pins.i2cWriteNumber(BME280_ADDR, reg, NumberFormat.UInt8BE)
    return pins.i2cReadNumber(BME280_ADDR, NumberFormat.UInt8BE)
}

function bmeGetInt8(reg: number): number {
    pins.i2cWriteNumber(BME280_ADDR, reg, NumberFormat.UInt8BE)
    return pins.i2cReadNumber(BME280_ADDR, NumberFormat.Int8LE)
}

function bmeGetUInt16LE(reg: number): number {
    pins.i2cWriteNumber(BME280_ADDR, reg, NumberFormat.UInt8BE)
    return pins.i2cReadNumber(BME280_ADDR, NumberFormat.UInt16LE)
}

function bmeGetInt16LE(reg: number): number {
    pins.i2cWriteNumber(BME280_ADDR, reg, NumberFormat.UInt8BE)
    return pins.i2cReadNumber(BME280_ADDR, NumberFormat.Int16LE)
}

function bmeTryInit(addr: number): boolean {
    BME280_ADDR = addr

    // BME280 CHIP ID = 0x60
    if (bmeGetReg(0xD0) != 0x60) {
        return false
    }

    dig_T1 = bmeGetUInt16LE(0x88)
    dig_T2 = bmeGetInt16LE(0x8A)
    dig_T3 = bmeGetInt16LE(0x8C)

    dig_P1 = bmeGetUInt16LE(0x8E)
    dig_P2 = bmeGetInt16LE(0x90)
    dig_P3 = bmeGetInt16LE(0x92)
    dig_P4 = bmeGetInt16LE(0x94)
    dig_P5 = bmeGetInt16LE(0x96)
    dig_P6 = bmeGetInt16LE(0x98)
    dig_P7 = bmeGetInt16LE(0x9A)
    dig_P8 = bmeGetInt16LE(0x9C)
    dig_P9 = bmeGetInt16LE(0x9E)

    dig_H1 = bmeGetReg(0xA1)
    dig_H2 = bmeGetInt16LE(0xE1)
    dig_H3 = bmeGetReg(0xE3)

    let e5 = bmeGetReg(0xE5)
    dig_H4 = (bmeGetReg(0xE4) << 4) + (e5 & 0x0F)
    dig_H5 = (bmeGetReg(0xE6) << 4) + (e5 >> 4)
    dig_H6 = bmeGetInt8(0xE7)

    // humidity x4, temp/pressure normal mode
    bmeSetReg(0xF2, 0x04)
    bmeSetReg(0xF4, 0x2F)
    bmeSetReg(0xF5, 0x0C)

    bmeReady = true
    return true
}

function bmeEnsureReady(): boolean {
    if (bmeReady) {
        return true
    }

    // 대부분 0x76, 일부 보드는 0x77
    if (bmeTryInit(0x76)) {
        return true
    }

    if (bmeTryInit(0x77)) {
        return true
    }

    return false
}

function bmeReadAll(): boolean {
    if (!bmeEnsureReady()) {
        BME_T = 0
        BME_H = 0
        BME_P = 0
        return false
    }

    let adc_T = (bmeGetReg(0xFA) << 12) + (bmeGetReg(0xFB) << 4) + (bmeGetReg(0xFC) >> 4)
    let var1 = (((adc_T >> 3) - (dig_T1 << 1)) * dig_T2) >> 11
    let var2 = (((((adc_T >> 4) - dig_T1) * ((adc_T >> 4) - dig_T1)) >> 12) * dig_T3) >> 14
    let tFine = var1 + var2

    BME_T = ((tFine * 5 + 128) >> 8) / 100

    var1 = (tFine >> 1) - 64000
    var2 = (((var1 >> 2) * (var1 >> 2)) >> 11) * dig_P6
    var2 = var2 + ((var1 * dig_P5) << 1)
    var2 = (var2 >> 2) + (dig_P4 << 16)
    var1 = (((dig_P3 * ((var1 >> 2) * (var1 >> 2)) >> 13) >> 3) + ((dig_P2 * var1) >> 1)) >> 18
    var1 = ((32768 + var1) * dig_P1) >> 15

    if (var1 == 0) {
        BME_P = 0
    } else {
        let adc_P = (bmeGetReg(0xF7) << 12) + (bmeGetReg(0xF8) << 4) + (bmeGetReg(0xF9) >> 4)
        let p = ((1048576 - adc_P) - (var2 >> 12)) * 3125
        p = (p / var1) * 2
        var1 = (dig_P9 * (((p >> 3) * (p >> 3)) >> 13)) >> 12
        var2 = ((p >> 2) * dig_P8) >> 13
        BME_P = p + ((var1 + var2 + dig_P7) >> 4)
    }

    let adc_H = (bmeGetReg(0xFD) << 8) + bmeGetReg(0xFE)
    var1 = tFine - 76800
    var2 = (((adc_H << 14) - (dig_H4 << 20) - (dig_H5 * var1)) + 16384) >> 15
    var1 = var2 * (((((((var1 * dig_H6) >> 10) * (((var1 * dig_H3) >> 11) + 32768)) >> 10) + 2097152) * dig_H2 + 8192) >> 14)
    var2 = var1 - (((((var1 >> 15) * (var1 >> 15)) >> 7) * dig_H1) >> 4)

    if (var2 < 0) var2 = 0
    if (var2 > 419430400) var2 = 419430400

    BME_H = (var2 >> 12) / 1024

    return true
}

function BME온도읽기(): number {
    bmeReadAll()
    return Math.round(BME_T)
}

function BME습도읽기(): number {
    bmeReadAll()
    return Math.round(BME_H)
}

function BME기압읽기(): number {
    bmeReadAll()
    return Math.round(BME_P / 100)
}

// ======================================================
// 미세먼지 센서
// ======================================================
function 미세먼지읽기(vLED: DigitalPin, vo: AnalogPin): number {
    let voltage = 0
    let dust = 0

    pins.digitalWritePin(vLED, 0)
    control.waitMicros(160)
    voltage = pins.analogReadPin(vo)
    control.waitMicros(100)
    pins.digitalWritePin(vLED, 1)

    voltage = pins.map(voltage, 0, 1023, 0, 3100)
    dust = (voltage - 380) * 5 / 29

    if (dust < 0) {
        dust = 0
    }

    return Math.round(dust)
}

// ======================================================
// 토양수분 / 빛 센서
// ======================================================
function 토양수분읽기(pin: AnalogPin): number {
    return Math.round(
        pins.map(pins.analogReadPin(pin), 0, 1023, 0, 100)
    )
}

function 빛읽기(pin: AnalogPin): number {
    return Math.round(
        pins.map(pins.analogReadPin(pin), 0, 1023, 0, 100)
    )
}

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
// A 버튼: TEAM + Bluetooth 이름 확인
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

// P9/P10 미세먼지 센서를 위해 LED Matrix OFF
led.enable(false)

// ======================================================
// 센서값 약 2초마다 BLE 전송
// ======================================================
basic.forever(function () {
    if (블루투스연결 && !이름표시중) {

        온도 = BME온도읽기()
        습도 = BME습도읽기()
        기압 = BME기압읽기()

        미세먼지 = 미세먼지읽기(
            먼지LED핀,
            먼지OUT핀
        )

        토양수분 = 토양수분읽기(토양핀)
        빛 = 빛읽기(빛핀)

        전송번호 += 1

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
