// Authored static-web adaptation of the referenced Vue Tabs family; not an upstream source.
export function createTabs({ label, tabs, selected, onSelect = () => {}, panels = [] }) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new Error("createTabs requires at least one tab");
  }

  const root = document.createElement("div");
  root.className = "tabs-root";
  const list = document.createElement("div");
  list.className = "tabs-list";
  list.role = "tablist";
  list.setAttribute("aria-label", label);
  list.setAttribute("aria-orientation", "horizontal");

  const initialSelection = tabs.some((tab) => tab.id === selected) ? selected : tabs[0].id;

  const buttons = tabs.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tabs-trigger";
    button.role = "tab";
    button.id = `${tab.id}-tab`;
    button.setAttribute("aria-controls", `${tab.id}-panel`);
    button.disabled = Boolean(tab.disabled);
    if (tab.disabled) button.setAttribute("aria-disabled", "true");
    button.textContent = tab.label;
    button.addEventListener("click", () => {
      if (!tab.disabled) select(tab.id);
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const available = buttons.filter((candidate) => !candidate.disabled);
      const current = available.indexOf(button);
      const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length;
      available[next].focus();
      select(tabs.find((tab) => tab.id === available[next].id.replace(/-tab$/u, ""))?.id);
    });
    list.append(button);
    return button;
  });

  function select(id) {
    selected = tabs.some((tab) => tab.id === id && !tab.disabled) ? id : initialSelection;
    panels.forEach((panel) => {
      const active = panel.dataset.tabPanel === selected;
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
      const panelId = `${panel.dataset.tabPanel}-panel`;
      panel.id = panel.id || panelId;
    });
    buttons.forEach((button, index) => {
      const active = tabs[index].id === selected;
      button.dataset.state = active ? "active" : "inactive";
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    onSelect(selected);
  }

  root.append(list);
  select(initialSelection);
  return { root, select };
}
