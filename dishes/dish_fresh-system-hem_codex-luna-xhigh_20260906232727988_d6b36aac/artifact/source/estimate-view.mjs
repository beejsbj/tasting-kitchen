import { el, button, ticket, facts, field } from "./primitives.mjs";
import { quote } from "../logic.mjs";

const kindLabel = kind => kind === "labour" ? "Labour" : "Material";
const maximumFor = kind => kind === "labour" ? 16 : 10;

function rateFor(rates, kind, id) {
  return rates[kind === "labour" ? "labour" : "materials"]?.find(rate => rate.id === id);
}

function money(cents, currency) {
  const formatted = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency
  }).format(cents / 100);
  return `${currency} ${formatted}`;
}

function quantityError(kind, rawQuantity) {
  const maximum = maximumFor(kind);
  if (rawQuantity === "") return `Enter a whole number from 1 to ${maximum}.`;
  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity)) return `Quantity must be a whole number from 1 to ${maximum}.`;
  if (quantity < 1) return `Quantity must be at least 1.`;
  if (quantity > maximum) return `${kindLabel(kind)} quantity cannot exceed ${maximum}.`;
  return "";
}

function option(label, value) {
  return el("option", { value, text: label });
}

export function estimateView(job, rates, state = { lines: [], approval: null, feedback: "" }) {
  if (!Array.isArray(state.lines)) state.lines = [];
  if (!("approval" in state)) state.approval = null;
  if (!("feedback" in state)) state.feedback = "";

  const host = el("div", { className: "hem-estimate-host" });
  const lineErrors = new Map();
  let addError = "";
  let pendingFocus = "";

  const formatMoney = cents => money(cents, rates.currency || "CAD");

  function markDraft() {
    if (state.approval) {
      state.approval = null;
      state.feedback = "Estimate changed; the previous local approval was cleared. Review the new amount before approving again.";
    } else {
      state.feedback = "Draft updated locally.";
    }
  }

  function snapshotFor(result) {
    return {
      lines: result.lines.map(line => ({ ...line })),
      totalCents: result.totalCents
    };
  }

  function approve(result) {
    if (!result.lines.length) {
      state.feedback = "Add at least one labour or material line before approving.";
      render("approval-action");
      return;
    }
    state.approval = snapshotFor(result);
    state.feedback = `Approved locally for ${formatMoney(result.totalCents)} before tax. No message, signature, charge, or job-status change.`;
    render("approval-action");
  }

  function buildComposer() {
    const composer = el("form", { className: "hem-estimate__composer" });
    composer.noValidate = true;

    const kindSelect = el("select", { name: "kind" }, [
      option("Labour", "labour"),
      option("Material", "material")
    ]);
    const itemSelect = el("select", { name: "rate" });
    const quantityInput = el("input", {
      type: "number",
      name: "quantity",
      min: "1",
      max: String(maximumFor("labour")),
      step: "1",
      value: "1",
      inputmode: "numeric"
    });
    quantityInput.setAttribute("data-focus-key", "add-quantity");
    quantityInput.required = true;

    const rateNote = el("p", { className: "hem-estimate__rate-note", text: "" });
    const error = el("p", { className: "hem-error", role: "alert", text: addError });
    error.hidden = !addError;

    function syncRateOptions() {
      const catalog = rates[kindSelect.value === "labour" ? "labour" : "materials"] || [];
      const oldId = itemSelect.value;
      itemSelect.replaceChildren(...catalog.map(rate => option(rate.label, rate.id)));
      if (catalog.some(rate => rate.id === oldId)) itemSelect.value = oldId;
      if (!itemSelect.value && catalog[0]) itemSelect.value = catalog[0].id;

      const maximum = maximumFor(kindSelect.value);
      quantityInput.max = String(maximum);
      const selectedRate = catalog.find(rate => rate.id === itemSelect.value);
      rateNote.textContent = selectedRate
        ? `${selectedRate.unit} · ${formatMoney(selectedRate.unitCents)} per ${kindLabel(kindSelect.value).toLowerCase()} unit`
        : "No stocked rate is available for this kind.";
    }

    function showError(message) {
      addError = message;
      error.textContent = message;
      error.hidden = !message;
      if (message) {
        quantityInput.setAttribute("aria-invalid", "true");
        quantityInput.focus();
      } else {
        quantityInput.removeAttribute("aria-invalid");
      }
    }

    kindSelect.addEventListener("change", () => {
      showError("");
      syncRateOptions();
    });
    itemSelect.addEventListener("change", () => showError(""));
    composer.addEventListener("submit", event => {
      event.preventDefault();
      const kind = kindSelect.value;
      const message = quantityError(kind, quantityInput.value);
      if (message || !itemSelect.value) {
        showError(message || "Choose a stocked rate before adding a line.");
        return;
      }

      state.lines.push({ kind, id: itemSelect.value, quantity: Number(quantityInput.value) });
      lineErrors.clear();
      addError = "";
      markDraft();
      render("add-quantity");
    });

    syncRateOptions();
    composer.append(
      field({ id: `${job.id}-estimate-kind`, label: "Line type", control: kindSelect }),
      field({ id: `${job.id}-estimate-rate`, label: "Stocked rate", control: itemSelect }),
      field({
        id: `${job.id}-estimate-add-quantity`,
        label: "Quantity",
        control: quantityInput,
        help: "Labour: 1–16 units of 15 minutes. Materials: 1–10 units."
      }),
      rateNote,
      error,
      button("Add line", () => composer.requestSubmit())
    );
    return composer;
  }

  function buildLines(result) {
    const list = el("div", { className: "hem-estimate__lines" });
    if (!result.lines.length) {
      list.append(el("p", {
        className: "hem-estimate__empty",
        text: "No lines yet. Add the bench work or materials needed for this repair."
      }));
      return list;
    }

    result.lines.forEach((line, index) => {
      const rate = rateFor(rates, line.kind, line.id);
      const quantityInput = el("input", {
        type: "number",
        min: "1",
        max: String(maximumFor(line.kind)),
        step: "1",
        value: String(line.quantity),
        inputmode: "numeric"
      });
      quantityInput.setAttribute("data-focus-key", `line-${index}`);
      const error = el("span", { className: "hem-error", role: "alert", text: lineErrors.get(index) || "" });
      error.hidden = !lineErrors.has(index);

      quantityInput.addEventListener("change", () => {
        const message = quantityError(line.kind, quantityInput.value);
        if (message) {
          lineErrors.set(index, message);
          quantityInput.setAttribute("aria-invalid", "true");
          error.textContent = message;
          error.hidden = false;
          return;
        }

        lineErrors.delete(index);
        state.lines[index].quantity = Number(quantityInput.value);
        markDraft();
        pendingFocus = `line-${index}`;
        render();
      });

      const quantityField = field({
        id: `${job.id}-estimate-line-${index}`,
        label: `Quantity for ${rate.label}`,
        control: quantityInput,
        help: line.kind === "labour" ? "15 minutes per unit; maximum 16." : "Stocked units; maximum 10."
      });
      quantityField.classList.add("hem-estimate__quantity-field");
      quantityField.append(error);

      const row = el("div", {
        className: "hem-estimate__line",
        role: "group",
        "aria-label": `${kindLabel(line.kind)} line: ${rate.label}`
      }, [
        el("div", { className: "hem-estimate__line-title" }, [
          el("span", { className: "hem-estimate__kind", text: kindLabel(line.kind) }),
          el("strong", { text: rate.label })
        ]),
        quantityField,
        facts([
          ["Unit", `${formatMoney(line.unitCents)} / ${rate.unit}`],
          ["Extended", formatMoney(line.totalCents)]
        ]),
        button(`Remove ${rate.label}`, () => {
          state.lines.splice(index, 1);
          lineErrors.clear();
          markDraft();
          render();
        }, { variant: "quiet" })
      ]);
      list.append(row);
    });
    return list;
  }

  function buildApproval() {
    if (!state.approval) return null;

    const snapshotLines = el("ul", { className: "hem-estimate__snapshot-lines" });
    state.approval.lines.forEach(line => {
      const rate = rateFor(rates, line.kind, line.id);
      snapshotLines.append(el("li", {}, [
        el("span", { text: `${rate.label} × ${line.quantity}` }),
        el("strong", { text: formatMoney(line.totalCents) })
      ]));
    });

    const revise = button("Revise estimate", () => {
      state.approval = null;
      state.feedback = "Estimate returned to draft. Review the lines, then approve the new snapshot locally.";
      render("approval-action");
    }, { variant: "quiet" });
    revise.setAttribute("data-focus-key", "approval-action");

    return el("aside", {
      className: "hem-estimate__approval",
      "aria-label": "Local approval snapshot"
    }, [
      el("div", { className: "hem-estimate__approval-heading" }, [
        el("h3", { text: "Approved snapshot" }),
        el("span", { className: "hem-estimate__local-mark", text: "Local only" })
      ]),
      el("p", { text: "These line items and this total were captured in the current page session." }),
      snapshotLines,
      facts([
        ["Lines", String(state.approval.lines.length)],
        ["Total before tax", formatMoney(state.approval.totalCents)]
      ]),
      el("p", { className: "hem-help", text: "No message, signature, charge, or change to the job status is made." }),
      revise
    ]);
  }

  function build() {
    let result;
    let calculationError = "";
    try {
      result = quote(state.lines, rates);
    } catch (error) {
      calculationError = error instanceof Error ? error.message : "The estimate could not be calculated.";
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
      facts([
        ["Currency", rates.currency || "CAD"],
        ["Job status", job.status]
      ]),
      el("p", {
        className: "hem-estimate__feedback",
        role: "status",
        "aria-live": "polite",
        text: calculationError || state.feedback || "Draft estimate; add lines when the bench work is clear."
      }),
      buildApproval(),
      el("h3", { text: "Current lines" }),
      buildLines(result),
      el("div", { className: "hem-estimate__summary" }, [
        el("div", { className: "hem-estimate__total" }, [
          el("span", { text: "Total before tax" }),
          el("strong", { text: formatMoney(result.totalCents) })
        ]),
        ...state.approval ? [el("p", { className: "hem-help", text: "Approved locally. Revise or change a line to create a new draft." })] : []
      ]),
      el("h3", { text: "Add a line" }),
      buildComposer()
    ].filter(Boolean));
    frame.classList.add("hem-estimate");

    if (!state.approval) {
      const actions = frame.querySelector(".hem-estimate__summary");
      const approveButton = button("Approve estimate locally", () => approve(result), {
        disabled: !result.lines.length
      });
      approveButton.setAttribute("data-focus-key", "approval-action");
      approveButton.setAttribute("aria-describedby", `${job.id}-estimate-approval-help`);
      const approvalHelp = el("p", {
        id: `${job.id}-estimate-approval-help`,
        className: "hem-help",
        text: result.lines.length
          ? "Approval captures these displayed lines and total in this page session."
          : "Approval becomes available after at least one line is added."
      });
      actions.append(approveButton);
      actions.append(approvalHelp);
    }
    return frame;
  }

  function render(focusKey = pendingFocus) {
    pendingFocus = "";
    host.replaceChildren(build());
    if (focusKey) host.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  render();
  return host;
}
