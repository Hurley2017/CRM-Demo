/* Centre settings — booking policy, schedule, branding. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, esc } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, emptyState } from "../ui/feedback.js";
import { pill } from "../ui/widgets.js";

const GROUPS = [
  { key: "general", title: "Centre profile", icon: "building", blurb: "Shown on invoices and printed reports." },
  { key: "booking", title: "Booking policy", icon: "calendar", blurb: "Rules enforced by the booking engine." },
  { key: "schedule", title: "Working hours", icon: "clock", blurb: "Generates available slots for every weekday." },
  { key: "operations", title: "Operations", icon: "activity", blurb: "Alerts and turnaround thresholds." },
];

export async function render(container) {
  const mountPoint = h("div");
  mount(container, mountPoint);
  mount(mountPoint, loadingState("Loading settings…"));

  let settings;
  try {
    settings = await api.get("/api/settings");
  } catch (error) {
    mount(mountPoint, emptyState({
      title: "Settings unavailable",
      message: error.message,
      actionLabel: "Back to dashboard",
      onAction: () => (location.hash = "#/dashboard"),
      iconName: "settings",
    }));
    return;
  }

  const inputs = new Map();

  const saveBar = h(
    "div.card",
    { style: { position: "sticky", bottom: "16px", zIndex: 20, display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", marginTop: "20px" } },
    h("span.grow", {}, h("strong", { text: "Unsaved changes?", style: { display: "block", fontSize: ".9rem" } }),
      h("span.muted", { text: "Settings apply centre-wide immediately after saving.", style: { fontSize: ".78rem" } })),
    h("button.btn.btn-outline", {
      type: "button",
      text: "Discard",
      onClick: () => load(),
    }),
    h("button.btn.btn-primary", {
      type: "button",
      onClick: save,
    }, icon("check", 16), "Save settings")
  );

  const grid = h("div.stack");
  mount(mountPoint,
    h("div.page-head", {},
      h("div", {}, h("h2", { text: "Centre settings" }),
        h("p", { text: "Policy, schedule and branding for Suraksha Diagnostic." }))),
    grid,
    saveBar);

  paint();

  function paint() {
    clear(grid);
    GROUPS.forEach((group) => {
      const rows = settings.filter((setting) => setting.group === group.key);
      if (!rows.length) return;

      grid.appendChild(
        h("div.card", {},
          h("div.card-head", {},
            h("div.row", { style: { gap: "10px" } },
              h("span.kpi-icon", { style: { width: "32px", height: "32px" } }, icon(group.icon, 16)),
              h("div", {}, h("h3", { text: group.title }), h("p", { text: group.blurb }))),
            rows.length ? pill(`${rows.length} setting${rows.length > 1 ? "s" : ""}`, "pill-brand") : null),
          h("div.card-body.setting-group", {},
            ...rows.map((setting) => settingRow(setting))))
      );
    });
  }

  function settingRow(setting) {
    let control;
    if (setting.type === "json") {
      control = h("textarea.textarea", {
        rows: "5",
        style: { fontFamily: "var(--font-mono)", fontSize: ".76rem" },
        value: setting.value,
        onInput: (event) => { setting.value = event.target.value; },
      });
    } else if (setting.type === "number") {
      control = h("input.input", {
        type: "number",
        value: setting.value,
        onInput: (event) => { setting.value = event.target.value; },
      });
    } else {
      control = h("input.input", {
        type: "text",
        value: setting.value,
        onInput: (event) => { setting.value = event.target.value; },
      });
    }

    inputs.set(setting.key, control);

    return h(
      "div.setting-row",
      {},
      h("div.sr-label", {},
        h("strong", { text: setting.label }),
        h("span", { text: describe(setting.key) })),
      control
    );
  }

  function describe(key) {
    return {
      center_name: "Appears on the sidebar, invoices and reports.",
      center_address: "Printed on every invoice.",
      center_phone: "Shown to patients on confirmations.",
      currency: "Currency symbol used across the app.",
      cancellation_window_hours: "Cancellations later than this are flagged late (no refund).",
      slot_minutes: "Length of each bookable slot. Existing bookings are unaffected.",
      booking_horizon_days: "How far ahead the front desk can book.",
      working_hours: 'JSON map: weekday index (0 = Monday) → ["08:00-13:00"].',
      report_ready_tat_alert: "Flag work that exceeds this many hours.",
    }[key] || "";
  }

  async function load() {
    try {
      settings = await api.get("/api/settings");
      paint();
      toast.info("Reloaded", "Unsaved changes discarded.");
    } catch (error) {
      toast.error("Could not reload", error.message);
    }
  }

  async function save(event) {
    const button = event.currentTarget;
    button.classList.add("loading");
    const payload = {};
    settings.forEach((setting) => { payload[setting.key] = setting.value; });
    try {
      const result = await api.put("/api/settings", payload);
      toast.success("Settings saved", result.message);
      settings = await api.get("/api/settings");
      paint();
    } catch (error) {
      toast.error("Could not save", error.message);
    } finally {
      button.classList.remove("loading");
    }
  }
}
