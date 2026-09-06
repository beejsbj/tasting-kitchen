import { ActionButton, Surface } from "./components.js";

const sampleNumbers = [3, 12, 19, 27, 44];

// This feature owns its selection rule, deterministic roll, and event semantics.
export function LotteryBoard({ onSubmit } = {}) {
  const module = Surface({ kicker: "week 12", title: "Punch your numbers", description: "Choose five slips for a local receipt." });
  module.classList.add("lottery-module");
  const form = document.createElement("form");
  const board = document.createElement("ul");
  board.className = "dial-board";
  const status = document.createElement("p");
  status.className = "board-status";
  status.setAttribute("aria-live", "polite");
  const selected = new Set();

  const update = () => {
    const count = selected.size;
    status.textContent = count === 5 ? "5 punched — wallet approval next" : `${count} / 5 punched`;
    submit.disabled = count !== 5;
    for (const input of board.querySelectorAll("input")) input.disabled = !input.checked && count === 5;
  };
  const setSelection = (values) => {
    selected.clear();
    values.forEach((value) => selected.add(value));
    for (const input of board.querySelectorAll("input")) input.checked = selected.has(Number(input.value));
    update();
  };

  for (let number = 1; number <= 50; number += 1) {
    const item = document.createElement("li");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `dial-${number}`;
    input.value = String(number);
    input.className = "dials";
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = String(number);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(number); else selected.delete(number);
      update();
    });
    item.append(input, label);
    board.append(item);
  }

  const roll = ActionButton({ label: "ROLL" });
  roll.classList.add("roll");
  roll.addEventListener("click", () => setSelection(sampleNumbers));
  const submit = ActionButton({ label: "SUBMIT" });
  submit.classList.add("submit");
  submit.type = "submit";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (selected.size === 5) onSubmit?.([...selected].sort((a, b) => a - b));
  });
  const actions = document.createElement("div");
  actions.className = "buttons";
  actions.append(roll, submit);
  form.append(board, status, actions);
  module.append(form);
  update();
  return module;
}
