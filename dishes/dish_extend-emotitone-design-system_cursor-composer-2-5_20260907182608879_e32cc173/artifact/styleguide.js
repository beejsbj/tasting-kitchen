import { createTabs } from "./src/static-tabs.js";
import { samplesFor } from "./src/mode-samples.js";

const state = {
  mode: "major",
  degreeIndex: 0,
};

const INTERVAL_NAMES = {
  "1P": "perfect unison",
  "2M": "major second",
  "3m": "minor third",
  "3M": "major third",
  "4P": "perfect fourth",
  "5P": "perfect fifth",
  "6m": "minor sixth",
  "6M": "major sixth",
  "7m": "minor seventh",
  "7M": "major seventh",
};

const elements = {
  degreeButtons: document.querySelector("#degree-buttons"),
  modeStatus: document.querySelector("#mode-status"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  readingPosition: document.querySelector("#reading-position"),
  readingTitle: document.querySelector("#reading-title"),
  readingInterval: document.querySelector("#reading-interval"),
  readingEmotion: document.querySelector("#reading-emotion"),
  readingDescription: document.querySelector("#reading-description"),
  readingTexture: document.querySelector("#reading-texture"),
  readingShape: document.querySelector("#reading-shape"),
  lensGlyph: document.querySelector("#lens-glyph"),
};

function currentSamples() {
  return samplesFor(state.mode);
}

function currentSample() {
  return currentSamples()[state.degreeIndex];
}

function degreeButtonMarkup(sample, index) {
  const [name, interval] = sample;
  const isSelected = index === state.degreeIndex;

  return `
    <button class="degree-key" type="button" data-degree-index="${index}" aria-pressed="${isSelected}" aria-label="Degree ${index + 1}, ${name}, ${interval}">
      <span class="degree-key__number">0${index + 1}</span>
      <span class="degree-key__name">${name}</span>
      <span class="degree-key__interval">${interval}</span>
    </button>
  `;
}

function renderDegreeButtons() {
  elements.degreeButtons.innerHTML = currentSamples().map(degreeButtonMarkup).join("");

  elements.degreeButtons.querySelectorAll("[data-degree-index]").forEach((button) => {
    button.addEventListener("click", () => {
      selectDegree(Number(button.dataset.degreeIndex));
    });
  });
}

function renderReading() {
  const [name, interval, emotion, description, texture, shape] = currentSample();
  const modeName = state.mode[0].toUpperCase() + state.mode.slice(1);

  elements.modeStatus.textContent = `${modeName} / 7 degrees / movable do`;
  elements.readingPosition.textContent = `${state.mode} / degree ${state.degreeIndex + 1} of 7`;
  elements.readingTitle.textContent = name;
  elements.readingInterval.innerHTML = `${interval} <span aria-hidden="true">·</span> ${INTERVAL_NAMES[interval] ?? "interval identity"}`;
  elements.readingEmotion.textContent = emotion;
  elements.readingDescription.textContent = description;
  elements.readingTexture.textContent = texture;
  elements.readingShape.textContent = shape;
  elements.lensGlyph.dataset.shape = shape;
  elements.lensGlyph.textContent = name;
  elements.lensGlyph.setAttribute("aria-label", `${name}, ${shape} texture shape`);

  elements.modeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
  });
}

function renderLens() {
  renderDegreeButtons();
  renderReading();
}

function selectMode(mode) {
  if (!(mode in { major: true, minor: true })) return;
  state.mode = mode;
  state.degreeIndex = Math.min(state.degreeIndex, currentSamples().length - 1);
  renderLens();
}

function selectDegree(index) {
  const samples = currentSamples();
  if (!Number.isInteger(index)) return;
  state.degreeIndex = Math.max(0, Math.min(index, samples.length - 1));
  renderLens();
  const selected = elements.degreeButtons.querySelector(`[data-degree-index="${state.degreeIndex}"]`);
  selected?.focus({ preventScroll: true });
}

function handleDegreeKeyboard(event) {
  const activeButton = event.target.closest?.("[data-degree-index]");
  if (!activeButton) return;

  const currentIndex = Number(activeButton.dataset.degreeIndex);
  let nextIndex = currentIndex;

  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex += 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex -= 1;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = currentSamples().length - 1;
  if (event.key >= "1" && event.key <= "7") nextIndex = Number(event.key) - 1;

  if (nextIndex === currentIndex) return;
  event.preventDefault();
  selectDegree(nextIndex);
}

function mountTabs({ mount, label, tabs }) {
  const tabGroup = mount.closest("[data-tabs-group]");
  const panels = [...tabGroup.querySelectorAll("[data-tab-panel]")];
  const tabSet = createTabs({ label, tabs, selected: tabs[0].id, panels });
  mount.append(tabSet.root);
}

function bootTabs() {
  mountTabs({
    mount: document.querySelector('[data-tabs-mount="anatomy"]'),
    label: "Overlay anatomy specimen",
    tabs: [
      { id: "anatomy-shell", label: "Shell layers" },
      { id: "anatomy-controls", label: "Controls" },
    ],
  });
  mountTabs({
    mount: document.querySelector('[data-tabs-mount="semantics"]'),
    label: "Selected semantics specimen",
    tabs: [
      { id: "semantics-state", label: "States" },
      { id: "semantics-keyboard", label: "Keyboard" },
    ],
  });
}

elements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});

elements.degreeButtons.addEventListener("keydown", handleDegreeKeyboard);
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLElement && event.target.matches("input, textarea, select")) return;
  if (event.target instanceof HTMLElement && event.target.closest("#degree-buttons")) return;
  if (event.key >= "1" && event.key <= "7") selectDegree(Number(event.key) - 1);
});

renderLens();
bootTabs();
