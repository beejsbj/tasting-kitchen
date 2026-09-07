const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

export function Surface({ kicker, title, description }) {
  const section = node("section", "paper-card");
  const header = node("header", "paper-card__header");
  header.append(node("p", "ticket-kicker", kicker), node("h2", "teaser-voice", title));
  section.append(header);
  if (description) section.append(node("p", "paper-card__description", description));
  return section;
}

export function ActionButton({ label, quiet = false, disabled = false }) {
  const button = node("button", quiet ? "button button--quiet" : "button", label);
  button.type = "button";
  button.disabled = disabled;
  return button;
}

export function StatusMark(text) {
  const mark = node("span", "status", text);
  return mark;
}
