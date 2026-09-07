/**
 * Conduit primitives — adapted Button, Badge, Tabs, and PageSection roles.
 */

export function createPageSection(options = {}) {
  const { width = "wide", gap = "md", className = "" } = options;

  const widthMap = {
    full: "conduit-section--full",
    wide: "conduit-section--wide",
    normal: "conduit-section--normal",
    narrow: "conduit-section--narrow",
    xNarrow: "conduit-section--xnarrow",
  };

  const gapMap = {
    none: "conduit-section--gap-none",
    sm: "conduit-section--gap-sm",
    md: "conduit-section--gap-md",
    lg: "conduit-section--gap-lg",
  };

  const section = document.createElement("section");
  const inner = document.createElement("div");
  inner.className = [
    "conduit-section",
    widthMap[width] || widthMap.wide,
    gapMap[gap] || gapMap.md,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  section.appendChild(inner);
  section._inner = inner;
  return section;
}

export function createButton(options = {}) {
  const {
    variant = "primary",
    size = "md",
    rounded = true,
    disabled = false,
    label = "",
    className = "",
    onClick,
    type = "button",
  } = options;

  const button = document.createElement("button");
  button.type = type;
  button.disabled = disabled;
  button.className = [
    "conduit-btn",
    `conduit-btn--${variant}`,
    `conduit-btn--${size}`,
    rounded ? "conduit-btn--rounded" : "conduit-btn--square",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (typeof label === "string") {
    button.textContent = label;
  } else if (label instanceof Node) {
    button.appendChild(label);
  }

  if (onClick) {
    button.addEventListener("click", onClick);
  }

  return button;
}

export function createBadge(options = {}) {
  const { variant = "primary", label = "", className = "" } = options;
  const badge = document.createElement("span");
  badge.className = ["conduit-badge", `conduit-badge--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  badge.textContent = label;
  return badge;
}

export function createTabs(options = {}) {
  const { defaultValue = "", onValueChange } = options;
  let value = defaultValue;
  const listeners = new Set();

  const root = document.createElement("div");
  root.className = "conduit-tabs";

  function notify() {
    for (const listener of listeners) {
      listener(value);
    }
    onValueChange?.(value);
  }

  function setValue(next) {
    if (next === value) return;
    value = next;
    notify();
  }

  function getValue() {
    return value;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  root._tabsApi = { getValue, setValue, subscribe };
  return root;
}

export function createTabsList(options = {}) {
  const { className = "" } = options;
  const list = document.createElement("div");
  list.className = ["conduit-tabs__list", className].filter(Boolean).join(" ");
  list.setAttribute("role", "tablist");
  return list;
}

export function createTabsTrigger(tabsRoot, options = {}) {
  const { value, label = "", className = "" } = options;
  const api = tabsRoot._tabsApi;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = ["conduit-tabs__trigger", "voice-sm", className]
    .filter(Boolean)
    .join(" ");
  trigger.setAttribute("role", "tab");
  trigger.dataset.value = value;
  trigger.textContent = label;

  function sync() {
    const selected = api.getValue() === value;
    trigger.setAttribute("aria-selected", String(selected));
    trigger.tabIndex = selected ? 0 : -1;
    trigger.classList.toggle("conduit-tabs__trigger--active", selected);
  }

  trigger.addEventListener("click", () => api.setValue(value));

  trigger.addEventListener("keydown", (event) => {
    const triggers = [...tabsRoot.querySelectorAll('[role="tab"]')];
    const index = triggers.indexOf(trigger);
    let nextIndex = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (index + 1) % triggers.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (index - 1 + triggers.length) % triggers.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = triggers.length - 1;
    } else {
      return;
    }

    const next = triggers[nextIndex];
    api.setValue(next.dataset.value);
    next.focus();
  });

  api.subscribe(sync);
  sync();
  return trigger;
}

export function createTabsPanel(tabsRoot, options = {}) {
  const { value, className = "" } = options;
  const api = tabsRoot._tabsApi;
  const panel = document.createElement("div");
  panel.className = ["conduit-tabs__panel", className].filter(Boolean).join(" ");
  panel.setAttribute("role", "tabpanel");
  panel.hidden = true;

  function sync() {
    const selected = api.getValue() === value;
    panel.hidden = !selected;
    panel.setAttribute("aria-hidden", String(!selected));
  }

  api.subscribe(sync);
  sync();
  return panel;
}

export function formatSats(amount) {
  return `${new Intl.NumberFormat().format(amount)} sats`;
}

export function createListingCard(options = {}) {
  const {
    title,
    seller,
    priceSats,
    provenanceLabel = "",
    provenanceVariant = "primary",
    action,
    saved = false,
  } = options;

  const card = document.createElement("article");
  card.className = "conduit-listing-card";

  const header = document.createElement("div");
  header.className = "conduit-listing-card__header";

  const titleEl = document.createElement("h3");
  titleEl.className = "voice-2l conduit-listing-card__title";
  titleEl.textContent = title;

  const priceEl = document.createElement("p");
  priceEl.className = "voice-lg conduit-listing-card__price";
  priceEl.textContent = formatSats(priceSats);

  header.append(titleEl, priceEl);

  const meta = document.createElement("p");
  meta.className = "voice-sm text-muted conduit-listing-card__seller";
  meta.textContent = seller;

  card.append(header, meta);

  if (provenanceLabel) {
    const cue = document.createElement("div");
    cue.className = "conduit-listing-card__provenance";
    cue.appendChild(
      createBadge({ variant: provenanceVariant, label: provenanceLabel })
    );
    card.appendChild(cue);
  }

  if (saved && action) {
    const actions = document.createElement("div");
    actions.className = "conduit-listing-card__actions";
    actions.appendChild(action);
    card.appendChild(actions);
  }

  return card;
}

export function createColorSwatch(name, cssVar, foregroundVar) {
  const wrap = document.createElement("div");
  wrap.className = "conduit-swatch-wrap";

  const swatch = document.createElement("div");
  swatch.className = "conduit-swatch";
  swatch.style.background = `var(${cssVar})`;
  swatch.style.color = foregroundVar ? `var(${foregroundVar})` : "var(--color-foreground)";
  swatch.setAttribute("role", "presentation");
  swatch.setAttribute("aria-label", `${name} color swatch`);

  const label = document.createElement("p");
  label.className = "voice-xs conduit-swatch__label";
  label.textContent = name;

  swatch.appendChild(label);
  wrap.appendChild(swatch);
  return wrap;
}
