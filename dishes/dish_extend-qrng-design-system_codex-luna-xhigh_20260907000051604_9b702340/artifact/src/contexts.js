import { ActionButton, PastWinners, Status, Surface, TicketCard, node } from "./components.js";
import { LotteryBoard, SAMPLE_NUMBERS } from "./lottery-board.js";

const DEFAULT_TICKETS = 2;

export function Overview() {
  const stack = node("div", "overview-stack");
  const panel = Surface({
    kicker: "live pot",
    title: "Current bid",
    description: "A local paper-slip specimen. The field is deliberately loud; the state stays inspectable.",
    className: "pot-card",
  });
  const amount = node("p", "current-bid", "Ξ 553");
  amount.setAttribute("aria-label", "Current pot: 553 demo ETH");
  const state = Status({ text: "demo wallet · local only", tone: "local", symbol: "◈" });
  const details = node("dl", "overview-details");
  [
    ["week", "12 / open"],
    ["entry", "0.001 ETH / ticket"],
    ["source", "browser state"],
  ].forEach(([term, value]) => {
    const row = node("div", "overview-detail");
    row.append(node("dt", "mono-label", term), node("dd", "overview-detail__value", value));
    details.append(row);
  });
  panel.append(amount, state, details);
  stack.append(panel, PastWinners());
  return stack;
}

export function Setup({ onApproved, onRejected } = {}) {
  const wrapper = node("div", "setup-context");
  let pendingNumbers = [];
  let ticketAmount = DEFAULT_TICKETS;
  const approval = Surface({
    kicker: "counter 02",
    title: "Wallet approval",
    description: "A deterministic local approval panel. Nothing leaves this browser.",
    className: "approval-card",
  });
  const decision = Status({ text: "choose five numbers first", tone: "neutral", symbol: "○" });
  const approvalSummary = node("dl", "approval-summary");
  const numbersValue = node("dd", "approval-summary__value", "—");
  const ticketsValue = node("dd", "approval-summary__value", String(DEFAULT_TICKETS));
  addDefinition(approvalSummary, "numbers", numbersValue);
  addDefinition(approvalSummary, "tickets", ticketsValue);
  const actions = node("div", "approval-actions");
  const reject = ActionButton({ label: "Reject", quiet: true, className: "reject" });
  const approve = ActionButton({ label: "Approve", className: "approve", disabled: true });
  actions.append(reject, approve);
  approval.append(decision, approvalSummary, actions);

  const ticket = TicketCard({
    initial: DEFAULT_TICKETS,
    onChange: (amount) => {
      ticketAmount = amount;
      ticketsValue.textContent = String(amount);
      if (pendingNumbers.length === 5) {
        decision.update({ text: `approve ${pendingNumbers.join(", ")} · ${amount} tickets`, tone: "pending", symbol: "◈" });
      }
    },
  });

  const board = LotteryBoard({
    onSubmit: (numbers) => {
      pendingNumbers = numbers;
      numbersValue.textContent = numbers.join(" · ");
      decision.update({ text: `approve ${numbers.join(", ")} · ${ticketAmount} tickets`, tone: "pending", symbol: "◈" });
      approve.disabled = false;
    },
  });

  approve.addEventListener("click", () => {
    if (pendingNumbers.length !== 5) return;
    decision.update({ text: "TicketEntered · receipt ready", tone: "ready", symbol: "✦" });
    onApproved?.([...pendingNumbers], ticketAmount);
  });
  reject.addEventListener("click", () => {
    decision.update({ text: "approval rejected · numbers remain punched", tone: "rejected", symbol: "×" });
    onRejected?.([...pendingNumbers], ticketAmount);
  });

  const side = node("div", "setup-side");
  side.append(ticket, approval);
  wrapper.append(board, side);
  return wrapper;
}

export function Inspection({ numbers = SAMPLE_NUMBERS, tickets = DEFAULT_TICKETS, state = "receipt ready" } = {}) {
  const panel = Surface({
    kicker: "transaction rail",
    title: "Ticket receipt",
    description: "An inspectable browser record. TicketEntered is local state, not a chain event.",
    className: "inspection-card",
  });
  const status = Status({ text: state === "receipt ready" ? "receipt ready · TicketEntered" : state, tone: state === "receipt ready" ? "ready" : "rejected", symbol: state === "receipt ready" ? "✦" : "×" });
  const values = node("dl", "receipt-values");
  panel.append(status, values);

  const updateReceipt = ({ nextNumbers = numbers, nextTickets = tickets, nextState = "receipt ready" } = {}) => {
    const ready = nextState === "receipt ready";
    status.update({
      text: ready ? "receipt ready · TicketEntered" : nextState,
      tone: ready ? "ready" : "rejected",
      symbol: ready ? "✦" : "×",
    });
    values.replaceChildren();
    [
      ["event", ready ? "TicketEntered" : "No event — rejected"],
      ["numbers", nextNumbers.length ? nextNumbers.join(" · ") : "—"],
      ["tickets", String(nextTickets)],
      ["receipt", ready ? "local-p5-001" : "local-p5-rejected"],
      ["route", "browser only"],
    ].forEach(([term, value]) => addDefinition(values, term, node("dd", "receipt-values__value", value)));
    panel.dataset.receiptState = ready ? "ready" : "rejected";
  };
  panel.updateReceipt = updateReceipt;
  updateReceipt({ nextNumbers: numbers, nextTickets: tickets, nextState: state });
  return panel;
}

function addDefinition(list, term, value) {
  const row = node("div", "definition-row");
  row.append(node("dt", "mono-label", term), value);
  list.append(row);
}
