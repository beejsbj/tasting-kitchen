import { Surface } from "./components.js";

const winners = [
  { number: "27", pot: "553", week: 3 },
  { number: "08", pot: "412", week: 2 },
  { number: "41", pot: "318", week: 1 },
];

export function PastWinners() {
  const panel = Surface({
    kicker: "ledger",
    title: "past winners",
    description: "Recent draws from the local paper ledger.",
  });
  panel.classList.add("past-card");

  const list = document.createElement("ol");
  list.className = "winner-board";

  winners.forEach((winner, index) => {
    const row = document.createElement("li");
    row.className = index === 0 ? "winner-row latest" : "winner-row";
    row.append(
      Object.assign(document.createElement("span"), { className: "winner-rank", textContent: `#${index + 1}` }),
      Object.assign(document.createElement("span"), { className: "winner-number", textContent: winner.number }),
      Object.assign(document.createElement("span"), { className: "winner-pot", textContent: `Ξ ${winner.pot}` }),
      Object.assign(document.createElement("span"), { className: "winner-week", textContent: `week ${winner.week}` }),
    );
    list.append(row);
  });

  panel.append(list);
  return panel;
}
