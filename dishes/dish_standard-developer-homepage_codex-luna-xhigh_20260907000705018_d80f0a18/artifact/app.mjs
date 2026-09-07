const copyButton = document.querySelector("#copy-install");
const installCommand = document.querySelector("#install-command");
const copyStatus = document.querySelector("#copy-status");
const manualCopy = document.querySelector("#manual-copy");
const manualCommand = document.querySelector("#manual-command");

function announceCopyStatus(message, state = "success") {
  copyStatus.textContent = message;
  copyStatus.dataset.state = state;
}

copyButton?.addEventListener("click", async () => {
  const command = installCommand.dataset.command;

  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      throw new Error("Clipboard API unavailable");
    }

    await navigator.clipboard.writeText(command);
    manualCopy.hidden = true;
    announceCopyStatus("Install command copied.");
  } catch {
    manualCopy.hidden = false;
    announceCopyStatus("Could not copy automatically. Select and copy the command below.", "error");
    manualCommand.focus();
    manualCommand.select();
  }
});

const menuToggle = document.querySelector(".menu-toggle");
const mobileNav = document.querySelector("#mobile-nav");
const mobileNavLinks = mobileNav ? [...mobileNav.querySelectorAll("a")] : [];

function closeMobileNav() {
  if (!menuToggle || !mobileNav) return;
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.querySelector(".sr-only").textContent = "Open navigation";
  mobileNav.hidden = true;
}

menuToggle?.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.querySelector(".sr-only").textContent = isOpen ? "Open navigation" : "Close navigation";
  mobileNav.hidden = isOpen;
});

mobileNavLinks.forEach((link) => link.addEventListener("click", closeMobileNav));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileNav();
});

document.querySelectorAll("[data-preview]").forEach((button) => {
  button.addEventListener("click", () => {
    const preview = document.querySelector(`#${button.dataset.preview}`);
    if (!preview) return;

    const willOpen = preview.hidden;
    preview.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
    button.textContent = willOpen ? `Hide ${button.dataset.planName} preview` : `Preview ${button.dataset.planName}`;
  });
});
