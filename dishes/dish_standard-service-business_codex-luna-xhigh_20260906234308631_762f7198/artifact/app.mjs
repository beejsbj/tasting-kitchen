const menuToggle = document.querySelector(".menu-toggle");
const primaryNavigation = document.querySelector("#primary-navigation");

function setMenuState(isOpen) {
  if (!menuToggle || !primaryNavigation) return;
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  primaryNavigation.dataset.open = String(isOpen);
  const label = menuToggle.querySelector(".menu-label");
  if (label) label.textContent = isOpen ? "Close" : "Menu";
}

menuToggle?.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  setMenuState(!isOpen);
});

primaryNavigation?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenuState(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuToggle?.getAttribute("aria-expanded") === "true") {
    setMenuState(false);
    menuToggle.focus();
  }
});

const form = document.querySelector("#enquiry-form");
const summary = document.querySelector("#enquiry-summary");
const summaryDetails = document.querySelector("#summary-details");
const editButton = document.querySelector("#edit-enquiry");
const formState = document.querySelector("#form-state");
const areaSelect = document.querySelector("#area");
const otherAreaWrap = document.querySelector("#other-area-wrap");
const otherAreaInput = document.querySelector("#other-area");

const fields = {
  name: document.querySelector("#name"),
  email: document.querySelector("#email"),
  service: document.querySelector("#service"),
  area: areaSelect,
  otherArea: otherAreaInput,
  description: document.querySelector("#description"),
};

const errorMessages = {
  name: document.querySelector("#name-error"),
  email: document.querySelector("#email-error"),
  service: document.querySelector("#service-error"),
  area: document.querySelector("#area-error"),
  otherArea: document.querySelector("#other-area-error"),
  description: document.querySelector("#description-error"),
};

function setFieldError(fieldName, message) {
  const field = fields[fieldName];
  const error = errorMessages[fieldName];
  if (!field || !error) return;
  field.classList.toggle("invalid", Boolean(message));
  field.setAttribute("aria-invalid", String(Boolean(message)));
  error.textContent = message;
}

function clearFieldError(fieldName) {
  setFieldError(fieldName, "");
}

function syncOtherArea() {
  const needsOtherArea = areaSelect?.value === "other";
  if (!otherAreaWrap || !otherAreaInput) return;
  otherAreaWrap.hidden = !needsOtherArea;
  otherAreaInput.required = needsOtherArea;
  if (!needsOtherArea) clearFieldError("otherArea");
}

function selectedLabel(select) {
  if (!select || select.selectedIndex < 0) return "";
  return select.options[select.selectedIndex].textContent.trim();
}

function validateForm() {
  const errors = {};

  if (!fields.name.value.trim()) {
    errors.name = "Enter your name.";
  }

  if (!fields.email.value.trim()) {
    errors.email = "Enter your email address.";
  } else if (!fields.email.validity.valid) {
    errors.email = "Enter a valid email address.";
  }

  if (!fields.service.value) {
    errors.service = "Choose a service, or choose Other / not sure.";
  }

  if (!fields.area.value) {
    errors.area = "Choose a neighbourhood, or choose Other / nearby area.";
  }

  if (fields.area.value === "other" && !fields.otherArea.value.trim()) {
    errors.otherArea = "Enter the nearby area name.";
  }

  if (!fields.description.value.trim()) {
    errors.description = "Describe what needs attention.";
  }

  Object.keys(errorMessages).forEach((fieldName) => {
    setFieldError(fieldName, errors[fieldName] ?? "");
  });

  return errors;
}

function addSummaryRow(label, value) {
  const term = document.createElement("dt");
  const definition = document.createElement("dd");
  term.textContent = label;
  definition.textContent = value;
  summaryDetails?.append(term, definition);
}

function showSummary() {
  if (!summary || !summaryDetails) return;

  const service = selectedLabel(fields.service);
  const area = fields.area.value === "other" ? fields.otherArea.value.trim() : selectedLabel(fields.area);
  summaryDetails.replaceChildren();
  addSummaryRow("Name", fields.name.value.trim());
  addSummaryRow("Email", fields.email.value.trim());
  addSummaryRow("Service", service);
  addSummaryRow("Area", area);
  addSummaryRow("Job", fields.description.value.trim());
  summary.hidden = false;
  if (formState) formState.textContent = "Enquiry preview ready. Nothing has been sent or booked.";
  summary.focus({ preventScroll: true });
  summary.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

areaSelect?.addEventListener("change", () => {
  syncOtherArea();
  clearFieldError("area");
  if (areaSelect.value === "other") otherAreaInput?.focus();
});

Object.entries(fields).forEach(([fieldName, field]) => {
  if (!field) return;
  const eventName = field.tagName === "SELECT" ? "change" : "input";
  field.addEventListener(eventName, () => clearFieldError(fieldName));
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const errors = validateForm();
  if (Object.keys(errors).length) {
    if (formState) formState.textContent = "Please check the highlighted fields. Nothing has been sent or booked.";
    const firstInvalid = Object.keys(errors).map((fieldName) => fields[fieldName]).find(Boolean);
    firstInvalid?.focus();
    return;
  }
  showSummary();
});

editButton?.addEventListener("click", () => {
  fields.name.focus();
  summary?.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

form?.addEventListener("reset", () => {
  window.setTimeout(() => {
    Object.keys(errorMessages).forEach((fieldName) => clearFieldError(fieldName));
    syncOtherArea();
    if (summary) summary.hidden = true;
    if (formState) formState.textContent = "Preview an enquiry. No message is sent and no appointment is reserved.";
  }, 0);
});

syncOtherArea();
