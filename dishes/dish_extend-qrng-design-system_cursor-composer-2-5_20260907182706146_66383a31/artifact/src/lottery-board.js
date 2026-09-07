import { ActionButton, Surface } from "./components.js";

const sampleNumbers = [3, 12, 19, 27, 44];
const BOARD_COLUMNS = 5;

// This feature owns its selection rule, deterministic roll, and event semantics.
export function LotteryBoard({ onSubmit } = {}) {
  const module = Surface({
    kicker: "week 12",
    title: "Punch your numbers",
    description: "Choose five slips for a local receipt.",
  });
  module.classList.add("lottery-module");

  const form = document.createElement("form");
  form.setAttribute("aria-label", "Lottery number board");
  const board = document.createElement("ul");
  board.className = "dial-board";
  const status = document.createElement("div");
  status.className = "board-status";
  status.setAttribute("aria-live", "polite");
  const statusText = document.createElement("span");
  status.append(statusText);

  const selected = new Set();
  const inputs = [];

  const update = () => {
    const count = selected.size;
    statusText.textContent = count === 5 ? "5 punched — wallet approval next" : `${count} / 5 punched`;
    submit.disabled = count !== 5;
    for (const input of inputs) {
      input.disabled = !input.checked && count === 5;
      input.closest("li")?.classList.toggle("is-selected", input.checked);
    }
  };

  const setSelection = (values) => {
    selected.clear();
    values.forEach((value) => selected.add(value));
    for (const input of inputs) {
      const number = Number(input.value);
      const checked = selected.has(number);
      input.checked = checked;
      const label = input.nextElementSibling;
      label?.classList.toggle("punched-slip", checked);
    }
    update();
  };

  const toggleNumber = (number, checked) => {
    if (checked) {
      if (selected.size >= 5) return false;
      selected.add(number);
    } else {
      selected.delete(number);
    }
    return true;
  };

  const focusInput = (index) => {
    const clamped = ((index % inputs.length) + inputs.length) % inputs.length;
    inputs[clamped]?.focus();
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
    const span = document.createElement("span");
    span.textContent = String(number);
    label.append(span);

    input.addEventListener("change", () => {
      const ok = toggleNumber(number, input.checked);
      if (!ok) {
        input.checked = false;
        return;
      }
      label.classList.toggle("punched-slip", input.checked);
      update();
    });

    input.addEventListener("keydown", (event) => {
      const index = inputs.indexOf(input);
      if (event.key === "ArrowRight") {
        event.preventDefault();
        focusInput(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusInput(index - 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        focusInput(index + BOARD_COLUMNS);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusInput(index - BOARD_COLUMNS);
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (input.disabled && !input.checked) return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    inputs.push(input);
    item.append(input, label);
    board.append(item);
  }

  const roll = ActionButton({ label: "ROLL" });
  roll.classList.add("roll");
  roll.addEventListener("click", () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSelection(sampleNumbers);
      return;
    }
    board.classList.add("is-rolling");
    roll.disabled = true;
    submit.disabled = true;
    selected.clear();
    for (const input of inputs) {
      input.checked = false;
      input.disabled = false;
      input.nextElementSibling?.classList.remove("punched-slip");
    }
    statusText.textContent = "shaking slips";
    window.setTimeout(() => {
      setSelection(sampleNumbers);
      board.classList.remove("is-rolling");
      roll.disabled = false;
      update();
    }, 680);
  });

  const submit = ActionButton({ label: "SUBMIT" });
  submit.classList.add("submit");
  submit.type = "submit";
  submit.disabled = true;

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

  module.getSelection = () => [...selected].sort((a, b) => a - b);
  return module;
}
