/* New booking wizard — Patient → Tests → Slot → Review. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, money, fmtDate, fmtTime, debounce, isoToday, addDays, initials, esc } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, emptyState } from "../ui/feedback.js";
import { avatar, field, pill } from "../ui/widgets.js";

const STEPS = ["Patient", "Tests", "Slot", "Review"];

export async function render(container, { query } = {}) {
  const state = {
    step: 0,
    patient: null,
    products: new Map(), // id -> product
    date: isoToday(),
    slot: null,
    slots: null,
    type: "center",
    address: "",
    phone: "",
    priority: "routine",
    notes: "",
    discount: 0,
    phlebotomist: "",
    followupOf: query?.get("followup") || null,
    submitting: false,
  };

  const stepBar = h("div.wizard-steps");
  const panel = h("div");
  const summary = h("div.card.summary-card.card-pad");
  const root = h("div.wizard", {}, h("div", {}, stepBar, panel), summary);

  mount(container, h("div.page-head", {},
    h("div", {}, h("h2", { text: "New booking" }),
      h("p", { text: "Four quick steps — availability is checked live before confirmation." })),
    h("div.page-actions", {},
      h("button.btn.btn-outline", { type: "button", onClick: () => (location.hash = "#/bookings") },
        icon("arrow-left", 15), "Back to list"))
  ), root);

  paintSteps();
  paintPanel();
  paintSummary();

  /* ------------------------------------------------------------- steps */

  function paintSteps() {
    clear(stepBar);
    STEPS.forEach((label, index) => {
      stepBar.appendChild(
        h(
          "button.wstep",
          {
            type: "button",
            class: [index === state.step ? "active" : "", index < state.step ? "done" : ""].filter(Boolean).join(" "),
            disabled: index > state.step,
            onClick: () => {
              state.step = index;
              paintSteps();
              paintPanel();
            },
          },
          h("span.wnum", { text: index < state.step ? "✓" : String(index + 1) }),
          label
        )
      );
    });
  }

  function goStep(index) {
    state.step = index;
    paintSteps();
    paintPanel();
    paintSummary();
  }

  /* ------------------------------------------------------------- panels */

  function paintPanel() {
    clear(panel);
    const builders = [patientStep, testsStep, slotStep, reviewStep];
    panel.appendChild(h("div.wizard-panel", {}, builders[state.step]()));
  }

  /* ---- step 1: patient ---- */
  function patientStep() {
    const results = h("div.result-scroll");
    const searchInput = h("input.input", {
      type: "search",
      placeholder: "Type at least 2 characters — name, phone or patient code",
      onInput: debounce(async () => {
        const q = searchInput.value.trim();
        clear(results);
        if (q.length < 2) {
          results.appendChild(h("p.muted", { text: "Start typing to search the registry.", style: { fontSize: ".82rem" } }));
          return;
        }
        try {
          const matches = await api.get("/api/patients/suggest", { params: { q }, silent: true });
          if (!matches.length) {
            results.appendChild(emptyState({
              title: "No patient found",
              message: "Register them below — the phone number is enough to start.",
              iconName: "user-plus",
            }));
            return;
          }
          matches.forEach((patient) => results.appendChild(patientRow(patient)));
        } catch { /* ignore */ }
      }, 260),
    });

    if (state.patient) results.appendChild(patientRow(state.patient, true));
    else results.appendChild(h("p.muted", { text: "Start typing to search the registry.", style: { fontSize: ".82rem" } }));

    const newPatientBtn = h(
      "button.btn.btn-outline",
      {
        type: "button",
        style: { marginTop: "14px" },
        onClick: () => openNewPatientModal(),
      },
      icon("user-plus", 16),
      "Register new patient"
    );

    const nextBtn = h(
      "button.btn.btn-primary.btn-lg",
      {
        type: "button",
        style: { marginTop: "18px" },
        disabled: !state.patient,
        onClick: () => goStep(1),
      },
      "Continue to tests",
      icon("arrow-right", 16)
    );

    return h(
      "div",
      {},
      h("h3", { text: "Who is this booking for?" }),
      h("p.lead", { text: "Search the existing registry or register a walk-in in seconds." }),
      searchInput,
      h("div", { style: { marginTop: "14px" } }, results),
      newPatientBtn,
      state.patient ? nextBtn : null
    );
  }

  function patientRow(patient, preselected = false) {
    return h(
      "div.patient-result" + (state.patient?.id === patient.id || preselected ? " selected" : ""),
      {
        onClick: () => {
          state.patient = patient;
          state.phone = patient.phone || "";
          paintPanel();
          paintSummary();
        },
      },
      avatar(patient.name),
      h("div.grow", {}, h("strong", { text: patient.name }), h("span", { text: `${patient.code} · ${patient.gender || "-"} · ${patient.age ?? "-"} yrs` })),
      h("div.pr-meta", {}, h("div", { text: patient.phone || "—" }), h("div", { text: `${patient.total_bookings} visits` }))
    );
  }

  function openNewPatientModal() {
    const name = h("input.input", { placeholder: "Full name" });
    const phone = h("input.input", { placeholder: "+91 98XXXXXXXX" });
    const gender = h("select.select", {},
      h("option", { value: "female", text: "Female" }),
      h("option", { value: "male", text: "Male" }),
      h("option", { value: "other", text: "Other" }));
    const dob = h("input.input", { type: "date" });
    const address = h("input.input", { placeholder: "Address (for home collection)" });
    const alertBox = h("div.form-alert", { hidden: true });

    openModal({
      title: "Register patient",
      subtitle: "Takes seconds — you can enrich the record later",
      body: h(
        "div.form-grid",
        {},
        h("label.field.span-2", {}, h("span", {}, "Full name", h("span", { text: " *", style: { color: "var(--danger-500)" } })), name),
        h("label.field", {}, h("span", { text: "Phone * " }), phone),
        h("label.field", {}, h("span", { text: "Gender" }), gender),
        h("label.field", {}, h("span", { text: "Date of birth" }), dob),
        h("label.field", {}, h("span", { text: "City" }), h("input.input", { placeholder: "Kolkata" })),
        h("label.field.span-2", {}, h("span", { text: "Address" }), address),
        h("div.span-2", {}, alertBox)
      ),
      footer: (close) => [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
        h("button.btn.btn-primary", {
          type: "button",
          text: "Register & select",
          onClick: async (event) => {
            const button = event.currentTarget;
            button.classList.add("loading");
            try {
              const result = await api.post("/api/patients", {
                name: name.value.trim(),
                phone: phone.value.trim(),
                gender: gender.value,
                dob: dob.value || null,
                address: address.value.trim(),
              });
              state.patient = result.patient || result;
              state.phone = state.patient.phone || "";
              close();
              toast.success("Patient registered", `${state.patient.name} · ${state.patient.code}`);
              paintPanel();
              paintSummary();
            } catch (error) {
              button.classList.remove("loading");
              alertBox.hidden = false;
              alertBox.innerHTML = `<span>${esc(error.message)}</span>`;
            }
          },
        }),
      ],
    });
  }

  /* ---- step 2: tests ---- */
  function testsStep() {
    const results = h("div.picker-list");
    const categoryFilter = h("div.filter-chips", { style: { marginBottom: "12px", maxHeight: "none" } });
    const prepNote = h("div");
    let activeCategory = "";

    const searchInput = h("input.input", {
      type: "search",
      placeholder: "Search tests and packages — e.g. CBC, thyroid, full body…",
      onInput: debounce(() => loadProducts(searchInput.value.trim()), 240),
    });

    loadCategories();
    loadProducts("");

    async function loadCategories() {
      try {
        const categories = await api.get("/api/products/categories");
        const options = [{ label: "All", value: "" }, ...categories.map((c) => ({ label: c.name, value: c.name }))];
        clear(categoryFilter);
        options.forEach((option) => {
          categoryFilter.appendChild(
            h("button.chip", {
              type: "button",
              class: option.value === activeCategory ? "active" : "",
              text: option.label,
              onClick: () => {
                activeCategory = option.value;
                categoryFilter.querySelectorAll(".chip").forEach((node) => node.classList.remove("active"));
                categoryFilter.querySelectorAll(".chip")[options.indexOf(option)]?.classList.add("active");
                loadProducts(searchInput.value.trim());
              },
            })
          );
        });
      } catch { /* ignore */ }
    }

    async function loadProducts(q) {
      clear(results);
      results.appendChild(h("p.muted", { text: "Searching…", style: { fontSize: ".82rem", padding: "8px 2px" } }));
      try {
        const items = q.length >= 2
          ? await api.get("/api/products/search", { params: { q }, silent: true })
          : (await api.get("/api/products", { params: { category: activeCategory, per_page: 40 }, silent: true })).items;
        clear(results);
        if (!items.length) {
          results.appendChild(emptyState({ title: "No matching tests", message: "Try a different keyword or category.", iconName: "flask" }));
          return;
        }
        items.forEach((product) => results.appendChild(productRow(product)));
        renderPrep();
      } catch (error) {
        clear(results);
        results.appendChild(h("p.text-danger", { text: error.message, style: { fontSize: ".82rem" } }));
      }
    }

    function productRow(product) {
      const selected = state.products.has(product.id);
      return h(
        "div.picker-row" + (selected ? " selected" : ""),
        {
          onClick: () => {
            if (state.products.has(product.id)) state.products.delete(product.id);
            else state.products.set(product.id, product);
            productRowToggle(product, selected);
            paintPanel();
            paintSummary();
          },
        },
        h("span.picker-check", {}, icon("check", 13)),
        h(
          "div.pr-main",
          {},
          h("strong", { text: product.name }),
          h("span", {
            text: `${product.code} · ${product.category}${product.kind === "package" ? ` · package of ${product.components?.length || 0}` : ""}`,
          })
        ),
        h("span.pr-price", { text: money(product.price, store.currency) })
      );
    }

    function productRowToggle() { /* state already flipped; paintPanel redraws */ }

    function renderPrep() {
      clear(prepNote);
      const instructions = [...state.products.values()]
        .filter((product) => product.prep_instructions)
        .map((product) => product.prep_instructions);
      if (instructions.length) {
        prepNote.appendChild(
          h(
            "div.prep-note",
            {},
            icon("alert", 16),
            h("span", { text: `Patient preparation: ${[...new Set(instructions)].join(" ")}` })
          )
        );
      }
    }

    const nextBtn = h(
      "button.btn.btn-primary.btn-lg",
      {
        type: "button",
        style: { marginTop: "18px" },
        disabled: state.products.size === 0,
        onClick: () => goStep(2),
      },
      "Continue to slot",
      icon("arrow-right", 16)
    );

    return h(
      "div",
      {},
      h("h3", { text: "Select tests & packages" }),
      h("p.lead", { text: "Package entries automatically include their component tests. Prices are locked at booking." }),
      searchInput,
      h("div", { style: { marginTop: "12px" } }, categoryFilter),
      results,
      prepNote,
      state.products.size ? nextBtn : null
    );
  }

  /* ---- step 3: slot ---- */
  function slotStep() {
    const dateStrip = h("div.date-strip");
    const slotGrid = h("div.slot-grid");
    const info = h("p.muted", { text: "Loading availability…", style: { fontSize: ".82rem" } });

    const typeSelect = h(
      "select.select",
      {
        onChange: (event) => {
          state.type = event.target.value;
          paintPanel();
          paintSummary();
        },
      },
      h("option", { value: "center", text: "Centre visit", selected: state.type === "center" }),
      h("option", { value: "home", text: "Home collection", selected: state.type === "home" })
    );

    const addressInput = h("input.input", {
      placeholder: "Flat / house, street, area, city",
      value: state.address,
      onInput: (event) => { state.address = event.target.value; paintSummary(); },
    });

    const phoneInput = h("input.input", {
      placeholder: "Contact number",
      value: state.phone,
      onInput: (event) => { state.phone = event.target.value; paintSummary(); },
    });

    const prioritySelect = h(
      "select.select",
      { onChange: (event) => { state.priority = event.target.value; paintSummary(); } },
      h("option", { value: "routine", text: "Routine", selected: state.priority === "routine" }),
      h("option", { value: "urgent", text: "Urgent (priority TAT)", selected: state.priority === "urgent" })
    );

    const notesInput = h("textarea.textarea", {
      rows: "2",
      placeholder: "Referring doctor, instructions, notes…",
      onInput: (event) => { state.notes = event.target.value; },
    });

    const nextBtn = h(
      "button.btn.btn-primary.btn-lg",
      {
        type: "button",
        style: { marginTop: "18px" },
        disabled: !state.slot,
        onClick: () => goStep(3),
      },
      "Review booking",
      icon("arrow-right", 16)
    );

    buildDateStrip();
    loadSlots();

    function buildDateStrip() {
      clear(dateStrip);
      const today = new Date();
      for (let offset = 0; offset < 30; offset += 1) {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        dateStrip.appendChild(
          h(
            "button.date-tile",
            {
              type: "button",
              class: [iso === state.date ? "active" : "", offset === 0 ? "today" : ""].filter(Boolean).join(" "),
              onClick: () => {
                state.date = iso;
                state.slot = null;
                nextBtn.disabled = true;
                buildDateStrip();
                loadSlots();
                paintSummary();
              },
            },
            h("div.dow", { text: date.toLocaleDateString("en-IN", { weekday: "short" }) }),
            h("div.dnum", { text: String(date.getDate()) }),
            h("div.dslots", { text: date.toLocaleDateString("en-IN", { month: "short" }) })
          )
        );
      }
    }

    async function loadSlots() {
      clear(slotGrid);
      info.textContent = "Loading availability…";
      try {
        state.slots = await api.get("/api/slots", { params: { date: state.date } });
        clear(slotGrid);
        state.slots.slots.forEach((slot) => {
          const button = h(
            "button.slot",
            {
              type: "button",
              class: state.slot === slot.start ? "selected" : "",
              disabled: slot.state !== "open",
              onClick: () => {
                state.slot = slot.start;
                slotGrid.querySelectorAll(".slot").forEach((node) => node.classList.remove("selected"));
                button.classList.add("selected");
                info.textContent = `${slot.start} – ${slot.end} selected on ${fmtDate(state.date, { weekday: true })}.`;
                nextBtn.disabled = false;
                paintSummary();
              },
            },
            slot.start,
            h("span.slot-state", { text: slot.state === "open" ? "open" : slot.state === "booked" ? "booked" : "past" })
          );
          slotGrid.appendChild(button);
        });
        const openCount = state.slots.open_count;
        info.textContent = openCount
          ? `${openCount} open slot(s) on ${fmtDate(state.date, { weekday: true })} · ${state.slots.slot_minutes}-minute slots.`
          : `The centre is closed or fully booked on ${fmtDate(state.date, { weekday: true })}.`;
      } catch (error) {
        info.textContent = error.message;
      }
    }

    return h(
      "div",
      {},
      h("h3", { text: "Pick a date & slot" }),
      h("p.lead", { text: "Availability is checked again at confirmation, so nobody is double-booked." }),
      dateStrip,
      h("div", { style: { marginTop: "16px" } }, slotGrid),
      info,
      h(
        "div.slot-legend",
        {},
        h("span", {}, h("i.open"), "Open"),
        h("span", {}, h("i.taken"), "Booked / past"),
        h("span", {}, h("i.sel"), "Selected")
      ),
      h(
        "div.form-grid",
        { style: { marginTop: "20px" } },
        field("Booking type", typeSelect),
        field("Contact phone", phoneInput),
        state.type === "home" ? field("Collection address", addressInput, { span: true, hint: "Required for home collection." }) : null,
        field("Priority", prioritySelect),
        field("Notes", notesInput, { span: true })
      ),
      nextBtn
    );
  }

  /* ---- step 4: review ---- */
  function reviewStep() {
    const discountInput = h("input.input", {
      type: "number",
      min: "0",
      step: "50",
      value: String(state.discount || 0),
      onInput: (event) => {
        state.discount = Math.max(0, Number(event.target.value) || 0);
        paintSummary();
      },
    });

    const discountField = store.can("bookings.edit")
      ? field("Discount (₹)", discountInput, { hint: "Applied to the total." })
      : null;

    const checklist = h(
      "div.stack",
      { style: { gap: "10px" } },
      checkItem("Patient selected", `${state.patient.name} · ${state.patient.code}`),
      checkItem("Tests chosen", `${state.products.size} item(s) · ${sumTests()} tests after packages expand`),
      checkItem("Slot reserved", `${fmtDate(state.date, { weekday: true })} at ${state.slot || "—"}`),
      checkItem("Contact confirmed", state.phone || state.patient.phone || "—"),
      checkItem("Preparation advised", prepSummary())
    );

    const confirmBtn = h(
      "button.btn.btn-primary.btn-lg",
      {
        type: "button",
        disabled: state.submitting,
        onClick: submit,
      },
      icon("check", 16),
      state.submitting ? "Confirming…" : "Confirm booking"
    );

    return h(
      "div",
      {},
      h("h3", { text: "Review & confirm" }),
      h("p.lead", { text: "Everything below is validated server-side before the slot is locked in." }),
      checklist,
      h("div.form-grid", { style: { marginTop: "18px" } }, discountField),
      h("div.row", { style: { marginTop: "20px", gap: "10px" } },
        h("button.btn.btn-outline", { type: "button", onClick: () => goStep(2) }, icon("chevron-left", 15), "Change slot"),
        confirmBtn)
    );
  }

  function checkItem(label, value) {
    return h(
      "div.row",
      { style: { padding: "11px 14px", background: "var(--ink-50)", borderRadius: "10px", border: "1px solid var(--border)" } },
      h("span", { style: { color: "var(--success-500)", display: "grid" } }, icon("check-circle", 18)),
      h("div", {}, h("strong", { text: label, style: { display: "block", fontSize: ".86rem" } }),
        h("span.muted", { text: value, style: { fontSize: ".78rem" } }))
    );
  }

  function sumTests() {
    let total = 0;
    state.products.forEach((product) => {
      total += product.kind === "package" ? (product.components?.length || 1) : 1;
    });
    return total;
  }

  function prepSummary() {
    const instructions = [...state.products.values()]
      .filter((product) => product.prep_instructions)
      .map((product) => product.prep_instructions);
    if (!instructions.length) return "No fasting required";
    const unique = [...new Set(instructions)];
    return unique[0] + (unique.length > 1 ? ` (+${unique.length - 1} more)` : "");
  }

  async function submit(event) {
    const button = event.currentTarget;
    state.submitting = true;
    button.classList.add("loading");

    try {
      const result = await api.post("/api/bookings", {
        patient_id: state.patient.id,
        booking_date: state.date,
        slot_start: state.slot,
        booking_type: state.type,
        address: state.address,
        phone: state.phone || state.patient.phone,
        priority: state.priority,
        notes: state.notes,
        discount: state.discount,
        product_ids: [...state.products.keys()],
        followup_of_id: state.followupOf || undefined,
      });
      toast.success("Booking confirmed", result.message || `${result.booking_no} created.`);
      location.hash = `#/bookings/${result.id}`;
    } catch (error) {
      state.submitting = false;
      button.classList.remove("loading");
      if (error.code === "slot_taken") {
        toast.warning("Slot just taken", "Please pick another time.");
        goStep(2);
      }
    }
  }

  /* ----------------------------------------------------------- summary */

  function paintSummary() {
    clear(summary);
    const items = [...state.products.values()];
    const subtotal = items.reduce((sum, product) => sum + Number(product.price), 0);
    const discount = Math.min(state.discount || 0, subtotal);
    const total = subtotal - discount;

    summary.appendChild(h("div.eyebrow", { text: "Booking summary" }));

    if (!items.length && !state.patient) {
      summary.appendChild(h("p.muted", { text: "Your selections will appear here as you progress.", style: { fontSize: ".84rem", marginTop: "10px" } }));
      return;
    }

    if (state.patient) {
      summary.appendChild(
        h("div.row", { style: { marginTop: "12px", gap: "10px" } },
          avatar(state.patient.name),
          h("div", {}, h("strong", { text: state.patient.name, style: { fontSize: ".9rem" } }),
            h("div.muted", { text: `${state.patient.code} · ${state.patient.phone || ""}`, style: { fontSize: ".76rem" } })))
      );
    }

    if (items.length) {
      const list = h("div.summary-items", { style: { marginTop: "14px" } });
      items.forEach((product) => {
        list.appendChild(
          h("div.summary-item", {},
            h("span.grow", {}, h("strong", { text: product.name })),
            h("span", { text: money(product.price, store.currency) }),
            h("button.rm", {
              type: "button",
              "aria-label": `Remove ${product.name}`,
              html: "&times;",
              onClick: () => {
                state.products.delete(product.id);
                paintSummary();
                if (state.step === 1) paintPanel();
              },
            }))
        );
      });
      summary.appendChild(list);
    }

    summary.appendChild(h("div.divider"));
    summary.appendChild(h("div.summary-line", {}, h("span", { text: `Subtotal (${items.length} items)` }), h("strong", { text: money(subtotal, store.currency) })));
    summary.appendChild(h("div.summary-line", {}, h("span", { text: "Discount" }), h("strong", { text: `− ${money(discount, store.currency)}` })));
    if (state.date && state.slot) {
      summary.appendChild(h("div.summary-line", {}, h("span", { text: "Slot" }),
        h("strong", { text: `${fmtDate(state.date)} · ${state.slot}` })));
    }
    summary.appendChild(h("div.summary-total", {}, h("span", { text: "Payable", style: { fontSize: ".8rem", color: "var(--ink-500)" } }), h("strong", { text: money(total, store.currency) })));
  }

  return { destroy() {} };
}
