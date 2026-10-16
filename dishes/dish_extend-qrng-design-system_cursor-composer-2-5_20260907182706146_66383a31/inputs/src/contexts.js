import { ActionButton, Surface } from "./components.js";
import { LotteryBoard } from "./lottery-board.js";

// The state markup is repeated here. The continuation should judge whether it earns a primitive.
const status = (text) => {
  const mark = document.createElement("span");
  mark.className = "status";
  mark.textContent = text;
  return mark;
};

export function Overview() {
  const panel = Surface({ kicker: "live pot", title: "Current bid", description: "Local demo state, made to read like the original paper ledger." });
  panel.append(status("● lottery open"));
  const amount = document.createElement("p");
  amount.id = "current-bid";
  amount.textContent = "Ξ 553";
  panel.append(amount, status("◈ demo wallet connected"));
  return panel;
}

export function Setup({ onApproved, onRejected } = {}) {
  const panel = document.createElement("div");
  const approval = Surface({ kicker: "counter 01", title: "Wallet approval", description: "A deterministic local approval panel; no wallet or contract is connected." });
  const decision = status("○ choose five numbers first");
  const approve = ActionButton({ label: "Approve" });
  const reject = ActionButton({ label: "Reject", quiet: true });
  approve.disabled = true;
  approval.append(decision, reject, approve);
  const board = LotteryBoard({ onSubmit: (numbers) => {
    decision.textContent = `◈ approve ${numbers.join(", ")}`;
    approve.disabled = false;
    approve.dataset.numbers = numbers.join(",");
  } });
  approve.addEventListener("click", () => onApproved?.(approve.dataset.numbers.split(",").map(Number)));
  reject.addEventListener("click", () => {
    decision.textContent = "× approval rejected — numbers remain punched";
    onRejected?.();
  });
  panel.append(board, approval);
  return panel;
}

export function Inspection({ numbers = [3, 12, 19, 27, 44], state = "receipt ready" } = {}) {
  const panel = Surface({ kicker: "transaction rail", title: "Ticket receipt", description: "A local record only; TicketEntered describes the simulated receipt state." });
  panel.append(status(`◈ ${state}`));
  const values = document.createElement("dl");
  values.className = "receipt-values";
  values.innerHTML = `<div><dt>Event</dt><dd>TicketEntered</dd></div><div><dt>Numbers</dt><dd>${numbers.join(" · ")}</dd></div><div><dt>Tickets</dt><dd>2</dd></div><div><dt>Contract</dt><dd>0x690B...2Eee</dd></div>`;
  panel.append(values);
  return panel;
}
