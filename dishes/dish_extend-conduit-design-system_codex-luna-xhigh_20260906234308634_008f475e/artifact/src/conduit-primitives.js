/* Browser-native adaptations of the supplied Conduit primitive boundaries. */

let generatedId = 0;

function nextId(prefix) {
  generatedId += 1;
  return `${prefix}-${generatedId}`;
}

function appendContent(parent, content) {
  if (content === null || content === undefined || content === false) return;
  if (Array.isArray(content)) {
    content.forEach((item) => appendContent(parent, item));
    return;
  }
  if (content instanceof Node) {
    parent.append(content);
    return;
  }
  parent.append(document.createTextNode(String(content)));
}

function joinClasses(...values) {
  return values.filter(Boolean).join(" ");
}

/**
 * Button API
 * - variant: primary | secondary | accent | muted | ink | outline | ghost | destructive | link
 * - size: sm | md | lg | icon
 * - rounded: pill by default; false uses the Conduit square-ish geometry
 * - disabled, pressed, isLink, href, onClick, ariaLabel
 */
export function Button({
  children,
  label,
  variant = "primary",
  size = "md",
  rounded = true,
  disabled = false,
  pressed,
  isLink = false,
  href = "#",
  onClick,
  ariaLabel,
  className = ""
} = {}) {
  const control = document.createElement(isLink ? "a" : "button");
  control.className = joinClasses(
    "button",
    `button--${variant}`,
    size !== "md" && `button--${size}`,
    !rounded && "button--square",
    className
  );

  if (isLink) {
    control.href = href;
  } else {
    control.type = "button";
    control.disabled = disabled;
  }

  if (ariaLabel) control.setAttribute("aria-label", ariaLabel);
  if (pressed !== undefined) {
    control.setAttribute("aria-pressed", String(Boolean(pressed)));
    control.dataset.pressed = String(Boolean(pressed));
  }
  if (disabled) control.setAttribute("aria-disabled", "true");
  if (typeof onClick === "function") control.addEventListener("click", onClick);

  appendContent(control, children === undefined ? label : children);
  return control;
}

/** Compact Badge API. The marker is paired with visible text, never used as the only state cue. */
export function Badge({ children, label, variant = "primary", marker = true, className = "" } = {}) {
  const badge = document.createElement("span");
  badge.className = joinClasses("badge", `badge--${variant}`, className);
  if (marker) {
    const markerNode = document.createElement("span");
    markerNode.className = "badge__marker";
    markerNode.setAttribute("aria-hidden", "true");
    badge.append(markerNode);
  }
  appendContent(badge, children === undefined ? label : children);
  return badge;
}

/** Readable PageSection-like shell with the upstream width and gap vocabulary. */
export function PageSection({
  children,
  width = "wide",
  gap = "md",
  className = "",
  sectionClassName = ""
} = {}) {
  const section = document.createElement("section");
  const widthClasses = {
    full: "page-section--full",
    wide: "",
    normal: "page-section--normal",
    narrow: "page-section--narrow",
    xNarrow: "page-section--x-narrow"
  };
  section.className = joinClasses("page-section", widthClasses[width] || "", sectionClassName);
  const inner = document.createElement("div");
  inner.className = joinClasses("page-section__inner", className);
  const gaps = {
    none: "0",
    sm: "var(--space-2)",
    md: "var(--space-4)",
    lg: "var(--space-6)"
  };
  inner.style.gap = gaps[gap] || gaps.md;
  appendContent(inner, children);
  section.append(inner);
  return section;
}

export function TabsTrigger({
  value,
  label,
  selected = false,
  panelId,
  onSelect,
  onNavigate
} = {}) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tabs__trigger";
  trigger.id = nextId("tab");
  trigger.setAttribute("role", "tab");
  trigger.setAttribute("aria-selected", String(selected));
  trigger.setAttribute("aria-controls", panelId);
  trigger.tabIndex = selected ? 0 : -1;
  trigger.dataset.value = value;
  trigger.textContent = label;
  trigger.addEventListener("click", () => onSelect?.(value, { focus: false }));
  trigger.addEventListener("keydown", (event) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (keys.includes(event.key)) {
      event.preventDefault();
      onNavigate?.(event.key);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(value, { focus: false });
    }
  });
  return trigger;
}

/**
 * Tabbed guide composition. Each panel is rendered from a callback so the composition owns
 * content while the primitive owns selection, ARIA state, focus, and keyboard behavior.
 */
export function Tabs({
  items = [],
  initialValue = items[0]?.value,
  renderPanel,
  onChange,
  label = "Guide sections",
  className = ""
} = {}) {
  const root = document.createElement("div");
  root.className = joinClasses("tabs", className);
  const list = document.createElement("div");
  list.className = "tabs__list";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", label);
  const panel = document.createElement("div");
  panel.className = "tabs__panel";
  panel.id = nextId("tabpanel");
  panel.setAttribute("role", "tabpanel");
  panel.tabIndex = 0;
  const triggers = [];
  let currentValue = items.some((item) => item.value === initialValue)
    ? initialValue
    : items[0]?.value;

  const currentIndex = () => Math.max(0, items.findIndex((item) => item.value === currentValue));

  const render = () => {
    triggers.forEach((trigger) => {
      const selected = trigger.dataset.value === currentValue;
      trigger.setAttribute("aria-selected", String(selected));
      trigger.tabIndex = selected ? 0 : -1;
    });
    panel.replaceChildren();
    const activeItem = items.find((item) => item.value === currentValue);
    appendContent(panel, activeItem && renderPanel?.(activeItem.value, activeItem));
  };

  const select = (value, { focus = false } = {}) => {
    if (!items.some((item) => item.value === value)) return;
    currentValue = value;
    render();
    onChange?.(value);
    if (focus) triggers[currentIndex()]?.focus();
  };

  const navigate = (key) => {
    if (!triggers.length) return;
    const index = currentIndex();
    const nextIndex = key === "Home"
      ? 0
      : key === "End"
        ? triggers.length - 1
        : ["ArrowRight", "ArrowDown"].includes(key)
          ? (index + 1) % triggers.length
          : (index - 1 + triggers.length) % triggers.length;
    select(items[nextIndex].value, { focus: true });
  };

  items.forEach((item) => {
    const trigger = TabsTrigger({
      value: item.value,
      label: item.label,
      selected: item.value === currentValue,
      panelId: panel.id,
      onSelect: select,
      onNavigate: navigate
    });
    trigger.setAttribute("aria-controls", panel.id);
    list.append(trigger);
    triggers.push(trigger);
  });

  root.append(list, panel);
  render();
  return {
    root,
    list,
    panel,
    select,
    getValue: () => currentValue
  };
}

export const CONDUIT_PRIMITIVE_API = Object.freeze({
  Button: "Button(options)",
  Badge: "Badge(options)",
  PageSection: "PageSection(options)",
  Tabs: "Tabs({ items, initialValue, renderPanel, onChange })"
});
