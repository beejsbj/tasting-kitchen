import decisions from "./system-decisions.json" with { type: "json" };
import { Inspection, Overview, Setup } from "./src/contexts.js";

const overviewMount = document.querySelector("#overview-mount");
const setupMount = document.querySelector("#setup-mount");
const inspectionMount = document.querySelector("#inspection-mount");
const decisionsMount = document.querySelector("#decisions-mount");

const receipt = Inspection();
inspectionMount.append(receipt);

setupMount.append(Setup({
  onApproved: (numbers, tickets) => {
    receipt.updateReceipt({ nextNumbers: numbers, nextTickets: tickets, nextState: "receipt ready" });
  },
  onRejected: (numbers, tickets) => {
    receipt.updateReceipt({ nextNumbers: numbers, nextTickets: tickets, nextState: "approval rejected · no receipt event" });
  },
}));
overviewMount.append(Overview());
renderDecisions(decisionsMount, decisions);

function renderDecisions(mount, manifest) {
  ["promote", "prune", "keepLocal"].forEach((key) => {
    const decision = manifest[key];
    const card = document.createElement("article");
    card.className = "decision-card";
    const title = document.createElement("h3");
    title.textContent = key === "keepLocal" ? "Keep local" : key;
    const label = document.createElement("span");
    label.className = "decision-card__key";
    label.textContent = "system axis";
    const symbol = document.createElement("code");
    symbol.className = `decision-card__symbol${decision.symbol === null ? " is-null" : ""}`;
    symbol.textContent = decision.symbol === null ? "null / null" : `${decision.symbol} · ${decision.source}`;
    const reason = document.createElement("p");
    reason.textContent = decision.reason;
    card.append(label, title, symbol, reason);
    mount.append(card);
  });
}
