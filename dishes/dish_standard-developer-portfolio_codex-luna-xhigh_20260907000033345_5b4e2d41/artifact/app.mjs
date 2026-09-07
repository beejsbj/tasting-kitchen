const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-navigation");

function setMenu(open) {
  if (!header || !menuToggle) return;
  header.classList.toggle("menu-open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.querySelector(".menu-toggle-label").textContent = open ? "Close" : "Menu";
}

menuToggle?.addEventListener("click", () => {
  setMenu(menuToggle.getAttribute("aria-expanded") !== "true");
});

navigation?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenu(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenu(false);
});

const filterButtons = [...document.querySelectorAll("[data-filter]")];
const projectCards = [...document.querySelectorAll("[data-project-card]")];
const filterStatus = document.querySelector("#filter-status");
const emptyState = document.querySelector("[data-empty-state]");

function updateProjectFilter(category, button) {
  let visibleCount = 0;

  projectCards.forEach((card) => {
    const isVisible = category === "all" || card.dataset.category === category;
    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  filterButtons.forEach((control) => {
    const isActive = control === button;
    control.classList.toggle("is-active", isActive);
    control.setAttribute("aria-pressed", String(isActive));
  });

  if (filterStatus) {
    const categoryLabel = category === "all" ? "All projects" : category;
    filterStatus.textContent = `Showing ${visibleCount} project${visibleCount === 1 ? "" : "s"} in ${categoryLabel}.`;
  }

  if (emptyState) emptyState.hidden = visibleCount !== 0;
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => updateProjectFilter(button.dataset.filter, button));
});

const copyButton = document.querySelector("[data-copy-email]");
const copyStatus = document.querySelector("#copy-status");
const email = document.querySelector(".contact-email")?.textContent.trim();

copyButton?.addEventListener("click", async () => {
  if (!email) return;

  try {
    await navigator.clipboard.writeText(email);
    if (copyStatus) copyStatus.textContent = "Copied locally · no message will be sent.";
  } catch {
    if (copyStatus) copyStatus.textContent = "Select the address above to copy it · no message will be sent.";
  }
});
