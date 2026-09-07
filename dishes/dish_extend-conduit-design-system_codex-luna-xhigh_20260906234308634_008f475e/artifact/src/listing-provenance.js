import { Badge } from "./conduit-primitives.js";

/* The inspector's only runtime data: three local samples supplied by the brief. */
export const PROVENANCE_SAMPLES = Object.freeze([
  Object.freeze({
    id: "signed",
    label: "Signed listing",
    detail: "Signed by Juniper Works · local sample",
    state: "verified"
  }),
  Object.freeze({
    id: "relayed",
    label: "Relayed listing",
    detail: "Received from a selected relay · local sample",
    state: "current"
  }),
  Object.freeze({
    id: "cached",
    label: "Cached listing",
    detail: "Saved browser sample · review before purchase",
    state: "review"
  })
]);

export const PROVENANCE_STATES = Object.freeze([
  Object.freeze({ id: "verified", label: "Verified", note: "Signed and readable locally." }),
  Object.freeze({ id: "current", label: "Current", note: "Relayed from the selected local source." }),
  Object.freeze({ id: "review", label: "Review", note: "Cached locally; review before purchase." })
]);

export const LISTING_PROVENANCE_API = Object.freeze({
  component: "ListingProvenanceInspector",
  mount: "createListingProvenanceInspector({ container, samples?, initialId? })",
  methods: ["select(id)", "getState()", "destroy()"],
  boundary: "local sample state only; no requests"
});

function findSample(samples, id) {
  return samples.find((sample) => sample.id === id) || samples[0];
}

/**
 * Local-only listing provenance inspector.
 * The selector is a roving listbox of real buttons, so pointer, Enter/Space, and arrow-key
 * interaction all use the same select path and keep the visible result in sync.
 */
export function createListingProvenanceInspector({
  container,
  samples = PROVENANCE_SAMPLES,
  initialId = samples[0]?.id
} = {}) {
  if (!container) throw new Error("ListingProvenanceInspector needs a container");
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("ListingProvenanceInspector needs at least one sample");
  }

  const root = document.createElement("div");
  root.className = "provenance-inspector";
  root.dataset.localOnly = "true";
  root.setAttribute("aria-label", "Listing provenance inspector");

  const selector = document.createElement("div");
  selector.className = "provenance-inspector__selector";
  selector.setAttribute("role", "listbox");
  selector.setAttribute("aria-label", "Choose a local listing sample");

  const result = document.createElement("div");
  result.className = "provenance-result";
  result.setAttribute("aria-live", "polite");
  result.setAttribute("aria-atomic", "true");

  const resultCopy = document.createElement("div");
  resultCopy.className = "provenance-result__copy";
  const resultLabel = document.createElement("strong");
  resultLabel.className = "provenance-result__label";
  const resultDetail = document.createElement("p");
  resultDetail.className = "provenance-result__detail";
  resultCopy.append(resultLabel, resultDetail);

  const resultState = document.createElement("div");
  resultState.className = "provenance-result__state";
  const resultStateLabel = document.createElement("span");
  resultStateLabel.className = "provenance-result__state-label";
  resultStateLabel.textContent = "Text state";
  const resultStateText = document.createElement("span");
  resultStateText.className = "provenance-result__state-label";
  const resultBadge = document.createElement("span");
  resultState.append(resultStateLabel, resultStateText, resultBadge);
  result.append(resultCopy, resultState);

  const optionNodes = new Map();
  let selected = findSample(samples, initialId);

  const setOptionState = () => {
    optionNodes.forEach((option, id) => {
      const isSelected = id === selected.id;
      option.setAttribute("aria-selected", String(isSelected));
      option.tabIndex = isSelected ? 0 : -1;
    });
  };

  const updateResult = () => {
    resultLabel.textContent = selected.label;
    resultDetail.textContent = selected.detail;
    resultStateText.textContent = `State: ${selected.state}`;
    resultState.dataset.state = selected.state;
    resultBadge.replaceChildren(
      Badge({ label: selected.state, variant: selected.state, marker: true })
    );
    setOptionState();
  };

  const select = (id, { focus = false } = {}) => {
    const next = findSample(samples, id);
    if (!next) return;
    selected = next;
    updateResult();
    if (focus) optionNodes.get(selected.id)?.focus();
  };

  const move = (direction) => {
    const focusedId = document.activeElement?.dataset?.sampleId;
    const index = samples.findIndex((sample) => sample.id === (focusedId || selected.id));
    const nextIndex = direction === "first"
      ? 0
      : direction === "last"
        ? samples.length - 1
        : (index + direction + samples.length) % samples.length;
    select(samples[nextIndex].id, { focus: true });
  };

  samples.forEach((sample) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "provenance-option";
    option.setAttribute("role", "option");
    option.dataset.sampleId = sample.id;
    option.innerHTML = `<span class="provenance-option__label"></span><span class="provenance-option__detail"></span>`;
    option.querySelector(".provenance-option__label").textContent = sample.label;
    option.querySelector(".provenance-option__detail").textContent = sample.detail;
    option.addEventListener("click", () => select(sample.id));
    option.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        move("first");
      } else if (event.key === "End") {
        event.preventDefault();
        move("last");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(sample.id);
      }
    });
    optionNodes.set(sample.id, option);
    selector.append(option);
  });

  root.append(selector, result);
  container.append(root);
  updateResult();

  return {
    root,
    select: (id) => select(id),
    getState: () => ({ ...selected }),
    destroy: () => root.remove(),
    states: PROVENANCE_STATES
  };
}

export const ListingProvenanceInspector = createListingProvenanceInspector;
