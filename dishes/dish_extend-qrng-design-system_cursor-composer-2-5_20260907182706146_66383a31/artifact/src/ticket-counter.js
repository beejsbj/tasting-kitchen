import { Surface } from "./components.js";

export function TicketCounter({ value = 1, onChange } = {}) {
  const panel = Surface({
    kicker: "counter 01",
    title: "Buy your Tickets",
    description: "Local ticket count for the next wallet approval.",
  });
  panel.classList.add("ticket-card");

  let count = Math.min(10, Math.max(1, value));
  const counter = document.createElement("div");
  counter.className = "ticket-counter";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "minus button attention-voice";
  minus.setAttribute("aria-label", "Remove one ticket");
  minus.textContent = "﹣";

  const box = document.createElement("p");
  box.className = "ticket-box loud-voice";
  const amount = document.createElement("span");
  amount.textContent = String(count);
  const label = document.createElement("small");
  label.textContent = "tickets";
  box.append(amount, label);

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "plus button attention-voice";
  plus.setAttribute("aria-label", "Add one ticket");
  plus.textContent = "＋";

  const limit = document.createElement("p");
  limit.className = "ticket-limit";
  limit.textContent = "max 10 per wallet approval";

  const sync = () => {
    amount.textContent = String(count);
    minus.classList.toggle("disabled", count <= 1);
    minus.disabled = count <= 1;
    plus.classList.toggle("disabled", count >= 10);
    plus.disabled = count >= 10;
    onChange?.(count);
  };

  minus.addEventListener("click", () => {
    if (count <= 1) return;
    count -= 1;
    sync();
  });
  plus.addEventListener("click", () => {
    if (count >= 10) return;
    count += 1;
    sync();
  });

  counter.append(minus, box, plus);
  panel.append(counter, limit);
  sync();

  panel.getCount = () => count;
  panel.setCount = (next) => {
    count = Math.min(10, Math.max(1, next));
    sync();
  };

  return panel;
}
