/* --------------------------------------------------------------------------
   Inline SVG icon set (stroke style, 24x24 grid).
   -------------------------------------------------------------------------- */

const PATHS = {
  dashboard:
    '<rect x="3" y="3" width="7.5" height="8" rx="2"/><rect x="13.5" y="3" width="7.5" height="5" rx="2"/><rect x="13.5" y="11" width="7.5" height="10" rx="2"/><rect x="3" y="14" width="7.5" height="7" rx="2"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  users:
    '<path d="M16 20v-1.8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7.5" r="3.6"/><path d="M22 20v-1.8a4 4 0 0 0-3-3.87"/><path d="M16.5 4.2a3.6 3.6 0 0 1 0 6.9"/>',
  user:
    '<path d="M19 20v-1.6a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20"/><circle cx="12" cy="7.5" r="3.8"/>',
  flask:
    '<path d="M9.5 3h5M10.5 3v6.2L5.4 17.6A2 2 0 0 0 7.1 20.6h9.8a2 2 0 0 0 1.7-3L13.5 9.2V3"/><path d="M8.2 14.5h7.6"/>',
  package:
    '<path d="M21 8.5v7a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 15.5v-7a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8.5z"/><path d="m3.3 7.5 8.7 5 8.7-5M12 22v-9.5"/>',
  chart:
    '<path d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21"/><path d="M7 15l4-5 3.5 3.5L20 7"/>',
  report:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  billing:
    '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 14.5h3"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.54 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.54h.06A1.7 1.7 0 0 0 10.1 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.46 9v.06A1.7 1.7 0 0 0 21 10.1h.09a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.56 1.03z"/>',
  shield:
    '<path d="M12 21s7.5-3.5 7.5-9.5V5.8L12 2.8 4.5 5.8v5.7C4.5 17.5 12 21 12 21z"/><path d="m9 11.8 2.2 2.2 4.1-4.3"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
  bell:
    '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5z"/><path d="M13.7 19.5a2 2 0 0 1-3.4 0"/>',
  logout:
    '<path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5"/><path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20.5 12H9.5"/>',
  key:
    '<circle cx="8" cy="15.5" r="4.5"/><path d="m11.5 12.5 8-8M17 4.5l2.5 2.5M14.5 7l2.5 2.5"/>',
  lock:
    '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 1 1 8 0v3.5"/><circle cx="12" cy="15.8" r="1.4"/>',
  badge:
    '<rect x="4" y="3" width="16" height="18" rx="2.5"/><circle cx="12" cy="10" r="2.8"/><path d="M7.5 17.5a4.7 4.7 0 0 1 9 0"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  minus: '<path d="M5.5 12h13"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  "check-circle":
    '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  "chevron-down": '<path d="m6 9.5 6 6 6-6"/>',
  "chevron-right": '<path d="m9.5 6 6 6-6 6"/>',
  "chevron-left": '<path d="m14.5 6-6 6 6 6"/>',
  "arrow-left": '<path d="M19.5 12H4.5M10.5 6l-6 6 6 6"/>',
  "arrow-right": '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  edit:
    '<path d="M12 20h8.5"/><path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L7.5 19l-4 1 1-4z"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M6.5 7.5 7.4 19a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-11.5"/><path d="M10.5 11.5v5M13.5 11.5v5"/>',
  clock:
    '<circle cx="12" cy="12" r="8.7"/><path d="M12 7.2V12l3.2 2"/>',
  history:
    '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.4"/><path d="M3.5 4v4.5H8"/><path d="M12 7.8V12l3 1.8"/>',
  filter: '<path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 2v-7.6z"/>',
  download: '<path d="M12 3.5v11.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20.5h16"/>',
  upload: '<path d="M12 15.5V4"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M4 20.5h16"/>',
  print:
    '<path d="M6.5 9V4h11v5"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M6.5 14.5h11V21h-11z"/>',
  phone:
    '<path d="M21 16.9v2.6a2 2 0 0 1-2.2 2 19.4 19.4 0 0 1-8.5-3 19.1 19.1 0 0 1-5.9-5.9 19.4 19.4 0 0 1-3-8.6A2 2 0 0 1 3.4 2H6a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.8a15.5 15.5 0 0 0 5.9 5.9l1.2-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 21 16.9z"/>',
  mail:
    '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  alert:
    '<path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 17.2h.01"/>',
  info:
    '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5M12 8h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  refresh:
    '<path d="M20.5 11.5A8.5 8.5 0 0 0 6 6.6L3.5 9"/><path d="M3.5 4.5V9H8"/><path d="M3.5 12.5A8.5 8.5 0 0 0 18 17.4l2.5-2.4"/><path d="M20.5 19.5V15H16"/>',
  eye:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/>',
  "eye-off":
    '<path d="M9.9 5.7A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-2.7 3.6M6.3 7.8A17.4 17.4 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1"/><path d="M9.9 9.9a3.2 3.2 0 0 0 4.3 4.3"/><path d="M3.5 3.5l17 17"/>',
  "map-pin":
    '<path d="M20 10.3c0 5.2-8 11.7-8 11.7s-8-6.5-8-11.7a8 8 0 1 1 16 0z"/><circle cx="12" cy="10.2" r="2.9"/>',
  home:
    '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.3V20h13V9.3"/><path d="M9.8 20v-5.5h4.4V20"/>',
  building:
    '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01"/><path d="M10 20v-4h4v4"/>',
  money:
    '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5h.01M18 14.5h.01"/>',
  activity:
    '<path d="M3 12h4l2.5-7 4.5 14 2.5-7H21"/>',
  star: '<path d="m12 3.8 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 10l5.9-.9z"/>',
  award:
    '<circle cx="12" cy="9" r="5.5"/><path d="m8.2 13.6-1.4 7 5.2-2.7 5.2 2.7-1.4-7"/>',
  copy:
    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  external:
    '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  inbox:
    '<path d="M21 12.5h-5.2l-1.6 2.6H9.8l-1.6-2.6H3"/><path d="M5.4 5.1 3 12.5v4.8A2.2 2.2 0 0 0 5.2 19.5h13.6a2.2 2.2 0 0 0 2.2-2.2v-4.8l-2.4-7.4A2.2 2.2 0 0 0 16.5 4H7.5a2.2 2.2 0 0 0-2.1 1.1z"/>',
  "user-plus":
    '<path d="M15 20v-1.8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="8.5" cy="7.5" r="3.6"/><path d="M19 8v6M16 11h6"/>',
  "calendar-plus":
    '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M12 13.5v5M9.5 16h5"/>',
  "trending-up": '<path d="m3 16.5 6-6 4 4 8-8"/><path d="M15 6.5h6v6"/>',
  "trending-down": '<path d="m3 7.5 6 6 4-4 8 8"/><path d="M15 17.5h6v-6"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  test_tube:
    '<path d="M8.5 3v13.5a3.5 3.5 0 0 0 7 0V3"/><path d="M7 3h10"/><path d="M8.5 10h7"/>',
  more:
    '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
};

/**
 * Build an SVG icon node.
 * @param {string} name  key of PATHS (aliases accepted)
 * @param {number} size  pixel size (default 18)
 */
export function icon(name, size = 18) {
  const key = ALIASES[name] || name;
  const path = PATHS[key] || PATHS.info;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = path;
  return svg;
}

const ALIASES = {
  home_collection: "home",
  centre: "building",
  grid: "dashboard",
  revenue: "money",
  tests: "flask",
  catalogue: "package",
  roles: "shield",
  invoice: "billing",
  staff: "users",
  patient: "user",
  warning: "alert",
  success: "check-circle",
  error: "alert",
  slot: "clock",
  no_show: "alert",
};

/** Replace every [data-icon] placeholder inside a root element. */
export function renderIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const size = Number(node.dataset.size || 18);
    node.appendChild(icon(node.dataset.icon, size));
    delete node.dataset.icon;
  });
}

export function hasIcon(name) {
  return Boolean(PATHS[ALIASES[name] || name]);
}
