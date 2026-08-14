const element = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
};

export function Surface({ title, description }) {
  const section = element("section", "surface");
  section.append(element("p", "eyebrow", "Northstar"), element("h2", "surface__title", title));
  if (description) section.append(element("p", "surface__description", description));
  return section;
}

export function ActionButton({ label, quiet = false }) {
  const button = element("button", quiet ? "action action--quiet" : "action", label);
  button.type = "button";
  return button;
}

// This single-use composition is intentionally suspect: the continuation
// task should decide whether it earns a system-level name.
export function LabeledValue({ label, value }) {
  const row = element("div", "labeled-value");
  row.append(element("span", "labeled-value__label", label), element("strong", "labeled-value__value", value));
  return row;
}
