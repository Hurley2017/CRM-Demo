/* Bookings — filters, stats, table with row actions. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, money, fmtDate, fmtTime, debounce, initials } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, emptyState, confirmAction, openModal } from "../ui/feedback.js";
import {
  statusPill, dataTable, pagination, searchBox, segmented, pill, avatar,
} from "../ui/widgets.js";

const VIEW_TABS = [
  { value: "", label: "All bookings" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "attention", label: "Needs attention" },
];

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "PENDING", label: "Pending" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "SAMPLE_COLLECTED", label: "Sample collected" },
  { value: "IN_LAB", label: "In lab" },
  { value: "COMPLETED", label: "Completed" },
  { value: "REPORT_READY", label: "Report ready" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW", label: "No show" },
];

export async function render(container, { query }) {
  const state = {
    view: query.get("view") || "",
    status: query.get("status") || "",
    type: "",
    q: "",
    page: 1,
    perPage: 15,
    loading: true,
  };

  const mountPoint = h("div");
  mount(container, mountPoint);

  const statsBand = h("div");
  const toolbar = buildToolbar();
  const tableHost = h("div");

  await refresh();

  async function refresh() {
    state.loading = true;
    paintTable();

    try {
      const data = await api.get("/api/bookings", {
        params: {
          view: state.view,
          status: state.status,
          type: state.type,
          q: state.q,
          page: state.page,
          per_page: state.perPage,
        },
      });
      state.loading = false;
      paintStats(data.stats);
      paintTable(data);
    } catch (error) {
      state.loading = false;
      paintTable();
      toast.error("Could not load bookings", error.message);
    }
  }

  function paintStats(stats) {
    mount(
      statsBand,
      h(
        "div.stat-band",
        {},
        stat("Today", stats.today, "calendar"),
        stat("Pending", stats.pending, "clock"),
        stat("Confirmed", stats.confirmed, "check-circle"),
        stat("No shows", stats.no_show, "alert"),
        stat("Cancelled", stats.cancelled, "x"),
        stat("Today's value", money(stats.revenue_today, store.currency), "money")
      )
    );
  }

  function paintTable(data) {
    const rows = data?.items || [];
    const columns = [
      {
        key: "booking_no",
        label: "Booking",
        render: (row) =>
          h(
            "div",
            {},
            h("span.booking-no", { text: row.booking_no }),
            h("span.cell-sub", { text: `${row.type_label}${row.priority === "urgent" ? " · URGENT" : ""}` })
          ),
      },
      {
        label: "Patient",
        render: (row) =>
          h(
            "div.patient-cell",
            {},
            avatar(row.patient?.name || "?"),
            h(
              "div",
              {},
              h("strong", { text: row.patient?.name || "—" }),
              h("span", { text: `${row.patient?.code || ""} · ${row.phone || row.patient?.phone || ""}` })
            )
          ),
      },
      {
        label: "Slot",
        render: (row) =>
          h(
            "div",
            {},
            h("div.slot-cell", {}, icon("calendar", 14), fmtDate(row.booking_date)),
            h("span.cell-sub", { text: `${fmtTime(row.slot_start)} – ${fmtTime(row.slot_end)}`, style: { fontFamily: "var(--font-mono)" } })
          ),
      },
      {
        label: "Tests",
        render: (row) => h("span", { text: String(row.items?.length || 0) }),
      },
      {
        label: "Status",
        render: (row) =>
          h("div", {}, statusPill(row.status),
            row.priority === "urgent" ? h("span.pill.pill-urgent", { text: "Urgent", style: { marginLeft: "6px" } }) : null),
      },
      {
        label: "Amount",
        className: "text-right",
        render: (row) =>
          h(
            "div",
            {},
            h("strong", { text: money(row.total, store.currency) }),
            row.due > 0
              ? h("span.cell-sub.text-danger", { text: `${money(row.due)} due` })
              : h("span.cell-sub.text-success", { text: "Paid" })
          ),
      },
      {
        label: "",
        className: "actions",
        render: (row) => h("div.row-actions", {}, ...rowActions(row)),
      },
    ];

    mount(
      tableHost,
      dataTable({
        columns,
        rows,
        loading: state.loading,
        onRowClick: (row) => (location.hash = `#/bookings/${row.id}`),
        empty: emptyState({
          title: "No bookings match these filters",
          message: "Adjust the filters above, or create a new booking.",
          actionLabel: store.can("bookings.create") ? "New booking" : null,
          onAction: () => (location.hash = "#/bookings/new"),
          iconName: "calendar",
        }),
        foot: data
          ? pagination({
              page: data.page,
              pages: data.pages,
              total: data.total,
              perPage: data.per_page,
              label: "bookings",
              onPage: (page) => {
                state.page = page;
                refresh();
              },
              onPerPage: (perPage) => {
                state.perPage = perPage;
                state.page = 1;
                refresh();
              },
            })
          : null,
      })
    );
  }

  function rowActions(row) {
    const actions = [];
    if (store.can("bookings.view")) {
      actions.push(
        h("button.icon-btn", {
          type: "button",
          "aria-label": "View",
          onClick: (event) => {
            event.stopPropagation();
            location.hash = `#/bookings/${row.id}`;
          },
        }, icon("eye", 16))
      );
    }
    if (store.can("bookings.edit") && !["CANCELLED", "NO_SHOW"].includes(row.status)) {
      actions.push(
        h("button.icon-btn", {
          type: "button",
          "aria-label": "Reschedule",
          onClick: (event) => {
            event.stopPropagation();
            openReschedule(row, refresh);
          },
        }, icon("history", 16))
      );
    }
    if (store.can("bookings.cancel") && !["CANCELLED", "NO_SHOW", "REPORT_READY"].includes(row.status)) {
      actions.push(
        h("button.icon-btn.danger", {
          type: "button",
          "aria-label": "Cancel",
          onClick: (event) => {
            event.stopPropagation();
            cancelBooking(row, refresh);
          },
        }, icon("x", 16))
      );
    }
    return actions;
  }

  function buildToolbar() {
    const search = searchBox({
      placeholder: "Booking no, patient, phone…",
      onInput: debounce((value) => {
        state.q = value;
        state.page = 1;
        refresh();
      }, 300),
      onClear: () => {
        state.q = "";
        refresh();
      },
    });

    const statusSelect = h(
      "select.select",
      {
        onChange: (event) => {
          state.status = event.target.value;
          state.page = 1;
          refresh();
        },
      },
      ...STATUSES.map((option) =>
        h("option", { value: option.value, text: option.label, selected: option.value === state.status })
      )
    );

    const typeSelect = h(
      "select.select",
      {
        onChange: (event) => {
          state.type = event.target.value;
          state.page = 1;
          refresh();
        },
      },
      h("option", { value: "", text: "Any type" }),
      h("option", { value: "center", text: "Centre visit" }),
      h("option", { value: "home", text: "Home collection" })
    );

    return h(
      "div.toolbar",
      {},
      search.element,
      statusSelect,
      typeSelect,
      h("button.btn.btn-outline", {
        type: "button",
        onClick: () => refresh(),
      }, icon("refresh", 15), "Refresh"),
      store.can("bookings.create")
        ? h("button.btn.btn-primary", {
            type: "button",
            onClick: () => (location.hash = "#/bookings/new"),
          }, icon("plus", 16), "New booking")
        : null
    );
  }

  function stat(label, value, iconName) {
    return h(
      "div.row",
      { style: { gap: "10px" } },
      h("span.kpi-icon", { style: { width: "30px", height: "30px" } }, icon(iconName, 15)),
      h("div", {}, h("strong", { text: String(value), style: { display: "block", fontSize: "1.05rem", letterSpacing: "-.02em" } }),
        h("span", { text: label, style: { fontSize: ".7rem", color: "var(--ink-500)" } }))
    );
  }

  const viewTabs = segmented({
    options: VIEW_TABS.map((tab) => ({ label: tab.label, value: tab.value })),
    value: state.view,
    onChange: (value) => {
      state.view = value;
      state.page = 1;
      refresh();
    },
  });

  mount(
    mountPoint,
    h(
      "div.page-head",
      {},
      h("div", {}, h("h2", { text: "Bookings" }), h("p", { text: "Search, schedule, reschedule and track every appointment." })),
      h("div.page-actions", {})
    ),
    h("div.card", { style: { padding: "14px 16px", marginBottom: "16px" } }, viewTabs),
    statsBand,
    h("div", { style: { marginTop: "16px" } }, toolbar),
    tableHost
  );
}

/* ------------------------------------------------------ shared modals */

export function openReschedule(booking, onDone) {
  let selectedDate = booking.booking_date;
  let selectedSlot = null;
  let slotsData = null;

  const dateStrip = h("div.date-strip");
  const slotGrid = h("div.slot-grid");
  const slotInfo = h("p.muted", { text: "Loading availability…", style: { fontSize: ".8rem" } });
  const reasonInput = h("input.input", { type: "text", placeholder: "Reason (optional)" });

  const confirmBtn = h("button.btn.btn-primary", {
    type: "button",
    text: "Reschedule booking",
    disabled: true,
    onClick: async (event) => {
      const button = event.currentTarget;
      button.classList.add("loading");
      try {
        const result = await api.post(`/api/bookings/${booking.id}/reschedule`, {
          booking_date: selectedDate,
          slot_start: selectedSlot,
          reason: reasonInput.value.trim(),
        });
        modal.close();
        toast.success("Rescheduled", result.message || "Booking moved to the new slot.");
        onDone?.();
      } catch (error) {
        button.classList.remove("loading");
        if (error.code === "slot_taken") loadSlots();
      }
    },
  });

  const modal = openModal({
    title: `Reschedule ${booking.booking_no}`,
    subtitle: `${booking.patient?.name} · currently ${fmtDate(booking.booking_date)} at ${fmtTime(booking.slot_start)}`,
    size: "lg",
    body: h(
      "div.stack",
      {},
      h("div.field", {}, h("span", { text: "Choose a new date" }), dateStrip),
      h(
        "div.field",
        {},
        h("span", { text: "Available slots" }),
        slotGrid,
        slotInfo,
        h(
          "div.slot-legend",
          {},
          h("span", {}, h("i.open"), "Open"),
          h("span", {}, h("i.taken"), "Booked / past"),
          h("span", {}, h("i.sel"), "Selected")
        )
      ),
      h("label.field", {}, h("span", { text: "Reason (recorded in history)" }), reasonInput)
    ),
    footer: (close) => [
      h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
      confirmBtn,
    ],
  });

  buildDateStrip();
  loadSlots();

  function buildDateStrip() {
    clear(dateStrip);
    const today = new Date();
    for (let offset = -1; offset < 21; offset += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const tile = h(
        "button.date-tile",
        {
          type: "button",
          class: [
            iso === selectedDate ? "active" : "",
            offset < 0 ? "past" : "",
            offset === 0 ? "today" : "",
          ].filter(Boolean).join(" "),
          onClick: () => {
            if (offset < 0) return;
            selectedDate = iso;
            selectedSlot = null;
            confirmBtn.disabled = true;
            buildDateStrip();
            loadSlots();
          },
        },
        h("div.dow", { text: date.toLocaleDateString("en-IN", { weekday: "short" }) }),
        h("div.dnum", { text: String(date.getDate()) }),
        h("div.dslots", { text: date.toLocaleDateString("en-IN", { month: "short" }) })
      );
      dateStrip.appendChild(tile);
    }
  }

  async function loadSlots() {
    clear(slotGrid);
    slotInfo.textContent = "Loading availability…";
    try {
      slotsData = await api.get("/api/slots", { params: { date: selectedDate } });
      clear(slotGrid);
      const open = slotsData.slots.filter((slot) => slot.state === "open");
      slotsData.slots.forEach((slot) => {
        const isCurrent = slot.start === booking.slot_start && selectedDate === booking.booking_date;
        const disabled = slot.state !== "open" && !isCurrent;
        const button = h(
          "button.slot",
          {
            type: "button",
            class: selectedSlot === slot.start ? "selected" : "",
            disabled,
            onClick: () => {
              selectedSlot = slot.start;
              confirmBtn.disabled = false;
              slotGrid.querySelectorAll(".slot").forEach((node) => node.classList.remove("selected"));
              button.classList.add("selected");
            },
          },
          slot.start,
          h("span.slot-state", { text: isCurrent ? "current" : slot.state === "booked" ? "booked" : "open" })
        );
        if (isCurrent) {
          button.style.borderColor = "var(--accent-500)";
          button.style.color = "var(--accent-600)";
        }
        slotGrid.appendChild(button);
      });
      slotInfo.textContent = open.length
        ? `${open.length} open slot(s) on ${fmtDate(selectedDate, { weekday: true })}.`
        : `No open slots on ${fmtDate(selectedDate, { weekday: true })} — try another date.`;
    } catch (error) {
      slotInfo.textContent = error.message;
    }
  }
}

export async function cancelBooking(booking, onDone) {
  const policy = booking.cancellation_policy || null;
  const detail = policy
    ? policy.late
      ? policy.message
      : `${policy.message} Outstanding: ${money(booking.due, store.currency)}.`
    : null;

  const reason = await confirmAction({
    title: `Cancel ${booking.booking_no}?`,
    message: `This frees the ${fmtTime(booking.slot_start)} slot on ${fmtDate(booking.booking_date)} for ${booking.patient?.name}.`,
    detail,
    confirmText: "Cancel booking",
    danger: true,
    reason: true,
    reasonLabel: "Cancellation reason",
  });

  if (!reason) return false;

  try {
    const result = await api.post(`/api/bookings/${booking.id}/cancel`, { reason });
    toast.success("Booking cancelled", result.message);
    onDone?.();
    return true;
  } catch (error) {
    toast.error("Cancellation failed", error.message);
    return false;
  }
}
