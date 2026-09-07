const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/**
 * Primitive: paper surface.
 * Root -> header(kicker + title), optional description, slotted children.
 */
export function Surface({ kicker, title, description, className = "" }) {
  const section = node("section", `paper-card ${className}`.trim());
  const header = node("header", "paper-card__header");
  header.append(node("p", "ticket-kicker", kicker), node("h2", "teaser-voice", title));
  section.append(header);
  if (description) section.append(node("p", "paper-card__description", description));
  return section;
}

/**
 * Primitive: stamped action. `quiet` is the only supported tone axis; the
 * board owns its feature-specific roll/submit labels and behavior.
 */
export function ActionButton({ label, quiet = false, className = "", disabled = false }) {
  const classes = ["button", quiet ? "button--quiet" : "", className].filter(Boolean).join(" ");
  const button = node("button", classes, label);
  button.type = "button";
  button.disabled = disabled;
  return button;
}

/**
 * Promoted primitive: repeated state markup needs a symbol and words, not only
 * color. The returned node owns its small update API so consumers do not
 * re-declare the state anatomy.
 */
export function Status({ text, tone = "neutral", symbol = "•", live = true }) {
  const mark = node("span", `status status--${tone}`);
  if (live) mark.setAttribute("aria-live", "polite");
  const glyph = node("span", "status__symbol", symbol);
  glyph.setAttribute("aria-hidden", "true");
  const label = node("span", "status__label", text);
  mark.append(glyph, label);
  mark.update = ({ text: nextText, tone: nextTone = tone, symbol: nextSymbol = symbol }) => {
    label.textContent = nextText;
    glyph.textContent = nextSymbol;
    mark.className = `status status--${nextTone}`;
    if (live) mark.setAttribute("aria-live", "polite");
  };
  return mark;
}

/**
 * Compound: the inherited ticket counter. It owns only 1–10 quantity
 * behavior; approval and receipt orchestration remain in the setup context.
 */
export function TicketCard({ initial = 2, onChange } = {}) {
  let amount = Math.min(10, Math.max(1, Number(initial) || 1));
  const card = Surface({
    kicker: "counter 01",
    title: "Buy your tickets",
    description: "max 10 per wallet approval",
    className: "ticket-card",
  });
  const counter = node("div", "ticket-counter");
  const decrement = ActionButton({ label: "−", quiet: true, className: "counter-button minus" });
  const display = node("p", "ticket-box");
  const amountText = node("span", "ticket-box__amount");
  const amountLabel = node("small", "ticket-box__label", "tickets");
  display.setAttribute("aria-live", "polite");
  display.append(amountText, amountLabel);
  const increment = ActionButton({ label: "+", className: "counter-button plus" });
  decrement.setAttribute("aria-label", "Remove one ticket");
  increment.setAttribute("aria-label", "Add one ticket");
  counter.append(decrement, display, increment);

  const limit = node("p", "ticket-limit", "1–10 tickets · local demo counter");
  card.append(counter, limit);

  const render = () => {
    amountText.textContent = String(amount);
    decrement.disabled = amount <= 1;
    increment.disabled = amount >= 10;
    card.dataset.tickets = String(amount);
  };
  const setAmount = (next) => {
    const bounded = Math.min(10, Math.max(1, Number(next) || 1));
    if (bounded === amount) return;
    amount = bounded;
    render();
    onChange?.(amount);
  };
  decrement.addEventListener("click", () => setAmount(amount - 1));
  increment.addEventListener("click", () => setAmount(amount + 1));
  card.getAmount = () => amount;
  card.setAmount = setAmount;
  render();
  return card;
}

/**
 * Compound: static ledger rows from the upstream PastWinners shape. It is
 * included by Overview so the overview remains a real source composition.
 */
export function PastWinners() {
  const card = Surface({ kicker: "ledger", title: "Past winners", className: "past-card" });
  const list = node("ol", "winner-board");
  const rows = [
    { number: "08", pot: "553", week: "week 3", latest: true },
    { number: "41", pot: "487", week: "week 2" },
    { number: "16", pot: "421", week: "week 1" },
  ];
  rows.forEach((winner, index) => {
    const row = node("li", `winner-row${winner.latest ? " latest" : ""}`);
    row.append(
      node("span", "winner-rank", `#${index + 1}`),
      node("span", "winner-number", winner.number),
      node("span", "winner-pot", `Ξ ${winner.pot}`),
      node("span", "winner-week", winner.week),
    );
    list.append(row);
  });
  card.append(list);
  return card;
}

export { node };
