import { ActionButton, StatusMark, Surface } from "./components.js";
import { LotteryBoard } from "./lottery-board.js";
import { PastWinners } from "./past-winners.js";
import { TicketCounter } from "./ticket-counter.js";

const SAMPLE = {
  potEth: "553",
  wallet: "0x71c2...94e8",
  contract: "0x690B...2Eee",
};

export function Overview() {
  const stack = document.createElement("div");
  stack.className = "overview-stack";

  const panel = Surface({
    kicker: "live pot",
    title: "Current bid",
    description: "Local demo state, made to read like the original paper ledger.",
  });
  panel.classList.add("bid-card");
  panel.append(StatusMark("● lottery open"));
  const amount = document.createElement("p");
  amount.id = "current-bid";
  amount.textContent = `Ξ ${SAMPLE.potEth}`;
  panel.append(amount, StatusMark(`◈ demo wallet ${SAMPLE.wallet}`));

  stack.append(panel, PastWinners());
  return stack;
}

export function Setup({ onApproved, onRejected, onPending } = {}) {
  const panel = document.createElement("div");
  panel.className = "setup-stack";

  let pendingNumbers = null;
  const tickets = TicketCounter({
    value: 2,
    onChange: (count) => {
      if (pendingNumbers) onPending?.({ numbers: pendingNumbers, tickets: count });
    },
  });

  const approval = Surface({
    kicker: "wallet rail",
    title: "Wallet approval",
    description: "A deterministic local approval panel; no wallet or contract is connected.",
  });
  approval.classList.add("approval-card");
  const decision = StatusMark("○ choose five numbers first");
  const approve = ActionButton({ label: "Approve", disabled: true });
  const reject = ActionButton({ label: "Reject", quiet: true });

  const board = LotteryBoard({
    onSubmit: (numbers) => {
      pendingNumbers = numbers;
      decision.textContent = `◈ approve ${numbers.join(", ")} · ${tickets.getCount()} tickets`;
      approve.disabled = false;
      onPending?.({ numbers, tickets: tickets.getCount() });
    },
  });

  approve.addEventListener("click", () => {
    if (!pendingNumbers) return;
    decision.textContent = `● TicketEntered — ${pendingNumbers.join(", ")}`;
    onApproved?.({ numbers: pendingNumbers, tickets: tickets.getCount() });
  });

  reject.addEventListener("click", () => {
    decision.textContent = "× approval rejected — numbers remain punched";
    onRejected?.({ numbers: pendingNumbers, tickets: tickets.getCount() });
  });

  const actions = document.createElement("div");
  actions.className = "wallet-actions";
  actions.append(reject, approve);
  approval.append(decision, actions);

  panel.append(board, tickets, approval);
  return panel;
}

export function Inspection({
  numbers = [3, 12, 19, 27, 44],
  tickets = 2,
  state = "receipt ready",
  visible = true,
} = {}) {
  const panel = Surface({
    kicker: "transaction rail",
    title: "Ticket receipt",
    description: "A local record only; TicketEntered describes the simulated receipt state.",
  });
  panel.classList.add("receipt-card");
  if (!visible) panel.classList.add("receipt-card--idle");

  panel.append(StatusMark(`◈ ${state}`));

  const values = document.createElement("dl");
  values.className = "receipt-values";
  const eventLabel = state === "TicketEntered" ? "TicketEntered" : state === "approval rejected" ? "Rejected" : "—";
  const rows = [
    ["Event", eventLabel],
    ["Numbers", numbers.join(" · ")],
    ["Tickets", String(tickets)],
    ["Contract", SAMPLE.contract],
  ];
  for (const [term, detail] of rows) {
    const row = document.createElement("div");
    row.append(
      Object.assign(document.createElement("dt"), { textContent: term }),
      Object.assign(document.createElement("dd"), { textContent: detail }),
    );
    values.append(row);
  }
  panel.append(values);
  return panel;
}
