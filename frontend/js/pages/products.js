/* Test catalogue — search, filters, card/detail views, CRUD for managers. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, money, debounce, esc } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, emptyState, confirmAction, openDrawer } from "../ui/feedback.js";
import { searchBox, segmented, dataTable, pill, tag } from "../ui/widgets.js";

const CATEGORY_COLORS = ["#4f46e5", "#0d9488", "#f59e0b", "#8b5cf6", "#0ea5e9", "#ef4444", "#10b981", "#ec4899"];

export async function render(container) {
  const state = { q: "", category: "", kind: "", view: "grid", page: 1, perPage: 24, loading: true, categories: [] };

  const grid = h("div.product-grid");
  const tableHost = h("div");
  const chips = h("div.filter-chips", { style: { marginBottom: "16px", flexWrap: "wrap" } });
  const meta = h("span.muted", { style: { fontSize: ".82rem" } });

  const search = searchBox({
    placeholder: "Search test name, code or category…",
    onInput: debounce((value) => { state.q = value; state.page = 1; load(); }, 300),
    onClear: () => { state.q = ""; load(); },
  });

  const kindSelect = h(
    "select.select",
    { onChange: (event) => { state.kind = event.target.value; state.page = 1; load(); } },
    h("option", { value: "", text: "All types" }),
    h("option", { value: "test", text: "Tests only" }),
    h("option", { value: "package", text: "Packages only" }),
    h("option", { value: "addon", text: "Add-ons" })
  );

  const viewToggle = segmented({
    options: [{ label: "Cards", value: "grid" }, { label: "Table", value: "table" }],
    value: state.view,
    onChange: (value) => { state.view = value; paint(); },
  });

  mount(
    container,
    h(
      "div.page-head",
      {},
      h("div", {}, h("h2", { text: "Test catalogue" }), h("p", { text: "Tests, packages, pricing and patient preparation instructions." })),
      h("div.page-actions", {},
        store.can("products.edit")
          ? h("button.btn.btn-primary", { type: "button", onClick: () => openEditor(null, load) },
              icon("plus", 16), "Add test")
          : null)
    ),
    h("div.toolbar", {}, search.element, kindSelect, meta,
      h("div", { style: { marginLeft: "auto" } }, viewToggle)),
    chips,
    grid,
    tableHost
  );

  loadCategories();
  await load();

  async function loadCategories() {
    try {
      state.categories = await api.get("/api/products/categories");
      paintChips();
    } catch { /* ignore */ }
  }

  function paintChips() {
    clear(chips);
    const options = [{ name: "All", value: "" }, ...state.categories];
    options.forEach((option) => {
      chips.appendChild(
        h("button.chip", {
          type: "button",
          class: option.value === state.category ? "active" : "",
          onClick: () => { state.category = option.value; state.page = 1; paintChips(); load(); },
        },
          document.createTextNode(option.name),
          option.count ? h("span", { text: ` ${option.count}`, style: { opacity: .6 } }) : null)
      );
    });
  }

  async function load() {
    if (state.loading) { grid.appendChild(loadingSkeletons()); }
    try {
      const data = await api.get("/api/products", {
        params: {
          q: state.q, category: state.category, kind: state.kind,
          page: state.page, per_page: state.perPage,
        },
      });
      state.loading = false;
      meta.textContent = `${data.total} entr${data.total === 1 ? "y" : "ies"}`;
      paint(data);
    } catch (error) {
      state.loading = false;
      toast.error("Could not load catalogue", error.message);
    }
  }

  function paint(data) {
    if (!data) return;
    clear(grid);
    clear(tableHost);
    grid.hidden = state.view !== "grid";
    tableHost.hidden = state.view !== "table";

    if (!data.items.length) {
      grid.hidden = false;
      tableHost.hidden = true;
      grid.style.gridTemplateColumns = "1fr";
      grid.appendChild(emptyState({
        title: state.q ? `No results for “${state.q}”` : "No tests match the filter",
        message: "Try a different keyword or clear the category filter.",
        iconName: "flask",
      }));
      return;
    }
    grid.style.gridTemplateColumns = "";

    if (state.view === "grid") {
      data.items.forEach((product, index) => grid.appendChild(productCard(product, index)));
    } else {
      tableHost.appendChild(
        dataTable({
          columns: [
            { label: "Code", render: (row) => h("span.mono", { text: row.code }) },
            { label: "Test", render: (row) => h("div", {}, h("strong", { text: row.name }),
                h("span.cell-sub", { text: row.category })) },
            { label: "Type", render: (row) => pill(row.kind.toUpperCase(), row.kind === "package" ? "pill-brand" : "pill-neutral") },
            { label: "Sample", render: (row) => row.sample_type || "—" },
            { label: "TAT", render: (row) => `${row.tat_hours}h` },
            { label: "Price", className: "text-right", render: (row) => h("strong", { text: money(row.price, store.currency) }) },
            { label: "", className: "actions", render: (row) => h("div.row-actions", {},
                h("button.icon-btn", { type: "button", "aria-label": "View", onClick: (event) => { event.stopPropagation(); openDetail(row); } }, icon("eye", 16)),
                store.can("products.edit")
                  ? h("button.icon-btn", { type: "button", "aria-label": "Edit", onClick: (event) => { event.stopPropagation(); openEditor(row, load); } }, icon("edit", 16))
                  : null) },
          ],
          rows: data.items,
          onRowClick: (row) => openDetail(row),
        })
      );
    }
  }

  function productCard(product, index) {
    const color = CATEGORY_COLORS[Math.abs(hash(product.category)) % CATEGORY_COLORS.length];
    return h(
      "div.product-card",
      { style: { "--cat-color": color } },
      h(
        "div.pc-top",
        {},
        h("div", {}, h("span.pc-code", { text: product.code }), h("h4", { text: product.name })),
        product.active ? null : pill("inactive", "pill-cancelled")
      ),
      h(
        "div.pc-tags",
        {},
        tag(product.category),
        product.kind === "package" ? tag(`package · ${product.components.length} tests`, "tag-sample") : null,
        product.prep_instructions ? tag("fasting prep", "tag-sample") : null
      ),
      h("div.pc-price", {}, money(product.price, store.currency), h("small", { text: product.kind === "package" ? "package" : "per test" })),
      h(
        "div.pc-foot",
        {},
        h("span.with-icon", {}, icon("flask", 13), product.sample_type || "—"),
        h("span.with-icon", {}, icon("clock", 13), `${product.tat_hours}h TAT`),
        h("button.link-btn", { type: "button", text: "Details", onClick: (event) => { event.stopPropagation(); openDetail(product); } })
      )
    );
  }

  function openDetail(product) {
    openDrawer({
      title: product.name,
      subtitle: `${product.code} · ${product.category}`,
      body: h(
        "div.stack",
        {},
        h("div.row", { style: { gap: "8px", flexWrap: "wrap" } },
          pill(product.kind.toUpperCase(), product.kind === "package" ? "pill-brand" : "pill-neutral"),
          pill(`${product.tat_hours}h TAT`, "pill-outline"),
          pill(product.active ? "Active" : "Inactive", product.active ? "pill-completed" : "pill-cancelled")),
        h("div.stat-band", {},
          h("div.meta-item", {}, h("span", { text: "Price" }), h("strong", { text: money(product.price, store.currency) })),
          h("div.meta-item", {}, h("span", { text: "Cost" }), h("strong", { text: money(product.cost, store.currency) })),
          h("div.meta-item", {}, h("span", { text: "Margin" }), h("strong", { text: money(product.margin, store.currency) }))),
        h("div", {},
          h("div.eyebrow", { text: "Sample type" }),
          h("p", { text: product.sample_type || "Not applicable", style: { marginTop: "6px", fontSize: ".9rem" } })),
        h("div", {},
          h("div.eyebrow", { text: "Patient preparation" }),
          h("p", { text: product.prep_instructions || "No special preparation required.", style: { marginTop: "6px", fontSize: ".9rem" } })),
        product.description ? h("div", {},
          h("div.eyebrow", { text: "Description" }),
          h("p", { text: product.description, style: { marginTop: "6px", fontSize: ".9rem" } })) : null,
        product.components?.length ? h("div", {},
          h("div.eyebrow", { text: `Includes ${product.components.length} tests` }),
          h("ul.component-list", { style: { marginTop: "8px" } },
            ...product.components.map((component) =>
              h("li", {}, h("span", { text: component.name }), h("span", { text: money(component.price, store.currency) })))))
          : null
      ),
      footer: (close) => [
        h("button.btn.btn-outline", { type: "button", text: "Close", onClick: () => close() }),
        store.can("products.edit")
          ? h("button.btn.btn-primary", { type: "button", text: "Edit entry",
              onClick: () => { close(); openEditor(product, load); } })
          : null,
      ],
    });
  }
}

function hash(text) {
  let value = 0;
  for (const char of String(text)) value = (value * 31 + char.charCodeAt(0)) | 0;
  return value;
}

function loadingSkeletons() {
  return h(
    "div.product-grid",
    {},
    ...Array.from({ length: 6 }, () =>
      h("div.product-card", { style: { height: "190px", pointerEvents: "none" } },
        h("div.skeleton", { style: { height: "12px", width: "40%" } }),
        h("div.skeleton", { style: { height: "18px", width: "80%", marginTop: "10px" } }),
        h("div.skeleton", { style: { height: "26px", width: "50%", marginTop: "14px" } }),
        h("div.skeleton", { style: { height: "12px", width: "70%", marginTop: "24px" } }))
    )
  );
}

/* ---------------------------------------------------------------- editor */

export function openEditor(product, onDone) {
  const isEdit = Boolean(product);
  const fields = {
    code: h("input.input", { value: product?.code || "", placeholder: "BIO-XYZ" }),
    name: h("input.input", { value: product?.name || "", placeholder: "Test name" }),
    category: h("input.input", { value: product?.category || "", placeholder: "Biochemistry", list: "category-list" }),
    kind: h("select.select", {},
      ...["test", "package", "addon"].map((value) =>
        h("option", { value, text: value.toUpperCase(), selected: (product?.kind || "test") === value }))),
    price: h("input.input", { type: "number", min: "0", step: "10", value: String(product?.price ?? "") }),
    cost: h("input.input", { type: "number", min: "0", step: "10", value: String(product?.cost ?? "") }),
    sample_type: h("input.input", { value: product?.sample_type || "", placeholder: "EDTA Blood / Serum / Urine" }),
    tat_hours: h("input.input", { type: "number", min: "1", value: String(product?.tat_hours ?? 24) }),
    prep_instructions: h("textarea.textarea", { rows: "2", placeholder: "e.g. 10-12 hour fast required." }, product?.prep_instructions || ""),
    description: h("textarea.textarea", { rows: "2", placeholder: "Internal description…" }, product?.description || ""),
  };

  const activeSwitch = h("button.switch", {
    type: "button",
    role: "switch",
    "aria-checked": String(product ? product.active : true),
    onClick: () => {
      const next = activeSwitch.getAttribute("aria-checked") !== "true";
      activeSwitch.setAttribute("aria-checked", String(next));
    },
  });

  const componentHost = h("div.picker-list", { style: { maxHeight: "240px", marginTop: "10px" } });
  const selectedComponents = new Set((product?.components || []).map((component) => component.id));
  let allProducts = [];

  if (fields.kind.value === "package") loadComponents();
  fields.kind.addEventListener("change", () => {
    componentHost.parentElement.hidden = fields.kind.value !== "package";
    if (fields.kind.value === "package" && !allProducts.length) loadComponents();
  });

  async function loadComponents() {
    try {
      const data = await api.get("/api/products", { params: { kind: "test", per_page: 100 }, silent: true });
      allProducts = data.items;
      paintComponents();
    } catch { /* ignore */ }
  }

  function paintComponents() {
    clear(componentHost);
    allProducts.forEach((test) => {
      componentHost.appendChild(
        h("div.picker-row" + (selectedComponents.has(test.id) ? " selected" : ""), {
          onClick: () => {
            if (selectedComponents.has(test.id)) selectedComponents.delete(test.id);
            else selectedComponents.add(test.id);
            paintComponents();
          },
        },
          h("span.picker-check", {}, icon("check", 13)),
          h("div.pr-main", {}, h("strong", { text: test.name }), h("span", { text: `${test.code} · ${test.category}` })),
          h("span.pr-price", { text: money(test.price, store.currency) }))
      );
    });
  }

  openModal({
    title: isEdit ? `Edit ${product.code}` : "Add catalogue entry",
    subtitle: isEdit ? product.name : "A test, package or add-on service",
    size: "lg",
    body: h(
      "div",
      {},
      h("div.form-grid", {},
        h("label.field", {}, h("span", { text: "Code" }), fields.code),
        h("label.field", {}, h("span", { text: "Name" }), fields.name),
        h("label.field", {}, h("span", { text: "Category" }), fields.category),
        h("label.field", {}, h("span", { text: "Type" }), fields.kind),
        h("label.field", {}, h("span", { text: "Price (₹)" }), fields.price),
        h("label.field", {}, h("span", { text: "Cost (₹)" }), fields.cost),
        h("label.field", {}, h("span", { text: "Sample type" }), fields.sample_type),
        h("label.field", {}, h("span", { text: "TAT (hours)" }), fields.tat_hours),
        h("label.field.span-2", {}, h("span", { text: "Patient preparation" }), fields.prep_instructions),
        h("label.field.span-2", {}, h("span", { text: "Description" }), fields.description),
        h("div.span-2.row-between", {},
          h("div", {}, h("strong", { text: "Active", style: { fontSize: ".85rem" } }),
            h("div.muted", { text: "Inactive entries cannot be booked", style: { fontSize: ".74rem" } })),
          activeSwitch)),
      h("div", { hidden: fields.kind.value !== "package", style: { marginTop: "16px" } },
        h("div.eyebrow", { text: "Package components" }),
        componentHost),
      h("datalist", { id: "category-list" },
        ...["Hematology", "Biochemistry", "Thyroid", "Hormones", "Lipid Profile", "Cardiac Markers",
          "Microbiology", "Urine Analysis", "Pathology", "Radiology", "Health Packages"]
          .map((name) => h("option", { value: name })))
    ),
    footer: (close) => [
      isEdit && store.can("products.edit")
        ? h("button.btn.btn-danger-soft.left", {
            type: "button",
            text: product.active ? "Deactivate" : "Reactivate",
            onClick: async () => {
              const ok = await confirmAction({
                title: product.active ? "Deactivate this entry?" : "Reactivate this entry?",
                message: product.active
                  ? `${product.name} will no longer be bookable. History is preserved.`
                  : `${product.name} becomes bookable again.`,
                confirmText: product.active ? "Deactivate" : "Reactivate",
                danger: product.active,
              });
              if (!ok) return;
              try {
                await api.post(`/api/products/${product.id}/toggle`);
                close();
                toast.success(product.active ? "Entry deactivated" : "Entry reactivated");
                onDone?.();
              } catch (error) {
                toast.error("Action failed", error.message);
              }
            },
          })
        : null,
      h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
      h("button.btn.btn-primary", {
        type: "button",
        text: isEdit ? "Save changes" : "Add to catalogue",
        onClick: async (event) => {
          const button = event.currentTarget;
          button.classList.add("loading");
          const payload = {
            code: fields.code.value.trim().toUpperCase(),
            name: fields.name.value.trim(),
            category: fields.category.value.trim() || "General",
            kind: fields.kind.value,
            price: Number(fields.price.value || 0),
            cost: Number(fields.cost.value || 0),
            sample_type: fields.sample_type.value.trim(),
            tat_hours: Number(fields.tat_hours.value || 24),
            prep_instructions: fields.prep_instructions.value.trim(),
            description: fields.description.value.trim(),
            active: activeSwitch.getAttribute("aria-checked") === "true",
            component_ids: [...selectedComponents],
          };
          try {
            const result = isEdit
              ? await api.put(`/api/products/${product.id}`, payload)
              : await api.post("/api/products", payload);
            close();
            toast.success(isEdit ? "Entry updated" : "Entry added", result.message);
            onDone?.();
          } catch (error) {
            button.classList.remove("loading");
            toast.error("Could not save", error.message);
          }
        },
      }),
    ],
  });
}
