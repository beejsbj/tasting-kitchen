/**
 * Listing provenance inspector — local sample selector with keyboard support.
 */

export const LISTING = {
  title: "Hand-thrown violet cup",
  seller: "Juniper Works",
  priceSats: 21000,
  samples: [
    {
      id: "signed",
      label: "Signed listing",
      detail: "Signed by Juniper Works · local sample",
      state: "verified",
    },
    {
      id: "relayed",
      label: "Relayed listing",
      detail: "Received from a selected relay · local sample",
      state: "current",
    },
    {
      id: "cached",
      label: "Cached listing",
      detail: "Saved browser sample · review before purchase",
      state: "review",
    },
  ],
};

const STATE_META = {
  verified: {
    badge: "Verified",
    variant: "success",
    description: "Signature checks out against the local sample set.",
  },
  current: {
    badge: "Current",
    variant: "primary",
    description: "Relay copy matches the buyer's selected source.",
  },
  review: {
    badge: "Review",
    variant: "warning",
    description: "Cached sample should be reviewed before purchase.",
  },
};

/**
 * @param {HTMLElement} container
 * @param {{ samples?: typeof LISTING.samples, initialId?: string, onChange?: (sample: object) => void }} [options]
 */
export function createListingProvenanceInspector(container, options = {}) {
  const samples = options.samples ?? LISTING.samples;
  const initialId = options.initialId ?? samples[0]?.id ?? "";
  let selectedId = initialId;

  const root = document.createElement("div");
  root.className = "listing-provenance";
  root.setAttribute("data-component", "listing-provenance-inspector");

  const selector = document.createElement("div");
  selector.className = "listing-provenance__selector";
  selector.setAttribute("role", "listbox");
  selector.setAttribute("aria-label", "Provenance samples");

  const detailPanel = document.createElement("section");
  detailPanel.className = "listing-provenance__detail";
  detailPanel.setAttribute("aria-live", "polite");

  const labelEl = document.createElement("h3");
  labelEl.className = "voice-2l listing-provenance__label";

  const detailEl = document.createElement("p");
  detailEl.className = "voice-base listing-provenance__text";

  const stateRow = document.createElement("div");
  stateRow.className = "listing-provenance__state-row";

  const stateBadge = document.createElement("span");
  stateBadge.className = "listing-provenance__state-badge conduit-badge";

  const stateText = document.createElement("p");
  stateText.className = "voice-sm listing-provenance__state-text";

  stateRow.append(stateBadge, stateText);
  detailPanel.append(labelEl, detailEl, stateRow);

  const optionButtons = [];

  function getSelectedSample() {
    return samples.find((sample) => sample.id === selectedId) ?? samples[0];
  }

  function renderDetail() {
    const sample = getSelectedSample();
    const meta = STATE_META[sample.state] ?? STATE_META.current;

    labelEl.textContent = sample.label;
    detailEl.textContent = sample.detail;

    stateBadge.textContent = meta.badge;
    stateBadge.className = `listing-provenance__state-badge conduit-badge conduit-badge--${meta.variant}`;
    stateBadge.setAttribute("aria-hidden", "true");

    stateText.textContent = `State: ${sample.state}. ${meta.description}`;

    for (const button of optionButtons) {
      const active = button.dataset.sampleId === sample.id;
      button.classList.toggle("listing-provenance__option--active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }

    options.onChange?.(sample);
  }

  function selectSample(id) {
    if (!samples.some((sample) => sample.id === id)) return;
    selectedId = id;
    renderDetail();
  }

  for (const sample of samples) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "listing-provenance__option voice-sm";
    button.dataset.sampleId = sample.id;
    button.setAttribute("role", "option");
    button.textContent = sample.label;
    button.addEventListener("click", () => selectSample(sample.id));
    optionButtons.push(button);
    selector.appendChild(button);
  }

  selector.addEventListener("keydown", (event) => {
    const index = optionButtons.findIndex(
      (button) => button.dataset.sampleId === selectedId
    );
    let nextIndex = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (index + 1) % optionButtons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (index - 1 + optionButtons.length) % optionButtons.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = optionButtons.length - 1;
    } else {
      return;
    }

    const next = optionButtons[nextIndex];
    selectSample(next.dataset.sampleId);
    next.focus();
  });

  root.append(selector, detailPanel);
  container.appendChild(root);
  renderDetail();

  return {
    getSelectedId() {
      return selectedId;
    },
    getSelectedSample,
    selectSample,
    element: root,
  };
}

export function createCompactProvenanceCue(sampleId = "signed") {
  const sample =
    LISTING.samples.find((entry) => entry.id === sampleId) ?? LISTING.samples[0];
  const meta = STATE_META[sample.state] ?? STATE_META.current;

  const cue = document.createElement("div");
  cue.className = "listing-provenance-cue";

  const badge = document.createElement("span");
  badge.className = `conduit-badge conduit-badge--${meta.variant}`;
  badge.textContent = meta.badge;

  const text = document.createElement("span");
  text.className = "voice-xs listing-provenance-cue__text";
  text.textContent = sample.detail;

  cue.append(badge, text);
  return cue;
}
