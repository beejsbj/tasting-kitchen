import { el, button, ticket, facts, field, tag } from "./primitives.mjs";

export function queueView(jobs, onOpen) {
  return el("div", {}, jobs.map(job => ticket(job.id, job.status, [
    el("h2", { text: job.item }),
    el("p", { text: job.work }),
    facts([["Due", job.due], ["Customer", job.owner]]),
    button(`Open ${job.id}`, () => onOpen(job.id), { variant: "quiet" })
  ])));
}
export function jobView(job, onBack) {
  return el("div", {}, [button("Back to queue", onBack, { variant: "quiet" }), ticket(job.id, job.status, [
    el("h2", { text: job.item }), facts([["Customer", job.owner], ["Due", job.due], ["Condition", job.condition]]),
    el("h3", { text: "Bench note" }), el("p", { text: job.work })
  ])]);
}
export function materialsView(rates) {
  return el("div", {}, rates.materials.map(item => ticket(item.id, "stock item", [
    el("h2", { text: item.label }), el("p", { text: item.note }),
    facts([["Unit", item.unit], ["CAD", (item.unitCents / 100).toFixed(2)]])
  ])));
}
export function specimenView() {
  const note = el("input", { type: "text", placeholder: "Sample bench note" });
  const feedback = el("p", { role: "status", text: "Specimen only; no job is changed." });
  return ticket("Hem / primitives", "reference", [
    el("h2", { text: "A label, a seam, a working surface" }),
    el("p", {}, [tag("queued"), document.createTextNode(" "), tag("in-progress", "in-progress"), document.createTextNode(" "), tag("ready", "ready")]),
    field({ id: "sample-note", label: "Bench note", control: note, help: "Labels remain visible when the field has a value." }),
    button("Try action", () => { feedback.textContent = note.value.trim() ? `Sample: ${note.value.trim()}` : "Write a sample note first."; }),
    document.createTextNode(" "), button("Unavailable", () => {}, { disabled: true }), feedback
  ]);
}
