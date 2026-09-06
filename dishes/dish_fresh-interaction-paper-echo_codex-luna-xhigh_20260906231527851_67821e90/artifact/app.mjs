import { echo, encode, decode, frameAt } from "./logic.mjs";

const blankPattern = () => Array.from({ length: 8 }, () => 0);
const fallbackPatterns = {
  intro: "Make a mark in time. Turn it over. Meet the answer.",
  emptyCopy: "Silence is a pattern too.",
  shareNotice: "This address contains only your eight marks and echo offset. No account or upload.",
  timing: { stepMs: 300, stepsPerPhrase: 8, phraseCount: 2 },
  presets: [],
};

const $ = (selector) => document.querySelector(selector);
const callGrid = $("#call-grid");
const responseGrid = $("#response-grid");
const offsetButtons = $("#offset-buttons");
const presetList = $("#preset-list");
const offsetRange = $("#offset-range");
const shareAddress = $("#share-address");
const shareFeedback = $("#share-feedback");
const statusChip = $("#status-chip");
const statusLabel = $("#status-label");
const playbackMessage = $("#playback-message");

let patterns = fallbackPatterns;
let state = { steps: blankPattern(), offset: 0 };
let playback = null;
let shareFeedbackTimer = null;

function setFeedback(message) {
  window.clearTimeout(shareFeedbackTimer);
  shareFeedback.textContent = message;
  if (message) {
    shareFeedbackTimer = window.setTimeout(() => {
      shareFeedback.textContent = "";
    }, 5000);
  }
}

function makeStepButton(index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "step-button";
  button.dataset.stepIndex = String(index);
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = `<span class="beat-number">${String(index + 1).padStart(2, "0")}</span><span class="step-mark" aria-hidden="true"></span><span class="beat-state">silence</span>`;
  button.addEventListener("click", () => {
    stopPlayback();
    const nextSteps = [...state.steps];
    nextSteps[index] = nextSteps[index] === 1 ? 0 : 1;
    state = { steps: nextSteps, offset: state.offset };
    render();
    updateUrl();
    playbackMessage.textContent = "The call changed. Ready to listen.";
  });
  return button;
}

function makeResponseStep(index) {
  const item = document.createElement("div");
  item.className = "response-step";
  item.dataset.responseIndex = String(index);
  item.dataset.value = "0";
  item.setAttribute("role", "listitem");
  item.innerHTML = `<span class="beat-number">${String(index + 1).padStart(2, "0")}</span><span class="step-mark" aria-hidden="true"></span><span class="beat-state">silence</span>`;
  return item;
}

function makeOffsetButton(offset) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "offset-button";
  button.dataset.offset = String(offset);
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", `Set echo offset to ${offset}`);
  button.textContent = String(offset);
  button.addEventListener("click", () => setOffset(offset));
  return button;
}

function makePresetButton(preset) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "preset-button";
  button.dataset.presetId = preset.id;
  button.setAttribute("aria-pressed", "false");
  const mini = preset.steps.map((step) => `<i data-value="${step}" aria-hidden="true"></i>`).join("");
  button.innerHTML = `<span><span class="preset-id">${preset.id}</span><span class="preset-label">${preset.label}</span></span><span class="preset-mini" aria-hidden="true">${mini}</span>`;
  button.addEventListener("click", () => {
    stopPlayback();
    state = { steps: [...preset.steps], offset: state.offset };
    render();
    updateUrl();
    playbackMessage.textContent = `${preset.label} loaded. Ready to listen.`;
  });
  return button;
}

function setupControls() {
  for (let index = 0; index < 8; index += 1) {
    callGrid.append(makeStepButton(index));
    responseGrid.append(makeResponseStep(index));
    offsetButtons.append(makeOffsetButton(index));
  }
  for (const preset of patterns.presets) presetList.append(makePresetButton(preset));
}

function renderCall() {
  const markedCount = state.steps.reduce((sum, step) => sum + step, 0);
  $("#call-count").textContent = `${markedCount} / 8 marked`;
  [...callGrid.children].forEach((button, index) => {
    const marked = state.steps[index] === 1;
    button.setAttribute("aria-pressed", String(marked));
    button.querySelector(".beat-state").textContent = marked ? "mark" : "silence";
    button.setAttribute("aria-label", `Beat ${index + 1}, ${marked ? "marked" : "silence"}. Toggle mark.`);
  });
}

function renderResponse() {
  const response = echo(state.steps, state.offset);
  const returnedCount = response.reduce((sum, step) => sum + step, 0);
  $("#response-count").textContent = `${returnedCount} / 8 returned`;
  [...responseGrid.children].forEach((item, index) => {
    const marked = response[index] === 1;
    item.dataset.value = String(response[index]);
    item.querySelector(".beat-state").textContent = marked ? "answer" : "silence";
    item.setAttribute("aria-label", `Response beat ${index + 1}, ${marked ? "answer mark" : "silence"}. Read only.`);
  });
  $("#offset-inline").textContent = String(state.offset);
  $("#offset-readout").innerHTML = `<span>+ </span>${state.offset}`;
  offsetRange.value = String(state.offset);
  [...offsetButtons.children].forEach((button, index) => {
    button.setAttribute("aria-pressed", String(index === state.offset));
  });
  const captions = [
    "No shift — the reflection keeps its edge.",
    "One step right — a small reply.",
    "Two steps right — the space opens.",
    "Three steps right — a longer reach.",
    "Four steps right — opposite shores.",
    "Five steps right — almost around.",
    "Six steps right — near the beginning.",
    "Seven steps right — one breath from home.",
  ];
  $("#offset-caption").textContent = captions[state.offset];
}

function renderPresets() {
  [...presetList.children].forEach((button, index) => {
    const preset = patterns.presets[index];
    button.setAttribute("aria-pressed", String(preset.steps.every((step, stepIndex) => step === state.steps[stepIndex])));
  });
}

function clearPlaybackClasses() {
  document.querySelectorAll(".is-current, .is-live").forEach((element) => {
    element.classList.remove("is-current", "is-live");
    element.removeAttribute("aria-current");
  });
}

function renderFrame(frame) {
  clearPlaybackClasses();
  if (!frame) {
    statusChip.dataset.status = "rest";
    statusLabel.textContent = "Resting";
    return;
  }
  const phrase = frame.phrase === "call" ? callGrid.parentElement : responseGrid.parentElement;
  const target = frame.phrase === "call" ? callGrid.children[frame.index] : responseGrid.children[frame.index];
  phrase.classList.add("is-live");
  target.classList.add("is-current");
  target.setAttribute("aria-current", "step");
  statusChip.dataset.status = frame.phrase;
  statusLabel.textContent = frame.phrase === "call" ? "Calling" : "Answering";
}

function render() {
  renderCall();
  renderResponse();
  renderPresets();
  updateShareAddress();
}

function setOffset(offset) {
  if (offset === state.offset) return;
  stopPlayback();
  state = { steps: [...state.steps], offset };
  render();
  updateUrl();
  playbackMessage.textContent = `Offset +${offset} set. Ready to listen.`;
}

function updateShareAddress() {
  const fragment = encode(state.steps, state.offset);
  const url = new URL(window.location.href);
  url.hash = fragment;
  shareAddress.value = url.href;
}

function updateUrl() {
  const fragment = encode(state.steps, state.offset);
  const url = new URL(window.location.href);
  url.hash = fragment;
  window.history.replaceState(null, "", url.href);
  updateShareAddress();
}

function stopPlayback() {
  if (playback?.rafId !== undefined) window.cancelAnimationFrame(playback.rafId);
  playback = null;
  renderFrame(null);
}

function tick(now) {
  if (!playback) return;
  const frame = frameAt(now - playback.startedAt);
  if (!frame) {
    playback = null;
    renderFrame(null);
    playbackMessage.textContent = "The echo is complete. Play it again or change the call.";
    return;
  }
  renderFrame(frame);
  playback.rafId = window.requestAnimationFrame(tick);
}

function play() {
  stopPlayback();
  playback = { startedAt: window.performance.now(), rafId: undefined };
  playbackMessage.textContent = "A call is moving through the surface…";
  playback.rafId = window.requestAnimationFrame(tick);
}

function applyLocationHash({ announceInvalid = false } = {}) {
  const fragment = window.location.hash;
  if (!fragment) {
    state = { steps: blankPattern(), offset: 0 };
    render();
    return;
  }
  const decoded = decode(fragment);
  if (!decoded) {
    state = { steps: blankPattern(), offset: 0 };
    render();
    if (announceInvalid) playbackMessage.textContent = "That echo address was not recognized. A blank surface is ready.";
    return;
  }
  state = { steps: [...decoded.steps], offset: decoded.offset };
  render();
  if (announceInvalid) playbackMessage.textContent = "Shared pattern reopened. Ready to listen.";
}

async function loadPatterns() {
  try {
    const response = await fetch("./data/patterns.json");
    if (!response.ok) throw new Error(`Pattern data returned ${response.status}`);
    return await response.json();
  } catch (error) {
    document.documentElement.dataset.patternsError = "true";
    return fallbackPatterns;
  }
}

async function start() {
  patterns = await loadPatterns();
  $("#intro-copy").textContent = patterns.intro;
  $("#share-notice").textContent = patterns.shareNotice;
  setupControls();
  applyLocationHash({ announceInvalid: true });

  $("#play-button").addEventListener("click", play);
  $("#stop-button").addEventListener("click", () => {
    stopPlayback();
    playbackMessage.textContent = "Playback stopped. The surface is at rest.";
  });
  $("#reset-button").addEventListener("click", () => {
    stopPlayback();
    state = { steps: blankPattern(), offset: 0 };
    render();
    updateUrl();
    playbackMessage.textContent = patterns.emptyCopy;
  });
  offsetRange.addEventListener("input", (event) => setOffset(Number(event.target.value)));
  shareAddress.addEventListener("focus", () => shareAddress.select());
  shareAddress.addEventListener("click", () => shareAddress.select());
  $("#copy-button").addEventListener("click", async () => {
    shareAddress.focus();
    shareAddress.select();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareAddress.value);
      setFeedback("Address copied. The gesture can travel.");
    } catch (error) {
      shareAddress.select();
      setFeedback("Clipboard unavailable — the address is selected to copy manually.");
    }
  });
  window.addEventListener("hashchange", () => applyLocationHash({ announceInvalid: true }));
}

start();
