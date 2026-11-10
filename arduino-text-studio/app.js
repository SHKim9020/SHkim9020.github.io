(() => {
  "use strict";
  const find = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const source = find("sketchSource");
  const connect = find("serialConnect");
  const upload = find("sketchUpload");
  const sketchStatus = find("sketchStatus");
  const baud = find("serialBaud");
  const output = find("serialOutput");
  const input = find("serialInput");
  const send = find("serialSend");
  const status = find("portStatus");
  const ch340 = window.OneMakerCH340;
  const serial = ch340?.serial || navigator.serial;
  const connectLabel = ch340?.serial ? "② CH340 USB 연결" : "② USB 연결";
  const log = [];
  let session;
  let state = "idle";

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const graph = window.OneMakerMeasurements.create({ panel: find("panel-graph"), download });
  const plotter = window.OneMakerPlotter.create(find("panel-plotter"));
  find("sketchCompile").addEventListener("click", () => activate(tabs[0]));
  // Release the monitor's port before the uploader asks Chrome for a port.
  upload.addEventListener("click", async (event) => {
    activate(tabs[0]);
    if (state !== "open") return;
    event.stopImmediatePropagation();
    sketchStatus.textContent = "업로드를 위해 시리얼 연결을 해제하는 중입니다.";
    await disconnect(session);
    if (upload.disabled) return;
    if (navigator.userActivation?.isActive === false) {
      sketchStatus.textContent = "시리얼 연결을 해제했습니다. ③ 보드에 저장·실행을 다시 눌러 주세요.";
      return;
    }
    upload.click();
  }, true);
  const sketch = window.OneMakerSketch({
    panel: find("panel-sketch"), controls: find("boardActions"), download,
    portBusy: () => state !== "idle",
    uploaded: () => {
      activate(tabs[1]);
      status.textContent = "업로드 완료 · USB 다시 연결";
    },
    workerUrl: new URL("./compiler-worker.mjs?v=1", document.baseURI),
    storageKey: "onemaker-arduino-text-studio-sketch-v1",
  });

  function activate(selected, focus = false) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = find(tab.getAttribute("aria-controls"));
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    }
    if (selected.id === "tab-graph") graph.render();
    if (selected.id === "tab-plotter") plotter.render();
    if (focus) selected.focus();
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const target = {
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      activate(tabs[target], true);
    });
  }

  const example = `// 테스트용 온습도 값을 시리얼과 그래프로 확인합니다.
unsigned int sample = 0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  float temperature = 24.0 + (sample % 12) * 0.2;
  float humidity = 43.0 + (sample % 8) * 0.5;

  Serial.print("DATA,");
  Serial.print(temperature, 1);
  Serial.print(",");
  Serial.println(humidity, 1);

  sample++;
  delay(1500);
}
`;
  find("loadExample").addEventListener("click", () => {
    if (source.readOnly) return;
    if (source.value.trim() && source.value !== example && !window.confirm("현재 코드를 그래프 예제로 바꿀까요?")) return;
    source.value = example;
    source.dispatchEvent(new Event("input"));
    find("sketchStatus").textContent = "센서 없이 동작하는 예제입니다. 업로드 후 9600 baud로 연결하세요.";
    source.focus();
  });

  for (const button of document.querySelectorAll("[data-library]")) {
    button.addEventListener("click", () => {
      if (source.readOnly) return;
      const included = new Set(
        [...source.value.matchAll(/^[\t ]*#[\t ]*include[\t ]*[<"]([^>"]+)[>"]/gm)].map(match => match[1]),
      );
      const headers = button.dataset.library.split(",");
      const missing = headers.filter(header => !included.has(header));
      if (!missing.length) {
        sketchStatus.textContent = headers.join(", ") + " 라이브러리가 이미 코드에 있습니다.";
        return;
      }
      const includes = missing.map(header => "#include <" + header + ">").join("\n");
      source.value = includes + "\n" + (source.value ? "\n" + source.value : "");
      source.dispatchEvent(new Event("input"));
      sketchStatus.textContent = missing.join(", ") + " 라이브러리를 추가했습니다.";
      source.focus();
      source.setSelectionRange(0, includes.length);
    });
  }

  function setState(next, label) {
    state = next;
    const connected = state === "open";
    status.textContent = label;
    status.classList.toggle("connected", connected);
    connect.disabled = !serial || state === "opening" || state === "closing";
    connect.textContent = connected ? "② 연결 끊기" : connectLabel;
    baud.disabled = state !== "idle";
    input.disabled = !connected;
    send.disabled = !connected || Boolean(session?.writeTask);
  }

  function append(lines) {
    if (!lines.length) return;
    const nearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 28;
    log.push(...lines);
    log.splice(0, Math.max(0, log.length - 300));
    output.textContent = log.join("\n");
    if (nearBottom) output.scrollTop = output.scrollHeight;
  }

  async function read(active) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (state === "open" && session === active) {
        const { value, done } = await active.reader.read();
        if (done || state !== "open") break;
        const lines = (buffer + decoder.decode(value, { stream: true })).split(/\r?\n/);
        buffer = lines.pop().slice(-8192);
        const received = lines.filter(Boolean).map(line => line.slice(0, 8192));
        for (const line of received) {
          graph.accept(line);
          plotter.accept(line);
        }
        append(received.slice(-300));
      }
    } finally {
      active.reader.releaseLock();
      active.reader = null;
    }
  }

  async function disconnect(active, label = "연결 안 됨") {
    if (session !== active || state !== "open") return;
    setState("closing", "연결 해제 중");
    if (ch340?.CH340Port && active.port instanceof ch340.CH340Port) {
      // Closing the USB device also cancels its in-flight transferIn.
      await active.port.close().catch(() => {});
    }
    await active.reader?.cancel().catch(() => {});
    await Promise.allSettled([active.readTask, active.writeTask]);
    try {
      await active.port.close();
    } catch (error) {
      if (active.port.readable || active.port.writable) append(["[포트 닫기 오류] " + error.message]);
    } finally {
      session = null;
      setState("idle", label);
    }
  }

  connect.addEventListener("click", async () => {
    if (state === "open") {
      await disconnect(session);
      return;
    }
    if (state !== "idle" || !serial) return;
    if (sketch.isUploading()) {
      status.textContent = "업로드 후 연결하세요";
      return;
    }
    const speed = Number(baud.value);
    setState("opening", "포트 선택 중");
    let port;
    let opened = false;
    try {
      port = await serial.requestPort();
      await port.open({ baudRate: speed });
      opened = true;
      const active = { port, reader: port.readable.getReader() };
      session = active;
      setState("open", "USB 연결됨 · " + speed);
      active.readTask = read(active);
      active.readTask.then(
        () => disconnect(active, "USB 연결 종료"),
        (error) => {
          if (state === "open" && session === active) {
            append(["[수신 오류] " + error.message]);
            void disconnect(active, "USB 연결 종료");
          }
        },
      );
    } catch (error) {
      if (opened) await port.close().catch(() => {});
      if (error.name !== "NotFoundError") append(["[연결 오류] " + error.message]);
      setState("idle", error.name === "NotFoundError" ? "포트 선택 취소" : "USB 연결 실패");
      if (error.name !== "NotFoundError") activate(tabs[1]);
    }
  });

  find("clearSerial").addEventListener("click", () => {
    log.length = 0;
    output.textContent = "";
  });

  async function write(active, message) {
    const writer = active.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(message + "\n"));
    } finally {
      writer.releaseLock();
    }
  }

  find("serialForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const active = session;
    const message = input.value;
    if (state !== "open" || !message || active.writeTask) return;
    active.writeTask = write(active, message);
    send.disabled = true;
    try {
      await active.writeTask;
      if (input.value === message) input.value = "";
      append(["→ " + message]);
    } catch (error) {
      append(["[전송 오류] " + error.message]);
    } finally {
      active.writeTask = null;
      if (state === "open" && session === active) send.disabled = false;
    }
  });

  setState("idle", serial ? "연결 안 됨" : "USB 연결을 지원하는 브라우저가 필요합니다");
})();
