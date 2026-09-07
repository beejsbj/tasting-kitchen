import { Inspection, Overview, Setup } from "./src/contexts.js";

const decisions = {
  promote: {
    symbol: "StatusMark",
    source: "src/components.js",
    reason:
      "Overview, wallet approval, and receipt each repeated the same compact status span markup. Promoting it to StatusMark keeps the paper-slip state labels consistent without copying the status helper into every context.",
  },
  prune: {
    symbol: null,
    source: null,
    reason:
      "The upstream packet exposes reusable CSS selectors but no undersupported shared JavaScript component export to remove. Pruning a fake shared module would invent abstraction the evidence does not support.",
  },
  keepLocal: {
    symbol: "LotteryBoard",
    source: "src/lottery-board.js",
    reason:
      "The 50-number board owns exactly-five selection, deterministic ROLL output, pointer and keyboard operation, and submit gating. That behavior stays local because it is feature-specific, not a generic form primitive.",
  },
};

const app = document.getElementById("app");

const hero = document.createElement("header");
hero.className = "styleguide-hero";
hero.innerHTML = `
  <h1>P5 Lottery</h1>
  <p>Paper-slip styleguide for overview, ticket setup, and receipt inspection. Every specimen imports the editable browser modules in <code>src/</code>; no wallet, network, or contract is connected.</p>
`;

const nav = document.createElement("nav");
nav.className = "styleguide-nav";
nav.innerHTML = `
  <a href="#overview">Overview</a>
  <a href="#setup">Ticket setup</a>
  <a href="#inspection">Receipt inspection</a>
  <a href="#decisions">System decisions</a>
`;

const overviewSection = section("overview", "Overview", "Live pot, demo wallet state, and recent winners on the inherited red field.");
const setupSection = section("setup", "Ticket setup", "Punch five numbers, roll the fixed sample, set ticket count, and enter local wallet approval.");
const inspectionSection = section("inspection", "Receipt inspection", "Inspect the deterministic local receipt after approval or rejection.");

const overviewMount = overviewSection.querySelector(".styleguide-mount");
const setupMount = setupSection.querySelector(".styleguide-mount");
const inspectionMount = inspectionSection.querySelector(".styleguide-mount");

let receipt = {
  numbers: [3, 12, 19, 27, 44],
  tickets: 2,
  state: "receipt ready",
  visible: false,
};

function renderInspection() {
  inspectionMount.replaceChildren(
    Inspection({
      numbers: receipt.numbers,
      tickets: receipt.tickets,
      state: receipt.state,
      visible: receipt.visible,
    }),
  );
}

overviewMount.append(Overview());

setupMount.append(
  Setup({
    onPending: ({ numbers, tickets }) => {
      receipt = { numbers, tickets, state: "awaiting approval", visible: true };
      renderInspection();
    },
    onApproved: ({ numbers, tickets }) => {
      receipt = { numbers, tickets, state: "TicketEntered", visible: true };
      renderInspection();
    },
    onRejected: ({ numbers, tickets }) => {
      receipt = { numbers: numbers ?? receipt.numbers, tickets, state: "approval rejected", visible: true };
      renderInspection();
    },
  }),
);

renderInspection();

const decisionsSection = document.createElement("section");
decisionsSection.className = "styleguide-section";
decisionsSection.id = "decisions";
decisionsSection.innerHTML = `
  <header>
    <h2>System decisions</h2>
    <p>Promotion, pruning, and local ownership recorded for this extension.</p>
  </header>
`;

const decisionsPanel = document.createElement("article");
decisionsPanel.className = "decisions-panel";
decisionsPanel.append(Object.assign(document.createElement("h2"), { textContent: "Cohesion ledger" }));

for (const key of ["promote", "prune", "keepLocal"]) {
  const entry = decisions[key];
  const row = document.createElement("div");
  row.className = "decision-row";
  const title = document.createElement("h3");
  title.textContent = entry.symbol ? `${key}: ${entry.symbol}` : `${key}: no candidate`;
  const meta = document.createElement("p");
  meta.textContent = entry.source ? `source: ${entry.source}` : "source: —";
  const reason = document.createElement("p");
  reason.textContent = entry.reason;
  row.append(title, meta, reason);
  decisionsPanel.append(row);
}

decisionsSection.append(decisionsPanel);

app.append(hero, nav, overviewSection, setupSection, inspectionSection, decisionsSection);

function section(id, title, description) {
  const block = document.createElement("section");
  block.className = "styleguide-section";
  block.id = id;
  block.innerHTML = `
    <header>
      <h2>${title}</h2>
      <p>${description}</p>
    </header>
    <div class="styleguide-mount"></div>
  `;
  return block;
}

export { decisions };
