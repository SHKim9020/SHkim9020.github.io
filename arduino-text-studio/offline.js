(() => {
  "use strict";
  const button = document.getElementById("offlineBtn");
  const label = document.getElementById("offlineStatus");
  const { cacheName, ready, uploader, urls } = window.OneMakerOffline;
  const cachedView = new URL(location.href).searchParams.get("offline") === "1";
  const workerUrl = new URL("./compiler-worker.mjs?v=1", document.baseURI);

  function checkCompiler() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl, { type: "module" });
      const finish = error => {
        clearTimeout(timeout);
        worker.terminate();
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => finish(new Error("컴파일러 확인 시간이 초과되었습니다.")), 60000);
      worker.onmessage = ({ data }) => finish(data.hex ? null : new Error(data.error || "컴파일러 확인에 실패했습니다."));
      worker.onerror = () => finish(new Error("컴파일러를 시작하지 못했습니다."));
      worker.postMessage({
        target: "uno",
        source: "void setup(){probe();}\nvoid loop(){}\nvoid probe(){pinMode(LED_BUILTIN,OUTPUT);}",
      });
    });
  }

  async function isReady(cache) {
    if (!(await cache.match(ready))) return false;
    const saved = new Set((await cache.keys()).map(request => request.url));
    return urls.every(url => saved.has(url));
  }

  function showReady() {
    button.textContent = cachedView ? "온라인으로 열기" : "오프라인 열기";
    label.textContent = cachedView ? "오프라인 모드" : "오프라인 준비 완료";
  }

  if (!("serviceWorker" in navigator) || !("caches" in window)) {
    label.textContent = "이 브라우저는 오프라인 저장을 지원하지 않습니다.";
    return;
  }

  // Register on page load so compilation workers are controlled before the user prepares.
  const registration = navigator.serviceWorker.register("./sw.js?v=1").then(async () => {
    await navigator.serviceWorker.ready;
    const cache = await caches.open(cacheName);
    if (await isReady(cache)) showReady();
    button.disabled = false;
    return cache;
  }).catch(() => {
    label.textContent = "오프라인 기능을 시작하지 못했습니다.";
    return null;
  });

  button.addEventListener("click", async () => {
    button.disabled = true;
    const cache = await registration;
    if (!cache) return;
    try {
      if (await isReady(cache)) {
        const page = new URL("./", location.href);
        if (!cachedView) page.searchParams.set("offline", "1");
        location.assign(page);
        return;
      }
      label.textContent = "오프라인 파일 저장 중…";
      if (!document.getElementById("usbUploaderScript").dataset.loaded) {
        throw new Error("USB 업로더를 불러오지 못했습니다.");
      }
      await cache.addAll(urls.filter(url => url !== uploader).map(url => new Request(url, { cache: "reload" })));
      // A classic cross-origin script may be opaque. Cache it using the same request mode.
      const uploadScript = new Request(uploader, { mode: "no-cors", cache: "reload" });
      const response = await fetch(uploadScript);
      if (!response.ok && response.type !== "opaque") throw new Error("USB 업로더를 저장하지 못했습니다.");
      await cache.put(uploadScript, response);
      label.textContent = "저장한 컴파일러 확인 중…";
      await checkCompiler();
      await cache.put(ready, new Response("ready"));
      showReady();
    } catch {
      label.textContent = "오프라인 준비에 실패했습니다. 인터넷에 연결한 뒤 다시 눌러 주세요.";
    } finally {
      button.disabled = false;
    }
  });
})();
