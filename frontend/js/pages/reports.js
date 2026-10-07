/* Reports — period filters, KPIs, charts, top tests and CSV export. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, money, compactMoney, fmtDate, esc } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, emptyState } from "../ui/feedback.js";
import { kpiCard, segmented, dataTable, pill, avatar } from "../ui/widgets.js";
import { areaChart, donutChart, barRows, chartLegend } from "../ui/charts.js";

const PERIODS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "365d", label: "1 year" },
];

const STATUS_LABELS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  SAMPLE_COLLECTED: "Sample collected",
  IN_LAB: "In lab",
  COMPLETED: "Completed",
  REPORT_READY: "Report ready",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
};

const STATUS_COLORS = {
  PENDING: "#f59e0b", CONFIRMED: "#3b82f6", SAMPLE_COLLECTED: "#8b5cf6",
  IN_LAB: "#06b6d4", COMPLETED: "#10b981", REPORT_READY: "#059669",
  CANCELLED: "#94a3b8", NO_SHOW: "#ef4444",
};

export async function render(container) {
  const state = { period: "30d", from: "", to: "" };

  const controls = h(
    "div.report-filters",
    {},
    segmented({ options: PERIODS, value: state.period, onChange: (value) => { state.period = value; state.from = ""; state.to = ""; load(); } }),
    h("label.row", { style: { gap: "8px" } },
      h("span.muted", { text: "From", style: { fontSize: ".78rem" } }),
      h("input.input", { type: "date", style: { width: "150px" }, onChange: (event) => { state.from = event.target.value; } })),
    h("label.row", { style: { gap: "8px" } },
      h("span.muted", { text: "To", style: { fontSize: ".78rem" } }),
      h("input.input", { type: "date", style: { width: "150px" }, onChange: (event) => { state.to = event.target.value; } })),
    h("button.btn.btn-outline", { type: "button", onClick: () => load() }, icon("filter", 15), "Apply"),
    h("div", { style: { marginLeft: "auto" } },
      h("button.btn.btn-primary", { type: "button", onClick: exportCsv }, icon("download", 15), "Export CSV"))
  );

  const body = h("div");
  mount(container,
    h("div.page-head", {},
      h("div", {}, h("h2", { text: "Reports" }), h("p", { text: "Revenue, operations and staff performance." }))),
    controls,
    body);

  await load();

  async function load() {
    mount(body, loadingState("Crunching numbers…"));
    try {
      const params = { period: state.period };
      if (state.from) params.from = state.from;
      if (state.to) params.to = state.to;

      const [overview, topTests, categories, staff] = await Promise.all([
        api.get("/api/reports/overview", { params }),
        api.get("/api/reports/top-tests", { params }),
        api.get("/api/reports/category-mix", { params }),
        api.get("/api/reports/staff", { params }),
      ]);
      paint(overview, topTests, categories, staff);
    } catch (error) {
      mount(body, emptyState({ title: "Could not build the report", message: error.message, iconName: "chart" }));
    }
  }

  function paint(overview, topTests, categories, staff) {
    const currency = store.currency;
    const label = `${fmtDate(overview.from, { long: true })} → ${fmtDate(overview.to, { long: true })}`;

    const kpis = h("div.grid.grid-kpi", {},
      kpiCard({ label: "Revenue", value: money(overview.revenue, currency), iconName: "money", tone: "success",
        foot: `${money(overview.avg_ticket, currency)} average per booking` }),
      kpiCard({ label: "Bookings", value: overview.bookings.toLocaleString("en-IN"), iconName: "calendar", tone: "brand",
        foot: `${overview.completed} completed` }),
      kpiCard({ label: "Net after refunds", value: money(overview.net, currency), iconName: "trending-up", tone: "violet",
        foot: `${money(overview.refunds, currency)} refunded` }),
      kpiCard({ label: "No-show rate", value: `${overview.no_show_rate}%`, iconName: "alert",
        tone: overview.no_show_rate > 8 ? "danger" : "warning",
        foot: `${overview.no_shows} no-shows · ${overview.cancelled} cancelled` }),
      kpiCard({ label: "Cancellation rate",
        value: `${overview.bookings ? Math.round((overview.cancelled / overview.bookings) * 100) : 0}%`,
        iconName: "x", tone: "warning", foot: `${overview.cancelled} cancellations` }),
      kpiCard({ label: "Date range", value: `${overview.series.length}d`, iconName: "history", tone: "accent",
        foot: label }));

    const bookingsPerDay = h(
      "div",
      { style: { marginTop: "18px", paddingTop: "16px", borderTop: "1px dashed var(--border)" } },
      h("div.eyebrow", { text: "Bookings per day", style: { marginBottom: "8px" } }),
      barRows(
        overview.series
          .filter((point) => point.bookings > 0)
          .slice(-10)
          .map((point) => ({ label: point.label, value: point.bookings, display: String(point.bookings) }))
      )
    );

    const revenueCard = h(
      "div.card",
      {},
      h(
        "div.card-head",
        {},
        h("div", {}, h("h3", { text: "Revenue & bookings" }), h("p", { text: label }))
      ),
      h(
        "div.card-body",
        {},
        areaChart(overview.series.map((point) => ({ label: point.label, value: point.revenue })), {
          height: 210,
          color: "#4f46e5",
          format: (value) => money(value, currency),
          id: "rev",
        }),
        bookingsPerDay
      )
    );

    const statusCard = h("div.card", {},
      h("div.card-head", {}, h("div", {}, h("h3", { text: "Status distribution" }), h("p", { text: "Bookings in range" }))),
      h("div.card-body", {},
        overview.by_status.length
          ? donutChart(overview.by_status.map((row) => ({
              label: STATUS_LABELS[row.status] || row.status,
              value: row.count,
              color: STATUS_COLORS[row.status],
            })), { size: 160, label: "bookings", sub: String(overview.bookings) })
          : h("p.muted", { text: "No bookings in this range." })));

    const topCard = h("div.card", {},
      h("div.card-head", {}, h("div", {}, h("h3", { text: "Most requested tests" }), h("p", { text: "By line-item volume" }))),
      h("div.card-body", {},
        topTests.length
          ? barRows(topTests.map((row) => ({ label: row.name, value: row.orders, display: String(row.orders) })))
          : h("p.muted", { text: "No data in this range." })));

    const categoryCard = h("div.card", {},
      h("div.card-head", {}, h("div", {}, h("h3", { text: "Revenue by category" }), h("p", { text: "Where the money comes from" }))),
      h("div.card-body", {},
        categories.length
          ? barRows(categories.map((row) => ({
              label: row.category, value: row.revenue, display: compactMoney(row.revenue, currency),
            })), { color: "linear-gradient(90deg, #14b8a6, #0d9488)" })
          : h("p.muted", { text: "No data in this range." })));

    const staffCard = h("div.card", {},
      h("div.card-head", {}, h("div", {}, h("h3", { text: "Bookings by employee" }), h("p", { text: "Who created them" }))),
      staff.length
        ? dataTable({
            columns: [
              { label: "Employee", render: (row) => h("div.patient-cell", {},
                  avatar(row.name),
                  h("div", {}, h("strong", { text: row.name }), h("span", { text: row.employee_id || "—" }))) },
              { label: "Bookings", className: "text-right", render: (row) => h("strong", { text: row.bookings.toLocaleString("en-IN") }) },
              { label: "Value", className: "text-right", render: (row) => h("strong", { text: money(row.revenue, currency) }) },
            ],
            rows: staff,
            empty: emptyState({ title: "No staff activity", message: "No bookings were created in this range.", iconName: "users" }),
          })
        : emptyState({ title: "No staff activity", message: "No bookings were created in this range.", iconName: "users" }));

    mount(body,
      kpis,
      h("section.grid.grid-2", { style: { marginTop: "16px" } }, revenueCard, statusCard),
      h("section.grid.grid-2", { style: { marginTop: "16px" } }, topCard, categoryCard),
      h("section", { style: { marginTop: "16px" } }, staffCard));
  }

  function exportCsv() {
    const params = new URLSearchParams({ period: state.period });
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
    const url = `/api/reports/export?${params.toString()}`;
    const link = h("a", { href: url, download: "" });
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success("Export started", "Your CSV download will begin momentarily.");
  }
}
