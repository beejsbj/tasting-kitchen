export function el(tag, { text, className, ...attributes } = {}, children = []) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  node.append(...children);
  return node;
}
export function button(label, onClick, { variant = "solid", disabled = false } = {}) {
  const node = el("button", { type: "button", className: "hem-button", "data-variant": variant, text: label });
  node.disabled = disabled;
  node.addEventListener("click", onClick);
  return node;
}
export function tag(label, tone = "queued") {
  return el("span", { className: "hem-tag", "data-tone": tone, text: label });
}
export function ticket(label, status, children) {
  return el("section", { className: "hem-ticket" }, [el("div", { className: "hem-ticket__label" }, [el("span", { text: label }), tag(status, status)]), ...children]);
}
export function field({ id, label, control, help = "" }) {
  control.id = id;
  const children = [el("label", { for: id, text: label }), control];
  if (help) {
    control.setAttribute("aria-describedby", `${id}-help`);
    children.push(el("span", { id: `${id}-help`, className: "hem-help", text: help }));
  }
  return el("div", { className: "hem-field" }, children);
}
export function facts(entries) {
  return el("dl", { className: "hem-kv" }, entries.flatMap(([label, value]) => [el("dt", { text: label }), el("dd", { text: value })]));
}
