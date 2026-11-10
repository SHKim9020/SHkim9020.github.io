(() => {
  "use strict";
  function compileInBrowser(source, target, workerUrl) {
    const worker = new Worker(workerUrl, { type: "module" });
    return new Promise((resolve, reject) => {
      function finish(error, hex) {
        clearTimeout(timer);
        worker.terminate();
        if (error) reject(new Error(error));
        else resolve(hex);
      }
      const timer = setTimeout(() => finish("컴파일 시간이 초과되었습니다. 인터넷 연결을 확인하고 다시 시도해 주세요."), 90000);
      worker.onmessage = ({ data }) => finish(data.error, data.hex);
      worker.onerror = () => finish("브라우저 컴파일러를 시작하지 못했습니다. 페이지를 새로고침하고 다시 시도해 주세요.");
      worker.postMessage({ source, target });
    });
  }

  async function compileLocally(code, board) {
    let response;
    try {
      response = await fetch("http://127.0.0.1:8765/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, board }),
        signal: AbortSignal.timeout(105000),
      });
    } catch (error) {
      if (error.name === "TimeoutError") throw new Error("로컬 컴파일 시간이 초과되었습니다.");
      throw new Error("로컬 컴파일러에 연결하지 못했습니다. 컴파일러 실행과 Chrome의 로컬 네트워크 권한을 확인해 주세요.");
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "컴파일에 실패했습니다.");
    return result.hex;
  }

  window.OneMakerSketch = function ({
    panel, portBusy, uploaded, download, controls = panel,
    workerUrl = new URL("browser-avr-worker.mjs?v=1", document.baseURI),
    storageKey = "onemaker-arduino-sketch-v1",
  }) {
    const find = (id) => panel.querySelector("#" + id);
    const source = find("sketchSource");
    const board = find("sketchBoard");
    const localCompiler = find("sketchLocalCompiler");
    const compile = controls.querySelector("#sketchCompile");
    const upload = controls.querySelector("#sketchUpload");
    const status = find("sketchStatus");
    const progress = upload.querySelector(".upload-progress");
    let hexUrl;
    let compiling = false;
    let uploading = false;

    try { source.value = localStorage.getItem(storageKey) || ""; } catch (_) {}
    function updateButtons() {
      compile.disabled = compiling || uploading || !source.value.trim();
      upload.disabled = compiling || uploading || !hexUrl;
      source.readOnly = uploading;
      board.disabled = uploading;
      if (localCompiler) localCompiler.disabled = uploading;
    }
    function invalidate() {
      if (hexUrl) URL.revokeObjectURL(hexUrl);
      hexUrl = undefined;
      upload.removeAttribute("hex-href");
      progress.textContent = "";
      updateButtons();
    }
    source.addEventListener("input", () => {
      try { localStorage.setItem(storageKey, source.value); } catch (_) {}
      invalidate();
      status.textContent = "코드가 변경되었습니다. 컴파일해 주세요.";
    });
    board.addEventListener("change", () => {
      invalidate();
      status.textContent = "보드가 변경되었습니다. 컴파일해 주세요.";
    });
    localCompiler?.addEventListener("change", () => {
      invalidate();
      status.textContent = localCompiler.checked
        ? "PC에서 로컬 컴파일러를 실행하고 컴파일을 눌러 주세요."
        : "코드를 붙여넣고 컴파일을 눌러 주세요. 처음에는 브라우저가 컴파일러를 내려받습니다.";
    });
    find("sketchDownload").addEventListener("click", () => {
      if (source.value.trim()) download("Sketch.ino", source.value, "text/x-c++src");
    });

    compile.addEventListener("click", async () => {
      invalidate();
      compiling = true;
      updateButtons();
      const code = source.value;
      const target = board.value;
      const local = Boolean(localCompiler?.checked);
      status.textContent = local
        ? "이 PC에서 Arduino CLI로 컴파일하는 중…"
        : "브라우저에서 컴파일 중… 처음에는 컴파일러를 내려받아 잠시 걸릴 수 있습니다.";
      try {
        const hex = await (local ? compileLocally(code, target) : compileInBrowser(code, target, workerUrl));
        if (code !== source.value || target !== board.value || local !== Boolean(localCompiler?.checked)) {
          status.textContent = "컴파일 설정이 바뀌었습니다. 다시 컴파일해 주세요.";
          return;
        }
        if (!/^:[0-9a-f]+/i.test(hex || "")) throw new Error("유효한 HEX를 받지 못했습니다.");
        hexUrl = URL.createObjectURL(new Blob([hex], { type: "text/plain" }));
        upload.setAttribute("hex-href", hexUrl);
        upload.setAttribute("board", target);
        status.textContent = controls === panel
          ? "컴파일 완료. USB 업로드를 누르고 보드 포트를 선택해 주세요."
          : "컴파일 완료. ③ 보드에 저장·실행을 누르고 USB 포트를 선택해 주세요.";
      } catch (error) {
        status.textContent = error.message.includes("No such file or directory")
          ? error.message + (localCompiler
            ? "\n지원 목록에 없는 라이브러리는 로컬 컴파일러에서 사용할 수 있습니다."
            : "\n스케치의 #include와 브라우저에서 지원하는 라이브러리 목록을 확인해 주세요.")
          : error.message;
      } finally {
        compiling = false;
        updateButtons();
      }
    });

    // Let the existing Arduino Web Uploader handle the actual USB write.
    upload.addEventListener("click", (event) => {
      if (!document.querySelector("#usbUploaderScript")?.dataset.loaded) {
        event.stopImmediatePropagation();
        status.textContent = "USB 업로더를 불러오지 못했습니다. 인터넷에 연결한 뒤 새로고침해 주세요.";
        return;
      }
      if (portBusy() || !navigator.serial || uploading || !hexUrl) {
        event.stopImmediatePropagation();
        status.textContent = !navigator.serial
          ? "USB 업로드는 PC의 Web Serial 지원 Chrome에서 실행해 주세요."
          : "USB 업로드 전 상단 시리얼 연결을 끊어 주세요.";
        return;
      }
      uploading = true;
      progress.textContent = "";
      status.textContent = localCompiler
        ? "USB 포트를 선택해 주세요. 텍스트 업로드 후 블록 모드를 다시 쓰려면 런타임을 설치하세요."
        : "USB 포트를 선택해 주세요.";
      updateButtons();
    }, true);

    new MutationObserver(() => {
      const result = progress.textContent;
      if (!uploading || (result !== "Done!" && result !== "Error!")) return;
      uploading = false;
      updateButtons();
      if (result === "Done!") {
        status.textContent = "업로드 완료. 시리얼 탭에서 속도를 선택하고 다시 연결하세요.";
        uploaded();
      } else {
        status.textContent = "업로드 실패 또는 취소. 보드 종류와 USB 포트를 확인해 주세요.";
      }
    }).observe(progress, { childList: true, characterData: true, subtree: true });

    updateButtons();
    return { isUploading: () => uploading };
  };
})();
