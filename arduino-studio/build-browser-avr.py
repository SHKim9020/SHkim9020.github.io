"""Build the Arduino AVR sysroot and library archives for the browser compiler."""
import argparse
import base64
import gzip
import hashlib
import json
import shutil
from pathlib import Path
import subprocess
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile
from io import BytesIO


AVR = "1.8.8"
GCC = "7.3.0-atmel3.6.1-arduino7"
LIBRARIES = (
    ("adafruit/DHT_sensor_library-1.4.6", "20a9048e72d636305470c347bd8f83c01d4178c87ff865cae47a7276315e36c2"),
    ("adafruit/Adafruit_Unified_Sensor-1.1.15", "d64cdec0b817535f568fc3b8b8d44e7e097749f5ab8040aea573f412a3cbaec6"),
    ("markub3327/LiquidCrystal_I2C-2.0.0", "a7032f38443b3d9415a4ac25ad0b2fd750eb04954422bdf7f24a8686232e7b56"),
)
EXTRA_LIBRARIES = (
    ("arduino-libraries/Servo-1.3.0", "d25b0d77f10a810d24876c570410f32cc3129f9cc3d0370c861a278b969b4b38"),
    ("adafruit/Adafruit_NeoPixel-1.15.5", "3d767caa011ab3078df7fe3c3e0456359ce2bc309eba343932690a2c1612fd16"),
    ("adafruit/Adafruit_BusIO-1.17.4", "c7bab1b6c6eee64b50964c8e149b795719a01f1d9dfcdcef170b35daa696349b"),
    ("adafruit/Adafruit_GFX_Library-1.12.5", "d95859481948e58274eb8dfa0c8e7fa51ee5b6a4b8b67a5f6e3063b85043376f"),
    ("adafruit/Adafruit_SSD1306-2.5.16", "48e85f82099b72a8a96a4f57e1b515cf95fa0a6adbaa4c54e3106c7927122aa7"),
)
BUILT_IN = ("EEPROM", "SPI", "SoftwareSerial", "Wire")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path, help="Arduino CLI data directory containing arduino:avr@" + AVR)
    parser.add_argument("--extra-libraries", action="store_true", help="Include Servo, NeoPixel and SSD1306 OLED")
    args = parser.parse_args()
    package = args.data.resolve() / "packages" / "arduino"
    core = package / "hardware" / "avr" / AVR
    gcc = package / "tools" / "avr-gcc" / GCC
    avr_lib = gcc / "avr" / "lib"
    gcc_lib = gcc / "lib" / "gcc" / "avr" / "7.3.0"
    assets = {}

    def add(name, path):
        assets[name] = base64.b64encode(path.read_bytes()).decode("ascii")

    for path in sorted((gcc / "avr/include").rglob("*.h")):
        if path.parent.name == "avr" and path.name.startswith("io") and path.name not in (
            "io.h", "iom328p.h", "iomx8.h",
        ):
            continue
        add("/avr/" + path.relative_to(gcc / "avr/include").as_posix(), path)
    for path in sorted((gcc_lib / "include").glob("*.h")):
        add("/gcc/" + path.name, path)
    add("/lib/avr5.xn", avr_lib / "ldscripts" / "avr5.xn")
    for variant in ("standard", "eightanaloginputs"):
        add(f"/variant/{variant}/pins_arduino.h", core / "variants" / variant / "pins_arduino.h")

    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        system_libraries = [avr_lib / "avr5" / name for name in (
            "crtatmega328p.o", "libm.a", "libc.a", "libatmega328p.a",
        )]
        for original in [*system_libraries, gcc_lib / "avr5" / "libgcc.a"]:
            stripped = work / original.name
            subprocess.run([gcc / "bin" / "avr-strip", "-g", "-o", stripped, original], check=True)
            add("/lib/" + original.name, stripped)
        libraries = [core / "libraries" / name / "src" for name in BUILT_IN]
        downloads = LIBRARIES + EXTRA_LIBRARIES if args.extra_libraries else LIBRARIES
        for archive, digest in downloads:
            url = f"https://downloads.arduino.cc/libraries/github.com/{archive}.zip"
            with urlopen(url, timeout=30) as response:
                raw = response.read()
            if hashlib.sha256(raw).hexdigest() != digest:
                raise ValueError(f"Checksum mismatch for {archive}")
            with ZipFile(BytesIO(raw)) as bundle:
                bundle.extractall(work)
            folder = work / archive.split("/")[-1]
            if (folder / "src").is_dir():
                folder = folder / "src"
            if archive.startswith("arduino-libraries/Servo-"):
                for other_arch in folder.iterdir():
                    if other_arch.is_dir() and other_arch.name != "avr":
                        shutil.rmtree(other_arch)
            libraries.append(folder)

        core_src = core / "cores" / "arduino"
        for path in sorted(core_src.rglob("*.h")):
            add("/core/" + path.relative_to(core_src).as_posix(), path)
        for folder in libraries:
            for path in sorted(folder.rglob("*.h")):
                if "examples" not in path.parts:
                    add("/libraries/" + path.relative_to(folder).as_posix(), path)

        for board, variant in (("UNO", "standard"), ("NANO", "eightanaloginputs")):
            dirs = [core_src, core / "variants" / variant, *libraries]
            flags = [
                "-mmcu=atmega328p", "-DF_CPU=16000000L", "-DARDUINO=10819",
                f"-DARDUINO_AVR_{board}", "-DARDUINO_ARCH_AVR", "-Os", "-ffunction-sections",
                "-fdata-sections", *[f"-I{path}" for path in dirs],
            ]
            objects = []
            for folder in [core_src, *libraries]:
                for path in sorted(folder.rglob("*")):
                    if path.suffix not in (".c", ".cpp", ".S") or "examples" in path.parts or "fontconvert" in path.parts:
                        continue
                    compiler = "avr-g++" if path.suffix == ".cpp" else "avr-gcc"
                    language_flags = {
                        ".cpp": ["-std=gnu++11", "-fpermissive", "-fno-exceptions", "-fno-threadsafe-statics"],
                        ".c": ["-std=gnu11"],
                        ".S": ["-x", "assembler-with-cpp"],
                    }
                    obj = work / f"{len(objects)}-{path.stem}.o"
                    subprocess.run([gcc / "bin" / compiler, *flags, *language_flags[path.suffix],
                                    "-c", path, "-o", obj], check=True)
                    objects.append(obj)
            output = work / f"{board}.a"
            subprocess.run([gcc / "bin" / "avr-ar", "rcsD", output, *objects], check=True)
            add(f"/lib/{board}.a", output)

    version = 2 if args.extra_libraries else 1
    output = Path(__file__).with_name(f"browser-avr-{version}.json.gz")
    output.write_bytes(gzip.compress(json.dumps(assets, sort_keys=True, separators=(",", ":")).encode(), mtime=0))
    print(f"{output.name}: {len(assets)} files, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
