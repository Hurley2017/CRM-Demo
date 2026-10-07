/* Dashboard — KPIs, revenue trend, today's schedule, activity feed. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, money, compactMoney, relative, fmtTime, fmtDate, clear, plural } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, emptyState, loadingState } from "../ui/feedback.js";
import { kpiCard, statusPill, avatar, reloadButton } from "../ui/widgets.js";
import { areaChart, donutChart, barRows } from "../ui/charts.js";

const STATUS_COLORS = {
  PENDING: "#f59e0b",
  CONFIRMED: "#3b82f6",
  SAMPLE_COLLECTED: "#8b5cf6",
  IN_LAB: "#06b6d4",
  COMPLETED: "#10b981",
  REPORT_READY: "#059669",
  CANCELLED: "#94a3b8",
  NO_SHOW: "#ef4444",
};

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

export async function render(container) {
  mount(container, loadingState("Loading your dashboard…"));
  const data = await api.get("/api/dashboard");

  const user = store.user;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const k = data.kpis;
  const currency = store.currency;

  const hero = h(
    "section.hero-strip",
    {},
    h(
      "div",
      {},
      h("h2", { text: `${greeting}, ${user.name.split(" ")[0]}` }),
      h("p", {
        text: `${fmtDate(data.date, { weekday: true })} · ${
          store.isRole("technician")
            ? "Sample collection and lab workflow are ready for you."
            : "Here is how the centre is running today."
        }`,
      }),
      h(
        "div.row",
        { style: { marginTop: "16px", gap: "10px", flexWrap: "wrap" } },
        store.can("bookings.create")
          ? h("button.btn.btn-accent", { type: "button", onClick: () => (location.hash = "#/bookings/new") },
              icon("calendar-plus", 16), "New booking")
          : null,
        store.can("bookings.view")
          ? h("button.btn.btn-outline", {
              type: "button",
              style: { background: "rgba(255,255,255,.12)", borderColor: "rgba(255,255,255,.24)", color: "#fff" },
              onClick: () => (location.hash = "#/bookings?view=today"),
            }, icon("clock", 16), "Today's schedule")
          : null,
        store.can("patients.edit")
          ? h("button.btn.btn-ghost", {
              type: "button",
              style: { color: "rgba(255,255,255,.85)" },
              onClick: () => (location.hash = "#/patients"),
            }, icon("user-plus", 16), "Register patient")
          : null
      )
    ),
    h(
      "div.hero-stats",
      {},
      heroStat(compactMoney(k.revenue_month, currency), "Revenue this month"),
      heroStat(String(k.bookings_month), "Bookings this month"),
      heroStat(`${k.no_show_rate}%`, "No-show rate")
    )
  );

  const kpis = h(
    "section.grid.grid-kpi",
    {},
    kpiCard({ label: "Bookings today", value: k.bookings_today, iconName: "calendar",
      tone: "brand", foot: `${k.confirmed_today} confirmed · ${k.tomorrow} tomorrow`,
      onClick: store.can("bookings.view") ? () => (location.hash = "#/bookings?view=today") : null }),
    kpiCard({ label: "Revenue today", value: money(k.revenue_today, currency), iconName: "money",
      tone: "success", foot: `${money(k.revenue_month, currency)} this month` }),
    kpiCard({ label: "Awaiting confirmation", value: k.pending, iconName: "clock",
      tone: "warning", foot: k.pending ? "Needs front-desk attention" : "All caught up",
      onClick: store.can("bookings.view") ? () => (location.hash = "#/bookings?status=PENDING") : null }),
    kpiCard({ label: "Reports ready", value: k.reports_due, iconName: "report",
      tone: "violet", foot: "Ready for collection / delivery" }),
    kpiCard({ label: "Active patients", value: k.patients_total, iconName: "users",
      tone: "accent", foot: `${k.patients_new_month} new this month`,
      onClick: store.can("patients.view") ? () => (location.hash = "#/patients") : null }),
    kpiCard({ label: "Active tests", value: k.tests_active, iconName: "flask",
      tone: "brand", foot: `${k.cancelled_month} cancellations this month` })
  );

  const revenueCard = h(
    "div.card",
    {},
    h(
      "div.card-head",
      {},
      h("div", {}, h("h3", { text: "Collections · last 14 days" }), h("p", { text: "Payments received, per day" })),
      reloadButton(() => refresh())
    ),
    h(
      "div.card-body",
      {},
      areaChart(data.revenue_trend, {
        height: 190,
        color: "#4f46e5",
        format: (value) => money(value, currency),
        id: "dash",
      }),
      h(
        "div.row-between",
        { style: { marginTop: "14px", paddingTop: "14px", borderTop: "1px dashed var(--border)" } },
        h("span.muted", { text: "14-day total", style: { fontSize: ".8rem" } }),
        h("strong", {
          text: money(data.revenue_trend.reduce((sum, d) => sum + d.value, 0), currency),
          style: { fontSize: "1.15rem", letterSpacing: "-.02em" },
        })
      )
    )
  );

  const statusCard = h(
    "div.card",
    {},
    h("div.card-head", {}, h("div", {}, h("h3", { text: "Booking status mix" }), h("p", { text: "Trailing 30 days" }))),
    h("div.card-body", {}, buildStatusMix(data.status_mix))
  );

  const scheduleCard = h(
    "div.card",
    {},
    h(
      "div.card-head",
      {},
      h("div", {}, h("h3", { text: "Today's schedule" }), h("p", { text: `${plural(data.today_schedule.length, "appointment")} queued` })),
      store.can("bookings.view")
        ? h("button.link-btn", { type: "button", text: "View all", onClick: () => (location.hash = "#/bookings?view=today") })
        : null
    ),
    buildSchedule(data.today_schedule)
  );

  const activityCard = h(
    "div.card",
    {},
    h("div.card-head", {}, h("div", {}, h("h3", { text: "Recent activity" }), h("p", { text: "Audit trail highlights" }))),
    h(
      "div.card-body",
      {},
      data.activity.length
        ? h("div.feed", {}, ...data.activity.map((entry) => feedItem(entry)))
        : h("p.muted", { text: "No activity recorded yet.", style: { fontSize: ".85rem" } })
    )
  );

  const notificationCard = h(
    "div.card",
    {},
    h("div.card-head", {}, h("div", {}, h("h3", { text: "Notifications" }), h("p", { text: "Reminders and alerts" }))),
    h(
      "div.card-body",
      {},
      data.notifications.length
        ? h("div.feed", {}, ...data.notifications.map((note) => h(
            "div.feed-item",
            {},
            h("span.feed-icon", { style: note.level === "warning" ? { background: "#fffbeb", color: "#b45309" } : null },
              icon(note.level === "warning" ? "alert" : "bell", 15)),
            h("div.grow", {}, h("strong", { text: note.title }), h("p", { text: note.body })),
            h("time", { text: relative(note.created_at) })
          )))
        : h("p.muted", { text: "Nothing new.", style: { fontSize: ".85rem" } })
    )
  );

  mount(
    container,
    hero,
    kpis,
    h("section.grid.grid-2", { style: { marginTop: "16px" } }, revenueCard, statusCard),
    h("section.grid.grid-2", { style: { marginTop: "16px" } }, scheduleCard,
      h("div.stack", {}, activityCard, notificationCard))
  );

  function refresh() {
    render(container).catch(() => toast.error("Could not refresh", "Please try again."));
  }
}

function heroStat(value, label) {
  return h("div.hero-stat", {}, h("strong", { text: value }), h("span", { text: label }));
}

function buildStatusMix(mix) {
  const meaningful = mix.filter((row) => row.count > 0);
  if (!meaningful.length) {
    return h("p.muted", { text: "No bookings in the last 30 days.", style: { fontSize: ".85rem" } });
  }
  const segments = meaningful.map((row) => ({
    label: STATUS_LABELS[row.status] || row.status,
    value: row.count,
    color: STATUS_COLORS[row.status] || "#4f46e5",
  }));
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return donutChart(segments, { size: 156, thickness: 18, label: "bookings", sub: String(total) });
}

function buildSchedule(items) {
  if (!items.length) {
    return emptyState({
      title: "No appointments today",
      message: "The schedule is clear. New bookings will appear here.",
      iconName: "calendar",
    });
  }
  return h(
    "div.schedule-list",
    {},
    ...items.map((booking) =>
      h(
        "div.schedule-row",
        { onClick: () => (location.hash = `#/bookings/${booking.id}`) },
        h("span.schedule-time", { text: booking.slot_start }),
        h(
          "div.schedule-who",
          {},
          h("strong", { text: booking.patient?.name || "Walk-in" }),
          h("span", {
            text: `${booking.items?.length || 0} test(s) · ${booking.booking_type === "home" ? "Home collection" : "Centre visit"}`,
          })
        ),
        h("div.schedule-meta", {}, statusPill(booking.status))
      )
    )
  );
}

function feedItem(entry) {
  const actionIcon = {
    login: "key",
    logout: "logout",
    booking_created: "calendar-plus",
    booking_cancelled: "x",
    booking_rescheduled: "history",
    booking_status: "check-circle",
    payment_received: "money",
    refund_issued: "money",
    patient_registered: "user-plus",
    product_created: "flask",
    product_updated: "edit",
    user_created: "user-plus",
    settings_updated: "settings",
    password_reset: "key",
  }[entry.action] || "activity";

  return h(
    "div.feed-item",
    {},
    h("span.feed-icon", {}, icon(actionIcon, 15)),
    h(
      "div.grow",
      {},
      h("strong", { text: entry.action.replace(/_/g, " ") }),
      h("p", { text: `${entry.user}${entry.entity ? ` · ${entry.entity}` : ""}${entry.detail ? ` · ${shorten(entry.detail)}` : ""}` })
    ),
    h("time", { text: relative(entry.created_at) })
  );
}

function shorten(text) {
  const clean = String(text).replace(/[{}"]/g, "").slice(0, 90);
  return clean.length >= 90 ? `${clean}…` : clean;
}
