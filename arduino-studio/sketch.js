(() => {
  "use strict";
  window.OneMakerSketch = function ({ panel, portBusy, uploaded, download }) {
    const find = (id) => panel.querySelector("#" + id);
    const source = find("sketchSource");
    const board = find("sketchBoard");
    const compile = find("sketchCompile");
    const upload = find("sketchUpload");
    const status = find("sketchStatus");
    const progress = upload.querySelector(".upload-progress");
    let hexUrl;
    let compiling = false;
    let uploading = false;
    const storageKey = "onemaker-arduino-sketch-v1";

    try { source.value = localStorage.getItem(storageKey) || ""; } catch (_) {}
    function updateButtons() {
      compile.disabled = compiling || uploading || !source.value.trim();
      upload.disabled = compiling || uploading || !hexUrl;
      source.readOnly = uploading;
      board.disabled = uploading;
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
    board.addEventListener("change", invalidate);
    find("sketchDownload").addEventListener("click", () => {
      if (source.value.trim()) download("Sketch.ino", source.value, "text/x-c++src");
    });

    compile.addEventListener("click", async () => {
      invalidate();
      compiling = true;
      updateButtons();
      const code = source.value;
      const target = board.value;
      status.textContent = "이 PC에서 Arduino CLI로 컴파일하는 중…";
      try {
        const response = await fetch("http://127.0.0.1:8765/compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, board: target }),
          signal: AbortSignal.timeout(105000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "컴파일에 실패했습니다.");
        if (code !== source.value || target !== board.value) {
          status.textContent = "코드나 보드가 바뀌었습니다. 다시 컴파일해 주세요.";
          return;
        }
        if (!/^:[0-9a-f]+/i.test(result.hex || "")) throw new Error("유효한 HEX를 받지 못했습니다.");
        hexUrl = URL.createObjectURL(new Blob([result.hex], { type: "text/plain" }));
        upload.setAttribute("hex-href", hexUrl);
        upload.setAttribute("board", target);
        status.textContent = "컴파일 완료. 시리얼 연결을 끊은 뒤 USB 업로드를 눌러 주세요.";
      } catch (error) {
        status.textContent = error instanceof TypeError
          ? "로컬 컴파일러에 연결하지 못했습니다. 컴파일러 실행과 Chrome의 로컬 네트워크 권한을 확인해 주세요."
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
      status.textContent = "USB 포트를 선택해 주세요. 텍스트 업로드 후 블록 모드를 다시 쓰려면 런타임을 설치하세요.";
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
