import { el, button, ticket, facts, field } from "./primitives.mjs";
import { quote } from "../logic.mjs";

const kindName = kind => (kind === "labour" ? "Labour" : "Material");
const maxQty = kind => (kind === "labour" ? 16 : 10);

function lookupRate(rates, kind, id) {
  return rates[kind === "labour" ? "labour" : "materials"]?.find(rate => rate.id === id);
}

function formatCents(cents, currency) {
  const amount = new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
  return `${currency} ${amount}`;
}

function validateQty(kind, raw) {
  const max = maxQty(kind);
  if (raw === "") return `Enter a whole number from 1 to ${max}.`;
  const qty = Number(raw);
  if (!Number.isInteger(qty)) return `Quantity must be a whole number from 1 to ${max}.`;
  if (qty < 1) return "Quantity must be at least 1.";
  if (qty > max) return `${kindName(kind)} quantity cannot exceed ${max}.`;
  return "";
}

function opt(label, value) {
  return el("option", { value, text: label });
}

export function estimateView(job, rates, state = { lines: [], approval: null, feedback: "" }) {
  if (!Array.isArray(state.lines)) state.lines = [];
  if (!("approval" in state)) state.approval = null;
  if (!("feedback" in state)) state.feedback = "";

  const host = el("div", { className: "hem-estimate-host" });
  const lineErrors = new Map();
  let addError = "";
  let focusKey = "";

  const currency = rates.currency || "CAD";
  const money = cents => formatCents(cents, currency);

  function toDraft() {
    if (state.approval) {
      state.approval = null;
      state.feedback = "Estimate changed; the previous local approval was cleared. Review the new amount before approving again.";
    } else {
      state.feedback = "Draft updated locally.";
    }
  }

  function captureSnapshot(result) {
    return { lines: result.lines.map(line => ({ ...line })), totalCents: result.totalCents };
  }

  function approveEstimate(result) {
    if (!result.lines.length) {
      state.feedback = "Add at least one labour or material line before approving.";
      render("approve-btn");
      return;
    }
    state.approval = captureSnapshot(result);
    state.feedback = `Approved locally for ${money(result.totalCents)} before tax. No message, signature, charge, or job-status change.`;
    render("approve-btn");
  }

  function composer() {
    const form = el("form", { className: "hem-estimate__composer" });
    form.noValidate = true;

    const kindSelect = el("select", { name: "kind" }, [opt("Labour", "labour"), opt("Material", "material")]);
    const itemSelect = el("select", { name: "rate" });
    const qtyInput = el("input", {
      type: "number",
      name: "quantity",
      min: "1",
      max: "16",
      step: "1",
      value: "1",
      inputmode: "numeric"
    });
    qtyInput.setAttribute("data-focus-key", "add-qty");
    qtyInput.required = true;

    const rateNote = el("p", { className: "hem-estimate__rate-note", text: "" });
    const error = el("p", { className: "hem-error", role: "alert", text: addError });
    error.hidden = !addError;

    function syncRates() {
      const catalog = rates[kindSelect.value === "labour" ? "labour" : "materials"] || [];
      const prev = itemSelect.value;
      itemSelect.replaceChildren(...catalog.map(rate => opt(rate.label, rate.id)));
      if (catalog.some(rate => rate.id === prev)) itemSelect.value = prev;
      else if (catalog[0]) itemSelect.value = catalog[0].id;

      const max = maxQty(kindSelect.value);
      qtyInput.max = String(max);
      const selected = catalog.find(rate => rate.id === itemSelect.value);
      rateNote.textContent = selected
        ? `${selected.unit} · ${money(selected.unitCents)} per ${kindName(kindSelect.value).toLowerCase()} unit`
        : "No stocked rate is available for this kind.";
    }

    function showAddError(message) {
      addError = message;
      error.textContent = message;
      error.hidden = !message;
      if (message) {
        qtyInput.setAttribute("aria-invalid", "true");
        qtyInput.focus();
      } else {
        qtyInput.removeAttribute("aria-invalid");
      }
    }

    kindSelect.addEventListener("change", () => { showAddError(""); syncRates(); });
    itemSelect.addEventListener("change", () => showAddError(""));
    form.addEventListener("submit", event => {
      event.preventDefault();
      const kind = kindSelect.value;
      const message = validateQty(kind, qtyInput.value);
      if (message || !itemSelect.value) {
        showAddError(message || "Choose a stocked rate before adding a line.");
        return;
      }
      state.lines.push({ kind, id: itemSelect.value, quantity: Number(qtyInput.value) });
      lineErrors.clear();
      addError = "";
      toDraft();
      render("add-qty");
    });

    syncRates();
    form.append(
      field({ id: `${job.id}-est-kind`, label: "Line type", control: kindSelect }),
      field({ id: `${job.id}-est-rate`, label: "Stocked rate", control: itemSelect }),
      field({
        id: `${job.id}-est-add-qty`,
        label: "Quantity",
        control: qtyInput,
        help: "Labour: 1–16 units of 15 minutes. Materials: 1–10 units."
      }),
      rateNote,
      error,
      button("Add line", () => form.requestSubmit())
    );
    return form;
  }

  function lineList(result) {
    const list = el("div", { className: "hem-estimate__lines" });
    if (!result.lines.length) {
      list.append(el("p", {
        className: "hem-estimate__empty",
        text: "No lines yet. Add the bench work or materials needed for this repair."
      }));
      return list;
    }

    result.lines.forEach((line, index) => {
      const rate = lookupRate(rates, line.kind, line.id);
      const qtyInput = el("input", {
        type: "number",
        min: "1",
        max: String(maxQty(line.kind)),
        step: "1",
        value: String(line.quantity),
        inputmode: "numeric"
      });
      qtyInput.setAttribute("data-focus-key", `line-${index}`);
      const err = el("span", { className: "hem-error", role: "alert", text: lineErrors.get(index) || "" });
      err.hidden = !lineErrors.has(index);

      qtyInput.addEventListener("change", () => {
        const message = validateQty(line.kind, qtyInput.value);
        if (message) {
          lineErrors.set(index, message);
          qtyInput.setAttribute("aria-invalid", "true");
          err.textContent = message;
          err.hidden = false;
          return;
        }
        lineErrors.delete(index);
        state.lines[index].quantity = Number(qtyInput.value);
        toDraft();
        focusKey = `line-${index}`;
        render();
      });

      const qtyField = field({
        id: `${job.id}-est-line-${index}`,
        label: `Quantity for ${rate.label}`,
        control: qtyInput,
        help: line.kind === "labour" ? "15 minutes per unit; maximum 16." : "Stocked units; maximum 10."
      });
      qtyField.classList.add("hem-estimate__quantity-field");
      qtyField.append(err);

      list.append(el("div", {
        className: "hem-estimate__line",
        role: "group",
        "aria-label": `${kindName(line.kind)} line: ${rate.label}`
      }, [
        el("div", { className: "hem-estimate__line-title" }, [
          el("span", { className: "hem-estimate__kind", text: kindName(line.kind) }),
          el("strong", { text: rate.label })
        ]),
        qtyField,
        facts([
          ["Unit", `${money(line.unitCents)} / ${rate.unit}`],
          ["Extended", money(line.totalCents)]
        ]),
        button(`Remove ${rate.label}`, () => {
          state.lines.splice(index, 1);
          lineErrors.clear();
          toDraft();
          render();
        }, { variant: "quiet" })
      ]));
    });
    return list;
  }

  function approvalPanel() {
    if (!state.approval) return null;

    const items = el("ul", { className: "hem-estimate__snapshot-lines" });
    state.approval.lines.forEach(line => {
      const rate = lookupRate(rates, line.kind, line.id);
      items.append(el("li", {}, [
        el("span", { text: `${rate.label} × ${line.quantity}` }),
        el("strong", { text: money(line.totalCents) })
      ]));
    });

    const reviseBtn = button("Revise estimate", () => {
      state.approval = null;
      state.feedback = "Estimate returned to draft. Review the lines, then approve the new snapshot locally.";
      render("approve-btn");
    }, { variant: "quiet" });
    reviseBtn.setAttribute("data-focus-key", "approve-btn");

    return el("aside", { className: "hem-estimate__approval", "aria-label": "Local approval snapshot" }, [
      el("div", { className: "hem-estimate__approval-heading" }, [
        el("h3", { text: "Approved snapshot" }),
        el("span", { className: "hem-estimate__local-mark", text: "Local only" })
      ]),
      el("p", { text: "These line items and this total were captured in the current page session." }),
      items,
      facts([
        ["Lines", String(state.approval.lines.length)],
        ["Total before tax", money(state.approval.totalCents)]
      ]),
      el("p", { className: "hem-help", text: "No message, signature, charge, or change to the job status is made." }),
      reviseBtn
    ]);
  }

  function build() {
    let result;
    let calcError = "";
    try {
      result = quote(state.lines, rates);
    } catch (err) {
      calcError = err instanceof Error ? err.message : "The estimate could not be calculated.";
      result = { lines: [], totalCents: 0 };
    }

    const status = state.approval ? "approved" : "draft";
    const frame = ticket("Estimate / local", status, [
      el("h2", { text: "Bench estimate" }),
      el("p", {
        className: "hem-estimate__intro",
        text: "Assemble the work from the workshop rate card. Labour is counted in 15-minute units; tax is excluded."
      }),
      el("p", { className: "hem-help", text: rates.notice }),
      facts([["Currency", currency], ["Job status", job.status]]),
      el("p", {
        className: "hem-estimate__feedback",
        role: "status",
        "aria-live": "polite",
        text: calcError || state.feedback || "Draft estimate; add lines when the bench work is clear."
      }),
      approvalPanel(),
      el("h3", { text: "Current lines" }),
      lineList(result),
      el("div", { className: "hem-estimate__summary" }, [
        el("div", { className: "hem-estimate__total" }, [
          el("span", { text: "Total before tax" }),
          el("strong", { text: money(result.totalCents) })
        ]),
        ...(state.approval ? [el("p", {
          className: "hem-help",
          text: "Approved locally. Revise or change a line to create a new draft."
        })] : [])
      ]),
      el("h3", { text: "Add a line" }),
      composer()
    ].filter(Boolean));
    frame.classList.add("hem-estimate");

    if (!state.approval) {
      const summary = frame.querySelector(".hem-estimate__summary");
      const approveBtn = button("Approve estimate locally", () => approveEstimate(result), {
        disabled: !result.lines.length
      });
      approveBtn.setAttribute("data-focus-key", "approve-btn");
      approveBtn.setAttribute("aria-describedby", `${job.id}-est-approve-help`);
      summary.append(
        approveBtn,
        el("p", {
          id: `${job.id}-est-approve-help`,
          className: "hem-help",
          text: result.lines.length
            ? "Approval captures these displayed lines and total in this page session."
            : "Approval becomes available after at least one line is added."
        })
      );
    }
    return frame;
  }

  function render(nextFocus = focusKey) {
    focusKey = "";
    host.replaceChildren(build());
    if (nextFocus) host.querySelector(`[data-focus-key="${nextFocus}"]`)?.focus();
  }

  render();
  return host;
}
