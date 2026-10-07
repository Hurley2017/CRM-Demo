/* --------------------------------------------------------------------------
   Reusable page widgets — status pills, avatars, tables, pagination, etc.
   -------------------------------------------------------------------------- */

import { h, esc, initials, money, fmtDate, fmtTime, clear } from "./dom.js";
import { icon } from "./icons.js";
import { emptyState, skeletonRows } from "./feedback.js";

export const STATUS_META = {
  PENDING: { label: "Pending", cls: "pill-pending", icon: "clock" },
  CONFIRMED: { label: "Confirmed", cls: "pill-confirmed", icon: "check-circle" },
  SAMPLE_COLLECTED: { label: "Sample Collected", cls: "pill-sample", icon: "flask" },
  IN_LAB: { label: "In Lab", cls: "pill-lab", icon: "test_tube" },
  COMPLETED: { label: "Completed", cls: "pill-completed", icon: "check" },
  REPORT_READY: { label: "Report Ready", cls: "pill-report", icon: "report" },
  CANCELLED: { label: "Cancelled", cls: "pill-cancelled", icon: "x" },
  NO_SHOW: { label: "No Show", cls: "pill-noshow", icon: "alert" },
};

export function statusPill(status, label) {
  const meta = STATUS_META[status] || { label: label || status, cls: "pill-neutral" };
  return h(
    `span.pill.${meta.cls}`,
    {},
    h("span.dot"),
    label || meta.label
  );
}

export function avatar(name, extraClass = "") {
  return h(`span.avatar${extraClass ? ` ${extraClass}` : ""}`, { text: initials(name) });
}

export function pill(text, cls = "pill-neutral") {
  return h(`span.pill.${cls}`, { text });
}

export function tag(text, cls = "") {
  return h(`span.tag${cls ? ` ${cls}` : ""}`, { text });
}

/* ------------------------------------------------------------------ table */

/**
 * dataTable({ columns, rows, onRowClick, empty, loading, foot, rowKey })
 * columns: [{ key, label, className, render(row), align }]
 */
export function dataTable({
  columns,
  rows,
  onRowClick = null,
  empty = null,
  loading = false,
  foot = null,
  rowClass = null,
}) {
  const head = h(
    "thead",
    {},
    h(
      "tr",
      {},
      ...columns.map((col) =>
        h("th", { class: col.className || "", style: col.width ? { width: col.width } : null }, col.label)
      )
    )
  );

  const body = h("tbody");

  if (loading) {
    appendRows(body, skeletonRows(6, columns.length));
  } else if (!rows || rows.length === 0) {
    const message = empty || emptyState({ title: "Nothing here yet", message: "Records will appear as they are created." });
    body.appendChild(
      h("tr", {}, h("td", { colspan: columns.length, style: { padding: 0 } }, message))
    );
  } else {
    appendRows(
      body,
      rows.map((row, index) => {
        const tr = h("tr", {
          class: [onRowClick ? "clickable" : "", rowClass ? rowClass(row) : ""].filter(Boolean).join(" "),
          onClick: onRowClick ? (event) => onRowClick(row, event) : null,
        });
        columns.forEach((col) => {
          const td = h("td", { class: col.className || "" });
          const value = col.render ? col.render(row, index) : row[col.key];
          if (value instanceof Node) td.appendChild(value);
          else td.innerHTML = value ?? "";
          tr.appendChild(td);
        });
        return tr;
      })
    );
  }

  const table = h("table.table", {}, head, body);

  return h(
    "div.table-wrap",
    {},
    h("div.table-scroll", {}, table),
    foot ? h("div.table-foot", {}, foot) : null
  );
}

function appendRows(body, rows) {
  rows.forEach((row) => body.appendChild(row));
}

/* ------------------------------------------------------------- pagination */

export function pagination({ page, pages, total, onPage, perPage, onPerPage, label = "records" }) {
  const numbers = pageNumbers(page, pages);

  const controls = h(
    "div.pagination",
    {},
    h("button.page-btn", {
      type: "button",
      disabled: page <= 1,
      onClick: () => onPage(page - 1),
      "aria-label": "Previous page",
      html: "&lsaquo;",
    }),
    ...numbers.map((value) =>
      value === "…"
        ? h("span", { text: "…", style: { padding: "0 4px", color: "var(--ink-400)" } })
        : h("button.page-btn", {
            type: "button",
            class: value === page ? "active" : "",
            onClick: () => onPage(value),
            text: String(value),
          })
    ),
    h("button.page-btn", {
      type: "button",
      disabled: page >= pages,
      onClick: () => onPage(page + 1),
      "aria-label": "Next page",
      html: "&rsaquo;",
    })
  );

  const nodes = [
    h("span", { text: `${total.toLocaleString("en-IN")} ${label}` }),
    onPerPage
      ? h(
          "label.row",
          { style: { gap: "6px", marginLeft: "14px" } },
          h("span", { text: "Per page", class: "muted" }),
          h(
            "select.select",
            {
              style: { width: "auto", padding: "5px 28px 5px 9px", fontSize: ".78rem" },
              onChange: (event) => onPerPage(Number(event.target.value)),
            },
            ...[10, 15, 25, 50, 100].map((value) =>
              h("option", { value, selected: value === perPage, text: String(value) })
            )
          )
        )
      : null,
  ];

  return h("div.row", {}, ...nodes, h("div", { style: { marginLeft: "auto" } }, controls));
}

function pageNumbers(page, pages) {
  const result = [];
  const push = (value) => result.push(value);
  if (pages <= 7) {
    for (let i = 1; i <= pages; i += 1) push(i);
    return result;
  }
  push(1);
  if (page > 3) push("…");
  for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i += 1) push(i);
  if (page < pages - 2) push("…");
  push(pages);
  return result;
}

/* -------------------------------------------------------------- controls */

export function searchBox({ placeholder = "Search…", value = "", onInput, onClear, id }) {
  const input = h("input.input", {
    type: "search",
    placeholder,
    value,
    onInput: (event) => onInput?.(event.target.value),
    onKeydown: null,
  });

  const wrap = h(
    "div.search-box",
    {},
    h("span.search-icon", {}, icon("search", 16)),
    input
  );

  if (onClear) {
    const clearBtn = h("button.icon-btn.clear-btn", {
      type: "button",
      "aria-label": "Clear search",
      onClick: () => {
        input.value = "";
        onClear();
      },
      html: "&times;",
    });
    clearBtn.style.width = "26px";
    clearBtn.style.height = "26px";
    clearBtn.style.opacity = value ? "1" : "0";
    wrap.appendChild(clearBtn);
    input.addEventListener("input", () => {
      clearBtn.style.opacity = input.value ? "1" : "0";
    });
  }
  if (id) input.id = id;

  return { element: wrap, input };
}

export function segmented({ options, value, onChange }) {
  const wrap = h("div.segmented");
  options.forEach((option) => {
    const btn = h("button", {
      type: "button",
      class: option.value === value ? "active" : "",
      text: option.label,
      onClick: () => {
        wrap.querySelectorAll("button").forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        onChange(option.value);
      },
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

export function chipRow({ options, value, onChange }) {
  const wrap = h("div.filter-chips");
  options.forEach((option) => {
    const btn = h("button", {
      type: "button",
      class: ["chip", option.value === value ? "active" : ""].filter(Boolean).join(" "),
      onClick: () => {
        wrap.querySelectorAll(".chip").forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        onChange(option.value);
      },
    });
    btn.appendChild(document.createTextNode(option.label));
    if (option.count !== undefined) {
      btn.appendChild(h("span", { text: ` ${option.count}`, style: { opacity: 0.65 } }));
    }
    wrap.appendChild(btn);
  });
  return wrap;
}

export function field(label, control, { hint = "", error = "", span = false, required = false } = {}) {
  return h(
    `label.field${span ? " span-2" : ""}`,
    {},
    h("span", {}, label, required ? h("span", { text: " *", style: { color: "var(--danger-500)" } }) : null),
    control,
    hint ? h("span.field-hint", { text: hint }) : null,
    error ? h("span.field-error", { text: error }) : null
  );
}

export function select(options, { value = "", onChange, placeholder = null, className = "select" } = {}) {
  return h(
    `select.${className}`,
    { onChange: (event) => onChange?.(event.target.value) },
    placeholder !== null ? h("option", { value: "", text: placeholder }) : null,
    ...options.map((option) =>
      h("option", {
        value: option.value ?? option,
        text: option.label ?? option,
        selected: String(option.value ?? option) === String(value),
      })
    )
  );
}

export function metaItem(label, value) {
  return h("div.meta-item", {}, h("span", { text: label }), h("strong", { text: value ?? "—" }));
}

export function detailRow(label, valueNode) {
  return h(
    "div.dl-row",
    {},
    h("span", { text: label }),
    valueNode instanceof Node ? valueNode : h("span", { text: String(valueNode ?? "—") })
  );
}

/* --------------------------------------------------------- list helpers */

export function bookingRowMeta(booking) {
  return {
    when: `${fmtDate(booking.booking_date)} · ${fmtTime(booking.slot_start)}`,
    amount: money(booking.total),
  };
}

export function kpiCard({ label, value, foot, iconName, tone = "brand", onClick }) {
  const tones = {
    brand: { bg: "#eef2ff", fg: "#4f46e5", tint: "rgba(99,102,241,.12)" },
    accent: { bg: "#ccfbf1", fg: "#0d9488", tint: "rgba(20,184,166,.14)" },
    warning: { bg: "#fffbeb", fg: "#b45309", tint: "rgba(245,158,11,.16)" },
    danger: { bg: "#fef2f2", fg: "#b91c1c", tint: "rgba(239,68,68,.14)" },
    success: { bg: "#ecfdf5", fg: "#047857", tint: "rgba(16,185,129,.15)" },
    violet: { bg: "#f5f3ff", fg: "#6d28d9", tint: "rgba(139,92,246,.15)" },
  };
  const palette = tones[tone] || tones.brand;

  return h(
    `div.kpi${onClick ? " clickable" : ""}`,
    {
      style: { "--kpi-bg": palette.bg, "--kpi-fg": palette.fg, "--kpi-tint": palette.tint, cursor: onClick ? "pointer" : "" },
      onClick,
    },
    h(
      "div.kpi-top",
      {},
      h("span.kpi-label", { text: label }),
      h("span.kpi-icon", {}, icon(iconName || "activity", 17))
    ),
    h("div.kpi-value", { text: String(value) }),
    foot ? h("div.kpi-foot", { html: foot }) : null
  );
}

export function reloadButton(onClick) {
  return h("button.icon-btn.bordered", { type: "button", "aria-label": "Refresh", onClick }, icon("refresh", 16));
}
