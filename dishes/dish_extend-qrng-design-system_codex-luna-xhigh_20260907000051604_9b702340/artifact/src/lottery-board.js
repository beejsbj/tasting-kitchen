import { ActionButton, Status, Surface } from "./components.js";

const SAMPLE_NUMBERS = Object.freeze([3, 12, 19, 27, 44]);
const MAX_SELECTIONS = 5;

// This feature owns its selection rule, deterministic roll, keyboard inputs,
// and submit event semantics. It is intentionally not generalized.
export function LotteryBoard({ onSubmit } = {}) {
  const module = Surface({
    kicker: "week 12 / number board",
    title: "Punch your numbers",
    description: "Choose exactly five slips. ROLL is a fixed local sample.",
    className: "lottery-module",
  });
  const form = document.createElement("form");
  form.className = "lottery-form";
  const board = document.createElement("ul");
  board.className = "dial-board";
  board.setAttribute("aria-label", "Choose five lottery numbers from 1 to 50");
  const status = Status({ text: "0 / 5 punched", tone: "neutral", symbol: "○" });
  status.classList.add("board-status");
  const selected = new Set();
  let isRolling = false;

  const submit = ActionButton({ label: "SUBMIT", className: "submit", disabled: true });
  submit.type = "submit";
  const roll = ActionButton({ label: "ROLL", className: "roll" });

  const update = () => {
    const count = selected.size;
    if (isRolling) {
      status.update({ text: "stamping fixed sample", tone: "pending", symbol: "↻" });
    } else if (count === MAX_SELECTIONS) {
      status.update({ text: "5 punched — wallet approval next", tone: "ready", symbol: "✦" });
    } else {
      status.update({ text: `${count} / ${MAX_SELECTIONS} punched`, tone: "neutral", symbol: "○" });
    }
    submit.disabled = count !== MAX_SELECTIONS || isRolling;
    board.querySelectorAll("input").forEach((input) => {
      input.disabled = !input.checked && count === MAX_SELECTIONS;
      input.setAttribute("aria-checked", String(input.checked));
    });
  };

  const setSelection = (values) => {
    selected.clear();
    values.slice(0, MAX_SELECTIONS).forEach((value) => selected.add(value));
    board.querySelectorAll("input").forEach((input) => {
      input.checked = selected.has(Number(input.value));
    });
    update();
  };

  for (let number = 1; number <= 50; number += 1) {
    const item = document.createElement("li");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `dial-${number}`;
    input.value = String(number);
    input.className = "dials";
    input.setAttribute("aria-label", `Number ${number}`);
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.className = "number-slip";
    label.append(nodeSpan(number));
    input.addEventListener("change", () => {
      if (input.checked && selected.size >= MAX_SELECTIONS) {
        input.checked = false;
        update();
        return;
      }
      if (input.checked) selected.add(number); else selected.delete(number);
      update();
    });
    item.append(input, label);
    board.append(item);
  }

  const actions = document.createElement("div");
  actions.className = "buttons";
  actions.append(roll, submit);
  form.append(board, status, actions);

  roll.addEventListener("click", () => {
    if (isRolling) return;
    isRolling = true;
    update();
    board.classList.add("is-rolling");
    setSelection(SAMPLE_NUMBERS);
    // Keep the browser interaction immediate and deterministic while allowing
    // the pressed/stamped state to read for a beat.
    window.setTimeout(() => {
      isRolling = false;
      board.classList.remove("is-rolling");
      update();
    }, 220);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (selected.size !== MAX_SELECTIONS) return;
    onSubmit?.([...selected].sort((a, b) => a - b));
  });

  module.append(form);
  module.getSelectedNumbers = () => [...selected].sort((a, b) => a - b);
  update();
  return module;
}

function nodeSpan(number) {
  const span = document.createElement("span");
  span.textContent = String(number);
  return span;
}

export { MAX_SELECTIONS, SAMPLE_NUMBERS };
