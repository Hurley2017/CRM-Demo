/* Patient record — profile, edit and booking history. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, money, fmtDate, fmtTime, relative, esc } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, emptyState, confirmAction } from "../ui/feedback.js";
import { avatar, statusPill, pill, detailRow, metaItem, dataTable } from "../ui/widgets.js";
import { openRegister } from "./patients.js";

export async function render(container, { params }) {
  const mountPoint = h("div");
  mount(container, mountPoint);
  await load();

  async function load() {
    mount(mountPoint, loadingState("Loading patient record…"));
    let patient;
    try {
      patient = await api.get(`/api/patients/${params.id}`);
    } catch (error) {
      mount(mountPoint, emptyState({
        title: "Patient not found",
        message: error.message,
        actionLabel: "Back to patients",
        onAction: () => (location.hash = "#/patients"),
        iconName: "users",
      }));
      return;
    }
    paint(patient);
  }

  function paint(patient) {
    const currency = store.currency;
    const spend = (patient.bookings || []).reduce((sum, booking) =>
      sum + (["CANCELLED", "NO_SHOW"].includes(booking.status) ? 0 : booking.total), 0);

    const header = h(
      "section.detail-hero",
      {},
      h(
        "div",
        {},
        h("div.dh-id", { text: patient.code }),
        h("h2", { text: patient.name }),
        h("div.dh-sub", {
          html: `${esc(patient.gender || "other")} · ${patient.age ?? "—"} yrs ·
                 <strong>${esc(patient.phone || "no phone")}</strong>${patient.email ? ` · ${esc(patient.email)}` : ""}`,
        }),
        h("div.row", { style: { marginTop: "12px", gap: "8px", flexWrap: "wrap" } },
          pill(patient.active ? "Active" : "Inactive", patient.active ? "pill-completed" : "pill-cancelled"),
          patient.blood_group ? pill(patient.blood_group, "pill-brand") : null,
          patient.allergies ? pill(`Allergies: ${patient.allergies}`, "pill-noshow") : null)
      ),
      h(
        "div.dh-actions",
        {},
        store.can("bookings.create")
          ? h("button.btn.btn-primary", {
              type: "button",
              onClick: () => { location.hash = "#/bookings/new"; sessionStorage.setItem("prefill_patient", String(patient.id)); },
            }, icon("calendar-plus", 16), "Book appointment")
          : null,
        store.can("patients.edit")
          ? h("button.btn.btn-outline", { type: "button", onClick: () => openEdit(patient, load) },
              icon("edit", 16), "Edit record")
          : null
      )
    );

    const statBand = h(
      "div.stat-band",
      { style: { marginBottom: "16px" } },
      metaItem("Total bookings", String(patient.total_bookings)),
      metaItem("Last visit", patient.last_visit ? fmtDate(patient.last_visit) : "First visit"),
      metaItem("Lifetime value", money(spend, currency)),
      metaItem("Registered", patient.created_at ? fmtDate(patient.created_at) : "—")
    );

    const profileCard = h(
      "div.card.card-pad",
      {},
      h("div.eyebrow", { text: "Demographics" }),
      h("div.divider"),
      h("div.detail-list", {},
        detailRow("Date of birth", patient.dob ? fmtDate(patient.dob, { long: true }) : "—"),
        detailRow("Gender", patient.gender || "—"),
        detailRow("Blood group", patient.blood_group || "—"),
        detailRow("Phone", patient.phone || "—"),
        detailRow("Email", patient.email || "—"),
        detailRow("Address", [patient.address, patient.city].filter(Boolean).join(", ") || "—"),
        detailRow("Allergies", patient.allergies || "None recorded"),
        detailRow("Notes", patient.notes || "—"))
    );

    const historyCard = h(
      "div.card",
      {},
      h(
        "div.card-head",
        {},
        h("div", {}, h("h3", { text: "Booking history" }), h("p", { text: `${patient.bookings?.length || 0} most recent appointments` }))
      ),
      (patient.bookings || []).length
        ? dataTable({
            columns: [
              { label: "Booking", render: (row) => h("span.booking-no", { text: row.booking_no }) },
              { label: "Date", render: (row) => h("div", {}, h("span", { text: fmtDate(row.booking_date) }),
                  h("span.cell-sub", { text: fmtTime(row.slot_start), style: { fontFamily: "var(--font-mono)" } })) },
              { label: "Tests", render: (row) => h("span", { text: String(row.items?.length || 0) }) },
              { label: "Status", render: (row) => statusPill(row.status) },
              { label: "Amount", className: "text-right",
                render: (row) => h("strong", { text: money(row.total, currency) }) },
              { label: "", className: "actions", render: (row) =>
                  h("button.icon-btn", { type: "button", "aria-label": "Open",
                    onClick: (event) => { event.stopPropagation(); location.hash = `#/bookings/${row.id}`; } },
                    icon("chevron-right", 16)) },
            ],
            rows: patient.bookings,
            onRowClick: (row) => (location.hash = `#/bookings/${row.id}`),
            empty: emptyState({ title: "No bookings yet", message: "Create the first appointment for this patient.", iconName: "calendar" }),
          })
        : emptyState({
            title: "No bookings yet",
            message: `${patient.name} has not visited the centre before.`,
            actionLabel: store.can("bookings.create") ? "Create booking" : null,
            onAction: () => (location.hash = "#/bookings/new"),
            iconName: "calendar",
          })
    );

    mount(
      mountPoint,
      h("div.row-between", { style: { marginBottom: "16px", flexWrap: "wrap" } },
        h("button.btn.btn-ghost", { type: "button", onClick: () => (location.hash = "#/patients") },
          icon("arrow-left", 15), "All patients"),
        store.can("patients.edit") && patient.active
          ? h("button.btn.btn-ghost", {
              type: "button",
              onClick: async () => {
                const yes = await confirmAction({
                  title: "Deactivate this patient?",
                  message: "They stay searchable in history but cannot receive new bookings.",
                  confirmText: "Deactivate",
                  danger: true,
                });
                if (!yes) return;
                try {
                  await api.post(`/api/patients/${patient.id}/deactivate`);
                  toast.success("Patient deactivated");
                  load();
                } catch (error) {
                  toast.error("Action failed", error.message);
                }
              },
            }, icon("x", 15), "Deactivate")
          : null),
      header,
      statBand,
      h("div.detail-grid", {},
        h("div.stack", {}, historyCard),
        h("div", {}, profileCard))
    );
  }

  function openEdit(patient, done) {
    const fields = {
      name: h("input.input", { value: patient.name || "" }),
      phone: h("input.input", { value: patient.phone || "" }),
      email: h("input.input", { value: patient.email || "" }),
      gender: h("select.select", {},
        ...["female", "male", "other"].map((value) =>
          h("option", { value, text: value[0].toUpperCase() + value.slice(1), selected: patient.gender === value }))),
      dob: h("input.input", { type: "date", value: patient.dob || "" }),
      blood_group: h("select.select", {},
        h("option", { value: "", text: "Unknown", selected: !patient.blood_group }),
        ...["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((group) =>
          h("option", { value: group, text: group, selected: patient.blood_group === group }))),
      address: h("input.input", { value: patient.address || "" }),
      city: h("input.input", { value: patient.city || "" }),
      allergies: h("input.input", { value: patient.allergies || "" }),
      notes: h("textarea.textarea", { rows: "3" }, patient.notes || ""),
    };

    openModal({
      title: `Edit ${patient.code}`,
      subtitle: patient.name,
      size: "lg",
      body: h("div.form-grid", {},
        labelled("Full name", fields.name, true),
        labelled("Phone", fields.phone, true),
        labelled("Email", fields.email),
        labelled("Gender", fields.gender),
        labelled("Date of birth", fields.dob),
        labelled("Blood group", fields.blood_group),
        labelled("Address", fields.address),
        labelled("City", fields.city),
        labelled("Allergies", fields.allergies, false, "Flagged on every booking"),
        labelled("Notes", fields.notes)),
      footer: (close) => [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
        h("button.btn.btn-primary", {
          type: "button", text: "Save changes",
          onClick: async (event) => {
            event.currentTarget.classList.add("loading");
            try {
              const payload = {};
              Object.entries(fields).forEach(([key, node]) => { payload[key] = node.value; });
              await api.put(`/api/patients/${patient.id}`, payload);
              close();
              toast.success("Record updated");
              done();
            } catch (error) {
              event.currentTarget.classList.remove("loading");
              toast.error("Update failed", error.message);
            }
          },
        }),
      ],
    });
  }
}

function labelled(label, control, required = false, hint = "") {
  return h(
    "label.field",
    {},
    h("span", {}, label, required ? h("span", { text: " *", style: { color: "var(--danger-500)" } }) : null),
    control,
    hint ? h("span.field-hint", { text: hint }) : null
  );
}
