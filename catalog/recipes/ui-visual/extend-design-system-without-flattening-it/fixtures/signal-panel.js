import { ActionButton, Surface } from "./components.js";

// SignalArc is deliberately feature-local. Its geometry, pointer model, and
// live reading semantics are not a general-purpose visual primitive.
export function SignalArc({ value = 64 } = {}) {
  const root = document.createElement("div");
  root.className = "signal-arc";
  root.dataset.value = String(value);
  root.innerHTML = `<span class="signal-arc__track" aria-hidden="true"></span><strong>${value}%</strong><span>signal confidence</span>`;
  root.tabIndex = 0;
  root.setAttribute("role", "meter");
  root.setAttribute("aria-valuenow", String(value));
  root.setAttribute("aria-valuemin", "0");
  root.setAttribute("aria-valuemax", "100");
  return root;
}

export function SignalPanel() {
  const panel = Surface({ title: "Signal inspection", description: "A feature-local diagnostic view." });
  panel.append(SignalArc(), ActionButton({ label: "Run inspection", quiet: true }));
  return panel;
}
