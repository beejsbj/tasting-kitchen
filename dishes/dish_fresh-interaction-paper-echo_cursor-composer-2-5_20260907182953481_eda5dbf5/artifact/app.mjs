import { echo, encode, decode, frameAt } from "./logic.mjs";
import patterns from "./data/patterns.json" with { type: "json" };

const STEP_MS = patterns.timing.stepMs;

const state = {
  steps: [0, 0, 0, 0, 0, 0, 0, 0],
  offset: 0,
  playing: false,
  playStart: 0,
  rafId: null,
  activePreset: "blank",
};

const els = {
  intro: document.getElementById("intro-text"),
  emptyCopy: document.getElementById("empty-copy"),
  shareNotice: document.getElementById("share-notice"),
  callBeats: document.getElementById("call-beats"),
  responseBeats: document.getElementById("response-beats"),
  offsetInput: document.getElementById("offset-input"),
  offsetDown: document.getElementById("offset-down"),
  offsetUp: document.getElementById("offset-up"),
  presetGroup: document.getElementById("preset-group"),
  playBtn: document.getElementById("play-btn"),
  stopBtn: document.getElementById("stop-btn"),
  resetBtn: document.getElementById("reset-btn"),
  shareBtn: document.getElementById("share-btn"),
  shareUrl: document.getElementById("share-url"),
  status: document.getElementById("status"),
};

function responseSteps() {
  return echo(state.steps, state.offset);
}

function isBlank() {
  return state.steps.every((b) => b === 0);
}

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = kind ? `status status--${kind}` : "status";
}

function updateShareUrl() {
  const fragment = encode(state.steps, state.offset);
  const url = `${location.origin}${location.pathname}${fragment}`;
  els.shareUrl.textContent = url;
  return url;
}

function syncHash() {
  const fragment = encode(state.steps, state.offset);
  if (location.hash !== fragment) {
    history.replaceState(null, "", fragment);
  }
  updateShareUrl();
}

function renderBeats() {
  const response = responseSteps();

  for (let i = 0; i < 8; i++) {
    const callBtn = els.callBeats.children[i];
    const respCell = els.responseBeats.children[i];
    const on = state.steps[i] === 1;
    const respOn = response[i] === 1;

    callBtn.classList.toggle("beat--on", on);
    callBtn.classList.toggle("beat--off", !on);
    callBtn.setAttribute("aria-pressed", String(on));
    callBtn.setAttribute("aria-label", `Beat ${i + 1}, ${on ? "marked" : "silent"}`);

    respCell.classList.toggle("beat--on", respOn);
    respCell.classList.toggle("beat--off", !respOn);
    respCell.setAttribute("aria-label", `Response beat ${i + 1}, ${respOn ? "marked" : "silent"}`);
  }

  els.emptyCopy.hidden = !isBlank();
  els.offsetInput.value = String(state.offset);
}

function clearPlaybackHighlight() {
  for (const row of [els.callBeats, els.responseBeats]) {
    for (const cell of row.children) {
      cell.classList.remove("beat--active");
    }
  }
}

function applyFrame(frame) {
  clearPlaybackHighlight();
  if (!frame) return;
  const row = frame.phrase === "call" ? els.callBeats : els.responseBeats;
  row.children[frame.index].classList.add("beat--active");
}

function stopPlayback() {
  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.playing = false;
  els.playBtn.setAttribute("aria-pressed", "false");
  els.stopBtn.disabled = true;
  clearPlaybackHighlight();
}

function tick() {
  if (!state.playing) return;
  const elapsed = performance.now() - state.playStart;
  const frame = frameAt(elapsed);
  if (frame) {
    applyFrame(frame);
    state.rafId = requestAnimationFrame(tick);
  } else {
    stopPlayback();
  }
}

function startPlayback() {
  stopPlayback();
  state.playing = true;
  state.playStart = performance.now();
  els.playBtn.setAttribute("aria-pressed", "true");
  els.stopBtn.disabled = false;
  state.rafId = requestAnimationFrame(tick);
}

function setSteps(steps, presetId = null) {
  stopPlayback();
  state.steps = [...steps];
  if (presetId) state.activePreset = presetId;
  else state.activePreset = findMatchingPreset();
  renderBeats();
  syncHash();
  updatePresetButtons();
}

function setOffset(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 7) return;
  stopPlayback();
  state.offset = n;
  renderBeats();
  syncHash();
}

function findMatchingPreset() {
  for (const preset of patterns.presets) {
    if (preset.steps.every((v, i) => v === state.steps[i])) return preset.id;
  }
  return null;
}

function updatePresetButtons() {
  for (const btn of els.presetGroup.children) {
    const pressed = btn.dataset.presetId === state.activePreset;
    btn.setAttribute("aria-pressed", String(pressed));
  }
}

function resetAll() {
  stopPlayback();
  state.steps = [0, 0, 0, 0, 0, 0, 0, 0];
  state.offset = 0;
  state.activePreset = "blank";
  renderBeats();
  history.replaceState(null, "", location.pathname);
  updateShareUrl();
  updatePresetButtons();
  setStatus("");
}

function loadFromHash() {
  const decoded = decode(location.hash);
  if (decoded) {
    state.steps = [...decoded.steps];
    state.offset = decoded.offset;
    state.activePreset = findMatchingPreset() ?? null;
    renderBeats();
    updateShareUrl();
    updatePresetButtons();
    return;
  }

  if (location.hash && location.hash.length > 1) {
    setStatus("That address could not be read — starting with a blank page.", "notice");
    history.replaceState(null, "", location.pathname);
  }

  state.steps = [0, 0, 0, 0, 0, 0, 0, 0];
  state.offset = 0;
  state.activePreset = "blank";
  renderBeats();
  updateShareUrl();
  updatePresetButtons();
}

function buildBeats() {
  for (let i = 0; i < 8; i++) {
    const callBtn = document.createElement("button");
    callBtn.type = "button";
    callBtn.className = "beat beat--off";
    callBtn.dataset.index = String(i);
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    callBtn.appendChild(mark);
    callBtn.addEventListener("click", () => {
      const next = [...state.steps];
      next[i] = next[i] === 1 ? 0 : 1;
      setSteps(next);
    });
    els.callBeats.appendChild(callBtn);

    const respCell = document.createElement("div");
    respCell.className = "beat beat--response beat--off";
    respCell.setAttribute("aria-hidden", "false");
    const respMark = document.createElement("span");
    respMark.className = "mark";
    respMark.setAttribute("aria-hidden", "true");
    respCell.appendChild(respMark);
    els.responseBeats.appendChild(respCell);
  }
}

function buildPresets() {
  for (const preset of patterns.presets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.dataset.presetId = preset.id;
    btn.textContent = preset.label;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => setSteps(preset.steps, preset.id));
    els.presetGroup.appendChild(btn);
  }
}

async function copyShareUrl() {
  const url = updateShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Address copied.");
  } catch {
    els.shareUrl.focus();
    setStatus("Select the address above to copy it.");
  }
}

function wireControls() {
  els.offsetInput.addEventListener("change", () => {
    const v = Number(els.offsetInput.value);
    if (Number.isInteger(v) && v >= 0 && v <= 7) setOffset(v);
    else els.offsetInput.value = String(state.offset);
  });

  els.offsetInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") { e.preventDefault(); setOffset(Math.min(7, state.offset + 1)); }
    if (e.key === "ArrowDown") { e.preventDefault(); setOffset(Math.max(0, state.offset - 1)); }
  });

  els.offsetDown.addEventListener("click", () => setOffset(Math.max(0, state.offset - 1)));
  els.offsetUp.addEventListener("click", () => setOffset(Math.min(7, state.offset + 1)));

  els.playBtn.addEventListener("click", startPlayback);
  els.stopBtn.addEventListener("click", stopPlayback);
  els.resetBtn.addEventListener("click", resetAll);
  els.shareBtn.addEventListener("click", copyShareUrl);

  window.addEventListener("hashchange", loadFromHash);
}

function init() {
  els.intro.textContent = patterns.intro;
  els.emptyCopy.textContent = patterns.emptyCopy;
  els.shareNotice.textContent = patterns.shareNotice;

  buildBeats();
  buildPresets();
  wireControls();
  loadFromHash();
}

init();
