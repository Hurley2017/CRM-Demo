/* --------------------------------------------------------------------------
   Dependency-free SVG charts: area/line, donut, horizontal bars.
   -------------------------------------------------------------------------- */

import { h, esc } from "./dom.js";

const COLORS = ["#4f46e5", "#14b8a6", "#f59e0b", "#8b5cf6", "#0ea5e9", "#ef4444", "#10b981"];

/**
 * Area + line chart.
 * data: [{ label, value }]
 */
export function areaChart(data, { height = 190, color = "#4f46e5", format = (v) => v, id = "" } = {}) {
  const width = 720;
  const pad = { top: 16, right: 8, bottom: 26, left: 8 };
  const values = data.map((d) => Number(d.value) || 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((d, index) => {
    const x = pad.left + index * stepX;
    const y = pad.top + innerH - ((Number(d.value) - min) / span) * innerH;
    return { x, y, ...d };
  });

  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)?.x ?? pad.left},${pad.top + innerH} L${pad.left},${pad.top + innerH} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = pad.top + innerH * ratio;
      return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#eef1f7" stroke-width="1" stroke-dasharray="3 5"/>`;
    })
    .join("");

  const labelEvery = Math.ceil(data.length / 7);
  const labels = points
    .map((p, i) =>
      i % labelEvery === 0 || i === points.length - 1
        ? `<text x="${p.x}" y="${height - 6}" font-size="10" fill="#94a3b8" text-anchor="middle">${esc(p.label)}</text>`
        : ""
    )
    .join("");

  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${p.x}" cy="${p.y}" r="3.4" fill="#fff" stroke="${color}" stroke-width="2.2" data-i="${i}" class="chart-dot"/>`
    )
    .join("");

  const tooltip = h("div.chart-tooltip");
  const svgHost = h("div.chart", {}, tooltip);

  svgHost.insertAdjacentHTML("afterbegin", `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="height:${height}px">
      <defs>
        <linearGradient id="fill-${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${area}" fill="url(#fill-${id})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
      ${labels}
    </svg>`);

  const svg = svgHost.querySelector("svg");
  svg.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const point = points[index];
    if (!point) return;
    tooltip.textContent = `${point.label} · ${format(point.value)}`;
    tooltip.style.left = `${(point.x / width) * 100}%`;
    tooltip.style.top = `${(point.y / height) * 100}%`;
    tooltip.classList.add("show");
  });
  svg.addEventListener("pointerleave", () => tooltip.classList.remove("show"));

  return svgHost;
}

/** Donut chart with centre label. segments: [{ label, value, color? }] */
export function donutChart(segments, { size = 160, thickness = 18, label = "", sub = "" } = {}) {
  const total = segments.reduce((sum, s) => sum + Number(s.value || 0), 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const arcs = segments
    .filter((s) => Number(s.value) > 0)
    .map((segment, index) => {
      const fraction = Number(segment.value) / total;
      const dash = fraction * circumference;
      const circle = `
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="${segment.color || COLORS[index % COLORS.length]}"
          stroke-width="${thickness}" stroke-linecap="butt"
          stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += dash;
      return circle;
    })
    .join("");

  const donutHost = h("div.donut", { style: { width: `${size}px`, height: `${size}px` } });
  donutHost.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none"
              stroke="#eef1f7" stroke-width="${thickness}"/>
      ${arcs}
    </svg>
    <div class="donut-center">
      <strong>${esc(sub)}</strong>
      <span>${esc(label)}</span>
    </div>`;

  const legend = h(
    "div.donut-legend",
    {},
    ...segments
      .filter((s) => Number(s.value) > 0)
      .map((segment, index) =>
        h(
          "div.row-between",
          {},
          h("span", {
            html: `<i class="legend-dot" style="background:${segment.color || COLORS[index % COLORS.length]}"></i>${esc(segment.label)}`,
          }),
          h("strong", { text: String(segment.value) })
        )
      )
  );

  return h("div.donut-wrap", {}, donutHost, legend);
}

/** Horizontal bar rows. rows: [{ label, value, display? }] */
export function barRows(rows, { color, max: forcedMax } = {}) {
  const max = forcedMax || Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  return h(
    "div",
    {},
    ...rows.map((row, index) =>
      h(
        "div.bar-row",
        { title: `${row.label}: ${row.display ?? row.value}` },
        h("span.truncate", { text: row.label }),
        h(
          "div.bar-track",
          {},
          h("div.bar-fill", {
            style: {
              width: `${Math.max(3, (Number(row.value) / max) * 100)}%`,
              background: row.color || color || `linear-gradient(90deg, ${COLORS[index % COLORS.length]}, ${COLORS[index % COLORS.length]}cc)`,
            },
          })
        ),
        h("span.bar-value", { text: row.display ?? String(row.value) })
      )
    )
  );
}

export function chartLegend(items) {
  return h(
    "div.chart-legend",
    {},
    ...items.map((item, index) =>
      h("span", {
        html: `<i style="background:${item.color || COLORS[index % COLORS.length]}"></i>${esc(item.label)}`,
      })
    )
  );
}
