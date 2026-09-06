// Authored static-web adaptation of the referenced Vue Tabs family; not an upstream source.
export function createTabs({ label, tabs, selected, onSelect }) {
  const root = document.createElement("div");
  root.className = "tabs-root";
  const list = document.createElement("div");
  list.className = "tabs-list";
  list.role = "tablist";
  list.setAttribute("aria-label", label);

  const buttons = tabs.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tabs-trigger";
    button.role = "tab";
    button.id = `${tab.id}-tab`;
    button.setAttribute("aria-controls", `${tab.id}-panel`);
    button.textContent = tab.label;
    button.addEventListener("click", () => select(tab.id));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = buttons.indexOf(button);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      select(tabs[next].id);
    });
    list.append(button);
    return button;
  });

  function select(id) {
    selected = id;
    buttons.forEach((button, index) => {
      const active = tabs[index].id === id;
      button.dataset.state = active ? "active" : "inactive";
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    onSelect(id);
  }

  root.append(list);
  select(selected);
  return { root, select };
}
