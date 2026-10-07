/* --------------------------------------------------------------------------
   Suraksha Diagnostic — application shell, session bootstrap and router.
   -------------------------------------------------------------------------- */

import { api, setUnauthorizedHandler } from "./api.js";
import { store, guard } from "./store.js";
import { h, clear, mount, qs, esc, debounce, initials, relative } from "./ui/dom.js";
import { icon, renderIcons } from "./ui/icons.js";
import { toast, clearOverlays, loadingState, openModal } from "./ui/feedback.js";

/* --------------------------------------------------------------- routes */

const ROUTES = [
  { pattern: /^#\/dashboard$/, page: () => import("./pages/dashboard.js"), perms: ["dashboard.view"],
    title: "Dashboard", subtitle: "Centre overview at a glance", nav: "dashboard" },

  { pattern: /^#\/bookings\/new$/, page: () => import("./pages/bookingWizard.js"), perms: ["bookings.create"],
    title: "New Booking", subtitle: "Reserve a slot for a patient", nav: "bookings" },

  { pattern: /^#\/bookings\/([\w-]+)$/, page: () => import("./pages/bookingDetail.js"), perms: ["bookings.view"],
    title: "Booking Detail", subtitle: "Status, items and payments", nav: "bookings",
    params: (m) => ({ id: m[1] }) },

  { pattern: /^#\/bookings$/, page: () => import("./pages/bookings.js"), perms: ["bookings.view"],
    title: "Bookings", subtitle: "Schedule, modify and track appointments", nav: "bookings" },

  { pattern: /^#\/patients\/([\w-]+)$/, page: () => import("./pages/patientDetail.js"), perms: ["patients.view"],
    title: "Patient Record", subtitle: "History and contact details", nav: "patients",
    params: (m) => ({ id: m[1] }) },

  { pattern: /^#\/patients$/, page: () => import("./pages/patients.js"), perms: ["patients.view"],
    title: "Patients", subtitle: "Registry, search and registration", nav: "patients" },

  { pattern: /^#\/products$/, page: () => import("./pages/products.js"), perms: ["products.view"],
    title: "Test Catalogue", subtitle: "Tests, packages and pricing", nav: "products" },

  { pattern: /^#\/billing$/, page: () => import("./pages/billing.js"), perms: ["billing.view"],
    title: "Billing", subtitle: "Invoices, collections and refunds", nav: "billing" },

  { pattern: /^#\/reports$/, page: () => import("./pages/reports.js"), perms: ["reports.view"],
    title: "Reports", subtitle: "Revenue, operations and staff performance", nav: "reports" },

  { pattern: /^#\/users$/, page: () => import("./pages/users.js"), perms: ["users.view"],
    title: "Employees", subtitle: "Staff accounts and role assignment", nav: "users" },

  { pattern: /^#\/settings$/, page: () => import("./pages/settings.js"), perms: ["settings.manage"],
    title: "Centre Settings", subtitle: "Booking policy, schedule and branding", nav: "settings" },

  { pattern: /^#\/audit$/, page: () => import("./pages/audit.js"), perms: ["audit.view"],
    title: "Audit Trail", subtitle: "Every change, attributed and timestamped", nav: "audit" },
];

const NAV = [
  { section: "Overview", items: [{ key: "dashboard", label: "Dashboard", href: "#/dashboard", icon: "dashboard", perms: ["dashboard.view"] }] },
  {
    section: "Operations",
    items: [
      { key: "bookings", label: "Bookings", href: "#/bookings", icon: "calendar", perms: ["bookings.view"], badge: "pending" },
      { key: "patients", label: "Patients", href: "#/patients", icon: "users", perms: ["patients.view"] },
      { key: "products", label: "Test Catalogue", href: "#/products", icon: "flask", perms: ["products.view"] },
      { key: "billing", label: "Billing", href: "#/billing", icon: "billing", perms: ["billing.view"] },
    ],
  },
  { section: "Insights", items: [{ key: "reports", label: "Reports", href: "#/reports", icon: "chart", perms: ["reports.view"] }] },
  {
    section: "Administration",
    items: [
      { key: "users", label: "Employees", href: "#/users", icon: "user-plus", perms: ["users.view"] },
      { key: "settings", label: "Settings", href: "#/settings", icon: "settings", perms: ["settings.manage"] },
      { key: "audit", label: "Audit Trail", href: "#/audit", icon: "history", perms: ["audit.view"] },
    ],
  },
];

const TITLES = {
  dashboard: ["Dashboard", "Centre overview at a glance"],
  bookings: ["Bookings", "Schedule, modify and track appointments"],
};

let currentPage = null;
let activeNav = "dashboard";

/* ---------------------------------------------------------------- boot */

async function boot() {
  renderIcons(document);
  wireLogin();
  wireShell();
  setUnauthorizedHandler(() => {
    store.clear();
    showLogin();
    toast.warning("Session expired", "Please sign in again.");
  });

  const user = await store.refresh();
  if (user) showShell();
  else showLogin();
}

function showLogin() {
  clearOverlays();
  qs("#app-shell").hidden = true;
  qs("#login-screen").style.display = "";
  setTimeout(() => qs("#login-id")?.focus(), 60);
}

function showShell() {
  qs("#login-screen").style.display = "none";
  qs("#app-shell").hidden = false;
  renderProfile();
  renderNav();
  wireNotifications();
  if (!location.hash) location.hash = "#/dashboard";
  else route();
}

/* --------------------------------------------------------------- login */

function wireLogin() {
  const form = qs("#login-form");
  const errorBox = qs("#login-error");
  const submitBtn = qs("#login-submit");
  const passwordInput = qs("#login-password");

  qs("#toggle-password").addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    qs("#toggle-password").textContent = showing ? "Show" : "Hide";
  });

  document.querySelectorAll(".demo-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      qs("#login-id").value = chip.dataset.emp;
      passwordInput.value = chip.dataset.pwd;
      errorBox.hidden = true;
      form.requestSubmit();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submitBtn.classList.add("loading");

    try {
      const result = await api.post("/api/auth/login", {
        employee_id: qs("#login-id").value.trim(),
        password: passwordInput.value,
      }, { silent: true });

      store.setSession(result.user, result.permissions);
      toast.success(result.message || "Signed in", `${result.user.role.label} · ${result.user.employee_id}`);
      showShell();
      location.hash = "#/dashboard";
      route();
    } catch (error) {
      errorBox.hidden = false;
      errorBox.innerHTML = `<span>${esc(error.message)}</span>`;
      passwordInput.select();
    } finally {
      submitBtn.classList.remove("loading");
    }
  });
}

/* --------------------------------------------------------------- shell */

function renderProfile() {
  const user = store.user;
  if (!user) return;
  const short = user.name.split(" ")[0];

  qs("#profile-avatar").textContent = initials(user.name);
  qs("#profile-name").textContent = short;
  qs("#profile-role").textContent = user.role?.label || "";
  qs("#profile-avatar-lg").textContent = initials(user.name);
  qs("#profile-name-lg").textContent = user.name;
  qs("#profile-email-lg").textContent = user.email;
  qs("#profile-emp").textContent = `${user.employee_id} · ${user.role?.label || ""}`;
}

function renderNav() {
  const nav = qs("#sidebar-nav");
  clear(nav);

  NAV.forEach((group) => {
    const items = group.items.filter((item) => guard(item.perms, "any"));
    if (!items.length) return;

    nav.appendChild(h("div.nav-section", { text: group.section }));
    items.forEach((item) => {
      const button = h(
        "button.nav-item",
        {
          type: "button",
          class: activeNav === item.key ? "active" : "",
          onClick: () => {
            location.hash = item.href;
            closeSidebar();
          },
        },
        icon(item.icon, 18),
        h("span", { text: item.label })
      );
      if (item.badge) {
        button.appendChild(h("span.nav-count", { id: `nav-badge-${item.badge}`, text: "" , hidden: true}));
      }
      nav.appendChild(button);
    });
  });

  // shift / hours footer
  const now = new Date();
  qs("#shift-today").textContent = now.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function setActiveNav(key) {
  activeNav = key || "";
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.remove("active"));
  const index = NAV.flatMap((group) => group.items).findIndex((item) => item.key === activeNav);
  if (index >= 0) {
    const buttons = document.querySelectorAll(".nav-item");
    // nav buttons include section headers; match by label instead
    const target = NAV.flatMap((group) => group.items).find((item) => item.key === activeNav);
    if (target) {
      buttons.forEach((btn) => {
        if (btn.textContent.trim().startsWith(target.label)) btn.classList.add("active");
      });
    }
  }
}

function wireShell() {
  qs("#menu-toggle").addEventListener("click", () => toggleSidebar(true));
  qs("#sidebar-close").addEventListener("click", () => toggleSidebar(false));
  qs("#sidebar-scrim").addEventListener("click", () => toggleSidebar(false));

  // profile dropdown
  const profile = qs("#profile-dropdown");
  const profilePanel = profile.querySelector(".dropdown-panel");
  qs("#profile-toggle").addEventListener("click", (event) => {
    event.stopPropagation();
    closeDropdowns(profilePanel);
    profilePanel.hidden = !profilePanel.hidden;
  });

  profilePanel.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    profilePanel.hidden = true;

    if (action === "logout") await logout();
    if (action === "settings") location.hash = "#/settings";
    if (action === "password") openPasswordModal();
  });

  document.addEventListener("click", () => closeDropdowns());
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
    }
    if (event.key === "Escape") closeDropdowns();
  });

  qs("#search-trigger").addEventListener("click", openPalette);
  qs("#search-mobile").addEventListener("click", openPalette);
}

function closeDropdowns(except = null) {
  document.querySelectorAll(".dropdown-panel").forEach((panel) => {
    if (panel !== except) panel.hidden = true;
  });
}

function toggleSidebar(open) {
  qs("#app-shell").classList.toggle("sidebar-open", open);
  qs("#sidebar-scrim").hidden = !open;
}

function closeSidebar() {
  if (window.innerWidth <= 900) toggleSidebar(false);
}

async function logout() {
  try {
    await api.post("/api/auth/logout");
  } catch { /* session already gone */ }
  store.clear();
  clearOverlays();
  showLogin();
  toast.info("Signed out", "Your session has ended.");
}

function openPasswordModal() {
  const current = h("input.input", { type: "password", placeholder: "Current password", autocomplete: "current-password" });
  const next = h("input.input", { type: "password", placeholder: "Minimum 8 characters", autocomplete: "new-password" });
  const repeat = h("input.input", { type: "password", placeholder: "Repeat new password", autocomplete: "new-password" });
  const alert = h("div.form-alert", { hidden: true });

  openModal({
    title: "Change password",
    subtitle: "Applies to your own account only",
    body: h(
      "div.stack",
      {},
      h("label.field", {}, h("span", { text: "Current password" }), current),
      h("label.field", {}, h("span", { text: "New password" }), next),
      h("label.field", {}, h("span", { text: "Repeat new password" }), repeat),
      alert
    ),
    footer: (close) => [
      h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
      h("button.btn.btn-primary", {
        type: "button",
        text: "Update password",
        onClick: async (event) => {
          const button = event.currentTarget;
          alert.hidden = true;
          if (next.value !== repeat.value) {
            alert.hidden = false;
            alert.innerHTML = "<span>New passwords do not match.</span>";
            return;
          }
          button.classList.add("loading");
          try {
            await api.post("/api/auth/password", {
              current_password: current.value,
              new_password: next.value,
            });
            close();
            toast.success("Password updated", "Use it next time you sign in.");
          } catch (error) {
            alert.hidden = false;
            alert.innerHTML = `<span>${esc(error.message)}</span>`;
          } finally {
            button.classList.remove("loading");
          }
        },
      }),
    ],
  });
}

/* -------------------------------------------------------- notifications */

async function wireNotifications() {
  const toggle = qs("#notif-toggle");
  const panel = qs("#notif-dropdown .dropdown-panel");
  const list = qs("#notif-list");
  const count = qs("#notif-count");

  toggle.addEventListener("click", async (event) => {
    event.stopPropagation();
    const opening = panel.hidden;
    closeDropdowns(panel);
    panel.hidden = !opening;
    if (opening) await loadNotifications();
  });

  qs("#notif-readall").addEventListener("click", async () => {
    await api.post("/api/notifications/read-all");
    await loadNotifications();
    count.hidden = true;
  });

  async function loadNotifications() {
    try {
      const data = await api.get("/api/notifications");
      clear(list);
      if (!data.items.length) {
        list.appendChild(h("div.empty-state", { style: { padding: "28px 16px" } },
          h("p", { text: "You're all caught up." })));
      }
      data.items.forEach((note) => {
        list.appendChild(
          h(
            "div.notif-item" + (note.is_read ? "" : " unread"),
            {
              onClick: () => {
                panel.hidden = true;
                if (note.link) location.hash = note.link;
              },
            },
            h("span.notif-dot " + (note.level || "info")),
            h("div.grow", {},
              h("strong", { text: note.title }),
              h("p", { text: note.body || "" }),
              h("time", { text: relative(note.created_at) })
            )
          )
        );
      });
      updateBadge(data.unread);
    } catch {
      /* silent */
    }
  }

  function updateBadge(unread) {
    if (unread > 0) {
      count.hidden = false;
      count.textContent = unread > 9 ? "9+" : String(unread);
      const navBadge = qs("#nav-badge-pending");
      if (navBadge) { navBadge.hidden = false; navBadge.textContent = String(unread); }
    } else {
      count.hidden = true;
    }
  }

  // initial count
  api.get("/api/notifications", { silent: true })
    .then((data) => updateBadge(data.unread))
    .catch(() => {});
}

/* -------------------------------------------------------- search palette */

let paletteOpen = false;

function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;

  const input = h("input", {
    type: "text",
    placeholder: "Search patients by name or phone, booking no, test…",
    autocomplete: "off",
  });
  const results = h("div.palette-results");
  const shell = h("div.palette", {}, h("div.palette-input", {}, icon("search", 20), input, h("kbd", { text: "Esc" })), results);
  const scrim = h("div.scrim.top", {}, shell);
  const previousFocus = document.activeElement;

  const close = () => {
    paletteOpen = false;
    document.removeEventListener("keydown", onKey);
    scrim.remove();
    previousFocus?.focus?.();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };

  scrim.addEventListener("click", (event) => {
    if (event.target === scrim) close();
  });
  document.getElementById("overlay-root").appendChild(scrim);
  document.addEventListener("keydown", onKey);

  const runSearch = debounce(async () => {
    const query = input.value.trim();
    clear(results);
    if (query.length < 2) {
      results.appendChild(h("div.palette-group", { text: "Quick links" }));
      quickLinks().forEach((item) => results.appendChild(item));
      return;
    }
    try {
      const data = await api.get("/api/search", { params: { q: query }, silent: true });
      const groups = [
        ["Patients", data.patients, "users", (p) => `#/patients/${p.id}`, (p) => `${p.code} · ${p.phone || ""}`],
        ["Bookings", data.bookings, "calendar", (b) => `#/bookings/${b.id}`, (b) => `${b.booking_date} · ${b.slot_start} · ${b.status_label}`],
        ["Tests", data.products, "flask", () => "#/products", (p) => `${p.code} · ${p.category}`],
      ];
      let found = 0;
      groups.forEach(([label, items, iconName, href, sub]) => {
        if (!items?.length) return;
        found += items.length;
        results.appendChild(h("div.palette-group", { text: label }));
        items.forEach((item) => {
          results.appendChild(
            h(
              "button.palette-item",
              {
                type: "button",
                onClick: () => {
                  close();
                  location.hash = href(item);
                },
              },
              h("span.pi-ico", {}, icon(iconName, 16)),
              h("div", {}, h("strong", { text: item.name || item.booking_no }), h("span", { text: sub(item) }))
            )
          );
        });
      });
      if (!found) {
        results.appendChild(
          h("div.empty-state", { style: { padding: "34px 16px" } },
            h("p", { text: `No matches for “${query}”` }))
        );
      }
    } catch { /* ignore */ }
  }, 260);

  input.addEventListener("input", runSearch);
  setTimeout(() => input.focus(), 50);
  runSearch();
}

function quickLinks() {
  const links = [
    ["New booking", "#/bookings/new", "calendar-plus", ["bookings.create"]],
    ["Today's bookings", "#/bookings?view=today", "clock", ["bookings.view"]],
    ["Register patient", "#/patients", "user-plus", ["patients.edit"]],
    ["Test catalogue", "#/products", "flask", ["products.view"]],
    ["Reports", "#/reports", "chart", ["reports.view"]],
  ];
  return links
    .filter(([, , , perms]) => guard(perms, "any"))
    .map(([label, href, iconName]) =>
      h(
        "button.palette-item",
        { type: "button", onClick: () => { location.hash = href; document.querySelector(".scrim")?.remove(); } },
        h("span.pi-ico", {}, icon(iconName, 16)),
        h("div", {}, h("strong", { text: label }))
      )
    );
}

/* --------------------------------------------------------------- router */

async function route() {
  const hash = location.hash || "#/dashboard";

  // strip query string into params
  const [pathPart, queryPart] = hash.split("?");
  const query = new URLSearchParams(queryPart || "");
  const locationHash = `#${pathPart.replace(/^#/, "")}`;

  const match = ROUTES.find((route) => route.pattern.test(locationHash));

  if (!match) {
    const first = ROUTES.find((route) => guard(route.perms, "any"));
    location.hash = first ? first.href : "#/dashboard";
    return;
  }

  if (!store.isAuthed) {
    showLogin();
    return;
  }

  if (!guard(match.perms, "any")) {
    renderDenied(match);
    return;
  }

  const view = qs("#view");
  clearOverlays();
  mount(view, loadingState("Loading…"));

  qs("#page-title").textContent = match.title;
  qs("#page-subtitle").textContent = match.subtitle || "";
  document.title = `${match.title} · Suraksha Diagnostic`;
  setActiveNav(match.nav);

  try {
    const module = await match.page();
    const params = match.params ? match.params(pathPart.match(match.pattern)) : {};

    if (currentPage?.destroy) {
      try { currentPage.destroy(); } catch { /* ignore */ }
    }

    clear(view);
    currentPage = await module.render(view, { params, query, title: match.title });
  } catch (error) {
    console.error("page render failed", error);
    mount(
      view,
      h(
        "div.empty-state",
        {},
        h("div.empty-art", {}, icon("alert", 40)),
        h("h3", { text: "This page failed to load" }),
        h("p", { text: error.message || "Unexpected error." }),
        h("button.btn.btn-primary", { type: "button", text: "Try again", onClick: () => route() })
      )
    );
  }

  view.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function renderDenied(route) {
  const view = qs("#view");
  qs("#page-title").textContent = "Access restricted";
  qs("#page-subtitle").textContent = "";
  mount(
    view,
    h(
      "div.empty-state",
      {},
      h("div.empty-art", {}, icon("shield", 40)),
      h("h3", { text: "You don't have access to this area" }),
      h("p", {
        text: `Your role (${store.user?.role?.label || "unknown"}) cannot view ${route.title.toLowerCase()}. Ask an administrator if you need this permission.`,
      }),
      h("button.btn.btn-primary", {
        type: "button",
        text: "Back to dashboard",
        onClick: () => { location.hash = "#/dashboard"; },
      })
    )
  );
}

window.addEventListener("hashchange", route);

/* ---------------------------------------------------------- re-exports */

export { toast, api, store };

boot();
