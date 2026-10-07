/* Booking detail — status timeline, actions, items, invoice. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, money, fmtDate, fmtTime, relative, esc, initials } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, confirmAction, emptyState } from "../ui/feedback.js";
import { statusPill, avatar, pill, detailRow, metaItem } from "../ui/widgets.js";
import { openReschedule, cancelBooking } from "./bookings.js";

const FLOW = ["PENDING", "CONFIRMED", "SAMPLE_COLLECTED", "IN_LAB", "COMPLETED", "REPORT_READY"];
const NEXT_ACTIONS = {
  PENDING: { to: "CONFIRMED", label: "Confirm booking", cls: "btn-primary" },
  CONFIRMED: { to: "SAMPLE_COLLECTED", label: "Mark sample collected", cls: "btn-primary" },
  SAMPLE_COLLECTED: { to: "IN_LAB", label: "Send to lab", cls: "btn-primary" },
  IN_LAB: { to: "COMPLETED", label: "Mark completed", cls: "btn-primary" },
  COMPLETED: { to: "REPORT_READY", label: "Publish report", cls: "btn-success" },
};

export async function render(container, { params }) {
  const mountPoint = h("div");
  mount(container, mountPoint);
  await load();

  async function load() {
    mount(mountPoint, loadingState("Loading booking…"));
    let booking;
    try {
      booking = await api.get(`/api/bookings/${params.id}`);
    } catch (error) {
      mount(mountPoint, emptyState({
        title: "Booking not found",
        message: error.message,
        actionLabel: "Back to bookings",
        onAction: () => (location.hash = "#/bookings"),
        iconName: "search",
      }));
      return;
    }
    paint(booking);
  }

  function paint(booking) {
    const currency = store.currency;
    const active = !["CANCELLED", "NO_SHOW"].includes(booking.status);
    const canEdit = active && store.can("bookings.edit") &&
      ["PENDING", "CONFIRMED"].includes(booking.status);
    const canCancel = active && store.can("bookings.cancel") &&
      !["REPORT_READY"].includes(booking.status);
    const nextAction = NEXT_ACTIONS[booking.status];
    const canAdvance = Boolean(nextAction) && store.can("bookings.status") &&
      !(nextAction.to !== "CONFIRMED" && !store.isRole("technician", "manager", "admin"));

    /* ------------------------------------------------------- hero */
    const hero = h(
      "section.detail-hero",
      {},
      h(
        "div",
        {},
        h("div.dh-id", { text: booking.booking_no }),
        h("h2", { text: booking.patient?.name || "Patient" }),
        h("div.dh-sub", {
          html: `${esc(booking.patient?.code || "")} · ${esc(booking.phone || booking.patient?.phone || "")} ·
                 <strong>${esc(fmtDate(booking.booking_date, { weekday: true }))}</strong> at
                 <strong>${esc(fmtTime(booking.slot_start))}</strong> – ${esc(fmtTime(booking.slot_end))}`,
        }),
        h("div.row", { style: { marginTop: "12px", gap: "8px", flexWrap: "wrap" } },
          statusPill(booking.status),
          pill(booking.type_label, "pill-brand"),
          booking.priority === "urgent" ? pill("Urgent", "pill-urgent") : null,
          booking.followup_of_id ? pill(`Follow-up of #${booking.followup_of_id}`, "pill-outline") : null,
          booking.phlebotomist ? pill(`Tech: ${booking.phlebotomist}`, "pill-outline") : null)
      ),
      h(
        "div.dh-actions",
        {},
        canAdvance
          ? h(`button.btn.${nextAction.cls}`, {
              type: "button",
              onClick: () => advance(booking, nextAction, load),
            }, icon("check", 16), nextAction.label)
          : null,
        canEdit
          ? h("button.btn.btn-outline", { type: "button", onClick: () => openReschedule(booking, load) },
              icon("history", 16), "Reschedule")
          : null,
        canEdit
          ? h("button.btn.btn-outline", { type: "button", onClick: () => openEditModal(booking, load) },
              icon("edit", 16), "Edit")
          : null,
        canCancel
          ? h("button.btn.btn-danger-soft", { type: "button", onClick: async () => {
              const done = await cancelBooking(booking, load);
              if (done) await load();
            } }, icon("x", 16), "Cancel")
          : null,
        store.can("bookings.create")
          ? h("button.btn.btn-outline", { type: "button", onClick: () => (location.hash = `#/bookings/new?followup=${booking.id}`) },
              icon("plus", 16), "Follow-up")
          : null,
        h("button.btn.btn-ghost", { type: "button", onClick: () => window.print() }, icon("print", 16), "Print")
      )
    );

    /* ---------------------------------------------------- timeline */
    const timelineCard = h(
      "div.card",
      {},
      h("div.card-head", {}, h("div", {}, h("h3", { text: "Status & history" }), h("p", { text: "Every transition is logged with the responsible employee" }))),
      h("div.card-body", {}, buildTimeline(booking))
    );

    /* -------------------------------------------------------- items */
    const itemsCard = h(
      "div.card",
      {},
      h(
        "div.card-head",
        {},
        h("div", {}, h("h3", { text: "Tests in this booking" }), h("p", { text: `${booking.items.length} line item(s)` })),
        canEdit
          ? h("button.link-btn", { type: "button", text: "Modify tests", onClick: () => openItemsModal(booking, load) })
          : null
      ),
      h(
        "div.table-scroll",
        {},
        h(
          "table.table",
          {},
          h("thead", {}, h("tr", {},
            h("th", { text: "Code" }), h("th", { text: "Test" }), h("th", { text: "Category" }),
            h("th", { text: "Sample" }), h("th", { text: "TAT" }), h("th", { className: "text-right", text: "Price" }))),
          h("tbody", {}, ...booking.items.map((item) =>
            h("tr", {},
              h("td", {}, h("span.mono", { text: item.code })),
              h("td", { className: "cell-strong", text: item.name }),
              h("td", { text: item.category || "—" }),
              h("td", {}, item.sample_type ? pill(item.sample_type, "tag-sample") : "—"),
              h("td", { text: `${item.tat_hours}h` }),
              h("td", { className: "text-right", text: money(item.price, currency) }))))
        )
      )
    );

    /* ----------------------------------------------------- invoice */
    const invoice = booking.invoice;
    const invoiceCard = h(
      "div.card.card-pad",
      {},
      h("div.eyebrow", { text: "Invoice" }),
      invoice
        ? h(
            "div",
            { style: { marginTop: "10px" } },
            h("div.row-between", {},
              h("strong", { text: invoice.invoice_no, className: "mono" }),
              pill(invoice.status.toUpperCase(), invoice.status === "paid" ? "pill-completed" : invoice.status === "refunded" ? "pill-cancelled" : "pill-pending")),
            h("div.divider"),
            h("table.invoice-table", {},
              h("tbody", {},
                invoiceLine("Subtotal", money(invoice.subtotal, currency)),
                invoiceLine("Discount", `− ${money(invoice.discount, currency)}`),
                invoiceLine("Paid", money(invoice.paid_amount, currency)),
                h("tr.grand", {}, h("td", { text: "Balance due" }), h("td", { text: money(invoice.due, currency) })))),
            invoice.payments.length
              ? h("div", { style: { marginTop: "12px" } },
                  h("div.eyebrow", { text: "Payments", style: { marginBottom: "6px" } }),
                  ...invoice.payments.map((payment) =>
                    h("div.row-between", { style: { padding: "6px 0", borderBottom: "1px dashed var(--border)", fontSize: ".8rem" } },
                      h("span", {}, `${payment.method.toUpperCase()} · ${payment.reference || "—"}`),
                      h("strong", { text: `${payment.status === "refunded" ? "−" : ""}${money(payment.amount, currency)}` }))))
              : null,
            store.can("billing.pay") && invoice.due > 0 && active
              ? h("button.btn.btn-primary.btn-block", {
                  type: "button",
                  style: { marginTop: "14px" },
                  onClick: () => openPaymentModal(invoice, load),
                }, icon("money", 16), "Record payment")
              : null,
            store.can("billing.refund") && invoice.paid_amount > 0
              ? h("button.btn.btn-outline.btn-block", {
                  type: "button",
                  style: { marginTop: "8px" },
                  onClick: () => refundModal(invoice, load),
                }, icon("refresh", 16), "Issue refund")
              : null
          )
        : h("p.muted", { text: "No invoice generated yet.", style: { marginTop: "8px" } })
    );

    /* ---------------------------------------------------- patient */
    const patientCard = h(
      "div.card.card-pad",
      { style: { marginTop: "16px" } },
      h("div.row-between", {},
        h("div.eyebrow", { text: "Patient" }),
        store.can("patients.view")
          ? h("button.link-btn", { type: "button", text: "Open record", onClick: () => (location.hash = `#/patients/${booking.patient.id}`) })
          : null),
      h("div.row", { style: { marginTop: "12px", gap: "12px" } },
        avatar(booking.patient?.name, "avatar-lg"),
        h("div", {},
          h("strong", { text: booking.patient?.name, style: { display: "block" } }),
          h("span.muted", { text: `${booking.patient?.code} · ${booking.patient?.gender} · ${booking.patient?.age ?? "—"} yrs`, style: { fontSize: ".78rem" } }))),
      h("div.divider"),
      h("div.detail-list", {},
        detailRow("Phone", booking.patient?.phone || "—"),
        detailRow("Blood group", booking.patient?.blood_group || "—"),
        detailRow("Allergies", booking.patient?.allergies || "None recorded"),
        detailRow("Address", booking.patient?.address || "—"),
        booking.notes ? detailRow("Booking notes", booking.notes) : null,
        booking.cancel_reason ? detailRow("Cancellation reason", booking.cancel_reason) : null)
    );

    mount(
      mountPoint,
      h("div.row-between", { style: { marginBottom: "16px", flexWrap: "wrap" } },
        h("button.btn.btn-ghost", { type: "button", onClick: () => history.length > 1 ? history.back() : (location.hash = "#/bookings") },
          icon("arrow-left", 15), "Back"),
        h("span.muted", { text: `Created ${relative(booking.created_at)} by ${booking.created_by || "system"}`, style: { fontSize: ".78rem" } })),
      hero,
      h("div.detail-grid", {},
        h("div.stack", {}, timelineCard, itemsCard),
        h("div", {}, invoiceCard, patientCard))
    );
  }

  /* -------------------------------------------------------- actions */

  async function advance(booking, action, done) {
    const needsReason = action.to === "NO_SHOW";
    const result = await confirmAction({
      title: action.label + "?",
      message: `Move ${booking.booking_no} to ${action.to.replace(/_/g, " ").toLowerCase()}.`,
      confirmText: action.label,
      reason: needsReason,
    });
    if (!result) return;
    try {
      const response = await api.post(`/api/bookings/${booking.id}/status`, {
        status: action.to,
        reason: typeof result === "string" ? result : "",
      });
      toast.success("Status updated", response.message);
      done();
    } catch (error) {
      toast.error("Update failed", error.message);
    }
  }

  function openEditModal(booking, done) {
    const phone = h("input.input", { value: booking.phone || "" });
    const address = h("input.input", { value: booking.address || "" });
    const priority = h("select.select", {},
      h("option", { value: "routine", text: "Routine", selected: booking.priority === "routine" }),
      h("option", { value: "urgent", text: "Urgent", selected: booking.priority === "urgent" }));
    const notes = h("textarea.textarea", { rows: "3" }, booking.notes || "");

    openModal({
      title: `Edit ${booking.booking_no}`,
      subtitle: "Locked once sample collection begins",
      body: h("div.form-grid", {},
        h("label.field", {}, h("span", { text: "Contact phone" }), phone),
        h("label.field", {}, h("span", { text: "Priority" }), priority),
        h("label.field.span-2", {}, h("span", { text: "Collection address" }), address),
        h("label.field.span-2", {}, h("span", { text: "Notes" }), notes)),
      footer: (close) => [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
        h("button.btn.btn-primary", {
          type: "button", text: "Save changes",
          onClick: async (event) => {
            event.currentTarget.classList.add("loading");
            try {
              await api.put(`/api/bookings/${booking.id}`, {
                phone: phone.value, address: address.value,
                priority: priority.value, notes: notes.value,
              });
              close();
              toast.success("Booking updated");
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

  function openItemsModal(booking, done) {
    const selected = new Set(booking.items.map((item) => item.product_id).filter(Boolean));
    const results = h("div.picker-list");
    const search = h("input.input", { type: "search", placeholder: "Search tests to add…" });

    const runLoad = async () => {
      const query = search.value.trim();
      const items = query.length >= 2
        ? await api.get("/api/products/search", { params: { q: query }, silent: true })
        : (await api.get("/api/products", { params: { per_page: 30 }, silent: true })).items;
      clear(results);
      items.forEach((product) => {
        results.appendChild(
          h("div.picker-row" + (selected.has(product.id) ? " selected" : ""), {
            onClick: () => {
              if (selected.has(product.id)) selected.delete(product.id);
              else selected.add(product.id);
              load();
            },
          },
            h("span.picker-check", {}, icon("check", 13)),
            h("div.pr-main", {}, h("strong", { text: product.name }), h("span", { text: `${product.code} · ${product.category}` })),
            h("span.pr-price", { text: money(product.price, store.currency) })));
      });
    };
    const load = debounceLoad(runLoad);

    search.addEventListener("input", load);
    load();

    openModal({
      title: "Modify tests",
      subtitle: `${selected.size} selected · changes re-price the invoice`,
      size: "lg",
      body: h("div", {}, search, h("div", { style: { marginTop: "12px" } }, results)),
      footer: (close) => [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
        h("button.btn.btn-primary", {
          type: "button", text: "Save tests",
          onClick: async (event) => {
            if (!selected.size) {
              toast.warning("Keep at least one test", "Cancel the booking instead of emptying it.");
              return;
            }
            event.currentTarget.classList.add("loading");
            try {
              await api.post(`/api/bookings/${booking.id}/items`, { product_ids: [...selected] });
              close();
              toast.success("Tests updated");
              done();
            } catch (error) {
              event.currentTarget.classList.remove("loading");
              toast.error("Could not update tests", error.message);
            }
          },
        }),
      ],
    });
  }
}

/* ----------------------------------------------------------- timeline */

const STAGE_LABELS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  SAMPLE_COLLECTED: "Sample collected",
  IN_LAB: "In lab",
  COMPLETED: "Completed",
  REPORT_READY: "Report ready",
};

function buildTimeline(booking) {
  const history = Array.isArray(booking.history) ? booking.history : [];
  const terminal = ["CANCELLED", "NO_SHOW"].includes(booking.status);

  /* furthest stage ever reached (a cancelled booking still travelled) */
  let reached = -1;
  FLOW.forEach((code, index) => {
    if (code === booking.status || history.some((entry) => entry.to_status === code)) {
      reached = index;
    }
  });
  const percent = reached < 0 ? 0 : Math.round(((reached + 1) / FLOW.length) * 100);

  const stages = h(
    "div",
    { style: { marginBottom: "18px" } },
    h(
      "div.row-between",
      { style: { marginBottom: "7px" } },
      h("span.eyebrow", { text: "Pipeline" }),
      h(
        "span.muted",
        { style: { fontSize: ".72rem" } },
        reached < 0 ? "Not started" : `${reached + 1} of ${FLOW.length} stages`
      )
    ),
    h("div.progress", {}, h("span", { style: { width: `${percent}%` } })),
    h(
      "div.row",
      { style: { marginTop: "9px", gap: "6px", flexWrap: "wrap" } },
      ...FLOW.map((code, index) =>
        h(`span.tag${index <= reached && !terminal ? ".tag-done" : ""}`, {
          text: STAGE_LABELS[code] || code,
        })
      ),
      terminal ? pill(booking.status_label, booking.status === "NO_SHOW" ? "pill-urgent" : "pill-cancelled") : null
    )
  );

  const entries = history.length
    ? history
    : [{
        to_status: booking.status,
        status_label: booking.status_label,
        user: booking.created_by || "System",
        reason: "",
        created_at: booking.created_at,
      }];

  const list = h(
    "div.timeline",
    {},
    ...entries.map((entry, index) => {
      const bad = ["CANCELLED", "NO_SHOW"].includes(entry.to_status);
      const classes = [index === 0 ? "current" : "", bad ? "warn" : ""].filter(Boolean).join(" ");
      const detail = [
        entry.user ? `by ${entry.user}` : null,
        entry.reason ? String(entry.reason) : null,
      ].filter(Boolean).join(" · ");

      return h(
        `div.timeline-item${classes ? ` ${classes}` : ""}`,
        {},
        h("div.timeline-node"),
        h("strong", { text: entry.status_label || STAGE_LABELS[entry.to_status] || entry.to_status }),
        detail ? h("p", { text: detail }) : null,
        h("time", {
          text: `${fmtDate(entry.created_at, { weekday: true })} · ${fmtTime(String(entry.created_at).slice(11, 16))} · ${relative(entry.created_at)}`,
        })
      );
    })
  );

  return h("div", {}, stages, list);
}

function invoiceLine(label, value) {
  return h("tr", {}, h("td", { text: label }), h("td", { text: value }));
}

function debounceLoad(fn, wait = 260) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ------------------------------------------------------------ payments */

export function openPaymentModal(invoice, onDone) {
  const amount = h("input.input", { type: "number", min: "1", step: "1", value: String(invoice.due) });
  const method = h("select.select", {},
    ...["cash", "card", "upi", "insurance", "bank_transfer"].map((value) =>
      h("option", { value, text: value.replace("_", " ").toUpperCase() })));
  const reference = h("input.input", { placeholder: "Transaction / receipt reference (optional)" });

  openModal({
    title: `Record payment · ${invoice.invoice_no}`,
    subtitle: `Outstanding ${money(invoice.due, store.currency)}`,
    body: h("div.form-grid", {},
      h("label.field", {}, h("span", { text: "Amount (₹)" }), amount),
      h("label.field", {}, h("span", { text: "Method" }), method),
      h("label.field.span-2", {}, h("span", { text: "Reference" }), reference)),
    footer: (close) => [
      h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
      h("button.btn.btn-primary", {
        type: "button", text: "Record payment",
        onClick: async (event) => {
          event.currentTarget.classList.add("loading");
          try {
            const result = await api.post("/api/billing/payments", {
              invoice_id: invoice.id,
              amount: Number(amount.value),
              method: method.value,
              reference: reference.value.trim(),
            });
            close();
            toast.success("Payment recorded", result.message);
            onDone?.();
          } catch (error) {
            event.currentTarget.classList.remove("loading");
            toast.error("Payment failed", error.message);
          }
        },
      }),
    ],
  });
}

async function refundModal(invoice, onDone) {
  const reason = await confirmAction({
    title: `Refund ${invoice.invoice_no}?`,
    message: `Up to ${money(invoice.paid_amount, store.currency)} can be refunded.`,
    confirmText: "Issue refund",
    danger: true,
    reason: true,
    reasonLabel: "Refund reason",
  });
  if (!reason) return;
  try {
    const result = await api.post(`/api/billing/invoices/${invoice.id}/refund`, {
      amount: invoice.paid_amount,
      reason,
    });
    toast.success("Refund recorded", result.message);
    onDone?.();
  } catch (error) {
    toast.error("Refund failed", error.message);
  }
}
