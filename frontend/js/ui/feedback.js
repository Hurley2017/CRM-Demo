/* --------------------------------------------------------------------------
   Feedback primitives — toasts, modals, drawers, confirmations.
   -------------------------------------------------------------------------- */

import { h, clear, append } from "./dom.js";
import { icon } from "./icons.js";

/* ----------------------------------------------------------------- toasts */

const TOAST_ICONS = { success: "check-circle", error: "alert", warning: "alert", info: "info" };

function showToast(kind, title, message = "", ttl = 4200) {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const node = h(
    `div.toast.${kind}`,
    {},
    h("span.toast-icon", {}, icon(TOAST_ICONS[kind] || "info", 17)),
    h(
      "div",
      {},
      h("strong", { text: title }),
      message ? h("p", { text: message }) : null
    ),
    h("button.toast-close", {
      type: "button",
      "aria-label": "Dismiss",
      onClick: () => dismiss(),
      html: "&times;",
    })
  );

  const dismiss = () => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 200);
  };

  root.appendChild(node);
  while (root.children.length > 4) root.firstChild.remove();
  setTimeout(dismiss, ttl);
}

export const toast = {
  success: (title, message, ttl) => showToast("success", title, message, ttl),
  error: (title, message, ttl) => showToast("error", title, message, ttl || 6000),
  warning: (title, message, ttl) => showToast("warning", title, message, ttl || 5200),
  info: (title, message, ttl) => showToast("info", title, message, ttl),
};

/* ------------------------------------------------------------------ modals */

let activeOverlays = [];

function overlayKeydown(event, close) {
  if (event.key === "Escape" && activeOverlays[activeOverlays.length - 1] === close) {
    close();
  }
}

/**
 * openModal({ title, subtitle, body, footer, size, onClose, dismissable })
 * body/footer: Node | (close) => Node
 */
export function openModal({
  title,
  subtitle = "",
  body,
  footer,
  size = "",
  onClose = null,
  dismissable = true,
  headExtra = null,
}) {
  const root = document.getElementById("overlay-root");
  const previousFocus = document.activeElement;

  const close = () => {
    document.removeEventListener("keydown", onKey);
    activeOverlays = activeOverlays.filter((fn) => fn !== close);
    scrim.remove();
    if (onClose) onClose();
    if (previousFocus?.focus) previousFocus.focus();
  };

  const onKey = (event) => overlayKeydown(event, close);

  const bodyNode = h("div.modal-body");
  append(bodyNode, [typeof body === "function" ? body(close) : body]);

  const footNode = footer
    ? h("div.modal-foot")
    : null;
  if (footNode) append(footNode, [typeof footer === "function" ? footer(close) : footer]);

  const modal = h(
    `div.modal${size ? ` modal-${size}` : ""}`,
    { role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog" },
    h(
      "div.modal-head",
      {},
      h("div", {}, h("h3", { text: title || "" }), subtitle ? h("p", { text: subtitle }) : null),
      headExtra,
      dismissable
        ? h("button.icon-btn", {
            type: "button",
            "aria-label": "Close",
            onClick: () => close(),
            html: "&times;",
          })
        : null
    ),
    bodyNode,
    footNode
  );

  const scrim = h(
    "div.scrim",
    {
      onClick: (event) => {
        if (dismissable && event.target === scrim) close();
      },
    },
    modal
  );

  root.appendChild(scrim);
  activeOverlays.push(close);
  document.addEventListener("keydown", onKey);

  const focusTarget = modal.querySelector("input, textarea, select, button");
  if (focusTarget) setTimeout(() => focusTarget.focus(), 40);

  return { element: modal, close };
}

/**
 * confirm({ title, message, confirmText, cancelText, danger, detail })
 * Resolves true when confirmed.
 */
export function confirmAction({
  title = "Are you sure?",
  message = "",
  detail = null,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
  reason = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Tell us why…",
} = {}) {
  return new Promise((resolve) => {
    let reasonValue = "";
    let confirmBtn = null;
    /* close() also fires onClose (which settles as "cancelled"), so the first
       settlement wins — confirm handlers must settle before closing. */
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const detailNode = detail ? h("div.info-banner", {}, icon("info", 17), h("span", { text: detail })) : null;

    const reasonField = reason
      ? h(
          "label.field",
          { style: { marginTop: "14px" } },
          h("span", { text: reasonLabel }),
          h("textarea.textarea", {
            placeholder: reasonPlaceholder,
            rows: "3",
            onInput: (event) => {
              reasonValue = event.target.value;
              confirmBtn.disabled = reasonValue.trim().length < 3;
            },
          }),
          h("span.field-hint", { text: "Minimum 3 characters." })
        )
      : null;

    const handle = openModal({
      title,
      body: h(
        "div",
        {},
        message ? h("p", { text: message, style: { color: "var(--ink-600)", fontSize: ".9rem" } }) : null,
        detailNode,
        reasonField
      ),
      footer: (close) => {
        const cancelBtn = h("button.btn.btn-outline", {
          type: "button",
          onClick: () => {
            settle(false);
            close();
          },
          text: cancelText,
        });
        confirmBtn = h(`button.btn.${danger ? "btn-danger" : "btn-primary"}`, {
          type: "button",
          onClick: () => {
            settle(reason ? reasonValue.trim() : true);
            close();
          },
          text: confirmText,
        });
        if (reason) confirmBtn.disabled = true;
        return [cancelBtn, confirmBtn];
      },
      onClose: () => settle(false),
    });
    void handle;
  });
}

/* ----------------------------------------------------------------- drawer */

export function openDrawer({ title, subtitle = "", body, footer, onClose = null }) {
  const root = document.getElementById("overlay-root");
  const previousFocus = document.activeElement;

  const close = () => {
    document.removeEventListener("keydown", onKey);
    drawer.remove();
    scrim.remove();
    if (onClose) onClose();
    if (previousFocus?.focus) previousFocus.focus();
  };
  const onKey = (event) => overlayKeydown(event, close);

  const bodyNode = h("div.drawer-body");
  append(bodyNode, [typeof body === "function" ? body(close) : body]);

  const drawer = h(
    "aside.drawer",
    { role: "dialog", "aria-modal": "true" },
    h(
      "div.drawer-head",
      {},
      h("div", {}, h("h3", { text: title, style: { fontSize: "1.1rem", fontWeight: 700 } }),
        subtitle ? h("p", { class: "muted", text: subtitle, style: { fontSize: ".78rem" } }) : null),
      h("button.icon-btn", { type: "button", "aria-label": "Close", onClick: () => close(), html: "&times;" })
    ),
    bodyNode,
    footer ? h("div.drawer-foot", {}, typeof footer === "function" ? footer(close) : footer) : null
  );

  const scrim = h("div.drawer-scrim", { onClick: () => close() });

  root.append(scrim, drawer);
  activeOverlays.push(close);
  document.addEventListener("keydown", onKey);
  setTimeout(() => drawer.querySelector("button, input")?.focus(), 40);

  return { element: drawer, close };
}

/* ------------------------------------------------------------------ misc */

export function loadingState(label = "Loading…") {
  return h(
    "div.empty-state",
    {},
    h("div.skeleton", { style: { width: "46px", height: "46px", borderRadius: "50%" } }),
    h("p", { text: label, style: { marginTop: "14px" } })
  );
}

export function emptyState({ title, message, actionLabel, onAction, iconName = "inbox" }) {
  return h(
    "div.empty-state",
    {},
    h("div.empty-art", {}, icon(iconName, 40)),
    h("h3", { text: title }),
    h("p", { text: message || "" }),
    actionLabel
      ? h("button.btn.btn-primary", { type: "button", onClick: onAction }, icon("plus", 16), actionLabel)
      : null
  );
}

export function skeletonRows(count = 6, columns = 5) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(
      h(
        "tr",
        {},
        ...Array.from({ length: columns }, (_, col) =>
          h("td", {}, h("div.skeleton", { style: { height: "13px", width: `${45 + ((i + col) % 4) * 12}%` } }))
        )
      )
    );
  }
  return rows;
}

export function clearOverlays() {
  activeOverlays.forEach((close) => close());
  activeOverlays = [];
  const root = document.getElementById("overlay-root");
  if (root) clear(root);
}
