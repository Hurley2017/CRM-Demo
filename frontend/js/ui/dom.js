/* --------------------------------------------------------------------------
   Tiny DOM toolkit: element builder, formatting, dates, currency, debounce.
   -------------------------------------------------------------------------- */

/**
 * h('div.card#main', { onClick }, child, child…)
 * props: class/className, text, html, dataset, aria-*, style (obj), on* events
 */
export function h(spec, props = {}, ...children) {
  const [tagPart, ...classParts] = String(spec).split(/(?=[.#])/);
  const tag = tagPart || "div";
  const el = document.createElement(tag);

  for (const part of classParts) {
    if (part.startsWith("#")) {
      el.id = part.slice(1).trim();
    } else {
      // tolerate "div.card extra-class" style specs
      part.slice(1).split(/\s+/).filter(Boolean).forEach((token) => el.classList.add(token));
    }
  }

  const propsObj = props || {};
  for (const [key, value] of Object.entries(propsObj)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class" || key === "className") {
      String(value).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    } else if (key === "text") {
      el.textContent = value;
    } else if (key === "html") {
      el.innerHTML = value;
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value") {
      el.value = value;
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, value);
    }
  }

  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(container, ...children) {
  clear(container);
  append(container, children);
  return container;
}

/** Escape user supplied text before injecting as HTML. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ------------------------------------------------------------------ format */

export function money(amount, currency = "₹") {
  const value = Number(amount || 0);
  const formatted = Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: value % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "−" : ""}${currency}${formatted}`;
}

export function compactMoney(amount, currency = "₹") {
  const value = Number(amount || 0);
  if (Math.abs(value) >= 100000) return `${currency}${(value / 100000).toFixed(2)}L`;
  if (Math.abs(value) >= 1000) return `${currency}${(value / 1000).toFixed(1)}k`;
  return money(value, currency);
}

export function number(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

export function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function plural(count, one, many = `${one}s`) {
  return `${number(count)} ${count === 1 ? one : many}`;
}

/* -------------------------------------------------------------------- date */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseISO(value) {
  if (!value) return null;
  const [datePart, timePart = ""] = String(value).split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  let date = new Date(y, m - 1, d);
  if (timePart) {
    const [hh, mm] = timePart.split(":").map(Number);
    date.setHours(hh || 0, mm || 0, 0, 0);
  }
  return date;
}

export function fmtDate(value, { long = false, weekday = false } = {}) {
  const date = typeof value === "string" ? parseISO(value) : value;
  if (!date) return "—";
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  if (weekday) return `${DAYS[date.getDay()]}, ${base}`;
  return long ? base : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function fmtTime(value) {
  if (!value) return "—";
  const [hh, mm] = String(value).split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour}:${String(mm).padStart(2, "0")} ${suffix}`;
}

export function relative(value) {
  const date = typeof value === "string" ? parseISO(value) : value;
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (minutes < 0) {
    const ahead = Math.abs(minutes);
    if (ahead < 60) return `in ${ahead}m`;
    if (ahead < 1440) return `in ${Math.round(ahead / 60)}h`;
    return `in ${Math.round(ahead / 1440)}d`;
  }
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d ago`;
  return fmtDate(date);
}

export function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addDays(iso, days) {
  const date = parseISO(iso) || new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isWeekend(iso) {
  const date = parseISO(iso);
  return date ? date.getDay() === 0 : false;
}

/* ----------------------------------------------------------------- helpers */

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function download(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
