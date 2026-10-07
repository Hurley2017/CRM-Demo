/* Billing — invoices, collections, payments and refunds. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, money, debounce, fmtDate, relative, esc } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, emptyState, confirmAction } from "../ui/feedback.js";
import { searchBox, dataTable, pagination, pill, kpiCard } from "../ui/widgets.js";

const STATUS_FILTERS = [
  { value: "", label: "All invoices" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "refunded", label: "Refunded" },
];

export async function render(container) {
  const state = { status: "", q: "", page: 1, perPage: 20, loading: true };

  const summaryHost = h("div");
  const tableHost = h("div");

  const search = searchBox({
    placeholder: "Invoice no, patient, phone…",
    onInput: debounce((value) => { state.q = value; state.page = 1; load(); }, 300),
    onClear: () => { state.q = ""; load(); },
  });

  const statusSelect = h(
    "select.select",
    { onChange: (event) => { state.status = event.target.value; state.page = 1; load(); } },
    ...STATUS_FILTERS.map((option) => h("option", { value: option.value, text: option.label }))
  );

  mount(
    container,
    h(
      "div.page-head",
      {},
      h("div", {}, h("h2", { text: "Billing" }), h("p", { text: "Collections, outstanding balances and refunds." })),
      h("div.page-actions", {},
        h("button.btn.btn-outline", { type: "button", onClick: () => load() }, icon("refresh", 15), "Refresh"))
    ),
    summaryHost,
    h("div.toolbar", { style: { marginTop: "16px" } }, search.element, statusSelect),
    tableHost
  );

  await load();

  async function load() {
    const skeletons = Array.from({ length: 4 }, () =>
      h(
        "div.kpi",
        { style: { height: "112px" } },
        h("div.skeleton", { style: { height: "12px", width: "45%" } }),
        h("div.skeleton", { style: { height: "26px", width: "65%", marginTop: "12px" } })
      )
    );
    mount(summaryHost, h("div.grid.grid-kpi", {}, ...skeletons));

    try {
      const [summary, data] = await Promise.all([
        api.get("/api/billing/summary"),
        api.get("/api/billing/invoices", {
          params: { status: state.status, q: state.q, page: state.page, per_page: state.perPage },
        }),
      ]);
      state.loading = false;
      paintSummary(summary);
      paintTable(data);
    } catch (error) {
      state.loading = false;
      toast.error("Could not load billing", error.message);
    }
  }

  function paintSummary(summary) {
    mount(
      summaryHost,
      h("div.grid.grid-kpi", {},
        kpiCard({ label: "Collected today", value: money(summary.collected_today, store.currency),
          iconName: "money", tone: "success", foot: "Payments received since midnight" }),
        kpiCard({ label: "Outstanding", value: money(summary.outstanding, store.currency),
          iconName: "billing", tone: "warning", foot: `${summary.unpaid_invoices} invoice(s) pending` }),
        kpiCard({ label: "Refunded this month", value: money(summary.refunded_this_month, store.currency),
          iconName: "refresh", tone: "violet", foot: "Processed cancellations" }),
        kpiCard({ label: "Cancellations today", value: summary.cancelled_today,
          iconName: "x", tone: "danger", foot: "Bookings cancelled today" }))
    );
  }

  function paintTable(data) {
    mount(
      tableHost,
      dataTable({
        loading: state.loading,
        columns: [
          { label: "Invoice", render: (row) => h("div", {},
              h("span.booking-no", { text: row.invoice_no }),
              h("span.cell-sub", { text: row.booking_no || "" })) },
          { label: "Patient", render: (row) => h("div.patient-cell", {},
              h("span.avatar", { text: initialsOf(row) }),
              h("div", {}, h("strong", { text: row.patient_name || `#${row.patient_id}` }),
                h("span", { text: `Booking ${row.booking_no || "—"}` }))) },
          { label: "Total", className: "text-right", render: (row) => h("div", {},
              h("strong", { text: money(row.total, store.currency) }),
              h("span.cell-sub", { text: `paid ${money(row.paid_amount, store.currency)}` })) },
          { label: "Balance", className: "text-right",
            render: (row) => row.due > 0
              ? h("strong.text-danger", { text: money(row.due, store.currency) })
              : h("span.text-success", { text: "settled" }) },
          { label: "Status", render: (row) => pill(row.status.toUpperCase(),
              row.status === "paid" ? "pill-completed" : row.status === "refunded" ? "pill-cancelled" : "pill-pending") },
          { label: "Updated", render: (row) => h("span.muted", { text: relative(row.updated_at), style: { fontSize: ".78rem" } }) },
          { label: "", className: "actions", render: (row) => h("div.row-actions", {},
              store.can("billing.pay") && row.due > 0
                ? h("button.btn.btn-sm.btn-primary", { type: "button", onClick: (event) => { event.stopPropagation(); openPayment(row, load); } }, "Collect")
                : null,
              store.can("billing.view")
                ? h("button.icon-btn", { type: "button", "aria-label": "View invoice",
                    onClick: (event) => { event.stopPropagation(); openInvoice(row); } }, icon("eye", 16))
                : null) },
        ],
        rows: data.items,
        empty: emptyState({ title: "No invoices match", message: "Adjust the filters above.", iconName: "billing" }),
        foot: data ? pagination({
          page: data.page, pages: data.pages, total: data.total, perPage: data.per_page,
          label: "invoices",
          onPage: (page) => { state.page = page; load(); },
          onPerPage: (perPage) => { state.perPage = perPage; state.page = 1; load(); },
        }) : null,
      })
    );
  }
}

function initialsOf(row) {
  const name = row.patient_name || "P";
  const parts = String(name).split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function openInvoice(invoice) {
  openModal({
    title: invoice.invoice_no,
    subtitle: `Booking ${invoice.booking_no || "—"} · ${invoice.status.toUpperCase()}`,
    body: h("div", {},
      h("table.invoice-table", {}, h("tbody", {},
        row("Subtotal", money(invoice.subtotal, store.currency)),
        row("Discount", `− ${money(invoice.discount, store.currency)}`),
        row("Total", money(invoice.total, store.currency)),
        row("Paid", money(invoice.paid_amount, store.currency)),
        h("tr.grand", {}, h("td", { text: "Balance due" }), h("td", { text: money(invoice.due, store.currency) })))),
      invoice.payments?.length
        ? h("div", { style: { marginTop: "16px" } },
            h("div.eyebrow", { text: "Payment history", style: { marginBottom: "8px" } }),
            ...invoice.payments.map((payment) =>
              h("div.row-between", { style: { padding: "8px 0", borderBottom: "1px dashed var(--border)", fontSize: ".84rem" } },
                h("div", {}, h("strong", { text: payment.method.toUpperCase() }),
                  h("div.muted", { text: `${payment.received_by || "—"} · ${relative(payment.created_at)}`, style: { fontSize: ".74rem" } })),
                h("strong", { text: `${payment.status === "refunded" ? "−" : ""}${money(payment.amount, store.currency)}` }))))
        : h("p.muted", { text: "No payments recorded yet.", style: { marginTop: "14px" } })),
    footer: (close) => [
      h("button.btn.btn-outline", { type: "button", text: "Close", onClick: () => close() }),
      invoice.booking_id
        ? h("button.btn.btn-primary", {
            type: "button", text: "Open booking",
            onClick: () => { close(); location.hash = `#/bookings/${invoice.booking_id}`; },
          })
        : null,
    ],
  });
}

function row(label, value) {
  return h("tr", {}, h("td", { text: label }), h("td", { text: value }));
}

export function openPayment(invoice, onDone) {
  const amount = h("input.input", { type: "number", min: "1", step: "1", value: String(invoice.due) });
  const method = h("select.select", {},
    ...["cash", "card", "upi", "insurance", "bank_transfer"].map((value) =>
      h("option", { value, text: value.replace("_", " ").toUpperCase() })));
  const reference = h("input.input", { placeholder: "Reference (optional)" });

  openModal({
    title: `Collect payment · ${invoice.invoice_no}`,
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
