/* Audit trail — immutable log of every action, filterable. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, debounce, relative, fmtDate, esc, download } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, emptyState, confirmAction } from "../ui/feedback.js";
import { searchBox, dataTable, pagination, pill, avatar } from "../ui/widgets.js";

const ACTION_ICONS = {
  login: "key",
  logout: "logout",
  password_changed: "key",
  password_reset: "key",
  booking_created: "calendar-plus",
  booking_cancelled: "x",
  booking_rescheduled: "history",
  booking_status: "check-circle",
  booking_updated: "edit",
  booking_items_changed: "flask",
  booking_item_removed: "trash",
  booking_followup: "plus",
  payment_received: "money",
  refund_issued: "refresh",
  patient_registered: "user-plus",
  patient_updated: "edit",
  patient_deactivated: "x",
  product_created: "flask",
  product_updated: "edit",
  product_toggled: "flask",
  user_created: "user-plus",
  user_updated: "edit",
  settings_updated: "settings",
  system_seeded: "activity",
  catalogue_imported: "package",
};

export async function render(container) {
  const state = { q: "", action: "", page: 1, perPage: 25, actions: [], loading: true };

  const tableHost = h("div");

  const search = searchBox({
    placeholder: "Search action, employee or detail…",
    onInput: debounce((value) => { state.q = value; state.page = 1; load(); }, 300),
    onClear: () => { state.q = ""; load(); },
  });

  const actionSelect = h(
    "select.select",
    { onChange: (event) => { state.action = event.target.value; state.page = 1; load(); } },
    h("option", { value: "", text: "All actions" })
  );

  mount(
    container,
    h(
      "div.page-head",
      {},
      h("div", {}, h("h2", { text: "Audit trail" }),
        h("p", { text: "Every record change, attributed to an employee and timestamped (UTC)." })),
      h("div.page-actions", {},
        h("button.btn.btn-outline", {
          type: "button",
          onClick: () => download(`suraksha-audit-${new Date().toISOString().slice(0, 10)}.csv`,
            toCsv(), "text/csv"),
        }, icon("download", 15), "Export CSV"))
    ),
    h("div.info-banner", {}, icon("shield", 17),
      h("span", { text: "Audit entries are append-only. They cannot be edited or deleted through the application." })),
    h("div.toolbar", { style: { marginTop: "16px" } }, search.element, actionSelect),
    tableHost
  );

  let rows = [];
  await load();

  async function load() {
    mount(tableHost, loadingState("Loading audit log…"));
    try {
      const data = await api.get("/api/audit", {
        params: { q: state.q, action: state.action, page: state.page, per_page: state.perPage },
      });
      rows = data.items;
      state.actions = data.actions || [];

      clear(actionSelect);
      actionSelect.appendChild(h("option", { value: "", text: "All actions", selected: !state.action }));
      state.actions.forEach((action) => {
        actionSelect.appendChild(h("option", {
          value: action,
          text: action.replace(/_/g, " "),
          selected: action === state.action,
        }));
      });

      paint(data);
    } catch (error) {
      toast.error("Could not load audit log", error.message);
    }
  }

  function paint(data) {
    mount(
      tableHost,
      dataTable({
        columns: [
          { label: "When", render: (row) => h("div", {},
              h("div", { text: relative(row.created_at), style: { fontWeight: 600, fontSize: ".84rem" } }),
              h("span.cell-sub", { text: row.created_at ? fmtDate(String(row.created_at).slice(0, 10), { long: true }) : "" })) },
          { label: "Employee", render: (row) => h("div.patient-cell", {},
              avatar(row.user),
              h("div", {}, h("strong", { text: row.user }), h("span", { text: row.employee_id || "system" }))) },
          { label: "Action", render: (row) => h("div.row", { style: { gap: "8px" } },
              h("span.feed-icon", { style: { width: "26px", height: "26px" } }, icon(ACTION_ICONS[row.action] || "activity", 13)),
              h("strong", { text: row.action.replace(/_/g, " "), style: { fontSize: ".82rem" } })) },
          { label: "Entity", render: (row) => h("div", {},
              h("span", { text: row.entity || "—" }),
              row.entity_id ? h("span.cell-sub.mono", { text: `#${row.entity_id}` }) : null) },
          { label: "Detail", render: (row) => row.detail
              ? h("button.link-btn", { type: "button", text: "View", onClick: (event) => { event.stopPropagation(); openDetail(row); } })
              : h("span.muted", { text: "—" }) },
          { label: "IP", render: (row) => h("span.mono", { text: row.ip || "—", style: { fontSize: ".76rem" } }) },
        ],
        rows: data.items,
        onRowClick: (row) => row.detail && openDetail(row),
        empty: emptyState({ title: "No audit entries match", message: "Adjust the filters.", iconName: "history" }),
        foot: pagination({
          page: data.page, pages: data.pages, total: data.total, perPage: data.per_page,
          label: "entries",
          onPage: (page) => { state.page = page; load(); },
          onPerPage: (perPage) => { state.perPage = perPage; state.page = 1; load(); },
        }),
      })
    );
  }

  function openDetail(entry) {
    let formatted = entry.detail;
    try {
      formatted = JSON.stringify(JSON.parse(entry.detail), null, 2);
    } catch { /* plain text */ }

    openModal({
      title: entry.action.replace(/_/g, " "),
      subtitle: `${entry.user} · ${entry.created_at}`,
      body: h("div.stack", {},
        h("div.meta-grid", {},
          h("div.meta-item", {}, h("span", { text: "Entity" }), h("strong", { text: entry.entity || "—" })),
          h("div.meta-item", {}, h("span", { text: "Entity ID" }), h("strong", { text: entry.entity_id || "—" })),
          h("div.meta-item", {}, h("span", { text: "Source IP" }), h("strong", { text: entry.ip || "—" }))),
        h("pre", {
          text: formatted,
          style: {
            background: "var(--ink-50)", border: "1px solid var(--border)", borderRadius: "10px",
            padding: "14px", fontSize: ".78rem", overflowX: "auto", margin: "0",
            fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word",
          },
        })),
      footer: (close) => [h("button.btn.btn-outline", { type: "button", text: "Close", onClick: () => close() })],
    });
  }

  function toCsv() {
    const header = "timestamp,employee,employee_id,action,entity,entity_id,detail,ip\n";
    const body = rows.map((row) =>
      [row.created_at, row.user, row.employee_id, row.action, row.entity, row.entity_id,
        String(row.detail || "").replace(/"/g, "'"), row.ip]
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    return header + body;
  }
}
