"""Compile Arduino Studio sketches locally with an installed Arduino CLI."""
import json
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

ORIGIN = "https://shkim9020.github.io"
BOARDS = {
    "uno": "arduino:avr:uno",
    "nano": "arduino:avr:nano:cpu=atmega328",
    "nanoOldBootloader": "arduino:avr:nano:cpu=atmega328old",
}
MAX_REQUEST = 256 * 1024


class CompilerHandler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def allowed(self):
        return (
            self.path == "/compile"
            and self.headers.get("Origin") == ORIGIN
            and self.headers.get("Host") == "127.0.0.1:8765"
        )

    def reply(self, status, result=None):
        body = json.dumps(result, ensure_ascii=False).encode() if result is not None else b""
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if status == 204:
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        if self.allowed():
            self.reply(204)
        else:
            self.send_error(403)

    def do_POST(self):
        if not self.allowed():
            self.send_error(403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_REQUEST or self.headers.get_content_type() != "application/json":
                raise ValueError()
            request = json.loads(self.rfile.read(size))
            code, board = request["code"], BOARDS[request["board"]]
            if not isinstance(code, str) or not code.strip():
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            self.reply(400, {"error": "코드와 보드 종류를 확인해 주세요."})
            return

        try:
            with TemporaryDirectory(prefix="onemaker-compile-") as work:
                sketch = Path(work) / "Sketch"
                sketch.mkdir()
                (sketch / "Sketch.ino").write_text(code, encoding="utf-8")
                output = Path(work) / "output"
                result = subprocess.run(
                    [self.server.cli, "compile", "--fqbn", board, "--output-dir", str(output), str(sketch)],
                    capture_output=True, encoding="utf-8", errors="replace", timeout=90, check=False,
                )
                if result.returncode:
                    self.reply(422, {"error": (result.stderr or result.stdout)[-8000:]})
                    return
                self.reply(200, {"hex": (output / "Sketch.ino.hex").read_text(encoding="ascii")})
        except subprocess.TimeoutExpired:
            self.reply(504, {"error": "컴파일 시간이 초과되었습니다."})
        except (OSError, UnicodeError):
            self.reply(500, {"error": "Arduino CLI의 컴파일 결과를 읽을 수 없습니다."})


if __name__ == "__main__":
    cli = shutil.which("arduino-cli")
    if not cli:
        raise SystemExit("Arduino CLI를 설치하고 arduino-cli를 PATH에 추가하세요.")
    with HTTPServer(("127.0.0.1", 8765), CompilerHandler) as server:
        server.cli = cli
        print("Arduino Studio 컴파일러 실행 중 · http://127.0.0.1:8765", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
