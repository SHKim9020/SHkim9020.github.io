(() => {
  "use strict";
  const HISTORY = 120;
  const COLORS = ["#0b7765", "#285fba", "#b84d25", "#8945a6", "#966713", "#08779e", "#b63864", "#4d7426"];
  const FIELD = /(?:(?<label>[\p{L}_][\p{L}\p{N}_.-]{0,29})(?:[ \t]*\((?<labelUnit>cm|mm|m|°C|%|deg)\))?[ \t]*[:=][ \t]*)?(?<number>[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:[ \t]*(?<unit>cm|mm|m|°C|%|deg))?(?=$|[, \t])/uy;
  const SEPARATOR = /(?:[ \t]*,[ \t]*|[ \t]+)/y;

  function parse(line) {
    const text = line.trim();
    if (!text || text.length > 512) return null;
    if (text.startsWith("DATA,") || text.startsWith("LOG,DATA,")) {
      const pair = window.OneMakerMeasurements.parse(text);
      return pair && [
        { label: "온도", value: pair.temperature, unit: "°C" },
        { label: "습도", value: pair.humidity, unit: "%" },
      ];
    }

    const fields = [];
    const labels = new Set();
    let position = 0;
    while (position < text.length) {
      FIELD.lastIndex = position;
      const field = FIELD.exec(text);
      if (!field || fields.length === COLORS.length) return null;
      const { label = "값 " + (fields.length + 1), number, unit, labelUnit } = field.groups;
      const value = Number(number);
      if (!Number.isFinite(value) || labels.has(label)) return null;
      labels.add(label);
      fields.push({ label, value, unit: unit || labelUnit || "" });
      position = FIELD.lastIndex;
      if (position === text.length) return fields;
      SEPARATOR.lastIndex = position;
      if (!SEPARATOR.test(text) || SEPARATOR.lastIndex === text.length) return null;
      position = SEPARATOR.lastIndex;
    }
    return null;
  }

  const displayNumber = value => Number(value.toPrecision(5)).toString();

  function create(panel) {
    const chart = panel.querySelector("#plotChart");
    const legend = panel.querySelector("#plotLegend");
    const summary = panel.querySelector("#plotSummary");
    const pause = panel.querySelector("#plotPause");
    const clear = panel.querySelector("#plotClear");
    const rows = [];
    const series = new Map();
    let sequence = 0;
    let paused = false;
    let timer;

    function render() {
      clearTimeout(timer);
      timer = undefined;
      if (panel.hidden || paused) return;
      pause.disabled = clear.disabled = !rows.length;
      summary.textContent = rows.length
        ? "누적 " + sequence.toLocaleString() + "회 수신 · 최근 " + rows.length + "회 표시"
        : "숫자 데이터가 들어오면 그래프에 표시됩니다.";
      legend.replaceChildren();
      if (!rows.length) {
        chart.replaceChildren();
        return;
      }

      const shown = new Map();
      let min = Infinity;
      let max = -Infinity;
      for (const row of rows) {
        for (const [label, value] of row.values) {
          min = Math.min(min, value);
          max = Math.max(max, value);
          shown.set(label, value);
        }
      }
      const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
      const low = min / scale;
      const high = max / scale;
      const spread = high - low;
      const x = index => 82 + (rows.length > 1 ? (index / (rows.length - 1)) * 658 : 329);
      const y = value => spread ? 213 - (value / scale - low) / spread * 191 : 118;
      const grid = Array.from({ length: 5 }, (_, index) => {
        const axisY = 22 + 191 * index / 4;
        const tick = (high - spread * index / 4) * scale;
        return '<line x1="82" x2="740" y1="' + axisY + '" y2="' + axisY + '"/>' +
          (spread || index === 2 ? '<text x="73" y="' + (axisY + 4) + '" text-anchor="end">' + displayNumber(tick) + '</text>' : "");
      }).join("");

      const paths = [];
      for (const [label, { color, unit }] of series) {
        if (!shown.has(label)) continue;
        const item = document.createElement("li");
        const dot = document.createElement("span");
        dot.style.backgroundColor = color;
        dot.setAttribute("aria-hidden", "true");
        item.append(dot, label + " " + displayNumber(shown.get(label)) + (unit ? " " + unit : ""));
        legend.append(item);
        let path = "";
        let connected = false;
        let lastPoint;
        for (const [index, row] of rows.entries()) {
          const value = row.values.get(label);
          if (value === undefined) {
            connected = false;
            continue;
          }
          lastPoint = [x(index), y(value)];
          path += (connected ? "L" : "M") + lastPoint.map(point => point.toFixed(2)).join(",");
          connected = true;
        }
        paths.push('<path d="' + path + '" stroke="' + color + '"/><circle cx="' +
          lastPoint[0] + '" cy="' + lastPoint[1] + '" r="3.8" fill="' + color + '"/>');
      }
      const start = rows[0].sequence;
      chart.innerHTML = grid + paths.join("") + '<text x="82" y="237">' + start + '회</text>' +
        (rows.length > 1 ? '<text x="740" y="237" text-anchor="end">' + sequence + '회</text>' : "");
    }

    pause.addEventListener("click", () => {
      paused = !paused;
      pause.textContent = paused ? "다시 재생" : "일시 정지";
      if (paused) summary.textContent = "그래프 일시 정지 · 데이터 수신 중";
      else render();
    });
    clear.addEventListener("click", () => {
      rows.length = 0;
      series.clear();
      sequence = 0;
      paused = false;
      pause.textContent = "일시 정지";
      render();
    });

    return {
      render,
      accept(line) {
        const fields = parse(line);
        if (!fields) return;
        const values = new Map();
        for (const { label, value, unit } of fields) {
          if (!series.has(label)) {
            if (series.size >= COLORS.length) continue;
            series.set(label, { color: COLORS[series.size], unit });
          }
          if (unit) series.get(label).unit = unit;
          values.set(label, value);
        }
        if (!values.size) return;
        rows.push({ sequence: ++sequence, values });
        if (rows.length > HISTORY) rows.shift();
        if (!panel.hidden && !paused && !timer) timer = setTimeout(render, 80);
      },
    };
  }

  window.OneMakerPlotter = { create, parse };
})();
