/* Employees — accounts, roles and permissions (admin). */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, debounce, fmtDate, relative, esc, initials } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, emptyState, confirmAction } from "../ui/feedback.js";
import { searchBox, dataTable, pagination, pill, avatar, segmented } from "../ui/widgets.js";

const ALL_PERMISSIONS = [
  "dashboard.view", "reports.view", "patients.view", "patients.edit",
  "products.view", "products.edit", "bookings.view", "bookings.create",
  "bookings.edit", "bookings.cancel", "bookings.status", "bookings.refund",
  "billing.view", "billing.pay", "billing.refund", "users.view",
  "users.manage", "settings.manage", "audit.view", "notifications.view",
];

const ROLE_DESCRIPTIONS = {
  admin: "Full control including users, settings and audit trail.",
  manager: "Reports, pricing, refunds and every booking operation.",
  receptionist: "Patient registration, bookings and payment collection.",
  technician: "Sample collection and lab status updates only.",
};

export async function render(container) {
  const state = { q: "", status: "", page: 1, perPage: 20, roles: [], loading: true };

  const tableHost = h("div");
  const roleHost = h("div.grid.grid-3", { style: { marginTop: "20px" } });
  const countsHost = h("div");

  const search = searchBox({
    placeholder: "Search name, employee ID or email…",
    onInput: debounce((value) => { state.q = value; state.page = 1; load(); }, 300),
    onClear: () => { state.q = ""; load(); },
  });

  mount(
    container,
    h(
      "div.page-head",
      {},
      h("div", {}, h("h2", { text: "Employees" }), h("p", { text: "Staff accounts, roles and access levels." })),
      h("div.page-actions", {},
        store.can("users.manage")
          ? h("button.btn.btn-primary", { type: "button", onClick: () => openCreate(state.roles, load) },
              icon("user-plus", 16), "Add employee")
          : null)
    ),
    countsHost,
    h("div.toolbar", { style: { marginTop: "16px" } }, search.element),
    tableHost,
    h("div", { style: { marginTop: "24px" } },
      h("div.eyebrow", { text: "Roles & permissions", style: { marginBottom: "12px" } }),
      roleHost)
  );

  loadRoles();
  await load();

  async function loadRoles() {
    try {
      state.roles = await api.get("/api/users/roles");
      paintRoles();
    } catch { /* ignore */ }
  }

  function paintRoles() {
    clear(roleHost);
    state.roles.forEach((role) => {
      roleHost.appendChild(
        h("div.role-card", {},
          h("h4", {}, icon("shield", 16), role.label,
            pill(`${(role.permissions || []).length} perms`, "pill-brand")),
          h("p", { text: ROLE_DESCRIPTIONS[role.name] || role.description || "" }),
          h("div.perm-list", {},
            ...ALL_PERMISSIONS.map((permission) =>
              h("span.perm" + ((role.permissions || []).includes(permission) ? " on" : ""), {
                text: permission }))))
      );
    });
  }

  async function load() {
    try {
      const data = await api.get("/api/users", {
        params: { q: state.q, status: state.status, page: state.page, per_page: state.perPage },
      });
      state.loading = false;

      clear(countsHost);
      countsHost.appendChild(
        h("div.grid.grid-kpi", {},
          ...Object.entries(data.role_counts || {}).map(([role, count]) =>
            kpiFor(role, count)))
      );

      paintTable(data);
    } catch (error) {
      toast.error("Could not load employees", error.message);
    }
  }

  function kpiFor(role, count) {
    const labels = { admin: "Administrators", manager: "Managers", receptionist: "Receptionists", technician: "Technicians" };
    const icons = { admin: "shield", manager: "award", receptionist: "users", technician: "flask" };
    return h("div.kpi", {},
      h("div.kpi-top", {}, h("span.kpi-label", { text: labels[role] || role }),
        h("span.kpi-icon", {}, icon(icons[role] || "users", 17))),
      h("div.kpi-value", { text: String(count) }),
      h("div.kpi-foot", { text: ROLE_DESCRIPTIONS[role]?.split(".")[0] || "" }));
  }

  function paintTable(data) {
    mount(
      tableHost,
      dataTable({
        loading: state.loading,
        columns: [
          { label: "Employee", render: (row) => h("div.patient-cell", {},
              avatar(row.name),
              h("div", {}, h("strong", { text: row.name }),
                h("span", { text: `${row.employee_id} · ${row.designation || row.role?.label || ""}` }))) },
          { label: "Contact", render: (row) => h("div", {},
              h("div", { text: row.email }),
              h("span.cell-sub", { text: row.phone || "—" })) },
          { label: "Role", render: (row) => pill(row.role?.label || row.role?.name || "—",
              row.role?.name === "admin" ? "pill-brand" : "pill-neutral") },
          { label: "Status", render: (row) => pill(row.status === "active" ? "Active" : "Suspended",
              row.status === "active" ? "pill-completed" : "pill-noshow") },
          { label: "Last login", render: (row) => h("span.muted", {
              text: row.last_login_at ? relative(row.last_login_at) : "never",
              style: { fontSize: ".78rem" } }) },
          { label: "", className: "actions", render: (row) => h("div.row-actions", {},
              store.can("users.manage")
                ? h("button.icon-btn", { type: "button", "aria-label": "Edit",
                    onClick: (event) => { event.stopPropagation(); openEdit(row, state.roles, load); } }, icon("edit", 16))
                : null,
              store.can("users.manage")
                ? h("button.icon-btn", { type: "button", "aria-label": "Reset password",
                    onClick: (event) => { event.stopPropagation(); resetPassword(row); } }, icon("key", 16))
                : null) },
        ],
        rows: data.items,
        empty: emptyState({ title: "No employees found", message: "Try a different search term.", iconName: "users" }),
        foot: data ? pagination({
          page: data.page, pages: data.pages, total: data.total, perPage: data.per_page,
          label: "employees",
          onPage: (page) => { state.page = page; load(); },
        }) : null,
      })
    );
  }

  async function resetPassword(employee) {
    const password = h("input.input", { type: "text", value: randomPassword(), placeholder: "Minimum 8 characters" });

    openModal({
      title: `Reset password · ${employee.name}`,
      subtitle: employee.employee_id,
      body: h("div.stack", {},
        h("label.field", {}, h("span", { text: "Temporary password" }), password),
        h("div.info-banner.warning", {}, icon("alert", 17),
          h("span", { text: "Share it securely — the employee should change it after signing in." }))),
      footer: (close) => [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
        h("button.btn.btn-danger", {
          type: "button", text: "Reset password",
          onClick: async (event) => {
            event.currentTarget.classList.add("loading");
            try {
              const response = await api.post(`/api/users/${employee.id}/password`, { password: password.value });
              close();
              toast.success("Password reset", response.message);
            } catch (error) {
              event.currentTarget.classList.remove("loading");
              toast.error("Reset failed", error.message);
            }
          },
        }),
      ],
    });
  }
}

function randomPassword() {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  let value = "";
  for (let i = 0; i < 10; i += 1) value += all[Math.floor(Math.random() * all.length)];
  return `${value}!`;
}

export function openCreate(roles, onDone) {
  const name = h("input.input", { placeholder: "Full name" });
  const email = h("input.input", { type: "email", placeholder: "name@surakshadx.in" });
  const phone = h("input.input", { placeholder: "+91 98XXXXXXXX" });
  const designation = h("input.input", { placeholder: "Designation" });
  const role = h("select.select", {},
    ...roles.map((item) => h("option", { value: item.name, text: item.label })));
  const password = h("input.input", { type: "text", value: randomPassword() });

  openModal({
    title: "Add employee",
    subtitle: "A sign-in ID is generated automatically",
    size: "lg",
    body: h("div.form-grid", {},
      h("label.field", {}, h("span", { text: "Full name" }), name),
      h("label.field", {}, h("span", { text: "Email" }), email),
      h("label.field", {}, h("span", { text: "Phone" }), phone),
      h("label.field", {}, h("span", { text: "Designation" }), designation),
      h("label.field", {}, h("span", { text: "Role" }), role),
      h("label.field", {}, h("span", { text: "Temporary password" }), password)),
    footer: (close) => [
      h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
      h("button.btn.btn-primary", {
        type: "button", text: "Create account",
        onClick: async (event) => {
          event.currentTarget.classList.add("loading");
          try {
            const result = await api.post("/api/users", {
              name: name.value.trim(),
              email: email.value.trim(),
              phone: phone.value.trim(),
              designation: designation.value.trim(),
              role: role.value,
              password: password.value,
            });
            close();
            toast.success("Employee added", `${result.employee_id} · ${result.role.label}`);
            onDone?.();
          } catch (error) {
            event.currentTarget.classList.remove("loading");
            toast.error("Could not create account", error.message);
          }
        },
      }),
    ],
  });
}

export function openEdit(employee, roles, onDone) {
  const name = h("input.input", { value: employee.name });
  const email = h("input.input", { value: employee.email });
  const phone = h("input.input", { value: employee.phone || "" });
  const designation = h("input.input", { value: employee.designation || "" });
  const role = h("select.select", {},
    ...roles.map((item) => h("option", { value: item.name, text: item.label, selected: employee.role?.name === item.name })));
  const status = h("select.select", {},
    h("option", { value: "active", text: "Active", selected: employee.status === "active" }),
    h("option", { value: "suspended", text: "Suspended", selected: employee.status === "suspended" }));

  openModal({
    title: `Edit ${employee.name}`,
    subtitle: employee.employee_id,
    size: "lg",
    body: h("div.form-grid", {},
      h("label.field", {}, h("span", { text: "Full name" }), name),
      h("label.field", {}, h("span", { text: "Email" }), email),
      h("label.field", {}, h("span", { text: "Phone" }), phone),
      h("label.field", {}, h("span", { text: "Designation" }), designation),
      h("label.field", {}, h("span", { text: "Role" }), role),
      h("label.field", {}, h("span", { text: "Status" }), status)),
    footer: (close) => [
      h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
      h("button.btn.btn-primary", {
        type: "button", text: "Save changes",
        onClick: async (event) => {
          event.currentTarget.classList.add("loading");
          try {
            const result = await api.put(`/api/users/${employee.id}`, {
              name: name.value.trim(),
              email: email.value.trim(),
              phone: phone.value.trim(),
              designation: designation.value.trim(),
              role: role.value,
              status: status.value,
            });
            close();
            toast.success("Employee updated", result.message);
            onDone?.();
          } catch (error) {
            event.currentTarget.classList.remove("loading");
            toast.error("Update failed", error.message);
          }
        },
      }),
    ],
  });
}
