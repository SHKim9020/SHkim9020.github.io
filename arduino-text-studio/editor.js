(() => {
  "use strict";
  const source = document.getElementById("sketchSource");
  const display = document.getElementById("sketchHighlight");
  const code = display.firstElementChild;
  const prism = window.Prism;
  if (!prism?.languages.cpp) return;

  // Keep native editing, selection and accessibility on the textarea.
  function syncScroll() {
    display.scrollTop = source.scrollTop;
    display.scrollLeft = source.scrollLeft;
  }

  const resize = () => {
    display.style.width = source.clientWidth + "px";
    display.style.height = source.clientHeight + "px";
    syncScroll();
  };
  new ResizeObserver(resize).observe(source);
  let frame = 0;
  function render() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      code.innerHTML = prism.highlight(source.value, prism.languages.cpp, "cpp") + "\n";
      source.classList.toggle("highlighted", source.value !== "");
      resize();
    });
  }
  source.addEventListener("input", render);
  source.addEventListener("scroll", syncScroll, { passive: true });
  render();
})();
