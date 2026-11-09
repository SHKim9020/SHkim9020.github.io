(() => {
  "use strict";
  const LIMIT = 10000;
  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

  function parse(line) {
    const text = line.trim().replace(/^LOG,/, "").trim();
    const fields = text.split(",").map(value => value.trim());
    let temperature, humidity;
    if (fields[0] === "DATA" && (fields.length === 3 || fields.length === 4)) {
      if (fields.length === 4 && !/^\d+$/.test(fields[1])) return null;
      [temperature, humidity] = fields.slice(-2);
    } else {
      const labeled = /^(?:temp(?:erature)?|온도)\s*[:=]\s*([^,;\s]+)\s*[,;\s]+\s*(?:humi(?:dity)?|습도)\s*[:=]\s*(\S+)$/i.exec(text);
      if (!labeled) return null;
      [, temperature, humidity] = labeled;
    }
    if (!NUMBER.test(temperature) || !NUMBER.test(humidity)) return null;
    const t = Number(temperature);
    const h = Number(humidity);
    if (t < -100 || t > 150 || h < 0 || h > 100) return null;
    return { temperature: t, humidity: h };
  }

  function csv(rows) {
    const quote = (value) => {
      const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    return "\ufeff측정시각,장소,회차,온도_C,상대습도_pct\r\n" + rows.map(row =>
      [new Date(row.time).toISOString(), quote(row.place), row.sequence, row.temperature, row.humidity].join(",")
    ).join("\r\n") + "\r\n";
  }

  function draw(svg, rows, metric) {
    const values = rows.map(row => row[metric]);
    const min = Math.floor(Math.min(...values)) - 1;
    const max = Math.ceil(Math.max(...values)) + 1;
    const y = (value) => 98 - (value - min) * 78 / (max - min);
    const x = (index) => 38 + (rows.length > 1 ? index * 304 / (rows.length - 1) : 152);
    const points = values.map((value, i) => `${x(i).toFixed(2)},${y(value).toFixed(2)}`);
    const ticks = [min, (min + max) / 2, max];
    svg.innerHTML = ticks.map(tick => `
      <line x1="38" x2="342" y1="${y(tick)}" y2="${y(tick)}" stroke="#dbe4ea"/>
      <text x="32" y="${y(tick) + 3}" text-anchor="end" font-size="9" fill="#42576a">${tick}</text>`).join("") +
      `<polyline points="${points.join(" ")}" fill="none" stroke="currentColor" stroke-width="2"/>` +
      values.map((value, i) => `<circle cx="${x(i)}" cy="${y(value)}" r="2.5" fill="currentColor"/>`).join("") +
      `<text x="38" y="114" font-size="9" fill="#42576a">${rows[0].sequence}회</text>
      <text x="342" y="114" text-anchor="end" font-size="9" fill="#42576a">${rows.at(-1).sequence}회</text>`;
  }

  function create({ panel, download }) {
    const rows = [];
    const place = panel.querySelector("#measurePlace");
    const summary = panel.querySelector("#measureSummary");
    const exportButton = panel.querySelector("#measureExport");
    const charts = [...panel.querySelectorAll("svg[data-metric]")];
    let timer;
    function render() {
      clearTimeout(timer);
      timer = null;
      if (!panel.classList.contains("active")) return;
      const recent = rows.slice(-60);
      const latest = recent.at(-1);
      summary.textContent = latest
        ? `${rows.length.toLocaleString()}건 · 최근 ${latest.temperature.toFixed(2)} °C / ${latest.humidity.toFixed(2)} %${rows.length === LIMIT ? " · 기록 한도 도달" : ""}`
        : "측정값을 기다리는 중입니다.";
      exportButton.disabled = !latest;
      for (const chart of charts) {
        if (latest) draw(chart, recent, chart.dataset.metric);
        else chart.replaceChildren();
      }
    }
    exportButton.addEventListener("click", () => {
      if (rows.length) download("온습도-측정기록.csv", csv(rows), "text/csv;charset=utf-8");
    });
    panel.querySelector("#measureReset").addEventListener("click", () => {
      if (rows.length && window.confirm("현재 측정 기록을 지울까요?")) {
        rows.length = 0;
        render();
      }
    });
    return {
      render,
      accept(line) {
        if (rows.length >= LIMIT) return;
        const values = parse(line);
        if (!values) return;
        rows.push({ ...values, time: Date.now(), place: place.value.trim(), sequence: rows.length + 1 });
        if (panel.classList.contains("active") && !timer) timer = setTimeout(render, 100);
      }
    };
  }

  window.OneMakerMeasurements = { create, parse, csv };
})();
