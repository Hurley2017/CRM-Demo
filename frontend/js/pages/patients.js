/* Patients — search, register, quick grid. */

import { api } from "../api.js";
import { store } from "../store.js";
import { h, mount, clear, debounce, fmtDate, esc, initials } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast, loadingState, openModal, emptyState, confirmAction } from "../ui/feedback.js";
import { searchBox, avatar, pagination, pill, dataTable } from "../ui/widgets.js";

export async function render(container) {
  const state = { q: "", page: 1, perPage: 12, loading: true };
  const grid = h("div.product-grid");
  const pagerHost = h("div", { style: { marginTop: "16px" } });
  const countLabel = h("span.muted", { style: { fontSize: ".82rem" } });

  const search = searchBox({
    placeholder: "Search by name, phone, code or email…",
    onInput: debounce((value) => {
      state.q = value;
      state.page = 1;
      load();
    }, 300),
    onClear: () => { state.q = ""; load(); },
  });

  mount(
    container,
    h(
      "div.page-head",
      {},
      h("div", {}, h("h2", { text: "Patients" }), h("p", { text: "Search the registry or register a new walk-in." })),
      h("div.page-actions", {},
        store.can("patients.edit")
          ? h("button.btn.btn-primary", { type: "button", onClick: () => openRegister(() => load()) },
              icon("user-plus", 16), "Register patient")
          : null)
    ),
    h("div.toolbar", {}, search.element, countLabel),
    grid,
    pagerHost
  );

  await load();

  async function load() {
    if (state.loading) mount(grid, skeletons());
    try {
      const data = await api.get("/api/patients", {
        params: { q: state.q, page: state.page, per_page: state.perPage },
      });
      state.loading = false;
      countLabel.textContent = `${data.total.toLocaleString("en-IN")} patients`;

      clear(grid);
      if (!data.items.length) {
        grid.style.gridTemplateColumns = "1fr";
        grid.appendChild(emptyState({
          title: state.q ? `No patients match “${state.q}”` : "No patients yet",
          message: state.q ? "Check the spelling or register a new patient." : "Register your first patient to get started.",
          actionLabel: store.can("patients.edit") ? "Register patient" : null,
          onAction: () => openRegister(() => load()),
          iconName: "users",
        }));
      } else {
        grid.style.gridTemplateColumns = "";
        data.items.forEach((patient) => grid.appendChild(patientCard(patient)));
      }

      clear(pagerHost);
      pagerHost.appendChild(
        pagination({
          page: data.page,
          pages: data.pages,
          total: data.total,
          perPage: data.per_page,
          label: "patients",
          onPage: (page) => { state.page = page; load(); },
          onPerPage: (perPage) => { state.perPage = perPage; state.page = 1; load(); },
        })
      );
    } catch (error) {
      state.loading = false;
      toast.error("Could not load patients", error.message);
    }
  }

  function patientCard(patient) {
    return h(
      "div.patient-card",
      { onClick: () => (location.hash = `#/patients/${patient.id}`) },
      avatar(patient.name),
      h(
        "div.pc-main",
        {},
        h("strong", { text: patient.name }),
        h("span", { text: `${patient.code} · ${patient.gender || "other"} · ${patient.age ?? "—"} yrs` }),
        h("span", { text: patient.phone || "—" })
      ),
      h(
        "div.pc-meta",
        {},
        h("strong", { text: String(patient.total_bookings) }),
        h("span", { text: patient.last_visit ? `last ${fmtDate(patient.last_visit)}` : "no visits" }),
        patient.active ? null : pill("inactive", "pill-cancelled")
      )
    );
  }

  function skeletons() {
    return Array.from({ length: 8 }, () =>
      h(
        "div.patient-card",
        { style: { pointerEvents: "none" } },
        h("div.skeleton", { style: { width: "44px", height: "44px", borderRadius: "50%" } }),
        h(
          "div.grow",
          {},
          h("div.skeleton", { style: { height: "13px", width: "55%" } }),
          h("div.skeleton", { style: { height: "11px", width: "35%", marginTop: "7px" } })
        )
      )
    );
  }
}

export function openRegister(onDone, prefill = {}) {
  const name = h("input.input", { placeholder: "Full name", value: prefill.name || "" });
  const phone = h("input.input", { placeholder: "+91 98XXXXXXXX", value: prefill.phone || "" });
  const email = h("input.input", { type: "email", placeholder: "email@example.com" });
  const gender = h("select.select", {},
    h("option", { value: "female", text: "Female", selected: prefill.gender === "female" }),
    h("option", { value: "male", text: "Male", selected: prefill.gender === "male" }),
    h("option", { value: "other", text: "Other", selected: prefill.gender === "other" }));
  const dob = h("input.input", { type: "date" });
  const blood = h("select.select", {},
    h("option", { value: "", text: "Unknown" }),
    ...["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((group) => h("option", { value: group, text: group })));
  const address = h("input.input", { placeholder: "House / street, area" });
  const city = h("input.input", { placeholder: "Kolkata" });
  const allergies = h("input.input", { placeholder: "e.g. Penicillin, dust" });
  const notes = h("textarea.textarea", { rows: "2", placeholder: "Medical notes, referrer…" });
  const alertBox = h("div.form-alert", { hidden: true });

  openModal({
    title: "Register patient",
    subtitle: "Minimum: name and phone number",
    size: "lg",
    body: h(
      "div.form-grid",
      {},
      h("label.field", {}, h("span", {}, "Full name", h("span", { text: " *", style: { color: "var(--danger-500)" } })), name),
      h("label.field", {}, h("span", {}, "Phone", h("span", { text: " *", style: { color: "var(--danger-500)" } })), phone),
      h("label.field", {}, h("span", { text: "Email" }), email),
      h("label.field", {}, h("span", { text: "Gender" }), gender),
      h("label.field", {}, h("span", { text: "Date of birth" }), dob),
      h("label.field", {}, h("span", { text: "Blood group" }), blood),
      h("label.field", {}, h("span", { text: "Address" }), address),
      h("label.field", {}, h("span", { text: "City" }), city),
      h("label.field", {}, h("span", { text: "Allergies" }), allergies),
      h("label.field", {}, h("span", { text: "Notes" }), notes),
      h("div.span-2", {}, alertBox)
    ),
    footer: (close) => [
      h("button.btn.btn-outline", { type: "button", text: "Cancel", onClick: () => close() }),
      h("button.btn.btn-primary", {
        type: "button",
        text: "Register patient",
        onClick: async (event) => {
          const button = event.currentTarget;
          button.classList.add("loading");
          try {
            const result = await api.post("/api/patients", {
              name: name.value.trim(),
              phone: phone.value.trim(),
              email: email.value.trim(),
              gender: gender.value,
              dob: dob.value || null,
              blood_group: blood.value,
              address: address.value.trim(),
              city: city.value.trim(),
              allergies: allergies.value.trim(),
              notes: notes.value.trim(),
            });
            close();
            toast.success("Patient registered", `${result.name} · ${result.code}`);
            onDone?.(result);
          } catch (error) {
            button.classList.remove("loading");
            if (error.status === 409 && error.payload?.error?.patient) {
              const existing = error.payload.error.patient;
              alertBox.hidden = false;
              alertBox.innerHTML = `<span>${esc(error.message)}</span>`;
              alertBox.insertAdjacentHTML(
                "beforeend",
                `<div style="margin-top:8px"><button class="btn btn-sm btn-outline" id="open-dup">Open ${esc(existing.name)}</button></div>`
              );
              alertBox.querySelector("#open-dup")?.addEventListener("click", () => {
                close();
                location.hash = `#/patients/${existing.id}`;
              });
            } else {
              alertBox.hidden = false;
              alertBox.innerHTML = `<span>${esc(error.message)}</span>`;
            }
          }
        },
      }),
    ],
  });
}
